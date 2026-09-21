# OpenChamber Sidecars

Keep OpenChamber's **Local** backend as the real
[opencode](https://opencode.ai), while isolated mcode/pi OpenChamber profiles
start and stop together with the app — no watchers, no LaunchAgents, no
resident supervisor.

```
OpenChamber ──opencode API──▶ opencode (child of this launcher)
                               └─ sidecars: isolated `openchamber serve` profiles
                                    ├─ :57125 mcode  (~/.config/openchamber-mcode)
                                    └─ :57124 pi     (~/.config/openchamber-pi)
```

This project is intentionally standalone: it depends on neither
[openchamber-mcode](../openchamber-mcode) nor [openchamber-pi](../openchamber-pi).
It only starts `openchamber serve --port P --foreground` per profile, and each
profile's own `settings.json` decides which agent backend it runs. Those two
repos stay symmetric, single-purpose adapters.

## Why this exists

OpenChamber spawns whatever `$OPENCODE_BINARY` / `settings.opencodeBinary`
points to as `serve --hostname H --port P`, waits for the stdout line
`opencode server listening on <url>`, then health-checks `/global/health`.
That gives one app-owned process whose lifetime is already tied to the app —
so it can own the extra profiles too:

| Event | What happens |
|---|---|
| App open | OpenChamber spawns this launcher → it spawns `opencode` (inheriting stdout, so the readiness line reaches OpenChamber) **and** each configured `openchamber serve` instance |
| App quit | OpenChamber SIGTERMs this launcher → it SIGTERMs the sidecars (SIGKILL after 3.5s grace) and opencode |

Fail-open: if a sidecar cannot start, opencode is launched regardless — Local
never depends on mcode/pi being healthy.

## Setup

Point the main profile at the launcher (back up first):

```bash
cp ~/.config/openchamber/settings.json ~/.config/openchamber/settings.json.bak
# set "opencodeBinary" to:
#   /absolute/path/to/openchamber-sidecars/bin/opencode-with-sidecars
```

Then configure the sidecars in `~/.openchamber-sidecars/sidecar.json`:

```json
[
  { "port": 57125, "profileDir": "~/.config/openchamber-mcode" },
  { "port": 57124, "profileDir": "~/.config/openchamber-pi" }
]
```

`~` expands to the home directory. Ports already answering on `/health` are
skipped, so manually running an instance does not cause a duplicate. Instances
log to `/tmp/openchamber-sidecars-<port>.log`; the launcher logs to
`~/.openchamber-sidecars/launcher.log`.

Then open OpenChamber normally (Dock/Spotlight/login). Revert by restoring the
backup or clearing the `opencodeBinary` field.

Requires Node.js 22+. No dependencies, no build step.

## Configuration

| Env | Default | Meaning |
|---|---|---|
| `OCS_REAL_OPENCODE` | app-bundled opencode, `~/.bun/bin/opencode` | the opencode that serves **Local** |
| `OCS_SIDECAR` | – | comma list `port=profileDir`; wins over the config file |
| `OCS_SIDECAR_FILE` | `~/.openchamber-sidecars/sidecar.json` | sidecar config file (falls back to `~/.openchamber-mcode/sidecar.json`) |
| `OCS_OPENCHAMBER_BIN` | `openchamber` (PATH + common dirs) | openchamber CLI used for the sidecar instances |
| `OCS_SIDECAR_LOG_DIR` | `/tmp` | where `openchamber-sidecars-<port>.log` files go |
| `OCS_LAUNCHER_LOG` | `~/.openchamber-sidecars/launcher.log` | launcher log file |
| `OCS_NODE_BIN` | auto-detected | node used by the `bin/` wrapper |

Legacy `OCMC_*` names are still accepted as a fallback.

## Standalone check

```bash
# terminal run against a throwaway port; Ctrl-C should tear the sidecars down
bin/opencode-with-sidecars serve --hostname 127.0.0.1 --port 65472
```

## Non-goals

- Being part of an agent adapter. mcode/pi adapters stay independent.
- Reimplementing OpenChamber's own platform features (scheduler, relay, goals).

## License

MIT
