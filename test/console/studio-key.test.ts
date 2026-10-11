/**
 * Studio's gateway key.
 *
 * Studio calls the gateway with a real key, and it used to look for one with
 * the setup label and refuse if it was absent:
 *
 *     default_key_missing: the default gateway API key is missing;
 *     complete console setup to create it
 *
 * That key is only created during first-boot setup, and only when
 * `CLOVIELA_API_KEY` is set — so an installation that left the variable unset
 * (the example env file does not require it) had a working console, no key, and
 * an error telling the operator to redo a step they had already completed and
 * cannot re-run from the UI. The function is named `ensureStudioKey`; it now
 * ensures one.
 *
 * These tests drive the operation directly against a stub store, so they pin
 * the behaviour rather than the wording of the message that used to be thrown.
 */
import { describe, expect, test } from "bun:test";
import { createStudioOperations } from "../../src/console/domains/studio/routes";
import { DEFAULT_API_KEY_LABEL } from "../../src/console/domains/api-keys/contracts";
import { decryptCredentialToString, encryptCredential } from "../../src/security/crypto";
import type { AccessDecision } from "../../src/security/access-control";
import type { ApiKeyPatch, ApiKeyRecord, ApiKeyStore } from "../../src/persistence/api-key-store";

/** A store that keeps records in memory, so a create is observable. */
function makeStore(seed: readonly ApiKeyRecord[] = []): ApiKeyStore & {
  readonly records: ApiKeyRecord[];
} {
  const records: ApiKeyRecord[] = [...seed];
  return {
    records,
    async list() {
      return records;
    },
    async get(_tenantId, keyId) {
      return records.find((record) => record.id === keyId);
    },
    async listChildren(_tenantId, parentKeyId) {
      return records.filter((record) => record.parentKeyId === parentKeyId);
    },
    async create(record) {
      records.push(record);
    },
    async reorder() {},
    async update(_tenantId, keyId, patch: ApiKeyPatch) {
      const index = records.findIndex((record) => record.id === keyId);
      if (index === -1) return undefined;
      // Records are readonly by contract, so a patch produces a new row rather
      // than mutating one in place — the same way the real store writes. Only
      // keys the patch actually names are copied: a spread would widen every
      // field to `| undefined` and lose the distinction between "leave this
      // alone" and "clear it".
      const merged: Record<string, unknown> = { ...records[index] };
      for (const [field, value] of Object.entries(patch)) {
        if (value !== undefined) merged[field] = value;
      }
      const next = merged as unknown as ApiKeyRecord;
      records[index] = next;
      return next;
    },
    async revoke(_tenantId, keyId) {
      const index = records.findIndex((record) => record.id === keyId);
      const found = records[index];
      if (found === undefined) return false;
      // Copy through `Record` so the spread does not widen every field to
      // optional under `exactOptionalPropertyTypes`.
      const merged: Record<string, unknown> = { ...found, revokedAt: new Date() };
      records[index] = merged as unknown as ApiKeyRecord;
      return true;
    },
  };
}

const ACCESS: AccessDecision = {
  id: "user-1",
  tenantId: "tenant-1",
  scopes: ["dashboard:read", "dashboard:write", "routing:invoke"],
  admissionIdentity: "user-1",
};

function operationsWith(store: ApiKeyStore) {
  return createStudioOperations({
    sessionStore: {
      list: async () => [],
      get: async () => undefined,
      create: async () => {},
      update: async () => undefined,
      delete: async () => false,
      listIdsOldestFirst: async () => [],
    },
    keyStore: store,
    accessResolver: () => ACCESS,
  });
}

describe("ensureStudioKey", () => {
  test("mints a usable key when the tenant has none", async () => {
    // The reported failure: a console with no setup key could not use Studio
    // at all. It must now produce a key that actually authenticates.
    const store = makeStore();
    const operations = operationsWith(store);

    const result = await operations.ensureStudioKey(ACCESS);

    expect(result.key.length).toBeGreaterThan(0);
    expect(result.prefix.length).toBeGreaterThan(0);
    // The row exists and its secret is the one handed back — otherwise Studio
    // would authenticate with a key the gateway cannot look up.
    expect(store.records).toHaveLength(1);
    const created = store.records[0];
    expect(created?.id).toBe(result.keyId);
    expect(created?.label).toBe(DEFAULT_API_KEY_LABEL);
    expect(created?.keyEncrypted).toBeDefined();
    expect(decryptCredentialToString(created!.keyEncrypted!)).toBe(result.key);
  });

  test("the minted key can invoke routing, which is what Studio needs", async () => {
    // A key without `routing:invoke` is rejected by the gateway middleware
    // before the request reaches a provider, so Studio would swap one failure
    // for another.
    const store = makeStore();
    const operations = operationsWith(store);

    await operations.ensureStudioKey(ACCESS);

    expect(store.records[0]?.scopes).toContain("routing:invoke");
  });

  test("reuses the existing key instead of minting a second one", async () => {
    // An installation that does have the setup key must keep using it: a new
    // key per Studio visit would scatter credentials across the tenant.
    const store = makeStore([
      {
        id: "existing",
        tenantId: "tenant-1",
        enabled: true,
        label: DEFAULT_API_KEY_LABEL,
        keyHash: "hash",
        keyMode: "personal",
        scopes: ["routing:invoke"],
        keyPrefix: "Rk_old",
        keyEncrypted: encryptCredential("Rk_old_secret_value"),
        modelAccessMode: "whitelist",
        createdAt: new Date(),
        tokensConsumed: 0,
      },
    ]);
    const operations = operationsWith(store);

    const result = await operations.ensureStudioKey(ACCESS);

    expect(result.keyId).toBe("existing");
    expect(result.key).toBe("Rk_old_secret_value");
    expect(store.records).toHaveLength(1);
  });

  test("a revoked setup key does not count as present", async () => {
    // A revoked key cannot authenticate, so treating it as usable would leave
    // Studio broken with no way out.
    const store = makeStore([
      {
        id: "revoked",
        tenantId: "tenant-1",
        enabled: false,
        label: DEFAULT_API_KEY_LABEL,
        keyHash: "hash",
        keyMode: "personal",
        scopes: ["routing:invoke"],
        keyPrefix: "Rk_rev",
        keyEncrypted: encryptCredential("Rk_revoked_secret"),
        modelAccessMode: "whitelist",
        createdAt: new Date(),
        tokensConsumed: 0,
        revokedAt: new Date(),
      },
    ]);
    const operations = operationsWith(store);

    const result = await operations.ensureStudioKey(ACCESS);

    expect(result.keyId).not.toBe("revoked");
    expect(store.records).toHaveLength(2);
  });

  test("replaces a key whose secret was never stored", async () => {
    // Rows written before the encrypted copy was kept have no recoverable
    // secret. Nothing can decrypt them, so Studio must mint a fresh one rather
    // than fail forever.
    const store = makeStore([
      {
        id: "no-secret",
        tenantId: "tenant-1",
        enabled: true,
        label: DEFAULT_API_KEY_LABEL,
        keyHash: "hash",
        keyMode: "personal",
        scopes: ["routing:invoke"],
        keyPrefix: "Rk_ns",
        modelAccessMode: "whitelist",
        createdAt: new Date(),
        tokensConsumed: 0,
      },
    ]);
    const operations = operationsWith(store);

    const result = await operations.ensureStudioKey(ACCESS);

    expect(result.key.length).toBeGreaterThan(0);
    const minted = store.records.find((record) => record.id === result.keyId);
    expect(minted?.keyEncrypted).toBeDefined();
  });
});
