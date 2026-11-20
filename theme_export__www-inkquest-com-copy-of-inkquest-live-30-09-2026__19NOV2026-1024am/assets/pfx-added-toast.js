/* pfx-added-toast.js
 * Center-popup "Item added to your cart" confirmation.
 *
 * The theme's Cart type setting does not reliably render Dawn's <cart-notification>
 * element, so this provides a dependable confirmation independent of Dawn's
 * notification system. It wraps window.fetch to detect successful POSTs to
 * /cart/add.js and shows a centered popup card over a dimmed page.
 * Works on mobile and desktop (card is min(92vw, 420px), centered) and in
 * English and French (text follows <html lang> / /fr/ path).
 */
(function () {
  'use strict';

  // Dummy cart-notification element: prevents Dawn's product-form.js from
  // redirecting to /cart when no notification/drawer element exists.
  // product-form.js checks `document.querySelector('cart-notification')` and
  // redirects if null. This stub satisfies the check; the visible feedback
  // is handled by the popup below, not Dawn's popup.
  if (window.customElements && !customElements.get('cart-notification')) {
    customElements.define('cart-notification', class extends HTMLElement {
      getSectionsToRender() { return []; }
      setActiveElement() {}
      renderContents() {}
    });
    // Insert the element so querySelector finds it.
    var stub = document.createElement('cart-notification');
    stub.style.display = 'none';
    (document.body || document.documentElement).appendChild(stub);
  }

  var TOAST_ID = 'pfx-added-toast';
  var HIDE_MS = 2000;
  var hideTimer = null;

  // French storefront shows French popup text. <html lang> comes from
  // request.locale.iso_code; fall back to the /fr/ path prefix.
  // French wording is a sensible translation, open to the owner's correction.
  var IS_FR = (document.documentElement.lang || '').toLowerCase().indexOf('fr') === 0 ||
    window.location.pathname.indexOf('/fr/') === 0;
  var T = IS_FR
    ? { added: 'Article ajouté à votre panier', sub: 'Votre article est dans votre panier', viewCart: 'Voir le panier', dismiss: 'Fermer', items: 'articles', cartUrl: '/fr/cart' }
    : { added: 'Item added to your cart', sub: 'Your item is waiting in the cart', viewCart: 'View cart', dismiss: 'Dismiss', items: 'items', cartUrl: '/cart' };

  function ensureToast() {
    var el = document.getElementById(TOAST_ID);
    if (el) return el;

    el = document.createElement('div');
    el.id = TOAST_ID;
    el.setAttribute('role', 'status');
    el.setAttribute('aria-live', 'polite');
    el.innerHTML =
      '<div class="pfx-popup-card">' +
      '<button class="pfx-popup-close" aria-label="' + T.dismiss + '">&times;</button>' +
      '<svg class="pfx-popup-check" viewBox="0 0 20 20" width="52" height="52" aria-hidden="true">' +
      '<circle cx="10" cy="10" r="9" fill="#1a7f37"/>' +
      '<path d="M6 10.5l2.5 2.5L14 7.5" stroke="#fff" stroke-width="2" fill="none" stroke-linecap="round" stroke-linejoin="round"/>' +
      '</svg>' +
      '<div class="pfx-popup-title">' + T.added + '</div>' +
      '<div class="pfx-popup-sub">' + T.sub + '</div>' +
      '<a class="pfx-popup-cart" href="' + T.cartUrl + '">' + T.viewCart + '</a>' +
      '</div>';

    var style = document.createElement('style');
    style.textContent =
      '#' + TOAST_ID + ' { position: fixed; inset: 0; z-index: 99999; display: flex; align-items: center; justify-content: center;' +
      ' background: rgba(0,0,0,.5); opacity: 0; visibility: hidden; pointer-events: none;' +
      ' transition: opacity .25s ease, visibility 0s linear .25s; }' +
      '#' + TOAST_ID + '.pfx-show { opacity: 1; visibility: visible; pointer-events: auto;' +
      ' transition: opacity .25s ease, visibility 0s; }' +
      '#' + TOAST_ID + ' .pfx-popup-card { position: relative; width: min(92vw, 420px); background: #fff; color: #111;' +
      ' border-radius: 14px; padding: 28px 24px 24px; text-align: center; box-shadow: 0 16px 48px rgba(0,0,0,.4);' +
      ' transform: scale(.96); transition: transform .25s ease; }' +
      '#' + TOAST_ID + '.pfx-show .pfx-popup-card { transform: scale(1); }' +
      '#' + TOAST_ID + ' .pfx-popup-check { display: block; margin: 0 auto 14px; }' +
      '#' + TOAST_ID + ' .pfx-popup-title { font-size: 18px; font-weight: 700; margin-bottom: 6px; }' +
      '#' + TOAST_ID + ' .pfx-popup-sub { font-size: 13px; color: #555; margin-bottom: 18px; }' +
      '#' + TOAST_ID + ' .pfx-popup-cart { display: block; background: #e6a817; color: #111; font-weight: 700;' +
      ' text-decoration: none; border-radius: 8px; padding: 12px; }' +
      '#' + TOAST_ID + ' .pfx-popup-close { position: absolute; top: 8px; right: 12px; background: none; border: 0;' +
      ' color: #666; font-size: 24px; line-height: 1; cursor: pointer; padding: 0 2px; }';

    document.head.appendChild(style);
    document.body.appendChild(el);

    el.querySelector('.pfx-popup-close').addEventListener('click', hideToast);
    el.addEventListener('click', function (e) {
      if (e.target === el) hideToast();
    });
    return el;
  }

  function showToast() {
    var el = ensureToast();
    el.classList.add('pfx-show');
    if (hideTimer) clearTimeout(hideTimer);
    hideTimer = setTimeout(hideToast, HIDE_MS);
  }

  function hideToast() {
    var el = document.getElementById(TOAST_ID);
    if (el) el.classList.remove('pfx-show');
    if (hideTimer) { clearTimeout(hideTimer); hideTimer = null; }
  }

  // Update the custom header cart badge (Dawn's cart-notification.js only
  // refreshes #cart-icon-bubble, but the active custom header uses
  // #pfx-cart-icon [data-pfx-cart-count]).
  function updateBadge() {
    try {
      origFetch('/cart.js', { headers: { 'Accept': 'application/json' } })
        .then(function (r) { return r.ok ? r.json() : null; })
        .then(function (cart) {
          if (!cart || typeof cart.item_count !== 'number') return;
          var badges = document.querySelectorAll('[data-pfx-cart-count]');
          for (var i = 0; i < badges.length; i++) {
            badges[i].textContent = cart.item_count;
          }
          // Also update Dawn's standard bubble if present.
          // Structure: #cart-icon-bubble .cart-count-bubble > span[aria-hidden] (visible)
          //            + span.visually-hidden (screen reader)
          var bubble = document.getElementById('cart-icon-bubble');
          if (bubble) {
            var countBubble = bubble.querySelector('.cart-count-bubble');
            if (countBubble) {
              var visibleCount = countBubble.querySelector('span[aria-hidden="true"]');
              var srCount = countBubble.querySelector('span.visually-hidden');
              if (visibleCount) visibleCount.textContent = cart.item_count;
              else countBubble.textContent = cart.item_count;
              if (srCount) srCount.textContent = cart.item_count + ' ' + T.items;
              countBubble.classList.toggle('hidden', cart.item_count === 0);
            }
          }
        })
        .catch(function () {});
    } catch (e) {}
  }

  // Wrap fetch to detect successful cart adds.
  if (window.fetch) {
    var origFetch = window.fetch;
    window.fetch = function (input, init) {
      var url = typeof input === 'string' ? input : (input && input.url) || '';
      var method = (init && init.method) || (input && input.method) || 'GET';
      var isCartAdd = /\/cart\/add(\.js)?($|\?)/.test(url) && method.toUpperCase() === 'POST';

      var p = origFetch.apply(this, arguments);
      if (isCartAdd) {
        p.then(function (resp) {
          if (resp && resp.ok) {
            // Clone to avoid consuming the original response body.
            try { resp.clone().json().catch(function () {}); } catch (e) {}
            showToast();
            updateBadge();
          }
        }).catch(function () {});
      }
      return p;
    };
  }

  // Also listen for form submissions as a fallback (non-fetch adds).
  document.addEventListener('submit', function (e) {
    var form = e.target;
    if (form && form.getAttribute('data-type') === 'add-to-cart-form') {
      // Let the AJAX handler run; the fetch wrapper above will show the toast.
      // This is a no-op fallback to avoid double-handling.
    }
  });
})();
