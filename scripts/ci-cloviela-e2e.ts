#!/usr/bin/env bun
/**
 * Rikka gateway E2E + GW/SEC/DB/CLI matrix runner.
 *
 * Boots the real production composition in a subprocess, drives it over TCP
 * with a deterministic isolated mock upstream, executes every matrix
 * identifier this host can actually support, and writes sanitized evidence.
 *
 * Usage:
 *   bun run scripts/ci-cloviela-e2e.ts                         # Lite, all dimensions
 *   bun run scripts/ci-cloviela-e2e.ts --store full \
 *       --database-url postgres://postgres@127.0.0.1:5432/rikka_e2e_<unique> \
 *       [--redis-url redis://127.0.0.1:6379/13]
 *   bun run scripts/ci-cloviela-e2e.ts --only GW-00001,CLI-00004
 *   bun run scripts/ci-cloviela-e2e.ts --list                  # print the plan, run nothing
 *
 * Exit codes: 0 when every executed case passed and nothing was left
 * UNVERIFIED for a reason other than an explicit gate; 1 when any case failed;
 * 2 when the run was refused by the safety guard; 3 when the host failed to boot.
 *
 * Safety: the runner refuses to start unless every writable path lives inside
 * one temp root it owns, the database is a uniquely named `rikka_e2e_*`
 * database on loopback, and the Redis index is one reserved for harness runs.
 * See `scripts/internal/cloviela-guard.ts` for the exact rules.
 *
 * Every identifier starts UNVERIFIED. A case is only ever PASS when the
 * assertion matching its own clause ran and held.
 */
import { spawn } from "node:child_process";
import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { randomBytes } from "node:crypto";
import { Client } from "pg";
import {
  assertIsolated,
  childEnvironment,
  createRunRoot,
  GuardRefusal,
  portablePath,
  HARNESS_DB_PREFIX,
} from "./internal/cloviela-guard";
import { startMockUpstream, type MockCall } from "./internal/cloviela-mock-upstream";
import {
  defaultIndexPath,
  HARNESS_DIMENSIONS,
  loadDimension,
  planCase,
  summarizePlan,
  type HarnessDimension,
  type PlanSummary,
  type PlannedCase,
} from "./internal/cloviela-plan";
import { HarnessClient } from "./internal/cloviela-client";
import {
  clientResults,
  dispositionResult,
  runAccountLifecycle,
  runAuthRefusals,
  runBackupRestore,
  runCancellation,
  runConsoleAuthBoundary,
  runCredentialEcho,
  runKeyScopeEnforcement,
  runModelListing,
  runSerializationShape,
  runStreaming,
  runUpstreamFaults,
  runValidSingle,
  setupWorld,
  worldBehaviors,
  type CaseResult,
  type World,
} from "./internal/cloviela-execute";
import {
  ensureWorkDir,
  runClient,
  whichBinary,
  writeOmpProfile,
  writeOpencodeProfile,
  clientEnv,
} from "./internal/cloviela-clients";
import { READY_PREFIX } from "./internal/cloviela-host";

interface Cli {
  readonly store: "lite" | "full";
  readonly databaseUrl: string | undefined;
  readonly redisUrl: string | undefined;
  readonly outDir: string;
  readonly only: ReadonlySet<string> | undefined;
  readonly dimensions: readonly HarnessDimension[];
  readonly list: boolean;
  readonly keepRoot: boolean;
}

