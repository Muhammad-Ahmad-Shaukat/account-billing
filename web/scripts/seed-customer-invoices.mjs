/**
 * Seed invoices for a Shopify customer covering requirement-brief cases:
 * - multipage (23+ lines)
 * - single-page paid / due
 * - same order, second invoice after back-order ships
 * - freight line (null qty/price)
 * - zero-shipped B/O lines still printed
 * - multi-tax
 * - revision (rev 1 then rev 2)
 * - non-downloadable (missing totals)
 * - outstanding: invoice-scoped + then customer can switch
 */
import "../load-env.js";
import { migrate, pool } from "../db.js";
import { upsertInvoiceRevision } from "../services/invoices.js";
import { upsertOutstandingBatch } from "../services/outstanding.js";

const CUSTOMER_ID = process.argv[2] || "31249944510693";
const shop = (process.env.INVOICE_SHOP_DOMAIN || "account-billing.myshopify.com")
  .toLowerCase()
  .replace(/^https?:\/\//, "")
  .replace(/\/$/, "");

const soldTo = {
  name: "Ink Quest Reseller Demo",
  address1: "100 Demo Street NW",
  city: "Edmonton",
  province: "AB",
  postal: "T5L 4S9",
  country: "CA",
};

const shipTo = {
  name: "Warehouse Receiving",
  address1: "200 Ship Lane",
  city: "Calgary",
  province: "AB",
  postal: "T2P 1J9",
  country: "CA",
};

function base(overrides = {}) {
  return {
    shopify_customer_id: CUSTOMER_ID,
    currency: "CAD",
    sold_to: soldTo,
    ship_to: shipTo,
    customer_no: "IQ-DEMO-01",
    salesperson: "JD",
    terms: "N30",
    ship_via: "CANPAR",
    tax_exempt_code: "",
    tax_registration_no: "123456789RT0001",
    ...overrides,
  };
}

/** Catalog-style lines for a multipage invoice (23 lines like the sample). */
function multipageLines() {
  const products = [
    ["SM-LC401XL-C", "SMART MATE COMP. BROTHER LC401XL CYAN INK 500p.", "3", "3", "0", "12.50", "37.50"],
    ["SM-LC401XL-M", "SMART MATE COMP. BROTHER LC401XL MAGENTA INK 500p.", "3", "3", "0", "12.50", "37.50"],
    ["SM-LC401XL-Y", "SMART MATE COMP. BROTHER LC401XL YELLOW INK 500p.", "3", "3", "0", "12.50", "37.50"],
    ["TN221-M", "COMP. BROTHER TN221/225 MAGENTA UNIVERSAL 2,2K (15/BX)", "4", "4", "0", "22.00", "88.00"],
    ["TN221-Y", "COMP. BROTHER TN221/225 YELLOW UNIVERSAL 2,2K (15/BX)", "2", "2", "0", "22.00", "44.00"],
    ["TN221-K", "COMP. BROTHER TN221 BLACK 2,5K (15/BX)", "2", "1", "1", "21.00", "21.00"],
    ["71B10C0", "ECO. COMPATIBLE TONER FOR LEXMARK CYAN (71B10C0) 2.3K", "2", "2", "0", "45.00", "90.00"],
    ["71B10K0", "ECO. COMPATIBLE TONER FOR LEXMARK BLACK (71B10K0) 3K", "1", "1", "0", "48.00", "48.00"],
    ["71B10M0", "ECO. COMPATIBLE TONER FOR LEXMARK MAGENTA (71B10M0) 2.3K", "1", "1", "0", "45.00", "45.00"],
    ["W1380X", "ECO. COMPATIBLE TONER FOR HP #138X BLACK (W1380X) 4K", "5", "5", "0", "39.00", "195.00"],
    ["B7RT5AN", "HP INKJET #63XL/#65XL BLACK (B7RT5AN) DJ 2130/2132 300PGS", "7", "7", "0", "18.00", "126.00"],
    ["F6U63AN", "HP INKJET #63XL TRI-COLOR DESKJET 2130/2132 (F6U63AN) 300PGS", "3", "3", "0", "22.00", "66.00"],
    ["4981C001", "CANON INKJET PG275XL BLACK TR4720/TS3520 (4981C001) 300PGS", "10", "10", "0", "16.00", "160.00"],
    ["4987C001", "CANON INKJET CL276XL COLOR TR4720/TS3520 (4987C001) 300PGS", "5", "5", "0", "19.00", "95.00"],
    ["78C0W00", "LEXMARK WASTE TONER BOTTLE 78C0W00 CS/X42X/52X/62X", "2", "2", "0", "28.00", "56.00"],
    ["4K0T7LN", "HP INKJET #923E BLACK (4K0T7LN) PRO 8120 SERIES 1K", "2", "2", "0", "35.00", "70.00"],
    ["W1480A", "HP TONER #148A BLACK (W1480A) LJ PRO 4001/4101 2.9K", "4", "4", "0", "52.00", "208.00"],
    ["B221H00", "LEXMARK TONER B221H00 BLACK HY B/MB2236 3K", "2", "0", "2", "0.00", "0.00"],
    ["C231HC0", "LEXMARK TONER C231HC0 CYAN HY C/MC2325/2425/2535 2.3K", "1", "1", "0", "61.00", "61.00"],
    ["C231HM0", "LEXMARK TONER C231HM0 MAGENTA HY C/MC2325/2425/2535 2.3K", "1", "1", "0", "61.00", "61.00"],
    ["C231HY0", "LEXMARK TONER C231HY0 YELLOW HY C/MC2325/2425/2535 2.3K", "1", "1", "0", "61.00", "61.00"],
    ["20N1HK0", "LEXMARK TONER 20N1HK0 BLACK HY CS/X331 4.5K", "2", "2", "0", "72.00", "144.00"],
  ];

  const lines = products.map(([item_number, description, o, s, b, unit_price, extended_price]) => ({
    item_number,
    description,
    qty_ordered: Number(o),
    qty_shipped: Number(s),
    qty_backorder: Number(b),
    unit_price,
    uom: "EACH",
    extended_price,
  }));

  lines.push({
    item_number: "FREIGHT",
    description: "FREIGHT - CANPAR\nXXX TRACKING REFERENCE XXX",
    qty_ordered: null,
    qty_shipped: null,
    qty_backorder: null,
    unit_price: null,
    uom: null,
    extended_price: "18.50",
  });

  return lines;
}

const invoices = [
  // 1) Multipage — 23 lines, multi-tax, amount due
  base({
    shopify_order_id: "5600000000001",
    invoice_number: "IQ-2609-1001",
    invoice_date: "2026-09-11",
    order_no: "SO-45021",
    order_date: "2026-09-10",
    po_number: "PO-77821",
    revision: 1,
    lines: multipageLines(),
    tax_lines: [
      { code: "GST", amount: "94.28" },
      { code: "PSTSK", amount: "0.00" },
    ],
    subtotal: "1885.50",
    total_tax: "94.28",
    total_amount: "1979.78",
    less_payment: "0.00",
    amount_due: "1979.78",
  }),

  // 2) First partial invoice on an order (shipped portion)
  base({
    shopify_order_id: "5600000000002",
    invoice_number: "IQ-2609-1002",
    invoice_date: "2026-09-15",
    order_no: "SO-45088",
    order_date: "2026-09-14",
    po_number: "PO-77900",
    revision: 1,
    lines: [
      {
        item_number: "TN221-K",
        description: "COMP. BROTHER TN221 BLACK 2,5K (15/BX)",
        qty_ordered: 6,
        qty_shipped: 3,
        qty_backorder: 3,
        unit_price: "21.00",
        uom: "EACH",
        extended_price: "63.00",
      },
      {
        item_number: "SM-LC401XL-C",
        description: "SMART MATE COMP. BROTHER LC401XL CYAN INK 500p.",
        qty_ordered: 3,
        qty_shipped: 0,
        qty_backorder: 3,
        unit_price: "0.00",
        uom: "EACH",
        extended_price: "0.00",
      },
      {
        item_number: "FREIGHT",
        description: "FREIGHT - CANPAR 1Z999AA10123456784",
        qty_ordered: null,
        qty_shipped: null,
        qty_backorder: null,
        unit_price: null,
        uom: null,
        extended_price: "12.00",
      },
    ],
    tax_lines: [
      { code: "GST", amount: "3.75" },
      { code: "PSTSK", amount: "0.00" },
    ],
    subtotal: "75.00",
    total_tax: "3.75",
    total_amount: "78.75",
    less_payment: "0.00",
    amount_due: "78.75",
  }),

  // 3) Second invoice same order — back-order ships later
  base({
    shopify_order_id: "5600000000002",
    invoice_number: "IQ-2609-1010",
    invoice_date: "2026-09-28",
    order_no: "SO-45088",
    order_date: "2026-09-14",
    po_number: "PO-77900",
    revision: 1,
    lines: [
      {
        item_number: "TN221-K",
        description: "COMP. BROTHER TN221 BLACK 2,5K (15/BX) — back order ship",
        qty_ordered: 6,
        qty_shipped: 3,
        qty_backorder: 0,
        unit_price: "21.00",
        uom: "EACH",
        extended_price: "63.00",
      },
      {
        item_number: "SM-LC401XL-C",
        description: "SMART MATE COMP. BROTHER LC401XL CYAN INK 500p.",
        qty_ordered: 3,
        qty_shipped: 3,
        qty_backorder: 0,
        unit_price: "12.50",
        uom: "EACH",
        extended_price: "37.50",
      },
      {
        item_number: "FREIGHT",
        description: "FREIGHT - PUROLATOR\nTRACK 3299988776655",
        qty_ordered: null,
        qty_shipped: null,
        qty_backorder: null,
        unit_price: null,
        uom: null,
        extended_price: "14.25",
      },
    ],
    tax_lines: [
      { code: "GST", amount: "5.74" },
      { code: "PSTSK", amount: "0.00" },
    ],
    subtotal: "114.75",
    total_tax: "5.74",
    total_amount: "120.49",
    less_payment: "0.00",
    amount_due: "120.49",
  }),

  // 4) Single-page fully paid (amount due 0)
  base({
    shopify_order_id: "5600000000003",
    invoice_number: "IQ-2608-0888",
    invoice_date: "2026-08-20",
    order_no: "SO-44110",
    order_date: "2026-08-19",
    po_number: "PO-77001",
    revision: 1,
    lines: [
      {
        item_number: "W1380X",
        description: "ECO. COMPATIBLE TONER FOR HP #138X BLACK (W1380X) 4K",
        qty_ordered: 2,
        qty_shipped: 2,
        qty_backorder: 0,
        unit_price: "39.00",
        uom: "EACH",
        extended_price: "78.00",
      },
      {
        item_number: "FREIGHT",
        description: "FREIGHT - CANPAR 1Z888BB20999887766",
        qty_ordered: null,
        qty_shipped: null,
        qty_backorder: null,
        unit_price: null,
        uom: null,
        extended_price: "9.95",
      },
    ],
    tax_lines: [{ code: "GST", amount: "4.40" }],
    subtotal: "87.95",
    total_tax: "4.40",
    total_amount: "92.35",
    less_payment: "92.35",
    amount_due: "0.00",
  }),

  // 5) Revision case — rev 1 then rev 2 (customer should see rev 2 only)
  base({
    shopify_order_id: "5600000000004",
    invoice_number: "IQ-2609-1020",
    invoice_date: "2026-09-18",
    order_no: "SO-45102",
    order_date: "2026-09-17",
    po_number: "PO-78111",
    revision: 1,
    lines: [
      {
        item_number: "B7RT5AN",
        description: "HP INKJET #63XL/#65XL BLACK — incorrect price (rev 1)",
        qty_ordered: 4,
        qty_shipped: 4,
        qty_backorder: 0,
        unit_price: "20.00",
        uom: "EACH",
        extended_price: "80.00",
      },
    ],
    tax_lines: [{ code: "GST", amount: "4.00" }],
    subtotal: "80.00",
    total_tax: "4.00",
    total_amount: "84.00",
    less_payment: "0.00",
    amount_due: "84.00",
  }),

  base({
    shopify_order_id: "5600000000004",
    invoice_number: "IQ-2609-1020",
    invoice_date: "2026-09-18",
    order_no: "SO-45102",
    order_date: "2026-09-17",
    po_number: "PO-78111",
    revision: 2,
    lines: [
      {
        item_number: "B7RT5AN",
        description: "HP INKJET #63XL/#65XL BLACK — corrected price (rev 2)",
        qty_ordered: 4,
        qty_shipped: 4,
        qty_backorder: 0,
        unit_price: "18.00",
        uom: "EACH",
        extended_price: "72.00",
      },
      {
        item_number: "FREIGHT",
        description: "FREIGHT - CANPAR 1Z777CC30111222333",
        qty_ordered: null,
        qty_shipped: null,
        qty_backorder: null,
        unit_price: null,
        uom: null,
        extended_price: "8.00",
      },
    ],
    tax_lines: [
      { code: "GST", amount: "4.00" },
      { code: "PSTSK", amount: "0.00" },
    ],
    subtotal: "80.00",
    total_tax: "4.00",
    total_amount: "84.00",
    less_payment: "20.00",
    amount_due: "64.00",
  }),

  // 6) Fully back-ordered invoice (all lines qty_shipped 0) still listed
  base({
    shopify_order_id: "5600000000005",
    invoice_number: "IQ-2609-1030",
    invoice_date: "2026-09-22",
    order_no: "SO-45150",
    order_date: "2026-09-21",
    po_number: "PO-78222",
    revision: 1,
    lines: [
      {
        item_number: "C231HC0",
        description: "LEXMARK TONER C231HC0 CYAN — awaiting stock",
        qty_ordered: 2,
        qty_shipped: 0,
        qty_backorder: 2,
        unit_price: "0.00",
        uom: "EACH",
        extended_price: "0.00",
      },
      {
        item_number: "C231HM0",
        description: "LEXMARK TONER C231HM0 MAGENTA — awaiting stock",
        qty_ordered: 2,
        qty_shipped: 0,
        qty_backorder: 2,
        unit_price: "0.00",
        uom: "EACH",
        extended_price: "0.00",
      },
    ],
    tax_lines: [
      { code: "GST", amount: "0.00" },
      { code: "PSTSK", amount: "0.00" },
    ],
    subtotal: "0.00",
    total_tax: "0.00",
    total_amount: "0.00",
    less_payment: "0.00",
    amount_due: "0.00",
  }),

  // 7) Offline / no Shopify order id — still saved (customer match only)
  base({
    shopify_order_id: null,
    invoice_number: "IQ-2609-1040",
    invoice_date: "2026-09-25",
    order_no: "SO-PHONE-991",
    order_date: "2026-09-25",
    po_number: "PO-PHONE-1",
    revision: 1,
    lines: [
      {
        item_number: "4981C001",
        description: "CANON INKJET PG275XL BLACK — phone order",
        qty_ordered: 6,
        qty_shipped: 6,
        qty_backorder: 0,
        unit_price: "16.00",
        uom: "EACH",
        extended_price: "96.00",
      },
    ],
    tax_lines: [{ code: "GST", amount: "4.80" }],
    subtotal: "96.00",
    total_tax: "4.80",
    total_amount: "100.80",
    less_payment: "0.00",
    amount_due: "100.80",
  }),

  // 8) Non-downloadable — missing required totals (still listed, PDF blocked)
  base({
    shopify_order_id: "5600000000006",
    invoice_number: "IQ-2609-1050-BAD",
    invoice_date: "2026-09-26",
    order_no: "SO-45199",
    order_date: "2026-09-26",
    po_number: "PO-78333",
    revision: 1,
    lines: [
      {
        item_number: "TEST-BAD",
        description: "Incomplete totals — should not be downloadable",
        qty_ordered: 1,
        qty_shipped: 1,
        qty_backorder: 0,
        unit_price: "10.00",
        uom: "EACH",
        extended_price: "10.00",
      },
    ],
    tax_lines: [{ code: "GST", amount: "0.50" }],
    subtotal: "10.00",
    // intentionally omit total_tax, total_amount, less_payment, amount_due
  }),
];

await migrate();

console.log(`Seeding ${invoices.length} invoice rows for customer ${CUSTOMER_ID} on ${shop}`);

const results = [];
for (const inv of invoices) {
  const r = await upsertInvoiceRevision(shop, inv);
  results.push(r);
  console.log(
    `  ${r.invoice_number} rev ${r.revision} downloadable=${r.downloadable}` +
      (r.missing_required_totals?.length
        ? ` missing=[${r.missing_required_totals.join(",")}]`
        : "")
  );
}

// Invoice-scoped outstanding (customer total = sum). No customer-scoped row
// so UI shows per-invoice outstanding + summed account balance.
const outstanding = [
  { shopify_customer_id: CUSTOMER_ID, invoice_number: "IQ-2609-1001", amount: "1979.78", currency: "CAD" },
  { shopify_customer_id: CUSTOMER_ID, invoice_number: "IQ-2609-1002", amount: "78.75", currency: "CAD" },
  { shopify_customer_id: CUSTOMER_ID, invoice_number: "IQ-2609-1010", amount: "120.49", currency: "CAD" },
  { shopify_customer_id: CUSTOMER_ID, invoice_number: "IQ-2609-1020", amount: "64.00", currency: "CAD" },
  { shopify_customer_id: CUSTOMER_ID, invoice_number: "IQ-2608-0888", amount: "0.00", currency: "CAD" },
  { shopify_customer_id: CUSTOMER_ID, invoice_number: "IQ-2609-1040", amount: "100.80", currency: "CAD" },
];

await upsertOutstandingBatch(shop, outstanding);
console.log(`Outstanding rows: ${outstanding.length} (invoice-scoped)`);
console.log(
  "Expected customer outstanding ≈",
  (1979.78 + 78.75 + 120.49 + 64.0 + 0 + 100.8).toFixed(2)
);

console.log("\nCases covered:");
console.log("  - Multipage (23 lines incl. freight + B/O zeros)");
console.log("  - Two invoices same order (SO-45088)");
console.log("  - Paid invoice (amount_due 0)");
console.log("  - Revision (IQ-2609-1020 rev1+rev2 → list shows rev2)");
console.log("  - Fully back-ordered zero-value lines");
console.log("  - No shopify_order_id (phone order)");
console.log("  - Non-downloadable missing totals");
console.log("  - Invoice-scoped outstanding balances");

await pool.end();
