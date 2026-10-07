/**
 * ERP ingest auth: shared secret + shop domain headers.
 * Headers:
 *   X-Invoice-Secret
 *   X-Shopify-Shop-Domain
 */
export function ingestAuth(req, res, next) {
  const expectedSecret = process.env.INVOICE_INGEST_SECRET;
  const expectedShop = (process.env.INVOICE_SHOP_DOMAIN || "")
    .trim()
    .toLowerCase()
    .replace(/^https?:\/\//, "")
    .replace(/\/$/, "");

  if (!expectedSecret || !expectedShop) {
    console.error(
      "[ingest-auth] INVOICE_INGEST_SECRET or INVOICE_SHOP_DOMAIN not configured"
    );
    return res.status(500).json({ error: "Ingest not configured" });
  }

  const secret = req.get("X-Invoice-Secret") || "";
  const shopRaw = req.get("X-Shopify-Shop-Domain") || "";
  const shop = shopRaw
    .trim()
    .toLowerCase()
    .replace(/^https?:\/\//, "")
    .replace(/\/$/, "");

  if (!secret || secret !== expectedSecret) {
    return res.status(401).json({ error: "Unauthorized" });
  }

  if (!shop || shop !== expectedShop) {
    return res.status(403).json({ error: "Invalid shop domain" });
  }

  req.ingestShop = shop;
  return next();
}
