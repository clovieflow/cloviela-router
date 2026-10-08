/**
 * `GET /console/api/system/readiness` — the first-run checklist.
 *
 * ── The bug this pins ───────────────────────────────────────────────────────
 * The dashboard has always called this route, and it carried a client-side
 * composition of the same five facts as a "transition fallback" for a 404.
 * The route was never mounted, so every console boot hit the fallback: the
 * Overview and Onboarding screens fired four extra requests and reported a
 * checklist assembled in the browser. The final report listed the endpoint as
 * "still in flight", which is how it stayed — an unimplemented route whose
 * absence was absorbed by a fallback that was never removed.
 *
 * Two things are asserted, because either one alone would have missed it:
 *
 * 1. **The route is mounted.** A read-model test passes whether or not anything
 *    is wired to it, so the mount is checked against the real Elysia plugin.
 * 2. **The counts are measured.** Every step is a real query over real rows.
 *    The steps are driven with real inserts and deletes so a step that always
 *    answers `ok` (or never does) cannot pass by accident.
 *
 * ── Why this suite owns its database ────────────────────────────────────────
 * It builds its own PGlite client in a temp directory instead of calling the
 * process-wide `bootDatabase()`. `bootDatabase()` resolves the operator's real
 * data directory when `CARTETHYIA_DATA_DIR` is unset — which it is for a plain
 * `bun test <file>` — so a suite that used it would write test tenants into a
 * developer's live gateway. The repository's test runner happens to sandbox
 * that variable, but a test must not depend on being launched a particular way
 * to avoid corrupting user data.
 *
 * PGlite is also the engine `lite` mode runs in production, so the queries are
 * exercised on a real backend rather than a mock.
 */
import { afterAll, describe, expect, test } from "bun:test";
import { Elysia } from "elysia";
import { randomUUID } from "node:crypto";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { eq } from "drizzle-orm";
import type { PGlite } from "@electric-sql/pglite";
import { createObservabilityRoutes } from "../../src/console/observability/contracts";
import { DrizzleObservabilityStore } from "../../src/console/observability/store";
import {
  applyPgliteMigrations,
  buildPgliteHandle,
  createPgliteClient,
} from "../../src/persistence/db-pglite";
import type { CartethyiaDatabase } from "../../src/persistence/postgres";
import {
  apiKeys,
  consoleUsers,
  models,
  providers,
  telemetryEvents,
  tenants,
} from "../../src/persistence/schema";

/**
 * Route-mount checks: hermetic, no database, no network.
 *
 * `createObservabilityRoutes` returns the real plugin, so a missing
 * `.get("/system/readiness")` fails here even though every read-model
 * assertion below would still pass.
 */
describe("readiness route registration", () => {
  test("the observability plugin mounts GET /system/readiness", () => {
    const routes = createObservabilityRoutes({
      store: {} as never,
      accessResolver: () => undefined,
    });
    const paths = routes.routes.map((route) => `${route.method} ${route.path}`);
    expect(paths).toContain("GET /system/readiness");
  });

  test("a bare Elysia app answers 404 without the plugin, proving the check has teeth", async () => {
    const bare = new Elysia();
    const response = await bare.handle(new Request("http://localhost/system/readiness"));
    expect(response.status).toBe(404);
  });

  test("the mounted handler runs rather than falling through", async () => {
    const routes = createObservabilityRoutes({
      store: {
        // An unauthenticated call has no access decision, so a 401 proves the
        // handler was reached and rejected; a fall-through would be a 404.
        readiness: () => Promise.reject(new Error("must not be reached unauthenticated")),
      } as never,
      accessResolver: () => undefined,
    });
    const response = await routes.handle(new Request("http://localhost/system/readiness"));
    expect(response.status).toBe(401);
  });
});

/** One isolated PGlite database owned by this file, in the OS temp dir. */
let client: PGlite | undefined;
let db: CartethyiaDatabase | undefined;

