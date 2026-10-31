/** Status of one tracked task, as the Task tools report it. */
export type TaskStatus = 'pending' | 'in_progress' | 'completed'

/** One task the model created with TaskCreate during this session. */
export type TrackedTask = { id: string; status: TaskStatus }

/** Done/total counts of the model's latest TodoWrite list. */
export type TodoCounts = { done: number; total: number }

/** Everything the band needs to draw the current (or last) main-loop turn. */
export type RunInfo = {
  /** The main-loop turn this run belongs to. */
  turnId: string
  /** True from `turn.start` until `turn.complete`. */
  isRunning: boolean
  /** Clock ms when the turn started. */
  startedAt: number
  /** Clock ms of the last tick, or of the turn's end once it ended. */
  now: number
  /** Session cost (USD) when the turn started; null where no ledger exists. */
  baseUsd: number | null
  /** Session cost (USD) as last measured; null where no ledger exists. */
  usd: number | null
  /** Tool calls made since the turn started (subagents included). */
  toolCalls: number
  /** Plan fraction (0..1) when the turn started; null when there was no plan. */
  startFraction: number | null
  /** How the turn ended, once it has. */
  outcome: 'answer' | 'aborted' | 'refusal' | 'error' | null
}

declare module 'claude-code' {
  interface PluginState {
    'agent-info': {
      isOn: boolean
      run: Shaped<RunInfo | null>
      tasks: Shaped<TrackedTask[]>
      todos: Shaped<TodoCounts | null>
    }
  }
}
