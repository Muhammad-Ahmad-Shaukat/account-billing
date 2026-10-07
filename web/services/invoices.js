import { pool, query } from "../db.js";

const REQUIRED_TOTALS = [
  "subtotal",
  "total_tax",
  "total_amount",
  "less_payment",
  "amount_due",
];

/** Normalize IDs that may arrive as GID or numeric string. */
export function normalizeShopifyId(value) {
  if (value == null || value === "") return null;
  const str = String(value);
  const match = str.match(/(\d+)$/);
  return match ? match[1] : str;
}

function nullableText(value) {
  if (value === null || value === undefined) return null;
  return String(value);
}

function moneyPresent(value) {
  return value !== null && value !== undefined && String(value).trim() !== "";
}

export function validateDownloadable(payload) {
  const missing = REQUIRED_TOTALS.filter((key) => !moneyPresent(payload[key]));
  return { downloadable: missing.length === 0, missing };
}

export async function upsertInvoiceRevision(shop, payload) {
  const customerId = normalizeShopifyId(payload.shopify_customer_id);
  const orderId = normalizeShopifyId(payload.shopify_order_id);
  const invoiceNumber = String(payload.invoice_number || "").trim();
  const revision = Number(payload.revision);

  if (!customerId) {
    const err = new Error("shopify_customer_id is required");
    err.status = 400;
    throw err;
  }
  if (!invoiceNumber) {
    const err = new Error("invoice_number is required");
    err.status = 400;
    throw err;
  }
  if (!Number.isFinite(revision) || revision < 1) {
    const err = new Error("revision must be a positive integer");
    err.status = 400;
    throw err;
  }

  const { downloadable, missing } = validateDownloadable(payload);
  const lines = Array.isArray(payload.lines) ? payload.lines : [];
  const taxLines = Array.isArray(payload.tax_lines) ? payload.tax_lines : [];

  const client = await pool.connect();
  try {
    await client.query("BEGIN");

    const upsert = await client.query(
      `
      INSERT INTO invoices (
        shop, shopify_customer_id, shopify_order_id,
        invoice_number, revision, invoice_date, order_no, order_date,
        customer_no, po_number, salesperson, terms, ship_via, currency,
        sold_to, ship_to, tax_exempt_code, tax_registration_no,
        subtotal, total_tax, total_amount, less_payment, amount_due,
        downloadable, raw_json, updated_at
      ) VALUES (
        $1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,
        $15::jsonb,$16::jsonb,$17,$18,$19,$20,$21,$22,$23,$24,$25::jsonb, NOW()
      )
      ON CONFLICT (shop, invoice_number, revision) DO UPDATE SET
        shopify_customer_id = EXCLUDED.shopify_customer_id,
        shopify_order_id = EXCLUDED.shopify_order_id,
        invoice_date = EXCLUDED.invoice_date,
        order_no = EXCLUDED.order_no,
        order_date = EXCLUDED.order_date,
        customer_no = EXCLUDED.customer_no,
        po_number = EXCLUDED.po_number,
        salesperson = EXCLUDED.salesperson,
        terms = EXCLUDED.terms,
        ship_via = EXCLUDED.ship_via,
        currency = EXCLUDED.currency,
        sold_to = EXCLUDED.sold_to,
        ship_to = EXCLUDED.ship_to,
        tax_exempt_code = EXCLUDED.tax_exempt_code,
        tax_registration_no = EXCLUDED.tax_registration_no,
        subtotal = EXCLUDED.subtotal,
        total_tax = EXCLUDED.total_tax,
        total_amount = EXCLUDED.total_amount,
        less_payment = EXCLUDED.less_payment,
        amount_due = EXCLUDED.amount_due,
        downloadable = EXCLUDED.downloadable,
        raw_json = EXCLUDED.raw_json,
        updated_at = NOW()
      RETURNING id
      `,
      [
        shop,
        customerId,
        orderId,
        invoiceNumber,
        revision,
        nullableText(payload.invoice_date),
        nullableText(payload.order_no),
        nullableText(payload.order_date),
        nullableText(payload.customer_no),
        nullableText(payload.po_number),
        nullableText(payload.salesperson),
        nullableText(payload.terms),
        nullableText(payload.ship_via),
        nullableText(payload.currency) || "CAD",
        JSON.stringify(payload.sold_to || null),
        JSON.stringify(payload.ship_to || null),
        nullableText(payload.tax_exempt_code),
        nullableText(payload.tax_registration_no),
        nullableText(payload.subtotal),
        nullableText(payload.total_tax),
        nullableText(payload.total_amount),
        nullableText(payload.less_payment),
        nullableText(payload.amount_due),
        downloadable,
        JSON.stringify(payload),
      ]
    );

    const invoiceId = upsert.rows[0].id;

    await client.query("DELETE FROM invoice_lines WHERE invoice_id = $1", [
      invoiceId,
    ]);
    await client.query("DELETE FROM invoice_tax_lines WHERE invoice_id = $1", [
      invoiceId,
    ]);

    for (let i = 0; i < lines.length; i++) {
      const line = lines[i] || {};
      await client.query(
        `
        INSERT INTO invoice_lines (
          invoice_id, line_index, item_number, description,
          qty_ordered, qty_shipped, qty_backorder,
          unit_price, uom, extended_price
        ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)
        `,
        [
          invoiceId,
          i,
          nullableText(line.item_number),
          nullableText(line.description),
          line.qty_ordered === null || line.qty_ordered === undefined
            ? null
            : String(line.qty_ordered),
          line.qty_shipped === null || line.qty_shipped === undefined
            ? null
            : String(line.qty_shipped),
          line.qty_backorder === null || line.qty_backorder === undefined
            ? null
            : String(line.qty_backorder),
          line.unit_price === null || line.unit_price === undefined
            ? null
            : String(line.unit_price),
          nullableText(line.uom),
          nullableText(line.extended_price),
        ]
      );
    }

    for (let i = 0; i < taxLines.length; i++) {
      const tax = taxLines[i] || {};
      await client.query(
        `
        INSERT INTO invoice_tax_lines (invoice_id, line_index, code, amount)
        VALUES ($1,$2,$3,$4)
        `,
        [
          invoiceId,
          i,
          nullableText(tax.code),
          nullableText(tax.amount),
        ]
      );
    }

    await client.query("COMMIT");
    return {
      id: invoiceId,
      invoice_number: invoiceNumber,
      revision,
      downloadable,
      missing_required_totals: missing,
    };
  } catch (e) {
    await client.query("ROLLBACK");
    throw e;
  } finally {
    client.release();
  }
}

