import { query } from "../db.js";
import { normalizeShopifyId } from "./invoices.js";

/**
 * Upsert one outstanding balance row.
 * scope: 'customer' | 'invoice'
 *
 * Read resolution (documented for later product decision):
 * - If a customer-scoped row exists → use it as customer outstanding;
 *   invoice-level outstanding is shown as "0.00".
 * - Else → customer outstanding = sum of invoice-scoped amounts;
 *   each invoice uses its stored outstanding amount, falling back to
 *   invoice.amount_due only when no outstanding row exists for that invoice.
 */
export async function upsertOutstanding(shop, item) {
  const customerId = normalizeShopifyId(item.shopify_customer_id);
  if (!customerId) {
    const err = new Error("shopify_customer_id is required");
    err.status = 400;
    throw err;
  }

  const amount = item.amount;
  if (amount === null || amount === undefined || String(amount).trim() === "") {
    const err = new Error("amount is required");
    err.status = 400;
    throw err;
  }

  const invoiceNumber = item.invoice_number
    ? String(item.invoice_number).trim()
    : null;
  let scope = String(item.scope || "").trim().toLowerCase();
  if (!scope) {
    scope = invoiceNumber ? "invoice" : "customer";
  }
  if (scope !== "invoice" && scope !== "customer") {
    const err = new Error("scope must be 'invoice' or 'customer'");
    err.status = 400;
    throw err;
  }
  if (scope === "invoice" && !invoiceNumber) {
    const err = new Error("invoice_number is required for invoice scope");
    err.status = 400;
    throw err;
  }

  const currency = item.currency ? String(item.currency) : "CAD";
  const orderId = normalizeShopifyId(item.shopify_order_id);

  if (scope === "customer") {
    const result = await query(
      `
      INSERT INTO outstanding_balances (
        shop, shopify_customer_id, scope, shopify_order_id, invoice_number,
        amount, currency, raw_json, received_at, updated_at
      ) VALUES ($1,$2,'customer',$3,NULL,$4,$5,$6::jsonb,NOW(),NOW())
      ON CONFLICT (shop, shopify_customer_id) WHERE scope = 'customer'
      DO UPDATE SET
        amount = EXCLUDED.amount,
        currency = EXCLUDED.currency,
        shopify_order_id = EXCLUDED.shopify_order_id,
        raw_json = EXCLUDED.raw_json,
        received_at = NOW(),
        updated_at = NOW()
      RETURNING id, scope, amount, currency
      `,
      [
        shop,
        customerId,
        orderId,
        String(amount),
        currency,
        JSON.stringify(item),
      ]
    );
    return result.rows[0];
  }

  const result = await query(
    `
    INSERT INTO outstanding_balances (
      shop, shopify_customer_id, scope, shopify_order_id, invoice_number,
      amount, currency, raw_json, received_at, updated_at
    ) VALUES ($1,$2,'invoice',$3,$4,$5,$6,$7::jsonb,NOW(),NOW())
    ON CONFLICT (shop, shopify_customer_id, invoice_number)
      WHERE scope = 'invoice' AND invoice_number IS NOT NULL
    DO UPDATE SET
      amount = EXCLUDED.amount,
      currency = EXCLUDED.currency,
      shopify_order_id = EXCLUDED.shopify_order_id,
      raw_json = EXCLUDED.raw_json,
      received_at = NOW(),
      updated_at = NOW()
    RETURNING id, scope, invoice_number, amount, currency
    `,
    [
      shop,
      customerId,
      orderId,
      invoiceNumber,
      String(amount),
      currency,
      JSON.stringify(item),
    ]
  );
  return result.rows[0];
}

export async function upsertOutstandingBatch(shop, items) {
  const results = [];
  for (const item of items) {
    results.push(await upsertOutstanding(shop, item));
  }
  return results;
}

/**
 * Returns { mode: 'customer'|'invoice'|'none', customer_outstanding, currency, byInvoice }
 */
export async function resolveOutstandingForCustomer(shop, customerId) {
  const customerRow = await query(
    `
    SELECT amount, currency
    FROM outstanding_balances
    WHERE shop = $1 AND shopify_customer_id = $2 AND scope = 'customer'
    LIMIT 1
    `,
    [shop, customerId]
  );

  if (customerRow.rowCount) {
    return {
      mode: "customer",
      customer_outstanding: customerRow.rows[0].amount,
      currency: customerRow.rows[0].currency || "CAD",
      // Per product decision: when customer-level balance is present,
      // per-invoice outstanding is treated as zero until clarified.
      byInvoice: new Map(),
      invoiceOutstandingForcedZero: true,
    };
  }

  const invoiceRows = await query(
    `
    SELECT invoice_number, amount, currency
    FROM outstanding_balances
    WHERE shop = $1 AND shopify_customer_id = $2 AND scope = 'invoice'
    `,
    [shop, customerId]
  );

  const byInvoice = new Map();
  let sum = 0;
  let currency = "CAD";
  let hasNumeric = false;

  for (const row of invoiceRows.rows) {
    byInvoice.set(row.invoice_number, row.amount);
    const n = parseFloat(row.amount);
    if (Number.isFinite(n)) {
      sum += n;
      hasNumeric = true;
    }
    if (row.currency) currency = row.currency;
  }

  if (!invoiceRows.rowCount) {
    return {
      mode: "none",
      customer_outstanding: null,
      currency: "CAD",
      byInvoice,
      invoiceOutstandingForcedZero: false,
    };
  }

  return {
    mode: "invoice",
    // Sum of invoice-scoped outstanding amounts (display only; not a printed invoice field).
    customer_outstanding: hasNumeric ? sum.toFixed(2) : "0.00",
    currency,
    byInvoice,
    invoiceOutstandingForcedZero: false,
  };
}

/**
 * Attach outstanding_amount to each list row.
 * Fallback: invoice.amount_due when no outstanding row for that invoice
 * and mode is not customer-forced-zero.
 */
export function attachOutstandingToInvoices(invoices, outstanding) {
  return invoices.map((inv) => {
    let outstandingAmount;
    if (outstanding.invoiceOutstandingForcedZero) {
      outstandingAmount = "0.00";
    } else if (outstanding.byInvoice.has(inv.invoice_number)) {
      outstandingAmount = outstanding.byInvoice.get(inv.invoice_number);
    } else {
      // Fallback only when no outstanding row exists for this invoice.
      outstandingAmount = inv.amount_due ?? null;
    }
    return {
      ...inv,
      outstanding_amount: outstandingAmount,
    };
  });
}
