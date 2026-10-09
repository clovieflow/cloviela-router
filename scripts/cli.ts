#!/usr/bin/env bun
/**
 * cloviela — one command for the whole lifecycle.
 *
 * ── Why this exists ─────────────────────────────────────────────────────────
 * Running the gateway took four commands in the right order (`bun install`,
 * `bun setup`, `bun run build`, `bun start`), a fifth to open a browser, and a
 * sixth to stop it again — each of which had to be remembered, and none of
 * which told you what was already running. `cloviela` is the one word a user
 * types: it installs if needed, builds if needed, starts, and opens the console.
 *
 * ── Design rules ────────────────────────────────────────────────────────────
 * - **Idempotent.** `cloviela up` on a running instance reports it and opens
 *   the browser rather than starting a second copy or failing.
 * - **Honest.** Every step prints what it is doing. A failure says which step
 *   failed and what to try, never a bare stack trace.
 * - **No new state.** The pid file and the log live in the data directory the
 *   application already uses, so `cloviela` and the gateway cannot disagree
 *   about where things are.
 * - **No root, no daemon manager.** It is a personal gateway; a pid file is
 *   enough, and it works the same on macOS, Linux and Windows.
 */
import { existsSync, realpathSync } from "node:fs";
import { mkdir, readFile, rm, writeFile, appendFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { compiledBinaryPath } from "./build/binary";
import { resolveDataDir } from "../src/persistence/db-mode";

const ROOT = realpathSync(resolve(import.meta.dir, ".."));
const BINARY = compiledBinaryPath(join(ROOT, "dist", "cloviela-router"));
const VERSION = await readVersion();

/** Where the running instance records itself, inside the app's own data dir. */
/**
 * Where a running instance records itself, inside the app's own data dir.
 *
 * Keyed by port, because two installations can run side by side — one on 12800
 * and a second on 12900 — and a single shared file made each of them read the
 * other's record. `status` then reported the wrong instance and `up` refused to
 * start against a port it was not even using.
 */
function pidFile(port: number = resolvePort()): string {
  return join(resolveDataDir(), `cloviela-${port}.pid`);
}
function logFile(port: number = resolvePort()): string {
  return join(resolveDataDir(), `cloviela-${port}.log`);
}

interface InstanceRecord {
  readonly pid: number;
  readonly port: number;
  readonly startedAt: string;
  readonly version: string;
  /**
   * The installation directory this instance was started from.
   *
   * Without it, `cloviela up` run from a second checkout finds the first
   * checkout's pid file, sees a live process on the port, and reports "already
   * running" — so a fresh install appears to succeed while nothing of it is
   * actually running. Optional because records written by an older version do
   * not have it; those are treated as belonging to this installation.
   */
  readonly root?: string;
}

async function readVersion(): Promise<string> {
  try {
    const manifest = JSON.parse(await readFile(join(ROOT, "package.json"), "utf8")) as {
      version?: string;
    };
    return manifest.version ?? "unknown";
  } catch {
    return "unknown";
  }
}

/** The port the gateway binds. Same resolution order the application uses. */
function resolvePort(): number {
  const raw = process.env.PORT?.trim();
  if (raw === undefined || raw === "") return 12_800;
  const parsed = Number(raw);
  return Number.isFinite(parsed) && parsed > 0 ? Math.trunc(parsed) : 12_800;
}

async function readRecord(port: number = resolvePort()): Promise<InstanceRecord | undefined> {
  try {
    const raw = await readFile(pidFile(port), "utf8");
    const parsed = JSON.parse(raw) as Partial<InstanceRecord>;
    if (typeof parsed.pid !== "number" || !Number.isInteger(parsed.pid)) return undefined;
    return {
      pid: parsed.pid,
      port: typeof parsed.port === "number" ? parsed.port : port,
      startedAt: typeof parsed.startedAt === "string" ? parsed.startedAt : "unknown",
      version: typeof parsed.version === "string" ? parsed.version : "unknown",
      // Read back as well as written. Omitting it here made every record look
      // like it came from an unknown installation, which is the one field the
      // ownership check depends on.
      ...(typeof parsed.root === "string" ? { root: parsed.root } : {}),
    };
  } catch {
    // Missing or unreadable: treated as "not running" rather than an error,
    // because a half-written pid file must not stop the user from starting.
    return undefined;
  }
}

async function writeRecord(record: InstanceRecord): Promise<void> {
  await mkdir(resolveDataDir(), { recursive: true });
  await writeFile(pidFile(record.port), JSON.stringify(record, null, 2), "utf8");
}

async function clearRecord(port: number = resolvePort()): Promise<void> {
  await rm(pidFile(port), { force: true });
}

/** Whether a process with this pid exists and is still ours. */
function isAlive(pid: number): boolean {
  try {
    // Signal 0 performs the permission and existence checks without delivering.
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

/** Answers whether the gateway is serving, independent of the pid file. */
async function isServing(port: number, timeoutMs = 1_500): Promise<boolean> {
  try {
    const response = await fetch(`http://127.0.0.1:${port}/health/ready`, {
      signal: AbortSignal.timeout(timeoutMs),
    });
    return response.ok;
  } catch {
    return false;
  }
}

function consoleUrl(port: number): string {
  return `http://127.0.0.1:${port}/console`;
}

/* ── Output ──────────────────────────────────────────────────────────────── */

const useColor = process.stdout.isTTY === true && process.env.NO_COLOR === undefined;
const paint = (code: string, text: string): string => (useColor ? `\u001b[${code}m${text}\u001b[0m` : text);
const bold = (text: string): string => paint("1", text);
const dim = (text: string): string => paint("2", text);
const green = (text: string): string => paint("32", text);
const red = (text: string): string => paint("31", text);
const yellow = (text: string): string => paint("33", text);
const cyan = (text: string): string => paint("36", text);

function step(text: string): void {
  process.stdout.write(`${cyan("›")} ${text}\n`);
}
function ok(text: string): void {
  process.stdout.write(`${green("✓")} ${text}\n`);
}
function warn(text: string): void {
  process.stdout.write(`${yellow("!")} ${text}\n`);
}
function fail(text: string): void {
  process.stderr.write(`${red("✗")} ${text}\n`);
}

/** Runs a command, streaming its output, and returns its exit code. */
async function run(argv: readonly string[], cwd = ROOT): Promise<number> {
  const child = Bun.spawn([...argv], { cwd, stdin: "inherit", stdout: "inherit", stderr: "inherit" });
  return await child.exited;
}

/** Opens a URL in the user's browser, cross-platform and never fatal. */
async function openBrowser(url: string): Promise<boolean> {
  const command =
    process.platform === "darwin"
      ? ["open", url]
      : process.platform === "win32"
        ? ["cmd", "/c", "start", "", url]
        : ["xdg-open", url];
  try {
    const child = Bun.spawn(command, { stdin: "ignore", stdout: "ignore", stderr: "ignore" });
    return (await child.exited) === 0;
  } catch {
    // No browser, no display, headless server — the URL is printed either way.
    return false;
  }
}

/* ── Prerequisites ───────────────────────────────────────────────────────── */

const REQUIRED_BUN_MAJOR = 1;
const REQUIRED_BUN_MINOR = 4;

/** Bun version check, because `Bun.spawn` of the binary will fail obscurely. */
function bunVersionError(): string | undefined {
  const version = Bun.version;
  const [major, minor] = version.split(".").map(Number);
  if (major === undefined || minor === undefined) return undefined;
  if (major > REQUIRED_BUN_MAJOR || (major === REQUIRED_BUN_MAJOR && minor >= REQUIRED_BUN_MINOR)) {
    return undefined;
  }
  return `Bun ${REQUIRED_BUN_MAJOR}.${REQUIRED_BUN_MINOR}.0 or newer is required; this is ${version}.`;
}

async function ensureDependencies(): Promise<boolean> {
  if (existsSync(join(ROOT, "node_modules"))) return true;
  step("Installing dependencies (first run)");
  const code = await run(["bun", "install"]);
  if (code !== 0) {
    fail("`bun install` failed. Check your network and run `cloviela up` again.");
    return false;
  }
  return true;
}

async function ensureConfigured(): Promise<boolean> {
  const envPath = join(ROOT, ".env");
  if (existsSync(envPath)) return true;
  step("No .env found — creating one with a generated encryption key");
  const code = await run(["bun", "run", "setup", "--non-interactive"]);
  if (code !== 0) {
    fail("Setup failed. Run `bun setup` directly to see what it asks for.");
    return false;
  }
  return true;
}

async function ensureBuilt(): Promise<boolean> {
  if (existsSync(BINARY)) return true;
  step("Building the standalone binary (first run; takes a moment)");
  const code = await run(["bun", "run", "build"]);
  if (code !== 0) {
    fail("Build failed. Run `bun run build` directly to see the full output.");
    return false;
  }
  return true;
}

/* ── Commands ────────────────────────────────────────────────────────────── */

/**
 * Appends a child's stream to the log until the stream ends.
 *
 * A `ReadableStream` is not async-iterable in this runtime, so it is drained
 * with an explicit reader. Errors are swallowed: the reader ends when the
 * process exits, and a closed stream is not a failure worth reporting.
 */
async function pumpToLog(stream: ReadableStream<Uint8Array>, port: number): Promise<void> {
  const decoder = new TextDecoder();
  const reader = stream.getReader();
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) return;
      if (value !== undefined) await appendFile(logFile(port), decoder.decode(value, { stream: true }));
    }
  } catch {
    // Process ended or the pipe closed.
  }
}

