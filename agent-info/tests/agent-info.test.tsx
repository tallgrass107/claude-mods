import { describe, expect, mock, test } from 'claude-code/testing'
import type { On } from 'claude-code'

import {
  bar,
  formatDuration,
  formatPercent,
  formatUsd,
  planCounts,
  project,
  pulseBar,
  turnFraction,
  viewOf,
} from '../hooks/progress'
import type { RunInfo } from '../types'

const SURFACES = ['terminal', 'desktop', 'vscode', 'mobile'] as const

const BAND = {
  plugin: 'agent-info',
  component: 'AbovePrompt',
  props: {
    hasSurvey: false,
    isWorking: true,
    maxRows: 20,
    bodyColumns: 60,
    scroll: { offset: 0, bodyRows: 20 },
    view: {},
  },
} as const

const PRESENTATION = { isFullscreen: false, columns: 80 }

/**
 * Stands in for the engine beneath the plugin: a session whose cost ledger
 * reads `cost.usd`, and answers for every call the mod makes.
 */
function engine(on: On, cost: { usd: number }): void {
  on('command.register', () => ({ value: { command: 'agent-info' } }))
  on('session.start', (_, e) => ({ cwd: e.cwd }))
  on('session.usage', () => ({
    value: { startedAt: 0, context: { window: 200_000 }, rateLimits: [], cost: { usd: cost.usd } },
  }))
  on('turn.start', (_, e) => ({ turnId: e.turnId }))
  on('turn.complete', (_, e) => ({ text: e.answer }))
  on('command.run', () => ({ text: '' }))
  on('session.measure', (_, e) => ({ changed: e.changed }))
  // The engine's own drawing when the mod passes the band on.
  on('ui.render', ($, e) => {
    const { Text } = $.ui.resolve(e)

    return <Text>engine</Text>
  })
}

const BASE_RUN: RunInfo = {
  turnId: 't',
  isRunning: true,
  startedAt: 0,
  now: 10_000,
  baseUsd: 1,
  usd: 1.5,
  toolCalls: 3,
  startFraction: 0,
  outcome: null,
}

describe('progress math', () => {
  test('bar fills proportionally and keeps its width', async () => {
    expect(bar(0.5, 10)).toBe('█████░░░░░')
    expect(bar(2, 4)).toBe('████')
    expect(bar(-1, 4)).toBe('░░░░')
    expect(bar(Number.NaN, 3)).toBe('░░░')
    expect(bar(0.5, 0).length).toBe(1)
  })

  test('pulse bar bounces and keeps its width', async () => {
    for (let tick = 0; tick < 50; tick += 1) {
      expect(pulseBar(tick, 12).length).toBe(12)
    }
    expect(pulseBar(0, 8)).toBe('▓▓▓▓░░░░')
    expect(pulseBar(4, 8)).toBe('░░░░▓▓▓▓')
    expect(pulseBar(5, 8)).toBe('░░░▓▓▓▓░')
    expect(pulseBar(3, 2)).toBe('▓▓')
  })

  test('formatters handle magnitudes and nulls', async () => {
    expect(formatUsd(null)).toBe('n/a')
    expect(formatUsd(0.0042)).toBe('$0.0042')
    expect(formatUsd(12.3)).toBe('$12.30')
    expect(formatUsd(-3)).toBe('$0.0000')
    expect(formatDuration(null)).toBe('—')
    expect(formatDuration(42_000)).toBe('42s')
    expect(formatDuration(185_000)).toBe('3m 05s')
    expect(formatDuration(3_720_000)).toBe('1h 02m')
    expect(formatPercent(0.456)).toBe(' 45%')
    expect(formatPercent(1)).toBe('100%')
  })

  test('plan prefers tasks over todos and ignores empties', async () => {
    expect(planCounts([], null)).toBe(null)
    expect(planCounts([], { done: 0, total: 0 })).toBe(null)
    expect(planCounts([], { done: 9, total: 4 })).toEqual({ done: 4, total: 4 })
    expect(
      planCounts(
        [
          { id: '1', status: 'completed' },
          { id: '2', status: 'in_progress' },
        ],
        { done: 0, total: 5 },
      ),
    ).toEqual({ done: 1, total: 2 })
  })

  test('turn fraction discounts work done before the turn', async () => {
    expect(turnFraction(null, 0.5)).toBe(null)
    expect(turnFraction(0.75, 0.5)).toBe(0.5)
    expect(turnFraction(0.25, 0.5)).toBe(0)
    expect(turnFraction(1, 1)).toBe(1)
    expect(turnFraction(0.5, 1)).toBe(null)
  })

  test('projection needs progress', async () => {
    expect(project(1, 0)).toBe(null)
    expect(project(null, 0.5)).toBe(null)
    expect(project(1, 0.25)).toBe(4)
  })

  test('view projects cost and ETA only while running', async () => {
    const tasks = [
      { id: '1', status: 'completed' as const },
      { id: '2', status: 'pending' as const },
    ]
    const live = viewOf(BASE_RUN, tasks, null)
    expect(live.turnUsd).toBe(0.5)
    expect(live.projectedUsd).toBe(1)
    expect(live.etaMs).toBe(10_000)

    const ended = viewOf({ ...BASE_RUN, isRunning: false, outcome: 'answer' }, tasks, null)
    expect(ended.projectedUsd).toBe(null)
    expect(ended.etaMs).toBe(null)

    const noLedger = viewOf({ ...BASE_RUN, baseUsd: null, usd: null }, tasks, null)
    expect(noLedger.turnUsd).toBe(null)
    expect(noLedger.projectedUsd).toBe(null)
  })
})

