/* PO Upload AI second pass — typo-tolerant, alias and fuzzy matching.
 *
 * Pure functions, no DOM, no network. Runs ONLY on PO lines the main
 * pipeline (po-match.js) could not match — exact-match-first ordering
 * is untouched: this module never sees a line that already matched.
 *
 * Second-pass order per line:
 *   1. learned aliases  (this reseller's own corrections, localStorage)
 *   2. curated aliases  (po-aliases.json: OEM / distributor / shorthand codes)
 *   3. OCR confusion variants (OCR-sourced text only: 0<->O, 1<->I, 5<->S, 8<->B, 6<->G)
 *   4. typo-tolerant edit distance (Damerau-Levenshtein, family-restricted)
 *   5. improved fuzzy description matching (EN + FR keywords, accent folding,
 *      IDF-weighted so generic words alone can never qualify)
 *
 * Confidence tiers:
 *   high   — unique alias hit, unique OCR hit, unique distance-1 typo hit
 *            (caller re-runs the main pipeline's match_item with the key)
 *   medium — distance-2 typo, ambiguous alias/typo candidates,
 *            top fuzzy candidate with >= 60% of line words shared
 *            (caller shows these in the "Needs review" UI)
 *   low    — nothing above threshold (stays unmatched)
 *
 * Works in the browser (window.POMatchAI) and in Node (module.exports).
 */
