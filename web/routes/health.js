import { Router } from "express";
import { pool } from "../db.js";

const router = Router();

/**
 * GET /api/health
 * Public liveness probe — no auth.
 */
router.get("/health", async (_req, res) => {
  return res.status(200).json({
    success: true,
    status: "ok",
    service: "account-billing",
    time: new Date().toISOString(),
  });
});

/**
 * GET /api/health/db
 * Public DB connectivity check — no auth.
 */
router.get("/health/db", async (_req, res) => {
  const started = Date.now();
  try {
    const result = await pool.query(
      "SELECT 1 AS ok, NOW() AS db_time, current_database() AS database"
    );
    const row = result.rows[0] || {};
    return res.status(200).json({
      success: true,
      status: "ok",
      database: row.database || null,
      db_time: row.db_time || null,
      latency_ms: Date.now() - started,
    });
  } catch (err) {
    console.error("[health/db]", err.message);
    return res.status(503).json({
      success: false,
      status: "error",
      error: err.message || "Database unavailable",
      latency_ms: Date.now() - started,
    });
  }
});

export default router;
