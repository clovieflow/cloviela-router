/**
 * Third-party client runners for the Rikka E2E harness.
 *
 * Each runner writes an isolated profile under the run root, invokes the real
 * installed binary or SDK, and captures its exit status. Nothing here touches
 * `~/.omp`, `~/.config/opencode` or any developer credential store: the child
 * environment replaces HOME and every XDG variable, and the harness refuses to
 * proceed if a required binary is absent rather than substituting a
 * hand-rolled request and calling it client evidence.
 *
 * Verified against the installed versions on this host:
 *   omp 18.8.4      — config at `$HOME/.omp/agent/models.yml`
 *   opencode 2.0.22 — config at `$XDG_CONFIG_HOME/opencode/opencode.json`
 */
import { spawn } from "node:child_process";
import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { clientEnvironment } from "./cloviela-guard";

export interface ClientInvocation {
  readonly command: readonly string[];
  readonly cwd: string;
  readonly env: Readonly<Record<string, string>>;
  readonly timeoutMs: number;
}

export interface ClientOutcome {
  readonly exitCode: number;
  readonly stdout: string;
  readonly stderr: string;
  readonly timedOut: boolean;
}

/**
 * Runs one client command with a hard timeout. A timed-out client is killed and
 * reported as a timeout rather than a pass, because a client that never
 * finished proves nothing about interoperability.
 */
export async function runClient(invocation: ClientInvocation): Promise<ClientOutcome> {
  const child = spawn(invocation.command[0]!, invocation.command.slice(1), {
    cwd: invocation.cwd,
    env: invocation.env as NodeJS.ProcessEnv,
    stdio: ["ignore", "pipe", "pipe"],
  });
  let stdout = "";
  let stderr = "";
  child.stdout.on("data", (chunk: Buffer) => {
    stdout += chunk.toString("utf8");
  });
  child.stderr.on("data", (chunk: Buffer) => {
    stderr += chunk.toString("utf8");
  });
  const exited = Promise.withResolvers<number>();
  child.on("error", (error) => {
    stderr += String(error);
    exited.resolve(-1);
  });
  child.on("close", (code) => exited.resolve(code ?? -1));

  let timedOut = false;
  const timer = setTimeout(() => {
    timedOut = true;
    child.kill("SIGKILL");
  }, invocation.timeoutMs);
  const exitCode = await exited.promise;
  clearTimeout(timer);
  return { exitCode, stdout, stderr, timedOut };
}

/** Locates a binary on PATH without executing it. */
export async function whichBinary(name: string): Promise<string | undefined> {
  const finder = process.platform === "win32" ? "where" : "which";
  const outcome = await runClient({
    command: [finder, name],
    cwd: process.cwd(),
    env: { ...process.env } as Record<string, string>,
    timeoutMs: 5_000,
  });
  if (outcome.exitCode !== 0) return undefined;
  const first = outcome.stdout.split("\n")[0]?.trim();
  return first !== undefined && first.length > 0 ? first : undefined;
}

export interface ClientFixture {
  /** Gateway origin the client should call. */
  readonly origin: string;
  /** Gateway API key the client authenticates with. */
  readonly apiKey: string;
  /** Model ids the client may select, in preference order. */
  readonly modelIds: readonly string[];
  /** Directory the client writes its isolated profile into. */
  readonly homeRoot: string;
  /** Working directory for the client process. */
  readonly workDir: string;
}

/**
 * Writes the OMP profile that points at the gateway.
 *
 * Shape confirmed against the installed 18.8.4 binary: `providers.<id>` needs
 * an `api` discriminator, and `models` is a list of `{id, name}`.
 */
export function writeOmpProfile(fixture: ClientFixture, providerId: string): string {
  const agentDir = join(fixture.homeRoot, "home", ".omp", "agent");
  mkdirSync(agentDir, { recursive: true });
  const path = join(agentDir, "models.yml");
  const lines = [
    "providers:",
    `  ${providerId}:`,
    "    api: openai-completions",
    `    defaultModel: ${fixture.modelIds[0] ?? "unset"}`,
    `    baseUrl: ${fixture.origin}/v1`,
    `    apiKey: ${fixture.apiKey}`,
    "    models:",
    ...fixture.modelIds.map((id) => `      - id: ${id}\n        name: ${id}`),
    "",
  ];
  writeFileSync(path, lines.join("\n"), { mode: 0o600 });
  return path;
}

/**
 * Writes the OpenCode profile that points at the gateway.
 *
 * Shape confirmed against the installed 2.0.22 binary: this is the V2
 * configuration (`providers`, `package`, `settings.baseURL`), which differs
 * from the V1 `provider`/`npm`/`options` shape documented for older releases.
 */
export function writeOpencodeProfile(fixture: ClientFixture, providerId: string): string {
  const configDir = join(fixture.homeRoot, "home", ".config", "opencode");
  mkdirSync(configDir, { recursive: true });
  const path = join(configDir, "opencode.json");
  const models: Record<string, { name: string }> = {};
  for (const id of fixture.modelIds) models[id] = { name: id };
  const config = {
    $schema: "https://opencode.ai/config.json",
    providers: {
      [providerId]: {
        name: "Cloviela E2E",
        env: ["CLOVIELA_E2E_KEY"],
        package: "@opencode/ai/providers/openai-compatible",
        settings: { baseURL: `${fixture.origin}/v1` },
        models,
      },
    },
    model: `${providerId}/${fixture.modelIds[0] ?? "unset"}`,
  };
  writeFileSync(path, `${JSON.stringify(config, null, 2)}\n`, { mode: 0o600 });
  return path;
}

/**
 * Environment for a client process. `extra` carries the fixture API key under
 * the name the client's own config references — never the gateway's encryption
 * key, which stays in the host process only.
 */
export function clientEnv(fixture: ClientFixture, extra: Readonly<Record<string, string>>): Record<string, string> {
  mkdirSync(join(fixture.homeRoot, "tmp"), { recursive: true });
  return clientEnvironment({
    root: fixture.homeRoot,
    homeRoot: fixture.homeRoot,
    port: 0,
    publicOrigin: fixture.origin,
    nodeEnv: "test",
    extra,
  });
}

/** Ensures the client's working directory exists before it is used as `cwd`. */
export function ensureWorkDir(fixture: ClientFixture): void {
  mkdirSync(fixture.workDir, { recursive: true });
  mkdirSync(dirname(fixture.workDir), { recursive: true });
}
