/**
 * Which models `/v1/models` advertises.
 *
 * Reported: models from the Cloviela router kept disappearing and coming back,
 * while other routers were stable. The cause was this filter.
 *
 * A model is advertised only when its provider is no-auth or has at least one
 * usable account for the tenant. The query counted `status = 'active'` and
 * nothing else — but an account is put into `cooldown` by a *temporary*
 * condition: a rate limit, a transient upstream error, a quota window that
 * reopens. So one rate-limited account removed every model of that provider
 * from the catalogue, and a client that refreshes its model list from
 * `/v1/models` — which is how every OpenAI-compatible client works — dropped
 * them too, then saw them return when the cooldown expired. The catalogue was
 * flapping in time with provider rate limits.
 *
 * A cooldown says "not right now", not "this tenant is not configured for this
 * provider". `disabled` is the deliberate statement, and it still excludes.
 */
import { expect, test, beforeAll, afterAll } from "bun:test";
import { closeTestPool, dbDescribe, getTestPool } from "../helpers/database";
import { createWorld, type GatewayWorld } from "../helpers/fixtures";
import type { ApiKeyAuthorizationSnapshot } from "../../src/security/api-key-auth";
import { getDb } from "../../src/persistence/postgres";
import { PublicModelCatalogStore } from "../../src/console/providers/catalog/public-model-store";

let world: GatewayWorld;

beforeAll(async () => {
  // The account must belong to the tenant: the catalogue filter looks for a
  // usable account *of this tenant*, and the fixture's default is a global
  // (tenant-less) account, which no tenant ever sees.
  world = await createWorld();
  const pool = await getTestPool();
  const client = await pool.connect();
  try {
    await client.query(`update provider_accounts set tenant_id = $1 where id = $2`, [
      world.tenantId,
      world.accountId,
    ]);
  } finally {
    client.release();
  }
});

afterAll(async () => {
  await closeTestPool();
});

/** Sets the world's account to `status` and lists what the tenant may use. */
async function modelsWithAccountStatus(status: "active" | "cooldown" | "disabled") {
  const pool = await getTestPool();
  const client = await pool.connect();
  try {
    await client.query(
      `update provider_accounts set status = $1, cooldown_until = null where id = $2`,
      [status, world.accountId],
    );
  } finally {
    client.release();
  }
  const store = new PublicModelCatalogStore(getDb());
  // An unrestricted key: the account filter is what this suite is about, so the
  // model allowlist is left empty (which means "no restriction").
  const snapshot: ApiKeyAuthorizationSnapshot = {
    api_key_id: world.apiKeyId,
    tenant_id: world.tenantId,
    model_access_mode: "whitelist",
    model_list: [],
  };
  return store.listPublicModels(world.tenantId, snapshot);
}

// `dbDescribe` skips with a uniform reason when no isolated database is
// configured, instead of failing as if the behaviour were broken.
dbDescribe("public model catalogue and account cooldown", () => {
  test("an active account advertises its provider's models", async () => {
    const entries = await modelsWithAccountStatus("active");
    expect(entries.some((entry) => entry.id.includes(world.modelId))).toBe(true);
  });

  test("a cooling-down account keeps advertising them", async () => {
    // The regression: a rate limit is temporary, and hiding the models for its
    // duration is what made them flap in and out of every client's list.
    const entries = await modelsWithAccountStatus("cooldown");
    expect(entries.some((entry) => entry.id.includes(world.modelId))).toBe(true);
  });

  test("a disabled account stops advertising them", async () => {
    // The deliberate exclusion still works: disabling is an operator decision,
    // not a transient condition, so the models must go.
    const entries = await modelsWithAccountStatus("disabled");
    expect(entries.some((entry) => entry.id.includes(world.modelId))).toBe(false);
  });

  test("the filter asks for both usable statuses in one query", async () => {
    // Guards the shape of the fix: a later edit that goes back to a single
    // `status = 'active'` comparison would silently restore the flapping.
    const source = await Bun.file(
      new URL(
        "../../src/console/providers/catalog/public-model-store.ts",
        import.meta.url,
      ),
    ).text();
    expect(source).toContain('inArray(providerAccounts.status, ["active", "cooldown"])');
    expect(source).not.toContain('eq(providerAccounts.status, "active")');
  });
});
