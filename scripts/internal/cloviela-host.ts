/**
 * Production gateway host for the Rikka E2E harness.
 *
 * Runs as its own process so the harness exercises the real composition
 * (`bootstrap()` → `buildProductionDeps()` → `createGatewayApp()` → `listen`)
 * rather than a reduced test router. The process is also the isolation
 * boundary: `HOME`, the data directory and the database are already fixed by
 * the time this module's imports evaluate, because the parent set them in the
 * child environment before spawning.
 *
 * Contract with the parent: this process writes exactly one JSON line to
 * stdout prefixed with `RIKKA_HOST_READY `, and only after readiness actually
 * passes over TCP. Anything else on stdout is a protocol violation the parent
 * reports as a boot failure.
 */
import { createGatewayApp } from "../../src/app";
import { bootstrap } from "../../src/runtime/lifecycle";
import { getDbHandle } from "../../src/persistence/postgres";
import {
  resolveBindHost,
  resolveMaxBodyBytes,
  resolveIdleTimeout,
  resolveUpstreamTimeoutMs,
  resolveStreamStallTimeoutMs,
} from "../../src/config";

/** Prefix the parent parses. Kept literal so both sides cannot drift. */
export const READY_PREFIX = "RIKKA_HOST_READY ";

interface ReadyLine {
  readonly port: number;
  readonly hostname: string;
  readonly pid: number;
  readonly dbMode: "lite" | "full";
  readonly redis: boolean;
}

/**
 * Polls the gateway's own readiness route until it reports ready or the
 * budget elapses. The parent's instruction is explicit: probe readiness on the
 * printed port rather than trusting an immediate `server.port` read, because
 * the listener's bound address is not guaranteed to be populated synchronously.
 */
async function waitForReady(origin: string, budgetMs: number): Promise<boolean> {
  const deadline = Date.now() + budgetMs;
  let lastDetail = "no attempt";
  while (Date.now() < deadline) {
    try {
      const response = await fetch(`${origin}/health/ready`, { signal: AbortSignal.timeout(2_000) });
      const body: unknown = await response.json().catch(() => undefined);
      if (response.ok) return true;
      lastDetail = `HTTP ${response.status} ${JSON.stringify(body).slice(0, 200)}`;
    } catch (error) {
      lastDetail = String(error);
    }
    const pause = Promise.withResolvers<void>();
    setTimeout(pause.resolve, 100);
    await pause.promise;
  }
  process.stderr.write(`readiness did not pass within ${budgetMs}ms; last: ${lastDetail}\n`);
  return false;
}

/**
 * Resolves the bound port from the listener Elysia returns.
 *
 * Elysia's `listen()` hands back the app instance, not Bun's `Server`: the
 * bound port lives on `app.server.port`, and `app.port` is `undefined`. Reading
 * the wrong one is why every harness run aborted with "listener did not expose
 * a bound port" — the gateway had started and was serving, but the harness
 * could not learn the port and refused to continue. Both shapes are accepted
 * so a future Elysia that forwards `port` keeps working.
 *
 * Reads are narrowed rather than cast: the listener shape differs between
 * Elysia versions, so asserting one would be a silent lie on the other.
 */
function boundPort(listener: unknown): number | undefined {
  if (typeof listener !== "object" || listener === null) return undefined;
  if ("port" in listener) {
    const direct = listener.port;
    if (typeof direct === "number" && Number.isInteger(direct)) return direct;
  }
  if (!("server" in listener)) return undefined;
  const server = listener.server;
  if (typeof server !== "object" || server === null || !("port" in server)) return undefined;
  const nested = server.port;
  return typeof nested === "number" && Number.isInteger(nested) ? nested : undefined;
}

export async function runHost(): Promise<void> {
  const boot = await bootstrap();
  const app = createGatewayApp({
    mode: "production",
    db: boot.deps.db,
    proxyPreparer: boot.deps.proxyPreparer,
    resolveProviderAdapter: boot.deps.resolveProviderAdapter,
    byokUpstreamHosts: boot.deps.byokUpstreamHosts,
    networkBindingFactory: boot.deps.networkBindingFactory,
    ipAbuseProtection: boot.deps.ipAbuseProtection,
    trustedProxyBoundary: boot.deps.trustedProxyBoundary,
    poolSelector: boot.deps.poolSelector,
    snapshotService: boot.deps.snapshotService,
    readiness: boot.deps.readiness,
    telemetryBuffer: boot.deps.telemetryBuffer,
    resolveOAuthRefresher: boot.deps.resolveOAuthRefresher,
    oauthRefreshService: boot.deps.oauthRefreshService,
    modelStrikes: boot.deps.modelStrikes,
    maxBodyBytes: resolveMaxBodyBytes(),
    scheduledTasks: boot.deps.scheduledTasks,
    shutdownCoordinator: boot.shutdownCoordinator,
    // Mirrors `src/main.ts` exactly. The access resolver stays undefined so
    // there is no implicit console principal; every console request must
    // present a real session cookie or a scoped bearer key.
    consoleApi: {
      db: boot.deps.db,
      accessResolver: () => undefined,
      routeSnapshotService: boot.deps.snapshotService,
      poolSelector: boot.deps.poolSelector,
      telemetryBuffer: boot.deps.telemetryBuffer,
      providerRegistry: boot.deps.providerRegistry,
      bundledModelCatalog: boot.deps.bundledModelCatalog,
      networkBindingFactory: boot.deps.networkBindingFactory,
      redis: boot.deps.redis,
      oauthRefreshService: boot.deps.oauthRefreshService,
      admissionService: boot.deps.admissionService,
      modelStrikes: boot.deps.modelStrikes,
      readRoutingAccountInflight: boot.deps.readRoutingAccountInflight,
    },
  });

  const port = Number(process.env["PORT"] ?? "0");
  const server = app.listen({
    port,
    hostname: resolveBindHost(),
    idleTimeout: resolveIdleTimeout(),
    reusePort: false,
    maxRequestBodySize: resolveMaxBodyBytes(),
  });
  boot.server = server;

  const actualPort = boundPort(server);
  if (actualPort === undefined) {
    process.stderr.write("listener did not expose a bound port\n");
    process.exit(2);
  }
  const hostname = resolveBindHost();
  const origin = `http://${hostname}:${actualPort}`;
  // A budget derived from the configured upstream deadline keeps a slow host
  // from being reported as a readiness failure on a machine where the first
  // migration genuinely takes a while.
  const readyBudgetMs = Math.max(30_000, resolveUpstreamTimeoutMs() + resolveStreamStallTimeoutMs());
  if (!(await waitForReady(origin, readyBudgetMs))) {
    process.exit(3);
  }

  // Schedulers start only after the listener serves traffic, matching main.ts.
  boot.deps.scheduledTasks.start();

  const line: ReadyLine = {
    port: actualPort,
    hostname,
    pid: process.pid,
    dbMode: getDbHandle().kind === "pglite" ? "lite" : "full",
    redis: boot.deps.redis !== undefined,
  };
  process.stdout.write(`${READY_PREFIX}${JSON.stringify(line)}\n`);

  const shutdown = async (signal: string): Promise<void> => {
    process.stderr.write(`[host] ${signal} received, draining\n`);
    try {
      await boot.shutdownCoordinator.begin("SIGTERM");
    } finally {
      process.exit(0);
    }
  };
  process.on("SIGTERM", () => void shutdown("SIGTERM"));
  process.on("SIGINT", () => void shutdown("SIGINT"));
}

if (import.meta.main) {
  await runHost();
}