async function loadLines(invoiceId) {
  const lines = await query(
    `
    SELECT item_number, description, qty_ordered, qty_shipped, qty_backorder,
           unit_price, uom, extended_price
    FROM invoice_lines
    WHERE invoice_id = $1
    ORDER BY line_index ASC
    `,
    [invoiceId]
  );
  const taxes = await query(
    `
    SELECT code, amount
    FROM invoice_tax_lines
    WHERE invoice_id = $1
    ORDER BY line_index ASC
    `,
    [invoiceId]
  );

  return {
    lines: lines.rows.map((row) => ({
      item_number: row.item_number,
      description: row.description,
      qty_ordered: row.qty_ordered == null ? null : coerceNumberish(row.qty_ordered),
      qty_shipped: row.qty_shipped == null ? null : coerceNumberish(row.qty_shipped),
      qty_backorder:
        row.qty_backorder == null ? null : coerceNumberish(row.qty_backorder),
      unit_price: row.unit_price,
      uom: row.uom,
      extended_price: row.extended_price,
    })),
    tax_lines: taxes.rows.map((row) => ({
      code: row.code,
      amount: row.amount,
    })),
  };
}

function coerceNumberish(value) {
  const n = Number(value);
  return Number.isFinite(n) ? n : value;
}

function mapInvoiceRow(row, extras = {}) {
  return {
    id: row.id,
    shopify_customer_id: row.shopify_customer_id,
    shopify_order_id: row.shopify_order_id,
    invoice_number: row.invoice_number,
    revision: row.revision,
    invoice_date: row.invoice_date,
    order_no: row.order_no,
    order_date: row.order_date,
    customer_no: row.customer_no,
    po_number: row.po_number,
    salesperson: row.salesperson,
    terms: row.terms,
    ship_via: row.ship_via,
    currency: row.currency || "CAD",
    sold_to: row.sold_to,
    ship_to: row.ship_to,
    tax_exempt_code: row.tax_exempt_code,
    tax_registration_no: row.tax_registration_no,
    subtotal: row.subtotal,
    total_tax: row.total_tax,
    total_amount: row.total_amount,
    less_payment: row.less_payment,
    amount_due: row.amount_due,
    downloadable: row.downloadable,
    ...extras,
  };
}