(function (root, factory) {
  "use strict";
  var api = factory();
  if (typeof module !== "undefined" && module.exports) module.exports = api;
  else root.POMatchAI = api;
})(typeof self !== "undefined" ? self : this, function () {
  "use strict";

  var LEARN_KEY = "iq_po_aliases";

  function normalize(code) {
    return String(code == null ? "" : code).toUpperCase().replace(/[\s\-/_.]/g, "");
  }

  function stripPunct(t) {
    return String(t).replace(/^[,\;:()\[\]"']+|[,\;:()\[\]"']+$/g, "");
  }

  // ---------------------------------------------------------- French support

  var ACCENT_MAP = {
    "É": "E", "È": "E", "Ê": "E", "Ë": "E",
    "À": "A", "Â": "A", "Ä": "A", "Ç": "C",
    "Î": "I", "Ï": "I", "Ô": "O", "Ö": "O",
    "Ù": "U", "Û": "U", "Ü": "U", "Ÿ": "Y", "Ñ": "N"
  };

  function accent_fold(s) {
    return String(s == null ? "" : s).toUpperCase().split("").map(function (ch) {
      return ACCENT_MAP[ch] || ch;
    }).join("");
  }

  // French keyword -> canonical English form.
  var FR_COLOR = { "NOIR": "BLACK", "JAUNE": "YELLOW" }; // CYAN / MAGENTA are the same
  var FR_TYPE = {
    "ORIGINAL": "ORIGINAL", "ORIGINAUX": "ORIGINAL",
    "COMPATIBLE": "COMPATIBLE", "COMPATIBLES": "COMPATIBLE",
    "REMANUFACTURE": "REMANUFACTURED", "REMANUFACTUREE": "REMANUFACTURED",
    "REMANUFACTUREES": "REMANUFACTURED", "RECONDITIONNE": "REMANUFACTURED",
    "RECONDITIONNEE": "REMANUFACTURED", "REMISE": "REMANUFACTURED"
  };
  var FR_PRODUCT = {
    "TAMBOUR": "DRUM", "TAMBOURS": "DRUM",
    "CARTOUCHE": "CARTRIDGE", "CARTOUCHES": "CARTRIDGE",
    "IMPRIMANTE": "PRINTER", "IMPRIMANTES": "PRINTER",
    "ENCRE": "INK", "ENCRES": "INK"
  };

  // Glue words only — type / color / brand / product words stay scorable.
  var GLUE = {};
  ["THE", "AND", "FOR", "WITH", "FROM", "OF", "A", "AN", "TO", "IN", "ON",
   "LE", "LA", "LES", "DE", "DES", "DU", "UN", "UNE", "ET", "POUR", "AVEC",
   "DANS", "SUR", "AU", "AUX", "EN", "PAR", "CE", "CET", "CETTE", "CES",
   "QUE", "QUI", "EST", "SONT", "VOTRE", "NOS"
  ].forEach(function (w) { GLUE[w] = 1; });

  function canon_word(tok) {
    var f = accent_fold(tok);
    if (FR_COLOR[f]) return FR_COLOR[f];
    if (FR_TYPE[f]) return FR_TYPE[f];
    if (FR_PRODUCT[f]) return FR_PRODUCT[f];
    return f;
  }

  function looks_codeish(w) {
    return w.length >= 4 && /[A-Z]/.test(w) && /[0-9]/.test(w);
  }

  var COLOR_WORDS = ["BLACK", "CYAN", "MAGENTA", "YELLOW"];

  function color_of_text(text) {
    var f = accent_fold(String(text || ""));
    for (var i = 0; i < COLOR_WORDS.length; i++) {
      var c = COLOR_WORDS[i];
      if (f.indexOf(c) !== -1) return c;
      if (c === "BLACK" && f.indexOf("NOIR") !== -1) return c;
      if (c === "YELLOW" && f.indexOf("JAUNE") !== -1) return c;
    }
    return null;
  }

  // ---------------------------------------------------------- edit distance

  // Damerau-Levenshtein (optimal string alignment): substitution,
  // insertion, deletion + adjacent transposition (TN670 -> TN760).
  function damerau_levenshtein(a, b) {
    var n = a.length, m = b.length, i, j;
    if (!n) return m;
    if (!m) return n;
    var d = [];
    for (i = 0; i <= n; i++) d[i] = [i];
    for (j = 0; j <= m; j++) d[0][j] = j;
    for (i = 1; i <= n; i++) {
      for (j = 1; j <= m; j++) {
        var cost = a.charAt(i - 1) === b.charAt(j - 1) ? 0 : 1;
        d[i][j] = Math.min(d[i - 1][j] + 1, d[i][j - 1] + 1, d[i - 1][j - 1] + cost);
        if (i > 1 && j > 1 && a.charAt(i - 1) === b.charAt(j - 2) && a.charAt(i - 2) === b.charAt(j - 1)) {
          d[i][j] = Math.min(d[i][j], d[i - 2][j - 2] + 1);
        }
      }
    }
    return d[n][m];
  }

  // Code "family": letter/digit shape, e.g. TN670 -> "LLDDD".
  // Restricts typo candidates to plausible shapes (same shape, one
  // insertion/deletion, or one letter<->digit class change).
  function shape_of(code) {
    return String(code).replace(/[A-Z]/g, "L").replace(/[0-9]/g, "D");
  }

  function shape_compatible(qs, ks) {
    if (qs === ks) return true;
    if (Math.abs(qs.length - ks.length) === 1) return true; // indel typo
    if (qs.length === ks.length) {
      var diff = 0;
      for (var i = 0; i < qs.length; i++) {
        if (qs.charAt(i) !== ks.charAt(i) && ++diff > 1) return false;
      }
      return true; // e.g. TN76O (LLDDL) vs TN760 (LLDDD)
    }
    return false;
  }

  var _famCache = null, _famFor = null;

  function family_index(catalog) {
    if (_famFor === catalog && _famCache) return _famCache;
    var idx = {};
    Object.keys(catalog).forEach(function (k) {
      var s = shape_of(k);
      (idx[s] = idx[s] || []).push(k);
    });
    _famFor = catalog;
    _famCache = idx;
    return idx;
  }

  // All catalog keys within edit distance cap of the code, nearest first.
  // cap: <= 2 for codes >= 6 chars, <= 1 for shorter codes.
  function typo_candidates(code, catalog) {
    var nc = normalize(code);
    if (!nc || nc.length < 3) return [];
    var cap = nc.length >= 6 ? 2 : 1;
    var qs = shape_of(nc);
    var fams = family_index(catalog);
    var out = [];
    Object.keys(fams).forEach(function (sh) {
      if (!shape_compatible(qs, sh)) return;
      fams[sh].forEach(function (key) {
        if (key === nc) return;
        if (Math.abs(key.length - nc.length) > cap) return;
        var dd = damerau_levenshtein(nc, key);
        if (dd > 0 && dd <= cap) out.push({ key: key, dist: dd });
      });
    });
    out.sort(function (x, y) {
      return x.dist - y.dist || x.key.length - y.key.length || (x.key < y.key ? -1 : 1);
    });
    return out;
  }

  // ---------------------------------------------------------- OCR confusion

  var OCR_PAIRS = {
    "0": "O", "O": "0",
    "1": "I", "I": "1",
    "5": "S", "S": "5",
    "8": "B", "B": "8",
    "6": "G", "G": "6"
  };

  // Single-swap variants of the code, deterministic order (position order).
  function ocr_variants(code) {
    var nc = normalize(code), out = [], seen = {};
    for (var i = 0; i < nc.length; i++) {
      var alt = OCR_PAIRS[nc.charAt(i)];
      if (!alt) continue;
      var v = nc.slice(0, i) + alt + nc.slice(i + 1);
      if (!seen[v]) { seen[v] = 1; out.push(v); }
    }
    return out;
  }

  function ocr_match(code, catalog) {
    var vs = ocr_variants(code);
    for (var i = 0; i < vs.length; i++) {
      if (catalog[vs[i]]) return vs[i];
    }
    return null;
  }

  // ---------------------------------------------------------- aliases

  function load_aliases(json) {
    var out = {};
    if (!json || typeof json !== "object") return out;
    Object.keys(json).forEach(function (k) {
      var nk = normalize(k);
      var targets = json[k];
      if (!Array.isArray(targets)) targets = [targets];
      out[nk] = targets.map(function (t) { return normalize(t); });
    });
    return out;
  }

  // Scan every token of the line for a known alias (after the code_guess
  // itself is checked by the caller).
  function alias_scan(text, aliases) {
    var hits = [], seen = {};
    String(text || "").split(/[\s,;|/()]+/).forEach(function (tok) {
      var nk = normalize(stripPunct(tok));
      if (nk && aliases[nk] && !seen[nk]) {
        seen[nk] = 1;
        hits.push({ alias: nk, keys: aliases[nk] });
      }
    });
    return hits;
  }

  function filter_keys_by_color(keys, catalog, color) {
    if (!color) return keys;
    var kept = keys.filter(function (k) {
      return (catalog[k] || []).some(function (p) {
        return String(p[1] || "").toUpperCase().indexOf(color) !== -1;
      });
    });
    return kept.length ? kept : keys;
  }

  function keys_to_candidates(keys, catalog, limit) {
    var out = [], seen = {};
    keys.forEach(function (k) {
      ((catalog[k]) || []).forEach(function (p) {
        if (!seen[p[0]]) {
          seen[p[0]] = 1;
          out.push({ handle: p[0], title: p[1], code: k });
        }
      });
    });
    return out.slice(0, limit || 3);
  }

  // ---------------------------------------------------------- fuzzy (EN+FR)

  // IDF weights over catalog titles, cached per catalog object.
  // Generic words (TONER, CARTRIDGE, BLACK) weigh ~0 and can never
  // push a candidate over the threshold on their own.
  var _idfCache = null, _idfFor = null;

  function idf_weights(catalog) {
    if (_idfFor === catalog && _idfCache) return _idfCache;
    var df = {}, n = 0, seenH = {};
    Object.keys(catalog).forEach(function (key) {
      (catalog[key] || []).forEach(function (p) {
        if (seenH[p[0]]) return;
        seenH[p[0]] = 1;
        n++;
        var seenW = {};
        String(p[1] || "").split(/[^A-Za-z0-9]+/).forEach(function (tok) {
          if (!tok) return;
          var c = canon_word(tok);
          if (GLUE[c] || /^\d+$/.test(c) || seenW[c]) return;
          seenW[c] = 1;
          df[c] = (df[c] || 0) + 1;
        });
      });
    });
    var w = {};
    Object.keys(df).forEach(function (term) { w[term] = Math.log(n / df[term]); });
    _idfFor = catalog;
    _idfCache = w;
    return w;
  }

  function word_weight(w, idf) {
    var base = idf[w] || 4; // unseen words are distinctive
    return looks_codeish(w) ? 4 + base : base;
  }

  // Weighted fuzzy: shared code-like token = 4 + idf, shared word = idf.
  // Requires >= 2 shared words, >= 60% of line words shared, and a
  // minimum weighted score so generic words (black + toner = ~1.5)
  // can never qualify on their own.
  var FUZZY_MIN_SCORE = 3.0;

  function fuzzy_candidates(desc, catalog, limit) {
    var idf = idf_weights(catalog);
    var lineWords = {}, words = [];
    String(desc || "").split(/[^A-Za-z0-9\u00C0-\u00FF]+/).forEach(function (tok) {
      if (!tok) return;
      var c = canon_word(tok);
      if (GLUE[c] || /^\d+$/.test(c)) return;
      if (!lineWords[c]) { lineWords[c] = 1; words.push(c); }
    });
    var n = words.length;
    if (!n) return [];
    var scored = [];
    Object.keys(catalog).forEach(function (key) {
      (catalog[key] || []).forEach(function (p) {
        var tw = {};
        String(p[1] || "").split(/[^A-Za-z0-9]+/).forEach(function (tok) {
          if (!tok) return;
          var c = canon_word(tok);
          if (GLUE[c] || /^\d+$/.test(c)) return;
          tw[c] = 1;
        });
        var score = 0, shared = 0;
        words.forEach(function (w) {
          if (tw[w]) { shared++; score += word_weight(w, idf); }
        });
        var ratio = shared / n;
        if (shared >= 2 && ratio >= 0.6 && score >= FUZZY_MIN_SCORE) {
          scored.push({ score: score, ratio: ratio, handle: p[0], title: p[1], code: key });
        }
      });
    });
    scored.sort(function (a, b) { return b.score - a.score || b.ratio - a.ratio; });
    var seen = {}, out = [];
    scored.forEach(function (s) {
      if (!seen[s.handle]) { seen[s.handle] = 1; out.push(s); }
    });
    return out.slice(0, limit || 3);
  }

  // ---------------------------------------------------------- learning loop

  // Signature: the normalized code if the line had one, else the
  // distinctive words (sorted, capped) — stable across POs.
  function line_signature(text, code_guess) {
    if (code_guess) return "CODE:" + normalize(code_guess);
    var seen = {}, words = [];
    String(text || "").split(/[^A-Za-z0-9\u00C0-\u00FF]+/).forEach(function (tok) {
      if (!tok) return;
      var c = canon_word(tok);
      if (GLUE[c] || /^\d+$/.test(c)) return;
      if (!seen[c]) { seen[c] = 1; words.push(c); }
    });
    words.sort();
    return "DESC:" + words.slice(0, 6).join("+");
  }

  function learned_lookup(learned, sig) {
    if (!learned || !sig) return null;
    return learned[sig] || null; // -> { handle, code }
  }

  function learned_record(learned, sig, handle, code) {
    var next = {};
    Object.keys(learned || {}).forEach(function (k) { next[k] = learned[k]; });
    next[sig] = { handle: handle, code: code };
    return next;
  }

  // ---------------------------------------------------------- second pass

  // Code-like tokens on the line (letters + digits, >= 4 chars).
  // Used when the main pipeline extracted no code_guess — e.g. OCR
  // misreads like TN76O break the manufacturer code patterns, so no
  // code is ever extracted, but the token is still matchable.
  function codeish_tokens(text, exclude) {
    var out = [], seen = {};
    if (exclude) seen[normalize(exclude)] = 1;
    String(text || "").split(/[\s,;|/()]+/).forEach(function (tok) {
      var nc = normalize(stripPunct(tok));
      if (nc.length >= 4 && /[A-Z]/.test(nc) && /[0-9]/.test(nc) && !seen[nc]) {
        seen[nc] = 1;
        out.push(nc);
      }
    });
    return out;
  }

  // entry: { text, code_guess, qty, qty_assumed, source_ocr }
  // opts:  { aliases, learned }
  // -> { tier: "high", key, via, signature }
  //    { tier: "medium", candidates: [{handle,title,code}], via, signature }
  //    { tier: "low", signature }
  function second_pass(entry, catalog, all_products, opts) {
    opts = opts || {};
    var text = entry.text || "";
    var codeGuess = entry.code_guess || null;
    var aliases = opts.aliases || {};
    var learned = opts.learned || null;
    var sig = line_signature(text, codeGuess);

    function valid_key(k) { return !!(k && catalog[k]); }

    // Candidate tokens: the extracted code first, then any other
    // code-like tokens on the line (covers OCR-broken codes).
    var tokens = [];
    if (codeGuess) tokens.push(normalize(codeGuess));
    codeish_tokens(text, codeGuess).forEach(function (t) { tokens.push(t); });

    // 1) this reseller's own corrections first (deliberate, outrank guesses)
    var lh = learned_lookup(learned, sig);
    if (lh && valid_key(lh.code)) {
      return { tier: "high", key: lh.code, via: "learned", signature: sig };
    }

    // 2) curated aliases, across all candidate tokens
    var aliasKeys = [];
    for (var ai = 0; ai < tokens.length && !aliasKeys.length; ai++) {
      if (aliases[tokens[ai]]) aliasKeys = aliases[tokens[ai]];
    }
    if (!aliasKeys.length) {
      var hits = alias_scan(text, aliases);
      if (hits.length) aliasKeys = hits[0].keys;
    }
    aliasKeys = aliasKeys.filter(valid_key);
    if (aliasKeys.length) {
      var akeys = filter_keys_by_color(aliasKeys, catalog, color_of_text(text));
      if (akeys.length === 1) {
        return { tier: "high", key: akeys[0], via: "alias", signature: sig };
      }
      return { tier: "medium", via: "alias", signature: sig, candidates: keys_to_candidates(akeys, catalog, 3) };
    }

    // 3) OCR confusion variants — OCR-sourced text only
    if (entry.source_ocr) {
      for (var oi = 0; oi < tokens.length; oi++) {
        var ok = ocr_match(tokens[oi], catalog);
        if (ok) return { tier: "high", key: ok, via: "ocr", signature: sig };
      }
    }

    // 4) typo-tolerant edit distance, best token wins
    var bestTypo = null; // { dist, keys }
    tokens.forEach(function (tok) {
      var typos = typo_candidates(tok, catalog);
      if (typos.length && (!bestTypo || typos[0].dist < bestTypo.dist)) {
        bestTypo = {
          dist: typos[0].dist,
          keys: typos.filter(function (t) { return t.dist === typos[0].dist; })
                      .map(function (t) { return t.key; })
        };
      }
    });
    if (bestTypo) {
      var tkeys = filter_keys_by_color(bestTypo.keys, catalog, color_of_text(text));
      if (bestTypo.dist === 1 && tkeys.length === 1) {
        return { tier: "high", key: tkeys[0], via: "typo", signature: sig };
      }
      return { tier: "medium", via: "typo", signature: sig, candidates: keys_to_candidates(tkeys, catalog, 3) };
    }

    // 5) improved fuzzy description matching
    var fz = fuzzy_candidates(text, catalog, 3);
    if (fz.length && fz[0].ratio >= 0.6) {
      return {
        tier: "medium", via: "fuzzy", signature: sig,
        candidates: fz.map(function (f) { return { handle: f.handle, title: f.title, code: f.code }; })
      };
    }

    return { tier: "low", signature: sig };
  }

  return {
    LEARN_KEY: LEARN_KEY,
    normalize: normalize,
    accent_fold: accent_fold,
    canon_word: canon_word,
    color_of_text: color_of_text,
    damerau_levenshtein: damerau_levenshtein,
    shape_of: shape_of,
    family_index: family_index,
    typo_candidates: typo_candidates,
    ocr_variants: ocr_variants,
    ocr_match: ocr_match,
    load_aliases: load_aliases,
    alias_scan: alias_scan,
    codeish_tokens: codeish_tokens,
    idf_weights: idf_weights,
    fuzzy_candidates: fuzzy_candidates,
    line_signature: line_signature,
    learned_lookup: learned_lookup,
    learned_record: learned_record,
    keys_to_candidates: keys_to_candidates,
    second_pass: second_pass
  };
});
