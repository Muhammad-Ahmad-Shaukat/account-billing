import { query } from "../db.js";
import { normalizeShopifyId } from "./invoices.js";

/**
 * One outstanding balance per customer.
 * Payload shape:
 *   { "shopify_customer_id": "...", "outstanding_balance": 2600 }
 * Also accepts amount / outstanding _balance (typo) / currency.
 */
export async function upsertCustomerOutstanding(shop, item) {
  const customerId = normalizeShopifyId(item.shopify_customer_id);
  if (!customerId) {
    const err = new Error("shopify_customer_id is required");
    err.status = 400;
    throw err;
  }

  const amount =
    item.outstanding_balance ??
    item["outstanding _balance"] ??
    item.amount;

  if (amount === null || amount === undefined || String(amount).trim() === "") {
    const err = new Error("outstanding_balance is required");
    err.status = 400;
    throw err;
  }

  const currency = item.currency ? String(item.currency) : "CAD";

  const result = await query(
    `
    INSERT INTO outstanding_balances (
      shop, shopify_customer_id, scope, shopify_order_id, invoice_number,
      amount, currency, raw_json, received_at, updated_at
    ) VALUES ($1,$2,'customer',NULL,NULL,$3,$4,$5::jsonb,NOW(),NOW())
    ON CONFLICT (shop, shopify_customer_id) WHERE scope = 'customer'
    DO UPDATE SET
      amount = EXCLUDED.amount,
      currency = EXCLUDED.currency,
      raw_json = EXCLUDED.raw_json,
      received_at = NOW(),
      updated_at = NOW()
    RETURNING id, scope, shopify_customer_id, amount, currency
    `,
    [shop, customerId, String(amount), currency, JSON.stringify(item)]
  );

  return result.rows[0];
}

/** @deprecated use upsertCustomerOutstanding — kept for older callers */
export async function upsertOutstanding(shop, item) {
  return upsertCustomerOutstanding(shop, item);
}

export async function upsertOutstandingBatch(shop, items) {
  const results = [];
  for (const item of items) {
    results.push(await upsertCustomerOutstanding(shop, item));
  }
  return results;
}

/**
 * Lookup outstanding by customer id (for ERP GET API).
 */
export async function getOutstandingByCustomerId(shop, customerIdRaw) {
  const customerId = normalizeShopifyId(customerIdRaw);
  if (!customerId) {
    const err = new Error("shopify_customer_id is required");
    err.status = 400;
    throw err;
  }

  const resolved = await resolveOutstandingForCustomer(shop, customerId);
  return {
    shopify_customer_id: customerId,
    exists: resolved.mode !== "none",
    outstanding_balance:
      resolved.customer_outstanding == null
        ? null
        : resolved.customer_outstanding,
    currency: resolved.currency,
  };
}

/**
 * Single customer-level outstanding balance.
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

  if (!customerRow.rowCount) {
    return {
      mode: "none",
      customer_outstanding: null,
      currency: "CAD",
    };
  }

  return {
    mode: "customer",
    customer_outstanding: customerRow.rows[0].amount,
    currency: customerRow.rows[0].currency || "CAD",
  };
}

/** List rows no longer carry per-invoice outstanding. */
export function attachOutstandingToInvoices(invoices) {
  return invoices;
}
