/**
 * Pure progress and cost math for agent-info.
 *
 * Nothing here touches the engine: every function takes plain values and
 * returns plain values, so it is trivially testable and safe to call from any
 * hook or render.
 */
import type { RunInfo, TodoCounts, TrackedTask } from '../types'

/** Fractions below this are treated as "no measurable progress yet". */
const EPSILON = 1e-9

/** Width of the indeterminate bar's moving block, in cells. */
const PULSE_WIDTH = 4

/** A plan's done/total counts, from whichever source the model used. */
export type PlanCounts = { done: number; total: number }

/** What the band shows, computed once per draw from the stored run. */
export type RunView = {
  /** Plan counts, or null when the model keeps no task list. */
  plan: PlanCounts | null
  /** Overall plan fraction 0..1, or null when there is no plan. */
  fraction: number | null
  /** Elapsed milliseconds of the turn. */
  elapsedMs: number
  /** USD spent by this turn so far, or null without a cost ledger. */
  turnUsd: number | null
  /** USD the whole session has cost, or null without a cost ledger. */
  sessionUsd: number | null
  /** Projected total USD of this turn at 100%, or null when not estimable. */
  projectedUsd: number | null
  /** Projected remaining milliseconds, or null when not estimable. */
  etaMs: number | null
}

/**
 * Clamps a number into [0, 1]; NaN becomes 0.
 *
 * Args:
 *   value: Any number.
 *
 * Returns:
 *   The value clamped to the unit interval.
 */
export function clampUnit(value: number): number {
  if (Number.isNaN(value)) {
    return 0
  }

  return Math.min(1, Math.max(0, value))
}

/**
 * Counts the plan from Task tools first, falling back to the TodoWrite list.
 *
 * Args:
 *   tasks: Tasks tracked from TaskCreate / TaskUpdate.
 *   todos: Counts from the latest TodoWrite, or null.
 *
 * Returns:
 *   Done/total counts, or null when neither source has any items.
 */
export function planCounts(
  tasks: readonly TrackedTask[],
  todos: TodoCounts | null,
): PlanCounts | null {
  if (tasks.length > 0) {
    const done = tasks.filter(task => task.status === 'completed').length

    return { done, total: tasks.length }
  }
  if (todos !== null && todos.total > 0) {
    return { done: Math.min(todos.done, todos.total), total: todos.total }
  }

  return null
}

/**
 * Turns plan counts into a fraction.
 *
 * Args:
 *   plan: Done/total counts, or null.
 *
 * Returns:
 *   A fraction in [0, 1], or null when there is no plan.
 */
export function planFraction(plan: PlanCounts | null): number | null {
  if (plan === null || plan.total <= 0) {
    return null
  }

  return clampUnit(plan.done / plan.total)
}

/**
 * The share of this turn's own work that is done.
 *
 * Plans outlive turns, so work finished before the turn started is not credit
 * this turn earned; projecting cost from the raw fraction would undercount.
 *
 * Args:
 *   fraction: Plan fraction now.
 *   startFraction: Plan fraction when the turn started (null if no plan then).
 *
 * Returns:
 *   The turn-relative fraction in [0, 1], or null when not computable.
 */
export function turnFraction(
  fraction: number | null,
  startFraction: number | null,
): number | null {
  if (fraction === null) {
    return null
  }
  const base = startFraction ?? 0
  const remainingAtStart = 1 - base
  if (remainingAtStart <= EPSILON) {
    return fraction >= 1 ? 1 : null
  }

  return clampUnit((fraction - base) / remainingAtStart)
}

/**
 * Projects a total from what was spent and how far along it is.
 *
 * Args:
 *   spent: Amount used so far (USD or ms).
 *   fraction: Turn-relative progress in [0, 1], or null.
 *
 * Returns:
 *   The projected total, or null when there is no progress to project from.
 */
export function project(spent: number | null, fraction: number | null): number | null {
  if (spent === null || fraction === null || fraction <= EPSILON || spent < 0) {
    return null
  }

  return spent / fraction
}

