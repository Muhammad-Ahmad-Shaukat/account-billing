import "../load-env.js";
import { migrate, pool } from "../db.js";
import { upsertInvoiceRevision } from "../services/invoices.js";
import { upsertOutstandingBatch, resolveOutstandingForCustomer } from "../services/outstanding.js";
import { listLatestInvoices, getInvoiceForCustomer } from "../services/invoices.js";
import { attachOutstandingToInvoices } from "../services/outstanding.js";

const shop = (process.env.INVOICE_SHOP_DOMAIN || "account-billing.myshopify.com")
  .toLowerCase()
  .replace(/^https?:\/\//, "")
  .replace(/\/$/, "");

const customerId = "1234567890";

const sample = {
  shopify_customer_id: customerId,
  shopify_order_id: "9876543210",
  invoice_number: "INV-TEST-001",
  invoice_date: "2026-09-11",
  order_no: "SO-100",
  order_date: "2026-09-11",
  customer_no: "C100",
  po_number: "PO-9",
  salesperson: "AB",
  terms: "N30",
  ship_via: "CANPAR",
  currency: "CAD",
  sold_to: {
    name: "Sold To Name",
    address1: "1 Street",
    city: "Edmonton",
    province: "AB",
    postal: "T5L4S9",
    country: "CA",
  },
  ship_to: {
    name: "Ship To Name",
    address1: "2 Street",
    city: "Edmonton",
    province: "AB",
    postal: "T5L4S9",
    country: "CA",
  },
  lines: [
    {
      item_number: "ITEM-1",
      description: "Sample line",
      qty_ordered: 3,
      qty_shipped: 3,
      qty_backorder: 0,
      unit_price: "1.00",
      uom: "EACH",
      extended_price: "3.00",
    },
    {
      item_number: "FREIGHT",
      description: "FREIGHT - CANPAR TRACK123",
      qty_ordered: null,
      qty_shipped: null,
      qty_backorder: null,
      unit_price: null,
      uom: null,
      extended_price: "10.00",
    },
  ],
  tax_lines: [
    { code: "GST", amount: "0.65" },
    { code: "PSTSK", amount: "0.00" },
  ],
  tax_exempt_code: "",
  tax_registration_no: "123456789RT0001",
  subtotal: "13.00",
  total_tax: "0.65",
  total_amount: "13.65",
  less_payment: "0.00",
  amount_due: "13.65",
  revision: 1,
};

await migrate();

const r1 = await upsertInvoiceRevision(shop, sample);
console.log("ingest rev1", r1);

const r2 = await upsertInvoiceRevision(shop, { ...sample, revision: 2, amount_due: "10.00", less_payment: "3.65" });
console.log("ingest rev2", r2);

await upsertOutstandingBatch(shop, [
  { shopify_customer_id: customerId, invoice_number: "INV-TEST-001", amount: "10.00", currency: "CAD" },
]);

const outstanding = await resolveOutstandingForCustomer(shop, customerId);
console.log("outstanding", {
  mode: outstanding.mode,
  customer_outstanding: outstanding.customer_outstanding,
});

const list = await listLatestInvoices(shop, customerId, { page: 1, page_size: 20 });
const data = attachOutstandingToInvoices(list.data, outstanding);
console.log(
  "list",
  data.map((d) => ({
    id: d.id,
    invoice_number: d.invoice_number,
    revision: d.revision,
    amount_due: d.amount_due,
    outstanding_amount: d.outstanding_amount,
  }))
);

const detail = await getInvoiceForCustomer(shop, customerId, data[0].id);
console.log("detail lines", detail.lines.length, "downloadable", detail.downloadable);

await pool.end();
console.log("OK");
