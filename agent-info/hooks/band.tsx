/**
 * Draws the agent-info band above the prompt.
 */
import type { Elements, RenderSurface } from 'claude-code'

import type { RunInfo, TodoCounts, TrackedTask } from '../types'

import {
  bar,
  formatDuration,
  formatPercent,
  formatUsd,
  pulseBar,
  viewOf,
} from './progress'

/** Cells reserved beside the bar for the percentage and spacing. */
const BAR_RESERVE = 8

/** Bar width bounds, in cells. */
const BAR_MIN = 10
const BAR_MAX = 40

/** Everything one draw needs. */
export type BandInput = {
  elements: Elements[RenderSurface]
  run: RunInfo
  tasks: readonly TrackedTask[]
  todos: TodoCounts | null
  bodyColumns: number
}

/**
 * Picks a bar width that fits the band's columns.
 *
 * Args:
 *   columns: Cells the band may use.
 *
 * Returns:
 *   A width between BAR_MIN and BAR_MAX.
 */
function barWidth(columns: number): number {
  return Math.min(BAR_MAX, Math.max(BAR_MIN, columns - BAR_RESERVE))
}

/**
 * Builds the band's tree for one draw.
 *
 * Args:
 *   input: Elements, stored state and the band's width.
 *
 * Returns:
 *   The band's JSX tree.
 */
export function drawBand(input: BandInput): JSX.Element {
  const { Box, Text } = input.elements
  const { run } = input
  const view = viewOf(run, input.tasks, input.todos)
  const width = barWidth(input.bodyColumns)
  const tick = Math.floor(view.elapsedMs / 1000)

  const status = run.isRunning ? 'running' : (run.outcome ?? 'done')
  const statusColor = run.isRunning
    ? 'claude'
    : run.outcome === 'answer'
      ? 'success'
      : 'warning'

  const barText =
    view.fraction === null
      ? run.isRunning
        ? pulseBar(tick, width)
        : bar(1, width)
      : bar(view.fraction, width)
  const percentText =
    view.fraction === null ? (run.isRunning ? '  …' : '   ✓') : formatPercent(view.fraction)
  const planText =
    view.plan === null
      ? 'no task list — progress unknown'
      : `${view.plan.done}/${view.plan.total} tasks`

  return (
    <Box flexDirection="column">
      <Box>
        <Text bold>agent-info </Text>
        <Text color={statusColor}>{status}</Text>
        <Text dimColor>
          {'  '}
          {formatDuration(view.elapsedMs)}
          {view.etaMs === null ? '' : ` · ~${formatDuration(view.etaMs)} left`}
          {` · ${run.toolCalls} tool calls · ${planText}`}
        </Text>
      </Box>
      <Box>
        <Text color={run.isRunning ? 'claude' : statusColor}>{barText}</Text>
        <Text> {percentText}</Text>
      </Box>
      <Box>
        <Text>
          {'cost: '}
          <Text bold>{formatUsd(view.turnUsd)}</Text>
          {run.isRunning ? ' so far' : ' this turn'}
        </Text>
        <Text dimColor>
          {view.projectedUsd === null
            ? ''
            : ` · est. total ${formatUsd(view.projectedUsd)}`}
          {` · session ${formatUsd(view.sessionUsd)}`}
        </Text>
      </Box>
    </Box>
  )
}
