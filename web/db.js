import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import pg from "pg";

const { Pool } = pg;

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const DATABASE_URL =
  process.env.DATABASE_URL ||
  "postgresql://postgres:root@localhost:5432/invoice";

export const pool = new Pool({
  connectionString: DATABASE_URL,
});

let migrated = false;

export async function ensureDatabase() {
  // Create DB if missing by connecting to postgres maintenance DB
  const url = new URL(DATABASE_URL);
  const dbName = url.pathname.replace(/^\//, "") || "invoice";
  const adminUrl = new URL(DATABASE_URL);
  adminUrl.pathname = "/postgres";

  const admin = new Pool({ connectionString: adminUrl.toString() });
  try {
    const exists = await admin.query(
      "SELECT 1 FROM pg_database WHERE datname = $1",
      [dbName]
    );
    if (!exists.rowCount) {
      // CREATE DATABASE cannot run in a parameterized query
      await admin.query(`CREATE DATABASE "${dbName.replace(/"/g, '""')}"`);
      console.log(`[db] Created database ${dbName}`);
    }
  } finally {
    await admin.end();
  }
}

export async function migrate() {
  if (migrated) return;
  await ensureDatabase();

  // gen_random_uuid requires pgcrypto on older Postgres; prefer built-in on PG13+
  await pool.query(`CREATE EXTENSION IF NOT EXISTS pgcrypto`);

  const sqlPath = path.join(__dirname, "db", "migrate.sql");
  const sql = fs.readFileSync(sqlPath, "utf8");
  await pool.query(sql);
  migrated = true;
  console.log("[db] Migrations applied");
}

export async function query(text, params) {
  return pool.query(text, params);
}
