import { Router } from "express";
import { appProxyAuth } from "../middleware/app-proxy-auth.js";
import { getCompanyBlock } from "../services/company.js";
import {
  getInvoiceForCustomer,
  listLatestInvoices,
  normalizeShopifyId,
} from "../services/invoices.js";
import {
  attachOutstandingToInvoices,
  resolveOutstandingForCustomer,
} from "../services/outstanding.js";

const router = Router();

router.use(appProxyAuth);

router.get("/customer/invoices", async (req, res) => {
  try {
    const shop = req.proxyShop;
    const customerId = normalizeShopifyId(req.loggedInCustomerId);

    const list = await listLatestInvoices(shop, customerId, {
      page: req.query.page,
      page_size: req.query.page_size,
      q: req.query.q,
      date_from: req.query.date_from,
      date_to: req.query.date_to,
      balance: req.query.balance,
    });

    const outstanding = await resolveOutstandingForCustomer(shop, customerId);
    const data = attachOutstandingToInvoices(list.data, outstanding);

    return res
      .status(200)
      .set("Content-Type", "application/json")
      .json({
        data,
        meta: {
          ...list.meta,
          outstanding_balance: outstanding.customer_outstanding,
          outstanding_currency: outstanding.currency,
          outstanding_mode: outstanding.mode,
        },
      });
  } catch (err) {
    console.error("[customer-invoices list]", err);
    return res.status(500).json({ error: "Failed to load invoices" });
  }
});

router.get("/customer/invoices/:id", async (req, res) => {
  try {
    const shop = req.proxyShop;
    const customerId = normalizeShopifyId(req.loggedInCustomerId);
    const invoice = await getInvoiceForCustomer(
      shop,
      customerId,
      req.params.id
    );

    if (!invoice) {
      return res.status(404).json({ error: "Invoice not found" });
    }

    // Never offer download when required totals are missing (brief 4.1 / AC12)
    if (req.query.download === "1" && !invoice.downloadable) {
      return res.status(422).json({
        error: "Invoice is missing required totals and cannot be downloaded",
        downloadable: false,
      });
    }

    const company = getCompanyBlock();
    if (!company.tax_registration_no && invoice.tax_registration_no) {
      company.tax_registration_no = invoice.tax_registration_no;
    }

    return res.status(200).json({
      data: {
        ...invoice,
        company,
      },
    });
  } catch (err) {
    console.error("[customer-invoices detail]", err);
    return res.status(500).json({ error: "Failed to load invoice" });
  }
});

export default router;
