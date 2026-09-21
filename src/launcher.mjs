#!/usr/bin/env node
/**
 * opencode-with-sidecars — OpenChamber's Local backend, with the isolated
 * mcode/pi profiles still coming up and going down with the app.
 *
 *   OpenChamber ──opencode API──▶ opencode (child of this process, stdout inherited)
 *                                  └─ isolated `openchamber serve` instances (mcode / pi)
 *
 * OpenChamber spawns whatever `$OPENCODE_BINARY` / `settings.opencodeBinary`
 * points to as `serve --hostname H --port P`, waits for the stdout line
 * `opencode server listening on <url>`, then health-checks `/global/health`.
 * So this launcher hands the args to the real opencode (whose readiness line
 * flows through untouched) and starts the sidecar profiles next to it; when the
 * app quits, OpenChamber SIGTERMs this process and the whole chain goes down.
 *
 * Fail-open: if a sidecar cannot start, opencode is unaffected — the Local
 * backend never depends on mcode/pi being healthy.
 *
 * Env overrides (legacy OCMC_* names still accepted):
 *   OCS_REAL_OPENCODE    real opencode binary (default: app-bundled, ~/.bun/bin)
 *   OCS_SIDECAR          comma list `port=profileDir` (wins over the config file)
 *   OCS_SIDECAR_FILE     config file (default ~/.openchamber-sidecars/sidecar.json,
 *                        falling back to ~/.openchamber-mcode/sidecar.json)
 *   OCS_OPENCHAMBER_BIN  openchamber CLI used for the sidecar instances
 *   OCS_SIDECAR_LOG_DIR  where per-port instance logs go (default /tmp)
 *   OCS_LAUNCHER_LOG     launcher log file (default ~/.openchamber-sidecars/launcher.log)
 */

import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

import { SidecarSupervisor, loadSidecarSpecs, log } from "./sidecar.mjs";

function envOf(...names) {
  for (const name of names) {
    const value = process.env[name];
    if (value !== undefined && value !== "") return value;
  }
  return undefined;
}

function resolveRealOpencode() {
  const override = envOf("OCS_REAL_OPENCODE", "OCMC_REAL_OPENCODE");
  if (override !== undefined) return override;
  for (const candidate of [
    "/Applications/OpenChamber.app/Contents/Resources/opencode-cli/opencode",
    join(homedir(), ".bun/bin/opencode"),
    join(homedir(), ".opencode/bin/opencode"),
  ]) {
    if (existsSync(candidate)) return candidate;
  }
  return "opencode"; // PATH at spawn time
}

const args = process.argv.slice(2);
const realOpencode = resolveRealOpencode();

if (realOpencode !== "opencode" && !existsSync(realOpencode)) {
  console.error(`opencode-with-sidecars: real opencode not found at '${realOpencode}' (set OCS_REAL_OPENCODE)`);
  process.exit(1);
}

log(`launching real opencode: ${realOpencode} ${args.join(" ")}`);
const opencode = spawn(realOpencode, args, { stdio: "inherit" });
opencode.on("error", (err) => {
  console.error(`opencode-with-sidecars: failed to launch opencode: ${err.message}`);
  process.exit(1);
});

const specs = loadSidecarSpecs();
const supervisor = specs.length > 0 ? new SidecarSupervisor(specs) : undefined;
if (supervisor === undefined) log("no sidecar configured; running opencode only");
else log(`sidecar config: ${specs.map((s) => `:${s.port}=${s.profileDir}`).join(" ")}`);
supervisor?.start();

let stopping = false;
async function shutdown(label) {
  if (stopping) return;
  stopping = true;
  log(`shutting down (${label})`);
  try {
    opencode.kill("SIGTERM");
  } catch {
    /* already gone */
  }
  await supervisor?.stop();
  process.exit(0);
}

process.on("SIGTERM", () => void shutdown("SIGTERM"));
process.on("SIGINT", () => void shutdown("SIGINT"));
process.on("SIGHUP", () => void shutdown("SIGHUP"));

opencode.on("exit", async (code, signal) => {
  if (stopping) return;
  stopping = true;
  log(`opencode exited (code=${code ?? "?"} signal=${signal ?? "?"}); tearing down sidecars`);
  await supervisor?.stop();
  process.exit(code ?? 0);
});