/**
 * Latest revision per invoice_number for a customer.
 */
export async function listLatestInvoices(shop, customerId, options = {}) {
  const page = Math.max(1, parseInt(options.page, 10) || 1);
  const pageSize = Math.min(
    100,
    Math.max(1, parseInt(options.page_size, 10) || 20)
  );
  const q = String(options.q || "").trim();
  const dateFrom = String(options.date_from || "").trim();
  const dateTo = String(options.date_to || "").trim();
  const balance = String(options.balance || "").trim();

  const params = [shop, customerId];
  const filters = [];

  if (q) {
    params.push(`%${q}%`);
    filters.push(
      `(i.invoice_number ILIKE $${params.length}
        OR i.order_no ILIKE $${params.length}
        OR i.po_number ILIKE $${params.length}
        OR COALESCE(i.shopify_order_id,'') ILIKE $${params.length})`
    );
  }
  if (dateFrom) {
    params.push(dateFrom);
    filters.push(`i.invoice_date >= $${params.length}`);
  }
  if (dateTo) {
    params.push(dateTo);
    filters.push(`i.invoice_date <= $${params.length}`);
  }
  if (balance === "due") {
    filters.push(`COALESCE(NULLIF(i.amount_due,''),'0')::numeric > 0`);
  } else if (balance === "paid") {
    filters.push(`COALESCE(NULLIF(i.amount_due,''),'0')::numeric = 0`);
  }

  const whereExtra = filters.length ? `AND ${filters.join(" AND ")}` : "";

  const countResult = await query(
    `
    SELECT COUNT(*)::int AS total
    FROM (
      SELECT DISTINCT ON (invoice_number) *
      FROM invoices
      WHERE shop = $1 AND shopify_customer_id = $2
      ORDER BY invoice_number, revision DESC
    ) i
    WHERE TRUE ${whereExtra}
    `,
    params
  );
  const total = countResult.rows[0]?.total || 0;
  const totalPages = Math.max(1, Math.ceil(total / pageSize));
  const offset = (page - 1) * pageSize;

  params.push(pageSize, offset);
  const listResult = await query(
    `
    SELECT i.*
    FROM (
      SELECT DISTINCT ON (invoice_number) *
      FROM invoices
      WHERE shop = $1 AND shopify_customer_id = $2
      ORDER BY invoice_number, revision DESC
    ) i
    WHERE TRUE ${whereExtra}
    ORDER BY i.invoice_date DESC NULLS LAST, i.invoice_number DESC
    LIMIT $${params.length - 1} OFFSET $${params.length}
    `,
    params
  );

  return {
    data: listResult.rows.map((row) => mapInvoiceRow(row)),
    meta: {
      page,
      pageSize,
      total,
      totalPages,
    },
  };
}

export async function getInvoiceForCustomer(shop, customerId, invoiceId) {
  const result = await query(
    `
    SELECT *
    FROM invoices
    WHERE shop = $1 AND shopify_customer_id = $2 AND id = $3
    LIMIT 1
    `,
    [shop, customerId, invoiceId]
  );
  if (!result.rowCount) return null;

  const row = result.rows[0];
  const { lines, tax_lines } = await loadLines(row.id);
  return mapInvoiceRow(row, { lines, tax_lines });
}
