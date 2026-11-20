/*
 * SAP customer-specific pricing for product cards.
 *
 * How it works:
 * 1. Liquid always renders the real Shopify price inside .sap-card-price,
 *    so a price is visible immediately with zero JavaScript dependency.
 * 2. For logged-in customers, their SAP price is fetched in ONE bulk request
 *    and swapped in (fetch-then-swap). The Shopify price is never hidden
 *    first, and it stays as the permanent fallback if the fetch fails.
 * 3. Faceted search / filters re-render the grid via innerHTML, which never
 *    executes inline scripts — so a MutationObserver re-runs the upgrade
 *    for every newly added card.
 */
(function () {
  'use strict';

  var API_URL =
    'https://ratandeep-sap-client.onrender.com/apps/sap-price-test/get-all-redis-pricing';

  function getCustomerId() {
    var el = document.querySelector('.sap-card-price[data-customer-id]');
    var v = el && el.getAttribute('data-customer-id');
    return v || '';
  }

  function formatPrice(price) {
    return new Intl.NumberFormat(undefined, {
      style: 'currency',
      currency: 'CAD'
    }).format(Number(price));
  }

  /*
   * Shopify variant.price is in cents.
   * Use the SAP price only when it is > 0 and strictly below Shopify.
   */
  function resolveDisplayPrice(sapPrice, shopifyCents) {
    var shopifyDollars =
      shopifyCents !== null && shopifyCents !== undefined && shopifyCents !== ''
        ? Number(shopifyCents) / 100
        : NaN;
    var redisPrice = Number(sapPrice);

    if (!isFinite(redisPrice) || redisPrice <= 0) {
      return isFinite(shopifyDollars) ? shopifyDollars : null;
    }
    if (isFinite(shopifyDollars) && redisPrice >= shopifyDollars) {
      return shopifyDollars;
    }
    return redisPrice;
  }

  function collectFreshCards(root) {
    var cards = [];
    if (
      root.nodeType === 1 &&
      root.classList.contains('sap-card-price') &&
      !root.hasAttribute('data-sap-done')
    ) {
      cards.push(root);
    }
    var nodes = root.querySelectorAll
      ? root.querySelectorAll('.sap-card-price:not([data-sap-done])')
      : [];
    for (var i = 0; i < nodes.length; i++) cards.push(nodes[i]);
    return cards;
  }

  function markDone(cards) {
    cards.forEach(function (c) {
      c.setAttribute('data-sap-done', 'true');
    });
  }

  function upgradeCards(cards) {
    if (!cards.length) return;
    markDone(cards);

    var customerId = getCustomerId();
    if (!customerId) return; // guest: Shopify prices already visible

    var skus = [];
    var cardsBySku = {};
    cards.forEach(function (card) {
      var sku = card.getAttribute('data-sku');
      if (!sku) return;
      if (skus.indexOf(sku) === -1) skus.push(sku);
      (cardsBySku[sku] = cardsBySku[sku] || []).push(card);
    });
    if (!skus.length) return;

    // Bounded request: if the SAP API hangs, give up after 8s and keep the
    // Shopify prices that are already visible on the cards.
    var controller = new AbortController();
    var timer = setTimeout(function () {
      controller.abort();
    }, 8000);

    fetch(API_URL, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Accept: 'application/json'
      },
      body: JSON.stringify({
        customerId: customerId,
        skus: skus,
        shopUrl: window.location.origin
      }),
      signal: controller.signal
    })
      .then(function (res) {
        clearTimeout(timer);
        if (!res.ok) throw new Error('SAP API responded ' + res.status);
        return res.json();
      })
      .then(function (data) {
        var prices = (data && data.prices) || {};
        skus.forEach(function (sku) {
          var sapPrice = prices[sku];
          // No SAP price -> keep the Shopify price already on screen.
          if (sapPrice === null || sapPrice === undefined || sapPrice === '')
            return;
          (cardsBySku[sku] || []).forEach(function (card) {
            var finalPrice = resolveDisplayPrice(
              sapPrice,
              card.getAttribute('data-shopify-price')
            );
            if (finalPrice === null || finalPrice === undefined) return;
            var priceEl =
              card.querySelector('.price-item--regular') ||
              card.querySelector('.price-item');
            if (priceEl) priceEl.textContent = formatPrice(finalPrice);
          });
        });
      })
      .catch(function (e) {
        clearTimeout(timer);
        // Shopify prices stay visible — never leave a card priceless.
        console.warn(
          '[SAP] customer pricing unavailable, keeping Shopify prices:',
          e
        );
      });
  }

  function init(root) {
    upgradeCards(collectFreshCards(root || document));
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', function () {
      init(document);
    });
  } else {
    init(document);
  }

  function upgradeDynamicContent() {
    // Customer-specific prices (idempotent via data-sap-done).
    init(document);
    // Warehouse inventory (idempotent via data-inventory-loaded).
    if (typeof window.InkQuestLoadWarehouseInventory === 'function') {
      try {
        window.InkQuestLoadWarehouseInventory();
      } catch (e) {
        console.warn('[WAREHOUSE] inventory reload failed:', e);
      }
    }
  }

  // Re-run for cards added later (e.g. faceted filters re-render the grid
  // via innerHTML, which never executes inline scripts).
  if (window.MutationObserver) {
    new MutationObserver(function (mutations) {
      for (var i = 0; i < mutations.length; i++) {
        var added = mutations[i].addedNodes;
        for (var j = 0; j < added.length; j++) {
          var n = added[j];
          if (n.nodeType !== 1 || !n.querySelectorAll) continue;
          var hasPriceCard =
            n.classList.contains('sap-card-price') ||
            n.querySelector('.sap-card-price:not([data-sap-done])');
          var hasInventoryCard =
            n.classList.contains('collection-warehouse-stock') ||
            n.querySelector(
              '.collection-warehouse-stock[data-variant-id]:not([data-inventory-loaded])'
            );
          if (hasPriceCard || hasInventoryCard) {
            upgradeDynamicContent();
            return;
          }
        }
      }
    }).observe(document.documentElement, {
      childList: true,
      subtree: true
    });
  }
})();
