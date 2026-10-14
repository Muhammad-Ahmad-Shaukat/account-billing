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

    // Duplicate invoice_number + revision
    if (result.exists === true) {
      return res.status(409).json({
        success: false,
        exists: true,
        data: result,
        error: result.message,
      });
    }

    const status = result.downloadable ? 200 : 202;
    return res.status(status).json({
      success: true,
      exists: false,
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
 * Body (JSON):
 *   { "shopify_customer_id": "...", "invoice_number": "..." }
 * Also accepts the same fields as query params.
 */
router.get("/exists", ingestAuth, async (req, res) => {
  try {
    const body = req.body && typeof req.body === "object" ? req.body : {};
    const shopify_customer_id =
      body.shopify_customer_id || req.query.shopify_customer_id;
    const invoice_number = body.invoice_number || req.query.invoice_number;

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
