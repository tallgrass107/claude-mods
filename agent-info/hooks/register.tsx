/**
 * agent-info: a live progress bar and estimated cost for the running task.
 *
 * `/agent-info` toggles a band above the prompt. While a main-loop turn runs,
 * the band shows a progress bar (driven by the model's Task / TodoWrite list,
 * or a pulse when there is none), elapsed time, an ETA, the turn's cost so
 * far, a projected total and the session total. When the turn ends, the band
 * keeps the final numbers until the next one starts.
 */
import { atom, read, update } from 'claude-code'
import type { Register, Timer } from 'claude-code'

import type { RunInfo, TaskStatus, TodoCounts, TrackedTask } from '../types'

import { drawBand } from './band'
import { planCounts, planFraction } from './progress'

const COMMAND = 'agent-info'

// State atoms. Bump a `shape` tag whenever that value's fields change: it makes
// new code decline what an older version stored, which outlives a reload.

/** Whether the band is shown; flipped by `/agent-info`. */
const isOn = atom({ plugin: 'agent-info', key: 'isOn' } as const, false)

/** The current main-loop turn, or the last one once it ended. */
const run = atom({ plugin: 'agent-info', key: 'run' } as const, null, { shape: 'run-1' })

/** Tasks created through TaskCreate and moved by TaskUpdate. */
const tasks = atom({ plugin: 'agent-info', key: 'tasks' } as const, [], { shape: 'tasks-1' })

/** Counts of the latest TodoWrite list. */
const todos = atom({ plugin: 'agent-info', key: 'todos' } as const, null, { shape: 'todos-1' })

/** How often the band's clock advances while a turn runs. */
const TICK_MS = 1000

/** Most tasks kept; the oldest completed ones go first past this. */
const MAX_TASKS = 500

/** What `/agent-info <args>` may ask for. */
type Toggle = 'on' | 'off' | 'flip' | 'invalid'

/**
 * Reads the command's argument.
 *
 * Args:
 *   args: Everything typed after `/agent-info`.
 *
 * Returns:
 *   The requested toggle, or 'invalid' for anything unrecognised.
 */
function parseToggle(args: string): Toggle {
  const word = args.trim().toLowerCase()
  if (word === '' || word === 'toggle') {
    return 'flip'
  }
  if (['on', 'show', 'start', 'enable'].includes(word)) {
    return 'on'
  }
  if (['off', 'hide', 'stop', 'disable'].includes(word)) {
    return 'off'
  }

  return 'invalid'
}

/**
 * Drops the oldest completed tasks once the list grows past MAX_TASKS.
 *
 * Args:
 *   list: The tracked tasks.
 *
 * Returns:
 *   A list no longer than MAX_TASKS.
 */
function capTasks(list: readonly TrackedTask[]): TrackedTask[] {
  if (list.length <= MAX_TASKS) {
    return [...list]
  }
  let excess = list.length - MAX_TASKS

  return list.filter(task => {
    if (excess > 0 && task.status === 'completed') {
      excess -= 1

      return false
    }

    return true
  }).slice(-MAX_TASKS)
}

/**
 * Applies a TaskUpdate status to the tracked list.
 *
 * Args:
 *   list: The tracked tasks.
 *   id: The task's id.
 *   status: The new status, `deleted` removing it.
 *
 * Returns:
 *   The updated list; an unknown id is added so progress stays honest.
 */
function applyStatus(
  list: readonly TrackedTask[],
  id: string,
  status: TaskStatus | 'deleted',
): TrackedTask[] {
  if (status === 'deleted') {
    return list.filter(task => task.id !== id)
  }
  const known = list.some(task => task.id === id)
  if (!known) {
    return capTasks([...list, { id, status }])
  }

  return list.map(task => (task.id === id ? { ...task, status } : task))
}

/**
 * Counts a TodoWrite list.
 *
 * Args:
 *   list: The todos the model wrote.
 *
 * Returns:
 *   Done/total counts, or null for an empty list.
 */
function countTodos(list: readonly { status: string }[]): TodoCounts | null {
  if (list.length === 0) {
    return null
  }

  return {
    done: list.filter(todo => todo.status === 'completed').length,
    total: list.length,
  }
}

/**
 * Fail-open recovery for observer hooks: bookkeeping that breaks must never
 * block or alter the tool call it was watching.
 */
const passThrough = <E, R>(_$: unknown, e: E, next: (e: E) => R): R => next(e)

