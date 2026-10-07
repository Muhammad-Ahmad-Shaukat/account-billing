import pg from "pg";

const user = "postgres";
const password = "root";
const host = "localhost";
const port = 5432;
const dbName = "invoice";

const admin = new pg.Client({ user, password, host, port, database: "postgres" });
try {
  await admin.connect();
  console.log("connected to postgres");
  const exists = await admin.query("SELECT 1 FROM pg_database WHERE datname = $1", [dbName]);
  if (!exists.rowCount) {
    await admin.query("CREATE DATABASE invoice");
    console.log("created database invoice");
  } else {
    console.log("database invoice already exists");
  }
} catch (e) {
  console.error("setup failed:", e.message);
  process.exitCode = 1;
} finally {
  await admin.end().catch(() => {});
}
