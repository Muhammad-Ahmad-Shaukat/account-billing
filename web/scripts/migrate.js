import "../load-env.js";
import { migrate, pool } from "../db.js";

try {
  await migrate();
  console.log("OK");
  process.exit(0);
} catch (err) {
  console.error(err);
  process.exit(1);
} finally {
  await pool.end();
}
