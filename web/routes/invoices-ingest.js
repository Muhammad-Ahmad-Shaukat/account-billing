import { Router } from "express";
import { ingestAuth } from "../middleware/ingest-auth.js";
import { upsertInvoiceRevision } from "../services/invoices.js";

const router = Router();

router.post("/ingest", ingestAuth, async (req, res) => {
  try {
    const payload = req.body;
    if (!payload || typeof payload !== "object" || Array.isArray(payload)) {
      return res.status(400).json({ error: "JSON object body required" });
    }

    const result = await upsertInvoiceRevision(req.ingestShop, payload);
    const status = result.downloadable ? 200 : 202;
    return res.status(status).json({
      success: true,
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
      error: err.message || "Failed to ingest invoice",
    });
  }
});

export default router;
