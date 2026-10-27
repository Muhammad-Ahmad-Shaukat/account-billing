import fs from 'node:fs';

const base = process.env.TEST_BASE_URL || 'https://account-billing.onrender.com';
const secret = process.env.INVOICE_INGEST_SECRET;
const shop = process.env.INVOICE_SHOP_DOMAIN;
if (!secret || !shop) throw new Error('Set INVOICE_INGEST_SECRET and INVOICE_SHOP_DOMAIN');
const headers = { 'Content-Type': 'application/json', 'X-Invoice-Secret': secret, 'X-Shopify-Shop-Domain': shop };
const invoices = JSON.parse(fs.readFileSync(new URL('./inkquest-test-invoices.json', import.meta.url)));
let failures = 0;
for (const invoice of invoices) {
  const response = await fetch(base + '/api/invoices/ingest', {
    method: 'POST', headers, body: JSON.stringify(invoice), signal: AbortSignal.timeout(45000)
  });
  const result = await response.json();
  const expected = invoice.total_amount !== undefined;
  const ok = response.ok && result.success === true && result.data?.downloadable === expected;
  console.log(`${ok ? 'PASS' : 'FAIL'} ${invoice.invoice_number} revision ${invoice.revision}: HTTP ${response.status}, downloadable=${result.data?.downloadable}`);
  if (!ok) failures++;
}
for (const invoice of [...new Map(invoices.map(i => [i.invoice_number, i])).values()]) {
  const query = new URLSearchParams({ shopify_customer_id: invoice.shopify_customer_id, invoice_number: invoice.invoice_number });
  const response = await fetch(base + '/api/invoices/exists?' + query, { headers, signal: AbortSignal.timeout(45000) });
  const result = await response.json();
  const ok = response.ok && result.data?.exists === true && result.data?.revision === invoice.revision;
  console.log(`${ok ? 'PASS' : 'FAIL'} persisted ${invoice.invoice_number}: latest revision ${result.data?.revision}`);
  if (!ok) failures++;
}
const response = await fetch(base + '/api/outstanding?' + new URLSearchParams({ shopify_customer_id: invoices[0].shopify_customer_id }), { headers, signal: AbortSignal.timeout(45000) });
console.log('Existing account outstanding (read only):', response.status, JSON.stringify(await response.json()));
const unsigned = await fetch(base + '/api/proxy/customer/invoices?shop=' + encodeURIComponent(shop), { signal: AbortSignal.timeout(45000) });
console.log(`${unsigned.status === 401 ? 'PASS' : 'FAIL'} unsigned customer invoice access: HTTP ${unsigned.status}`);
if (unsigned.status !== 401) failures++;
process.exitCode = failures ? 1 : 0;
