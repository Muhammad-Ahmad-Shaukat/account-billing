(function () {
  'use strict';
  var cfg = window.SAP_CHECKOUT_CONFIG || {};
  var busy = false;
  console.info('[SAP checkout] loaded v3', { customerId: cfg.customerId, shop: cfg.shop, apiBase: cfg.apiBase });

  async function start() {
    if (busy) return;
    busy = true;
    window.__sapCheckoutInProgress = true;
    var controller = new AbortController();
    var deadline = setTimeout(function () { controller.abort(); }, 45000);
    var loader = document.querySelector('.loaderBars');
    if (loader) loader.style.display = 'block';
    document.body.classList.add('RunningLoader');
    async function request(url, body) {
      console.info('[SAP checkout] request', { url: url });
      var response = await fetch(url, {
        method: body ? 'POST' : 'GET',
        headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
        credentials: 'same-origin',
        signal: controller.signal,
        ...(body ? { body: JSON.stringify(body) } : {}),
      });
      if (!response.ok) throw new Error(url + ' HTTP ' + response.status);
      var data;
      try { data = await response.json(); }
      catch (_) { throw new Error(url + ' did not return JSON; check the app proxy configuration'); }
      return data;
    }
    try {
      if (!cfg.customerId) throw new Error('Customer is not logged in');
      var root = (window.Shopify && window.Shopify.routes.root) || '/';
      var cart = await request(root + 'cart.js');
      if (!cart.items || !cart.items.length) throw new Error('Cart is empty');
      cart.customer_id = cfg.customerId;
      cart.shop = cfg.shop;
      var base = cfg.apiBase || '/apps/sap-price-test';
      var job = await request(base + '/createDraftOrder', { data: cart, shop: cfg.shop });
      if (!job.jobId) throw new Error('Pricing job did not return a jobId');
      console.info('[SAP checkout] pricing job started', { jobId: job.jobId, items: cart.items.length });
      while (!controller.signal.aborted) {
        var result = await request(base + '/check-checkout-url', { jobId: job.jobId, shop: cfg.shop });
        console.info('[SAP checkout] pricing result', {
          status: result.status, mode: result.checkoutMode, discountValue: result.discountValue,
          hasDiscountCode: Boolean(result.discountCode), reason: result.reason,
          error: result.diagnostics && result.diagnostics.discountError || result.error,
        });
        if (result.status === 'failed') {
          throw new Error(result.diagnostics && result.diagnostics.discountError || result.reason || result.error || 'Pricing job failed');
        }
        if (result.status === 'completed') {
          if (!result.redirectUrl) throw new Error('Pricing job returned no checkout URL');
          if (Number(result.discountValue) > 0 && !result.discountCode) {
            throw new Error('Pricing job calculated savings but returned no discount code');
          }
          var target = new URL(result.redirectUrl, window.location.href);
          if (!['https:', 'http:'].includes(target.protocol) ||
              ![window.location.hostname, cfg.shop].includes(target.hostname) ||
              !/\/checkout\/?$/.test(target.pathname)) throw new Error('Invalid checkout URL');
          if (result.discountCode) target.searchParams.set('discount', result.discountCode);
          console.info('[SAP checkout] opening checkout', { discountValue: result.discountValue, hasDiscountCode: Boolean(result.discountCode) });
          window.location.assign(target.href);
          return;
        }
        await new Promise(function (resolve) { setTimeout(resolve, 1000); });
      }
      throw new Error('Customer pricing timed out');
    } catch (error) {
      console.error('[SAP checkout] stopped', error);
      window.__sapCheckoutInProgress = false;
      window.alert(cfg.customerId
        ? 'We could not prepare your customer pricing. Please try again or contact the store.'
        : 'Please sign in before checking out with customer pricing.');
    } finally {
      clearTimeout(deadline);
      busy = false;
      if (loader) loader.style.display = 'none';
      document.body.classList.remove('RunningLoader');
    }
  }

  window.SAPCheckout = { start: start, version: '3' };
})();
