(function(){
  const cfg = window.RD_INVOICES;
  if (!cfg || !cfg.loggedIn) return;

  const tbody = document.getElementById('rdInvoiceTableBody');
  const pager = document.getElementById('rdInvoicePager');
  const pagerInfo = document.getElementById('rdInvoicePagerInfo');
  const prevBtn = document.getElementById('rdInvoicePrev');
  const nextBtn = document.getElementById('rdInvoiceNext');
  const modal = document.getElementById('rdInvoiceModal');
  const modalTitle = modal.querySelector('.rd-invoice-modal-title');
  const invoiceModalTitle = modalTitle.textContent.trim();
  const preview = document.getElementById('rdInvoicePreview');
  const closeBtn = document.getElementById('rdInvoiceClose');
  const pdfBtn = document.getElementById('rdInvoiceDownloadPdf');
  const searchInput = document.getElementById('rdInvoiceSearch');
  const dateFromInput = document.getElementById('rdInvoiceDateFrom');
  const dateToInput = document.getElementById('rdInvoiceDateTo');
  const balanceSelect = document.getElementById('rdInvoiceBalance');
  const clearFiltersBtn = document.getElementById('rdInvoiceFilterClear');
  const statsEl = document.getElementById('rdInvoiceStats');
  const outstandingEl = document.getElementById('rdInvoiceOutstanding');
  const invoiceCountEl = document.getElementById('rdInvoiceCount');
  const overviewOutstandingEl = document.getElementById('rdOverviewOutstanding');

  const isFrench = /^fr(?:-|$)/i.test(cfg.locale || document.documentElement.lang || 'en');
  if (!tbody) return;
  const tr = (en, fr) => isFrench ? fr : en;
  const section = document.getElementById('rd-invoices');
  const tabGroup = document.getElementById('rdBillingTabs');
  const creditStats = document.getElementById('rdCreditStats');
  const message = document.getElementById('rdCreditMessage');
  const table = tbody.closest('table');
  const card = table.closest('.rd-invoice-table-card');
  const heading = table.tHead.rows[0];
  const originalHeading = [...heading.children];
  const creditLabels = [tr('Status','État'), tr('Credit note','Note de crédit'), tr('Related invoice','Facture associée'),
    tr('Order','Commande'), tr('PO number','Bon de commande'), 'Date', 'Total', tr('Remaining credit','Crédit restant'), 'Actions'];
  const tabLabels = { invoices:tr('Invoices','Factures'), 'credit-notes':tr('Credit Notes','Notes de crédit') };
  const initialOptions = [...balanceSelect.options].map(option => option.textContent);
  const initialPlaceholder = searchInput.placeholder;
  const initialBalanceLabel = balanceSelect.getAttribute('aria-label');
  let credit = false;
  let requestId = 0;
  let page = 1;
  const pageSize = cfg.pageSize || 20;
  let totalPages = 1;
  let currentInvoice = null;
  let filterTimer = null;

  // PDF line capacity (header repeats each page; totals only on last).
  // No empty filler rows — real lines only; CSS pins "continued" to page bottom.
  const FULL_PAGE_LINES = 16;
  const LAST_PAGE_LINES = 11;

  function getFilters(){
    return {
      q: searchInput ? String(searchInput.value || '').trim() : '',
      dateFrom: dateFromInput ? String(dateFromInput.value || '').trim() : '',
      dateTo: dateToInput ? String(dateToInput.value || '').trim() : '',
      balance: balanceSelect ? String(balanceSelect.value || '').trim() : ''
    };
  }

  function buildListUrl(nextPage){
    const filters = getFilters();
    let url = cfg.proxyBase + '?page=' + encodeURIComponent(nextPage) +
      '&page_size=' + encodeURIComponent(pageSize);
    if (credit) url += '&document_type=credit_note';
    if (filters.q) url += '&q=' + encodeURIComponent(filters.q);
    if (filters.dateFrom) url += '&date_from=' + encodeURIComponent(filters.dateFrom);
    if (filters.dateTo) url += '&date_to=' + encodeURIComponent(filters.dateTo);
    if (filters.balance) url += '&balance=' + encodeURIComponent(filters.balance);
    return url;
  }

  function scheduleFilterReload(){
    if (filterTimer) clearTimeout(filterTimer);
    filterTimer = setTimeout(function(){
      loadPage(1);
    }, 300);
  }

  const DEFAULT_COMPANY = {
    company_name: 'INK QUEST',
    street_address1: '14617 134 Ave NW',
    street_address2: 'Edmonton, AB T5L 4S9',
    telephone: '(780) 454-4321',
    fax: '(780) 452-5405',
    tax_registration_no: '139587877',
    returns_clause: 'No returns without our written permission (RMA).',
    overdue_clause: '2% per month (24% annual) will be charged on overdue accounts.',
    claims_clause: 'All claims must be made within 5 days after receipt of goods.',
    surcharge_clause: 'A 3% charge may apply for any credit card bill payment'
  };

  function escapeHtml(value){
    return String(value == null ? '' : value)
      .replace(/&/g,'&amp;')
      .replace(/</g,'&lt;')
      .replace(/>/g,'&gt;')
      .replace(/"/g,'&quot;')
      .replace(/'/g,'&#039;');
  }

  function money(value, currency){
    if (value === null || value === undefined || value === '') return '';
    const number = parseFloat(value);
    if (isNaN(number)) return escapeHtml(value);
    try {
      return new Intl.NumberFormat(isFrench ? 'fr-CA' : 'en-CA', {
        style: 'currency',
        currency: currency || 'CAD'
      }).format(number);
    } catch (e) {
      return escapeHtml(String(value));
    }
  }

  function exactMoney(value, currency){
    const raw = String(value ?? '').trim();
    const match = /^(-?)(\d+)(?:\.(\d+))?$/.exec(raw);
    if (!match) return escapeHtml(raw);
    const [, sign, digits, fraction = ''] = match;
    try {
      const formatter = new Intl.NumberFormat(tr('en-CA','fr-CA'), {
        style:'currency', currency:currency || 'CAD', minimumFractionDigits:Math.max(2, fraction.length)
      });
      const integer = BigInt(digits) * (sign ? -1n : 1n);
      return escapeHtml(formatter.formatToParts(sign && integer === 0n ? -0 : integer)
        .map(part => part.type === 'fraction' ? fraction.padEnd(part.value.length, '0') : part.value).join(''));
    } catch {
      return escapeHtml(raw);
    }
  }

  function creditCents(value){
    const [integer, fraction = ''] = value.split('.');
    return BigInt(integer + fraction.padEnd(2, '0'));
  }

  function documentTitle(invoice){
    return invoice.document_type === 'credit_note' ? tr('Credit Note','Note de crédit') : tr('Invoice','Facture');
  }

  function relatedInvoice(invoice){
    return invoice.related_invoice_number
      ? '<div>' + creditLabels[2] + ' · ' + escapeHtml(invoice.related_invoice_number) + '</div>' : '';
  }

  function formatDate(value){
    if (!value) return '';
    const raw = String(value).slice(0, 10);
    const parts = raw.split('-');
    if (parts.length !== 3) return escapeHtml(raw);
    const d = new Date(Date.UTC(+parts[0], +parts[1] - 1, +parts[2]));
    if (isNaN(d.getTime())) return escapeHtml(raw);
    return escapeHtml(d.toLocaleDateString(isFrench ? 'fr-CA' : 'en-US', {
      month: 'short',
      day: 'numeric',
      year: 'numeric',
      timeZone: 'UTC'
    }));
  }

  function addressLines(address){
    if (!address) return '';
    return [
      address.name,
      address.address1,
      [address.city, address.province, address.postal].filter(Boolean).join(', '),
      address.country
    ].filter(Boolean).map(escapeHtml).join('<br>');
  }

  function qty(value){
    if (value === null || value === undefined || value === '') return '';
    return escapeHtml(value);
  }

  function resolveCompany(invoice){
    const c = invoice && invoice.company ? invoice.company : {};
    return {
      logo_url: c.logo_url || cfg.logoUrl || '',
      company_name: c.company_name || DEFAULT_COMPANY.company_name,
      street_address1: c.street_address1 || DEFAULT_COMPANY.street_address1,
      street_address2: c.street_address2 || DEFAULT_COMPANY.street_address2,
      telephone: c.telephone || DEFAULT_COMPANY.telephone,
      fax: c.fax || DEFAULT_COMPANY.fax,
      tax_registration_no: c.tax_registration_no || invoice.tax_registration_no || DEFAULT_COMPANY.tax_registration_no,
      returns_clause: c.returns_clause || DEFAULT_COMPANY.returns_clause,
      overdue_clause: c.overdue_clause || DEFAULT_COMPANY.overdue_clause,
      claims_clause: c.claims_clause || DEFAULT_COMPANY.claims_clause,
      surcharge_clause: c.surcharge_clause || DEFAULT_COMPANY.surcharge_clause
    };
  }

  function companyAddressHtml(company){
    const lines = [];
    if (company.street_address1) lines.push(escapeHtml(company.street_address1));
    if (company.street_address2) lines.push(escapeHtml(company.street_address2));
    const phoneFax = [
      company.telephone ? ('Tel: ' + company.telephone) : '',
      company.fax ? ('Fax: ' + company.fax) : ''
    ].filter(Boolean).join(' | ');
    if (phoneFax) lines.push(escapeHtml(phoneFax));
    if (!lines.length) return '&nbsp;';
    return lines.join('<br>');
  }

  /**
   * Split lines for PDF so non-last pages are full (FULL_PAGE_LINES)
   * and the last page leaves room for the totals footer (LAST_PAGE_LINES).
   */
  function chunkLinesForPdf(lines){
    if (!lines.length) return [[]];
    if (lines.length <= LAST_PAGE_LINES) return [lines.slice()];

    const chunks = [];
    let remaining = lines.slice();

    while (remaining.length > LAST_PAGE_LINES) {
      // Keep enough for a last page with footer
      const take = Math.min(FULL_PAGE_LINES, remaining.length - LAST_PAGE_LINES);
      if (take <= 0) break;
      chunks.push(remaining.slice(0, take));
      remaining = remaining.slice(take);
    }
    chunks.push(remaining);
    return chunks;
  }

  function renderLineRows(pageLines, currency, formatMoney){
    return pageLines.map(function(line){
      return '<tr>' +
        '<td class="c">' + qty(line.qty_ordered) + '</td>' +
        '<td class="c">' + qty(line.qty_shipped) + '</td>' +
        '<td class="c">' + qty(line.qty_backorder) + '</td>' +
        '<td>' + escapeHtml(line.item_number || '') + '</td>' +
        '<td>' + escapeHtml(line.description || '').replace(/\n/g, '<br>') + '</td>' +
        '<td class="r">' + (line.unit_price == null || line.unit_price === '' ? '' : formatMoney(line.unit_price, currency)) + '</td>' +
        '<td class="c">' + escapeHtml(line.uom || '') + '</td>' +
        '<td class="r">' + formatMoney(line.extended_price, currency) + '</td>' +
      '</tr>';
    }).join('');
  }

  function buildPageHeader(invoice, company, logo, pageNo, pageCount, options){
    options = options || {};
    const compact = !!options.compact;
    const pageLabel = pageNo + (pageCount > 1 ? (' of ' + pageCount) : '');
    const gstNo = company.tax_registration_no || '';

    const brandBlock =
      '<div class="iq-accent"><div class="t"></div><div class="g"></div></div>' +
      '<div class="iq-hdr">' +
        '<div>' +
          (logo || '') +
          '<div class="iq-brand">' + escapeHtml(company.company_name || 'INK QUEST') +
            '<small>(DIV. OF 605494 ALBERTA LTD)</small></div>' +
          '<div class="iq-co">' +
            escapeHtml(company.street_address1 || '') +
            (company.street_address2 ? (', ' + escapeHtml(company.street_address2)) : '') + '<br>' +
            'Phone: ' + escapeHtml(company.telephone || '') +
            ' &nbsp;&nbsp; Fax: ' + escapeHtml(company.fax || '') +
            (gstNo && !compact ? ('<br>GST/HST No.: ' + escapeHtml(gstNo)) : '') +
          '</div>' +
        '</div>' +
        '<div class="iq-invtitle">' +
          (compact && pageNo > 1 ? '<div class="iq-contfrom">Continued from page ' + (pageNo - 1) + '</div>' : '') +
          '<div class="t">' + documentTitle(invoice).toUpperCase() + '</div>' +
          '<h1>' + escapeHtml(invoice.invoice_number || '') + '</h1>' + relatedInvoice(invoice) +
          (compact ? '' :
            '<div class="iq-dpt">' +
              '<div><span>DATE</span><b>' + formatDate(invoice.invoice_date) + '</b></div>' +
              '<div><span>PAGE</span><b>' + escapeHtml(pageLabel) + '</b></div>' +
              '<div><span>TERMS</span><b>' + escapeHtml(invoice.terms || '') + '</b></div>' +
            '</div>') +
        '</div>' +
      '</div>';

    if (compact) {
      return brandBlock +
        '<div class="iq-meta1">' +
          '<div><b>CUSTOMER:</b> ' + escapeHtml((invoice.sold_to && invoice.sold_to.name) || '') + '</div>' +
          '<div><b>ORDER NO.:</b> ' + escapeHtml(invoice.order_no || '') + '</div>' +
          '<div><b>DATE:</b> ' + formatDate(invoice.invoice_date) + '</div>' +
          '<div><b>PAGE:</b> ' + escapeHtml(pageLabel) + '</div>' +
        '</div>';
    }

    return brandBlock +
      '<div class="iq-addr">' +
        '<div><div class="iq-lbl">SOLD TO</div><p>' + addressLines(invoice.sold_to) + '</p></div>' +
        '<div><div class="iq-lbl">SHIP TO</div><p>' + addressLines(invoice.ship_to) + '</p></div>' +
      '</div>' +
      '<div class="iq-meta">' +
        '<div><span>CUSTOMER NO.</span>' + escapeHtml(invoice.customer_no || '') + '</div>' +
        '<div><span>ORDER DATE</span>' + formatDate(invoice.order_date) + '</div>' +
        '<div><span>ORDER NO.</span>' + escapeHtml(invoice.order_no || '') + '</div>' +
        '<div><span>SALESPERSON</span>' + escapeHtml(invoice.salesperson || '') + '</div>' +
        '<div><span>PO NUMBER</span>' + escapeHtml(invoice.po_number || '') + '</div>' +
        '<div><span>SHIP VIA</span>' + escapeHtml(invoice.ship_via || '') + '</div>' +
        '<div><span>TERMS</span>' + escapeHtml(invoice.terms || '') + '</div>' +
        '<div><span>GST/HST NO.</span>' + escapeHtml(gstNo) + '</div>' +
      '</div>';
  }

  /** GST / legal / tax / totals — last page only (and single-page View). */
  function buildTotalsFooter(company, invoice, taxRows, currency){
    const formatMoney = invoice.document_type === 'credit_note' ? exactMoney : money;
    return '<div class="iq-bottom">' +
      '<div class="iq-left">' +
        '<div class="iq-gst">GST/HST No.: ' + escapeHtml(company.tax_registration_no || '') + '</div>' +
        '<p>' + escapeHtml(company.returns_clause) + '</p>' +
        '<p>' + escapeHtml(company.overdue_clause) + '</p>' +
        '<p>' + escapeHtml(company.claims_clause) + '</p>' +
        '<p>' + escapeHtml(company.surcharge_clause) + '</p>' +
        '<div class="iq-pm">' +
          '<h3>PAYMENT METHODS</h3>' +
          '<h4>Wire/EFT</h4>' +
          '<p>Institution Number: 003</p>' +
          '<p>Transit: 07378</p>' +
          '<p>Account number: 1027812</p>' +
          '<div class="iq-pm-sub">' +
            '<h4>Bill Payment</h4>' +
            '<p>Ink Quest</p>' +
          '</div>' +
        '</div>' +
      '</div>' +
      '<div class="iq-right">' +
        '<div class="iq-taxbox">' +
          '<h3>TAX SUMMARY</h3>' +
          taxRows +
        '</div>' +
        '<div class="iq-trow"><span>Subtotal</span><span>' + formatMoney(invoice.subtotal, currency) + '</span></div>' +
        '<div class="iq-trow"><span>Total sales tax</span><span>' + formatMoney(invoice.total_tax, currency) + '</span></div>' +
        '<div class="iq-trow"><span>Total amount</span><span>' + formatMoney(invoice.total_amount, currency) + '</span></div>' +
        '<div class="iq-trow"><span>Less payment</span><span>' + formatMoney(invoice.less_payment, currency) + '</span></div>' +
        '<div class="iq-due"><span>Amount due</span><span>' + formatMoney(invoice.amount_due, currency) + '</span></div>' +
      '</div>' +
    '</div>';
  }

  function buildItemsTable(pageLines, currency, rangeLabel, formatMoney){
    return '<div class="iq-itemsbar">' +
        '<h3>LINE ITEMS' + (rangeLabel ? (': ' + escapeHtml(rangeLabel)) : '') + '</h3>' +
      '</div>' +
      '<table class="iq-items">' +
      '<thead><tr>' +
        '<th class="c">Qty Ord.</th><th class="c">Qty Shp.</th><th class="c">B/O</th>' +
        '<th>Item Number</th><th>Description</th>' +
        '<th class="r">Unit Price</th><th class="c">UOM</th><th class="r">Extended Price</th>' +
      '</tr></thead><tbody>' + renderLineRows(pageLines, currency, formatMoney) + '</tbody>' +
    '</table>';
  }

  function buildPageFoot(invoice, company, pageNo, pageCount){
    const pageLabel = pageNo + (pageCount > 1 ? (' of ' + pageCount) : '');
    return '<div class="iq-foot">' +
      '<span>' + escapeHtml(company.company_name || 'INK QUEST') +
        ' &nbsp;&bull;&nbsp; ' + escapeHtml(company.street_address1 || '') +
        (company.street_address2 ? (', ' + escapeHtml(company.street_address2)) : '') +
      '</span>' +
      '<span>' + documentTitle(invoice) + ' ' + escapeHtml(invoice.invoice_number || '') +
        ' &nbsp;&bull;&nbsp; Page ' + escapeHtml(pageLabel) + '</span>' +
    '</div>';
  }

  /**
   * @param {object} invoice
   * @param {{ forPdf?: boolean }} [options]
   *  View (forPdf false): one continuous page, header once, footer once at end.
   *  PDF (forPdf true): paginate lines, repeat header each page, footer only on last page.
   */
  function buildInvoiceHtml(invoice, options){
    if (isFrench) return buildFrenchInvoiceHtml(invoice, options);
    options = options || {};
    const forPdf = !!options.forPdf;
    const lines = Array.isArray(invoice.lines) ? invoice.lines : [];
    const taxLines = Array.isArray(invoice.tax_lines) ? invoice.tax_lines : [];
    const formatMoney = invoice.document_type === 'credit_note' ? exactMoney : money;
    const currency = invoice.currency || 'CAD';
    const company = resolveCompany(invoice);
    const logo = company.logo_url
      ? '<img class="iq-logo" src="' + escapeHtml(company.logo_url) + '" alt="' + escapeHtml(company.company_name) + '">'
      : '';

    const taxRows = taxLines.map(function(tax){
      return '<div class="iq-trow"><span>' + escapeHtml(tax.code || '') + '</span><span>' + formatMoney(tax.amount, currency) + '</span></div>';
    }).join('') +
      '<div class="iq-trow"><span>Tax Exempt Code</span><span>' + escapeHtml(invoice.tax_exempt_code || '') + '</span></div>';

    // On-screen View: single document, no repeated headers
    if (!forPdf) {
      return '<div class="iq-invoice">' +
        '<section class="iq-page iq-page-last">' +
          buildPageHeader(invoice, company, logo, 1, 1) +
          buildItemsTable(lines, currency, lines.length ? ('1 – ' + lines.length) : '', formatMoney) +
          buildTotalsFooter(company, invoice, taxRows, currency) +
          buildPageFoot(invoice, company, 1, 1) +
        '</section>' +
      '</div>';
    }

    // PDF download: paginate with repeated headers; footer only on last page.
    const chunks = chunkLinesForPdf(lines);
    const pageCount = chunks.length;
    let lineStart = 1;

    return '<div class="iq-invoice">' + chunks.map(function(pageLines, idx){
      const pageNo = idx + 1;
      const isLast = pageNo === pageCount;
      const lineEnd = lineStart + pageLines.length - 1;
      const rangeLabel = pageLines.length ? (lineStart + ' – ' + lineEnd) : '';
      lineStart = lineEnd + 1;
      return '<section class="iq-page' + (isLast ? ' iq-page-last' : '') + '">' +
        buildPageHeader(invoice, company, logo, pageNo, pageCount, { compact: pageNo > 1 }) +
        buildItemsTable(pageLines, currency, rangeLabel, formatMoney) +
        (isLast
          ? buildTotalsFooter(company, invoice, taxRows, currency)
          : '<div class="iq-cont">Continued on next page…</div>') +
        buildPageFoot(invoice, company, pageNo, pageCount) +
      '</section>';
    }).join('') + '</div>';
  }

  const FRENCH_INVOICE_CSS = "\n  .iq-invoice { font-family: 'Poppins', 'Helvetica Neue', Arial, sans-serif; color: #1c2b33; max-width: 8.5in; margin: 0 auto; }\n  .iq-invoice * { box-sizing: border-box; }\n  .iq-page { width: 8.5in; min-height: 11in; padding: 0.35in 0.55in 0.3in; position: relative; background: #fff; }\n  /* Header band (dark teal) */\n  .iq-band { background: #00404c; color: #fff; display: flex; justify-content: space-between;\n             align-items: flex-start; padding: 12px 24px; }\n  .iq-band .iq-brand { font-size: 20px; font-weight: 700; letter-spacing: 5px; }\n  .iq-band .iq-brand small { display: block; font-size: 10px; font-weight: 400; letter-spacing: 0.5px; margin-top: 6px; }\n  .iq-band .iq-co { font-size: 10px; line-height: 1.6; margin-top: 6px; }\n  .iq-band .iq-invtitle { text-align: right; }\n  .iq-band .iq-invtitle h1 { font-size: 26px; font-weight: 700; margin: 0 0 8px; letter-spacing: 1px; }\n  .iq-band .iq-invtitle p { font-size: 11px; margin: 0; line-height: 1.6; }\n  /* Slim continued band (later pages) */\n  .iq-band-slim { background: #00404c; color: #fff; display: flex; justify-content: space-between;\n                  align-items: center; padding: 12px 24px; }\n  .iq-band-slim .iq-brand { font-size: 15px; font-weight: 700; letter-spacing: 4px; }\n  .iq-band-slim p { font-size: 12px; margin: 0; }\n  /* Addresses */\n  .iq-addr { display: flex; gap: 20px; margin-top: 12px; }\n  .iq-addr > div { flex: 1; border: 1px solid #d9e0de; padding: 10px 16px; }\n  .iq-lbl { font-size: 11px; font-weight: 700; letter-spacing: 0.5px; color: #00404c; margin-bottom: 5px; }\n  .iq-addr p { font-size: 11.5px; line-height: 1.55; margin: 0; }\n  .iq-addr p b { font-weight: 700; }\n  /* Order meta strip */\n  .iq-meta { display: flex; margin-top: 12px; border: 1px solid #d9e0de; }\n  .iq-meta div { flex: 1; padding: 6px 8px; font-size: 11px; }\n  .iq-meta span { display: block; font-size: 8.5px; font-weight: 600; letter-spacing: 0.2px; color: #5b6b72; margin-bottom: 4px; }\n  /* Sample-data badge */\n  .iq-badge { font-size: 10px; font-weight: 700; color: #8a6d00; margin: 10px 0 6px; letter-spacing: 0.3px; }\n  /* Line items table */\n  .iq-items { width: 100%; border-collapse: collapse; table-layout: fixed; font-size: 11px; }\n  .iq-items th { background: #00404c; color: #fff; font-size: 10.5px; font-weight: 700;\n                 padding: 6px 6px; text-align: left; vertical-align: middle; }\n  .iq-items td { padding: 2px 4px; border-bottom: 1px solid #e6ebea; border-left: 1px solid #eef1f0;\n                 vertical-align: top; font-size: 10.5px; line-height: 1.25; overflow-wrap: break-word; }\n  .iq-items td:first-child { border-left: none; }\n  .iq-items .c { text-align: center; } .iq-items .r { text-align: right; }\n  .iq-cont { text-align: center; font-size: 12.5px; font-weight: 700; color: #00404c; padding-top: 10px; }\n  /* Bottom two-column section */\n  .iq-bottom { display: flex; gap: 22px; margin-top: 16px; }\n  .iq-left { flex: 1.15; font-size: 12px; }\n  .iq-gst { font-size: 12.5px; font-weight: 700; color: #00404c; margin-bottom: 8px; }\n  .iq-left p { margin: 0 0 5px; line-height: 1.5; }\n  .iq-pm { border-top: 1px solid #d9e0de; margin-top: 16px; padding-top: 12px; }\n  .iq-pm h3 { font-size: 11px; font-weight: 700; color: #00404c; letter-spacing: 0.5px; margin: 0 0 8px; }\n  .iq-pm h4 { font-size: 11px; font-weight: 700; margin: 8px 0 4px; }\n  .iq-pm-sub { border-top: 1px dashed #d9e0de; margin-top: 10px; padding-top: 10px; }\n  .iq-right { flex: 1; }\n  .iq-taxbox { background: #f2f5f4; padding: 12px 16px 16px; margin-bottom: 14px; }\n  .iq-taxbox h3 { font-size: 11px; font-weight: 700; letter-spacing: 0.5px; color: #00404c; margin: 0 0 8px; }\n  .iq-trow { display: flex; justify-content: space-between; font-size: 12px; padding: 5px 0; }\n  .iq-due { background: #2ea05f; color: #fff; display: flex;\n            justify-content: space-between; align-items: center;\n            padding: 12px 16px; margin-top: 10px; font-size: 15px; font-weight: 700; }\n  .iq-foot { text-align: center; font-size: 11px; color: #5b6b72;\n             border-top: 1px solid #d9e0de; padding-top: 10px; margin-top: 16px; }\n  @media print {\n    @page { size: letter; margin: 0; }\n    .iq-page { page-break-after: always; }\n    .iq-page:last-child { page-break-after: auto; }\n  }\n.iq-fr-logo{display:block;width:160px;max-width:100%;height:auto;max-height:64px;object-fit:contain;background:#fff;padding:6px;}.iq-band-slim .iq-fr-logo{width:120px;max-height:44px;}";
  function buildFrenchInvoiceHtml(data, options){
    const company = resolveCompany(data);
    const logo = company.logo_url ? '<img class="iq-fr-logo" src="' + escapeHtml(company.logo_url) + '" alt="' + escapeHtml(company.company_name) + '">' : escapeHtml(company.company_name);
    const amount = data.document_type === 'credit_note' ? value => exactMoney(value, data.currency) : value => value == null || value === '' ? '' : (Number.isFinite(Number(value)) ? new Intl.NumberFormat('fr-CA', {minimumFractionDigits: 2, maximumFractionDigits: 2}).format(Number(value)) : escapeHtml(value));
    const invoice = Object.assign({}, data, {number: data.invoice_number, date: formatDate(data.invoice_date), order_date: formatDate(data.order_date)});
    invoice.sold_to = Object.assign({}, data.sold_to, {addr1: data.sold_to && data.sold_to.address1});
    invoice.ship_to = Object.assign({}, data.ship_to, {addr1: data.ship_to && data.ship_to.address1});
    const lines = (data.lines || []).map(line => Object.assign({}, line, {qty_ord: line.qty_ordered, qty_shp: line.qty_shipped, bo: line.qty_backorder}));
    const pages = options && options.forPdf ? chunkLinesForPdf(lines) : [lines];
    return '<style>' + FRENCH_INVOICE_CSS + '</style><div class="iq-invoice">' + pages.map((pageLines, index) => `  <section class="iq-page">
    ${index === 0 ? `
    <div class="iq-band">
      <div>
        <div class="iq-brand">${logo}<small>(DIV. DE 605494 ALBERTA LTD)</small></div>
        <div class="iq-co">14617 - 134 Ave NW, Edmonton, AB T5L 4S9<br>
          Tél. : (780) 454-4321 &nbsp;&bull;&nbsp; Téléc. : (780) 452-5405</div>
      </div>
      <div class="iq-invtitle">
        <h1>${documentTitle(invoice).toUpperCase()}</h1>${relatedInvoice(invoice)}
        <p>${documentTitle(invoice)} : ${escapeHtml(invoice.number)}<br>
          Date : ${escapeHtml(invoice.date)} &nbsp;&bull;&nbsp; Page ${escapeHtml((index + 1))} de ${escapeHtml(pages.length)}</p>
      </div>
    </div>

    <div class="iq-addr">
      <div>
        <div class="iq-lbl">VENDU À</div>
        <p><b>${escapeHtml(invoice.sold_to.name)}</b><br>
          ${escapeHtml(invoice.sold_to.addr1)}<br>
          ${escapeHtml(invoice.sold_to.city)}, ${escapeHtml(invoice.sold_to.province)} ${escapeHtml(invoice.sold_to.postal)}<br>
          ${escapeHtml(invoice.sold_to.country)}</p>
      </div>
      <div>
        <div class="iq-lbl">EXPÉDIÉ À</div>
        <p><b>${escapeHtml(invoice.ship_to.name)}</b><br>
          ${escapeHtml(invoice.ship_to.addr1)}<br>
          ${escapeHtml(invoice.ship_to.city)}, ${escapeHtml(invoice.ship_to.province)} ${escapeHtml(invoice.ship_to.postal)}<br>
          ${escapeHtml(invoice.ship_to.country)}</p>
      </div>
    </div>

    <div class="iq-meta">
      <div style="flex:1.1"><span>Nº DE CLIENT</span>${escapeHtml(invoice.customer_no)}</div>
      <div style="flex:1.3"><span>DATE DE COMMANDE</span>${escapeHtml(invoice.order_date)}</div>
      <div style="flex:1.2"><span>Nº DE COMMANDE</span>${escapeHtml(invoice.order_no)}</div>
      <div><span>VENDEUR</span>${escapeHtml(invoice.salesperson)}</div>
      <div style="flex:1.3"><span>BON DE COMMANDE</span>${escapeHtml(invoice.po_number)}</div>
      <div><span>EXPÉDIÉ PAR</span>${escapeHtml(invoice.ship_via)}</div>
      <div><span>CONDITIONS</span>${escapeHtml(invoice.terms)}</div>
    </div>
    ` : `
    <div class="iq-band-slim">
      <div class="iq-brand">${logo}</div>
      <p>${documentTitle(invoice)} ${escapeHtml(invoice.number)} &mdash; Suite &nbsp;&bull;&nbsp; ${escapeHtml(invoice.date)} &nbsp;&bull;&nbsp; Page ${escapeHtml((index + 1))} de ${escapeHtml(pages.length)}</p>
    </div>
    `}

    <table class="iq-items">
      <colgroup><col style="width:6.2%"><col style="width:6.2%"><col style="width:4.9%"><col style="width:13.3%"><col style="width:43.3%"><col style="width:9.8%"><col style="width:6.2%"><col style="width:10.1%"></colgroup>

<tr>
  <th class="c">Qté<br>comm.</th><th class="c">Qté<br>exp.</th><th class="c">En<br>att.</th>
  <th>Nº d'article</th><th>Description</th>
  <th class="r">Prix<br>unitaire</th><th class="c">Unité</th><th class="r">Prix<br>étendu</th>
</tr>

      ${pageLines.map(line => `
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
      `).join('')}
    </table>

    ${index === pages.length - 1 ? `

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
      ${(data.tax_lines || []).map(tax => '<div class="iq-trow"><span>' + escapeHtml(tax.code) + '</span><span>' + amount(tax.amount) + '</span></div>').join('')}
      <div class="iq-trow"><span>Code d'exemption de taxe</span><span>${escapeHtml(invoice.tax_exempt_code)}</span></div>
    </div>
    <div class="iq-trow"><span>Sous-total</span><span>${amount(invoice.subtotal)}</span></div>
    <div class="iq-trow"><span>Total des taxes de vente</span><span>${amount(invoice.total_tax)}</span></div>
    <div class="iq-trow"><span>Montant total</span><span>${amount(invoice.total_amount)}</span></div>
    <div class="iq-trow"><span>Moins paiement</span><span>${amount(invoice.less_payment)}</span></div>
    <div class="iq-due"><span>Montant dû</span><span>${amount(invoice.amount_due)}</span></div>
  </div>
</div>

    ` : `
    <div class="iq-cont">Suite à la page suivante&hellip;</div>
    `}

    <div class="iq-foot">INK QUEST &nbsp;&bull;&nbsp; 14617 &ndash; 134 Ave NW, Edmonton, AB T5L 4S9</div>
  </section>`).join('') + '</div>';
  }

  async function fetchJson(url){
    console.log('[RD Invoices] request', {
      url: url,
      customerId: cfg.customerId,
      loggedIn: cfg.loggedIn
    });
    const res = await fetch(url, {
      credentials: 'same-origin',
      headers: { 'Accept': 'application/json' }
    });
    const body = await res.json().catch(function(){ return {}; });
    console.log('[RD Invoices] response', {
      url: url,
      status: res.status,
      ok: res.ok,
      body: body
    });
    if (!res.ok) {
      const err = new Error(body.error || ('Request failed (' + res.status + ')'));
      err.status = res.status;
      throw err;
    }
    return body;
  }

  function paymentStatus(inv){
    const raw = inv && inv.amount_due;
    if (raw == null || String(raw).trim() === '') {
      return { label: (isFrench ? "Inconnu" : 'Unknown'), cls: 'processing' };
    }
    const n = Number(String(raw).replace(/,/g, ''));
    if (!Number.isFinite(n)) {
      return { label: (isFrench ? "Inconnu" : 'Unknown'), cls: 'processing' };
    }
    if (n <= 0) {
      return { label: (isFrench ? "Payée" : 'Paid'), cls: 'paid' };
    }
    return { label: (isFrench ? "À payer" : 'Due'), cls: 'pending' };
  }

  function renderEmpty(){
    tbody.innerHTML =
      '<tr><td colspan="8"><div class="rd-invoice-empty">' +
        '<h3>' + (isFrench ? "Aucune facture" : 'No invoices') + '</h3>' +
        '<p>' + (isFrench ? "Aucune facture disponible pour votre compte." : 'There are no invoices for your account right now.') + '</p>' +
        '<button type="button" class="rd-invoice-refresh" id="rdInvoiceRefresh">' + (isFrench ? "Actualiser" : 'Refresh') + '</button>' +
      '</div></td></tr>';
    if (pager) pager.hidden = true;
    const refreshBtn = document.getElementById('rdInvoiceRefresh');
    if (refreshBtn) {
      refreshBtn.addEventListener('click', function(){
        loadPage(1);
      });
    }
  }

  function updateStats(meta){
    meta = meta || {};
    if (statsEl) {
      statsEl.hidden = credit;
      statsEl.style.display = '';
    }
    const summary = meta.summary;
    if (invoiceCountEl) {
      invoiceCountEl.textContent = summary ? String(summary.total_invoices) : '?';
    }
    const valueEl = document.getElementById('rdInvoiceValue');
    const paidEl = document.getElementById('rdInvoicePaid');
    const pendingEl = document.getElementById('rdInvoicePending');
    if (paidEl) paidEl.textContent = summary ? String(summary.paid) : '?';
    if (pendingEl) pendingEl.textContent = summary ? String(summary.pending) : '?';
    if (valueEl) {
      valueEl.innerHTML = summary
        ? (summary.totals_by_currency.length
          ? summary.totals_by_currency.map(function(total){ return money(total.total_value, total.currency); }).join('<br>')
          : money('0.00', meta.outstanding_currency || 'CAD'))
        : '?';
    }
    var outstandingText = '—';
    if (meta.outstanding_balance != null && meta.outstanding_balance !== '') {
      outstandingText = money(meta.outstanding_balance, meta.outstanding_currency || 'CAD');
    } else if (meta.total === 0) {
      outstandingText = money('0.00', meta.outstanding_currency || 'CAD');
    }
    if (outstandingEl) outstandingEl.innerHTML = outstandingText;
    if (overviewOutstandingEl) overviewOutstandingEl.innerHTML = outstandingText;
  }

  function setPdfButtonState(invoice){
    if (!pdfBtn) return;
    const ok = invoice && invoice.downloadable !== false;
    pdfBtn.disabled = !ok;
    pdfBtn.title = ok
      ? tr('Download PDF','Télécharger le PDF')
      : tr('Required totals are missing','Des totaux requis sont manquants');
    pdfBtn.style.opacity = ok ? '' : '0.45';
    pdfBtn.style.pointerEvents = ok ? '' : 'none';
  }

  function renderRows(invoices){
    if (!invoices.length) {
      renderEmpty();
      return;
    }

    tbody.innerHTML = invoices.map(function(inv){
      const canDownload = inv.downloadable !== false;
      const pdfBtnHtml = canDownload
        ? '<button type="button" class="rd-invoice-action send" title="' + tr('Download PDF','Télécharger le PDF') + '" data-invoice-pdf="' + escapeHtml(inv.id) + '">PDF</button>'
        : '<button type="button" class="rd-invoice-action send" title="' + tr('Not downloadable','Téléchargement indisponible') + '" disabled style="opacity:.45;cursor:not-allowed;">PDF</button>';

      if (credit) {
        const due = inv.amount_due?.trim();
        const total = inv.total_amount?.trim();
        const applied = due && creditCents(due) === 0n;
        let status = tr('Unavailable','Indisponible');
        if (applied) status = tr('Applied','Appliquée');
        else if (due && total && creditCents(due) <= creditCents(total)) status = creditCents(due) === creditCents(total)
          ? tr('Open','Ouverte') : tr('Partially applied','Partiellement appliquée');
        const values = [
          '<span class="rd-invoice-badge ' + (applied ? 'paid' : 'pending') + '">' + status + '</span>',
          escapeHtml(inv.invoice_number), escapeHtml(inv.related_invoice_number), escapeHtml(inv.order_no),
          escapeHtml(inv.po_number), formatDate(inv.invoice_date), exactMoney(inv.total_amount, inv.currency),
          exactMoney(inv.amount_due, inv.currency),
          '<div class="rd-invoice-actions"><button type="button" class="rd-invoice-action" data-invoice-id="' +
          escapeHtml(inv.id) + '">' + tr('View','Voir') + '</button>' + pdfBtnHtml + '</div>'
        ];
        return '<tr>' + values.map((value,i) => '<td data-label="' + creditLabels[i] + '">' + value + '</td>').join('') + '</tr>';
      }
      const pay = paymentStatus(inv);
      return '<tr>' +
        '<td><div class="rd-invoice-number">' + escapeHtml(inv.invoice_number) + '</div></td>' +
        '<td>' + formatDate(inv.invoice_date) + '</td>' +
        '<td><div class="rd-invoice-order">' + escapeHtml(inv.order_no || '') + '</div></td>' +
        '<td>' + escapeHtml(inv.po_number || '') + '</td>' +
        '<td class="rd-invoice-total">' + money(inv.total_amount, inv.currency) + '</td>' +
        '<td class="rd-invoice-total">' + money(inv.amount_due, inv.currency) + '</td>' +
        '<td><span class="rd-invoice-badge ' + pay.cls + '">' + escapeHtml(pay.label) + '</span></td>' +
        '<td><div class="rd-invoice-actions">' +
          '<button type="button" class="rd-invoice-action" title="View Invoice" data-invoice-id="' + escapeHtml(inv.id) + '">' + (isFrench ? "Voir" : 'View') + '</button>' +
          pdfBtnHtml +
        '</div></td>' +
      '</tr>';
    }).join('');

    tbody.querySelectorAll('[data-invoice-id]').forEach(function(btn){
      btn.addEventListener('click', function(){
        openInvoice(btn.getAttribute('data-invoice-id'));
      });
    });
    tbody.querySelectorAll('[data-invoice-pdf]').forEach(function(btn){
      btn.addEventListener('click', function(){
        downloadInvoicePdf(btn.getAttribute('data-invoice-pdf'));
      });
    });
  }

  function updatePager(meta){
    if (!pager || !meta) return;
    totalPages = meta.totalPages || 1;
    page = meta.page || 1;
    pager.hidden = !meta.total;
    pagerInfo.textContent = meta.total
      ? ('Page ' + page + (isFrench ? ' de ' : ' of ') + totalPages + ' - ' + meta.total + (' ' + (credit ? tr('credit notes','notes de crédit') : tr('invoices','factures'))))
      : '';
    prevBtn.disabled = page <= 1;
    nextBtn.disabled = page >= totalPages;
  }

  async function loadPage(nextPage){
    const id = ++requestId;
    page = nextPage;
    card.hidden = false;
    message.hidden = true;
    pager.hidden = true;
    if (!credit && statsEl) {
      statsEl.hidden = credit;
    }
    tbody.innerHTML = '<tr><td colspan="8"><div class="rd-invoice-loading">' + (credit ? tr('Loading credit notes…','Chargement des notes de crédit…') : tr('Loading invoices…','Chargement des factures…')) + '</div></td></tr>';
    try {
      const result = await fetchJson(buildListUrl(page));
      const rows = Array.isArray(result.data) ? result.data : [];
      if (id !== requestId) return;
      const meta = result.meta || { page: 1, totalPages: 1, total: rows.length };
      updateCount(credit ? 'credit-notes' : 'invoices', meta.summary);
      if (credit) {
        renderCreditStats(meta.summary);
        if (!rows.length) showCreditMessage(meta.summary?.total_invoices
          ? tr('No credit notes match your filters.','Aucune note de crédit ne correspond aux filtres.')
          : tr('You have no credit notes.','Vous n’avez aucune note de crédit.'));
        else renderRows(rows);
      } else {
        renderRows(rows);
        updateStats(meta);
      }
      updatePager(meta);
    } catch (err) {
      if (id !== requestId) return;
      console.error('Billing list load failed', err);
      if (credit) {
        showCreditMessage(tr('Unable to load credit notes.','Impossible de charger les notes de crédit.'));
        return;
      }
      renderEmpty();
      updateStats({ total: 0, outstanding_balance: null });
      if (outstandingEl) {
        outstandingEl.textContent = '—';
        outstandingEl.title = 'Could not load balance (' + (err && err.message ? err.message : 'error') + ')';
      }
    }
  }

  function showCreditMessage(text){
    card.hidden = true;
    message.textContent = text;
    message.hidden = false;
  }

  function updateCount(tab, summary){
    if (!summary) return;
    const button = tabGroup.querySelector('[data-tab="' + tab + '"]');
    button.textContent = tabLabels[tab] + ' (' + summary.total_invoices + ')';
  }

  function renderCreditStats(summary){
    const totals = summary.totals_by_currency;
    const value = key => totals.map(total => exactMoney(total[key], total.currency) +
      ' ' + escapeHtml(total.currency)).join('<br>') || '—';
    const open = totals.reduce((sum,total) => sum + total.open_count, 0);
    creditStats.innerHTML = [
      [tr('Total credit notes','Total des notes de crédit'), summary.total_invoices],
      [tr('Total credit value','Valeur totale des crédits'), value('total_value')],
      [tr('Remaining credit','Crédit restant'), value('remaining'),
        open + ' ' + (open === 1 ? tr('open credit note','note de crédit ouverte') : tr('open credit notes','notes de crédit ouvertes'))]
    ].map(([label,amount,sub]) => '<div class="rd-invoice-stat"><div class="rd-invoice-stat-label">' +
      label + '</div><div class="rd-invoice-stat-value">' + amount + '</div>' +
      (sub ? '<div class="rd-invoice-stat-sub">' + sub + '</div>' : '') + '</div>').join('');
  }

  function selectTab(tab){
    credit = tab === 'credit-notes';
    section.classList.toggle('is-credit', credit);
    for (const button of tabGroup.children) button.setAttribute('aria-pressed', String(button.dataset.tab === tab));
    statsEl.hidden = credit;
    creditStats.hidden = !credit;
    heading.replaceChildren(...(credit ? creditLabels.map(label => {
      const th = document.createElement('th');
      th.scope = 'col';
      th.textContent = label;
      return th;
    }) : originalHeading));
    searchInput.placeholder = credit ? tr('Search credit note, related invoice, order or PO','Note de crédit, facture associée, commande ou BC') : initialPlaceholder;
    balanceSelect.setAttribute('aria-label', credit ? tr('Status filter','Filtrer par état') : initialBalanceLabel);
    const options = credit ? [tr('All','Toutes'),tr('Open','Ouvertes'),tr('Applied','Appliquées')] : initialOptions;
    [...balanceSelect.options].forEach((option,i) => option.textContent = options[i]);
    searchInput.value = dateFromInput.value = dateToInput.value = balanceSelect.value = '';
    clearTimeout(filterTimer);
    loadPage(1);
  }

  function renderInvoiceDetail(invoice){
    if (!invoice) {
      modal.classList.remove('active');
      return;
    }
    currentInvoice = invoice;
    modalTitle.textContent = invoice.document_type === 'credit_note' ? documentTitle(invoice) : invoiceModalTitle;
    // View modal: single continuous layout (no repeated headers / mid-doc footers)
    preview.innerHTML = buildInvoiceHtml(invoice, { forPdf: false });
    setPdfButtonState(invoice);
    modal.classList.add('active');
  }

  function getInvoicePrintCss(){
    return [
      '@page{size:letter;margin:0;}',
      'html,body{margin:0;padding:0;background:#fff;color:#1c2b33;font-family:Arial,Helvetica,sans-serif;}',
      '.iq-invoice{font-family:Arial,Helvetica,sans-serif;color:#1c2b33;max-width:8.5in;margin:0 auto;}',
      '.iq-invoice *{box-sizing:border-box;}',
      '.iq-page{width:8.5in;min-height:11in;padding:0.4in 0.55in;position:relative;background:#fff;box-sizing:border-box;height:auto;display:block;}',
      '.iq-page:not(.iq-page-last){display:flex;flex-direction:column;}',
      '.iq-page + .iq-page{page-break-before:always;break-before:page;}',
      '.iq-accent{display:flex;height:4px;margin-bottom:14px;}',
      '.iq-accent .t{flex:0 0 80%;background:#074a53;}',
      '.iq-accent .g{flex:1;background:#bad246;}',
      '.iq-hdr{display:flex;justify-content:space-between;align-items:flex-start;}',
      '.iq-logo{width:72px;height:auto;max-height:56px;object-fit:contain;display:block;margin-bottom:6px;}',
      '.iq-brand{font-size:21px;font-weight:700;letter-spacing:6px;color:#074a53;}',
      '.iq-brand small{display:block;font-size:10px;font-weight:400;letter-spacing:1px;color:#5b6b72;margin-top:3px;}',
      '.iq-co{font-size:11px;line-height:1.55;margin-top:8px;}',
      '.iq-invtitle{text-align:right;}',
      '.iq-invtitle .t{font-size:10px;font-weight:600;letter-spacing:3px;color:#074a53;}',
      '.iq-invtitle h1{font-size:27px;font-weight:700;margin:2px 0 8px;}',
      '.iq-dpt{display:flex;gap:18px;justify-content:flex-end;}',
      '.iq-dpt div{text-align:right;}',
      '.iq-dpt span{display:block;font-size:9px;font-weight:600;letter-spacing:1px;color:#5b6b72;}',
      '.iq-dpt b{font-size:12px;font-weight:600;}',
      '.iq-contfrom{font-size:11px;color:#5b6b72;text-align:right;margin-bottom:4px;}',
      '.iq-addr{display:flex;gap:24px;margin-top:16px;}',
      '.iq-addr>div{flex:1;border:1px solid #d9e0de;border-top:4px solid #074a53;border-radius:0 0 8px 8px;padding:10px 14px;}',
      '.iq-lbl{font-size:10px;font-weight:600;letter-spacing:1.5px;color:#074a53;margin-bottom:5px;}',
      '.iq-addr p{font-size:12.5px;line-height:1.55;margin:0;}',
      '.iq-meta{display:grid;grid-template-columns:repeat(4,1fr);margin-top:14px;border:1px solid #d9e0de;border-radius:8px;overflow:hidden;}',
      '.iq-meta div{padding:8px 14px;font-size:12px;border-left:1px solid #d9e0de;}',
      '.iq-meta div:nth-child(4n+1){border-left:none;}',
      '.iq-meta div:nth-child(n+5){border-top:1px solid #d9e0de;}',
      '.iq-meta span{display:block;font-size:9px;font-weight:600;letter-spacing:1px;color:#5b6b72;}',
      '.iq-meta1{display:flex;margin-top:14px;border:1px solid #d9e0de;border-radius:8px;padding:10px 14px;font-size:11.5px;}',
      '.iq-meta1 div{flex:1;white-space:nowrap;}',
      '.iq-meta1 div:first-child{flex:1.9;}',
      '.iq-meta1 b{font-weight:600;}',
      '.iq-itemsbar{display:flex;justify-content:space-between;align-items:center;margin:14px 0 8px;}',
      '.iq-itemsbar h3{font-size:14px;font-weight:600;margin:0;}',
      '.iq-items{width:100%;border-collapse:collapse;font-size:12px;flex:0 0 auto;height:auto!important;}',
      '.iq-items th{background:#074a53;color:#fff;font-size:10px;font-weight:600;letter-spacing:.8px;padding:8px 6px;text-align:left;}',
      '.iq-items td{padding:9px 6px;border-bottom:1px solid #e6ebea;vertical-align:top;font-size:11.5px;height:auto!important;}',
      '.iq-items .c{text-align:center;}',
      '.iq-items .r{text-align:right;}',
      '.iq-items tr{page-break-inside:avoid;break-inside:avoid;}',
      '.iq-cont{text-align:center;font-size:12px;font-weight:600;color:#074a53;padding-top:10px;margin-top:auto;}',
      '.iq-bottom{display:flex;gap:22px;margin-top:16px;page-break-inside:avoid;break-inside:avoid;}',
      '.iq-left{flex:1.25;font-size:11.5px;}',
      '.iq-gst{font-size:12px;font-weight:600;color:#074a53;margin-bottom:8px;}',
      '.iq-left p{margin:0 0 5px;line-height:1.5;}',
      '.iq-pm{border-top:1px solid #d9e0de;margin-top:14px;padding-top:12px;}',
      '.iq-pm h3{font-size:12.5px;font-weight:700;color:#074a53;letter-spacing:1px;margin:0 0 8px;}',
      '.iq-pm h4{font-size:11.5px;font-weight:600;color:#074a53;margin:8px 0 4px;}',
      '.iq-pm-sub{border-top:1px dashed #d9e0de;margin-top:8px;padding-top:8px;}',
      '.iq-right{flex:1;}',
      '.iq-taxbox{background:#f2f5f4;border-radius:8px;padding:10px 14px;margin-bottom:12px;}',
      '.iq-taxbox h3{font-size:10.5px;font-weight:700;letter-spacing:1.5px;color:#074a53;margin:0 0 6px;}',
      '.iq-trow{display:flex;justify-content:space-between;font-size:12.5px;padding:4px 0;}',
      '.iq-due{background:#2ea05f;color:#fff;border-radius:8px;display:flex;justify-content:space-between;align-items:center;padding:10px 14px;margin-top:8px;font-size:14.5px;font-weight:700;}',
      '.iq-foot{display:flex;justify-content:space-between;font-size:10.5px;color:#5b6b72;border-top:1px solid #d9e0de;padding-top:8px;margin-top:24px;}'
    ].join('');
  }

  function printCurrentInvoice(){
    if (!currentInvoice) return;

    // PDF uses paginated HTML (repeated headers; footer only on last page)
    var pdfHtml = buildInvoiceHtml(currentInvoice, { forPdf: true });

    printDocument(pdfHtml, documentTitle(currentInvoice) + ' ' + currentInvoice.invoice_number);
  }

  function printDocument(pdfHtml, title){
    var oldFrame = document.getElementById('rdInvoicePrintFrame');
    if (oldFrame && oldFrame.parentNode) oldFrame.parentNode.removeChild(oldFrame);

    var iframe = document.createElement('iframe');
    iframe.id = 'rdInvoicePrintFrame';
    iframe.setAttribute('aria-hidden', 'true');
    iframe.setAttribute('title', 'Invoice print');
    document.body.appendChild(iframe);

    var win = iframe.contentWindow;
    var doc = iframe.contentDocument || (win && win.document);
    if (!doc || !win) return;

    doc.documentElement.lang = isFrench ? 'fr-CA' : 'en-CA';
    doc.title = title;

    var styleEl = doc.createElement('style');
    styleEl.appendChild(doc.createTextNode(getInvoicePrintCss()));
    doc.head.appendChild(styleEl);
    doc.body.innerHTML = pdfHtml;

    var cleaned = false;
    var cleanup = function(){
      if (cleaned) return;
      cleaned = true;
      setTimeout(function(){
        var frame = document.getElementById('rdInvoicePrintFrame');
        if (frame && frame.parentNode) frame.parentNode.removeChild(frame);
      }, 800);
    };

    var triggerPrint = function(){
      try {
        win.focus();
        if (typeof win.onafterprint !== 'undefined') {
          win.onafterprint = cleanup;
        }
        win.print();
        setTimeout(cleanup, 2000);
      } catch (err) {
        console.error('Invoice print failed', err);
        cleanup();
      }
    };

    var waitForAssets = function(){
      var images = Array.prototype.slice.call(doc.images || []);
      if (!images.length) {
        setTimeout(triggerPrint, 50);
        return;
      }
      var remaining = images.length;
      var done = function(){
        remaining -= 1;
        if (remaining <= 0) setTimeout(triggerPrint, 50);
      };
      images.forEach(function(img){
        if (img.complete) done();
        else {
          img.addEventListener('load', done);
          img.addEventListener('error', done);
        }
      });
    };

    setTimeout(waitForAssets, 30);
  }

  function buildStatementHtml(statement){
    const invoices = statement.invoices;
    const credits = statement.credit_notes || [];
    const company = resolveCompany({ company: statement.company });
    const customer = invoices[0] || credits[0] || {};
    const pages = [];
    for (const [kind, rows] of [['invoice', invoices], ['credit', credits]]) {
      if (kind === 'invoice' && !rows.length) pages.push({ kind, rows: [] });
      for (let i = 0; i < rows.length; i += 20) pages.push({ kind, rows: rows.slice(i, i + 20) });
    }
    const totals = statement.totals.map(total => ({
      currency: total.currency,
      lines: [
        [tr('Total unpaid invoices','Total des factures impayées'), exactMoney(total.unpaid_total, total.currency)],
        [tr('Less unapplied credit notes','Moins les notes de crédit non appliquées'), exactMoney(total.credit_total, total.currency)],
        [String(total.balance).startsWith('-') ? tr('Credit balance','Solde créditeur') : tr('Balance due','Solde dû'),
          exactMoney(total.balance, total.currency)]
      ]
    }));
    if (totals.length <= 2 && pages[pages.length - 1].rows.length <= 10) pages[pages.length - 1].totals = totals;
    else for (let i = 0; i < totals.length; i += 6) pages.push({ kind: 'summary', totals: totals.slice(i, i + 6) });

    return '<div class="iq-invoice">' + pages.map(({kind, rows, totals}, index) => {
      const isCredit = kind === 'credit';
      const summaryOnly = kind === 'summary';
      const sectionTitle = summaryOnly ? tr('Summary','Sommaire') : isCredit
        ? tr('Unapplied credit notes','Notes de crédit non appliquées') : tr('Unpaid invoices','Factures impayées');
      const headers = isCredit
        ? [creditLabels[1], 'Date', creditLabels[2], creditLabels[3], tr('Currency','Devise'), tr('Credit total','Total du crédit'), creditLabels[7]]
        : [tr('Invoice','Facture'), 'Date', creditLabels[3], creditLabels[4], tr('Currency','Devise'), tr('Invoice total','Total de la facture'), tr('Amount due','Montant dû')];
      const body = summaryOnly ? '' : !rows.length ? '<p>' + tr('No unpaid invoices','Aucune facture impayée') + '</p>' :
        '<table class="iq-items"><thead><tr>' + headers.map(label => '<th>' + label + '</th>').join('') + '</tr></thead><tbody>' +
        rows.map(row => {
          const signed = value => isCredit && Number(value) > 0 ? '-' + String(value).trim() : value;
          const order = isCredit ? [row.related_invoice_number, row.order_no] : [row.order_no, row.po_number];
          const cells = [escapeHtml(row.invoice_number), formatDate(row.invoice_date), ...order.map(escapeHtml),
            escapeHtml(row.currency), exactMoney(signed(row.total_amount), row.currency), exactMoney(signed(row.amount_due), row.currency)];
          return '<tr>' + cells.map((cell,i) => '<td' + (i > 4 ? ' class="r"' : '') + '>' + cell + '</td>').join('') + '</tr>';
        }).join('') + '</tbody></table>';

      const summary = !totals ? '' : '<div class="iq-bottom"><div class="iq-right">' +
        totals.map(total => total.lines.map(([label, value], i) =>
          '<div class="' + (i === 2 ? 'iq-due' : 'iq-trow') + '"><span>' + label +
          ' (' + escapeHtml(total.currency) + ')</span><span>' + value + '</span></div>').join('')).join('') + '</div></div>';
      return '<section class="iq-page' + (index === pages.length - 1 ? ' iq-page-last' : '') + '">' +
        '<div class="iq-accent"><div class="t"></div><div class="g"></div></div><div class="iq-hdr"><div>' +
        (company.logo_url ? '<img class="iq-logo" src="' + escapeHtml(company.logo_url) + '" alt="' + escapeHtml(company.company_name) + '">' : '') +
        '<div class="iq-brand">' + escapeHtml(company.company_name) + '</div><div class="iq-co">' + companyAddressHtml(company) + '</div></div>' +
        '<div class="iq-invtitle"><div class="t">' + tr('STATEMENT OF ACCOUNT','RELEVÉ DE COMPTE') + '</div><h2>' + sectionTitle + '</h2>' +
        '<div>' + tr('As of ','En date du ') + formatDate(statement.generated_at) + '</div><div>Page ' +
        (index + 1) + tr(' of ',' sur ') + pages.length + '</div></div></div>' +
        '<div class="iq-addr"><div><div class="iq-lbl">' + tr('CUSTOMER','CLIENT') + '</div><p>' + addressLines(customer.sold_to) +
        '</p><p>' + tr('Customer no.: ','N° de client : ') + escapeHtml(customer.customer_no || cfg.customerId || '') + '</p></div></div>' +
        body + summary + '<div class="iq-foot"><span>' +
        tr('All unpaid invoices and unapplied credit notes as of the statement date. Partial payments and partial credit applications are reflected in the amounts shown.',
          'Toutes les factures impayées et notes de crédit non appliquées à la date du relevé. Les paiements partiels et les applications partielles de crédit sont pris en compte dans les montants affichés.') +
        '</span></div></section>';
    }).join('') + '</div>';
  }

  const statementBtn = document.getElementById('rdStatementDownload');
  const statementStatus = document.getElementById('rdStatementStatus');
  if (statementBtn) statementBtn.addEventListener('click', async function(){
    statementBtn.disabled = true;
    if (statementStatus) statementStatus.textContent = (isFrench ? 'Préparation du relevé...' : 'Preparing statement...');
    try {
      const result = await fetchJson(cfg.proxyBase + '/statement');
      if (!result.data || !Array.isArray(result.data.invoices)) throw new Error('Invalid statement response');
      if (!result.data.invoices.length && !result.data.credit_notes?.length) {
        if (statementStatus) statementStatus.textContent = (isFrench ? 'Aucune facture impayée ni note de crédit non appliquée pour votre compte.' : 'No unpaid invoices or unapplied credit notes for your account.');
        return;
      }
      printDocument(buildStatementHtml(result.data), (isFrench ? 'Relevé de compte' : 'Statement of account'));
      if (statementStatus) statementStatus.textContent = (isFrench ? 'Choisissez Enregistrer au format PDF dans la fenêtre d’impression pour télécharger votre relevé.' : 'Choose Save as PDF in the print dialog to download your statement.');
    } catch (err) {
      if (statementStatus) statementStatus.textContent = (isFrench ? 'Impossible de télécharger le relevé. Veuillez réessayer.' : 'Unable to download statement. Please try again.');
      console.error('Statement failed', err);
    } finally {
      statementBtn.disabled = false;
    }
  });

  async function openInvoice(id){
    preview.innerHTML = '<div class="rd-invoice-loading">' + (credit ? tr('Loading credit note…','Chargement de la note de crédit…') : tr('Loading invoice…','Chargement de la facture…')) + '</div>';
    modal.classList.add('active');
    try {
      const result = await fetchJson(cfg.proxyBase + '/' + encodeURIComponent(id));
      if (!result || !result.data) {
        modal.classList.remove('active');
        return;
      }
      renderInvoiceDetail(result.data);
    } catch (err) {
      console.error('Invoice detail load failed', err);
      modal.classList.remove('active');
      preview.innerHTML = '';
      currentInvoice = null;
    }
  }

  async function downloadInvoicePdf(id){
    try {
      if (!currentInvoice || String(currentInvoice.id) !== String(id)) {
        preview.innerHTML = '<div class="rd-invoice-loading">' + (isFrench ? "Préparation du PDF..." : 'Preparing PDF...') + '</div>';
        modal.classList.add('active');
        const result = await fetchJson(cfg.proxyBase + '/' + encodeURIComponent(id) + '?download=1');
        if (!result || !result.data) {
          modal.classList.remove('active');
          return;
        }
        if (result.data.downloadable === false) {
          preview.innerHTML = '<div class="rd-invoice-error">' + tr('Required totals are missing. This document cannot be downloaded.','Des totaux requis sont manquants. Ce document ne peut pas être téléchargé.') + '</div>';
          setPdfButtonState(result.data);
          return;
        }
        renderInvoiceDetail(result.data);
      } else if (!modal.classList.contains('active')) {
        modal.classList.add('active');
      }
      if (currentInvoice && currentInvoice.downloadable === false) {
        setPdfButtonState(currentInvoice);
        return;
      }
      setTimeout(printCurrentInvoice, 50);
    } catch (err) {
      console.error('Invoice PDF prepare failed', err);
      if (err && err.status === 422) {
        preview.innerHTML = '<div class="rd-invoice-error">' + tr('Required totals are missing. This document cannot be downloaded.','Des totaux requis sont manquants. Ce document ne peut pas être téléchargé.') + '</div>';
        modal.classList.add('active');
        return;
      }
      modal.classList.remove('active');
    }
  }

  if (prevBtn) {
    prevBtn.addEventListener('click', function(){
      if (page > 1) loadPage(page - 1);
    });
  }
  if (nextBtn) {
    nextBtn.addEventListener('click', function(){
      if (page < totalPages) loadPage(page + 1);
    });
  }
  if (closeBtn) {
    closeBtn.addEventListener('click', function(){
      modal.classList.remove('active');
    });
  }
  if (modal) {
    modal.addEventListener('click', function(event){
      if (event.target === modal) modal.classList.remove('active');
    });
  }
  if (pdfBtn) {
    pdfBtn.addEventListener('click', function(){
      if (currentInvoice && currentInvoice.id) {
        downloadInvoicePdf(currentInvoice.id);
      } else {
        printCurrentInvoice();
      }
    });
  }

  if (searchInput) {
    searchInput.addEventListener('input', scheduleFilterReload);
  }
  if (dateFromInput) {
    dateFromInput.addEventListener('change', function(){ loadPage(1); });
  }
  if (dateToInput) {
    dateToInput.addEventListener('change', function(){ loadPage(1); });
  }
  if (balanceSelect) {
    balanceSelect.addEventListener('change', function(){ loadPage(1); });
  }
  if (clearFiltersBtn) {
    clearFiltersBtn.addEventListener('click', function(){
      if (searchInput) searchInput.value = '';
      if (dateFromInput) dateFromInput.value = '';
      if (dateToInput) dateToInput.value = '';
      if (balanceSelect) balanceSelect.value = '';
      loadPage(1);
    });
  }

  // Show stats shell immediately so UI is not blank before fetch
  if (statsEl) {
    statsEl.hidden = false;
    statsEl.removeAttribute('hidden');
  }

  const tabFromUrl = () => new URLSearchParams(location.search).get('tab') === 'credit-notes' ? 'credit-notes' : 'invoices';
  for (const [tab,label] of Object.entries(tabLabels)) {
    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'rd-invoice-filter';
    button.dataset.tab = tab;
    button.textContent = label;
    button.addEventListener('click', () => {
      if (tab === tabFromUrl()) return;
      const url = new URL(location.href);
      url.searchParams.set('tab', tab);
      url.hash = 'rd-invoices';
      history.pushState(null, '', url);
      selectTab(tab);
    });
    tabGroup.append(button);
  }
  const initialTab = tabFromUrl();
  selectTab(initialTab);
  const other = initialTab === 'invoices' ? 'credit-notes' : 'invoices';
  fetchJson(cfg.proxyBase + '?page_size=1' + (other === 'credit-notes' ? '&document_type=credit_note' : ''))
    .then(result => {
      if (tabGroup.querySelector('[data-tab="' + other + '"]').textContent === tabLabels[other]) updateCount(other, result.meta?.summary);
      if (other === 'invoices' && credit && result.meta) updateStats(result.meta);
    })
    .catch(error => console.error('Billing count load failed', error));
  window.addEventListener('popstate', () => {
    const tab = tabFromUrl();
    if (credit !== (tab === 'credit-notes')) selectTab(tab);
  });
})();
