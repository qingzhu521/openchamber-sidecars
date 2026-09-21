/**
 * Sidecar supervisor — lifecycle management for isolated `openchamber serve`
 * instances that ride this launcher's lifecycle.
 *
 * This is deliberately standalone: it knows nothing about mcode or pi. Each
 * sidecar is a full OpenChamber profile (`~/.config/openchamber-*`) whose own
 * settings.json decides which agent backend it runs. That keeps
 * openchamber-mcode and openchamber-pi symmetric, pure adapters and free of
 * generic launcher concerns.
 *
 *   launcher up  → spawns each `openchamber serve --port P --foreground`
 *                  (direct child, log to /tmp)
 *   launcher down→ SIGTERM each sidecar (SIGKILL after a grace period)
 *
 * Opt-in, fail-open: any sidecar failure is logged and skipped — the launcher
 * itself must never fail because a sidecar could not start.
 */

import { spawn } from "node:child_process";
import { appendFileSync, existsSync, mkdirSync, openSync, readFileSync } from "node:fs";
import { get as httpGet } from "node:http";
import { homedir } from "node:os";
import { join } from "node:path";

/** openchamber CLI candidates beyond PATH (GUI-spawned launchers get a minimal PATH). */
const OPENCHAMBER_BIN_CANDIDATES = [
  join(homedir(), ".local/bin"),
  join(homedir(), ".hermes/node/bin"),
  join(homedir(), "bin"),
  "/opt/homebrew/bin",
  "/usr/local/bin",
];

const DEFAULT_CONFIG_FILE = join(homedir(), ".openchamber-sidecars", "sidecar.json");
const LEGACY_CONFIG_FILE = join(homedir(), ".openchamber-mcode", "sidecar.json");

/** First non-empty env var among `names` (OCS_* preferred, legacy OCMC_* accepted). */
function envOf(...names) {
  for (const name of names) {
    const value = process.env[name];
    if (value !== undefined && value !== "") return value;
  }
  return undefined;
}

function message(err) {
  return err instanceof Error ? err.message : String(err);
}

/** Log to stderr (surfaced by the app) and best-effort to a launcher log file. */
export function log(line) {
  const text = `[sidecar] ${line}`;
  console.error(text);
  try {
    const file = envOf("OCS_LAUNCHER_LOG", "OCMC_LAUNCHER_LOG") ?? join(homedir(), ".openchamber-sidecars", "launcher.log");
    mkdirSync(join(homedir(), ".openchamber-sidecars"), { recursive: true });
    appendFileSync(file, `${new Date().toISOString()} ${text}\n`);
  } catch {
    /* logging must never throw */
  }
}

function sidecarLogPath(port) {
  const dir = envOf("OCS_SIDECAR_LOG_DIR", "OCMC_SIDECAR_LOG_DIR");
  return dir ? join(dir, `openchamber-sidecars-${port}.log`) : `/tmp/openchamber-sidecars-${port}.log`;
}

/**
 * Parse a comma-separated `port=profileDir` list.
 *   OCS_SIDECAR="57125=~/.config/openchamber-mcode,57124=~/.config/openchamber-pi"
 * `~` expands to the home directory. Later entries win on port collisions;
 * invalid entries are skipped with a warning.
 */
export function parseSidecarEnv(raw) {
  const byPort = new Map();
  for (const entry of raw.split(",")) {
    const trimmed = entry.trim();
    if (trimmed === "") continue;
    const eq = trimmed.indexOf("=");
    if (eq === -1) {
      log(`skipping malformed sidecar entry (expected port=profileDir): '${trimmed}'`);
      continue;
    }
    const port = Number(trimmed.slice(0, eq));
    const profile = trimmed
      .slice(eq + 1)
      .trim()
      .replace(/^~(?=\/|$)/, homedir());
    if (!Number.isInteger(port) || port < 1 || port > 65535 || profile === "") {
      log(`skipping invalid sidecar entry: '${trimmed}'`);
      continue;
    }
    byPort.set(port, { port, profileDir: profile });
  }
  return [...byPort.values()];
}

function readSpecsFile(file) {
  if (!existsSync(file)) return undefined;
  let parsed;
  try {
    parsed = JSON.parse(readFileSync(file, "utf8"));
  } catch (err) {
    log(`ignoring ${file}: ${message(err)}`);
    return [];
  }
  const entries = Array.isArray(parsed)
    ? parsed
    : parsed && typeof parsed === "object" && Array.isArray(parsed.instances)
      ? parsed.instances
      : undefined;
  if (entries === undefined) {
    log(`ignoring ${file}: expected a JSON array (or {"instances": [...]}) of {port, profileDir}`);
    return [];
  }
  const specs = [];
  for (const entry of entries) {
    if (!entry || typeof entry !== "object") continue;
    const port = Number(entry.port);
    const profileDir =
      typeof entry.profileDir === "string" ? entry.profileDir.replace(/^~(?=\/|$)/, homedir()) : "";
    if (!Number.isInteger(port) || port < 1 || port > 65535 || profileDir === "") {
      log(`skipping invalid entry in ${file}: ${JSON.stringify(entry)}`);
      continue;
    }
    specs.push({ port, profileDir });
  }
  return specs;
}