/** Waits until the gateway answers, or gives up and reports what it saw. */
async function waitForReady(port: number, timeoutMs = 60_000): Promise<boolean> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (await isServing(port)) return true;
    await new Promise((r) => setTimeout(r, 400));
  }
  return false;
}

async function commandUp(args: readonly string[]): Promise<number> {
  const wantsBrowser = !args.includes("--no-open");
  const port = resolvePort();

  const versionError = bunVersionError();
  if (versionError !== undefined) {
    fail(versionError);
    return 1;
  }

  // Already running: report it and open the console rather than starting a
  // second copy, which would fail on the port with a message about sockets
  // instead of a message about the thing the user actually wanted.
  const record = await readRecord(port);
  // An older record has no `root`, so its owner is unknown. Treating that as
  // "mine" is what let a fresh checkout report "already running" while nothing
  // of it was running — so unknown is treated as someone else's, and the port
  // is what decides.
  const sameInstall = record?.root === ROOT;
  if (record !== undefined && sameInstall && isAlive(record.pid) && (await isServing(record.port))) {
    ok(`Already running on ${consoleUrl(record.port)} ${dim(`(pid ${record.pid}, since ${record.startedAt})`)}`);
    if (wantsBrowser) await openBrowser(consoleUrl(record.port));
    return 0;
  }
  // A different installation owns the port. Starting here would fail on the
  // bind with a message about sockets rather than about the actual situation.
  if (!sameInstall && (await isServing(port))) {
    fail(`Port ${port} is already serving another installation:`);
    fail(
      `  ${record?.root ?? "(started before this version recorded its path)"}` +
        (record === undefined ? "" : ` ${dim(`(pid ${record.pid})`)}`),
    );
    fail("");
    fail("Two installations cannot share a port. Either stop that one from its");
    fail("own directory, or start this one on a different port:");
    fail(`  PORT=${port + 1} cloviela up`);
    return 1;
  }
  // A stale pid file is cleaned up here rather than left to confuse `status`.
  if (record !== undefined && !isAlive(record.pid)) await clearRecord(port);

  if (!(await ensureDependencies())) return 1;
  if (!(await ensureConfigured())) return 1;
  if (!(await ensureBuilt())) return 1;

  await mkdir(resolveDataDir(), { recursive: true });
  step(`Starting Cloviela ${dim(`v${VERSION}`)} on port ${port}`);
  const child = Bun.spawn([BINARY], {
    cwd: ROOT,
    env: { ...process.env, PORT: String(port), NODE_ENV: "production" },
    stdin: "ignore",
    // The gateway writes JSON logs; they go to a file so `cloviela logs` can
    // show them and so a crash after the terminal closes is still recorded.
    stdout: "pipe",
    stderr: "pipe",
  });

  // Detach: the CLI exits and the gateway keeps running. Its output is piped
  // to the log file by these readers, which end when the process does.
  void pumpToLog(child.stdout as ReadableStream<Uint8Array>, port);
  void pumpToLog(child.stderr as ReadableStream<Uint8Array>, port);

  await writeRecord({
    pid: child.pid,
    port,
    startedAt: new Date().toISOString(),
    version: VERSION,
    root: ROOT,
  });
  child.unref();

  if (!(await waitForReady(port))) {
    fail(`The gateway did not answer on port ${port} within 60s.`);
    fail(`Check the log: ${logFile(port)}`);
    fail(`Last lines:\n${await tailLog(12)}`);
    return 1;
  }

  ok(`Ready on ${bold(consoleUrl(port))}`);
  process.stdout.write(`  ${dim("Stop it with")} cloviela down${dim(", watch it with")} cloviela logs\n`);
  if (wantsBrowser) {
    const opened = await openBrowser(consoleUrl(port));
    if (!opened) process.stdout.write(`  ${dim("Open this in your browser:")} ${consoleUrl(port)}\n`);
  }
  return 0;
}

