(function () {
  const cfg = window.RD_INVOICES;
  if (!cfg || !cfg.loggedIn) return;

  const tbody = document.getElementById("rdInvoiceTableBody");
  const pager = document.getElementById("rdInvoicePager");
  const pagerInfo = document.getElementById("rdInvoicePagerInfo");
  const prevBtn = document.getElementById("rdInvoicePrev");
  const nextBtn = document.getElementById("rdInvoiceNext");
  const modal = document.getElementById("rdInvoiceModal");
  const preview = document.getElementById("rdInvoicePreview");
  const closeBtn = document.getElementById("rdInvoiceClose");
  const pdfBtn = document.getElementById("rdInvoiceDownloadPdf");
  const searchInput = document.getElementById("rdInvoiceSearch");
  const dateFromInput = document.getElementById("rdInvoiceDateFrom");
  const dateToInput = document.getElementById("rdInvoiceDateTo");
  const balanceSelect = document.getElementById("rdInvoiceBalance");
  const clearFiltersBtn = document.getElementById("rdInvoiceFilterClear");
  const statsEl = document.getElementById("rdInvoiceStats");
  const outstandingEl = document.getElementById("rdInvoiceOutstanding");
  const invoiceCountEl = document.getElementById("rdInvoiceCount");
  const overviewOutstandingEl = document.getElementById(
    "rdOverviewOutstanding",
  );

  const isFrench = /^fr(?:-|$)/i.test(
    cfg.locale || document.documentElement.lang || "en",
  );
  if (!tbody) return;

  // ---- Billing tabs (CR01 §4.2) ----
  const TAB_INVOICES = "invoices";
  const TAB_CREDIT = "credit-notes";
  const sectionEl = document.getElementById("rd-invoices");
  const tabsEl = document.getElementById("rdBillingTabs");
  const creditStatsEl = document.getElementById("rdCreditStats");
  const creditMessageEl = document.getElementById("rdCreditMessage");
  const toolbarEl = sectionEl && sectionEl.querySelector(".rd-invoice-toolbar");
  const tableCardEl =
    sectionEl && sectionEl.querySelector(".rd-invoice-table-card");
  const theadRow =
    sectionEl && sectionEl.querySelector("table.rd-invoice-table thead tr");
  const invoiceTheadHtml = theadRow ? theadRow.innerHTML : "";
  const invoiceSearchPlaceholder = searchInput ? searchInput.placeholder : "";
  const invoiceBalanceOptions = balanceSelect ? balanceSelect.innerHTML : "";

  function t(en, fr) {
    return isFrench ? fr : en;
  }

  function initialTab() {
    try {
      return new URLSearchParams(window.location.search).get("tab") ===
        TAB_CREDIT
        ? TAB_CREDIT
        : TAB_INVOICES;
    } catch (e) {
      return TAB_INVOICES;
    }
  }

  let activeTab = initialTab();
  let loadSeq = 0;
  const tabCounts = {};
  tabCounts[TAB_INVOICES] = null;
  tabCounts[TAB_CREDIT] = null;
  const savedFilters = {};
  savedFilters[TAB_INVOICES] = { q: "", dateFrom: "", dateTo: "", balance: "" };
  savedFilters[TAB_CREDIT] = { q: "", dateFrom: "", dateTo: "", balance: "" };

  function isCreditTab() {
    return activeTab === TAB_CREDIT;
  }

  let page = 1;
  const pageSize = cfg.pageSize || 20;
  let totalPages = 1;
  let currentInvoice = null;
  let filterTimer = null;

  // PDF line capacity (header repeats each page; totals only on last).
  // No empty filler rows — real lines only; CSS pins "continued" to page bottom.
  const FULL_PAGE_LINES = 16;
  const LAST_PAGE_LINES = 11;

  function getFilters() {
    return {
      q: searchInput ? String(searchInput.value || "").trim() : "",
      dateFrom: dateFromInput ? String(dateFromInput.value || "").trim() : "",
      dateTo: dateToInput ? String(dateToInput.value || "").trim() : "",
      balance: balanceSelect ? String(balanceSelect.value || "").trim() : "",
    };
  }

  function buildListUrl(nextPage, options) {
    options = options || {};
    const filters = options.noFilters
      ? { q: "", dateFrom: "", dateTo: "", balance: "" }
      : getFilters();
    const tab = options.tab || activeTab;
    let url =
      cfg.proxyBase +
      "?page=" +
      encodeURIComponent(nextPage) +
      "&page_size=" +
      encodeURIComponent(options.pageSize || pageSize);
    if (tab === TAB_CREDIT) url += "&document_type=credit_note";
    if (filters.q) url += "&q=" + encodeURIComponent(filters.q);
    if (filters.dateFrom)
      url += "&date_from=" + encodeURIComponent(filters.dateFrom);
    if (filters.dateTo) url += "&date_to=" + encodeURIComponent(filters.dateTo);
    if (filters.balance)
      url += "&balance=" + encodeURIComponent(filters.balance);
    return url;
  }

  function scheduleFilterReload() {
    if (filterTimer) clearTimeout(filterTimer);
    filterTimer = setTimeout(function () {
      loadPage(1);
    }, 300);
  }

  const DEFAULT_COMPANY = {
    company_name: "INK QUEST",
    street_address1: "14617 134 Ave NW",
    street_address2: "Edmonton, AB T5L 4S9",
    telephone: "(780) 454-4321",
    fax: "(780) 452-5405",
    tax_registration_no: "139587877",
    returns_clause: "No returns without our written permission (RMA).",
    overdue_clause:
      "2% per month (24% annual) will be charged on overdue accounts.",
    claims_clause:
      "All claims must be made within 5 days after receipt of goods.",
    surcharge_clause: "A 3% charge may apply for any credit card bill payment",
  };

  function escapeHtml(value) {
    return String(value == null ? "" : value)
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;")
      .replace(/'/g, "&#039;");
  }

  function money(value, currency) {
    if (value === null || value === undefined || value === "") return "";
    const number = parseFloat(value);
    if (isNaN(number)) return escapeHtml(value);
    try {
      return new Intl.NumberFormat(isFrench ? "fr-CA" : "en-CA", {
        style: "currency",
        currency: currency || "CAD",
      }).format(number);
    } catch (e) {
      return escapeHtml(String(value));
    }
  }

  function formatDate(value) {
    if (!value) return "";
    const raw = String(value).slice(0, 10);
    const parts = raw.split("-");
    if (parts.length !== 3) return escapeHtml(raw);
    const d = new Date(Date.UTC(+parts[0], +parts[1] - 1, +parts[2]));
    if (isNaN(d.getTime())) return escapeHtml(raw);
    return escapeHtml(
      d.toLocaleDateString(isFrench ? "fr-CA" : "en-US", {
        month: "short",
        day: "numeric",
        year: "numeric",
        timeZone: "UTC",
      }),
    );
  }

  function addressLines(address) {
    if (!address) return "";
    return [
      address.name,
      address.address1,
      [address.city, address.province, address.postal]
        .filter(Boolean)
        .join(", "),
      address.country,
    ]
      .filter(Boolean)
      .map(escapeHtml)
      .join("<br>");
  }

  function qty(value) {
    if (value === null || value === undefined || value === "") return "";
    return escapeHtml(value);
  }

  function isCreditDoc(doc) {
    return !!doc && doc.document_type === "credit_note";
  }

  function resolveCompany(invoice) {
    const c = invoice && invoice.company ? invoice.company : {};
    return {
      logo_url: c.logo_url || cfg.logoUrl || "",
      company_name: c.company_name || DEFAULT_COMPANY.company_name,
      street_address1: c.street_address1 || DEFAULT_COMPANY.street_address1,
      street_address2: c.street_address2 || DEFAULT_COMPANY.street_address2,
      telephone: c.telephone || DEFAULT_COMPANY.telephone,
      fax: c.fax || DEFAULT_COMPANY.fax,
      tax_registration_no:
        c.tax_registration_no ||
        invoice.tax_registration_no ||
        DEFAULT_COMPANY.tax_registration_no,
      returns_clause: c.returns_clause || DEFAULT_COMPANY.returns_clause,
      overdue_clause: c.overdue_clause || DEFAULT_COMPANY.overdue_clause,
      claims_clause: c.claims_clause || DEFAULT_COMPANY.claims_clause,
      surcharge_clause: c.surcharge_clause || DEFAULT_COMPANY.surcharge_clause,
    };
  }

  function companyAddressHtml(company) {
    const lines = [];
    if (company.street_address1)
      lines.push(escapeHtml(company.street_address1));
    if (company.street_address2)
      lines.push(escapeHtml(company.street_address2));
    const phoneFax = [
      company.telephone ? "Tel: " + company.telephone : "",
      company.fax ? "Fax: " + company.fax : "",
    ]
      .filter(Boolean)
      .join(" | ");
    if (phoneFax) lines.push(escapeHtml(phoneFax));
    if (!lines.length) return "&nbsp;";
    return lines.join("<br>");
  }

  /**
   * Split lines for PDF so non-last pages are full (FULL_PAGE_LINES)
   * and the last page leaves room for the totals footer (LAST_PAGE_LINES).
   */
  function chunkLinesForPdf(lines) {
    if (!lines.length) return [[]];
    if (lines.length <= LAST_PAGE_LINES) return [lines.slice()];

    const chunks = [];
    let remaining = lines.slice();

    while (remaining.length > LAST_PAGE_LINES) {
      // Keep enough for a last page with footer
      const take = Math.min(
        FULL_PAGE_LINES,
        remaining.length - LAST_PAGE_LINES,
      );
      if (take <= 0) break;
      chunks.push(remaining.slice(0, take));
      remaining = remaining.slice(take);
    }
    chunks.push(remaining);
    return chunks;
  }

  function renderLineRows(pageLines, currency) {
    return pageLines
      .map(function (line) {
        return (
          "<tr>" +
          '<td class="c">' +
          qty(line.qty_ordered) +
          "</td>" +
          '<td class="c">' +
          qty(line.qty_shipped) +
          "</td>" +
          '<td class="c">' +
          qty(line.qty_backorder) +
          "</td>" +
          "<td>" +
          escapeHtml(line.item_number || "") +
          "</td>" +
          "<td>" +
          escapeHtml(line.description || "").replace(/\n/g, "<br>") +
          "</td>" +
          '<td class="r">' +
          (line.unit_price == null || line.unit_price === ""
            ? ""
            : money(line.unit_price, currency)) +
          "</td>" +
          '<td class="c">' +
          escapeHtml(line.uom || "") +
          "</td>" +
          '<td class="r">' +
          money(line.extended_price, currency) +
          "</td>" +
          "</tr>"
        );
      })
      .join("");
  }

  function buildPageHeader(invoice, company, logo, pageNo, pageCount, options) {
    options = options || {};
    const compact = !!options.compact;
    const pageLabel = pageNo + (pageCount > 1 ? " of " + pageCount : "");
    const gstNo = company.tax_registration_no || "";

    const brandBlock =
      '<div class="iq-accent"><div class="t"></div><div class="g"></div></div>' +
      '<div class="iq-hdr">' +
      "<div>" +
      (logo || "") +
      '<div class="iq-brand">' +
      escapeHtml(company.company_name || "INK QUEST") +
      "<small>(DIV. OF 605494 ALBERTA LTD)</small></div>" +
      '<div class="iq-co">' +
      escapeHtml(company.street_address1 || "") +
      (company.street_address2
        ? ", " + escapeHtml(company.street_address2)
        : "") +
      "<br>" +
      "Phone: " +
      escapeHtml(company.telephone || "") +
      " &nbsp;&nbsp; Fax: " +
      escapeHtml(company.fax || "") +
      (gstNo && !compact ? "<br>GST/HST No.: " + escapeHtml(gstNo) : "") +
      "</div>" +
      "</div>" +
      '<div class="iq-invtitle">' +
      (compact && pageNo > 1
        ? '<div class="iq-contfrom">Continued from page ' +
          (pageNo - 1) +
          "</div>"
        : "") +
      '<div class="t">' +
      (isCreditDoc(invoice) ? "CREDIT NOTE" : "INVOICE") +
      "</div>" +
      "<h1>" +
      escapeHtml(invoice.invoice_number || "") +
      "</h1>" +
      (isCreditDoc(invoice) && invoice.related_invoice_number
        ? '<div class="iq-contfrom">Related invoice: ' +
          escapeHtml(invoice.related_invoice_number) +
          "</div>"
        : "") +
      (compact
        ? ""
        : '<div class="iq-dpt">' +
          "<div><span>DATE</span><b>" +
          formatDate(invoice.invoice_date) +
          "</b></div>" +
          "<div><span>PAGE</span><b>" +
          escapeHtml(pageLabel) +
          "</b></div>" +
          "<div><span>TERMS</span><b>" +
          escapeHtml(invoice.terms || "") +
          "</b></div>" +
          "</div>") +
      "</div>" +
      "</div>";

    if (compact) {
      return (
        brandBlock +
        '<div class="iq-meta1">' +
        "<div><b>CUSTOMER:</b> " +
        escapeHtml((invoice.sold_to && invoice.sold_to.name) || "") +
        "</div>" +
        "<div><b>ORDER NO.:</b> " +
        escapeHtml(invoice.order_no || "") +
        "</div>" +
        "<div><b>DATE:</b> " +
        formatDate(invoice.invoice_date) +
        "</div>" +
        "<div><b>PAGE:</b> " +
        escapeHtml(pageLabel) +
        "</div>" +
        "</div>"
      );
    }

    return (
      brandBlock +
      '<div class="iq-addr">' +
      '<div><div class="iq-lbl">SOLD TO</div><p>' +
      addressLines(invoice.sold_to) +
      "</p></div>" +
      '<div><div class="iq-lbl">SHIP TO</div><p>' +
      addressLines(invoice.ship_to) +
      "</p></div>" +
      "</div>" +
      '<div class="iq-meta">' +
      "<div><span>CUSTOMER NO.</span>" +
      escapeHtml(invoice.customer_no || "") +
      "</div>" +
      "<div><span>ORDER DATE</span>" +
      formatDate(invoice.order_date) +
      "</div>" +
      "<div><span>ORDER NO.</span>" +
      escapeHtml(invoice.order_no || "") +
      "</div>" +
      "<div><span>SALESPERSON</span>" +
      escapeHtml(invoice.salesperson || "") +
      "</div>" +
      "<div><span>PO NUMBER</span>" +
      escapeHtml(invoice.po_number || "") +
      "</div>" +
      "<div><span>SHIP VIA</span>" +
      escapeHtml(invoice.ship_via || "") +
      "</div>" +
      "<div><span>TERMS</span>" +
      escapeHtml(invoice.terms || "") +
      "</div>" +
      "<div><span>GST/HST NO.</span>" +
      escapeHtml(gstNo) +
      "</div>" +
      "</div>"
    );
  }

  /** GST / legal / tax / totals — last page only (and single-page View). */
  function buildTotalsFooter(company, invoice, taxRows, currency) {
    return (
      '<div class="iq-bottom">' +
      '<div class="iq-left">' +
      '<div class="iq-gst">GST/HST No.: ' +
      escapeHtml(company.tax_registration_no || "") +
      "</div>" +
      "<p>" +
      escapeHtml(company.returns_clause) +
      "</p>" +
      "<p>" +
      escapeHtml(company.overdue_clause) +
      "</p>" +
      "<p>" +
      escapeHtml(company.claims_clause) +
      "</p>" +
      "<p>" +
      escapeHtml(company.surcharge_clause) +
      "</p>" +
      '<div class="iq-pm">' +
      "<h3>PAYMENT METHODS</h3>" +
      "<h4>Wire/EFT</h4>" +
      "<p>Institution Number: 003</p>" +
      "<p>Transit: 07378</p>" +
      "<p>Account number: 1027812</p>" +
      '<div class="iq-pm-sub">' +
      "<h4>Bill Payment</h4>" +
      "<p>Ink Quest</p>" +
      "</div>" +
      "</div>" +
      "</div>" +
      '<div class="iq-right">' +
      '<div class="iq-taxbox">' +
      "<h3>TAX SUMMARY</h3>" +
      taxRows +
      "</div>" +
      '<div class="iq-trow"><span>Subtotal</span><span>' +
      money(invoice.subtotal, currency) +
      "</span></div>" +
      '<div class="iq-trow"><span>Total sales tax</span><span>' +
      money(invoice.total_tax, currency) +
      "</span></div>" +
      '<div class="iq-trow"><span>Total amount</span><span>' +
      money(invoice.total_amount, currency) +
      "</span></div>" +
      '<div class="iq-trow"><span>' +
      (isCreditDoc(invoice) ? "Credit applied" : "Less payment") +
      "</span><span>" +
      money(invoice.less_payment, currency) +
      "</span></div>" +
      '<div class="iq-due"><span>' +
      (isCreditDoc(invoice) ? "Remaining credit" : "Amount due") +
      "</span><span>" +
      money(invoice.amount_due, currency) +
      "</span></div>" +
      "</div>" +
      "</div>"
    );
  }

  function buildItemsTable(pageLines, currency, rangeLabel) {
    return (
      '<div class="iq-itemsbar">' +
      "<h3>LINE ITEMS" +
      (rangeLabel ? ": " + escapeHtml(rangeLabel) : "") +
      "</h3>" +
      "</div>" +
      '<table class="iq-items">' +
      "<thead><tr>" +
      '<th class="c">Qty Ord.</th><th class="c">Qty Shp.</th><th class="c">B/O</th>' +
      "<th>Item Number</th><th>Description</th>" +
      '<th class="r">Unit Price</th><th class="c">UOM</th><th class="r">Extended Price</th>' +
      "</tr></thead><tbody>" +
      renderLineRows(pageLines, currency) +
      "</tbody>" +
      "</table>"
    );
  }

  function buildPageFoot(invoice, company, pageNo, pageCount) {
    const pageLabel = pageNo + (pageCount > 1 ? " of " + pageCount : "");
    return (
      '<div class="iq-foot">' +
      "<span>" +
      escapeHtml(company.company_name || "INK QUEST") +
      " &nbsp;&bull;&nbsp; " +
      escapeHtml(company.street_address1 || "") +
      (company.street_address2
        ? ", " + escapeHtml(company.street_address2)
        : "") +
      "</span>" +
      "<span>" +
      (isCreditDoc(invoice) ? "Credit note " : "Invoice ") +
      escapeHtml(invoice.invoice_number || "") +
      " &nbsp;&bull;&nbsp; Page " +
      escapeHtml(pageLabel) +
      "</span>" +
      "</div>"
    );
  }

  /**
   * @param {object} invoice
   * @param {{ forPdf?: boolean }} [options]
   *  View (forPdf false): one continuous page, header once, footer once at end.
   *  PDF (forPdf true): paginate lines, repeat header each page, footer only on last page.
   */
  function buildInvoiceHtml(invoice, options) {
    if (isFrench) return buildFrenchInvoiceHtml(invoice, options);
    options = options || {};
    const forPdf = !!options.forPdf;
    const lines = Array.isArray(invoice.lines) ? invoice.lines : [];
    const taxLines = Array.isArray(invoice.tax_lines) ? invoice.tax_lines : [];
    const currency = invoice.currency || "CAD";
    const company = resolveCompany(invoice);
    const logo = company.logo_url
      ? '<img class="iq-logo" src="' +
        escapeHtml(company.logo_url) +
        '" alt="' +
        escapeHtml(company.company_name) +
        '">'
      : "";

    const taxRows =
      taxLines
        .map(function (tax) {
          return (
            '<div class="iq-trow"><span>' +
            escapeHtml(tax.code || "") +
            "</span><span>" +
            money(tax.amount, currency) +
            "</span></div>"
          );
        })
        .join("") +
      '<div class="iq-trow"><span>Tax Exempt Code</span><span>' +
      escapeHtml(invoice.tax_exempt_code || "") +
      "</span></div>";

    // On-screen View: single document, no repeated headers
    if (!forPdf) {
      return (
        '<div class="iq-invoice">' +
        '<section class="iq-page iq-page-last">' +
        buildPageHeader(invoice, company, logo, 1, 1) +
        buildItemsTable(
          lines,
          currency,
          lines.length ? "1 – " + lines.length : "",
        ) +
        buildTotalsFooter(company, invoice, taxRows, currency) +
        buildPageFoot(invoice, company, 1, 1) +
        "</section>" +
        "</div>"
      );
    }

    // PDF download: paginate with repeated headers; footer only on last page.
    const chunks = options.chunks || chunkLinesForPdf(lines);
    const pageCount = chunks.length;
    let lineStart = 1;

    return (
      '<div class="iq-invoice">' +
      chunks
        .map(function (pageLines, idx) {
          const pageNo = idx + 1;
          const isLast = pageNo === pageCount;
          const lineEnd = lineStart + pageLines.length - 1;
          const rangeLabel = pageLines.length
            ? lineStart + " – " + lineEnd
            : "";
          lineStart = lineEnd + 1;
          return (
            '<section class="iq-page' +
            (isLast ? " iq-page-last" : "") +
            '">' +
            buildPageHeader(invoice, company, logo, pageNo, pageCount, {
              compact: pageNo > 1,
            }) +
            buildItemsTable(pageLines, currency, rangeLabel) +
            (isLast
              ? buildTotalsFooter(company, invoice, taxRows, currency)
              : '<div class="iq-cont">Continued on next page…</div>') +
            buildPageFoot(invoice, company, pageNo, pageCount) +
            "</section>"
          );
        })
        .join("") +
      "</div>"
    );
  }

  const FRENCH_INVOICE_CSS =
    "\n  .iq-invoice { font-family: 'Poppins', 'Helvetica Neue', Arial, sans-serif; color: #1c2b33; max-width: 8.5in; margin: 0 auto; }\n  .iq-invoice * { box-sizing: border-box; }\n  .iq-page { width: 8.5in; min-height: 11in; padding: 0.35in 0.55in 0.3in; position: relative; background: #fff; }\n  /* Header band (dark teal) */\n  .iq-band { background: #00404c; color: #fff; display: flex; justify-content: space-between;\n             align-items: flex-start; padding: 12px 24px; }\n  .iq-band .iq-brand { font-size: 20px; font-weight: 700; letter-spacing: 5px; }\n  .iq-band .iq-brand small { display: block; font-size: 10px; font-weight: 400; letter-spacing: 0.5px; margin-top: 6px; }\n  .iq-band .iq-co { font-size: 10px; line-height: 1.6; margin-top: 6px; }\n  .iq-band .iq-invtitle { text-align: right; }\n  .iq-band .iq-invtitle h1 { font-size: 26px; font-weight: 700; margin: 0 0 8px; letter-spacing: 1px; }\n  .iq-band .iq-invtitle p { font-size: 11px; margin: 0; line-height: 1.6; }\n  /* Slim continued band (later pages) */\n  .iq-band-slim { background: #00404c; color: #fff; display: flex; justify-content: space-between;\n                  align-items: center; padding: 12px 24px; }\n  .iq-band-slim .iq-brand { font-size: 15px; font-weight: 700; letter-spacing: 4px; }\n  .iq-band-slim p { font-size: 12px; margin: 0; }\n  /* Addresses */\n  .iq-addr { display: flex; gap: 20px; margin-top: 12px; }\n  .iq-addr > div { flex: 1; border: 1px solid #d9e0de; padding: 10px 16px; }\n  .iq-lbl { font-size: 11px; font-weight: 700; letter-spacing: 0.5px; color: #00404c; margin-bottom: 5px; }\n  .iq-addr p { font-size: 11.5px; line-height: 1.55; margin: 0; }\n  .iq-addr p b { font-weight: 700; }\n  /* Order meta strip */\n  .iq-meta { display: flex; margin-top: 12px; border: 1px solid #d9e0de; }\n  .iq-meta div { flex: 1; padding: 6px 8px; font-size: 11px; }\n  .iq-meta span { display: block; font-size: 8.5px; font-weight: 600; letter-spacing: 0.2px; color: #5b6b72; margin-bottom: 4px; }\n  /* Sample-data badge */\n  .iq-badge { font-size: 10px; font-weight: 700; color: #8a6d00; margin: 10px 0 6px; letter-spacing: 0.3px; }\n  /* Line items table */\n  .iq-items { width: 100%; border-collapse: collapse; table-layout: fixed; font-size: 11px; }\n  .iq-items th { background: #00404c; color: #fff; font-size: 10.5px; font-weight: 700;\n                 padding: 6px 6px; text-align: left; vertical-align: middle; }\n  .iq-items td { padding: 2px 4px; border-bottom: 1px solid #e6ebea; border-left: 1px solid #eef1f0;\n                 vertical-align: top; font-size: 10.5px; line-height: 1.25; overflow-wrap: break-word; }\n  .iq-items td:first-child { border-left: none; }\n  .iq-items .c { text-align: center; } .iq-items .r { text-align: right; }\n  .iq-cont { text-align: center; font-size: 12.5px; font-weight: 700; color: #00404c; padding-top: 10px; }\n  /* Bottom two-column section */\n  .iq-bottom { display: flex; gap: 22px; margin-top: 16px; }\n  .iq-left { flex: 1.15; font-size: 12px; }\n  .iq-gst { font-size: 12.5px; font-weight: 700; color: #00404c; margin-bottom: 8px; }\n  .iq-left p { margin: 0 0 5px; line-height: 1.5; }\n  .iq-pm { border-top: 1px solid #d9e0de; margin-top: 16px; padding-top: 12px; }\n  .iq-pm h3 { font-size: 11px; font-weight: 700; color: #00404c; letter-spacing: 0.5px; margin: 0 0 8px; }\n  .iq-pm h4 { font-size: 11px; font-weight: 700; margin: 8px 0 4px; }\n  .iq-pm-sub { border-top: 1px dashed #d9e0de; margin-top: 10px; padding-top: 10px; }\n  .iq-right { flex: 1; }\n  .iq-taxbox { background: #f2f5f4; padding: 12px 16px 16px; margin-bottom: 14px; }\n  .iq-taxbox h3 { font-size: 11px; font-weight: 700; letter-spacing: 0.5px; color: #00404c; margin: 0 0 8px; }\n  .iq-trow { display: flex; justify-content: space-between; font-size: 12px; padding: 5px 0; }\n  .iq-due { background: #2ea05f; color: #fff; display: flex;\n            justify-content: space-between; align-items: center;\n            padding: 12px 16px; margin-top: 10px; font-size: 15px; font-weight: 700; }\n  .iq-foot { text-align: center; font-size: 11px; color: #5b6b72;\n             border-top: 1px solid #d9e0de; padding-top: 10px; margin-top: 16px; }\n  @media print {\n    @page { size: letter; margin: 0; }\n    .iq-page { page-break-after: always; }\n    .iq-page:last-child { page-break-after: auto; }\n  }\n.iq-fr-logo{display:block;width:160px;max-width:100%;height:auto;max-height:64px;object-fit:contain;background:#fff;padding:6px;}.iq-band-slim .iq-fr-logo{width:120px;max-height:44px;}";
  function buildFrenchInvoiceHtml(data, options) {
    const credit = isCreditDoc(data);
    const company = resolveCompany(data);
    const logo = company.logo_url
      ? '<img class="iq-fr-logo" src="' +
        escapeHtml(company.logo_url) +
        '" alt="' +
        escapeHtml(company.company_name) +
        '">'
      : escapeHtml(company.company_name);
    const amount = (value) =>
      value == null || value === ""
        ? ""
        : Number.isFinite(Number(value))
        ? new Intl.NumberFormat("fr-CA", {
            minimumFractionDigits: 2,
            maximumFractionDigits: 2,
          }).format(Number(value))
        : escapeHtml(value);
    const invoice = Object.assign({}, data, {
      number: data.invoice_number,
      date: formatDate(data.invoice_date),
      order_date: formatDate(data.order_date),
    });
    invoice.sold_to = Object.assign({}, data.sold_to, {
      addr1: data.sold_to && data.sold_to.address1,
    });
    invoice.ship_to = Object.assign({}, data.ship_to, {
      addr1: data.ship_to && data.ship_to.address1,
    });
    const lines = (data.lines || []).map((line) =>
      Object.assign({}, line, {
        qty_ord: line.qty_ordered,
        qty_shp: line.qty_shipped,
        bo: line.qty_backorder,
      }),
    );
    const pages =
      options && options.forPdf
        ? options.chunks || chunkLinesForPdf(lines)
        : [lines];
    return (
      "<style>" +
      FRENCH_INVOICE_CSS +
      '</style><div class="iq-invoice">' +
      pages
        .map(
          (pageLines, index) => `  <section class="iq-page">
    ${
      index === 0
        ? `
    <div class="iq-band">
      <div>
        <div class="iq-brand">${logo}<small>(DIV. DE 605494 ALBERTA LTD)</small></div>
        <div class="iq-co">14617 - 134 Ave NW, Edmonton, AB T5L 4S9<br>
          Tél. : (780) 454-4321 &nbsp;&bull;&nbsp; Téléc. : (780) 452-5405</div>
      </div>
      <div class="iq-invtitle">
        <h1>${credit ? "NOTE DE CRÉDIT" : "FACTURE"}</h1>
        <p>${
          credit ? "Numéro de note de crédit" : "Numéro de facture"
        } : ${escapeHtml(invoice.number)}<br>
          ${
            credit && data.related_invoice_number
              ? "Facture associée : " +
                escapeHtml(data.related_invoice_number) +
                "<br>"
              : ""
          }
          Date : ${escapeHtml(
            invoice.date,
          )} &nbsp;&bull;&nbsp; Page ${escapeHtml(index + 1)} de ${escapeHtml(
            pages.length,
          )}</p>
      </div>
    </div>

    <div class="iq-addr">
      <div>
        <div class="iq-lbl">VENDU À</div>
        <p><b>${escapeHtml(invoice.sold_to.name)}</b><br>
          ${escapeHtml(invoice.sold_to.addr1)}<br>
          ${escapeHtml(invoice.sold_to.city)}, ${escapeHtml(
            invoice.sold_to.province,
          )} ${escapeHtml(invoice.sold_to.postal)}<br>
          ${escapeHtml(invoice.sold_to.country)}</p>
      </div>
      <div>
        <div class="iq-lbl">EXPÉDIÉ À</div>
        <p><b>${escapeHtml(invoice.ship_to.name)}</b><br>
          ${escapeHtml(invoice.ship_to.addr1)}<br>
          ${escapeHtml(invoice.ship_to.city)}, ${escapeHtml(
            invoice.ship_to.province,
          )} ${escapeHtml(invoice.ship_to.postal)}<br>
          ${escapeHtml(invoice.ship_to.country)}</p>
      </div>
    </div>

    <div class="iq-meta">
      <div style="flex:1.1"><span>Nº DE CLIENT</span>${escapeHtml(
        invoice.customer_no,
      )}</div>
      <div style="flex:1.3"><span>DATE DE COMMANDE</span>${escapeHtml(
        invoice.order_date,
      )}</div>
      <div style="flex:1.2"><span>Nº DE COMMANDE</span>${escapeHtml(
        invoice.order_no,
      )}</div>
      <div><span>VENDEUR</span>${escapeHtml(invoice.salesperson)}</div>
      <div style="flex:1.3"><span>BON DE COMMANDE</span>${escapeHtml(
        invoice.po_number,
      )}</div>
      <div><span>EXPÉDIÉ PAR</span>${escapeHtml(invoice.ship_via)}</div>
      <div><span>CONDITIONS</span>${escapeHtml(invoice.terms)}</div>
    </div>
    `
        : `
    <div class="iq-band-slim">
      <div class="iq-brand">${logo}</div>
      <p>${credit ? "Note de crédit" : "Facture"} ${escapeHtml(
            invoice.number,
          )} &mdash; Suite &nbsp;&bull;&nbsp; ${escapeHtml(
            invoice.date,
          )} &nbsp;&bull;&nbsp; Page ${escapeHtml(index + 1)} de ${escapeHtml(
            pages.length,
          )}</p>
    </div>
    `
    }

    <table class="iq-items">
      <colgroup><col style="width:6.2%"><col style="width:6.2%"><col style="width:4.9%"><col style="width:13.3%"><col style="width:43.3%"><col style="width:9.8%"><col style="width:6.2%"><col style="width:10.1%"></colgroup>

<tr>
  <th class="c">Qté<br>comm.</th><th class="c">Qté<br>exp.</th><th class="c">En<br>att.</th>
  <th>Nº d'article</th><th>Description</th>
  <th class="r">Prix<br>unitaire</th><th class="c">Unité</th><th class="r">Prix<br>étendu</th>
</tr>

      ${pageLines
        .map(
          (line) => `
      <tr>
        <td class="c">${escapeHtml(line.qty_ord)}</td>
        <td class="c">${escapeHtml(line.qty_shp)}</td>
        <td class="c">${escapeHtml(line.bo)}</td>
        <td>${escapeHtml(line.item_number)}</td>
        <td>${escapeHtml(line.description)}</td>
        <td class="r">${amount(line.unit_price)}</td>
        <td class="c">${escapeHtml(line.uom)}</td>
        <td class="r">${amount(line.extended_price)}</td>
      </tr>
      `,
        )
        .join("")}
    </table>

    ${
      index === pages.length - 1
        ? `

<div class="iq-bottom">
  <div class="iq-left">
    <div class="iq-gst">Nº de TPS/TVH : 139587877</div>
    <p>Aucun retour sans notre autorisation écrite (RMA).</p>
    <p>Des frais de 2 % par mois (24 % par année) seront facturés sur les comptes en souffrance.</p>
    <p>Toute réclamation doit être faite dans les 5 jours suivant la réception des marchandises.</p>
    <p>Des frais de 3 % peuvent s'appliquer à tout paiement par carte de crédit.</p>
    <div class="iq-pm">
      <h3>MODES DE PAIEMENT</h3>
      <h4>Virement/TÉF</h4>
      <p>Numéro d'institution : 003</p>
      <p>Transit : 07378</p>
      <p>Numéro de compte : 1027812</p>
      <div class="iq-pm-sub">
        <h4>Paiement de facture</h4>
        <p>Ink Quest</p>
      </div>
    </div>
  </div>
  <div class="iq-right">
    <div class="iq-taxbox">
      <h3>SOMMAIRE DES TAXES</h3>
      ${(data.tax_lines || [])
        .map(
          (tax) =>
            '<div class="iq-trow"><span>' +
            escapeHtml(tax.code) +
            "</span><span>" +
            amount(tax.amount) +
            "</span></div>",
        )
        .join("")}
      <div class="iq-trow"><span>Code d'exemption de taxe</span><span>${escapeHtml(
        invoice.tax_exempt_code,
      )}</span></div>
    </div>
    <div class="iq-trow"><span>Sous-total</span><span>${amount(
      invoice.subtotal,
    )}</span></div>
    <div class="iq-trow"><span>Total des taxes de vente</span><span>${amount(
      invoice.total_tax,
    )}</span></div>
    <div class="iq-trow"><span>Montant total</span><span>${amount(
      invoice.total_amount,
    )}</span></div>
    <div class="iq-trow"><span>${
      credit ? "Crédit appliqué" : "Moins paiement"
    }</span><span>${amount(invoice.less_payment)}</span></div>
    <div class="iq-due"><span>${
      credit ? "Crédit restant" : "Montant dû"
    }</span><span>${amount(invoice.amount_due)}</span></div>
  </div>
</div>

    `
        : `
    <div class="iq-cont">Suite à la page suivante&hellip;</div>
    `
    }

    <div class="iq-foot">INK QUEST &nbsp;&bull;&nbsp; 14617 &ndash; 134 Ave NW, Edmonton, AB T5L 4S9</div>
  </section>`,
        )
        .join("") +
      "</div>"
    );
  }

  async function fetchJson(url) {
    console.log("[RD Invoices] request", {
      url: url,
      customerId: cfg.customerId,
      loggedIn: cfg.loggedIn,
    });
    const res = await fetch(url, {
      credentials: "same-origin",
      headers: { Accept: "application/json" },
    });
    const body = await res.json().catch(function () {
      return {};
    });
    console.log("[RD Invoices] response", {
      url: url,
      status: res.status,
      ok: res.ok,
      body: body,
    });
    if (!res.ok) {
      const err = new Error(
        body.error || "Request failed (" + res.status + ")",
      );
      err.status = res.status;
      throw err;
    }
    return body;
  }

  function paymentStatus(inv) {
    const raw = inv && inv.amount_due;
    if (raw == null || String(raw).trim() === "") {
      return { label: isFrench ? "Inconnu" : "Unknown", cls: "processing" };
    }
    const n = Number(String(raw).replace(/,/g, ""));
    if (!Number.isFinite(n)) {
      return { label: isFrench ? "Inconnu" : "Unknown", cls: "processing" };
    }
    if (n <= 0) {
      return { label: isFrench ? "Payée" : "Paid", cls: "paid" };
    }
    return { label: isFrench ? "À payer" : "Due", cls: "pending" };
  }

  function renderEmpty() {
    tbody.innerHTML =
      '<tr><td colspan="8"><div class="rd-invoice-empty">' +
      "<h3>" +
      (isFrench ? "Aucune facture" : "No invoices") +
      "</h3>" +
      "<p>" +
      (isFrench
        ? "Aucune facture disponible pour votre compte."
        : "There are no invoices for your account right now.") +
      "</p>" +
      '<button type="button" class="rd-invoice-refresh" id="rdInvoiceRefresh">' +
      (isFrench ? "Actualiser" : "Refresh") +
      "</button>" +
      "</div></td></tr>";
    if (pager) pager.hidden = true;
    const refreshBtn = document.getElementById("rdInvoiceRefresh");
    if (refreshBtn) {
      refreshBtn.addEventListener("click", function () {
        loadPage(1);
      });
    }
  }

  function updateStats(meta) {
    meta = meta || {};
    if (statsEl && !isCreditTab()) {
      statsEl.hidden = false;
      statsEl.removeAttribute("hidden");
      statsEl.style.display = "";
    }
    const summary = meta.summary;
    if (invoiceCountEl) {
      invoiceCountEl.textContent = summary
        ? String(summary.total_invoices)
        : "?";
    }
    const valueEl = document.getElementById("rdInvoiceValue");
    const paidEl = document.getElementById("rdInvoicePaid");
    const pendingEl = document.getElementById("rdInvoicePending");
    if (paidEl) paidEl.textContent = summary ? String(summary.paid) : "?";
    if (pendingEl)
      pendingEl.textContent = summary ? String(summary.pending) : "?";
    if (valueEl) {
      valueEl.innerHTML = summary
        ? summary.totals_by_currency.length
          ? summary.totals_by_currency
              .map(function (total) {
                return money(total.total_value, total.currency);
              })
              .join("<br>")
          : money("0.00", meta.outstanding_currency || "CAD")
        : "?";
    }
    var outstandingText = "—";
    if (meta.outstanding_balance != null && meta.outstanding_balance !== "") {
      outstandingText = money(
        meta.outstanding_balance,
        meta.outstanding_currency || "CAD",
      );
    } else if (meta.total === 0) {
      outstandingText = money("0.00", meta.outstanding_currency || "CAD");
    }
    if (outstandingEl) outstandingEl.innerHTML = outstandingText;
    if (overviewOutstandingEl)
      overviewOutstandingEl.innerHTML = outstandingText;
  }

  function setPdfButtonState(invoice) {
    if (!pdfBtn) return;
    const ok = invoice && invoice.downloadable !== false;
    pdfBtn.disabled = !ok;
    pdfBtn.title = ok
      ? "Download PDF"
      : "Invoice cannot be downloaded — required totals missing";
    pdfBtn.style.opacity = ok ? "" : "0.45";
    pdfBtn.style.pointerEvents = ok ? "" : "none";
  }

  function renderRows(invoices) {
    if (!invoices.length) {
      renderEmpty();
      return;
    }

    tbody.innerHTML = invoices
      .map(function (inv) {
        const canDownload = inv.downloadable !== false;
        const pdfBtnHtml = canDownload
          ? '<button type="button" class="rd-invoice-action send" title="Download PDF" data-invoice-pdf="' +
            escapeHtml(inv.id) +
            '">PDF</button>'
          : '<button type="button" class="rd-invoice-action send" title="Not downloadable" disabled style="opacity:.45;cursor:not-allowed;">PDF</button>';

        const pay = paymentStatus(inv);
        return (
          "<tr>" +
          '<td><div class="rd-invoice-number">' +
          escapeHtml(inv.invoice_number) +
          "</div></td>" +
          "<td>" +
          formatDate(inv.invoice_date) +
          "</td>" +
          '<td><div class="rd-invoice-order">' +
          escapeHtml(inv.order_no || "") +
          "</div></td>" +
          "<td>" +
          escapeHtml(inv.po_number || "") +
          "</td>" +
          '<td class="rd-invoice-total">' +
          money(inv.total_amount, inv.currency) +
          "</td>" +
          '<td class="rd-invoice-total">' +
          money(inv.amount_due, inv.currency) +
          "</td>" +
          '<td><span class="rd-invoice-badge ' +
          pay.cls +
          '">' +
          escapeHtml(pay.label) +
          "</span></td>" +
          '<td><div class="rd-invoice-actions">' +
          '<button type="button" class="rd-invoice-action" title="View Invoice" data-invoice-id="' +
          escapeHtml(inv.id) +
          '">' +
          (isFrench ? "Voir" : "View") +
          "</button>" +
          pdfBtnHtml +
          "</div></td>" +
          "</tr>"
        );
      })
      .join("");

    tbody.querySelectorAll("[data-invoice-id]").forEach(function (btn) {
      btn.addEventListener("click", function () {
        openInvoice(btn.getAttribute("data-invoice-id"));
      });
    });
    tbody.querySelectorAll("[data-invoice-pdf]").forEach(function (btn) {
      btn.addEventListener("click", function () {
        downloadInvoicePdf(btn.getAttribute("data-invoice-pdf"));
      });
    });
  }

  function updatePager(meta) {
    if (!pager || !meta) return;
    totalPages = meta.totalPages || 1;
    page = meta.page || 1;
    pager.hidden = !meta.total;
    pagerInfo.textContent = meta.total
      ? "Page " +
        page +
        (isFrench ? " de " : " of ") +
        totalPages +
        " - " +
        meta.total +
        (isCreditTab()
          ? t(" credit notes", " notes de crédit")
          : t(" invoices", " factures"))
      : "";
    prevBtn.disabled = page <= 1;
    nextBtn.disabled = page >= totalPages;
  }

  // ---------- Credit notes (CR01 §4.4) ----------

  /** Display-only status; amounts are never changed. */
  function creditStatus(doc) {
    const total = Number(doc && doc.total_amount);
    const due = Number(doc && doc.amount_due);
    const hasDue =
      doc && doc.amount_due != null && String(doc.amount_due).trim() !== "";
    if (!hasDue || !Number.isFinite(due)) {
      return { label: t("Unknown", "Inconnu"), cls: "processing" };
    }
    if (due === 0) return { label: t("Applied", "Appliquée"), cls: "paid" };
    if (Number.isFinite(total) && due === total)
      return { label: t("Open", "Ouverte"), cls: "pending" };
    return {
      label: t("Partially applied", "Partiellement appliquée"),
      cls: "processing",
    };
  }

  function creditColumns() {
    return [
      t("Status", "Statut"),
      t("Credit note", "Note de crédit"),
      t("Related invoice", "Facture associée"),
      t("Order", "Commande"),
      t("PO Number", "Bon de commande"),
      t("Date", "Date"),
      t("Total", "Total"),
      t("Remaining credit", "Crédit restant"),
      t("Actions", "Actions"),
    ];
  }

  function colspan() {
    return isCreditTab() ? 9 : 8;
  }

  function renderCreditRows(docs) {
    const cols = creditColumns();
    if (!docs.length) {
      tbody.innerHTML =
        '<tr><td colspan="9"><div class="rd-invoice-empty"><p>' +
        t(
          "No credit notes match your filters.",
          "Aucune note de crédit ne correspond à vos filtres.",
        ) +
        "</p></div></td></tr>";
      return;
    }
    const cell = function (i, html, cls) {
      return (
        "<td" +
        (cls ? ' class="' + cls + '"' : "") +
        ' data-label="' +
        escapeHtml(cols[i]) +
        '">' +
        html +
        "</td>"
      );
    };
    tbody.innerHTML = docs
      .map(function (doc) {
        const st = creditStatus(doc);
        const canDownload = doc.downloadable !== false;
        return (
          "<tr>" +
          cell(
            0,
            '<span class="rd-invoice-badge ' +
              st.cls +
              '">' +
              escapeHtml(st.label) +
              "</span>",
          ) +
          cell(
            1,
            '<div class="rd-invoice-number">' +
              escapeHtml(doc.invoice_number) +
              "</div>",
          ) +
          cell(2, escapeHtml(doc.related_invoice_number || "")) +
          cell(
            3,
            '<div class="rd-invoice-order">' +
              escapeHtml(doc.order_no || "") +
              "</div>",
          ) +
          cell(4, escapeHtml(doc.po_number || "")) +
          cell(5, formatDate(doc.invoice_date)) +
          cell(6, money(doc.total_amount, doc.currency), "rd-invoice-total") +
          cell(7, money(doc.amount_due, doc.currency), "rd-invoice-total") +
          cell(
            8,
            '<div class="rd-invoice-actions">' +
              '<button type="button" class="rd-invoice-action" title="' +
              escapeHtml(t("View credit note", "Voir la note de crédit")) +
              '" data-invoice-id="' +
              escapeHtml(doc.id) +
              '">' +
              t("View", "Voir") +
              "</button>" +
              (canDownload
                ? '<button type="button" class="rd-invoice-action send" title="' +
                  escapeHtml(t("Download PDF", "Télécharger le PDF")) +
                  '" data-invoice-pdf="' +
                  escapeHtml(doc.id) +
                  '">PDF</button>'
                : '<button type="button" class="rd-invoice-action send" title="' +
                  escapeHtml(t("Not downloadable", "Non téléchargeable")) +
                  '" disabled style="opacity:.45;cursor:not-allowed;">PDF</button>') +
              "</div>",
          ) +
          "</tr>"
        );
      })
      .join("");
    bindRowActions();
  }

  function bindRowActions() {
    tbody.querySelectorAll("[data-invoice-id]").forEach(function (btn) {
      btn.addEventListener("click", function () {
        openInvoice(btn.getAttribute("data-invoice-id"));
      });
    });
    tbody.querySelectorAll("[data-invoice-pdf]").forEach(function (btn) {
      btn.addEventListener("click", function () {
        downloadInvoicePdf(btn.getAttribute("data-invoice-pdf"));
      });
    });
  }

  function statTile(label, icon, valueHtml, sub) {
    return (
      '<div class="rd-invoice-stat">' +
      '<div class="rd-invoice-stat-top"><div class="rd-invoice-stat-label">' +
      escapeHtml(label) +
      '</div><div class="rd-invoice-stat-icon" aria-hidden="true">' +
      icon +
      "</div></div>" +
      '<div class="rd-invoice-stat-value">' +
      valueHtml +
      "</div>" +
      '<div class="rd-invoice-stat-sub">' +
      escapeHtml(sub) +
      "</div></div>"
    );
  }

  function updateCreditStats(summary) {
    if (!creditStatsEl) return;
    const totals = (summary && summary.totals_by_currency) || [];
    const perCurrency = function (key) {
      if (!summary) return "?";
      if (!totals.length) return money("0.00", "CAD");
      return totals
        .map(function (row) {
          return money(row[key] == null ? "0" : row[key], row.currency);
        })
        .join("<br>");
    };
    const openCount = totals.reduce(function (sum, row) {
      return sum + (Number(row.open_count) || 0);
    }, 0);
    creditStatsEl.innerHTML =
      statTile(
        t("Total credit notes", "Total des notes de crédit"),
        "#",
        summary ? escapeHtml(String(summary.total_invoices)) : "?",
        t("All credit notes", "Toutes les notes de crédit"),
      ) +
      statTile(
        t("Total credit value", "Valeur totale des crédits"),
        "$",
        perCurrency("total_value"),
        t("Total credited amount", "Montant total crédité"),
      ) +
      statTile(
        t("Remaining credit", "Crédit restant"),
        "$",
        perCurrency("remaining"),
        isFrench
          ? openCount +
              (openCount === 1
                ? " note de crédit ouverte"
                : " notes de crédit ouvertes")
          : openCount +
              (openCount === 1 ? " open credit note" : " open credit notes"),
      );
  }

  function showCreditEmptyState(isEmpty) {
    if (creditMessageEl) {
      creditMessageEl.hidden = !isEmpty;
      creditMessageEl.className = "rd-invoice-empty";
      creditMessageEl.textContent = isEmpty
        ? t("You have no credit notes.", "Vous n’avez aucune note de crédit.")
        : "";
    }
    if (toolbarEl) toolbarEl.hidden = isEmpty;
    if (tableCardEl) tableCardEl.hidden = isEmpty;
  }

  // ---------- Tabs ----------

  function renderTabs() {
    if (!tabsEl) return;
    const tabs = [
      [TAB_INVOICES, t("Invoices", "Factures")],
      [TAB_CREDIT, t("Credit Notes", "Notes de crédit")],
    ];
    tabsEl.innerHTML = tabs
      .map(function (tab) {
        const count = tabCounts[tab[0]];
        return (
          '<button type="button" class="rd-invoice-filter" data-billing-tab="' +
          tab[0] +
          '" aria-pressed="' +
          (activeTab === tab[0] ? "true" : "false") +
          '" style="font-weight:700;">' +
          escapeHtml(tab[1]) +
          " (" +
          (count == null ? "…" : escapeHtml(String(count))) +
          ")</button>"
        );
      })
      .join("");
  }

  function applyTabChrome() {
    const credit = isCreditTab();
    if (sectionEl) sectionEl.classList.toggle("is-credit", credit);
    if (statsEl) statsEl.hidden = credit;
    if (creditStatsEl) creditStatsEl.hidden = !credit;
    if (theadRow) {
      theadRow.innerHTML = credit
        ? creditColumns()
            .map(function (label) {
              return "<th>" + escapeHtml(label) + "</th>";
            })
            .join("")
        : invoiceTheadHtml;
    }
    if (searchInput) {
      searchInput.placeholder = credit
        ? t(
            "Search credit note, invoice, order, PO...",
            "Rechercher une note de crédit, facture, commande, BC...",
          )
        : invoiceSearchPlaceholder;
    }
    if (balanceSelect) {
      balanceSelect.innerHTML = credit
        ? '<option value="">' +
          t("All", "Toutes") +
          '</option><option value="due">' +
          t("Open", "Ouvertes") +
          '</option><option value="paid">' +
          t("Applied", "Appliquées") +
          "</option>"
        : invoiceBalanceOptions;
      balanceSelect.setAttribute(
        "aria-label",
        credit
          ? t("Status filter", "Filtrer par statut")
          : t("Balance filter", "Filtrer par solde"),
      );
    }
    if (!credit) showCreditEmptyState(false);
    renderTabs();
  }

  function setFilters(f) {
    if (searchInput) searchInput.value = f.q;
    if (dateFromInput) dateFromInput.value = f.dateFrom;
    if (dateToInput) dateToInput.value = f.dateTo;
    if (balanceSelect) balanceSelect.value = f.balance;
  }

  function syncTabUrl() {
    try {
      const url = new URL(window.location.href);
      if (activeTab === TAB_CREDIT) url.searchParams.set("tab", TAB_CREDIT);
      else url.searchParams.delete("tab");
      url.hash = "rd-invoices";
      window.history.replaceState(window.history.state, "", url.toString());
    } catch (e) {}
  }

  function switchTab(tab) {
    if (tab === activeTab) return;
    savedFilters[activeTab] = getFilters();
    activeTab = tab;
    applyTabChrome();
    setFilters(savedFilters[tab]);
    syncTabUrl();
    loadPage(1);
  }

  if (tabsEl) {
    tabsEl.addEventListener("click", function (event) {
      const btn = event.target.closest
        ? event.target.closest("[data-billing-tab]")
        : null;
      if (btn) switchTab(btn.getAttribute("data-billing-tab"));
    });
  }

  /** Background fetch of the other tab's count (and outstanding tiles for invoices). */
  async function refreshCount(tab) {
    try {
      const result = await fetchJson(
        buildListUrl(1, { tab: tab, noFilters: true, pageSize: 1 }),
      );
      const summary = result.meta && result.meta.summary;
      if (summary) tabCounts[tab] = summary.total_invoices;
      if (tab === TAB_INVOICES) updateStats(result.meta || {});
      renderTabs();
    } catch (err) {
      console.error("Billing count load failed", err);
    }
  }

  async function loadPage(nextPage) {
    page = nextPage;
    const seq = ++loadSeq;
    const tab = activeTab;
    const credit = tab === TAB_CREDIT;
    if (!credit && statsEl) {
      statsEl.hidden = false;
      statsEl.removeAttribute("hidden");
    }
    tbody.innerHTML =
      '<tr><td colspan="' +
      colspan() +
      '"><div class="rd-invoice-loading">' +
      (credit
        ? t("Loading credit notes...", "Chargement des notes de crédit...")
        : t("Loading invoices...", "Chargement des factures...")) +
      "</div></td></tr>";
    try {
      const result = await fetchJson(buildListUrl(page));
      if (seq !== loadSeq) return; // a newer tab/page request superseded this one
      const rows = Array.isArray(result.data) ? result.data : [];
      const meta = result.meta || {
        page: 1,
        totalPages: 1,
        total: rows.length,
      };
      if (meta.summary) tabCounts[tab] = meta.summary.total_invoices;
      renderTabs();
      if (credit) {
        showCreditEmptyState(
          !!meta.summary && meta.summary.total_invoices === 0,
        );
        renderCreditRows(rows);
        updatePager(meta);
        updateCreditStats(meta.summary);
        return;
      }
      renderRows(rows);
      updatePager(meta);
      updateStats(meta);
    } catch (err) {
      if (seq !== loadSeq) return;
      if (credit) {
        console.error("Credit note list load failed", err);
        tbody.innerHTML =
          '<tr><td colspan="9"><div class="rd-invoice-error">' +
          t(
            "Unable to load credit notes. Please try again.",
            "Impossible de charger les notes de crédit. Veuillez réessayer.",
          ) +
          "</div></td></tr>";
        if (pager) pager.hidden = true;
        updateCreditStats(null);
        return;
      }
      console.error("Invoice list load failed", err);
      renderEmpty();
      updateStats({ total: 0, outstanding_balance: null });
      if (outstandingEl) {
        outstandingEl.textContent = "—";
        outstandingEl.title =
          "Could not load balance (" +
          (err && err.message ? err.message : "error") +
          ")";
      }
    }
  }

  function renderInvoiceDetail(invoice) {
    if (!invoice) {
      modal.classList.remove("active");
      return;
    }
    currentInvoice = invoice;
    // View modal: single continuous layout (no repeated headers / mid-doc footers)
    preview.innerHTML = buildInvoiceHtml(invoice, { forPdf: false });
    setPdfButtonState(invoice);
    modal.classList.add("active");
  }

  function getInvoicePrintCss() {
    return [
      "@page{size:letter;margin:0;}",
      "html,body{margin:0;padding:0;background:#fff;color:#1c2b33;font-family:Arial,Helvetica,sans-serif;}",
      ".iq-invoice{font-family:Arial,Helvetica,sans-serif;color:#1c2b33;max-width:8.5in;margin:0 auto;}",
      ".iq-invoice *{box-sizing:border-box;}",
      ".iq-page{width:8.5in;min-height:11in;padding:0.4in 0.55in;position:relative;background:#fff;box-sizing:border-box;height:auto;display:block;}",
      ".iq-page:not(.iq-page-last){display:flex;flex-direction:column;}",
      ".iq-page + .iq-page{page-break-before:always;break-before:page;}",
      ".iq-accent{display:flex;height:4px;margin-bottom:14px;}",
      ".iq-accent .t{flex:0 0 80%;background:#074a53;}",
      ".iq-accent .g{flex:1;background:#bad246;}",
      ".iq-hdr{display:flex;justify-content:space-between;align-items:flex-start;}",
      ".iq-logo{width:72px;height:auto;max-height:56px;object-fit:contain;display:block;margin-bottom:6px;}",
      ".iq-brand{font-size:21px;font-weight:700;letter-spacing:6px;color:#074a53;}",
      ".iq-brand small{display:block;font-size:10px;font-weight:400;letter-spacing:1px;color:#5b6b72;margin-top:3px;}",
      ".iq-co{font-size:11px;line-height:1.55;margin-top:8px;}",
      ".iq-invtitle{text-align:right;}",
      ".iq-invtitle .t{font-size:10px;font-weight:600;letter-spacing:3px;color:#074a53;}",
      ".iq-invtitle h1{font-size:27px;font-weight:700;margin:2px 0 8px;}",
      ".iq-dpt{display:flex;gap:18px;justify-content:flex-end;}",
      ".iq-dpt div{text-align:right;}",
      ".iq-dpt span{display:block;font-size:9px;font-weight:600;letter-spacing:1px;color:#5b6b72;}",
      ".iq-dpt b{font-size:12px;font-weight:600;}",
      ".iq-contfrom{font-size:11px;color:#5b6b72;text-align:right;margin-bottom:4px;}",
      ".iq-addr{display:flex;gap:24px;margin-top:16px;}",
      ".iq-addr>div{flex:1;border:1px solid #d9e0de;border-top:4px solid #074a53;border-radius:0 0 8px 8px;padding:10px 14px;}",
      ".iq-lbl{font-size:10px;font-weight:600;letter-spacing:1.5px;color:#074a53;margin-bottom:5px;}",
      ".iq-addr p{font-size:12.5px;line-height:1.55;margin:0;}",
      ".iq-meta{display:grid;grid-template-columns:repeat(4,1fr);margin-top:14px;border:1px solid #d9e0de;border-radius:8px;overflow:hidden;}",
      ".iq-meta div{padding:8px 14px;font-size:12px;border-left:1px solid #d9e0de;}",
      ".iq-meta div:nth-child(4n+1){border-left:none;}",
      ".iq-meta div:nth-child(n+5){border-top:1px solid #d9e0de;}",
      ".iq-meta span{display:block;font-size:9px;font-weight:600;letter-spacing:1px;color:#5b6b72;}",
      ".iq-meta1{display:flex;margin-top:14px;border:1px solid #d9e0de;border-radius:8px;padding:10px 14px;font-size:11.5px;}",
      ".iq-meta1 div{flex:1;white-space:nowrap;}",
      ".iq-meta1 div:first-child{flex:1.9;}",
      ".iq-meta1 b{font-weight:600;}",
      ".iq-itemsbar{display:flex;justify-content:space-between;align-items:center;margin:14px 0 8px;}",
      ".iq-itemsbar h3{font-size:14px;font-weight:600;margin:0;}",
      ".iq-items{width:100%;border-collapse:collapse;font-size:12px;flex:0 0 auto;height:auto!important;}",
      ".iq-items th{background:#074a53;color:#fff;font-size:10px;font-weight:600;letter-spacing:.8px;padding:8px 6px;text-align:left;}",
      ".iq-items td{padding:9px 6px;border-bottom:1px solid #e6ebea;vertical-align:top;font-size:11.5px;height:auto!important;}",
      ".iq-items .c{text-align:center;}",
      ".iq-items .r{text-align:right;}",
      ".iq-items tr{page-break-inside:avoid;break-inside:avoid;}",
      ".iq-cont{text-align:center;font-size:12px;font-weight:600;color:#074a53;padding-top:10px;margin-top:auto;}",
      ".iq-bottom{display:flex;gap:22px;margin-top:16px;page-break-inside:avoid;break-inside:avoid;}",
      ".iq-left{flex:1.25;font-size:11.5px;}",
      ".iq-gst{font-size:12px;font-weight:600;color:#074a53;margin-bottom:8px;}",
      ".iq-left p{margin:0 0 5px;line-height:1.5;}",
      ".iq-pm{border-top:1px solid #d9e0de;margin-top:14px;padding-top:12px;}",
      ".iq-pm h3{font-size:12.5px;font-weight:700;color:#074a53;letter-spacing:1px;margin:0 0 8px;}",
      ".iq-pm h4{font-size:11.5px;font-weight:600;color:#074a53;margin:8px 0 4px;}",
      ".iq-pm-sub{border-top:1px dashed #d9e0de;margin-top:8px;padding-top:8px;}",
      ".iq-right{flex:1;}",
      ".iq-taxbox{background:#f2f5f4;border-radius:8px;padding:10px 14px;margin-bottom:12px;}",
      ".iq-taxbox h3{font-size:10.5px;font-weight:700;letter-spacing:1.5px;color:#074a53;margin:0 0 6px;}",
      ".iq-trow{display:flex;justify-content:space-between;font-size:12.5px;padding:4px 0;}",
      ".iq-due{background:#2ea05f;color:#fff;border-radius:8px;display:flex;justify-content:space-between;align-items:center;padding:10px 14px;margin-top:8px;font-size:14.5px;font-weight:700;}",
      ".iq-foot{display:flex;justify-content:space-between;font-size:10.5px;color:#5b6b72;border-top:1px solid #d9e0de;padding-top:8px;margin-top:24px;}",
      // Slightly under 11in so sub-pixel rounding never spills a page onto an extra sheet
      // (also overrides the French template's own min-height).
      ".iq-invoice .iq-page{min-height:10.9in;}",
    ].join("");
  }

  // Line-item rows wrap to different heights, so a fixed rows-per-page count can
  // overflow a sheet (the overflow then prints as a near-blank page). Measure the
  // rendered pages and push the last row of any overflowing page onto the next one.
  function nextFittingChunks(doc, chunks) {
    var probe = doc.createElement("div");
    probe.style.cssText =
      "position:absolute;visibility:hidden;width:1px;height:11in;";
    doc.body.appendChild(probe);
    var limit = probe.getBoundingClientRect().height - 1;
    probe.parentNode.removeChild(probe);

    var pages = doc.querySelectorAll(".iq-page");
    for (var i = 0; i < pages.length && i < chunks.length; i++) {
      if (
        pages[i].getBoundingClientRect().height <= limit ||
        chunks[i].length <= 1
      )
        continue;
      var next = chunks.map(function (c) {
        return c.slice();
      });
      var moved = next[i].pop();
      if (i + 1 < next.length) next[i + 1].unshift(moved);
      else next.push([moved]);
      return next;
    }
    return null;
  }

  function whenImagesReady(doc, callback) {
    var images = Array.prototype.slice.call(doc.images || []);
    var remaining = images.length;
    if (!remaining) return setTimeout(callback, 50);
    var done = function () {
      remaining -= 1;
      if (remaining === 0) setTimeout(callback, 50);
    };
    images.forEach(function (img) {
      if (img.complete) done();
      else {
        img.addEventListener("load", done);
        img.addEventListener("error", done);
      }
    });
  }

  function printCurrentInvoice() {
    if (!currentInvoice) return;
    var invoice = currentInvoice;
    var chunks = chunkLinesForPdf(
      Array.isArray(invoice.lines) ? invoice.lines : [],
    );

    // PDF uses paginated HTML (repeated header + footer on every page)
    var pdfHtml = buildInvoiceHtml(invoice, { forPdf: true, chunks: chunks });

    printDocument(
      pdfHtml,
      (isCreditDoc(invoice)
        ? t("Credit Note ", "Note de crédit ")
        : t("Invoice ", "Facture ")) + invoice.invoice_number,
      function (doc, done) {
        var passes = 0;
        (function fit() {
          var next = nextFittingChunks(doc, chunks);
          if (!next || ++passes > 100) return done();
          chunks = next;
          doc.body.innerHTML = buildInvoiceHtml(invoice, {
            forPdf: true,
            chunks: chunks,
          });
          whenImagesReady(doc, fit);
        })();
      },
    );
  }

  function printDocument(pdfHtml, title, prepare) {
    var oldFrame = document.getElementById("rdInvoicePrintFrame");
    if (oldFrame && oldFrame.parentNode)
      oldFrame.parentNode.removeChild(oldFrame);

    var iframe = document.createElement("iframe");
    iframe.id = "rdInvoicePrintFrame";
    iframe.setAttribute("aria-hidden", "true");
    iframe.setAttribute("title", "Invoice print");
    document.body.appendChild(iframe);

    var win = iframe.contentWindow;
    var doc = iframe.contentDocument || (win && win.document);
    if (!doc || !win) return;

    doc.documentElement.lang = isFrench ? "fr-CA" : "en-CA";
    doc.title = title;

    var styleEl = doc.createElement("style");
    styleEl.appendChild(doc.createTextNode(getInvoicePrintCss()));
    doc.head.appendChild(styleEl);
    doc.body.innerHTML = pdfHtml;

    var cleaned = false;
    var cleanup = function () {
      if (cleaned) return;
      cleaned = true;
      setTimeout(function () {
        var frame = document.getElementById("rdInvoicePrintFrame");
        if (frame && frame.parentNode) frame.parentNode.removeChild(frame);
      }, 800);
    };

    var triggerPrint = function () {
      try {
        win.focus();
        if (typeof win.onafterprint !== "undefined") {
          win.onafterprint = cleanup;
        }
        win.print();
        setTimeout(cleanup, 2000);
      } catch (err) {
        console.error("Invoice print failed", err);
        cleanup();
      }
    };

    var ready = function () {
      if (!prepare) return triggerPrint();
      try {
        prepare(doc, triggerPrint);
      } catch (err) {
        console.error("Invoice page fitting failed", err);
        triggerPrint();
      }
    };

    setTimeout(function () {
      whenImagesReady(doc, ready);
    }, 30);
  }

  /** Flip the sign of a supplied decimal string without float arithmetic. */
  function negateAmount(value) {
    const s = String(value == null ? "" : value).trim();
    if (!s) return s;
    if (s.charAt(0) === "-") return s.slice(1);
    return Number(s) === 0 ? s : "-" + s;
  }

  const STATEMENT_ROWS_PER_PAGE = 20;
  const STATEMENT_CSS =
    ".iq-items .iq-sec td{font-size:12.5px;font-weight:700;color:#074a53;letter-spacing:.5px;padding-top:14px;border-bottom:2px solid #074a53;}" +
    ".iq-items .iq-none td{font-style:italic;color:#5b6b72;}" +
    ".iq-items .iq-sub td{font-weight:700;border-bottom:none;}" +
    ".iq-sum{min-width:3.6in;}" +
    ".iq-sum h3{font-size:11px;font-weight:700;letter-spacing:1px;color:#074a53;margin:10px 0 4px;}" +
    ".iq-due.iq-credit{background:#074a53;}";

  /**
   * CR01 §4.5: unpaid invoices (positive), unapplied credit notes (negative),
   * per-currency summary. All amounts are printed exactly as supplied; the only
   * derived figures are the server-side section totals and balance.
   */
  function buildStatementHtml(statement) {
    const invoices = (statement.invoices || []).filter(function (inv) {
      return Number(inv.amount_due) > 0;
    });
    const credits = (statement.credit_notes || []).filter(function (cn) {
      return Number(cn.amount_due) > 0;
    });
    const totals = Array.isArray(statement.totals) ? statement.totals : [];
    const company = resolveCompany({ company: statement.company });
    const firstDoc = invoices[0] || credits[0] || {};

    const invoiceHead = [
      t("Invoice", "Facture"),
      "Date",
      t("Order", "Commande"),
      t("PO Number", "N° de bon de commande"),
      t("Currency", "Devise"),
      t("Invoice total", "Total de la facture"),
      t("Amount due", "Montant dû"),
    ];
    const creditHead = [
      t("Credit note", "Note de crédit"),
      "Date",
      t("Related invoice", "Facture associée"),
      t("Order", "Commande"),
      t("Currency", "Devise"),
      t("Credit total", "Total du crédit"),
      t("Remaining credit", "Crédit restant"),
    ];

    // Flat list of table rows, paginated below.
    const items = [{ kind: "section", key: "inv" }];
    if (!invoices.length) items.push({ kind: "none" });
    invoices.forEach(function (doc) {
      items.push({ kind: "inv", doc: doc });
    });
    if (credits.length) {
      items.push({ kind: "section", key: "cn" });
      credits.forEach(function (doc) {
        items.push({ kind: "cn", doc: doc });
      });
    }

    const pages = [];
    let cursor = 0;
    while (cursor < items.length) {
      const chunk = items.slice(cursor, cursor + STATEMENT_ROWS_PER_PAGE);
      let consumed = chunk.length;
      // Never leave a section heading orphaned at the bottom of a page.
      if (chunk.length > 1 && chunk[chunk.length - 1].kind === "section") {
        chunk.pop();
        consumed -= 1;
      }
      // Repeat the section heading when a section continues onto a new page.
      if (chunk[0].kind === "inv" || chunk[0].kind === "cn") {
        chunk.unshift({ kind: "section", key: chunk[0].kind, cont: true });
      }
      pages.push(chunk);
      cursor += consumed;
    }

    function sectionRows(item) {
      const head = item.key === "inv" ? invoiceHead : creditHead;
      const title =
        item.key === "inv"
          ? t("UNPAID INVOICES", "FACTURES IMPAYÉES")
          : t("UNAPPLIED CREDIT NOTES", "NOTES DE CRÉDIT NON APPLIQUÉES");
      return (
        '<tr class="iq-sec"><td colspan="7">' +
        title +
        (item.cont ? t(" (continued)", " (suite)") : "") +
        "</td></tr><tr>" +
        head
          .map(function (label, idx) {
            return (
              "<th" +
              (idx >= 5 ? ' class="r"' : "") +
              ">" +
              escapeHtml(label) +
              "</th>"
            );
          })
          .join("") +
        "</tr>"
      );
    }

    function docRow(item) {
      const d = item.doc;
      const cur = d.currency || "CAD";
      if (item.kind === "inv") {
        return (
          "<tr><td>" +
          escapeHtml(d.invoice_number) +
          "</td><td>" +
          formatDate(d.invoice_date) +
          "</td><td>" +
          escapeHtml(d.order_no || "") +
          "</td><td>" +
          escapeHtml(d.po_number || "") +
          "</td><td>" +
          escapeHtml(cur) +
          '</td><td class="r">' +
          money(d.total_amount, cur) +
          '</td><td class="r">' +
          money(d.amount_due, cur) +
          "</td></tr>"
        );
      }
      return (
        "<tr><td>" +
        escapeHtml(d.invoice_number) +
        "</td><td>" +
        formatDate(d.invoice_date) +
        "</td><td>" +
        escapeHtml(d.related_invoice_number || "") +
        "</td><td>" +
        escapeHtml(d.order_no || "") +
        "</td><td>" +
        escapeHtml(cur) +
        '</td><td class="r">' +
        money(negateAmount(d.total_amount), cur) +
        '</td><td class="r">' +
        money(negateAmount(d.amount_due), cur) +
        "</td></tr>"
      );
    }

    function renderItem(item) {
      if (item.kind === "section") return sectionRows(item);
      if (item.kind === "none")
        return (
          '<tr class="iq-none"><td colspan="7">' +
          t("No unpaid invoices", "Aucune facture impayée") +
          "</td></tr>"
        );
      return docRow(item);
    }

    function summaryHtml() {
      return (
        '<div class="iq-bottom"><div class="iq-left"></div><div class="iq-right iq-sum">' +
        totals
          .map(function (row) {
            const cur = row.currency || "CAD";
            const negative = Number(row.balance) < 0;
            return (
              "<h3>" +
              t("SUMMARY", "SOMMAIRE") +
              " (" +
              escapeHtml(cur) +
              ")</h3>" +
              '<div class="iq-trow"><span>' +
              t("Total unpaid invoices", "Total des factures impayées") +
              "</span><span>" +
              money(row.unpaid_total, cur) +
              "</span></div>" +
              '<div class="iq-trow"><span>' +
              t(
                "Less unapplied credit notes",
                "Moins les notes de crédit non appliquées",
              ) +
              "</span><span>" +
              money(row.credit_total, cur) +
              "</span></div>" +
              '<div class="iq-due' +
              (negative ? " iq-credit" : "") +
              '"><span>' +
              (negative
                ? t("Credit balance", "Solde créditeur")
                : t("Balance due", "Solde dû")) +
              "</span><span>" +
              money(row.balance, cur) +
              "</span></div>"
            );
          })
          .join("") +
        "</div></div>"
      );
    }

    return (
      "<style>" +
      STATEMENT_CSS +
      '</style><div class="iq-invoice">' +
      pages
        .map(function (rows, index) {
          const last = index === pages.length - 1;
          return (
            '<section class="iq-page' +
            (last ? " iq-page-last" : "") +
            '">' +
            '<div class="iq-accent"><div class="t"></div><div class="g"></div></div>' +
            '<div class="iq-hdr"><div>' +
            (company.logo_url
              ? '<img class="iq-logo" src="' +
                escapeHtml(company.logo_url) +
                '" alt="' +
                escapeHtml(company.company_name) +
                '">'
              : "") +
            '<div class="iq-brand">' +
            escapeHtml(company.company_name) +
            '</div><div class="iq-co">' +
            companyAddressHtml(company) +
            "</div></div>" +
            '<div class="iq-invtitle"><div class="t">' +
            t("STATEMENT OF ACCOUNT", "RELEVÉ DE COMPTE") +
            "</div><h1>" +
            t("Statement", "Relevé") +
            "</h1>" +
            "<div>" +
            t("As of ", "En date du ") +
            formatDate(statement.generated_at) +
            "</div><div>Page " +
            (index + 1) +
            t(" of ", " sur ") +
            pages.length +
            "</div></div></div>" +
            '<div class="iq-addr"><div><div class="iq-lbl">' +
            t("CUSTOMER", "CLIENT") +
            "</div><p>" +
            addressLines(firstDoc.sold_to) +
            "</p><p>" +
            t("Customer no.: ", "N° de client : ") +
            escapeHtml(firstDoc.customer_no || cfg.customerId || "") +
            "</p></div></div>" +
            '<table class="iq-items" style="margin-top:8px;"><tbody>' +
            rows.map(renderItem).join("") +
            "</tbody></table>" +
            (last
              ? summaryHtml()
              : '<div class="iq-cont">' +
                t("Continued on next page...", "Suite à la page suivante...") +
                "</div>") +
            '<div class="iq-foot"><span>' +
            t(
              "All unpaid invoices and unapplied credit notes as of the statement date. Partial payments and partial credit applications are reflected in the amounts shown.",
              "Toutes les factures impayées et les notes de crédit non appliquées à la date du relevé. Les paiements partiels et les applications partielles de crédit sont pris en compte dans les montants indiqués.",
            ) +
            "</span><span>Page " +
            (index + 1) +
            "</span></div></section>"
          );
        })
        .join("") +
      "</div>"
    );
  }

  const statementBtn = document.getElementById("rdStatementDownload");
  const statementStatus = document.getElementById("rdStatementStatus");
  if (statementBtn)
    statementBtn.addEventListener("click", async function () {
      statementBtn.disabled = true;
      if (statementStatus)
        statementStatus.textContent = isFrench
          ? "Préparation du relevé..."
          : "Preparing statement...";
      try {
        const result = await fetchJson(cfg.proxyBase + "/statement");
        if (!result.data || !Array.isArray(result.data.invoices))
          throw new Error("Invalid statement response");
        const hasOpenAmount = function (doc) {
          return Number(doc.amount_due) > 0;
        };
        // §4.5: still produce the statement when there is unapplied credit but no unpaid invoices.
        if (
          !result.data.invoices.some(hasOpenAmount) &&
          !(result.data.credit_notes || []).some(hasOpenAmount)
        ) {
          if (statementStatus)
            statementStatus.textContent = t(
              "No unpaid invoices or unapplied credit notes for your account.",
              "Aucune facture impayée ni note de crédit non appliquée pour votre compte.",
            );
          return;
        }
        printDocument(
          buildStatementHtml(result.data),
          isFrench ? "Relevé de compte" : "Statement of account",
        );
        if (statementStatus)
          statementStatus.textContent = isFrench
            ? "Choisissez Enregistrer au format PDF dans la fenêtre d’impression pour télécharger votre relevé."
            : "Choose Save as PDF in the print dialog to download your statement.";
      } catch (err) {
        if (statementStatus)
          statementStatus.textContent = isFrench
            ? "Impossible de télécharger le relevé. Veuillez réessayer."
            : "Unable to download statement. Please try again.";
        console.error("Statement failed", err);
      } finally {
        statementBtn.disabled = false;
      }
    });

  async function openInvoice(id) {
    preview.innerHTML =
      '<div class="rd-invoice-loading">' +
      (isFrench ? "Chargement de la facture..." : "Loading invoice...") +
      "</div>";
    modal.classList.add("active");
    try {
      const result = await fetchJson(
        cfg.proxyBase + "/" + encodeURIComponent(id),
      );
      if (!result || !result.data) {
        modal.classList.remove("active");
        return;
      }
      renderInvoiceDetail(result.data);
    } catch (err) {
      console.error("Invoice detail load failed", err);
      modal.classList.remove("active");
      preview.innerHTML = "";
      currentInvoice = null;
    }
  }

  async function downloadInvoicePdf(id) {
    try {
      if (!currentInvoice || String(currentInvoice.id) !== String(id)) {
        preview.innerHTML =
          '<div class="rd-invoice-loading">' +
          (isFrench ? "Préparation du PDF..." : "Preparing PDF...") +
          "</div>";
        modal.classList.add("active");
        const result = await fetchJson(
          cfg.proxyBase + "/" + encodeURIComponent(id) + "?download=1",
        );
        if (!result || !result.data) {
          modal.classList.remove("active");
          return;
        }
        if (result.data.downloadable === false) {
          preview.innerHTML =
            '<div class="rd-invoice-error">This invoice is missing required totals and cannot be downloaded.</div>';
          setPdfButtonState(result.data);
          return;
        }
        renderInvoiceDetail(result.data);
      } else if (!modal.classList.contains("active")) {
        modal.classList.add("active");
      }
      if (currentInvoice && currentInvoice.downloadable === false) {
        setPdfButtonState(currentInvoice);
        return;
      }
      setTimeout(printCurrentInvoice, 50);
    } catch (err) {
      console.error("Invoice PDF prepare failed", err);
      if (err && err.status === 422) {
        preview.innerHTML =
          '<div class="rd-invoice-error">This invoice is missing required totals and cannot be downloaded.</div>';
        modal.classList.add("active");
        return;
      }
      modal.classList.remove("active");
    }
  }

  if (prevBtn) {
    prevBtn.addEventListener("click", function () {
      if (page > 1) loadPage(page - 1);
    });
  }
  if (nextBtn) {
    nextBtn.addEventListener("click", function () {
      if (page < totalPages) loadPage(page + 1);
    });
  }
  if (closeBtn) {
    closeBtn.addEventListener("click", function () {
      modal.classList.remove("active");
    });
  }
  if (modal) {
    modal.addEventListener("click", function (event) {
      if (event.target === modal) modal.classList.remove("active");
    });
  }
  if (pdfBtn) {
    pdfBtn.addEventListener("click", function () {
      if (currentInvoice && currentInvoice.id) {
        downloadInvoicePdf(currentInvoice.id);
      } else {
        printCurrentInvoice();
      }
    });
  }

  if (searchInput) {
    searchInput.addEventListener("input", scheduleFilterReload);
  }
  if (dateFromInput) {
    dateFromInput.addEventListener("change", function () {
      loadPage(1);
    });
  }
  if (dateToInput) {
    dateToInput.addEventListener("change", function () {
      loadPage(1);
    });
  }
  if (balanceSelect) {
    balanceSelect.addEventListener("change", function () {
      loadPage(1);
    });
  }
  if (clearFiltersBtn) {
    clearFiltersBtn.addEventListener("click", function () {
      if (searchInput) searchInput.value = "";
      if (dateFromInput) dateFromInput.value = "";
      if (dateToInput) dateToInput.value = "";
      if (balanceSelect) balanceSelect.value = "";
      loadPage(1);
    });
  }

  // Show stats shell immediately so UI is not blank before fetch
  if (statsEl && !isCreditTab()) {
    statsEl.hidden = false;
    statsEl.removeAttribute("hidden");
  }

  applyTabChrome();
  loadPage(1);
  // Both tab labels show counts from the start (§4.2).
  refreshCount(isCreditTab() ? TAB_INVOICES : TAB_CREDIT);
})();