/**
 * Computes everything the band draws from the stored state.
 *
 * Args:
 *   run: The current or last run.
 *   tasks: Tracked tasks.
 *   todos: Latest TodoWrite counts.
 *
 * Returns:
 *   The view model for one draw.
 */
export function viewOf(
  run: RunInfo,
  tasks: readonly TrackedTask[],
  todos: TodoCounts | null,
): RunView {
  const plan = planCounts(tasks, todos)
  const fraction = planFraction(plan)
  const elapsedMs = Math.max(0, run.now - run.startedAt)
  const turnUsd =
    run.usd === null || run.baseUsd === null ? null : Math.max(0, run.usd - run.baseUsd)
  const relative = turnFraction(fraction, run.startFraction)
  const projectedUsd = run.isRunning ? project(turnUsd, relative) : null
  const projectedMs = run.isRunning ? project(elapsedMs, relative) : null
  const etaMs = projectedMs === null ? null : Math.max(0, projectedMs - elapsedMs)

  return {
    plan,
    fraction,
    elapsedMs,
    turnUsd,
    sessionUsd: run.usd,
    projectedUsd,
    etaMs,
  }
}

/**
 * Draws a determinate bar such as `███████░░░░░`.
 *
 * Args:
 *   fraction: Progress in [0, 1].
 *   width: Bar width in cells (at least 1).
 *
 * Returns:
 *   The bar string, exactly `width` cells long.
 */
export function bar(fraction: number, width: number): string {
  const cells = Math.max(1, Math.floor(width))
  const filled = Math.round(clampUnit(fraction) * cells)

  return '█'.repeat(filled) + '░'.repeat(cells - filled)
}

/**
 * Draws an indeterminate bar whose block bounces with `tick`.
 *
 * Args:
 *   tick: Any non-negative integer that advances over time.
 *   width: Bar width in cells (at least 1).
 *
 * Returns:
 *   The bar string, exactly `width` cells long.
 */
export function pulseBar(tick: number, width: number): string {
  const cells = Math.max(1, Math.floor(width))
  const block = Math.min(PULSE_WIDTH, cells)
  const span = cells - block
  if (span === 0) {
    return '▓'.repeat(cells)
  }
  const period = span * 2
  const step = ((Math.floor(tick) % period) + period) % period
  const start = step <= span ? step : period - step

  return '░'.repeat(start) + '▓'.repeat(block) + '░'.repeat(span - start)
}

/**
 * Formats US dollars with precision that suits the magnitude.
 *
 * Args:
 *   usd: Dollars, or null.
 *
 * Returns:
 *   `$0.0042`, `$0.42`, `$12.30`, or `n/a` when null.
 */
export function formatUsd(usd: number | null): string {
  if (usd === null || !Number.isFinite(usd)) {
    return 'n/a'
  }
  const value = Math.max(0, usd)
  const digits = value < 0.01 ? 4 : 2

  return `$${value.toFixed(digits)}`
}

/**
 * Formats a duration as `42s`, `3m 05s` or `1h 02m`.
 *
 * Args:
 *   ms: Milliseconds, or null.
 *
 * Returns:
 *   The compact duration, or `—` when null.
 */
export function formatDuration(ms: number | null): string {
  if (ms === null || !Number.isFinite(ms)) {
    return '—'
  }
  const total = Math.max(0, Math.round(ms / 1000))
  const hours = Math.floor(total / 3600)
  const minutes = Math.floor((total % 3600) / 60)
  const seconds = total % 60
  if (hours > 0) {
    return `${hours}h ${String(minutes).padStart(2, '0')}m`
  }
  if (minutes > 0) {
    return `${minutes}m ${String(seconds).padStart(2, '0')}s`
  }

  return `${seconds}s`
}

/**
 * Formats a fraction as a whole percentage.
 *
 * Args:
 *   fraction: Progress in [0, 1].
 *
 * Returns:
 *   `0%` through `100%`, right-aligned to four characters.
 */
export function formatPercent(fraction: number): string {
  return `${Math.floor(clampUnit(fraction) * 100)}%`.padStart(4, ' ')
}