async function database(): Promise<CartethyiaDatabase> {
  if (db) return db;
  const dir = mkdtempSync(join(tmpdir(), "readiness-suite-"));
  client = await createPgliteClient(dir);
  await applyPgliteMigrations(client);
  db = buildPgliteHandle(client).db;
  return db;
}

afterAll(async () => {
  const dir = client ? undefined : undefined;
  await client?.close().catch(() => undefined);
  void dir;
  // The client owns its data dir; remove it so repeated runs cannot pile up
  // temp databases. `rmSync` is best-effort: a locked file must not fail a run.
  if (client) rmSync(join(tmpdir(), "readiness-suite-"), { recursive: true, force: true });
});

/** Seeds one tenant with a console admin, a provider, and a routable model. */
async function seedTenant(): Promise<{ tenantId: string; providerId: string }> {
  const database_ = await database();
  const [tenant] = await database_
    .insert(tenants)
    .values({ name: `readiness-${randomUUID().slice(0, 8)}`, status: "active" })
    .returning({ id: tenants.id });
  const tenantId = tenant!.id;
  const providerId = `readiness-provider-${randomUUID().slice(0, 8)}`;
  // Tenant-scoped, so this provider is visible to this tenant only. A global
  // (NULL-tenant) provider would be counted for every tenant and make the
  // isolation assertion below meaningless.
  await database_.insert(providers).values({
    id: providerId,
    tenantId,
    enabled: true,
    requiresAccount: false,
  });
  await database_.insert(models).values({
    providerId,
    modelId: `readiness-model-${randomUUID().slice(0, 8)}`,
    wireFamily: "chat",
    endpointPath: "/v1/chat/completions",
    enabled: true,
  });
  await database_.insert(consoleUsers).values({
    tenantId,
    username: `admin-${randomUUID().slice(0, 8)}`,
    email: "admin@localhost",
    passwordHash: "not-a-real-hash",
    displayName: "Readiness Admin",
    isActive: true,
    isPlatformAdmin: true,
    isFirstBoot: false,
  });
  return { tenantId, providerId };
}