async function commandDown(): Promise<number> {
  const requested = resolvePort();
  const record = await readRecord(requested);
  const port = record?.port ?? requested;
  // Refuse to stop an installation that is not this one: an operator running
  // `down` in a second checkout would otherwise kill the first.
  if (record !== undefined && record.root !== undefined && record.root !== ROOT && isAlive(record.pid)) {
    fail(`The instance on port ${record.port} was started from a different directory:`);
    fail(`  ${record.root}`);
    fail("Run `cloviela down` there instead.");
    return 1;
  }
  if (record === undefined || !isAlive(record.pid)) {
    await clearRecord(requested);
    // The pid file can be gone while something still holds the port — a
    // manually started instance, or a binary from another checkout.
    if (await isServing(port)) {
      warn(`Something is serving port ${port} but it was not started by cloviela.`);
      warn("Stop it the way you started it.");
      return 1;
    }
    ok("Not running.");
    return 0;
  }

  step(`Stopping pid ${record.pid}`);
  try {
    // SIGTERM lets the gateway drain in-flight responses; the app handles it.
    process.kill(record.pid, "SIGTERM");
  } catch {
    // Already gone between the liveness check and the signal.
  }

  const deadline = Date.now() + 15_000;
  while (Date.now() < deadline && isAlive(record.pid)) {
    await new Promise((r) => setTimeout(r, 200));
  }
  if (isAlive(record.pid)) {
    warn("It did not exit within 15s; forcing.");
    try {
      process.kill(record.pid, "SIGKILL");
    } catch {
      // Gone.
    }
  }
  await clearRecord(port);
  ok("Stopped.");
  return 0;
}

