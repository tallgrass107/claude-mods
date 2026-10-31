# agent-info

A Claude Code mod that shows a **live progress bar and estimated cost** above the prompt while Claude works on a task.

```
agent-info running  2m 14s · ~1m 30s left · 23 tool calls · 3/5 tasks
████████████████████████░░░░░░░░░░░░░░░░  60%
cost: $0.4210 so far · est. total $0.7016 · session $3.12
```

## Usage

| Command              | What it does                                   |
| -------------------- | ---------------------------------------------- |
| `/agent-info`        | Toggle the band on or off                      |
| `/agent-info on`     | Show the band (`show`, `start`, `enable` work) |
| `/agent-info off`    | Hide the band (`hide`, `stop`, `disable` work) |

The band appears as soon as the next task starts and keeps the final numbers after the task ends, until the next one starts.

## What the numbers mean

| Field          | Source                                                                                     |
| -------------- | ------------------------------------------------------------------------------------------ |
| Progress bar   | Claude's own task list (TaskCreate / TaskUpdate, or TodoWrite). No list → a pulsing bar.   |
| Elapsed / ETA  | Wall clock; ETA = elapsed ÷ progress made *this turn*. Only shown once progress moves.     |
| Cost so far    | Real session cost ledger (same as `/cost`) now, minus its value when the turn started.     |
| Est. total     | Cost so far ÷ progress made this turn. A linear estimate — treat it as a ballpark.          |
| Session        | Total session cost, same figure `/cost` reports.                                           |

Cost includes subagents spawned by the turn. Where the host keeps no cost ledger, cost shows `n/a`.

## Install

At the prompt of a Claude Code terminal session:

```
/plugin install agent-info --marketplace tallgrass107/claude-mods
```

Answer `y` to add the marketplace, then pick the **user** scope (Enter) so it loads in every session.

From a shell:

```bash
claude plugin install agent-info --marketplace tallgrass107/claude-mods
```

In the desktop app, where `/plugin` does not run: click **+** next to the prompt box → **Plugins** → **Add marketplace** with `tallgrass107/claude-mods` → **Add plugin**.

## Develop

```bash
claude plugin validate .
```

```bash
claude plugin test .
```

## License

MIT
