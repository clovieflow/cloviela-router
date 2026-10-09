import { Client } from "pg";
import { readFileSync, readdirSync } from "node:fs";

const name = `rikka_e2e_${Date.now()}`;
const admin = new Client({ connectionString: "postgres://postgres@127.0.0.1:5432/postgres" });
await admin.connect();
await admin.query(`CREATE DATABASE ${name}`);
await admin.end();

const db = new Client({ connectionString: `postgres://postgres@127.0.0.1:5432/${name}` });
await db.connect();
const files = readdirSync("migrations").filter(f => /^\d{4}_.*\.sql$/.test(f)).sort();
let ok = 0, failed = null;
for (const f of files) {
  try { await db.query(readFileSync(`migrations/${f}`, "utf8")); ok++; }
  catch (e) { failed = { file: f, msg: String(e.message).slice(0, 160) }; break; }
}
console.log(`  diterapkan: ${ok}/${files.length}`);
if (failed) console.log(`  GAGAL di ${failed.file}:\n    ${failed.msg}`);

if (!failed) {
  const t = await db.query(`SELECT tablename FROM pg_tables WHERE schemaname='public' AND tablename LIKE 'bansos%' ORDER BY tablename`);
  console.log("  tabel bansos:", t.rows.map(r => r.tablename).join(", "));
  const c = await db.query(`SELECT pg_get_constraintdef(oid) AS def FROM pg_constraint WHERE conname='api_keys_mode_shape_check'`);
  console.log("  constraint bansos diterima:", c.rows[0]?.def?.includes("bansos"));
  const col = await db.query(`SELECT column_name FROM information_schema.columns WHERE table_name='api_keys' AND column_name='bansos_participant_id'`);
  console.log("  kolom bansos_participant_id:", col.rowCount === 1);
}
await db.end();
