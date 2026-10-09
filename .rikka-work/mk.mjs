import { Client } from "pg";
const name = `rikka_e2e_${Date.now()}`;
const c = new Client({ connectionString: "postgres://postgres@127.0.0.1:5432/postgres" });
await c.connect();
await c.query(`CREATE DATABASE ${name}`);
console.log(name);
await c.end();