function parseArgs(argv: readonly string[]): Cli {
  let store: "lite" | "full" = "lite";
  let databaseUrl: string | undefined;
  let redisUrl: string | undefined;
  let outDir = ".rikka-work/e2e-cloviela";
  let only: Set<string> | undefined;
  let dimensions: readonly HarnessDimension[] = HARNESS_DIMENSIONS;
  let list = false;
  let keepRoot = false;

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    const next = (): string => {
      const value = argv[index + 1];
      if (value === undefined) throw new Error(`--${arg?.replace(/^--/, "")} requires a value`);
      index += 1;
      return value;
    };
    if (arg === "--store") {
      const value = next();
      if (value !== "lite" && value !== "full") throw new Error(`--store must be lite or full (got ${value})`);
      store = value;
    } else if (arg === "--database-url") databaseUrl = next();
    else if (arg === "--redis-url") redisUrl = next();
    else if (arg === "--out") outDir = next();
    else if (arg === "--only") only = new Set(next().split(",").map((id) => id.trim()));
    else if (arg === "--dimensions") {
      const requested = next().split(",").map((name) => name.trim().toUpperCase());
      for (const name of requested) {
        if (!(HARNESS_DIMENSIONS as readonly string[]).includes(name)) {
          throw new Error(`unknown dimension ${name}; expected one of ${HARNESS_DIMENSIONS.join(", ")}`);
        }
      }
      dimensions = requested as readonly HarnessDimension[];
    } else if (arg === "--list") list = true;
    else if (arg === "--keep-root") keepRoot = true;
    else if (arg === "--help" || arg === "-h") {
      process.stdout.write(`${HELP}\n`);
      process.exit(0);
    } else throw new Error(`unknown argument ${arg}`);
  }
  if (store === "full" && databaseUrl === undefined) {
    throw new Error("--store full requires --database-url pointing at a disposable rikka_e2e_* database");
  }
  return { store, databaseUrl, redisUrl, outDir, only, dimensions, list, keepRoot };
}

const HELP = `Rikka gateway E2E matrix runner.

  --store lite|full          which persistence backend to boot (default lite)
  --database-url <url>       required for full; must be loopback and named ${HARNESS_DB_PREFIX}*
  --redis-url <url>          optional; index must be 13 or 14
  --dimensions GW,SEC,DB,CLI which matrix dimensions to plan (default all)
  --only <ids>               execute only these identifiers
  --out <dir>                evidence directory (default .rikka-work/e2e-cloviela)
  --list                     print the resolved plan and exit without executing
  --keep-root                keep the temp run root for inspection`;