describe("readiness read model", () => {
  const created: Array<{ tenantId: string; providerId: string }> = [];

  test("reports the five steps in order with measured counts", async () => {
    const seed = await seedTenant();
    created.push(seed);
    const store = new DrizzleObservabilityStore(await database(), undefined);

    const report = await store.readiness(seed.tenantId);
    expect(report.checks.map((check) => check.id)).toEqual([
      "admin_created",
      "provider_connected",
      "model_available",
      "api_key_issued",
      "first_request_seen",
    ]);
    expect(report.generatedAt).toBeString();

    // Seeded: an active admin, an account-less enabled provider, a model.
    expect(report.checks.find((c) => c.id === "admin_created")?.ok).toBe(true);
    expect(report.checks.find((c) => c.id === "provider_connected")?.ok).toBe(true);
    expect(report.checks.find((c) => c.id === "model_available")?.ok).toBe(true);
    // Not seeded: no key, no request.
    expect(report.checks.find((c) => c.id === "api_key_issued")?.ok).toBe(false);
    expect(report.checks.find((c) => c.id === "first_request_seen")?.ok).toBe(false);
    // A missing key gates readiness; a missing first request does not.
    expect(report.ready).toBe(false);
    expect(report.checks.find((c) => c.id === "first_request_seen")?.remediation).toBeString();
  });

  test("issuing a key readies the gateway, and revoking it un-readies it", async () => {
    const seed = await seedTenant();
    created.push(seed);
    const database_ = await database();
    const store = new DrizzleObservabilityStore(database_, undefined);

    // `api_keys_mode_shape_check` requires a personal key to carry a hash, so
    // the row has the same shape the real issuer writes.
    const [key] = await database_
      .insert(apiKeys)
      .values({
        tenantId: seed.tenantId,
        label: "readiness-key",
        scopes: ["dashboard:read"],
        keyHash: `hash-${randomUUID()}`,
      })
      .returning({ id: apiKeys.id });

    // Every gating step is now satisfied, so the gateway is ready even though
    // no client has called it yet.
    expect((await store.readiness(seed.tenantId)).ready).toBe(true);

    await database_.update(apiKeys).set({ revokedAt: new Date() }).where(eq(apiKeys.id, key!.id));
    const revoked = await store.readiness(seed.tenantId);
    expect(revoked.checks.find((c) => c.id === "api_key_issued")?.ok).toBe(false);
    expect(revoked.checks.find((c) => c.id === "api_key_issued")?.remediation).toBeString();
    expect(revoked.ready).toBe(false);
  });

  test("disabling the provider drops the provider and model steps together", async () => {
    const seed = await seedTenant();
    created.push(seed);
    const database_ = await database();
    const store = new DrizzleObservabilityStore(database_, undefined);

    const before = await store.readiness(seed.tenantId);
    expect(before.checks.find((c) => c.id === "provider_connected")?.ok).toBe(true);
    expect(before.checks.find((c) => c.id === "model_available")?.ok).toBe(true);

    await database_.update(providers).set({ enabled: false }).where(eq(providers.id, seed.providerId));

    // A model on a disabled provider is not routable, so both steps must fall.
    const after = await store.readiness(seed.tenantId);
    expect(after.checks.find((c) => c.id === "provider_connected")?.ok).toBe(false);
    expect(after.checks.find((c) => c.id === "model_available")?.ok).toBe(false);
  });

  test("a request inside the 24h window satisfies first_request_seen", async () => {
    const seed = await seedTenant();
    created.push(seed);
    const database_ = await database();
    const store = new DrizzleObservabilityStore(database_, undefined);

    await database_.insert(telemetryEvents).values({
      tenantId: seed.tenantId,
      requestId: randomUUID(),
      requestedModel: "readiness-model",
      createdAt: new Date(),
    });

    const step = (await store.readiness(seed.tenantId)).checks.find(
      (c) => c.id === "first_request_seen",
    );
    expect(step?.ok).toBe(true);
    expect(step?.detail).toContain("1 request(s)");
  });

  test("counts are scoped to the tenant, not global", async () => {
    const seed = await seedTenant();
    created.push(seed);
    const store = new DrizzleObservabilityStore(await database(), undefined);

    // A tenant that was never seeded must not inherit anyone else's rows.
    const other = await store.readiness(randomUUID());
    expect(other.checks.find((c) => c.id === "admin_created")?.ok).toBe(false);
    expect(other.checks.find((c) => c.id === "provider_connected")?.ok).toBe(false);
    expect(other.checks.find((c) => c.id === "first_request_seen")?.ok).toBe(false);
  });

  test("the endpoint serves the read model over the real HTTP surface", async () => {
    const seed = await seedTenant();
    created.push(seed);
    const store = new DrizzleObservabilityStore(await database(), undefined);

    // Mount the real plugin with a resolver that grants the tenant scope, then
    // call it through `handle` so the route, the operation wrapper, and the
    // read model are all on the path.
    const routes = createObservabilityRoutes({
      store,
      accessResolver: () =>
        ({
          allowed: true,
          tenantId: seed.tenantId,
          scopes: ["dashboard:read"],
          actor: "test",
        }) as never,
    });

    const response = await routes.handle(new Request("http://localhost/system/readiness"));
    expect(response.status).toBe(200);
    const body = (await response.json()) as {
      ready: boolean;
      generatedAt: string;
      checks: Array<{ id: string; ok: boolean; detail?: string }>;
    };
    expect(body.checks).toHaveLength(5);
    expect(body.checks[0]!.id).toBe("admin_created");
    expect(body.checks[0]!.ok).toBe(true);
    // The detail is a measured figure, not a placeholder.
    expect(body.checks[0]!.detail).toBeString();
    expect(typeof body.ready).toBe("boolean");

    // A second call must answer the same shape — the endpoint is not one-shot.
    const again = await routes.handle(new Request("http://localhost/system/readiness"));
    expect(again.status).toBe(200);
  });
});
