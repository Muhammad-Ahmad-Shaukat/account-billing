/**
 * Live API scenario tests against Render (or BASE_URL).
 */
import "../load-env.js";

const BASE = process.env.TEST_BASE_URL || "https://account-billing.onrender.com";
const SECRET = process.env.INVOICE_INGEST_SECRET || "dev-invoice-ingest-secret-change-me";
const SHOP = process.env.INVOICE_SHOP_DOMAIN || "account-billing.myshopify.com";
const CUSTOMER = "31249944510693";

const headers = {
  "Content-Type": "application/json",
  "X-Invoice-Secret": SECRET,
  "X-Shopify-Shop-Domain": SHOP,
};

let passed = 0;
let failed = 0;
const results = [];

async function req(method, path, body, useAuth = true) {
  const opts = {
    method,
    headers: useAuth ? { ...headers } : { Accept: "application/json" },
  };
  let url = `${BASE}${path}`;
  if (body !== undefined) {
    if (method === "GET") {
      const qs = new URLSearchParams();
      for (const [k, v] of Object.entries(body)) {
        if (v !== undefined && v !== null) qs.set(k, String(v));
      }
      url += `?${qs.toString()}`;
    } else {
      opts.body = JSON.stringify(body);
      if (!useAuth) opts.headers["Content-Type"] = "application/json";
    }
  }
  const res = await fetch(url, opts);
  let json = null;
  try {
    json = await res.json();
  } catch {
    json = null;
  }
  return { status: res.status, json };
}

function assert(name, cond, detail) {
  if (cond) {
    passed += 1;
    results.push(`PASS  ${name}`);
    console.log(`PASS  ${name}`);
  } else {
    failed += 1;
    results.push(`FAIL  ${name} — ${detail}`);
    console.log(`FAIL  ${name} — ${detail}`);
  }
}

function baseInvoice(overrides = {}) {
  return {
    shopify_customer_id: CUSTOMER,
    shopify_order_id: "5600000000888",
    invoice_number: `IQ-TEST-${Date.now()}`,
    invoice_date: "2026-10-14",
    order_no: "SO-TEST-1",
    order_date: "2026-10-13",
    customer_no: "IQ-DEMO-01",
    po_number: "PO-TEST",
    salesperson: "JD",
    terms: "N30",
    ship_via: "CANPAR",
    currency: "CAD",
    sold_to: {
      name: "Test Customer",
      address1: "1 St",
      city: "Edmonton",
      province: "AB",
      postal: "T5L4S9",
      country: "CA",
    },
    ship_to: {
      name: "Ship To",
      address1: "2 St",
      city: "Calgary",
      province: "AB",
      postal: "T2P1J9",
      country: "CA",
    },
    lines: [
      {
        item_number: "ITEM-1",
        description: "Test line",
        qty_ordered: 1,
        qty_shipped: 1,
        qty_backorder: 0,
        unit_price: "10.00",
        uom: "EACH",
        extended_price: "10.00",
      },
    ],
    tax_lines: [{ code: "GST", amount: "0.50" }],
    tax_exempt_code: "",
    tax_registration_no: "123456789RT0001",
    subtotal: "10.00",
    total_tax: "0.50",
    total_amount: "10.50",
    less_payment: "0.00",
    amount_due: "10.50",
    revision: 1,
    ...overrides,
  };
}

console.log(`Testing against ${BASE}\n`);

// 1 Health
{
  const r = await req("GET", "/api/health", undefined, false);
  assert("GET /api/health → 200 ok", r.status === 200 && r.json?.status === "ok", JSON.stringify(r));
}

// 2 DB health
{
  const r = await req("GET", "/api/health/db", undefined, false);
  assert(
    "GET /api/health/db → 200 ok",
    r.status === 200 && r.json?.success === true,
    JSON.stringify(r)
  );
}

// 3 Auth fail
{
  const r = await fetch(`${BASE}/api/invoices/ingest`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "X-Invoice-Secret": "wrong-secret",
      "X-Shopify-Shop-Domain": SHOP,
    },
    body: JSON.stringify(baseInvoice()),
  });
  assert("POST ingest wrong secret → 401", r.status === 401, `status=${r.status}`);
}

// 4 Create invoice OK
const invoiceNumber = `IQ-CASE-${Date.now()}`;
let createdId = null;
{
  const payload = baseInvoice({ invoice_number: invoiceNumber, revision: 1 });
  const r = await req("POST", "/api/invoices/ingest", payload);
  assert(
    "POST ingest new invoice → 200 success",
    r.status === 200 && r.json?.success === true && r.json?.exists === false,
    JSON.stringify(r)
  );
  createdId = r.json?.data?.id;
}

// 5 Duplicate same revision
{
  const payload = baseInvoice({ invoice_number: invoiceNumber, revision: 1 });
  const r = await req("POST", "/api/invoices/ingest", payload);
  assert(
    "POST ingest duplicate invoice+revision → 409 exists",
    r.status === 409 && r.json?.success === false && r.json?.exists === true,
    JSON.stringify(r)
  );
}