/** Creates the disposable PostgreSQL database this run owns. */
async function createDatabase(databaseUrl: string): Promise<void> {
  const url = new URL(databaseUrl);
  const database = decodeURIComponent(url.pathname.replace(/^\//, ""));
  const adminUrl = new URL(databaseUrl);
  adminUrl.pathname = "/postgres";
  const client = new Client({ connectionString: adminUrl.toString() });
  await client.connect();
  try {
    await client.query(`DROP DATABASE IF EXISTS "${database}"`);
    await client.query(`CREATE DATABASE "${database}"`);
  } finally {
    await client.end();
  }
}

/** Drops only the database this run created. */
async function dropDatabase(databaseUrl: string): Promise<void> {
  const url = new URL(databaseUrl);
  const database = decodeURIComponent(url.pathname.replace(/^\//, ""));
  if (!database.startsWith(HARNESS_DB_PREFIX)) return;
  const adminUrl = new URL(databaseUrl);
  adminUrl.pathname = "/postgres";
  const client = new Client({ connectionString: adminUrl.toString() });
  await client.connect();
  try {
    await client.query(`DROP DATABASE IF EXISTS "${database}"`);
  } finally {
    await client.end();
  }
}

interface HostHandle {
  readonly origin: string;
  readonly port: number;
  readonly pid: number;
  readonly stop: () => Promise<void>;
  readonly stderr: () => string;
}

/** Boots the production host subprocess and waits for its ready line. */
async function startHost(
  env: Readonly<Record<string, string>>,
  cwd: string,
  timeoutMs: number,
): Promise<HostHandle> {
  const child = spawn(process.execPath, ["run", join(import.meta.dir, "internal", "cloviela-host.ts")], {
    cwd,
    env: env as NodeJS.ProcessEnv,
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

  const ready = Promise.withResolvers<{ port: number; pid: number }>();
  const deadline = setTimeout(() => ready.reject(new Error(`host did not report ready in ${timeoutMs}ms`)), timeoutMs);
  const poll = setInterval(() => {
    const line = stdout.split("\n").find((entry) => entry.startsWith(READY_PREFIX));
    if (line === undefined) return;
    clearInterval(poll);
    try {
      const parsed = JSON.parse(line.slice(READY_PREFIX.length)) as { port: number; pid: number };
      ready.resolve(parsed);
    } catch (error) {
      ready.reject(new Error(`host ready line was not JSON: ${String(error)}`));
    }
  }, 50);
  child.on("exit", (code) => {
    clearInterval(poll);
    ready.reject(new Error(`host exited with ${code} before ready; stderr tail: ${stderr.slice(-500)}`));
  });

  try {
    const parsed = await ready.promise;
    return {
      origin: `http://127.0.0.1:${parsed.port}`,
      port: parsed.port,
      pid: parsed.pid,
      stop: async () => {
        child.kill("SIGTERM");
        const exited = Promise.withResolvers<void>();
        child.once("exit", () => exited.resolve());
        const kill = setTimeout(() => child.kill("SIGKILL"), 15_000);
        await exited.promise;
        clearTimeout(kill);
      },
      stderr: () => stderr,
    };
  } finally {
    clearTimeout(deadline);
  }
}

interface DimensionOutcome {
  readonly results: readonly CaseResult[];
}

/** Executes one dimension, returning a result for every planned case. */
async function executeDimension(
  dimension: HarnessDimension,
  origin: string,
  world: World,
  cases: readonly PlannedCase[],
  mockCalls: () => readonly MockCall[],
  clients: ReadonlySet<string>,
  fixtureHome: string,
): Promise<DimensionOutcome> {
  const executable = cases.filter((entry) => entry.disposition === undefined);
  const results: CaseResult[] = cases
    .filter((entry) => entry.disposition !== undefined)
    .map((entry) => dispositionResult(entry));

  const byFault = (fault: string): readonly PlannedCase[] =>
    executable.filter((entry) => entry.axes["fault"] === fault);
  const byProtocol = (protocol: string): readonly PlannedCase[] =>
    executable.filter((entry) => entry.axes["protocol"] === protocol);

  const claimed = new Set<string>();
  const claim = (produced: readonly CaseResult[]): void => {
    for (const item of produced) {
      claimed.add(item.id);
      results.push(item);
    }
  };

  if (dimension === "GW") {
    for (const protocol of ["chat", "responses", "messages"] as const) {
      const single = byProtocol(protocol).filter((entry) => entry.axes["fault"] === "valid-single");
      if (single.length > 0) {
        claim(await runValidSingle(origin, world, protocol, single));
        claim(await runSerializationShape(origin, world, protocol, single, mockCalls));
        claim(await runStreaming(origin, world, protocol, single));
      }
    }
    claim(await runModelListing(origin, world, byProtocol("models").filter((e) => e.axes["fault"] === "valid-single"), mockCalls));
    claim(await runAuthRefusals(origin, world, executable.filter((e) => ["bad-key", "revoked-key"].includes(e.axes["fault"] ?? "")), mockCalls));
    claim(await runUpstreamFaults(origin, world, executable.filter((e) => ["upstream-429", "upstream-500", "malformed-json"].includes(e.axes["fault"] ?? "")), mockCalls));
    claim(await runCancellation(origin, world, byFault("client-cancel"), mockCalls));
    // The credential-echo regression is its own family: every secret-leak case
    // in GW is credited only by this execution.
    claim(await runCredentialEcho(origin, world, executable.filter((e) => e.axes["fault"] === "injected-header")));
  } else if (dimension === "SEC") {
    const boundary = executable.filter((entry) => entry.axes["trust-boundary"] === "console-auth");
    if (boundary.length > 0) {
      claim(
        await runConsoleAuthBoundary(
          origin,
          world,
          boundary.filter((entry) => ["unauthorized", "replay"].includes(entry.axes["attack"] ?? "")),
        ),
      );
    }
    const keyBoundary = executable.filter((entry) => entry.axes["trust-boundary"] === "api-key");
    if (keyBoundary.length > 0) {
      claim(
        await runKeyScopeEnforcement(
          origin,
          world,
          keyBoundary.filter((entry) => entry.axes["attack"] === "unauthorized"),
        ),
      );
    }
  } else if (dimension === "DB") {
    const account = executable.filter((entry) => entry.axes["entity"] === "provider-account");
    if (account.length > 0) claim(await runAccountLifecycle(world, account));
    const backup = executable.filter((entry) => entry.axes["entity"] === "backup");
    if (backup.length > 0) claim(await runBackupRestore(origin, world, backup, mockCalls));
  } else {
    // CLI: only the binaries actually present on this host.
    const fixture = {
      origin,
      apiKey: world.keys.get("gateway") ?? "",
      modelIds: [world.models.chat],
      homeRoot: join(fixtureHome, "clients"),
      workDir: join(fixtureHome, "clients", "work"),
    };
    ensureWorkDir(fixture);
    for (const clientName of ["omp", "opencode", "curl"]) {
      if (!clients.has(clientName)) continue;
      const clientCases = executable.filter((entry) => entry.axes["client"] === clientName);
      if (clientCases.length === 0) continue;
      const before = mockCalls().length;
      let outcome: { exitCode: number; stdout: string; stderr: string };
      if (clientName === "omp") {
        writeOmpProfile(fixture, "cartethyia");
        outcome = await runClient({
          command: ["omp", "-p", "--no-tools", "--model", `cartethyia/${world.models.chat}`, "Reply with the single word: ok"],
          cwd: fixture.workDir,
          env: clientEnv(fixture, {}),
          timeoutMs: 120_000,
        });
      } else if (clientName === "opencode") {
        writeOpencodeProfile(fixture, "cartethyia");
        outcome = await runClient({
          command: ["opencode", "run", "--standalone", "--model", `cartethyia/${world.models.chat}`, "Reply with the single word: ok"],
          cwd: fixture.workDir,
          env: clientEnv(fixture, { CARTETHYIA_E2E_KEY: fixture.apiKey }),
          timeoutMs: 120_000,
        });
      } else {
        outcome = await runClient({
          command: [
            "curl",
            "-sS",
            "-o",
            "/dev/null",
            "-w",
            "%{http_code}",
            "-X",
            "POST",
            `${origin}/v1/chat/completions`,
            "-H",
            `authorization: Bearer ${fixture.apiKey}`,
            "-H",
            "content-type: application/json",
            "-d",
            JSON.stringify({ model: `${world.providers.chat}/${world.models.chat}`, messages: [{ role: "user", content: "ping" }], max_tokens: 16 }),
          ],
          cwd: fixture.workDir,
          env: clientEnv(fixture, {}),
          timeoutMs: 60_000,
        });
        outcome = { ...outcome, exitCode: outcome.stdout.trim() === "200" ? 0 : outcome.exitCode };
      }
      const calls = mockCalls().slice(before);
      claim(
        clientResults(
          { client: clientName, command: [], exitCode: outcome.exitCode, stdout: outcome.stdout, stderr: outcome.stderr },
          clientCases,
          () => calls,
        ),
      );
    }
  }

  // Anything executable that no family claimed is reported honestly rather
  // than silently dropped: an unclaimed case stays UNVERIFIED.
  for (const entry of executable) {
    if (claimed.has(entry.id)) continue;
    results.push({
      id: entry.id,
      status: "UNVERIFIED",
      detail: "no scenario family in this run covers this case",
      asserted: "none",
    });
  }
  return { results };
}

/** Writes sanitized JSON, JUnit XML and a per-case trace file. */
function writeEvidence(
  outDir: string,
  root: string,
  results: readonly CaseResult[],
  plan: PlanSummary,
  meta: Readonly<Record<string, unknown>>,
): void {
  mkdirSync(outDir, { recursive: true });
  const portableResults = results.map((entry) => ({
    id: entry.id,
    status: entry.status,
    detail: entry.detail,
    asserted: entry.asserted,
    ...(entry.blockedReason === undefined ? {} : { blockedReason: entry.blockedReason }),
    trace: (entry.trace ?? []).map((exchange) => ({
      label: exchange.label,
      method: exchange.method,
      path: exchange.path,
      status: exchange.status,
      requestId: exchange.requestId,
      contentType: exchange.contentType,
      bodyBytes: exchange.bodyBytes,
      bodyExcerpt: exchange.bodyExcerpt,
      setCookieNames: exchange.setCookieNames,
      durationMs: exchange.durationMs,
      ...(exchange.sseEvents === undefined ? {} : { sseEvents: exchange.sseEvents }),
      ...(exchange.aborted === undefined ? {} : { aborted: exchange.aborted }),
    })),
    ...(entry.mockCalls === undefined
      ? {}
      : {
          mockCalls: entry.mockCalls.map((call) => ({
            seq: call.seq,
            method: call.method,
            path: call.path,
            wire: call.wire,
            authHeader: call.authHeader,
            model: call.model,
            stream: call.stream,
            rawBodyBytes: call.rawBodyBytes,
            clientAborted: call.clientAborted,
          })),
        }),
  }));
  writeFileSync(
    join(outDir, "results.json"),
    `${JSON.stringify({ meta, summary: plan.byStatus, byDimension: plan.byDimension, results: portableResults }, null, 2)}\n`,
  );
  writeFileSync(
    join(outDir, "plan.json"),
    `${JSON.stringify({ summary: plan.byStatus, byDimension: plan.byDimension, dispositions: plan.dispositions }, null, 2)}\n`,
  );
  const failures = results.filter((entry) => entry.status === "FAIL").length;
  const cases = results
    .map((entry) => {
      const detail = entry.detail.replace(/[<>&]/g, (char) => ({ "<": "&lt;", ">": "&gt;", "&": "&amp;" })[char] ?? char);
      if (entry.status === "PASS") return `    <testcase name="${entry.id}" classname="${entry.id.split("-")[0]}"/>`;
      if (entry.status === "FAIL") {
        return `    <testcase name="${entry.id}" classname="${entry.id.split("-")[0]}"><failure message="${detail}"/></testcase>`;
      }
      if (entry.status === "BLOCKED") {
        return `    <testcase name="${entry.id}" classname="${entry.id.split("-")[0]}"><skipped message="BLOCKED: ${detail}"/></testcase>`;
      }
      return `    <testcase name="${entry.id}" classname="${entry.id.split("-")[0]}"><skipped message="${entry.status}: ${detail}"/></testcase>`;
    })
    .join("\n");
  writeFileSync(
    join(outDir, "junit.xml"),
    `<?xml version="1.0" encoding="UTF-8"?>\n<testsuite name="rikka-e2e" tests="${results.length}" failures="${failures}">\n${cases}\n</testsuite>\n`,
  );
  writeFileSync(
    join(outDir, "run.json"),
    `${JSON.stringify({ ...meta, runRoot: portablePath(root, root) }, null, 2)}\n`,
  );
}

async function main(): Promise<number> {
  const cli = parseArgs(process.argv.slice(2));
  const root = createRunRoot("run");
  const dataDir = join(root, "data");
  const installIdDir = join(root, "install-id");
  const telemetryDir = join(root, "telemetry");
  for (const dir of [dataDir, installIdDir, telemetryDir, join(root, "home"), join(root, "tmp")]) {
    mkdirSync(dir, { recursive: true });
  }

  try {
    assertIsolated({
      root,
      dataDir,
      installIdDir,
      telemetryDir,
      databaseUrl: cli.databaseUrl,
      redisUrl: cli.redisUrl,
      dbMode: cli.store,
    });
  } catch (error) {
    if (error instanceof GuardRefusal) {
      process.stderr.write(`${error.message}\n`);
      rmSync(root, { recursive: true, force: true });
      return 2;
    }
    throw error;
  }

  // Build the plan before booting anything, so --list is free and a refused
  // invocation costs nothing.
  const index = defaultIndexPath();
  const [ompPath, opencodePath, curlPath] = await Promise.all([
    whichBinary("omp"),
    whichBinary("opencode"),
    whichBinary("curl"),
  ]);
  const clients = new Set<string>();
  if (ompPath !== undefined) clients.add("omp");
  if (opencodePath !== undefined) clients.add("opencode");
  if (curlPath !== undefined) clients.add("curl");

  const planned: PlannedCase[] = [];
  for (const dimension of cli.dimensions) {
    for (const entry of loadDimension(index, dimension)) {
      if (cli.only !== undefined && !cli.only.has(entry.id)) continue;
      planned.push(planCase(dimension, entry, { clients, hasFullStore: cli.databaseUrl !== undefined, hasRedis: cli.redisUrl !== undefined }));
    }
  }
  const plan = summarizePlan(planned);

  if (cli.list) {
    process.stdout.write(
      `${JSON.stringify(
        {
          total: plan.total,
          byStatus: plan.byStatus,
          byDimension: plan.byDimension,
          dispositionSample: plan.dispositions.slice(0, 5),
          clients: [...clients],
        },
        null,
        2,
      )}\n`,
    );
    rmSync(root, { recursive: true, force: true });
    return 0;
  }

  process.stdout.write(
    `planned ${plan.total} cases: ${Object.entries(plan.byStatus).map(([k, v]) => `${k}=${v}`).join(" ")}\n`,
  );

  const mock = startMockUpstream({ behaviors: {} });
  let host: HostHandle | undefined;
  const results: CaseResult[] = [];
  let exitCode = 0;

  try {
    if (cli.store === "full" && cli.databaseUrl !== undefined) await createDatabase(cli.databaseUrl);

    const encryptionKey = randomBytes(32).toString("hex");
    const password = `e2e-${randomBytes(8).toString("hex")}`;
    const env = childEnvironment({
      root,
      dataDir,
      installIdDir,
      telemetryDir,
      encryptionKey,
      port: 0,
      publicOrigin: "http://127.0.0.1:0",
      nodeEnv: "test",
      extra: {
        ...(cli.databaseUrl === undefined ? {} : { DATABASE_URL: cli.databaseUrl }),
        ...(cli.redisUrl === undefined ? {} : { REDIS_URL: cli.redisUrl }),
        CARTETHYIA_DB_MODE: cli.store,
      },
    });
    host = await startHost(env, process.cwd(), 180_000);
    process.stdout.write(`host ready on ${host.origin} (pid ${host.pid})\n`);

    const consoleClient = new HarnessClient(host.origin);
    const world = await setupWorld({
      console: consoleClient,
      mockUrl: mock.url,
      mockPort: mock.port,
      store: cli.store,
      password,
      runLabel: `${cli.store}-${process.pid}`,
    });
    process.stdout.write(
      `world ready: providers ${world.providers.chat}/${world.providers.responses}/${world.providers.messages}\n`,
    );

    // The mock must answer the world's model ids with their intended
    // behaviors. They are only known now, because the console API minted them,
    // so the live server's map is replaced rather than the server restarted —
    // the provider rows already point at this port.
    mock.setBehaviors(worldBehaviors(world));

    const mockCalls = (): readonly MockCall[] => mock.calls;
    for (const dimension of cli.dimensions) {
      const dimensionCases = planned.filter((entry) => entry.dimension === dimension);
      if (dimensionCases.length === 0) continue;
      const outcome = await executeDimension(
        dimension,
        host.origin,
        world,
        dimensionCases,
        mockCalls,
        clients,
        join(root, "fixtures"),
      );
      results.push(...outcome.results);
      const dimensionFailures = outcome.results.filter((entry) => entry.status === "FAIL").length;
      process.stdout.write(`${dimension}: ${outcome.results.length} cases, ${dimensionFailures} failed\n`);
    }
  } catch (error) {
    process.stderr.write(`run aborted: ${String(error)}\n`);
    if (host !== undefined) process.stderr.write(`host stderr tail:\n${host.stderr().slice(-2_000)}\n`);
    exitCode = 3;
  } finally {
    if (host !== undefined) await host.stop().catch(() => undefined);
    await mock.stop().catch(() => undefined);
    if (cli.store === "full" && cli.databaseUrl !== undefined) {
      await dropDatabase(cli.databaseUrl).catch((error: unknown) => {
        process.stderr.write(`could not drop the disposable database: ${String(error)}\n`);
      });
    }
  }

  const finalPlan = summarizePlan(planned);
  writeEvidence(cli.outDir, root, results, finalPlan, {
    store: cli.store,
    dimensions: cli.dimensions,
    clients: [...clients],
    startedAt: new Date().toISOString(),
    bunVersion: Bun.version,
    platform: `${process.platform}-${process.arch}`,
  });

  const failed = results.filter((entry) => entry.status === "FAIL");
  const passed = results.filter((entry) => entry.status === "PASS");
  process.stdout.write(
    `\nexecuted ${results.length}: PASS ${passed.length}, FAIL ${failed.length}, ` +
      `BLOCKED ${results.filter((e) => e.status === "BLOCKED").length}, ` +
      `NA ${results.filter((e) => e.status === "NA").length}, ` +
      `UNVERIFIED ${results.filter((e) => e.status === "UNVERIFIED").length}\n`,
  );
  process.stdout.write(`evidence written to ${cli.outDir}\n`);
  for (const entry of failed.slice(0, 20)) {
    process.stdout.write(`FAIL ${entry.id}: ${entry.detail}\n`);
  }

  if (!cli.keepRoot) rmSync(root, { recursive: true, force: true });
  if (exitCode !== 0) return exitCode;
  return failed.length > 0 ? 1 : 0;
}

try {
  process.exit(await main());
} catch (error) {
  process.stderr.write(`${String(error)}\n`);
  process.exit(3);
}
