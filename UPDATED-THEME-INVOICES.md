# Install the invoice module in the updated theme

1. Copy the contents of new-account-dashboard.liquid into the updated theme's existing account-dashboard section (the section used by /pages/my-account).
2. Copy the contents of new-rj-header.liquid into the updated theme's existing RJ header section.
3. Upload these existing files to the updated theme's assets folder:
   - theme_export__account-billing-myshopify-com-theme-export-inkquestca-myshopify-com-copy-of__07OCT2026-0209pm/assets/rd-invoices.js
   - theme_export__account-billing-myshopify-com-theme-export-inkquestca-myshopify-com-copy-of__07OCT2026-0209pm/assets/inkquest-invoice-logo.svg
4. Preview the theme while signed in as a customer with invoices. Open Invoices from the account dropdown or mobile menu. Check search, dates, balance filters, pagination, invoice detail, and Download PDF (uses the browser print dialog; choose Save as PDF).

The dashboard uses the existing app proxy at /apps/account-billing/customer/invoices. The account-billing app must be installed, its backend running, and invoices loaded for the signed-in customer. Invoice rows now come from this app rather than being generated from Shopify orders. The previous Send to ERP placeholder was removed.

Local JavaScript syntax and invoice element checks passed. Shopify toolkit Liquid validation was attempted but could not run because its host installation lacks @shopify/theme-check-common. Live Shopify rendering and authenticated requests still need the preview check above. No theme was published or uploaded by this change.

## Invoice summary cards

Deploy the updated backend (web/services/invoices.js), then upload the updated dashboard section and rd-invoices.js asset together. No database migration is required.

GET /apps/account-billing/customer/invoices now includes meta.summary:

    {
      "total_invoices": 25,
      "paid": 8,
      "pending": 16,
      "unknown": 1,
      "totals_by_currency": [{ "currency": "CAD", "total_value": "1234.50" }]
    }

Summary covers all latest invoice revisions for the authenticated customer and shop, regardless of table filters or pagination. Paid means amount_due <= 0; pending means amount_due > 0; absent amounts count as unknown. Incomplete invoices count toward Total Invoices, but absent total_amount values do not contribute to Total Value. Currencies are summed separately. Existing meta.total continues to mean the filtered table count.

Summary display checks passed for filtered/paginated totals, multiple currencies, an empty account, and unavailable summary data. The new SQL summary still requires validation against the deployed database after backend deployment.
