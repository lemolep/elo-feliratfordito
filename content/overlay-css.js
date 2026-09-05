/* A lebegő ablak stílusa. Azért JS-fájlban van és nem .css-ben, mert így
   közvetlenül a Shadow DOM-ba tudjuk tenni: nem kell se fetch, se
   web_accessible_resources, és a megnyitott oldal CSP-je sem akadályozhatja meg. */
globalThis.LFT = globalThis.LFT || {};

LFT.overlayCSS = `
:host {
  all: initial;
  position: fixed;
  z-index: 2147483646;
  contain: layout style;
}
* { box-sizing: border-box; margin: 0; padding: 0; }

.panel {
  --fs: 20px;
  --bgA: 0.85;
  position: relative;
  display: flex;
  flex-direction: column;
  width: 100%;
  height: 100%;
  min-width: 220px;
  min-height: 120px;
  background: rgba(15, 17, 21, var(--bgA));
  color: #f1f3f6;
  border: 1px solid rgba(255,255,255,.14);
  border-radius: 12px;
  box-shadow: 0 10px 40px rgba(0,0,0,.5);
  font-family: system-ui, "Segoe UI", Roboto, Arial, sans-serif;
  overflow: hidden;
  backdrop-filter: blur(2px);
}
.panel.picking { opacity: .25; }

/* A bővítmény újratöltése után az ablak árván marad — a gombjai már nem élnek. */
.panel.stale .hdr button:not([data-a="close"]),
.panel.stale .hdr input { opacity: .35; pointer-events: none; }
.panel.stale .body { opacity: .5; }

/* ---------- fejléc ---------- */
.hdr {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 3px;
  padding: 6px 7px;
  background: rgba(255,255,255,.05);
  border-bottom: 1px solid rgba(255,255,255,.1);
  cursor: move;
  user-select: none;
  flex: 0 0 auto;
}
.dot {
  width: 9px; height: 9px; border-radius: 50%;
  background: #e05252; flex: 0 0 auto;
}
.dot.rec { background: #3ddc97; box-shadow: 0 0 6px #3ddc97; }
.dot.busy { background: #e8b33b; }
.ttl { flex: 0 1 auto; min-width: 0; font-size: 11px; font-weight: 600; letter-spacing: .02em;
  opacity: .8; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.spacer { flex: 1 1 auto; min-width: 4px; }

button {
  font: 600 11px/1 system-ui, sans-serif;
  color: #e8ecf1;
  background: rgba(255,255,255,.08);
  border: 1px solid rgba(255,255,255,.14);
  border-radius: 6px;
  padding: 5px 7px;
  cursor: pointer;
  white-space: nowrap;
}
button:hover { background: rgba(255,255,255,.16); }
button:active { transform: translateY(1px); }
button.primary { background: #2f6feb; border-color: #4b84f0; }
button.primary:hover { background: #3b7bf5; }
button.danger { background: #b3382f; border-color: #d1493f; }
button.danger:hover { background: #c74338; }
button.icon { padding: 5px 6px; font-size: 12px; }

input[type=range] {
  width: 46px; height: 14px; cursor: pointer; accent-color: #6ea8ff;
}

/* ---------- átirat ---------- */
.body {
  flex: 1 1 auto;
  overflow-y: auto;
  overflow-x: hidden;
  padding: 8px 12px 12px;
  scrollbar-width: thin;
  scrollbar-color: rgba(255,255,255,.25) transparent;
}
.body::-webkit-scrollbar { width: 9px; }
.body::-webkit-scrollbar-thumb { background: rgba(255,255,255,.22); border-radius: 5px; }

.ln { padding: 5px 0; border-bottom: 1px solid rgba(255,255,255,.06); }
.ln:last-child { border-bottom: 0; }
.src {
  font-size: calc(var(--fs) * .72);
  line-height: 1.35;
  color: #93a1b3;
  margin-bottom: 2px;
  word-wrap: break-word;
}
.hu {
  font-size: var(--fs);
  line-height: 1.35;
  color: #ffffff;
  word-wrap: break-word;
}
.hu.waiting { color: #7d8794; font-style: italic; }
.hu.failed { color: #ef8b80; }
.panel.huonly .src { display: none; }

.empty {
  color: #8b95a3;
  font-size: 13px;
  line-height: 1.5;
  padding: 6px 0;
}

/* ---------- alsó sáv ---------- */
.jump {
  position: absolute;
  left: 50%; bottom: 38px;
  transform: translateX(-50%);
  background: #2f6feb;
  border-color: #4b84f0;
  display: none;
}
.panel.unstuck .jump { display: block; }

.bar {
  display: flex;
  align-items: center;
  gap: 8px;
  flex: 0 0 auto;
  padding: 5px 10px;
  font-size: 11px;
  line-height: 1.35;
  background: rgba(0,0,0,.35);
  border-top: 1px solid rgba(255,255,255,.08);
  min-height: 24px;
}
.msg { flex: 1 1 auto; color: #9aa4b2; overflow: hidden; text-overflow: ellipsis; }
.msg.warn { color: #f0c05a; }
.msg.err  { color: #ef8b80; }
.msg.ok   { color: #6fd8a8; }
.cnt { flex: 0 0 auto; color: #7d8794; font-variant-numeric: tabular-nums; }

.grip {
  position: absolute;
  right: 0; bottom: 0;
  width: 18px; height: 18px;
  cursor: nwse-resize;
  background: linear-gradient(135deg, transparent 50%, rgba(255,255,255,.35) 50%, rgba(255,255,255,.35) 60%, transparent 60%, transparent 72%, rgba(255,255,255,.35) 72%, rgba(255,255,255,.35) 82%, transparent 82%);
}

/* ---------- mentés párbeszéd ---------- */
.dlg {
  position: absolute;
  inset: 0;
  background: rgba(8,10,13,.94);
  display: flex;
  flex-direction: column;
  justify-content: center;
  gap: 10px;
  padding: 18px;
}
.dlg[hidden] { display: none; }
.dlg h3 { font-size: 13px; font-weight: 600; }
.dlg p { font-size: 11px; color: #9aa4b2; line-height: 1.45; }
.dlg input[type=text] {
  font: 13px system-ui, sans-serif;
  color: #fff;
  background: rgba(255,255,255,.08);
  border: 1px solid rgba(255,255,255,.2);
  border-radius: 7px;
  padding: 9px 11px;
  width: 100%;
}
.dlg input[type=text]:focus { outline: 2px solid #4b84f0; outline-offset: 1px; }
.dlg .row { display: flex; gap: 8px; justify-content: flex-end; }
.dlg button { padding: 8px 14px; font-size: 12px; }
`;
