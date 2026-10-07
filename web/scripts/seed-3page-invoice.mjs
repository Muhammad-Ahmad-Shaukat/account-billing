import "../load-env.js";
import { migrate, pool } from "../db.js";
import { upsertInvoiceRevision } from "../services/invoices.js";
import { upsertOutstanding } from "../services/outstanding.js";

const CUSTOMER_ID = process.argv[2] || "31249944510693";
const shop = (process.env.INVOICE_SHOP_DOMAIN || "account-billing.myshopify.com")
  .toLowerCase()
  .replace(/^https?:\/\//, "")
  .replace(/\/$/, "");

const catalog = [
  ["SM-LC401XL-C", "SMART MATE COMP. BROTHER LC401XL CYAN INK 500p.", "12.50"],
  ["SM-LC401XL-M", "SMART MATE COMP. BROTHER LC401XL MAGENTA INK 500p.", "12.50"],
  ["SM-LC401XL-Y", "SMART MATE COMP. BROTHER LC401XL YELLOW INK 500p.", "12.50"],
  ["TN221-M", "COMP. BROTHER TN221/225 MAGENTA UNIVERSAL 2,2K (15/BX)", "22.00"],
  ["TN221-Y", "COMP. BROTHER TN221/225 YELLOW UNIVERSAL 2,2K (15/BX)", "22.00"],
  ["TN221-K", "COMP. BROTHER TN221 BLACK 2,5K (15/BX)", "21.00"],
  ["71B10C0", "ECO. COMPATIBLE TONER FOR LEXMARK CYAN (71B10C0) 2.3K", "45.00"],
  ["71B10K0", "ECO. COMPATIBLE TONER FOR LEXMARK BLACK (71B10K0) 3K", "48.00"],
  ["71B10M0", "ECO. COMPATIBLE TONER FOR LEXMARK MAGENTA (71B10M0) 2.3K", "45.00"],
  ["W1380X", "ECO. COMPATIBLE TONER FOR HP #138X BLACK (W1380X) 4K", "39.00"],
  ["B7RT5AN", "HP INKJET #63XL/#65XL BLACK (B7RT5AN) DJ 2130/2132 300PGS", "18.00"],
  ["F6U63AN", "HP INKJET #63XL TRI-COLOR DESKJET 2130/2132 (F6U63AN) 300PGS", "22.00"],
  ["4981C001", "CANON INKJET PG275XL BLACK TR4720/TS3520 (4981C001) 300PGS", "16.00"],
  ["4987C001", "CANON INKJET CL276XL COLOR TR4720/TS3520 (4987C001) 300PGS", "19.00"],
  ["78C0W00", "LEXMARK WASTE TONER BOTTLE 78C0W00 CS/X42X/52X/62X", "28.00"],
  ["4K0T7LN", "HP INKJET #923E BLACK (4K0T7LN) PRO 8120 SERIES 1K", "35.00"],
  ["W1480A", "HP TONER #148A BLACK (W1480A) LJ PRO 4001/4101 2.9K", "52.00"],
  ["B221H00", "LEXMARK TONER B221H00 BLACK HY B/MB2236 3K", "55.00"],
  ["C231HC0", "LEXMARK TONER C231HC0 CYAN HY C/MC2325/2425/2535 2.3K", "61.00"],
  ["C231HM0", "LEXMARK TONER C231HM0 MAGENTA HY C/MC2325/2425/2535 2.3K", "61.00"],
  ["C231HY0", "LEXMARK TONER C231HY0 YELLOW HY C/MC2325/2425/2535 2.3K", "61.00"],
  ["20N1HK0", "LEXMARK TONER 20N1HK0 BLACK HY CS/X331 4.5K", "72.00"],
  ["58D1H00", "LEXMARK TONER 58D1H00 BLACK HY MS/MX725/822/MS821/823 15K", "89.00"],
  ["CF226X", "COMPATIBLE HP 26X BLACK HIGH YIELD (CF226X) 9K", "64.00"],
  ["CF410X", "COMPATIBLE HP 410X BLACK HIGH YIELD (CF410X) 6.5K", "58.00"],
  ["CF411X", "COMPATIBLE HP 410X CYAN HIGH YIELD (CF411X) 5K", "62.00"],
  ["CF412X", "COMPATIBLE HP 410X YELLOW HIGH YIELD (CF412X) 5K", "62.00"],
  ["CF413X", "COMPATIBLE HP 410X MAGENTA HIGH YIELD (CF413X) 5K", "62.00"],
  ["TN760", "COMPATIBLE BROTHER TN760 BLACK HIGH YIELD 3K", "34.00"],
  ["TN227BK", "COMPATIBLE BROTHER TN227 BLACK HIGH YIELD 3K", "36.00"],
  ["TN227C", "COMPATIBLE BROTHER TN227 CYAN HIGH YIELD 2.3K", "38.00"],
  ["TN227M", "COMPATIBLE BROTHER TN227 MAGENTA HIGH YIELD 2.3K", "38.00"],
  ["TN227Y", "COMPATIBLE BROTHER TN227 YELLOW HIGH YIELD 2.3K", "38.00"],
  ["CE285A", "COMPATIBLE HP 85A BLACK (CE285A) 1.6K", "29.00"],
  ["CB435A", "COMPATIBLE HP 35A BLACK (CB435A) 1.5K", "27.00"],
  ["Q2612A", "COMPATIBLE HP 12A BLACK (Q2612A) 2K", "31.00"],
];

// ~36 product lines + freight ≈ 3 printed pages with the ERP layout
// (sample used ~13 lines/page → 36 lines ≈ 3 pages)
const lines = [];
let subtotalCents = 0;
for (let i = 0; i < 36; i++) {
  const [item_number, description, unit] = catalog[i % catalog.length];
  const qty = (i % 5) + 1;
  const unitCents = Math.round(parseFloat(unit) * 100);
  const extCents = unitCents * qty;
  const isBo = i === 10 || i === 25;
  if (!isBo) subtotalCents += extCents;
  lines.push({
    item_number: `${item_number}-${String(i + 1).padStart(2, "0")}`,
    description: `${description}${isBo ? " — back-ordered line, still printed" : ""}`,
    qty_ordered: qty + (isBo ? 2 : 0),
    qty_shipped: isBo ? 0 : qty,
    qty_backorder: isBo ? qty + 2 : 0,
    unit_price: isBo ? "0.00" : unit,
    uom: "EACH",
    extended_price: isBo ? "0.00" : (extCents / 100).toFixed(2),
  });
}

lines.push({
  item_number: "FREIGHT",
  description: "FREIGHT - CANPAR\n3-PAGE DEMO TRACKING REF 1Z3PAGE998877665544",
  qty_ordered: null,
  qty_shipped: null,
  qty_backorder: null,
  unit_price: null,
  uom: null,
  extended_price: "42.00",
});
subtotalCents += 4200;

const subtotal = (subtotalCents / 100).toFixed(2);
const taxCents = Math.round(subtotalCents * 0.05);
const totalTax = (taxCents / 100).toFixed(2);
const totalAmount = ((subtotalCents + taxCents) / 100).toFixed(2);

await migrate();

const result = await upsertInvoiceRevision(shop, {
  shopify_customer_id: CUSTOMER_ID,
  shopify_order_id: "5600000000099",
  invoice_number: "IQ-2609-1100-3PG",
  invoice_date: "2026-09-30",
  order_no: "SO-45999",
  order_date: "2026-09-29",
  customer_no: "IQ-DEMO-01",
  po_number: "PO-3PAGE-01",
  salesperson: "JD",
  terms: "N30",
  ship_via: "CANPAR",
  currency: "CAD",
  sold_to: {
    name: "Ink Quest Reseller Demo",
    address1: "100 Demo Street NW",
    city: "Edmonton",
    province: "AB",
    postal: "T5L 4S9",
    country: "CA",
  },
  ship_to: {
    name: "Warehouse Receiving",
    address1: "200 Ship Lane",
    city: "Calgary",
    province: "AB",
    postal: "T2P 1J9",
    country: "CA",
  },
  lines,
  tax_lines: [
    { code: "GST", amount: totalTax },
    { code: "PSTSK", amount: "0.00" },
  ],
  tax_exempt_code: "",
  tax_registration_no: "123456789RT0001",
  subtotal,
  total_tax: totalTax,
  total_amount: totalAmount,
  less_payment: "0.00",
  amount_due: totalAmount,
  revision: 1,
});

await upsertOutstanding(shop, {
  shopify_customer_id: CUSTOMER_ID,
  invoice_number: "IQ-2609-1100-3PG",
  amount: totalAmount,
  currency: "CAD",
});

console.log({
  id: result.id,
  invoice_number: result.invoice_number,
  lines: lines.length,
  subtotal,
  total_amount: totalAmount,
  amount_due: totalAmount,
  downloadable: result.downloadable,
});

await pool.end();