async function tailLog(lines: number): Promise<string> {
  try {
    const text = await readFile(logFile(), "utf8");
    return text.split(/\r?\n/).filter(Boolean).slice(-lines).join("\n");
  } catch {
    return "(no log yet)";
  }
}

async function commandStatus(): Promise<number> {
  const requested = resolvePort();
  const record = await readRecord(requested);
  const port = record?.port ?? requested;
  const serving = await isServing(port);
  const sameInstall = record?.root === ROOT;

  if (record !== undefined && !sameInstall && serving) {
    process.stdout.write(
      `${yellow("●")} A different installation is serving ${consoleUrl(port)}\n`,
    );
    process.stdout.write(`  ${dim("from")} ${record.root ?? "(unknown)"} ${dim(`(pid ${record.pid})`)}\n`);
    process.stdout.write(`  ${dim("This directory is not the one running.")}\n`);
    return 0;
  }

  if (record === undefined) {
    if (serving) {
      // Reachable but unmanaged: worth saying, because `cloviela down` will
      // refuse to touch it and the user should know why.
      process.stdout.write(`${yellow("●")} Serving on ${consoleUrl(port)} ${dim("(not started by cloviela)")}\n`);
      return 0;
    }
    process.stdout.write(`${dim("○")} Not running.\n`);
    return 1;
  }

  const alive = isAlive(record.pid);
  if (alive && serving) {
    process.stdout.write(`${green("●")} Running ${dim(`v${record.version}`)} — ${consoleUrl(port)}\n`);
    process.stdout.write(`  ${dim("pid")} ${record.pid} ${dim("· started")} ${record.startedAt}\n`);
    return 0;
  }
  if (alive && !serving) {
    process.stdout.write(`${yellow("◐")} Process ${record.pid} is alive but not answering on ${port}.\n`);
    process.stdout.write(`  ${dim("Recent log:")}\n${await tailLog(8)}\n`);
    return 1;
  }
  await clearRecord(requested);
  process.stdout.write(`${dim("○")} Not running ${dim("(cleaned up a stale record)")}\n`);
  return 1;
}

