/** Static company block for invoice PDF/preview (editable via env, no code change). */
export function getCompanyBlock() {
  return {
    logo_url: process.env.INVOICE_LOGO_URL || "",
    company_name: process.env.INVOICE_COMPANY_NAME || "INK QUEST",
    street_address1:
      process.env.INVOICE_STREET_ADDRESS1 || "14617 134 Ave NW",
    street_address2:
      process.env.INVOICE_STREET_ADDRESS2 || "Edmonton, AB T5L 4S9",
    telephone: process.env.INVOICE_TELEPHONE || "(780) 454-4321",
    fax: process.env.INVOICE_FAX || "(780) 452-5405",
    tax_registration_no: process.env.INVOICE_TAX_REGISTRATION_NO || "",
    returns_clause:
      process.env.INVOICE_RETURNS_CLAUSE ||
      "No returns without our written permission (RMA).",
    overdue_clause:
      process.env.INVOICE_OVERDUE_CLAUSE ||
      "2% per month (24% annual) will be charged on overdue accounts.",
    claims_clause:
      process.env.INVOICE_CLAIMS_CLAUSE ||
      "All claims must be made within 5 days after receipt of goods.",
    surcharge_clause:
      process.env.INVOICE_SURCHARGE_CLAUSE ||
      "A 3% charge may apply for any credit card bill payment",
  };
}