/**
 * Resolve sidecar specs from the env var, else from the config file. The new
 * home is `~/.openchamber-sidecars/sidecar.json`; the old mcode location is
 * still read when the new file is absent, so existing setups keep working.
 */
export function loadSidecarSpecs() {
  const raw = envOf("OCS_SIDECAR", "OCMC_SIDECAR");
  if (raw !== undefined) return parseSidecarEnv(raw);

  const explicit = envOf("OCS_SIDECAR_FILE", "OCMC_SIDECAR_FILE");
  const candidates = explicit ? [explicit] : [DEFAULT_CONFIG_FILE, LEGACY_CONFIG_FILE];
  for (const file of candidates) {
    const specs = readSpecsFile(file);
    if (specs !== undefined) {
      if (specs.length === 0) log(`no valid entries in ${file}; sidecar disabled`);
      return specs;
    }
  }
  return [];
}

function resolveOpenchamberBinary() {
  const override = envOf("OCS_OPENCHAMBER_BIN", "OCMC_OPENCHAMBER_BIN");
  if (override !== undefined) return override;
  for (const dir of OPENCHAMBER_BIN_CANDIDATES) {
    const candidate = join(dir, "openchamber");
    if (existsSync(candidate)) return candidate;
  }
  return "openchamber"; // PATH at spawn time
}

/** True if something already answers on the port (health endpoint optional). */
function portResponds(port, timeoutMs = 2_000) {
  return new Promise((resolve) => {
    const req = httpGet(`http://127.0.0.1:${port}/health`, (res) => {
      res.resume(); // drain
      log(`port ${port} already answering (/health -> ${res.statusCode ?? "no status"}), not starting a sidecar`);
      resolve(true);
    });
    req.on("error", () => resolve(false));
    req.on("timeout", () => {
      req.destroy();
      resolve(false);
    });
    req.setTimeout(timeoutMs);
  });
}

export class SidecarSupervisor {
  constructor(specs) {
    this.specs = specs;
    this.children = [];
    this.stopping = false;
  }

  /** Fire-and-forget; never throws. */
  start() {
    void this.startAll().catch((err) => log(`startup failed: ${message(err)}`));
  }

  async startAll() {
    for (const spec of this.specs) {
      if (await portResponds(spec.port)) continue;
      this.spawnOne(spec);
    }
  }

  spawnOne(spec) {
    try {
      mkdirSync(spec.profileDir, { recursive: true });
      const logFd = openSync(sidecarLogPath(spec.port), "a");
      log(`starting instance on :${spec.port} (profile ${spec.profileDir}, log ${sidecarLogPath(spec.port)})`);
      const proc = spawn(resolveOpenchamberBinary(), ["serve", "--port", String(spec.port), "--foreground"], {
        stdio: ["ignore", logFd, logFd],
        env: { ...process.env, OPENCHAMBER_DATA_DIR: spec.profileDir },
      });
      const managed = { spec, proc, exited: false };
      this.children.push(managed);
      proc.on("error", (err) => {
        managed.exited = true;
        log(`instance :${spec.port} failed to spawn: ${message(err)}`);
      });
      proc.on("exit", (code, signal) => {
        if (managed.exited) return;
        managed.exited = true;
        if (this.stopping) return;
        log(
          `instance :${spec.port} exited unexpectedly (code=${code ?? "?"} signal=${signal ?? "?"}) — see ${sidecarLogPath(spec.port)}`,
        );
      });
    } catch (err) {
      log(`could not start instance :${spec.port}: ${message(err)}`);
    }
  }

  /**
   * SIGTERM each sidecar, escalate to SIGKILL after a grace period, and wait
   * (bounded) for them to exit. `--foreground` instances run their own
   * graceful shutdown and registry (pid/instance file) cleanup on SIGTERM.
   */
  async stop() {
    this.stopping = true;
    const live = this.children.filter((c) => !c.exited && c.proc.pid !== undefined);
    if (live.length === 0) return;
    log(`stopping ${live.length} instance(s): ${live.map((c) => `:${c.spec.port}`).join(" ")}`);
    const exits = live.map(
      (c) =>
        new Promise((resolve) => {
          c.proc.once("exit", () => resolve());
          setTimeout(() => resolve(), 3_500).unref();
        }),
    );
    for (const c of live) {
      try {
        c.proc.kill("SIGTERM");
      } catch {
        /* already gone */
      }
    }
    await Promise.allSettled(exits);
    for (const c of live) {
      if (!c.exited) {
        try {
          c.proc.kill("SIGKILL");
        } catch {
          /* already gone */
        }
        c.exited = true;
      }
    }
    this.children = [];
  }
}
