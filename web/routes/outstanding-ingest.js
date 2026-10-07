import { Router } from "express";
import { ingestAuth } from "../middleware/ingest-auth.js";
import { upsertOutstandingBatch } from "../services/outstanding.js";

const router = Router();

function normalizeItems(body) {
  if (!body || typeof body !== "object") return [];
  if (Array.isArray(body.balances)) return body.balances;
  if (Array.isArray(body)) return body;
  return [body];
}

router.post("/ingest", ingestAuth, async (req, res) => {
  try {
    const items = normalizeItems(req.body);
    if (!items.length) {
      return res.status(400).json({
        error:
          "Body must be a balance object, an array, or { balances: [...] }",
      });
    }

    const results = await upsertOutstandingBatch(req.ingestShop, items);
    return res.status(200).json({
      success: true,
      data: results,
      meta: { count: results.length },
    });
  } catch (err) {
    const status = err.status || 500;
    console.error("[outstanding-ingest]", err);
    return res.status(status).json({
      error: err.message || "Failed to ingest outstanding balance",
    });
  }
});

export default router;