// 6 New revision allowed
{
  const payload = baseInvoice({
    invoice_number: invoiceNumber,
    revision: 2,
    amount_due: "5.00",
    less_payment: "5.50",
  });
  const r = await req("POST", "/api/invoices/ingest", payload);
  assert(
    "POST ingest same invoice new revision → 200",
    r.status === 200 && r.json?.success === true && r.json?.data?.revision === 2,
    JSON.stringify(r)
  );
}

// 7 Missing required totals → 202 downloadable false
{
  const payload = baseInvoice({
    invoice_number: `IQ-BAD-${Date.now()}`,
    revision: 1,
    subtotal: "10.00",
  });
  delete payload.total_tax;
  delete payload.total_amount;
  delete payload.less_payment;
  delete payload.amount_due;
  const r = await req("POST", "/api/invoices/ingest", payload);
  assert(
    "POST ingest missing totals → 202 not downloadable",
    r.status === 202 && r.json?.data?.downloadable === false,
    JSON.stringify(r)
  );
}

// 7b Empty-string money totals → 202 not downloadable
{
  const payload = baseInvoice({
    invoice_number: `IQ-EMPTY-MONEY-${Date.now()}`,
    revision: 1,
    subtotal: "",
    total_tax: "",
    total_amount: "",
    less_payment: "",
    amount_due: "",
  });
  const r = await req("POST", "/api/invoices/ingest", payload);
  assert(
    "POST ingest empty-string totals → 202 not downloadable",
    r.status === 202 && r.json?.data?.downloadable === false,
    JSON.stringify(r)
  );
}

// 8 Empty required identity fields
{
  const payload = baseInvoice({ invoice_number: "", revision: 1 });
  const r = await req("POST", "/api/invoices/ingest", payload);
  assert(
    "POST ingest empty invoice_number → 400",
    r.status === 400,
    JSON.stringify(r)
  );
}
{
  const payload = baseInvoice({ shopify_customer_id: "", revision: 1 });
  const r = await req("POST", "/api/invoices/ingest", payload);
  assert(
    "POST ingest empty shopify_customer_id → 400",
    r.status === 400,
    JSON.stringify(r)
  );
}
{
  const payload = baseInvoice({ revision: null });
  delete payload.revision;
  const r = await req("POST", "/api/invoices/ingest", payload);
  assert(
    "POST ingest missing revision → 400",
    r.status === 400,
    JSON.stringify(r)
  );
}

// 9 Empty optional fields still accepted
{
  const payload = baseInvoice({
    invoice_number: `IQ-EMPTY-OPT-${Date.now()}`,
    po_number: "",
    salesperson: "",
    tax_exempt_code: "",
    shopify_order_id: null,
    sold_to: { name: "", address1: "", city: "", province: "", postal: "", country: "" },
  });
  const r = await req("POST", "/api/invoices/ingest", payload);
  assert(
    "POST ingest empty optional fields → 200 stored",
    r.status === 200 && r.json?.success === true,
    JSON.stringify(r)
  );
}

// 10 Exists check
{
  const r = await req("GET", "/api/invoices/exists", {
    shopify_customer_id: CUSTOMER,
    invoice_number: invoiceNumber,
  });
  assert(
    "GET /api/invoices/exists known → exists true",
    r.status === 200 && r.json?.data?.exists === true,
    JSON.stringify(r)
  );
}
{
  const r = await req("GET", "/api/invoices/exists", {
    shopify_customer_id: CUSTOMER,
    invoice_number: "DOES-NOT-EXIST-XYZ",
  });
  assert(
    "GET /api/invoices/exists unknown → exists false",
    r.status === 200 && r.json?.data?.exists === false,
    JSON.stringify(r)
  );
}

// 11 Outstanding set + get
{
  const r = await req("POST", "/api/outstanding/ingest", {
    shopify_customer_id: CUSTOMER,
    outstanding_balance: 2600,
  });
  assert(
    "POST /api/outstanding/ingest → 200",
    r.status === 200 && r.json?.success === true,
    JSON.stringify(r)
  );
}
{
  const r = await req("GET", "/api/outstanding", {
    shopify_customer_id: CUSTOMER,
  });
  assert(
    "GET /api/outstanding → balance 2600",
    r.status === 200 &&
      r.json?.data?.exists === true &&
      String(r.json?.data?.outstanding_balance) === "2600",
    JSON.stringify(r)
  );
}
{
  const r = await req("GET", "/api/outstanding", {
    shopify_customer_id: "99999999999999",
  });
  assert(
    "GET /api/outstanding unknown customer → exists false",
    r.status === 200 && r.json?.data?.exists === false,
    JSON.stringify(r)
  );
}

console.log(`\n==============================`);
console.log(`Passed: ${passed}`);
console.log(`Failed: ${failed}`);
console.log(`==============================\n`);

if (failed > 0) process.exitCode = 1;
