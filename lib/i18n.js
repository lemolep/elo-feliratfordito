/* Nyelvi réteg. A szövegek a _locales/<nyelv>/messages.json fájlokban vannak;
   a Chrome a böngésző nyelve alapján választ, és a default_locale-re esik vissza. */
globalThis.LFT = globalThis.LFT || {};

(() => {
  'use strict';

  /* A chrome.i18n a bővítmény újratöltése után dob, ezért itt is őrzünk.
     Ha nincs fordítás, a kulcsot adjuk vissza — így a hiány látszik, de semmi nem törik el. */
  function t(key, subs) {
    try {
      const s = chrome.i18n.getMessage(key, subs);
      if (s) return s;
    } catch (e) { /* érvénytelen kontextus */ }
    return key;
  }

  function uiLang() {
    try { return chrome.i18n.getUILanguage() || 'en'; }
    catch (e) { return 'en'; }
  }

  function isHungarian() {
    return uiLang().toLowerCase().indexOf('hu') === 0;
  }

  /* HTML oldalak feliratozása. A jelölők:
       data-i18n       -> textContent
       data-i18n-html  -> innerHTML (csak saját, beépített szövegekhez, ahol <code> kell)
       data-i18n-title -> title attribútum
       data-i18n-ph    -> placeholder attribútum   */
  function applyDom(root) {
    const r = root || document;
    r.querySelectorAll('[data-i18n]').forEach(el => {
      el.textContent = t(el.getAttribute('data-i18n'));
    });
    r.querySelectorAll('[data-i18n-html]').forEach(el => {
      el.innerHTML = t(el.getAttribute('data-i18n-html'));
    });
    r.querySelectorAll('[data-i18n-title]').forEach(el => {
      el.title = t(el.getAttribute('data-i18n-title'));
    });
    r.querySelectorAll('[data-i18n-ph]').forEach(el => {
      el.placeholder = t(el.getAttribute('data-i18n-ph'));
    });
    const title = r.querySelector('title[data-i18n-doc]');
    if (title) document.title = t(title.getAttribute('data-i18n-doc'));
  }

  /* Számot tartalmazó üzenet: 1-nél a "<kulcs>_one" változatot keressük.
     A Chrome i18n nem ismer többes számot, ezért kell ez a réteg. */
  function tn(key, n, subs) {
    if (n === 1) {
      const one = t(key + '_one', subs);
      if (one !== key + '_one') return one;
    }
    return t(key, subs);
  }

  LFT.t = t;
  LFT.tn = tn;
  LFT.i18n = { t, tn, applyDom, uiLang, isHungarian };
})();
