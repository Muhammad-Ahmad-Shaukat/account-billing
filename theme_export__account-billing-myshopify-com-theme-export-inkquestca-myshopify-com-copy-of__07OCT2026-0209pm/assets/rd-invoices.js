(function(){
  const cfg = window.RD_INVOICES;
  if (!cfg || !cfg.loggedIn) return;

  const tbody = document.getElementById('rdInvoiceTableBody');
  const pager = document.getElementById('rdInvoicePager');
  const pagerInfo = document.getElementById('rdInvoicePagerInfo');
  const prevBtn = document.getElementById('rdInvoicePrev');
  const nextBtn = document.getElementById('rdInvoiceNext');
  const modal = document.getElementById('rdInvoiceModal');
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
      return new Intl.NumberFormat('en-CA', {
        style: 'currency',
        currency: currency || 'CAD'
      }).format(number);
    } catch (e) {
      return escapeHtml(String(value));
    }
  }

  function formatDate(value){
    if (!value) return '';
    const raw = String(value).slice(0, 10);
    const parts = raw.split('-');
    if (parts.length !== 3) return escapeHtml(raw);
    const d = new Date(Date.UTC(+parts[0], +parts[1] - 1, +parts[2]));
    if (isNaN(d.getTime())) return escapeHtml(raw);
    return escapeHtml(d.toLocaleDateString('en-US', {
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

  function renderLineRows(pageLines, currency){
    return pageLines.map(function(line){
      return '<tr>' +
        '<td class="c">' + qty(line.qty_ordered) + '</td>' +
        '<td class="c">' + qty(line.qty_shipped) + '</td>' +
        '<td class="c">' + qty(line.qty_backorder) + '</td>' +
        '<td>' + escapeHtml(line.item_number || '') + '</td>' +
        '<td>' + escapeHtml(line.description || '').replace(/\n/g, '<br>') + '</td>' +
        '<td class="r">' + (line.unit_price == null || line.unit_price === '' ? '' : money(line.unit_price, currency)) + '</td>' +
        '<td class="c">' + escapeHtml(line.uom || '') + '</td>' +
        '<td class="r">' + money(line.extended_price, currency) + '</td>' +
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
          '<div class="t">INVOICE</div>' +
          '<h1>' + escapeHtml(invoice.invoice_number || '') + '</h1>' +
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
        '<div class="iq-trow"><span>Subtotal</span><span>' + money(invoice.subtotal, currency) + '</span></div>' +
        '<div class="iq-trow"><span>Total sales tax</span><span>' + money(invoice.total_tax, currency) + '</span></div>' +
        '<div class="iq-trow"><span>Total amount</span><span>' + money(invoice.total_amount, currency) + '</span></div>' +
        '<div class="iq-trow"><span>Less payment</span><span>' + money(invoice.less_payment, currency) + '</span></div>' +
        '<div class="iq-due"><span>Amount due</span><span>' + money(invoice.amount_due, currency) + '</span></div>' +
      '</div>' +
    '</div>';
  }

  function buildItemsTable(pageLines, currency, rangeLabel){
    return '<div class="iq-itemsbar">' +
        '<h3>LINE ITEMS' + (rangeLabel ? (': ' + escapeHtml(rangeLabel)) : '') + '</h3>' +
      '</div>' +
      '<table class="iq-items">' +
      '<thead><tr>' +
        '<th class="c">Qty Ord.</th><th class="c">Qty Shp.</th><th class="c">B/O</th>' +
        '<th>Item Number</th><th>Description</th>' +
        '<th class="r">Unit Price</th><th class="c">UOM</th><th class="r">Extended Price</th>' +
      '</tr></thead><tbody>' + renderLineRows(pageLines, currency) + '</tbody>' +
    '</table>';
  }

  function buildPageFoot(invoice, company, pageNo, pageCount){
    const pageLabel = pageNo + (pageCount > 1 ? (' of ' + pageCount) : '');
    return '<div class="iq-foot">' +
      '<span>' + escapeHtml(company.company_name || 'INK QUEST') +
        ' &nbsp;&bull;&nbsp; ' + escapeHtml(company.street_address1 || '') +
        (company.street_address2 ? (', ' + escapeHtml(company.street_address2)) : '') +
      '</span>' +
      '<span>Invoice ' + escapeHtml(invoice.invoice_number || '') +
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
    options = options || {};
    const forPdf = !!options.forPdf;
    const lines = Array.isArray(invoice.lines) ? invoice.lines : [];
    const taxLines = Array.isArray(invoice.tax_lines) ? invoice.tax_lines : [];
    const currency = invoice.currency || 'CAD';
    const company = resolveCompany(invoice);
    const logo = company.logo_url
      ? '<img class="iq-logo" src="' + escapeHtml(company.logo_url) + '" alt="' + escapeHtml(company.company_name) + '">'
      : '';

    const taxRows = taxLines.map(function(tax){
      return '<div class="iq-trow"><span>' + escapeHtml(tax.code || '') + '</span><span>' + money(tax.amount, currency) + '</span></div>';
    }).join('') +
      '<div class="iq-trow"><span>Tax Exempt Code</span><span>' + escapeHtml(invoice.tax_exempt_code || '') + '</span></div>';

    // On-screen View: single document, no repeated headers
    if (!forPdf) {
      return '<div class="iq-invoice">' +
        '<section class="iq-page iq-page-last">' +
          buildPageHeader(invoice, company, logo, 1, 1) +
          buildItemsTable(lines, currency, lines.length ? ('1 – ' + lines.length) : '') +
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
        buildItemsTable(pageLines, currency, rangeLabel) +
        (isLast
          ? buildTotalsFooter(company, invoice, taxRows, currency)
          : '<div class="iq-cont">Continued on next page…</div>') +
        buildPageFoot(invoice, company, pageNo, pageCount) +
      '</section>';
    }).join('') + '</div>';
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
      return { label: 'Unknown', cls: 'processing' };
    }
    const n = Number(String(raw).replace(/,/g, ''));
    if (!Number.isFinite(n)) {
      return { label: 'Unknown', cls: 'processing' };
    }
    if (n <= 0) {
      return { label: 'Paid', cls: 'paid' };
    }
    return { label: 'Due', cls: 'pending' };
  }

  function renderEmpty(){
    tbody.innerHTML =
      '<tr><td colspan="7"><div class="rd-invoice-empty">' +
        '<h3>No invoices</h3>' +
        '<p>There are no invoices for your account right now.</p>' +
        '<button type="button" class="rd-invoice-refresh" id="rdInvoiceRefresh">Refresh</button>' +
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
      statsEl.hidden = false;
      statsEl.removeAttribute('hidden');
      statsEl.style.display = '';
    }
    if (invoiceCountEl) {
      invoiceCountEl.textContent = meta.total != null ? String(meta.total) : '0';
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
      ? 'Download PDF'
      : 'Invoice cannot be downloaded — required totals missing';
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
        ? '<button type="button" class="rd-invoice-action send" title="Download PDF" data-invoice-pdf="' + escapeHtml(inv.id) + '">PDF</button>'
        : '<button type="button" class="rd-invoice-action send" title="Not downloadable" disabled style="opacity:.45;cursor:not-allowed;">PDF</button>';

      const pay = paymentStatus(inv);
      return '<tr>' +
        '<td><div class="rd-invoice-number">' + escapeHtml(inv.invoice_number) + '</div></td>' +
        '<td>' + formatDate(inv.invoice_date) + '</td>' +
        '<td><div class="rd-invoice-order">' + escapeHtml(inv.order_no || '') + '</div></td>' +
        '<td>' + escapeHtml(inv.po_number || '') + '</td>' +
        '<td class="rd-invoice-total">' + money(inv.total_amount, inv.currency) + '</td>' +
        '<td><span class="rd-invoice-badge ' + pay.cls + '">' + escapeHtml(pay.label) + '</span></td>' +
        '<td><div class="rd-invoice-actions">' +
          '<button type="button" class="rd-invoice-action" title="View Invoice" data-invoice-id="' + escapeHtml(inv.id) + '">View</button>' +
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
      ? ('Page ' + page + ' of ' + totalPages + ' - ' + meta.total + ' invoices')
      : '';
    prevBtn.disabled = page <= 1;
    nextBtn.disabled = page >= totalPages;
  }

  async function loadPage(nextPage){
    page = nextPage;
    if (statsEl) {
      statsEl.hidden = false;
      statsEl.removeAttribute('hidden');
    }
    tbody.innerHTML = '<tr><td colspan="7"><div class="rd-invoice-loading">Loading invoices...</div></td></tr>';
    try {
      const result = await fetchJson(buildListUrl(page));
      const rows = Array.isArray(result.data) ? result.data : [];
      renderRows(rows);
      const meta = result.meta || { page: 1, totalPages: 1, total: rows.length };
      updatePager(meta);
      updateStats(meta);
    } catch (err) {
      console.error('Invoice list load failed', err);
      renderEmpty();
      updateStats({ total: 0, outstanding_balance: null });
      if (outstandingEl) {
        outstandingEl.textContent = '—';
        outstandingEl.title = 'Could not load balance (' + (err && err.message ? err.message : 'error') + ')';
      }
    }
  }

  function renderInvoiceDetail(invoice){
    if (!invoice) {
      modal.classList.remove('active');
      return;
    }
    currentInvoice = invoice;
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

    doc.title = (currentInvoice && currentInvoice.invoice_number)
      ? ('Invoice ' + currentInvoice.invoice_number)
      : 'Invoice';

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

  async function openInvoice(id){
    preview.innerHTML = '<div class="rd-invoice-loading">Loading invoice...</div>';
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
        preview.innerHTML = '<div class="rd-invoice-loading">Preparing PDF...</div>';
        modal.classList.add('active');
        const result = await fetchJson(cfg.proxyBase + '/' + encodeURIComponent(id) + '?download=1');
        if (!result || !result.data) {
          modal.classList.remove('active');
          return;
        }
        if (result.data.downloadable === false) {
          preview.innerHTML = '<div class="rd-invoice-error">This invoice is missing required totals and cannot be downloaded.</div>';
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
        preview.innerHTML = '<div class="rd-invoice-error">This invoice is missing required totals and cannot be downloaded.</div>';
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

  loadPage(1);
})();
