# claude-mods

A Claude Code plugin marketplace of mods by tallgrass107.

| Mod | What it does | Trigger |
| --- | --- | --- |
| [agent-info](./agent-info) | Live progress bar, elapsed time, ETA and estimated cost for the running task | `/agent-info` |

## Install a mod

At the prompt of a Claude Code terminal session:

```
/plugin install agent-info --marketplace tallgrass107/claude-mods
```

Answer `y` to add the marketplace, then pick the **user** scope so the mod loads in every session.

From a shell:

```bash
claude plugin install agent-info --marketplace tallgrass107/claude-mods
```

In the desktop app, where `/plugin` does not run: click **+** next to the prompt box → **Plugins** → **Add marketplace** with `tallgrass107/claude-mods` → **Add plugin**.

## License

MIT — see each mod's `LICENSE`.
