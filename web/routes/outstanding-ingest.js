import { Router } from "express";
import { ingestAuth } from "../middleware/ingest-auth.js";
import {
  getOutstandingByCustomerId,
  upsertCustomerOutstanding,
} from "../services/outstanding.js";

const router = Router();

/**
 * POST /api/outstanding/ingest
 * Body:
 *   { "shopify_customer_id": "...", "outstanding_balance": 2600 }
 */
router.post("/ingest", ingestAuth, async (req, res) => {
  try {
    const body = req.body;
    if (!body || typeof body !== "object" || Array.isArray(body)) {
      return res.status(400).json({
        error:
          'JSON body required: { "shopify_customer_id": "...", "outstanding_balance": 2600 }',
      });
    }

    const result = await upsertCustomerOutstanding(req.ingestShop, body);
    return res.status(200).json({
      success: true,
      data: result,
    });
  } catch (err) {
    const status = err.status || 500;
    console.error("[outstanding-ingest]", err);
    return res.status(status).json({
      error: err.message || "Failed to ingest outstanding balance",
    });
  }
});

/**
 * GET /api/outstanding
 * Same auth headers as ingest.
 * Query params:
 *   ?shopify_customer_id=...
 */
router.get("/", ingestAuth, async (req, res) => {
  try {
    const shopify_customer_id = req.query.shopify_customer_id;

    const result = await getOutstandingByCustomerId(
      req.ingestShop,
      shopify_customer_id
    );

    return res.status(200).json({
      success: true,
      data: result,
    });
  } catch (err) {
    const status = err.status || 500;
    console.error("[outstanding-get]", err);
    return res.status(status).json({
      error: err.message || "Failed to get outstanding balance",
    });
  }
});

export default router;