describe('the mod', () => {
  test('the band stays hidden until /agent-info turns it on', async ($, on) => {
    engine(on, { usd: 0 })
    mock.clock(on, { now: 1000 })
    await $.session.start({ cwd: '/', surface: 'terminal', isInteractive: true })
    await $.turn.start({ text: 'go', turnId: 'turn-1' })

    const hidden = await $.ui.mount({ ...BAND, surface: 'terminal' })
    expect(await hidden.find({ type: 'Text', text: /agent-info/ })).toBeUndefined()
    expect(await hidden.find({ type: 'Text', text: 'engine' })).toBeDefined()
    await hidden.unmount()

    const on1 = await $.command.run({
      command: 'agent-info',
      args: '',
      origin: { kind: 'composer' },
      presentation: PRESENTATION,
    })
    expect(on1.text).toMatch(/agent-info on/)

    const shown = await $.ui.mount({ ...BAND, surface: 'terminal' })
    expect(await shown.find({ type: 'Text', text: /running/ })).toBeDefined()
    await shown.unmount()

    const off = await $.command.run({
      command: 'agent-info',
      args: 'off',
      origin: { kind: 'composer' },
      presentation: PRESENTATION,
    })
    expect(off.text).toBe('agent-info off.')

    const bad = await $.command.run({
      command: 'agent-info',
      args: 'banana',
      origin: { kind: 'composer' },
      presentation: PRESENTATION,
    })
    expect(bad.text).toMatch(/Usage/)
  })

  test('progress and cost follow todos and the ledger, on every surface', async ($, on) => {
    const cost = { usd: 2 }
    engine(on, cost)
    const clock = mock.clock(on, { now: 0 })
    on('tool.call', (_, e) =>
      e.tool === 'TodoWrite' ? { result: { oldTodos: [], newTodos: e.todos } } : { result: {} },
    )

    await $.session.start({ cwd: '/', surface: 'terminal', isInteractive: true })
    await $.command.run({
      command: 'agent-info',
      args: 'on',
      origin: { kind: 'composer' },
      presentation: PRESENTATION,
    })
    await $.turn.start({ text: 'build it', turnId: 'turn-1' })
    await $.tool.call({
      tool: 'TodoWrite',
      todos: [
        { content: 'a', status: 'completed', activeForm: 'a' },
        { content: 'b', status: 'completed', activeForm: 'b' },
        { content: 'c', status: 'in_progress', activeForm: 'c' },
        { content: 'd', status: 'pending', activeForm: 'd' },
      ],
    })
    cost.usd = 2.5
    await $.session.measure({
      context: { window: 200_000 },
      rateLimits: [],
      cost: { usd: 2.5 },
      changed: ['cost'],
    })
    await clock.advance(20_000)

    for (const surface of SURFACES) {
      const ui = await $.ui.mount({ ...BAND, surface })
      expect(await ui.find({ type: 'Text', text: /2\/4 tasks/ })).toBeDefined()
      expect(await ui.find({ type: 'Text', text: /50%/ })).toBeDefined()
      expect(await ui.find({ type: 'Text', text: '$0.50' })).toBeDefined()
      expect(await ui.find({ type: 'Text', text: /est\. total \$1\.00/ })).toBeDefined()
      expect(await ui.find({ type: 'Text', text: /session \$2\.50/ })).toBeDefined()
      await ui.unmount()
    }

    await $.turn.complete({
      answer: 'done',
      durationMs: 20_000,
      isAborted: false,
      turnId: 'turn-1',
      reason: 'answer',
    })
    const done = await $.ui.mount({ ...BAND, surface: 'desktop' })
    expect(await done.find({ type: 'Text', text: 'answer' })).toBeDefined()
    expect(await done.find({ type: 'Text', text: /est\. total/ })).toBeUndefined()
    await done.unmount()
  })

  test('Task tools drive the bar; a deleted task drops out', async ($, on) => {
    engine(on, { usd: 0 })
    mock.clock(on, { now: 0 })
    let next = 0
    on('tool.call', (_, e) => {
      if (e.tool === 'TaskCreate') {
        next += 1

        return { result: { task: { id: String(next), subject: e.subject } } }
      }
      if (e.tool === 'TaskUpdate') {
        return { result: { success: true, taskId: e.taskId, updatedFields: ['status'] } }
      }

      return { result: {} }
    })

    await $.session.start({ cwd: '/', surface: 'terminal', isInteractive: true })
    await $.command.run({
      command: 'agent-info',
      args: 'on',
      origin: { kind: 'composer' },
      presentation: PRESENTATION,
    })
    await $.turn.start({ text: 'go', turnId: 'turn-1' })
    for (const subject of ['a', 'b', 'c']) {
      await $.tool.call({ tool: 'TaskCreate', subject, description: subject })
    }
    await $.tool.call({ tool: 'TaskUpdate', taskId: '1', status: 'completed' })
    await $.tool.call({ tool: 'TaskUpdate', taskId: '3', status: 'deleted' })

    const ui = await $.ui.mount({ ...BAND, surface: 'terminal' })
    expect(await ui.find({ type: 'Text', text: /1\/2 tasks/ })).toBeDefined()
    expect(await ui.find({ type: 'Text', text: /5 tool calls/ })).toBeDefined()
    expect(await ui.find({ type: 'Text', text: / 50%/ })).toBeDefined()
    await ui.unmount()
  })
}
