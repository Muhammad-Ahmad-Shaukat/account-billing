import { Router } from "express";
import { ingestAuth } from "../middleware/ingest-auth.js";
import {
  invoiceExists,
  upsertInvoiceRevision,
} from "../services/invoices.js";

const router = Router();

router.post("/ingest", ingestAuth, async (req, res) => {
  try {
    const payload = req.body;
    if (!payload || typeof payload !== "object" || Array.isArray(payload)) {
      return res.status(400).json({ error: "JSON object body required" });
    }

    const result = await upsertInvoiceRevision(req.ingestShop, payload);

    // Unchanged existing revision → 200, keep record as-is
    if (result.unchanged === true) {
      return res.status(200).json({
        success: true,
        exists: true,
        updated: false,
        unchanged: true,
        data: result,
      });
    }

    const status = result.downloadable ? 200 : 202;
    return res.status(status).json({
      success: true,
      exists: result.exists === true,
      updated: result.updated === true,
      unchanged: false,
      data: result,
      warning: result.downloadable
        ? undefined
        : `Stored but not downloadable; missing required totals: ${result.missing_required_totals.join(
            ", "
          )}`,
    });
  } catch (err) {
    const status = err.status || 500;
    console.error("[invoices-ingest]", err);
    return res.status(status).json({
      success: false,
      error: err.message || "Failed to ingest invoice",
    });
  }
});

/**
 * GET /api/invoices/exists
 * Same auth headers as ingest.
 * Query params:
 *   ?shopify_customer_id=...&invoice_number=...
 */
router.get("/exists", ingestAuth, async (req, res) => {
  try {
    const shopify_customer_id = req.query.shopify_customer_id;
    const invoice_number = req.query.invoice_number;

    const result = await invoiceExists(
      req.ingestShop,
      shopify_customer_id,
      invoice_number
    );

    return res.status(200).json({
      success: true,
      data: result,
    });
  } catch (err) {
    const status = err.status || 500;
    console.error("[invoices-exists]", err);
    return res.status(status).json({
      error: err.message || "Failed to check invoice",
    });
  }
});

export default router;