export const register: Register = on => {
  let ticker: Timer | null = null
  let mainTurnId: string | null = null

  /** Stops the per-second redraw, if one runs. */
  const stopTicker = (): void => {
    ticker?.cancel()
    ticker = null
  }

  on('session.start', async ($, e, next) => {
    await $.command.register({
      name: COMMAND,
      description: 'Toggle a live progress bar and cost estimate for the running task',
      argumentHint: '[on|off]',
    })

    return next(e)
  })

  on('command.run', { command: COMMAND }, async ($, e) => {
    const toggle = parseToggle(e.args)
    if (toggle === 'invalid') {
      return { text: `Usage: /${COMMAND} [on|off] — no argument toggles the band.` }
    }
    const wasOn = await read($, isOn)
    const nowOn = toggle === 'flip' ? !wasOn : toggle === 'on'
    await update($, isOn, () => nowOn)

    return {
      text: nowOn
        ? 'agent-info on: progress and cost show above the prompt while a task runs.'
        : 'agent-info off.',
    }
  }).catch(() => ({ text: 'agent-info: could not change the setting; try again.' }))

  on('turn.start', async ($, e, next) => {
    if (e.agentId !== undefined) {
      return next(e)
    }
    stopTicker()
    mainTurnId = e.turnId
    const startedAt = await $.clock.now()
    const usage = await $.session.usage()
    const usd = usage.cost?.usd ?? null

    // A plan finished in an earlier turn says nothing about this one.
    const tracked = await read($, tasks)
    if (tracked.length > 0 && tracked.every(task => task.status === 'completed')) {
      await update($, tasks, () => [])
    }
    const todoCounts = await read($, todos)
    if (todoCounts !== null && todoCounts.done >= todoCounts.total) {
      await update($, todos, () => null)
    }
    const startFraction = planFraction(
      planCounts(await read($, tasks), await read($, todos)),
    )

    const fresh: RunInfo = {
      turnId: e.turnId,
      isRunning: true,
      startedAt,
      now: startedAt,
      baseUsd: usd,
      usd,
      toolCalls: 0,
      startFraction,
      outcome: null,
    }
    await update($, run, () => fresh)

    ticker = $.clock.every(TICK_MS, () => {
      void $.clock.now().then(now =>
        update($, run, current =>
          current?.isRunning === true ? { ...current, now } : current,
        ),
      )
    })

    return next(e)
  })

  on('turn.complete', async ($, e, next) => {
    if (e.agentId !== undefined || e.turnId !== mainTurnId) {
      return next(e)
    }
    stopTicker()
    mainTurnId = null
    const now = await $.clock.now()
    const usage = await $.session.usage()
    await update($, run, current =>
      current === null
        ? current
        : {
            ...current,
            isRunning: false,
            now,
            usd: usage.cost?.usd ?? current.usd,
            outcome: e.reason,
          },
    )

    return next(e)
  })

  on('session.measure', async ($, e, next) => {
    const usd = e.cost?.usd
    if (usd !== undefined) {
      await update($, run, current =>
        current === null || !current.isRunning ? current : { ...current, usd },
      )
    }

    return next(e)
  })

  on('tool.call', async ($, e, next) => {
    await update($, run, current =>
      current?.isRunning === true
        ? { ...current, toolCalls: current.toolCalls + 1 }
        : current,
    )

    return next(e)
  }).catch(passThrough)

  on('tool.call', { tool: 'TaskCreate' }, async ($, e, next) => {
    const ran = await next(e)
    if (ran.deny === undefined && ran.isError !== true) {
      const id = ran.result?.task?.id
      if (typeof id === 'string') {
        await update($, tasks, list => applyStatus(list, id, 'pending'))
      }
    }

    return ran
  }).catch(passThrough)

  on('tool.call', { tool: 'TaskUpdate' }, async ($, e, next) => {
    const ran = await next(e)
    const status = e.status
    if (
      ran.deny === undefined &&
      ran.isError !== true &&
      ran.result?.success === true &&
      status !== undefined
    ) {
      await update($, tasks, list => applyStatus(list, e.taskId, status))
    }

    return ran
  }).catch(passThrough)

  on('tool.call', { tool: 'TodoWrite' }, async ($, e, next) => {
    const ran = await next(e)
    if (ran.deny === undefined && ran.isError !== true) {
      const counts = countTodos(ran.result?.newTodos ?? e.todos)
      await update($, todos, () => counts)
    }

    return ran
  }).catch(passThrough)

  on('ui.render', { component: 'AbovePrompt' }, async ($, e, next) => {
    if (e.props.hasSurvey || !(await read($, isOn))) {
      return next(e)
    }
    const current = await read($, run)
    if (current === null) {
      return next(e)
    }

    return drawBand({
      elements: $.ui.resolve(e),
      run: current,
      tasks: await read($, tasks),
      todos: await read($, todos),
      bodyColumns: e.props.bodyColumns,
    })
  })
}
