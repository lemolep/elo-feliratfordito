/* Stabil CSS-szelektor építése egy kiválasztott elemhez, hogy az oldal
   újratöltése vagy a lejátszó újrarajzolása után is vissza lehessen találni rá. */
globalThis.LFT = globalThis.LFT || {};

(() => {
  'use strict';

  const MAX_DEPTH = 6;

  /* Kihagyjuk a generált, hash-szerű osztályneveket (css-modules, styled-components),
     mert ezek build-enként változnak. */
  function isStableClass(c) {
    if (!c || c.length > 40) return false;
    if (/^\d/.test(c)) return false;
    if (/[a-f0-9]{6,}/i.test(c) && /\d/.test(c)) return false;
    if (/^(css|sc|jsx|emotion)-/i.test(c)) return false;
    return /^[A-Za-z][\w-]*$/.test(c);
  }

  function isStableId(id) {
    if (!id || id.length > 40) return false;
    if (/[a-f0-9]{8,}/i.test(id)) return false;
    return /^[A-Za-z][\w:-]*$/.test(id);
  }

  function part(el) {
    let s = el.tagName.toLowerCase();
    const classes = Array.from(el.classList).filter(isStableClass).slice(0, 2);
    for (const c of classes) s += '.' + CSS.escape(c);
    const parent = el.parentElement;
    if (parent) {
      const sameTag = Array.from(parent.children).filter(x => x.tagName === el.tagName);
      if (sameTag.length > 1) s += ':nth-of-type(' + (sameTag.indexOf(el) + 1) + ')';
    }
    return s;
  }

  function isUnique(sel, root) {
    try { return (root || document).querySelectorAll(sel).length === 1; }
    catch { return false; }
  }

  function build(el) {
    if (!el || el.nodeType !== 1) return null;

    if (isStableId(el.id) && isUnique('#' + CSS.escape(el.id))) {
      return '#' + CSS.escape(el.id);
    }

    const chain = [];
    let node = el;
    for (let i = 0; i < MAX_DEPTH && node && node.nodeType === 1; i++) {
      if (isStableId(node.id) && isUnique('#' + CSS.escape(node.id))) {
        chain.unshift('#' + CSS.escape(node.id));
        break;
      }
      chain.unshift(part(node));
      const candidate = chain.join(' > ');
      if (isUnique(candidate)) return candidate;
      node = node.parentElement;
      if (node === document.documentElement) break;
    }
    const sel = chain.join(' > ');
    return sel || null;
  }

  function normText(s) {
    return String(s == null ? '' : s).replace(/\s+/g, ' ').trim();
  }

  /* A célzóval szinte mindig a legbelső szövegdarabkára kattint az ember
     (pl. YouTube-on egy .ytp-caption-segment spanre), amit a lejátszó
     mondatonként eldob és újragyárt. Feljebb lépünk addig, amíg a szülő
     lényegében ugyanazt a szöveget tartalmazza — így a stabil feliratdobozt
     kapjuk meg, nem az eldobható darabkát. */
  function pickTarget(el) {
    if (!el || el.nodeType !== 1) return el;
    const base = normText(el.innerText || el.textContent);
    if (!base) return el;

    const chain = [el];
    let node = el;
    for (let i = 0; i < 5; i++) {
      const p = node.parentElement;
      if (!p || p === document.body || p === document.documentElement) break;
      const pt = normText(p.innerText || p.textContent);
      if (pt.length > base.length * 1.4 + 20) break;   // a szülő már jóval többet tartalmaz
      chain.push(p);
      node = p;
    }

    // a legfelső jelölt, amire stabil (pozíciófüggetlen) szelektort tudunk adni
    for (let i = chain.length - 1; i >= 0; i--) {
      const sel = build(chain[i]);
      if (sel && sel.indexOf(':nth-of-type') === -1 && isUnique(sel)) return chain[i];
    }
    return chain[chain.length - 1];
  }

  function find(sel) {
    if (!sel) return null;
    try { return document.querySelector(sel); }
    catch { return null; }
  }

  /* Rövid, olvasható leírás az elemről a beállítások oldalra. */
  function describe(el) {
    if (!el) return '';
    const txt = (el.innerText || '').replace(/\s+/g, ' ').trim().slice(0, 40);
    return el.tagName.toLowerCase() + (txt ? ' — "' + txt + '"' : '');
  }

  LFT.selector = { build, find, describe, pickTarget };
})();