async function commandLogs(args: readonly string[]): Promise<number> {
  const follow = args.includes("--follow") || args.includes("-f");
  const countFlag = args.indexOf("--lines");
  const count = countFlag === -1 ? 40 : Number(args[countFlag + 1] ?? 40);
  const lines = Number.isFinite(count) && count > 0 ? Math.trunc(count) : 40;

  const logPort = resolvePort();
  if (!existsSync(logFile(logPort))) {
    process.stdout.write(`${dim("No log yet. Start the gateway with")} cloviela up.\n`);
    return 0;
  }
  if (!follow) {
    process.stdout.write(`${await tailLog(lines)}\n`);
    return 0;
  }
  // `tail -f` is not available everywhere; read and then poll for growth, so
  // the behaviour is identical on macOS, Linux and Windows.
  let shown = 0;
  for (;;) {
    const text = await readFile(logFile(logPort), "utf8");
    const all = text.split(/\r?\n/).filter(Boolean);
    for (const line of all.slice(shown)) process.stdout.write(`${line}\n`);
    shown = all.length;
    await new Promise((r) => setTimeout(r, 500));
  }
}

async function commandUpdate(args: readonly string[]): Promise<number> {
  const restart = !args.includes("--no-restart");
  const wasRunning = (await readRecord()) !== undefined;

  step("Updating Cloviela");
  if (existsSync(join(ROOT, ".git"))) {
    const code = await run(["git", "pull", "--ff-only"]);
    if (code !== 0) {
      warn("Could not fast-forward. You may have local commits; resolve them and re-run.");
      return code;
    }
  } else {
    // A distributed copy has no .git to pull from; the binary is the update.
    warn("No git checkout here — updating from the current files.");
  }

  step("Installing dependencies");
  if ((await run(["bun", "install"])) !== 0) {
    fail("Dependency install failed.");
    return 1;
  }

  step("Rebuilding");
  if ((await run(["bun", "run", "build"])) !== 0) {
    fail("Build failed. The previous binary is untouched; the gateway was not restarted.");
    return 1;
  }

  if (restart && wasRunning) {
    step("Restarting");
    await commandDown();
    return await commandUp(["--no-open"]);
  }
  ok("Updated.");
  if (wasRunning) process.stdout.write(`  ${dim("Restart when ready:")} cloviela restart\n`);
  return 0;
}

async function commandRestart(args: readonly string[]): Promise<number> {
  await commandDown();
  return await commandUp(args);
}

/* ── Help ────────────────────────────────────────────────────────────────── */

const HELP = `
${bold("cloviela")} — your personal AI gateway

${bold("USAGE")}
  cloviela <command> [options]

${bold("COMMANDS")}
  ${cyan("up")}                  Install if needed, build if needed, start, open the console
  ${cyan("down")}                Stop the gateway (drains in-flight requests first)
  ${cyan("restart")}             Stop, then start again
  ${cyan("status")}              Say whether it is running, and where
  ${cyan("logs")}                Show recent output ${dim("(--follow to keep watching)")}
  ${cyan("update")}              Pull, reinstall, rebuild, and restart if it was running
  ${cyan("doctor")}              Check configuration and readiness
  ${cyan("version")}             Print the version
  ${cyan("help")}                Show this

${bold("OPTIONS")}
  --no-open            Do not open a browser ${dim("(up, restart)")}
  --no-restart         Leave it stopped after updating ${dim("(update)")}
  --lines <n>          How many log lines to show ${dim("(logs, default 40)")}

${bold("EXAMPLES")}
  cloviela up                  Start it and open the console
  cloviela up --no-open        Start it on a server with no browser
  cloviela logs --follow       Watch the gateway while you use it
  cloviela update              Get the newest version and keep it running

${bold("WHERE THINGS LIVE")}
  console      ${dim(consoleUrl(resolvePort()))}
  data         ${dim(resolveDataDir())}
  log          ${dim(logFile())}
  config       ${dim(join(ROOT, ".env"))}
`;

async function main(argv: readonly string[]): Promise<number> {
  const command = argv[0] ?? "up";
  const rest = argv.slice(1);

  switch (command) {
    case "up":
    case "start":
      return await commandUp(rest);
    case "down":
    case "stop":
      return await commandDown();
    case "restart":
      return await commandRestart(rest);
    case "status":
      return await commandStatus();
    case "logs":
    case "log":
      return await commandLogs(rest);
    case "update":
      return await commandUpdate(rest);
    case "doctor": {
      const code = await run(["bun", "run", "doctor"]);
      return code;
    }
    case "version":
    case "--version":
    case "-v":
      process.stdout.write(`${VERSION}\n`);
      return 0;
    case "help":
    case "--help":
    case "-h":
      process.stdout.write(HELP);
      return 0;
    default:
      fail(`Unknown command: ${command}`);
      process.stdout.write(HELP);
      return 1;
  }
}

if (import.meta.main) {
  process.exit(await main(process.argv.slice(2)));
}
