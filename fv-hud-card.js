/* FV HUD Card — Fotovoltaico a tutta pagina: flusso di energia con 8 utenze, indicatori con soglie e storico,
 * impostazioni inverter protette da password, storico a più serie.
 * Modalità singolo inverter (1-4 MPPT, 1-2 batterie) o multi inverter (fino a 3, una fase ciascuno, 1-4 MPPT ciascuno);
 * ogni cerchio / utenza apre un popup con il grafico (potenza, tensione, corrente, SOC).
 * Installazione: HACS / Marketplace (consigliata) oppure risorsa JavaScript module /local/fv-hud-card.js
 * Uso:  type: custom:fv-hud-card  (si configura dall'editor visuale)
 */
const FV_VERSION = '1.24.0';

const FV_P = {
  sol: 'M12 3v2M12 19v2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M3 12h2M19 12h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4M8 12a4 4 0 1 0 8 0a4 4 0 1 0-8 0',
  rete: 'M8 21l4-18 4 18M6 8h12M5 13h14M9.3 13l5.4 8M14.7 13l-5.4 8',
  bat: 'M7 6h10v15H7zM10 3h4v3h-4zM9.5 11h5M9.5 15h5',
  casa: 'M3 11l9-8 9 8M5 9.5V21h14V9.5',
  inv: 'M5 4h14v16H5zM8 9h8M8 15c1.3-2 2.7-2 4 0s2.7 2 4 0',
  fan: 'M10 12a2 2 0 1 0 4 0a2 2 0 1 0-4 0M12 10c0-4 1-6 3-6s2 3-1 5M14 12c4 0 6 1 6 3s-3 2-5-1M12 14c0 4-1 6-3 6s-2-3 1-5M10 12c-4 0-6-1-6-3s3-2 5 1',
  wash: 'M5 3h14v18H5zM5 7h14M8 14a4 4 0 1 0 8 0a4 4 0 1 0-8 0M8 5h1',
  kitchen: 'M4 11h16M5 11v7a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2v-7M9 8V5M15 8V5M12 8V4',
  pc: 'M4 5h16v11H4zM2 19h20M10 16v3M14 16v3',
  plug: 'M9 2v5M15 2v5M7 7h10v4a5 5 0 0 1-10 0zM12 16v6',
  tv: 'M3 6h18v12H3zM8 21h8M12 18v3',
  car: 'M5 13l2-5h10l2 5M4 13h16v5H4zM7 18v2M17 18v2',
  bolt: 'M13 2L4 14h7l-1 8 9-12h-7z',
  bulb: 'M9 18h6M10 21h4M12 3a6 6 0 0 0-4 10.5c.7.7 1 1.5 1 2.5h6c0-1 .3-1.8 1-2.5A6 6 0 0 0 12 3z',
  flame: 'M12 3c1 3 5 5 5 10a5 5 0 0 1-10 0c0-2 1-3 2-4 0 2 1 3 2 3 0-3-1-6 1-9z',
  snow: 'M12 3v18M4.5 7.5l15 9M19.5 7.5l-15 9',
  drop: 'M12 3s6 6.5 6 11a6 6 0 0 1-12 0c0-4.5 6-11 6-11z',
  pump: 'M4 12h10M14 8l4 4-4 4M4 7v10',
  heater: 'M5 5h14v14H5zM9 8v8M12 8v8M15 8v8',
  gauge: 'M4 18a8 8 0 1 1 16 0M12 18l4-6',
  lock: 'M5 11h14v9H5zM8 11V8a4 4 0 0 1 8 0v3',
  chev: 'M6 9l6 6 6-6',
  x: 'M6 6l12 12M18 6L6 18',
  warn: 'M12 3l10 18H2zM12 10v5M12 18h.01',
};
const FV_ICONS = [['bolt', 'Fulmine'], ['fan', 'Ventola'], ['wash', 'Lavatrice'], ['kitchen', 'Cucina'], ['pc', 'Computer'], ['plug', 'Presa'], ['tv', 'Televisore'], ['car', 'Auto'], ['bulb', 'Luce'], ['flame', 'Caldaia'], ['snow', 'Clima'], ['drop', 'Acqua'], ['pump', 'Pompa'], ['heater', 'Stufa'], ['inv', 'Inverter'], ['casa', 'Casa'], ['gauge', 'Contatore']];
const FV_COL = { sol: '#ffb43a', rete: '#6f9bff', bat: '#2ee87a', casa: '#5fd0ff', ind: '#b28cff', axp: '#ff8a5c', red: '#ff5a5a' };
const FV_RANGES = { '24h': { label: '24 H', ms: 864e5, stats: false }, '7g': { label: '7 G', ms: 7 * 864e5, stats: true }, '30g': { label: '30 G', ms: 30 * 864e5, stats: true } };
const FV_MAX_LOADS = 10;
const FV_MAX_IND = 18;
const FV_MAX_SERIES = 6;
const FV_MAX_INV = 3;
const FV_MAX_LOADS_INV = 12;
const FV_MAX_SUB = 6;

const fvEsc = (s) => String(s == null ? '' : s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const fvClamp = (v, a, b) => Math.min(b, Math.max(a, v));
const fvDomain = (id) => String(id || '').split('.')[0];
const fvIcon = (name, color, size, sw) => `<svg width="${size || 20}" height="${size || 20}" viewBox="0 0 24 24" fill="none" stroke="${color || 'currentColor'}" stroke-width="${sw || 1.7}" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="${FV_P[name] || FV_P.bolt}"/></svg>`;
const fvHex = (c, d) => (/^#[0-9a-fA-F]{6}$/.test(c || '') ? c : d);

/* colore di un valore secondo le soglie: base + righe «da X in su» */
function fvBands(ind, dflt) {
  const base = fvHex(ind && ind.color, dflt);
  const rows = ((ind && ind.thresholds) || []).map((r) => ({ f: parseFloat(String(r.value).replace(',', '.')), c: fvHex(r.color, base) })).filter((r) => isFinite(r.f)).sort((a, b) => a.f - b.f);
  return { base, rows, on: !(ind && ind.thresholds_off) && rows.length > 0 };
}
function fvColorOf(ind, x, dflt) {
  const b = fvBands(ind, dflt); if (!b.on || x == null || isNaN(x)) return b.base;
  let c = b.base; b.rows.forEach((r) => { if (x >= r.f) c = r.c; }); return c;
}

const FV_CSS = `
:host { display: block; }
* { box-sizing: border-box; }
.root { position: relative; min-height: 600px; padding: 26px 24px 36px; border-radius: 22px; overflow: hidden; color: #fff;
  font-family: 'IBM Plex Sans', system-ui, -apple-system, 'Segoe UI', sans-serif;
  background: repeating-linear-gradient(0deg, rgba(255,255,255,.025) 0, rgba(255,255,255,.025) 1px, transparent 1px, transparent 4px),
    radial-gradient(800px 500px at 25% 40%, rgba(255,138,92,.09), transparent 60%), radial-gradient(900px 520px at 100% 0%, rgba(80,120,255,.14), transparent 60%), radial-gradient(700px 460px at 0% 100%, rgba(95,208,255,.08), transparent 60%), #06090f; }
.mono { font-family: 'IBM Plex Mono', ui-monospace, 'SFMono-Regular', Menlo, monospace; }
button { font: inherit; color: inherit; cursor: pointer; }
button:focus-visible, select:focus-visible, input:focus-visible { outline: 2px solid #5fd0ff; outline-offset: 2px; }
.in { max-width: 1560px; margin: 0 auto; display: flex; flex-direction: column; gap: 18px; }
.head { display: flex; flex-wrap: wrap; align-items: flex-end; justify-content: space-between; gap: 16px; }
.kick { font-family: 'IBM Plex Mono', ui-monospace, monospace; font-size: 11px; letter-spacing: .2em; color: #5fd0ff; }
.h1 { font-size: 30px; font-weight: 700; margin-top: 2px; }
.chips { display: flex; flex-wrap: wrap; gap: 8px; }
.chip { padding: 10px 14px; border-radius: 999px; border: 1px solid; font-family: 'IBM Plex Mono', ui-monospace, monospace; font-size: 11px; letter-spacing: .08em; }
.box { padding: 18px 20px; border-radius: 22px; border: 1px solid rgba(255,255,255,.1); background: linear-gradient(180deg, rgba(255,255,255,.05), rgba(255,255,255,.015)); }
.cols { display: flex; flex-wrap: wrap; justify-content: space-between; gap: 8px; font-family: 'IBM Plex Mono', ui-monospace, monospace; font-size: 11px; letter-spacing: .2em; color: #ff8a5c; margin-bottom: 10px; }
.cols .lc { color: rgba(255,255,255,.6); letter-spacing: .08em; }
.fw { position: relative; width: 100%; }
.fw svg.flow { position: absolute; inset: 0; width: 100%; height: 100%; }
.fl { stroke-dasharray: 0 13; stroke-linecap: round; animation: fl 1s linear infinite; }
.nr .fl { stroke-dasharray: 0 10; }
@keyframes fl { to { stroke-dashoffset: -13; } }
.nr .fl { animation-name: fl2; }
@keyframes fl2 { to { stroke-dashoffset: -10; } }
@media (prefers-reduced-motion: reduce) { .fl { animation: none; stroke-dasharray: none; } .pop, .pop .sheet { transition: none !important; } }
.nd { position: absolute; transform: translate(-50%, -50%); }
.nd .c { width: 100%; height: 100%; border-radius: 50%; border: 1.5px solid; background: radial-gradient(circle at 50% 30%, rgba(255,255,255,.09), rgba(8,12,20,.97) 70%); display: flex; flex-direction: column; align-items: center; justify-content: center; gap: 2px; }
.nd .v { font-size: 16px; font-weight: 600; white-space: nowrap; }
.nd .s { font-family: 'IBM Plex Mono', ui-monospace, monospace; font-size: 9.5px; letter-spacing: .04em; white-space: nowrap; }
.nd .c:has(.zn) { overflow: hidden; }
.nd .c:has(.zn) { gap: 0; }
.nd .zn { position: relative; display: flex; flex-direction: column; align-items: center; width: 100%; flex: 1 1 0; min-height: 0; cursor: pointer; transition: background .15s; }
.nd .zt { justify-content: flex-end; gap: 1px; padding-bottom: 0; border-bottom: 1px solid rgba(255,255,255,.1); }
.nd .zb { justify-content: center; padding-bottom: 6%; }
.nd .zb .s { font-size: 13.5px; font-weight: 500; } .nr .nd .zb .s { font-size: 9.5px; letter-spacing: 0; }
.nd .zn:hover, .nd .zn.on { background: color-mix(in srgb, var(--zc) 16%, transparent); }
.nd .l { position: absolute; left: 50%; top: 100%; transform: translateX(-50%); margin-top: 7px; white-space: nowrap; font-size: 12.5px; color: rgba(255,255,255,.78); }
.nr .nd .v { font-size: 11.5px; } .nr .nd .s { font-size: 7px; letter-spacing: 0; } .nr .nd .l { font-size: 11px; margin-top: 4px; }
.ld { position: absolute; transform: translate(-50%, -50%); width: 24.167%; aspect-ratio: 290 / 64; border-radius: 16px; border: 1.5px solid; background: linear-gradient(90deg, rgba(178,140,255,.12), rgba(8,12,20,.97) 55%); display: flex; align-items: center; gap: 12px; padding: 0 16px; overflow: hidden; text-align: left; }
.ld .ic { width: 38px; height: 38px; flex: none; border-radius: 11px; border: 1px solid; display: flex; align-items: center; justify-content: center; }
.ld .tx { flex: 1; min-width: 0; display: flex; flex-direction: column; gap: 2px; }
.ld .tx b { font-size: 14px; font-weight: 600; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.ld .tx i { font-style: normal; font-family: 'IBM Plex Mono', ui-monospace, monospace; font-size: 9.5px; letter-spacing: .08em; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.ld .vv { font-size: 17px; font-weight: 600; white-space: nowrap; }
.ld .bar { position: absolute; left: 0; bottom: 0; height: 3px; background: #b28cff; box-shadow: 0 0 10px #b28cff; }
.ldc { position: absolute; transform: translate(-50%, -50%); border: 0; background: none; padding: 0; margin: 0; cursor: pointer; color: #fff; font: inherit; }
.ldc .c { width: 100%; height: 100%; box-sizing: border-box; border-radius: 50%; border: 1.5px solid; background: radial-gradient(circle at 50% 30%, rgba(255,255,255,.09), rgba(8,12,20,.97) 70%); display: flex; flex-direction: column; align-items: center; justify-content: center; gap: 1px; }
.ldc .v { font-size: 10.5px; font-weight: 600; white-space: nowrap; }
.ldc .l { position: absolute; left: 50%; top: 100%; transform: translateX(-50%); margin-top: 2px; line-height: 1.1; width: 84px; text-align: center; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; font-size: 9.5px; color: rgba(255,255,255,.72); }
.llist { display: grid; grid-template-columns: repeat(auto-fit, minmax(240px, 1fr)); gap: 8px; margin-top: 14px; }
.llist .ld { position: relative; transform: none; width: auto; aspect-ratio: auto; min-height: 60px; padding: 8px 14px; }
.tiles { display: grid; grid-template-columns: repeat(auto-fit, minmax(max(140px, calc((100% - 50px) / 6)), 1fr)); gap: 10px; }
.tiles.rings { grid-template-columns: repeat(auto-fit, minmax(max(130px, calc((100% - 50px) / 6)), 1fr)); }
.rt { position: relative; padding: 12px; border-radius: 16px; border: 1px solid; display: flex; flex-direction: column; align-items: center; gap: 4px; min-width: 0; }
.rw { position: relative; display: block; width: 100%; max-width: 132px; }
.rv { position: absolute; left: 0; right: 0; top: 53.57%; transform: translateY(-50%); text-align: center; font-size: 19px; font-weight: 600; white-space: nowrap; }
.rl { margin-top: -8px; font-family: 'IBM Plex Mono', ui-monospace, monospace; font-size: 10px; letter-spacing: .08em; color: rgba(255,255,255,.7); text-align: center; overflow-wrap: anywhere; }
.tile { padding: 14px 14px 12px; border-radius: 16px; border: 1px solid; display: flex; flex-direction: column; gap: 8px; text-align: left; min-width: 0; }
.tile .tl { font-family: 'IBM Plex Mono', ui-monospace, monospace; font-size: 10px; letter-spacing: .12em; color: rgba(255,255,255,.72); overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.tile .tv { font-size: 26px; font-weight: 600; white-space: nowrap; }
.tile .tb { position: relative; width: 100%; height: 4px; border-radius: 2px; background: rgba(255,255,255,.08); overflow: hidden; display: block; }
.tile .tb i { display: block; height: 100%; }
.tip0 { font-family: 'IBM Plex Mono', ui-monospace, monospace; font-size: 10px; letter-spacing: .08em; color: rgba(255,255,255,.5); }
.ph { display: flex; flex-wrap: wrap; align-items: center; justify-content: space-between; gap: 10px; }
.ph .pl { font-family: 'IBM Plex Mono', ui-monospace, monospace; font-size: 10.5px; letter-spacing: .14em; color: rgba(255,255,255,.75); }
.ph .pv { font-size: 26px; font-weight: 600; }
.pills { display: flex; gap: 4px; padding: 4px; border-radius: 999px; background: rgba(255,255,255,.06); }
.pill { min-height: 40px; padding: 0 14px; border-radius: 999px; border: 1px solid transparent; background: transparent; font-family: 'IBM Plex Mono', ui-monospace, monospace; font-size: 11px; letter-spacing: .1em; }
.pill.on { border-color: rgba(95,208,255,.6); background: rgba(95,208,255,.16); }
.xb { width: 44px; height: 44px; border-radius: 50%; border: 1px solid rgba(255,255,255,.2); background: rgba(6,9,15,.6); display: flex; align-items: center; justify-content: center; }
.plotw { display: flex; gap: 8px; }
.yax { position: relative; width: 58px; flex: none; font-family: 'IBM Plex Mono', ui-monospace, monospace; font-size: 9.5px; color: rgba(255,255,255,.55); }
.yax span { position: absolute; right: 0; transform: translateY(-50%); white-space: nowrap; }
.pc { flex: 1; min-width: 0; display: flex; flex-direction: column; gap: 6px; }
.cplot { position: relative; touch-action: pan-y; cursor: crosshair; }
.cplot svg { display: block; width: 100%; }
.xl { display: flex; justify-content: space-between; font-family: 'IBM Plex Mono', ui-monospace, monospace; font-size: 9.5px; color: rgba(255,255,255,.55); }
.cur { position: absolute; top: 0; bottom: 0; width: 1px; background: rgba(255,255,255,.4); pointer-events: none; display: none; }
.dot { position: absolute; width: 11px; height: 11px; margin: -5.5px 0 0 -5.5px; border-radius: 50%; border: 2px solid #06090f; pointer-events: none; display: none; }
.tip { position: absolute; top: 6px; padding: 8px 12px; border-radius: 12px; border: 1px solid rgba(95,208,255,.4); background: rgba(6,9,15,.95); white-space: nowrap; display: none; flex-direction: column; gap: 4px; pointer-events: none; z-index: 3; }
.tip .tt { font-family: 'IBM Plex Mono', ui-monospace, monospace; font-size: 10px; letter-spacing: .06em; color: rgba(255,255,255,.7); }
.tip .tr { display: flex; align-items: center; gap: 8px; font-size: 12.5px; }
.tip .tr i { width: 8px; height: 8px; border-radius: 50%; }
.tip .tr b { margin-left: 12px; font-weight: 600; }
.nod { position: absolute; inset: 0; display: flex; align-items: center; justify-content: center; font-size: 12.5px; color: rgba(255,255,255,.5); pointer-events: none; }
.stats { display: grid; grid-template-columns: repeat(3, minmax(0, 1fr)); gap: 6px; }
.stats div { padding: 8px 10px; border-radius: 12px; background: rgba(255,255,255,.04); display: flex; flex-direction: column; gap: 2px; }
.stats span { font-family: 'IBM Plex Mono', ui-monospace, monospace; font-size: 9.5px; letter-spacing: .14em; color: rgba(255,255,255,.6); }
.stats b { font-size: 15px; font-weight: 600; }
.thl { display: flex; flex-wrap: wrap; gap: 6px 14px; font-family: 'IBM Plex Mono', ui-monospace, monospace; font-size: 10px; letter-spacing: .06em; color: rgba(255,255,255,.65); }
.thl span { display: flex; align-items: center; gap: 6px; }
.thl i { width: 10px; height: 10px; border-radius: 3px; display: inline-block; }
.pnl { padding: 14px 16px 12px; border-radius: 18px; border: 1px solid; display: flex; flex-direction: column; gap: 10px; margin-bottom: 10px; }
.pop { position: fixed; inset: 0; z-index: 999; background: rgba(3,6,12,.78); backdrop-filter: blur(6px); -webkit-backdrop-filter: blur(6px); display: flex; opacity: 0; visibility: hidden; pointer-events: none; transition: opacity .4s ease, visibility 0s linear .45s; align-items: center; justify-content: center; padding: 16px; box-sizing: border-box; }
.pop.on { opacity: 1; visibility: visible; pointer-events: auto; transition: opacity .5s ease, visibility 0s; }
.pop .sheet { transform: scale(.12); opacity: 0; transition: transform .42s cubic-bezier(.4,0,.6,1), opacity .35s ease; }
.pop.on .sheet { transform: none; opacity: 1; transition: transform .6s cubic-bezier(.2,.9,.25,1.12), opacity .4s ease; }
.sheet { position: relative; width: 100%; max-width: 720px; max-height: 92vh; overflow: auto; border-radius: 26px; border: 1.5px solid rgba(255,138,92,.55); box-shadow: 0 0 60px rgba(255,138,92,.25); background: #080c14; }
.sheet .axp { border: 0; border-radius: 0; background: none; }
.phd { position: sticky; top: 0; z-index: 3; display: flex; justify-content: space-between; align-items: center; padding: 10px 12px 4px 20px; background: linear-gradient(180deg, #080c14 70%, rgba(8,12,20,0)); font-family: 'IBM Plex Mono', ui-monospace, monospace; font-size: 10px; letter-spacing: .16em; color: #ff8a5c; }
.root.sm .pop { align-items: flex-end; padding: 0; }
.root.sm .sheet { max-width: 520px; max-height: 94vh; border-radius: 24px 24px 0 0; border-bottom: 0; box-shadow: 0 -10px 50px rgba(255,138,92,.22); }
.two { display: flex; flex-wrap: wrap; gap: 18px; align-items: flex-start; }
.two > .a { flex: 1 1 380px; min-width: 0; }
.two > .b { flex: 2 1 560px; min-width: 0; }
.axp { padding: 18px 20px; border-radius: 22px; border: 1px solid rgba(255,138,92,.35); background: linear-gradient(160deg, rgba(255,138,92,.08), rgba(255,255,255,.015) 55%); display: flex; flex-direction: column; gap: 14px; }
.axh { display: flex; justify-content: space-between; align-items: center; gap: 10px; }
.axh .lg { display: flex; align-items: center; gap: 12px; }
.axh .lg > span:first-child { width: 40px; height: 40px; flex: none; border-radius: 12px; border: 1px solid rgba(255,138,92,.55); background: rgba(255,138,92,.12); display: flex; align-items: center; justify-content: center; }
.axh b { display: block; font-size: 17px; font-weight: 600; }
.axh i { display: block; font-style: normal; font-family: 'IBM Plex Mono', ui-monospace, monospace; font-size: 10px; letter-spacing: .16em; color: #ff8a5c; }
.lab { font-family: 'IBM Plex Mono', ui-monospace, monospace; font-size: 10px; letter-spacing: .14em; color: rgba(255,255,255,.66); }
.fld { position: relative; display: flex; flex-direction: column; gap: 5px; padding: 10px 14px; border-radius: 14px; border: 1px solid rgba(255,255,255,.09); background: rgba(255,255,255,.035); }
.fld select { min-height: 34px; border: none; outline: none; background: transparent; color: #fff; font: inherit; font-size: 15px; font-weight: 500; color-scheme: dark; }
.fld select option { color: #000; }
.fld .ov { position: absolute; inset: 0; border: none; border-radius: 14px; background: transparent; z-index: 2; }
.fld .lk { position: absolute; top: 10px; right: 14px; z-index: 3; pointer-events: none; }
.seg { display: grid; gap: 4px; padding: 4px; border-radius: 14px; background: rgba(255,255,255,.05); }
.seg button { min-width: 0; overflow-wrap: anywhere; min-height: 44px; padding: 4px 6px; border-radius: 10px; border: 1px solid transparent; background: transparent; font-size: 12px; line-height: 1.25; color: rgba(255,255,255,.7); }
.seg button.on { border-color: rgba(255,138,92,.7); background: rgba(255,138,92,.18); color: #fff; }
.stp { padding: 10px 12px; border-radius: 14px; border: 1px solid rgba(255,255,255,.09); background: rgba(255,255,255,.035); display: flex; flex-direction: column; gap: 8px; }
.stp div { display: flex; align-items: center; justify-content: space-between; gap: 6px; }
.stp button { width: 44px; height: 44px; border-radius: 50%; border: 1px solid rgba(255,255,255,.25); background: rgba(6,9,15,.6); font-size: 20px; }
.stp b { font-size: 22px; font-weight: 600; color: #ff8a5c; }
.ctl { display: flex; flex-direction: column; gap: 8px; }
.sw { display: flex; align-items: center; gap: 14px; padding: 12px 16px; min-height: 64px; border-radius: 16px; border: 1px solid; text-align: left; width: 100%; }
.sw .ib { width: 40px; height: 40px; flex: none; border-radius: 12px; border: 1px solid; background: rgba(255,255,255,.04); display: flex; align-items: center; justify-content: center; }
.sw .sn { flex: 1; min-width: 0; display: flex; flex-direction: column; gap: 3px; }
.sw .sn b { font-size: 15px; font-weight: 600; overflow: hidden; text-overflow: ellipsis; }
.sw .sn i { font-style: normal; font-family: 'IBM Plex Mono', ui-monospace, monospace; font-size: 10.5px; letter-spacing: .1em; }
.tg { width: 46px; height: 26px; flex: none; border-radius: 13px; position: relative; }
.tg::after { content: ''; position: absolute; top: 3px; left: 3px; width: 20px; height: 20px; border-radius: 50%; background: #fff; transition: left .15s; }
.tg.on::after { left: 23px; }
.rd { border-radius: 16px; border: 1px solid rgba(255,255,255,.09); background: rgba(255,255,255,.03); }
.rd > button { width: 100%; display: flex; align-items: center; justify-content: space-between; gap: 10px; padding: 0 16px; min-height: 52px; border: none; background: transparent; text-align: left; font-size: 15px; font-weight: 600; }
.rd .gr { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 6px; padding: 0 12px 12px; }
.rd .gr div { padding: 9px 12px; border-radius: 12px; background: rgba(255,255,255,.04); display: flex; flex-direction: column; gap: 3px; min-width: 0; }
.rd .gr span { font-family: 'IBM Plex Mono', ui-monospace, monospace; font-size: 9.5px; letter-spacing: .12em; color: rgba(255,255,255,.62); overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.rd .gr b { font-size: 15px; font-weight: 600; }
.lkr { display: flex; align-items: center; gap: 8px; font-family: 'IBM Plex Mono', ui-monospace, monospace; font-size: 10px; letter-spacing: .12em; color: rgba(255,255,255,.6); }
.unl { display: flex; align-items: center; justify-content: space-between; gap: 8px; padding: 6px 6px 6px 14px; border-radius: 999px; border: 1px solid rgba(46,232,122,.45); background: rgba(46,232,122,.08); font-family: 'IBM Plex Mono', ui-monospace, monospace; font-size: 10.5px; letter-spacing: .12em; color: #2ee87a; }
.unl button { min-height: 40px; padding: 0 16px; border-radius: 999px; border: 1px solid rgba(46,232,122,.5); background: transparent; font-family: inherit; font-size: 10.5px; letter-spacing: .12em; color: #2ee87a; }
.kp { padding: 14px 16px 16px; border-radius: 18px; border: 1px solid rgba(255,138,92,.55); background: linear-gradient(180deg, rgba(255,138,92,.12), rgba(8,12,20,.7)); box-shadow: 0 0 30px rgba(255,138,92,.18); display: flex; flex-direction: column; align-items: center; gap: 12px; }
.kp .kt { font-family: 'IBM Plex Mono', ui-monospace, monospace; font-size: 10.5px; letter-spacing: .16em; color: #ff8a5c; text-align: center; }
.kp .kd { display: flex; gap: 14px; height: 18px; align-items: center; }
.kp .kd i { width: 14px; height: 14px; border-radius: 50%; border: 1.5px solid rgba(255,255,255,.55); }
.kp .ke { min-height: 16px; font-family: 'IBM Plex Mono', ui-monospace, monospace; font-size: 10.5px; letter-spacing: .1em; color: #ff5a5a; }
.kp .kg { display: grid; grid-template-columns: repeat(3, 64px); gap: 8px; }
.kp .kg button { width: 64px; height: 52px; border-radius: 14px; border: 1px solid rgba(255,255,255,.18); background: rgba(6,9,15,.6); font-size: 20px; font-weight: 500; }
.empty { display: flex; align-items: center; justify-content: center; padding: 40px 22px; border-radius: 18px; border: 1px dashed rgba(255,255,255,.22); color: rgba(255,255,255,.6); font-size: 14px; text-align: center; }
.leg { display: flex; flex-wrap: wrap; gap: 8px 18px; font-family: 'IBM Plex Mono', ui-monospace, monospace; font-size: 10.5px; letter-spacing: .06em; color: rgba(255,255,255,.75); }
.leg span { display: flex; align-items: center; gap: 8px; }
.leg i { width: 16px; height: 3px; border-radius: 2px; display: inline-block; }
.hh { display: flex; flex-wrap: wrap; justify-content: space-between; align-items: center; gap: 10px; font-family: 'IBM Plex Mono', ui-monospace, monospace; font-size: 11px; letter-spacing: .2em; color: #5fd0ff; }
.root.sm { padding: 16px 12px 24px; }
.root.sm .h1 { font-size: 24px; }
.root.sm .seg { grid-template-columns: minmax(0, 1fr) !important; }
.root.sm .box { padding: 14px 12px; }
.root.sm .cols { font-size: 9.5px; letter-spacing: .12em; }
.cs { max-width: 640px; border-color: rgba(255,255,255,.25); }
.cs .pnl { border: 0 !important; background: none !important; box-shadow: none !important; margin: 0; padding: 18px 20px 20px; }
.bil { display: flex; justify-content: space-between; flex-wrap: wrap; gap: 8px; font-family: 'IBM Plex Mono', ui-monospace, monospace; font-size: 10px; letter-spacing: .1em; }
.sbg { position: absolute; transform: translate(-50%, -50%); border-radius: 50%; border: 1.5px solid #b28cff; background: #0b1020; box-shadow: 0 0 10px rgba(178,140,255,.55); display: flex; align-items: center; justify-content: center; padding: 0; z-index: 3; cursor: pointer; }
.sbg:focus-visible { outline: 2px solid #fff; outline-offset: 2px; }
.sbr { position: relative; overflow: hidden; display: flex; align-items: center; gap: 12px; text-align: left; width: 100%; padding: 12px 14px; min-height: 56px; border-radius: 14px; border: 1px solid rgba(255,255,255,.1); background: rgba(255,255,255,.03); color: #fff; cursor: pointer; font: inherit; }
.sqr { position: absolute; transform: translate(-50%, -50%); aspect-ratio: 1; box-sizing: border-box; border: 1.5px solid; background: linear-gradient(160deg, rgba(178,140,255,.14), rgba(8,12,20,.97) 65%); overflow: hidden; display: flex; flex-direction: column; align-items: center; justify-content: flex-start; gap: 2px; padding: 6px 0 5px; border-radius: 16px; color: #fff; cursor: pointer; }
.sqr .q1 { font-family: 'IBM Plex Mono', ui-monospace, monospace; font-size: 9px; font-weight: 500; letter-spacing: .04em; line-height: 1; color: #2ee87a; }
.sqr .q2 { font-size: 14.5px; font-weight: 600; line-height: 1; }
.sqr .q3 { max-width: 92%; font-size: 9.5px; line-height: 1.1; color: rgba(255,255,255,.78); white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.sqr .q4 { margin-top: auto; padding-bottom: 2px; font-size: 13px; font-weight: 600; line-height: 1; }
.sqr .qb { position: absolute; left: 0; bottom: 0; height: 3px; background: #b28cff; box-shadow: 0 0 10px #b28cff; }
.nr .sqr { padding: 5px 0; border-radius: 14px; } .nr .sqr .q2 { font-size: 12.5px; } .nr .sqr .q3 { font-size: 8.5px; } .nr .sqr .q4 { font-size: 11.5px; }
.ivb { position: absolute; transform: translate(-50%, -50%); box-sizing: border-box; border: 1.5px solid #ff8a5c; background: linear-gradient(160deg, rgba(255,138,92,.16), rgba(8,12,20,.97) 60%); box-shadow: 0 0 30px rgba(255,138,92,.3); display: flex; flex-direction: column; align-items: center; justify-content: center; gap: 2px; text-align: center; }
`;

class FvHudCard extends HTMLElement {
  constructor() {
    super();
    this.attachShadow({ mode: 'open' });
    this._sel = null; this._met = 'w'; this._bpOpen = false; this._axi = null; this._prng = '24h'; this._hrng = null; this._cache = {}; this._loading = {}; this._cm = {}; this._sigs = {};
    this._lock = { left: 0, ask: false, pin: '', err: false, want: null }; this._rdOpen = true; this._narrow = false;
    const r = this.shadowRoot;
    r.addEventListener('click', (e) => this._click(e));
    r.addEventListener('change', (e) => this._change(e));
    r.addEventListener('pointermove', (e) => this._pmove(e));
    r.addEventListener('pointerdown', (e) => this._pmove(e));
    r.addEventListener('pointerleave', (e) => this._pleave(e), true);
  }

  static getConfigElement() { return document.createElement('fv-hud-card-editor'); }
  static getStubConfig() {
    return {
      title: 'Fotovoltaico', subtitle: 'ENERGIA',
      mode: 'single', inverters: [], solar: { name: 'Solare', entity: '', sub: 'PV1 + PV2', voltage_entity: '', current_entity: '', mppt2: { name: 'MPPT 2', entity: '', voltage_entity: '', current_entity: '' }, mppt3: { name: 'MPPT 3', entity: '', voltage_entity: '', current_entity: '' }, mppt4: { name: 'MPPT 4', entity: '', voltage_entity: '', current_entity: '' } }, grid: { name: 'Rete Enel', entity: '', voltage_entity: '' },
      battery: { name: 'Batteria', entity: '', soc_entity: '', charging_positive: true, capacity_kwh: '', min_soc: 20 }, battery2: { name: 'Batteria 2', entity: '', soc_entity: '', charging_positive: true }, home: { name: 'Casa', entity: '' },
      loads: [], indicators: [], axpert: { title: 'Inverter', controls: [], switches: [], readings: [], lock: { enabled: false, pin: '', seconds: 30, protect_controls: true, protect_switches: true } },
      history: { title: 'STORICO POTENZE', series: [], ranges: ['24h', '7g', '30g'], height: 260 },
    };
  }
  getCardSize() { return 16; }
  getGridOptions() { return { columns: 12, min_columns: 6, rows: 'auto' }; }

  setConfig(config) {
    if (!config) throw new Error('Configurazione mancante');
    const c = JSON.parse(JSON.stringify(config)); const d = FvHudCard.getStubConfig();
    ['solar', 'grid', 'battery', 'battery2', 'home'].forEach((k) => { c[k] = Object.assign({}, d[k], c[k] || {}); });
    c.loads = Array.isArray(c.loads) ? c.loads.slice(0, FV_MAX_LOADS) : [];
    c.mode = c.mode === 'multi' ? 'multi' : 'single';
    c.solar.mppt2 = Object.assign({}, d.solar.mppt2, c.solar.mppt2 || {}); c.solar.mppt3 = Object.assign({}, d.solar.mppt3, c.solar.mppt3 || {}); c.solar.mppt4 = Object.assign({}, d.solar.mppt4, c.solar.mppt4 || {});
    c.inverters = (Array.isArray(c.inverters) ? c.inverters : []).slice(0, FV_MAX_INV).map((v) => { v = v && typeof v === 'object' ? v : {}; ['phase', 'battery', 'home'].forEach((k) => { if (!v[k] || typeof v[k] !== 'object') v[k] = {}; }); if (!Array.isArray(v.mppt)) v.mppt = []; v.loads = Array.isArray(v.loads) ? v.loads.slice(0, FV_MAX_LOADS_INV) : []; v.axpert = Object.assign({ controls: [], switches: [], readings: [] }, v.axpert && typeof v.axpert === 'object' ? v.axpert : {}); ['controls', 'switches', 'readings'].forEach((k) => { if (!Array.isArray(v.axpert[k])) v.axpert[k] = []; }); return v; });
    c.indicators = Array.isArray(c.indicators) ? c.indicators.slice(0, FV_MAX_IND) : [];
    c.axpert = Object.assign({}, d.axpert, c.axpert || {}); c.axpert.lock = Object.assign({}, d.axpert.lock, c.axpert.lock || {});
    ['controls', 'switches', 'readings'].forEach((k) => { if (!Array.isArray(c.axpert[k])) c.axpert[k] = []; });
    c.history = Object.assign({}, d.history, c.history || {});
    if (!Array.isArray(c.history.series)) c.history.series = [];
    if (!Array.isArray(c.history.ranges) || !c.history.ranges.length) c.history.ranges = ['24h', '7g', '30g'];
    this._config = c; this._ents = null; this._cache = {}; this._sigs = {}; this._sel = null; this._met = 'w'; this._bpOpen = false; this._hrng = c.history.ranges[0];
    this._build(); this._update(true);
  }
  set hass(h) { this._hass = h; if (this._config) this._update(false); }

  connectedCallback() {
    if (!this._ro) this._ro = new ResizeObserver(() => this._measure());
    this._ro.observe(this);
    this._timer = setInterval(() => { if (!this.isConnected || !this._hass) return; Object.keys(this._cache).forEach((k) => { const [id, rg] = k.split('|'); this._fetch(id, rg).then((r) => { this._cache[k] = r; this._paint('p'); this._paint('h'); }).catch(() => {}); }); }, 300000);
    this._measure();
  }
  disconnectedCallback() { if (this._ro) this._ro.disconnect(); clearInterval(this._timer); clearInterval(this._iv); }

  _measure() {
    const w = this.clientWidth; if (!w || !this._config) return;
    const narrow = w < 980; const root = this.shadowRoot.querySelector('.root');
    if (root) root.classList.toggle('sm', w < 560);
    if (narrow !== this._narrow) { this._narrow = narrow; this._sigs.flow = null; this._update(false); }
  }

  /* ---------- dati ---------- */
  _flowIds() {
    const c = this._config; const a = [c.solar.entity, c.solar.mppt2.entity, c.solar.mppt3.entity, c.solar.mppt4.entity, c.grid.entity, c.grid.voltage_entity, c.grid.frequency_entity, c.battery.entity, c.battery.soc_entity, c.battery2.entity, c.battery2.soc_entity, c.home.entity];
    c.loads.forEach((l) => { a.push(l.entity, l.sub_entity, l.soc_entity); (l.sub_loads || []).forEach((x) => x && a.push(x.entity)); });
    c.inverters.forEach((v) => { a.push(v.phase.entity, v.phase.voltage_entity, v.battery.entity, v.battery.soc_entity, v.home.entity); (v.mppt || []).forEach((m) => m && a.push(m.entity)); v.loads.forEach((l) => { a.push(l.entity, l.soc_entity); (l.sub_loads || []).forEach((x) => x && a.push(x.entity)); }); });
    return a;
  }
  _entIds() {
    if (this._ents) return this._ents; const c = this._config; const s = new Set();
    this._flowIds().forEach((x) => x && s.add(x));
    c.indicators.forEach((i) => i.entity && s.add(i.entity));
    ['controls', 'switches', 'readings'].forEach((k) => c.axpert[k].forEach((i) => i.entity && s.add(i.entity)));
    c.inverters.forEach((v) => ['controls', 'switches', 'readings'].forEach((k) => v.axpert[k].forEach((i) => i && i.entity && s.add(i.entity))));
    c.history.series.forEach((i) => i.entity && s.add(i.entity));
    return (this._ents = Array.from(s));
  }
  _st(id) { return id && this._hass ? this._hass.states[id] : undefined; }
  _raw(id) { const st = this._st(id); if (!st) return null; const v = parseFloat(st.state); return isNaN(v) ? null : v; }
  _unit(id) { const st = this._st(id); return (st && st.attributes && st.attributes.unit_of_measurement) || ''; }
  _pw(id) { const v = this._raw(id); if (v == null) return null; const u = this._unit(id); return u === 'kW' ? v * 1000 : u === 'MW' ? v * 1e6 : v; }
  _lang() { return (this._hass && this._hass.locale && this._hass.locale.language) || 'it'; }
  _f(v, dec) {
    if (v == null || isNaN(v)) return '—';
    const o = dec != null && dec !== '' ? { minimumFractionDigits: +dec, maximumFractionDigits: +dec } : { minimumFractionDigits: 0, maximumFractionDigits: Math.abs(v) >= 1000 ? 0 : Math.abs(v) >= 100 ? 1 : 2 };
    return Number(v).toLocaleString(this._lang(), o);
  }
  _fw(w) { if (w == null) return '—'; return Math.abs(w) >= 1000 ? (w / 1000).toLocaleString(this._lang(), { minimumFractionDigits: 2, maximumFractionDigits: 2 }) + ' kW' : Math.round(w).toLocaleString(this._lang()) + ' W'; }
  _name(it, fb) { if (it && it.name) return it.name; const st = this._st(it && it.entity); return (st && st.attributes.friendly_name) || fb || (it && it.entity) || 'Elemento'; }
  _dead(id) { const st = this._st(id); return !st || st.state === 'unavailable' || st.state === 'unknown'; }

  _flowData() {
    const c = this._config; const n = (v) => (v == null ? 0 : v);
    const sm = this._smp(); const dual = sm.length > 1; const ms = sm.map((x) => Math.max(0, n(this._pw(x.cfg.entity)))); const m1 = ms[0] || 0; const m2 = ms[1] || 0; const pv = ms.reduce((a, x) => a + x, 0);
    let g = n(this._pw(c.grid.entity)); if (c.grid.import_positive === false) g = -g; const grid = Math.max(0, g);
    const bats = [c.battery].concat(this._bat2On() ? [c.battery2] : []).map((bc) => { let bw = n(this._pw(bc.entity)); if (bc.charging_positive === false) bw = -bw; return { b: bw, soc: this._raw(bc.soc_entity) }; });
    const b = bats.reduce((a, x) => a + x.b, 0); const socs = bats.map((x) => x.soc).filter((x) => x != null);
    const soc = socs.length ? socs.reduce((a, x) => a + x, 0) / socs.length : null;
    const ch = Math.max(0, b); const dis = Math.max(0, -b);
    const sb = Math.min(pv, ch); const rb = Math.max(0, ch - sb);
    const f = { sc: pv - sb, sb, rb, rc: Math.max(0, grid - rb), bc: dis };
    const calc = f.sc + f.bc + f.rc; const hw = c.home.entity ? this._pw(c.home.entity) : null;
    const loads = c.loads.map((l) => ({ w: Math.max(0, n(this._pw(l.entity))) }));
    return { pv, m1, m2, ms, dual, g, grid, b, bats, soc, f, home: hw != null ? hw : calc, loads, volt: this._raw(c.grid.voltage_entity), vu: this._unit(c.grid.voltage_entity) || 'V' };
  }

  /* ---------- struttura ---------- */
  _build() {
    const c = this._config;
    this.shadowRoot.innerHTML = `<style>${FV_CSS}</style><div class="root"><div class="in">
      <div class="head"><div><div class="kick">${fvEsc(c.subtitle || 'ENERGIA')}</div><div class="h1">${fvEsc(c.title || 'Fotovoltaico')}</div></div><div class="chips" id="chips"></div></div>
      <div class="box"><div class="cols"><span>CATENA ENERGETICA · FONTI › INVERTER › CASA › UTENZE</span><span class="lc">QUOTA SUL CONSUMO</span></div><div id="flow"></div></div>
      <div id="panel"></div><div id="tiles"></div>
      <div class="two"><div class="b" id="hist" style="flex:1 1 100%"></div></div>
    </div>
    <div class="pop" id="pop"><div class="sheet"><div class="phd"><span>IMPOSTAZIONI INVERTER</span><button type="button" class="xb" data-act="popclose" aria-label="Chiudi">${fvIcon('x', '#fff', 16, 2)}</button></div><div id="axp"></div></div></div>
    <div class="pop" id="cpop"><div class="sheet cs"><div id="cpanel"></div></div></div>
    <div class="pop" id="bpop"><div class="sheet cs" style="max-width:520px"><div id="bpbody"></div></div></div>
    <div class="pop" id="spop"><div class="sheet cs" style="max-width:560px"><div id="spbody"></div></div></div></div>`;
    this._measure();
    const root = this.shadowRoot.querySelector('.root'); if (root) root.classList.toggle('sm', this.clientWidth > 0 && this.clientWidth < 560);
  }
  _$(id) { return this.shadowRoot.getElementById(id); }
  _reg(name, sig, fn) { if (this._sigs[name] === sig) return; this._sigs[name] = sig; fn(); }

  _update(force) {
    if (!this._config || !this.shadowRoot.querySelector('.root')) return;
    const h = this._hass; const ids = this._entIds();
    const S = (list) => list.map((id) => { const st = id && h ? h.states[id] : null; return id + '|' + (st ? st.state : '-'); }).join('§');
    const c = this._config;
    if (force) this._sigs = {};
    this._reg('flow', S(this._flowIds()) + '#' + this._narrow + c.mode + (h ? '1' : '0'), () => { this._renderFlow(); });
    this._reg('tiles', S(c.indicators.map((i) => i.entity)) + '#' + JSON.stringify(this._sel) + (h ? '1' : '0'), () => { this._renderTiles(); });
    this._patchPanel();
    if (this._subOpen) this._renderSubPop();
    const axx = this._ax(); const axIds = axx.controls.concat(axx.switches).map((i) => i.entity);
    const L = this._lock; this._reg('axp', S(axIds) + '#' + (L.left > 0) + L.ask + L.pin + L.err + L.want + this._rdOpen + this._axi + (h ? '1' : '0'), () => { this._renderAxp(); });
    this._patchReadings();
    this._reg('hist', this._hrng + '#' + (h ? '1' : '0'), () => { this._renderHist(); });
    this._patchLegend();
    if (h && ids.length) this._loadAll();
  }

  /* ---------- flusso ---------- */
  _edge(d, w, col, o) {
    const sw = (o && o.sw) || 2; const dw = (o && o.dw) || 4; const on = w > 5; const dur = (on ? Math.max(.45, 2.4 - Math.log10(w) * .5) : 1).toFixed(2);
    return `<path d="${d}" fill="none" stroke="${col}" stroke-opacity="${on ? .3 : .1}" stroke-width="${sw}"/><path class="${on ? 'fl' : ''}" d="${d}" fill="none" stroke="${col}" stroke-opacity="${on ? 1 : 0}" stroke-width="${dw}" style="animation-duration:${dur}s"/>`;
  }
  _S(a, b) { const m = (a[0] + b[0]) / 2; return `M${a[0]} ${a[1]}C${m} ${a[1]} ${m} ${b[1]} ${b[0]} ${b[1]}`; }
  _V(a, b) { const m = (a[1] + b[1]) / 2; return `M${a[0]} ${a[1]}C${a[0]} ${m} ${b[0]} ${m} ${b[0]} ${b[1]}`; }
  _smp() { const s = this._config.solar; const nm0 = s.name && s.name !== 'Solare' ? s.name : ''; const L = [{ cfg: s, i: 0, name: nm0 || 'MPPT 1' }]; [['mppt2', 7, 'MPPT 2'], ['mppt3', 8, 'MPPT 3'], ['mppt4', 9, 'MPPT 4']].forEach(([k, i, nm]) => { const m = s[k]; if (m && m.entity) L.push({ cfg: m, i, name: m.name || nm }); }); return L; }
  _mppt2On() { const m = this._config.solar.mppt2; return !!(m && m.entity); }
  _bat2On() { const b = this._config.battery2; return !!(b && (b.entity || b.soc_entity)); }
  _batName(i) { const b = i ? this._config.battery2 : this._config.battery; if (!this._bat2On()) return b.name || 'Batteria'; return b.name && b.name !== 'Batteria' ? b.name : 'Batteria ' + (i + 1); }
  _L(a, b) { return `M${a[0]} ${a[1]}L${b[0]} ${b[1]}`; }
  _R(p, r) {
    r = r == null ? 18 : r; let s = `M${p[0][0]} ${p[0][1]}`;
    for (let i = 1; i < p.length - 1; i++) {
      const a = p[i - 1]; const b = p[i]; const c = p[i + 1]; const l1 = Math.hypot(b[0] - a[0], b[1] - a[1]); const l2 = Math.hypot(c[0] - b[0], c[1] - b[1]); const q = Math.min(r, l1 / 2, l2 / 2);
      s += `L${(b[0] + (a[0] - b[0]) * q / l1).toFixed(1)} ${(b[1] + (a[1] - b[1]) * q / l1).toFixed(1)}Q${b[0]} ${b[1]} ${(b[0] + (c[0] - b[0]) * q / l2).toFixed(1)} ${(b[1] + (c[1] - b[1]) * q / l2).toFixed(1)}`;
    }
    const z = p[p.length - 1]; return s + `L${z[0]} ${z[1]}`;
  }
  _dk(d) { return d ? `data-act="open" data-kind="${d.kind || 'src'}" data-i="${d.i == null ? '' : d.i}" data-key="${fvEsc(d.key || '')}" data-met="${d.met || 'w'}"` : ''; }
  _nodeHtml(p, W, H, sz, o) {
    const a = o.active; const sp = o.split; const nar = this._narrow;
    /* o.split = due zone cliccabili nello stesso cerchio: sopra la percentuale, sotto la potenza */
    const zone = (cls, d, lab, inner) => (!d ? `<span class="${cls}">${inner}</span>` : `<span class="${cls} zn" ${this._dk(d)} role="button" aria-label="Storico ${fvEsc(lab)}" style="--zc:${o.col}">${inner}</span>`);
    const vst = o.fs ? ` style="font-size:${o.fs}px"` : '';
    const vs = `<span class="s" style="color:${a ? o.col : 'rgba(255,255,255,.6)'}${o.ss ? ';font-size:' + o.ss + 'px' : ''}">${fvEsc(o.sub)}</span>`;
    const isz = o.is || (nar ? (sp ? 14 : 18) : (sp ? 20 : 22));
    const inner = sp ? zone('zt', sp.top, sp.topLab, fvIcon(o.ic, o.col, isz) + `<span class="v"${vst}>${fvEsc(o.val)}</span>`) + zone('zb', sp.bot, sp.botLab, vs)
      : fvIcon(o.ic, o.col, isz) + `<span class="v"${vst}>${fvEsc(o.val)}</span>` + vs;
    const click = !sp && o.src ? `${this._dk(o.src)} role="button" aria-label="Storico ${fvEsc(o.lab)}" ` : '';
    return `<div class="nd" ${click}style="${!sp && o.src ? 'cursor:pointer;' : ''}left:${(p[0] / W * 100).toFixed(3)}%;top:${(p[1] / H * 100).toFixed(3)}%;width:${(sz / W * 100).toFixed(3)}%;aspect-ratio:1;opacity:${a ? 1 : .62}">
      <div class="c" style="border-color:${a ? o.col : 'rgba(255,255,255,.22)'};box-shadow:${a ? '0 0 26px ' + o.col + '55' : 'none'}">${inner}</div>
      <span class="l"${o.labTop ? ' style="top:auto;bottom:100%;margin-top:0;margin-bottom:6px"' : ''}>${fvEsc(o.lab)}</span></div>`;
  }
  /* ---------- sottocarichi ---------- */
  _subs(l) { return (l && Array.isArray(l.sub_loads) ? l.sub_loads : []).filter((x) => x && x.entity).slice(0, FV_MAX_SUB).map((x) => ({ name: this._name(x, 'Sottocarico'), entity: x.entity, w: Math.max(0, this._pw(x.entity) || 0) })); }
  _sbHtml(ref, x, y, sz, nm) {
    return `<button type="button" class="sbg" data-act="sub" data-ref="${ref}" title="Sottocarichi" aria-label="Sottocarichi ${fvEsc(nm)}" style="left:${x.toFixed(3)}%;top:${y.toFixed(3)}%;width:${sz}px;height:${sz}px"><svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="#b28cff" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M4 7h16M4 12h16M4 17h10"/></svg></button>`;
  }
  _subParent(ref) {
    const c = this._config; const p = String(ref || '').split('-');
    if (p[0] === 'l') { const l = c.loads[+p[1]]; return l ? { l, sub: 'UTENZA' } : null; }
    if (p[0] === 'm') { const iv = c.inverters[+p[1]]; const l = iv && (iv.loads || [])[+p[2]]; return l ? { l, sub: (iv.name || 'Inverter ' + (+p[1] + 1)).toUpperCase() } : null; }
    return null;
  }
  _renderSubPop() {
    const pop = this._$('spop'); const body = this._$('spbody'); if (!pop || !body) return;
    const par = this._subOpen ? this._subParent(this._subOpen) : null; const sb = par ? this._subs(par.l) : [];
    if (!par || !sb.length) { this._popOn(pop, false); return; }
    this._popOn(pop, true);
    const l = par.l; const tw = Math.max(0, this._pw(l.entity) || 0); const tot = Math.max(1, tw); const PAL = ['#7aa8ff', '#5fd0ff', '#ff9ad5', '#ffd24a', '#2ee87a', '#ff8a5c'];
    const rows = sb.map((x, j) => { const c = PAL[j % PAL.length]; const pc = Math.round(x.w / tot * 100); return `<button type="button" class="sbr" data-act="open" data-kind="sub" data-i="${j}" data-key="${fvEsc(this._subOpen)}" aria-label="Storico ${fvEsc(x.name)}">
      <span style="width:10px;height:10px;flex:none;border-radius:3px;background:${c};box-shadow:0 0 10px ${c}88"></span>
      <span style="flex:1;min-width:0;display:flex;flex-direction:column;gap:2px"><span style="font-size:14.5px;font-weight:600">${fvEsc(x.name)}</span><span class="mono" style="font-size:9.5px;letter-spacing:.06em;color:rgba(255,255,255,.5)">TOCCA PER LO STORICO</span></span>
      <span style="display:flex;flex-direction:column;align-items:flex-end;gap:2px"><span style="font-size:16px;font-weight:600;color:${x.w > 5 ? '#fff' : 'rgba(255,255,255,.55)'}">${fvEsc(this._fw(x.w))}</span><span class="mono" style="font-size:10px;color:rgba(255,255,255,.55)">${pc} %</span></span>
      <span style="position:absolute;left:0;bottom:0;height:3px;width:${fvClamp(pc, 0, 100)}%;background:${c};box-shadow:0 0 10px ${c}"></span></button>`; }).join('');
    const sheet = pop.querySelector('.sheet'); if (sheet) { sheet.style.borderColor = '#b28cff80'; sheet.style.boxShadow = '0 0 50px #b28cff33'; }
    body.innerHTML = `<div style="padding:18px 20px 22px;display:flex;flex-direction:column;gap:12px">
      <div style="display:flex;justify-content:space-between;align-items:flex-start;gap:12px"><div><div class="mono" style="font-size:11px;letter-spacing:.16em;color:rgba(255,255,255,.7)">${fvEsc(this._name(l).toUpperCase())} · SOTTOCARICHI</div><div class="mono" style="font-size:10px;letter-spacing:.12em;color:rgba(255,255,255,.45);margin-top:2px">${fvEsc(par.sub)} · ${sb.length} ${sb.length === 1 ? 'SOTTOCARICO' : 'SOTTOCARICHI'}</div><div style="font-size:28px;font-weight:700;color:#b28cff;margin-top:4px">${fvEsc(this._fw(tw))}</div></div><button type="button" class="xb" data-act="spclose" aria-label="Chiudi">${fvIcon('x', '#fff', 16, 2)}</button></div>
      <div style="display:flex;flex-direction:column;gap:8px">${rows}</div></div>`;
  }
  /* apertura/chiusura dei popup: zoom che parte dal punto toccato */
  _popOn(pop, on) {
    if (!pop) return; on = !!on; const has = pop.classList.contains('on');
    if (!on) { if (pop._raf) { cancelAnimationFrame(pop._raf); pop._raf = 0; } if (has) pop.classList.remove('on'); return; }
    if (has || pop._raf) return;
    pop._raf = requestAnimationFrame(() => {
      pop._raf = 0; const sh = pop.querySelector('.sheet');
      if (sh) { const o = this._org || { x: innerWidth / 2, y: innerHeight / 2 }; sh.style.transformOrigin = (o.x - sh.offsetLeft).toFixed(0) + 'px ' + (o.y - sh.offsetTop).toFixed(0) + 'px'; }
      pop.classList.add('on');
    });
  }
  _openSub(ref) { this._subOpen = ref; this._renderSubPop(); }
  _closeSel() {
    const sb = this._sel && this._sel.kind === 'sub' ? this._sel.key : null;
    this._sel = null; this._sigs.tiles = null; this._update(); if (sb) { if (this._orgSub) this._org = this._orgSub; this._openSub(sb); }
  }
  /* quadrato di un'utenza (modalità multi inverter): icona in alto, quota, nome e potenza istantanea */
  _sqHtml(l, key, p, W, H, sq, w, pct) {
    const on = w > 5; const col = FV_COL.ind; let soc = '';
    if (l.soc_entity) { const sv = this._raw(l.soc_entity); if (sv != null) soc = 'SOC ' + this._f(sv, 0) + ' %'; }
    const nm = this._name(l);
    const nsub = this._subs(l).length; const sbg = nsub ? this._sbHtml('m-' + key.slice(2), (p[0] + sq / 2) / W * 100, (p[1] - sq / 2) / H * 100, this._narrow ? 22 : 26, nm) : '';
    return `<button type="button" class="sqr" ${this._dk({ kind: 'mx', key, met: 'w' })} title="${fvEsc(nm)}" aria-label="Storico ${fvEsc(nm)}" style="left:${(p[0] / W * 100).toFixed(3)}%;top:${(p[1] / H * 100).toFixed(3)}%;width:${(sq / W * 100).toFixed(3)}%;border-color:${on ? col : 'rgba(255,255,255,.22)'};box-shadow:${on ? '0 0 18px ' + col + '44' : 'none'};opacity:${on ? 1 : .62}">
      ${soc ? `<span class="q1">${fvEsc(soc)}</span>` : ''}${fvIcon(l.icon || 'bolt', col, this._narrow ? 14 : 16)}<span class="q2" style="color:${on ? '#fff' : 'rgba(255,255,255,.6)'}">${pct} %</span><span class="q3">${fvEsc(nm)}</span><span class="q4 mono" style="color:${col}">${fvEsc(this._fw(w))}</span><span class="qb" style="width:${fvClamp(pct, 0, 100)}%"></span></button>${sbg}`;
  }
  /* triangolo "carichi non monitorati": casa meno la somma delle utenze inserite, con la quota sul consumo */
  _unHtml(p, W, H, sz, o) {
    const col = '#ff6fb5'; const on = o.on; const c = on ? col : 'rgba(255,255,255,.6)';
    return `<div class="un" role="img" aria-label="Carichi non monitorati ${fvEsc(o.val)}" style="position:absolute;left:${(p[0] / W * 100).toFixed(3)}%;top:${(p[1] / H * 100).toFixed(3)}%;width:${(sz / W * 100).toFixed(3)}%;aspect-ratio:100 / 90;transform:translate(-50%,-50%);opacity:${on ? 1 : .55};pointer-events:none">
      <svg viewBox="0 0 100 90" style="position:absolute;inset:0;width:100%;height:100%;overflow:visible;filter:drop-shadow(0 0 ${on ? o.gr : 0}px ${col}99)" aria-hidden="true"><polygon points="4,5 96,5 50,86" fill="rgba(8,12,20,.96)" stroke="${on ? col : 'rgba(255,255,255,.22)'}" stroke-width="2.4" stroke-linejoin="round"/></svg>
      <div style="position:absolute;left:0;right:0;top:6%;display:flex;flex-direction:column;align-items:center"><span style="font-size:${o.fs}px;font-weight:700;white-space:nowrap;color:${c}">${fvEsc(o.val)}</span><span style="font-size:${o.ps}px;font-weight:600;white-space:nowrap;color:${c};opacity:.85">${fvEsc(o.pct)}</span></div>
      <span style="position:absolute;left:50%;bottom:100%;transform:translateX(-50%);margin-bottom:3px;white-space:nowrap;font-size:${o.ls}px;color:${c}">Carichi non monitorati</span></div>`;
  }
  _invHtml(p, W, H, wd, ht, o) {
    const n = this._narrow; const ax = o.ax != null;
    return `<div class="ivb" ${ax ? `data-act="axpop" data-ax="${o.ax}" role="button" aria-label="Impostazioni ${fvEsc(o.name)}" ` : ''}style="${ax ? 'cursor:pointer;' : ''}left:${(p[0] / W * 100).toFixed(3)}%;top:${(p[1] / H * 100).toFixed(3)}%;width:${(wd / W * 100).toFixed(3)}%;aspect-ratio:${wd} / ${ht};padding:${n ? 4 : 8}px;border-radius:${n ? 18 : 20}px">${fvIcon('inv', FV_COL.axp, n ? 14 : 20)}<span class="mono" style="font-size:${n ? 8 : 9.5}px;letter-spacing:${n ? '.1' : '.14'}em;color:#ff8a5c">${fvEsc(o.name)}</span><span style="font-size:${n ? 15 : 18}px;font-weight:700;line-height:1.1">${fvEsc(o.out)}</span><span class="mono" style="font-size:${n ? 7.5 : 9}px;letter-spacing:.04em;color:rgba(255,255,255,.7)">IN ${fvEsc(o.inn)}</span>${ax ? `<span class="mono" style="font-size:${n ? 6.5 : 8}px;letter-spacing:.1em;color:#ff8a5c;opacity:.85">⚙ IMPOSTAZIONI</span>` : ''}</div>`;
  }
  _loadHtml(l, i, w, home, style) {
    const on = w > 5; const pct = Math.round(w / Math.max(1, home) * 100); const col = FV_COL.ind;
    let sub = l.sub || ''; if (l.sub_entity) { const st = this._st(l.sub_entity); if (st) { const u = st.attributes.unit_of_measurement; const nv = parseFloat(st.state); sub = (isNaN(nv) ? st.state : this._f(nv)) + (u ? ' ' + u : ''); } }
    if (l.soc_entity) { const sv = this._raw(l.soc_entity); if (sv != null) sub = 'SOC ' + this._f(sv, 0) + ' %'; }
    return `<button type="button" class="ld" data-act="open" data-kind="load" data-i="${i}" aria-label="Storico ${fvEsc(this._name(l))}" style="${style};border-color:${on ? col : 'rgba(255,255,255,.22)'};box-shadow:${on ? '0 0 22px ' + col + '40' : 'none'};opacity:${on ? 1 : .62};color:#fff">
      <span class="ic" style="border-color:${on ? col : 'rgba(255,255,255,.22)'}">${fvIcon(l.icon || 'bolt', col, 20)}</span>
      <span class="tx"><b>${fvEsc(this._name(l))}</b><i style="color:${on ? col : 'rgba(255,255,255,.6)'}">${fvEsc(sub)}${sub ? ' · ' : ''}${pct} %</i></span>
      <span class="vv" style="color:${on ? col : 'rgba(255,255,255,.6)'}">${fvEsc(this._fw(w))}</span><span class="bar" style="width:${fvClamp(pct, 0, 100)}%"></span></button>`;
  }
  _loadCircle(l, i, w, style) {
    const on = w > 5; const col = FV_COL.ind; const bd = on ? col : 'rgba(255,255,255,.22)'; const vc = on ? col : 'rgba(255,255,255,.6)';
    const sel = this._sel && this._sel.kind === 'load' && this._sel.i === i;
    return `<button type="button" class="ldc" data-act="open" data-kind="load" data-i="${i}" aria-label="Storico ${fvEsc(this._name(l))}" style="${style};opacity:${on ? 1 : .62}">
      <span class="c" style="border-color:${bd};box-shadow:${on ? '0 0 18px ' + col + '55' : 'none'}${sel ? ',0 0 0 2px ' + col : ''}">${fvIcon(l.icon || 'bolt', col, 14)}<span class="v" style="color:${vc}">${fvEsc(this._fw(w))}</span></span>
      <span class="l">${fvEsc(this._name(l))}</span></button>`;
  }
  _axBox(p, W, H, w, h, o) {
    const n = this._narrow;
    return `<div data-act="axpop" role="button" aria-label="Impostazioni inverter" style="cursor:pointer;position:absolute;left:${(p[0] / W * 100).toFixed(3)}%;top:${(p[1] / H * 100).toFixed(3)}%;width:${(w / W * 100).toFixed(3)}%;aspect-ratio:${w} / ${h};transform:translate(-50%,-50%);padding:${n ? 6 : 14}px;border-radius:${n ? 16 : 22}px;border:1.5px solid ${FV_COL.axp};background:linear-gradient(160deg,rgba(255,138,92,.16),rgba(8,12,20,.97) 60%);box-shadow:0 0 34px rgba(255,138,92,.3);display:flex;flex-direction:column;align-items:center;justify-content:center;gap:${n ? 2 : 4}px;text-align:center">
      ${fvIcon('inv', FV_COL.axp, n ? 20 : 26)}<span class="mono" style="font-size:${n ? 8 : 10}px;letter-spacing:.16em;color:${FV_COL.axp}">${fvEsc(o.name)}</span>
      <span style="font-size:${n ? 14 : 21}px;font-weight:700;white-space:nowrap">${fvEsc(o.inn)}</span>
      <span class="mono" style="font-size:${n ? 8 : 9.5}px;letter-spacing:.06em;color:rgba(255,255,255,.7);white-space:nowrap">${fvEsc(o.sub)}</span>
      <span class="mono" style="font-size:${n ? 8 : 9.5}px;letter-spacing:.06em;color:#5fd0ff;white-space:nowrap">OUT ${fvEsc(o.out)}</span>
      <span class="mono" style="margin-top:${n ? 1 : 4}px;font-size:${n ? 7 : 8.5}px;letter-spacing:.12em;color:${FV_COL.axp};opacity:.85;white-space:nowrap">⚙ ${n ? 'IMPOSTA' : 'IMPOSTAZIONI'}</span></div>`;
  }
  _etaChip(d, cap, min) {
    cap = Number(cap);
    if (!(cap > 0) || d.soc == null) return '';
    min = min != null && min !== '' ? Number(min) : 20;
    const fmt = (h) => { const m = Math.round(h * 60); if (m < 1) return '< 1 min'; if (m < 60) return m + ' min'; const hh = Math.floor(m / 60); const mm = m % 60; return hh + ' h' + (mm ? ' ' + mm + ' min' : ''); };
    let t = ''; let col = FV_COL.bat;
    if (d.b > 5) t = d.soc >= 100 ? 'BATTERIA PIENA' : 'PIENA TRA ' + fmt((100 - d.soc) / 100 * cap * 1000 / d.b);
    else if (d.b < -5) { col = FV_COL.red; t = d.soc <= min ? 'SOTTO IL ' + min + ' %' : min + ' % TRA ' + fmt((d.soc - min) / 100 * cap * 1000 / -d.b); }
    else return '';
    return `<span class="chip" style="border-color:${col}66;background:${col}14;color:${col}">${fvEsc(t)}</span>`;
  }
  _renderFlow() {
    if (this._config.mode === 'multi' && this._config.inverters.length) { this._renderMulti(); return; }
    const c = this._config; const d = this._flowData(); const nar = this._narrow; const C = FV_COL; const f = d.f;
    const n = c.loads.length; const lr = 25; const bats = d.bats; const nb = bats.length; const dense = n > 8; const dual = d.dual;
    const step = dense ? 62 : 72;
    const last = 45 + Math.max(0, n - 1) * step; const W = nar ? 360 : 1300; const H = nar ? Math.max(400, last + 60) : 680; const sz = nar ? 62 : 100; const cs = nar ? 62 : 130;
    const cy = nar ? (H - 15) / 2 : 340; const ldH = dense ? 58 : 68; const m0 = ldH / 2 + (dense ? 7 : 18);
    /* solare sopra l'inverter (uno o due MPPT affiancati), rete in linea, batterie affiancate sotto con una sola linea verso l'inverter */
    const P = nar
      ? { sol: [132, cy - 150], m: [[92, cy - 150], [172, cy - 150]], rete: [42, cy], inv: [132, cy], casa: [216, cy], b: nb === 2 ? [[92, cy + 148], [172, cy + 148]] : [[132, cy + 148]] }
      : { sol: [360, 120], m: [[290, 120], [430, 120]], rete: [100, 340], inv: [360, 340], casa: [620, 340], b: nb === 2 ? [[290, 560], [430, 560]] : [[360, 560]] };
    const sm = this._smp(); const nM = dual ? d.ms.length : 1; const msz = nar && nM >= 4 ? 50 : sz;
    const MX = nar ? (nM === 2 ? [92, 172] : nM === 3 ? [62, 132, 202] : [36, 94, 152, 210]) : (nM === 2 ? [290, 430] : nM === 3 ? [220, 360, 500] : [80, 220, 360, 500]);
    P.m = MX.map((x) => [x, nar ? cy - (nM >= 3 ? 172 : 150) : 120]);
    const bcol = d.b < -5 ? C.red : C.bat; const iw = nar ? 74 : 150; const ih = nar ? 102 : 170;
    const lp = c.loads.map((_, k) => nar ? [322, n > 1 ? 45 + k * step : cy] : [1120, n > 1 ? Math.round(m0 + k * (680 - 2 * m0) / (n - 1)) : 340]);
    const E = [];
    const iTop = [P.inv[0], P.inv[1] - ih / 2]; const iBot = [P.inv[0], P.inv[1] + ih / 2]; const mid = [P.inv[0], iBot[1] + (nar ? 31 : 60)];
    const bTop = (p) => [p[0], p[1] - sz / 2];
    if (dual) {
      const jn = [P.inv[0], iTop[1] - (nar ? 34 : 60)];
      E.push(this._edge(this._L(jn, iTop), d.pv, C.sol)); d.ms.forEach((w, k) => E.push(this._edge(this._V([P.m[k][0], P.m[k][1] + msz / 2], jn), w, C.sol)));
    } else E.push(this._edge(this._L([P.sol[0], P.sol[1] + sz / 2], iTop), d.pv, C.sol));
    /* rete: in prelievo la linea va verso l'inverter, in immissione verso la rete */
    const ra = nar ? [73, cy] : [150, 340]; const rb = nar ? [112, cy] : [285, 340];
    E.push(d.g >= 0 ? this._edge(this._L(ra, rb), d.g, C.rete) : this._edge(this._L(rb, ra), -d.g, C.rete));
    if (nar) E.push(this._edge(this._L([169, cy], [184, cy]), d.home, C.casa)); else E.push(this._edge(this._L([435, 340], [555, 340]), d.home, C.casa));
    const to = nb === 1 ? bTop(P.b[0]) : mid;
    E.push(d.b >= 0 ? this._edge(this._L(iBot, to), d.b, bcol) : this._edge(this._L(to, iBot), -d.b, bcol));
    if (nb === 2) bats.forEach((bt, i) => { const top = bTop(P.b[i]); E.push(bt.b >= 0 ? this._edge(this._V(mid, top), bt.b, C.bat) : this._edge(this._V(top, mid), -bt.b, C.red)); });
    const r0 = nar ? 31 : 67; const spd = nar ? (dense ? 6 : 7) : (dense ? 10 : 13);
    c.loads.forEach((l, k) => { const dy = Math.round(fvClamp((k - (n - 1) / 2) * spd, -(r0 - 4), r0 - 4)); E.push(this._edge(this._S([+(P.casa[0] + Math.sqrt(r0 * r0 - dy * dy)).toFixed(1), cy + dy], [lp[k][0] - (nar ? lr + 1 : 148), lp[k][1]]), d.loads[k].w, C.ind)); });
    let unTri = '';
    if (n > 0) {
      const un = Math.max(0, d.home - d.loads.reduce((a, x) => a + x.w, 0)); const on = un > 5; const cr = nar ? 31 : 65; const sz2 = nar ? 54 : 86; const ty = P.casa[1] - (nar ? 78 : 135); const tip = ty + sz2 * 0.43;
      E.push(this._edge(this._L([P.casa[0], P.casa[1] - cr], [P.casa[0], tip]), un, '#ff6fb5', nar ? undefined : { sw: 3, dw: 5 }));
      unTri = this._unHtml([P.casa[0], ty], W, H, sz2, { val: this._fw(un), pct: Math.round(un / Math.max(1, d.home) * 100) + ' %', on, fs: nar ? 10 : 13, ps: nar ? 8 : 10, ls: nar ? 8 : 11.5, gr: nar ? 6 : 10 });
    }
    const holes = (dual ? P.m : [P.sol]).map((p) => `<circle cx="${p[0]}" cy="${p[1]}" r="${(dual ? msz : sz) / 2 + 2}" fill="#000"/>`).join('') + [P.rete].concat(P.b).map((p) => `<circle cx="${p[0]}" cy="${p[1]}" r="${sz / 2 + 2}" fill="#000"/>`).join('') + `<circle cx="${P.casa[0]}" cy="${P.casa[1]}" r="${cs / 2 + 2}" fill="#000"/>`
      + `<rect x="${P.inv[0] - iw / 2 - 1}" y="${P.inv[1] - ih / 2 - 1}" width="${iw + 2}" height="${ih + 2}" rx="${nar ? 17 : 22}" fill="#000"/>`
      + (nar ? lp.map((p) => `<circle cx="${p[0]}" cy="${p[1]}" r="${lr + 2}" fill="#000"/>`).join('') : lp.map((p) => `<rect x="${p[0] - 147}" y="${p[1] - ldH / 2}" width="294" height="${ldH}" rx="18" fill="#000"/>`).join(''));
    const volt = d.volt != null ? this._f(d.volt) + ' ' + d.vu : '';
    const fr = c.grid.frequency_entity ? this._raw(c.grid.frequency_entity) : null;
    const batNode = (bt, i) => {
      const cfg = i ? c.battery2 : c.battery; const nm = this._batName(i); const ip = i ? 5 : 2; const col = bt.b < -5 ? C.red : C.bat;
      return this._nodeHtml(P.b[i], W, H, sz, { col, ic: 'bat', val: bt.soc != null ? this._f(bt.soc, 0) + ' %' : '—', sub: cfg.entity ? (bt.b >= 0 ? '+' : '−') + this._fw(Math.abs(bt.b)) : '', lab: nm, active: !!cfg.entity, src: cfg.entity ? { kind: 'src', i: ip, met: 'w' } : (cfg.soc_entity ? { kind: 'src', i: ip, met: 's' } : null),
        split: cfg.entity && cfg.soc_entity ? { top: { kind: 'src', i: ip, met: 's' }, topLab: nm + ' carica', bot: { kind: 'src', i: ip, met: 'w' }, botLab: nm + ' potenza' } : null });
    };
    const solNode = (pos, val, act, lab, src) => this._nodeHtml(pos, W, H, msz, { col: C.sol, ic: 'sol', val: this._fw(val), sub: dual ? '' : (c.solar.sub || ''), lab, labTop: true, active: act, src });
    const solName = c.solar.name && c.solar.name !== 'Solare' ? c.solar.name : '';
    const solNodes = dual
      ? d.ms.map((w, k) => solNode(P.m[k], w, w > 5, sm[k].name, { kind: 'src', i: sm[k].i })).join('')
      : this._nodeHtml(P.sol, W, H, sz, { col: C.sol, ic: 'sol', val: this._fw(c.solar.entity ? d.pv : null), sub: c.solar.sub || '', lab: c.solar.name || 'Solare', labTop: true, active: d.pv > 5, src: c.solar.entity ? { kind: 'src', i: 0 } : null });
    const nodes = solNodes
      + this._nodeHtml(P.rete, W, H, sz, { col: C.rete, ic: 'rete', val: (d.g < -5 ? '−' : '') + this._fw(c.grid.entity ? Math.abs(d.g) : null), sub: volt, lab: c.grid.name || 'Rete', active: Math.abs(d.g) > 5, src: c.grid.entity ? { kind: 'src', i: 1 } : null })
      + bats.map(batNode).join('')
      + this._axBox(P.inv, W, H, iw, ih, { name: nar ? 'INVERTER' : (c.axpert.title || 'INVERTER').toUpperCase(), inn: this._fw(d.pv + d.grid + f.bc), sub: nar ? (fr != null ? this._f(fr, 1) + ' Hz' : 'IN') : 'IN' + (fr != null ? ' · ' + this._f(fr, 2) + ' Hz' : ''), out: this._fw(d.home) })
      + this._nodeHtml(P.casa, W, H, cs, { col: C.casa, ic: 'casa', val: this._fw(d.home), sub: volt, lab: c.home.name || 'Casa', active: true, src: c.home.entity ? { kind: 'src', i: 3 } : null })
      + unTri;
    const wst = `width:${(294 / W * 100).toFixed(3)}%;aspect-ratio:294 / ${ldH}`;
    const loadsWide = nar ? c.loads.map((l, k) => this._loadCircle(l, k, d.loads[k].w, `left:${(lp[k][0] / W * 100).toFixed(3)}%;top:${(lp[k][1] / H * 100).toFixed(3)}%;width:${(lr * 2 / W * 100).toFixed(3)}%;aspect-ratio:1`)).join('') : c.loads.map((l, k) => this._loadHtml(l, k, d.loads[k].w, d.home, `left:${(lp[k][0] / W * 100).toFixed(3)}%;top:${(lp[k][1] / H * 100).toFixed(3)}%;${wst}`)).join('');
    const sbgs = c.loads.map((l, k) => (this._subs(l).length ? this._sbHtml('l-' + k, nar ? (lp[k][0] + lr * .71) / W * 100 : (lp[k][0] + 147) / W * 100, nar ? (lp[k][1] - lr * .71) / H * 100 : (lp[k][1] - ldH / 2) / H * 100, nar ? 20 : 26, this._name(l)) : '')).join('');
    const body = `<div class="fw ${nar ? 'nr' : ''}" style="aspect-ratio:${W} / ${H};${nar ? 'max-width:420px;margin:0 auto' : ''}"><svg class="flow" viewBox="0 0 ${W} ${H}" aria-hidden="true"><defs><mask id="fvmk"><rect x="-200" y="-200" width="3000" height="3000" fill="#fff"/>${holes}</mask></defs><g mask="url(#fvmk)">${E.join('')}</g></svg>${nodes}${loadsWide}${sbgs}</div>`;
    const lc = this.shadowRoot.querySelector('.cols .lc'); if (lc) lc.style.display = nar ? 'none' : '';
    const cl = this.shadowRoot.querySelector('.cols span'); if (cl) cl.textContent = 'CATENA ENERGETICA · FONTI › INVERTER › CASA › UTENZE';
    const empty = !c.solar.entity && !c.grid.entity && !c.battery.entity ? '<div class="empty" style="margin-bottom:12px">Apri l\'editor della card e collega le entità: fonti, utenze, indicatori, inverter e storico.</div>' : '';
    this._$('flow').innerHTML = empty + body;
    const chip = (t, col) => `<span class="chip" style="border-color:${col}66;background:${col}14;color:${col}">${fvEsc(t)}</span>`;
    this._$('chips').innerHTML = chip((dual ? 'SOLARE' : (c.solar.name || 'SOLARE')).toUpperCase() + ' ' + this._fw(c.solar.entity ? d.pv : null), C.sol) + chip('RETE ' + (d.g < -5 ? '↑ ' : '↓ ') + this._fw(c.grid.entity ? Math.abs(d.g) : null), C.rete) + chip('BATTERIA ' + (d.soc != null ? this._f(d.soc, 0) + ' %' : '—'), bcol) + this._etaChip(d, c.battery.capacity_kwh, c.battery.min_soc);
  }
  /* ---------- multi inverter ---------- */
  _mppts(iv) { return (iv.mppt || []).filter((m) => m && m.entity).slice(0, 4); }
  _multiData() {
    const c = this._config; const n = (v) => (v == null ? 0 : v);
    const inv = c.inverters.map((iv) => {
      const ph = iv.phase || {}; const bc = iv.battery || {};
      let pw = n(this._pw(ph.entity)); if (ph.import_positive === false) pw = -pw;
      const ms = this._mppts(iv).map((m) => ({ w: Math.max(0, n(this._pw(m.entity))) })); const p = ms.reduce((a, x) => a + x.w, 0);
      let bw = n(this._pw(bc.entity)); if (bc.charging_positive === false) bw = -bw;
      const hw = iv.home && iv.home.entity ? this._pw(iv.home.entity) : null;
      const out = hw != null ? Math.max(0, hw) : Math.max(0, p + pw - bw);
      return { pw, ms, p, bw, soc: this._raw(bc.soc_entity), bon: !!(bc.entity || bc.soc_entity), out, inn: p + Math.max(0, pw) + Math.max(0, -bw), loads: (iv.loads || []).map((l) => ({ w: Math.max(0, n(this._pw(l.entity))) })), v: this._raw(ph.voltage_entity), vu: this._unit(ph.voltage_entity) || 'V' };
    });
    const sumPh = inv.reduce((a, x) => a + x.pw, 0);
    let tot = sumPh; if (c.grid.entity) { tot = n(this._pw(c.grid.entity)); if (c.grid.import_positive === false) tot = -tot; }
    const bl = inv.filter((x) => x.bon); const socs = bl.map((x) => x.soc).filter((x) => x != null);
    return { inv, tot, sumPh, pv: inv.reduce((a, x) => a + x.p, 0), home: inv.reduce((a, x) => a + x.out, 0), net: bl.reduce((a, x) => a + x.bw, 0), soc: socs.length ? socs.reduce((a, x) => a + x, 0) / socs.length : null, nb: bl.length };
  }
  _renderMulti() {
    const c = this._config; const nar = this._narrow; const C = FV_COL; const d = this._multiData(); const invs = c.inverters; const N = invs.length;
    const sq = nar ? 72 : 76; const XS = nar ? [53, 135, 217, 299] : [886, 972, 1058, 1144]; const TX = 346; const CH = 837; const IX = nar ? 186 : 455;
    /* altezza del blocco utenze: righe a coppie con un canale animato nel mezzo, ultima riga singola */
    const geom = (nl) => { const R = Math.ceil(nl / 4); const pairs = Math.floor(R / 2); const single = R % 2; return { pairs, single, LH: pairs * (2 * sq + 28) + (single ? sq + 22 : 0) + Math.max(0, pairs + single - 1) * 16 }; };
    const LHmax = Math.max(0, ...invs.map((v) => geom(v.loads.length).LH));
    const W = nar ? 360 : 1300; let cy; let H;
    if (nar) { const Hc = 324 + LHmax; cy = invs.map((_, g) => 150 + g * Hc + 145); H = 150 + N * Hc + 10; } else { cy = invs.map((_, g) => 200 + g * 390); H = cy[N - 1] + 200; }
    const cm = N === 1 ? cy[0] : (cy[0] + cy[N - 1]) / 2;
    const E = []; const nodes = []; const hc = []; const hr = [];
    const eb = (a, b, w, col, o) => E.push(w >= 0 ? this._edge(this._L(a, b), w, col, o) : this._edge(this._L(b, a), -w, col, o));
    const nd = (p, s, o) => { nodes.push(this._nodeHtml(p, W, H, s, o)); hc.push([p[0], p[1], s / 2 + 2]); };
    const totW = d.tot;
    nd(nar ? [88, 70] : [85, cm], nar ? 72 : 110, { col: C.rete, ic: 'rete', val: (totW < -5 ? '−' : '') + this._fw(Math.abs(totW)), sub: N === 3 ? 'TRIFASE' : 'RETE', lab: c.grid.name || 'Rete Enel', active: Math.abs(totW) > 5, fs: nar ? 14 : 18, ss: nar ? 8 : 9.5, is: nar ? 18 : 22, src: { kind: 'mx', key: 'r' } });
    if (nar) {
      /* dorsale a sinistra che alimenta le fasi */
      eb([52, 70], [5, 70], d.sumPh, C.rete); eb([5, 70], [5, cy[0]], d.sumPh, C.rete);
      for (let i = 0; i < N - 1; i++) eb([5, cy[i]], [5, cy[i + 1]], d.inv.slice(i + 1).reduce((a, x) => a + x.pw, 0), C.rete);
    }
    d.inv.forEach((v, i) => {
      const iv = invs[i]; const c0 = cy[i]; const ph = iv.phase || {}; const ivn = (iv.name || 'INVERTER ' + (i + 1)).toUpperCase();
      nd(nar ? [88, c0] : [250, c0], nar ? 52 : 96, { col: C.rete, ic: 'rete', val: this._fw(v.pw), sub: v.v != null ? this._f(v.v, 1) + ' ' + v.vu : '', lab: ph.name || 'Fase L' + (i + 1), active: Math.abs(v.pw) > 5, fs: nar ? 11 : 16, ss: nar ? 7.5 : 9.5, is: nar ? 14 : 20, src: { kind: 'mx', key: 'f-' + i } });
      if (nar) { eb([5, c0], [62, c0], v.pw, C.rete); eb([114, c0], [138, c0], v.pw, C.rete); }
      else { E.push(v.pw >= 0 ? this._edge(this._S([140, cm], [202, c0]), v.pw, C.rete) : this._edge(this._S([202, c0], [140, cm]), -v.pw, C.rete)); eb([298, c0], [379, c0], v.pw, C.rete); }
      const ms = this._mppts(iv); const nM = ms.length; const msz = nar ? (nM >= 4 ? 44 : nM === 3 ? 48 : 50) : 64; const my = c0 - (nar ? 95 : 125);
      const mcx = nar ? (nM >= 4 ? 160 : nM === 3 ? 176 : IX) : IX; const mgp = nar ? (nM >= 4 ? 46 : nM === 3 ? 54 : 60) : 90;
      v.ms.forEach((m, j) => {
        const px = nM === 1 ? IX : nM === 2 ? (j ? IX + (nar ? 30 : 45) : IX - (nar ? 30 : 45)) : mcx + (j - (nM - 1) / 2) * mgp; const tx = nM <= 2 ? px : IX + (px - mcx) * (nar ? .65 : .45);
        nd([px, my], msz, { col: C.sol, ic: 'sol', val: this._fw(m.w), sub: '', lab: ms[j].name || 'MPPT ' + (j + 1), labTop: true, active: m.w > 5, fs: nar ? (nM >= 4 ? 9.5 : 11) : 12.5, ss: 8, is: nar ? (nM >= 4 ? 12 : 14) : 16, src: { kind: 'mx', key: 'm-' + i + '-' + j } });
        const y1 = my + msz / 2; const y2 = c0 - (nar ? 40 : 61); const ym = (y1 + y2) / 2;
        E.push(this._edge(tx === px ? this._L([px, y1], [px, y2]) : 'M' + px + ' ' + y1 + ' C' + px + ' ' + ym + ' ' + tx + ' ' + ym + ' ' + tx + ' ' + y2, m.w, C.sol));
      });
      if (v.bon) {
        const by = c0 + (nar ? 98 : 135); const bs = nar ? 62 : 72; const bcol = v.bw < 0 ? C.red : C.bat; const bnm = (iv.battery && iv.battery.name) || 'Batteria ' + (i + 1); const y0 = c0 + (nar ? 40 : 61);
        nd([IX, by], bs, { col: bcol, ic: 'bat', val: v.soc != null ? this._f(v.soc, 0) + ' %' : '—', sub: (v.bw >= 0 ? '+' : '−') + this._fw(Math.abs(v.bw)), lab: bnm, active: true, fs: nar ? 12 : 13.5, ss: nar ? 9 : 10.5, is: nar ? 12 : 14,
          split: { top: { kind: 'mx', key: 'b-' + i, met: 's' }, topLab: bnm + ' carica', bot: { kind: 'mx', key: 'b-' + i, met: 'w' }, botLab: bnm + ' potenza' } });
        E.push(v.bw >= 0 ? this._edge(this._L([IX, y0], [IX, by - bs / 2]), v.bw, C.bat) : this._edge(this._L([IX, by - bs / 2], [IX, y0]), -v.bw, C.red));
      }
      nodes.push(this._invHtml([IX, c0], W, H, nar ? 96 : 150, nar ? 77 : 120, { name: ivn, out: this._fw(v.out), inn: this._fw(v.inn), ax: ['controls', 'switches', 'readings'].some((k) => iv.axpert[k].some((x) => x && x.entity)) ? i : null }));
      hr.push(nar ? { x: IX - 49, y: c0 - 40, w: 98, h: 80, rx: 18 } : { x: IX - 76, y: c0 - 61, w: 152, h: 122, rx: 20 });
      const hm = iv.home || {};
      nd(nar ? [296, c0] : [720, c0], nar ? 56 : 110, { col: C.casa, ic: 'casa', val: this._fw(v.out), sub: ivn, lab: hm.name || 'Casa ' + (i + 1), active: true, fs: nar ? 12 : 17, ss: nar ? 7 : 9, is: nar ? 16 : 22, src: hm.entity ? { kind: 'mx', key: 'c-' + i } : null });
      E.push(this._edge(this._L([IX + (nar ? 48 : 76), c0], [nar ? 268 : 665, c0]), v.out, C.casa, { sw: 3, dw: 5 }));
      if ((iv.loads || []).length) {
        const un = Math.max(0, v.out - v.loads.reduce((x, l) => x + l.w, 0)); const hx = nar ? 296 : 720; const hy = c0 - (nar ? 76 : 118); const hs = nar ? 58 : 86; const tip = hy + hs * 0.43;
        E.push(this._edge(this._L([hx, c0 - (nar ? 28 : 55)], [hx, tip]), un, '#ff6fb5', { sw: 3, dw: 5 }));
        nodes.push(this._unHtml([hx, hy], W, H, hs, { val: this._fw(un), pct: Math.round(un / Math.max(1, v.out) * 100) + ' %', on: un > 5, fs: nar ? 10 : 13, ps: nar ? 8 : 10, ls: nar ? 8 : 11.5, gr: nar ? 6 : 10 }));
      }
      /* utenze: quadrati a righe sfalsate, con un canale animato fra due righe e un ramo fino a ogni quadrato */
      const items = (iv.loads || []).map((l, k) => ({ k, l, w: v.loads[k].w })); const gm = geom(items.length); const rows = []; const chans = []; let y = nar ? c0 + 165 : c0 - gm.LH / 2;
      for (let q = 0; q < gm.pairs + gm.single; q++) {
        if (q < gm.pairs) { const chy = y + sq + 14; rows[2 * q] = { yc: y + sq / 2, chy, st: 1 }; rows[2 * q + 1] = { yc: y + sq + 28 + sq / 2, chy, st: -1 }; chans.push(chy); y += 2 * sq + 28 + 16; }
        else { const chy = y + 8; rows[2 * q] = { yc: y + 22 + sq / 2, chy, st: -1 }; chans.push(chy); y += sq + 22 + 16; }
      }
      let rem = items.reduce((a, x) => a + x.w, 0); let py = null;
      chans.forEach((chy, ci) => {
        const its = items.filter((o) => rows[Math.floor(o.k / 4)].chy === chy); const sw = its.reduce((a, x) => a + x.w, 0);
        const xs = its.map((o) => XS[o.k % 4]); const act = its.filter((o) => o.w > 5).map((o) => XS[o.k % 4]);
        /* la linea animata arriva solo fino all'ultima utenza che assorbe; il resto resta la linea spenta */
        if (nar) {
          const xm = Math.min(...xs); const xa = act.length ? Math.min(...act) : xm;
          E.push(ci === 0 ? this._edge('M324 ' + c0 + 'L' + TX + ' ' + c0 + 'L' + TX + ' ' + chy, rem, C.ind) : this._edge(this._L([TX, py], [TX, chy]), rem, C.ind), this._edge(this._L([TX, chy], [xm, chy]), 0, C.ind), this._edge(this._L([TX, chy], [xa, chy]), sw, C.ind));
        } else {
          const dy = Math.round((ci - (chans.length - 1) / 2) * 14); const xe = Math.max(...xs); const xa = act.length ? Math.max(...act) : xe;
          E.push(this._edge(this._S([+(720 + Math.sqrt(55 * 55 - dy * dy)).toFixed(1), c0 + dy], [CH, chy]), sw, C.ind), this._edge(this._L([CH, chy], [xe, chy]), 0, C.ind), this._edge(this._L([CH, chy], [xa, chy]), sw, C.ind));
        }
        its.forEach((o) => { const rw = rows[Math.floor(o.k / 4)]; const x = XS[o.k % 4]; E.push(this._edge(this._L([x, chy], [x, rw.st === 1 ? rw.yc + sq / 2 : rw.yc - sq / 2]), o.w, C.ind)); });
        rem -= sw; py = chy;
      });
      items.forEach((o) => {
        const rw = rows[Math.floor(o.k / 4)]; const p = [XS[o.k % 4], rw.yc]; const pct = Math.round(o.w / Math.max(1, v.out) * 100);
        nodes.push(this._sqHtml(o.l, 'l-' + i + '-' + o.k, p, W, H, sq, o.w, pct)); hr.push({ x: p[0] - sq / 2, y: p[1] - sq / 2, w: sq, h: sq, rx: 14 });
      });
    });
    const holes = hc.map((h) => `<circle cx="${h[0]}" cy="${h[1]}" r="${h[2]}" fill="#000"/>`).join('') + hr.map((h) => `<rect x="${h.x}" y="${h.y}" width="${h.w}" height="${h.h}" rx="${h.rx}" fill="#000"/>`).join('');
    const body = `<div class="fw ${nar ? 'nr' : ''}" style="aspect-ratio:${W} / ${H};${nar ? 'max-width:420px;margin:0 auto' : ''}"><svg class="flow" viewBox="0 0 ${W} ${H}" aria-hidden="true"><defs><mask id="fvmk"><rect x="-200" y="-200" width="3000" height="3000" fill="#fff"/>${holes}</mask></defs><g mask="url(#fvmk)">${E.join('')}</g></svg>${nodes.join('')}</div>`;
    const lc = this.shadowRoot.querySelector('.cols .lc'); if (lc) lc.style.display = 'none';
    const cl = this.shadowRoot.querySelector('.cols span'); if (cl) cl.textContent = (N === 3 ? 'RETE TRIFASE · ' : '') + N + (N === 1 ? ' INVERTER' : ' INVERTER · ' + N + ' CASE CON LE LORO UTENZE');
    this._$('flow').innerHTML = body;
    const chip = (t, col) => `<span class="chip" style="border-color:${col}66;background:${col}14;color:${col}">${fvEsc(t)}</span>`;
    const eq = Math.abs(d.net) < 20; const bcol = eq ? '#9fb0c4' : d.net > 0 ? C.bat : C.red; const sg = (w) => (w >= 0 ? '+' : '−') + this._fw(Math.abs(w));
    const bchip = d.nb ? `<button type="button" class="chip" data-act="bpop" aria-label="Dettaglio batterie" style="border-color:${bcol}66;background:${bcol}14;color:${bcol};cursor:pointer">${fvEsc('BATTERIE ' + (d.soc != null ? this._f(d.soc, 0) + ' %' : '—') + ' · ' + sg(d.net))}</button>` : '';
    const sh = !!this._config.shared_battery; const cap = sh ? (Number(invs[0] && invs[0].battery && invs[0].battery.capacity_kwh) || 0) : invs.reduce((a, v) => a + (Number(v.battery && v.battery.capacity_kwh) || 0), 0); const mn = ((sh ? invs.slice(0, 1) : invs).find((v) => v.battery && v.battery.min_soc != null && v.battery.min_soc !== '') || { battery: {} }).battery.min_soc;
    this._$('chips').innerHTML = chip('SOLARE ' + this._fw(d.pv), C.sol) + chip('RETE ' + (totW < -5 ? '↑ ' : '↓ ') + this._fw(Math.abs(totW)), C.rete) + bchip + this._etaChip({ b: d.net, soc: d.soc }, cap, mn);
    if (this._bpOpen) this._renderBatPop();
  }
  _renderBatPop() {
    const pop = this._$('bpop'); const body = this._$('bpbody'); if (!pop || !body) return;
    this._popOn(pop, !!this._bpOpen); if (!this._bpOpen) return;
    const c = this._config; const d = this._multiData(); const C = FV_COL;
    const rows = d.inv.map((v, i) => ({ v, i })).filter((x) => x.v.bon);
    const gin = rows.filter((x) => x.v.bw > 5); const gout = rows.filter((x) => x.v.bw < -5); const net = d.net;
    const eq = Math.abs(net) < 20; const vcol = eq ? '#9fb0c4' : net > 0 ? C.bat : C.red; const sg = (w) => (w >= 0 ? '+' : '−') + this._fw(Math.abs(w));
    const mx = Math.max(1500, ...rows.map((x) => Math.abs(x.v.bw)));
    const lab = (t) => `<div class="mono" style="font-size:10px;letter-spacing:.14em;color:rgba(255,255,255,.55)">${t}</div>`;
    const box = (l, v, col, big) => `<div style="padding:${big ? '12px 14px' : '10px 14px'};border-radius:${big ? 16 : 14}px;${big ? 'border:1px solid rgba(255,255,255,.12)' : 'background:' + col + '12'}">${lab(l)}<div style="font-size:${big ? 26 : 14.5}px;font-weight:${big ? 700 : 600};color:${col};white-space:nowrap;margin-top:2px">${fvEsc(v)}</div></div>`;
    const list = rows.map(({ v, i }) => {
      const iv = c.inverters[i]; const col = v.bw > 5 ? C.bat : v.bw < -5 ? C.red : '#9fb0c4'; const wd = Math.abs(v.bw) / mx * 50;
      return `<div style="padding:10px 14px;border-radius:14px;border:1px solid rgba(255,255,255,.1);display:flex;flex-direction:column;gap:7px"><div style="display:flex;justify-content:space-between;align-items:baseline;gap:8px"><div><div style="font-size:14px;font-weight:600">${fvEsc((iv.battery && iv.battery.name) || 'Batteria ' + (i + 1))}</div><div class="mono" style="font-size:10px;letter-spacing:.08em;color:rgba(255,255,255,.5)">${fvEsc((iv.name || 'Inverter ' + (i + 1)) + (v.soc != null ? ' · ' + this._f(v.soc, 0) + ' %' : ''))}</div></div><div style="text-align:right"><div style="font-size:16px;font-weight:700;color:${col}">${fvEsc(sg(v.bw))}</div><div class="mono" style="font-size:9.5px;letter-spacing:.1em;color:${col}">${v.bw > 5 ? 'IN CARICA' : v.bw < -5 ? 'IN SCARICA' : 'FERMA'}</div></div></div>
        <div style="position:relative;height:6px;border-radius:3px;background:rgba(255,255,255,.07)"><i style="position:absolute;top:0;bottom:0;left:${(v.bw >= 0 ? 50 : 50 - wd).toFixed(1)}%;width:${wd.toFixed(1)}%;background:${col};border-radius:3px"></i><b style="position:absolute;left:50%;top:-2px;bottom:-2px;width:1px;background:rgba(255,255,255,.4)"></b></div></div>`;
    }).join('');
    const sheet = pop.querySelector('.sheet'); if (sheet) { sheet.style.borderColor = vcol + '80'; sheet.style.boxShadow = '0 0 50px ' + vcol + '2e'; }
    body.innerHTML = `<div style="padding:18px 20px 22px;display:flex;flex-direction:column;gap:14px">
      <div style="display:flex;justify-content:space-between;align-items:flex-start;gap:12px"><div><div class="mono" style="font-size:11px;letter-spacing:.16em;color:rgba(255,255,255,.7)">BATTERIE · TOTALE</div><div style="font-size:12.5px;color:rgba(255,255,255,.55);margin-top:3px">${rows.length} ${rows.length === 1 ? 'batteria' : 'batterie'}, una per inverter</div></div><button type="button" class="xb" data-act="bpclose" aria-label="Chiudi">${fvIcon('x', '#fff', 16, 2)}</button></div>
      <span class="mono" style="align-self:flex-start;padding:8px 14px;border-radius:999px;border:1px solid ${vcol}66;background:${vcol}18;font-size:11px;letter-spacing:.12em;color:${vcol}">${eq ? 'IN EQUILIBRIO' : net > 0 ? 'IN CARICA' : 'IN SCARICA'}</span>
      <div style="display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:10px">${box('POTENZA NETTA', sg(net), vcol, true)}${box('CARICA MEDIA', d.soc != null ? this._f(d.soc, 0) + ' %' : '—', vcol, true)}</div>
      <div style="display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:10px">${box('ENTRA · ' + gin.length + ' batt.', gin.length ? '+' + this._fw(gin.reduce((a, x) => a + x.v.bw, 0)) : '—', C.bat, false)}${box('ESCE · ' + gout.length + ' batt.', gout.length ? '−' + this._fw(-gout.reduce((a, x) => a + x.v.bw, 0)) : '—', C.red, false)}</div>
      <div style="display:flex;flex-direction:column;gap:8px">${list}</div></div>`;
  }

  /* ---------- indicatori ---------- */
  _indVal(i) { const it = this._config.indicators[i]; return it ? this._raw(it.entity) : null; }
  _renderTiles() {
    const c = this._config; const el = this._$('tiles'); if (!el) return;
    if (!c.indicators.length) { el.innerHTML = ''; return; }
    const ring = c.indicators_look !== 'tiles';
    const items = c.indicators.map((it, i) => {
      const v = this._indVal(i); const col = fvColorOf(it, v, '#5fd0ff'); const sel = this._sel && this._sel.kind === 'ind' && this._sel.i === i;
      const mn = it.min != null && it.min !== '' ? +it.min : 0; const mx = it.max != null && it.max !== '' ? +it.max : 100;
      /* se la scala attraversa lo zero (min < 0 < max) lo zero va nel punto giusto e la barra parte da lì */
      const zc = mn < 0 && mx > 0; const z = zc ? -mn / (mx - mn) : 0; const f = v == null ? (zc ? z : 0) : fvClamp((v - mn) / ((mx - mn) || 1), 0, 1);
      const u = it.unit != null && it.unit !== '' ? it.unit : this._unit(it.entity); const txt = v == null ? '—' : this._f(v, it.decimals) + (u ? ' ' + u : '');
      const bd = sel ? col : (v != null && f > .01 ? col + '55' : 'rgba(255,255,255,.08)');
      if (ring && zc) {
        const A = (x) => (135 + 270 * x) * Math.PI / 180; const P = (x, r) => (60 + r * Math.cos(A(x))).toFixed(1) + ' ' + (60 + r * Math.sin(A(x))).toFixed(1); const d = Math.abs(f - z) < .004 ? .004 * (f >= z ? 1 : -1) : f - z; const e = z + d;
        return `<button type="button" class="rt" data-act="open" data-kind="ind" data-i="${i}" aria-label="Storico ${fvEsc(this._name(it))}" style="border-color:${bd};background:${Math.abs(f - z) > .01 ? col + '12' : 'rgba(255,255,255,.03)'};box-shadow:${sel ? '0 0 22px ' + col + '55' : 'none'}">
          <span class="rw"><svg viewBox="0 0 120 112" style="width:100%;display:block" aria-hidden="true"><path d="M27.5 92.5A46 46 0 1 1 92.5 92.5" fill="none" stroke="rgba(255,255,255,.1)" stroke-width="7" stroke-linecap="round"/><path d="M${P(z, 38)}L${P(z, 54)}" stroke="rgba(255,255,255,.45)" stroke-width="2"/><path d="M${P(z, 46)}A46 46 0 ${Math.abs(d) * 270 > 180 ? 1 : 0} ${d >= 0 ? 1 : 0} ${P(e, 46)}" fill="none" stroke="${col}" stroke-width="7" stroke-linecap="round" style="filter:drop-shadow(0 0 6px ${col})"/></svg><span class="rv">${fvEsc(txt)}</span></span>
          <span class="rl">${fvEsc(this._name(it).toUpperCase())}</span></button>`;
      }
      if (ring) {
        const ff = Math.max(.004, f); const b = (135 + 270 * ff) * Math.PI / 180; const rx = (60 + 46 * Math.cos(b)).toFixed(1); const ry = (60 + 46 * Math.sin(b)).toFixed(1);
        return `<button type="button" class="rt" data-act="open" data-kind="ind" data-i="${i}" aria-label="Storico ${fvEsc(this._name(it))}" style="border-color:${bd};background:${f > .01 ? col + '12' : 'rgba(255,255,255,.03)'};box-shadow:${sel ? '0 0 22px ' + col + '55' : 'none'}">
          <span class="rw"><svg viewBox="0 0 120 112" style="width:100%;display:block" aria-hidden="true"><path d="M27.5 92.5A46 46 0 1 1 92.5 92.5" fill="none" stroke="rgba(255,255,255,.1)" stroke-width="7" stroke-linecap="round"/><path d="M27.5 92.5A46 46 0 ${270 * ff > 180 ? 1 : 0} 1 ${rx} ${ry}" fill="none" stroke="${col}" stroke-width="7" stroke-linecap="round" style="filter:drop-shadow(0 0 6px ${col})"/></svg><span class="rv">${fvEsc(txt)}</span></span>
          <span class="rl">${fvEsc(this._name(it).toUpperCase())}</span></button>`;
      }
      return `<button type="button" class="tile" data-act="open" data-kind="ind" data-i="${i}" aria-label="Storico ${fvEsc(this._name(it))}" style="border-color:${bd};background:${sel ? col + '18' : col + '12'};box-shadow:${sel ? '0 0 22px ' + col + '55' : 'none'}">
        <span class="tl">${fvEsc(this._name(it).toUpperCase())}</span><span class="tv" style="color:${col}">${fvEsc(txt)}</span>
        <span class="tb">${zc ? `<i style="position:absolute;top:0;bottom:0;left:${(Math.min(f, z) * 100).toFixed(1)}%;width:${(Math.abs(f - z) * 100).toFixed(1)}%;background:${col}"></i><b style="position:absolute;left:${(z * 100).toFixed(1)}%;top:0;bottom:0;width:1px;background:rgba(255,255,255,.5)"></b>` : `<i style="width:${(f * 100).toFixed(1)}%;background:${col}"></i>`}</span></button>`;
    }).join('');
    el.innerHTML = `<div class="hh" style="margin-bottom:10px"><span>INDICATORI</span><span style="color:rgba(255,255,255,.5);letter-spacing:.08em;font-size:10px">TOCCA PER LO STORICO</span></div><div class="tiles ${ring ? 'rings' : ''}">${items}</div>`;
  }

  /* ---------- storico: dati ---------- */
  /* riduce i punti senza perdere i gradini: per ogni intervallo tiene primo, minimo, massimo e ultimo, in ordine di tempo */
  _decimate(a, n, t0, t1) {
    if (a.length <= n * 2) return a; const w = (t1 - t0) / n; const out = []; let i = 0;
    while (i < a.length) {
      const b = Math.max(0, Math.floor((a[i][0] - t0) / w)); let j = i; let mn = a[i][1] == null ? -1 : i; let mx = mn;
      while (j + 1 < a.length && Math.max(0, Math.floor((a[j + 1][0] - t0) / w)) === b) { j++; if (a[j][1] == null) continue; if (mn < 0 || a[j][1] < a[mn][1]) mn = j; if (mx < 0 || a[j][1] > a[mx][1]) mx = j; }
      const keep = new Set([i, j]); if (mn >= 0) { keep.add(mn); keep.add(mx); } for (let x = i; x <= j; x++) if (a[x][1] == null) keep.add(x); Array.from(keep).sort((p, q) => p - q).forEach((x) => out.push(a[x])); i = j + 1;
    }
    return out;
  }
  async _fetch(id, rg) {
    const R = FV_RANGES[rg]; const t1 = Date.now(); const t0 = t1 - R.ms; const iso = (t) => new Date(t).toISOString(); let pts = null; let lin = false;
    if (R.stats) {
      try {
        const res = await this._hass.callWS({ type: 'recorder/statistics_during_period', start_time: iso(t0), end_time: iso(t1), statistic_ids: [id], period: 'hour', types: ['mean'] });
        const arr = res && res[id];
        if (arr && arr.length) { pts = arr.map((x) => [typeof x.start === 'number' ? x.start : Date.parse(x.start), x.mean]).filter((p) => p[1] != null && !isNaN(p[0])); lin = true; }
      } catch (err) { /* ripiego sullo storico */ }
    }
    if (!pts) {
      const res = await this._hass.callWS({ type: 'history/history_during_period', start_time: iso(t0), end_time: iso(t1), entity_ids: [id], include_start_time_state: true, minimal_response: true, no_attributes: true, significant_changes_only: false });
      const arr = (res && res[id]) || [];
      pts = arr.map((x) => [Math.max(t0, x.lu != null ? x.lu * 1000 : Date.parse(x.last_updated)), parseFloat(x.s != null ? x.s : x.state)]).filter((p) => !isNaN(p[0])).map((p) => [p[0], isNaN(p[1]) ? null : p[1]]);
    }
    const u = this._unit(id); const k = u === 'kW' ? 1000 : 1; if (k !== 1) pts = pts.map((p) => [p[0], p[1]]);
    pts.sort((p, q) => p[0] - q[0]);
    return { pts: lin ? pts : this._decimate(pts, 500, t0, t1), t0, t1, lin };
  }
  _need(id, rg) {
    if (!id || !this._hass) return; const k = id + '|' + rg; if (this._cache[k] || this._loading[k]) return; this._loading[k] = true;
    this._fetch(id, rg).then((r) => { this._cache[k] = r; }).catch(() => { const t1 = Date.now(); this._cache[k] = { pts: [], t0: t1 - FV_RANGES[rg].ms, t1 }; })
      .then(() => { delete this._loading[k]; this._paint('p'); this._paint('h'); });
  }
  _loadAll() {
    const spec = this._panelSpec(); if (spec) spec.ents.forEach((e) => this._need(e, this._prng));
    this._config.history.series.forEach((s) => this._need(s.entity, this._hrng));
  }

  /* ---------- storico: disegno ---------- */
  _tfmt(t, rg) {
    const o = rg === '24h' ? { hour: '2-digit', minute: '2-digit' } : { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' };
    return new Date(t).toLocaleString(this._lang(), o);
  }
  /* serie di un grafico: entità diretta, oppure corrente = potenza / tensione, oppure somma di più entità */
  _series(s, rg) {
    const K = (e) => this._cache[e + '|' + rg]; let c = null; let pts = [];
    if (s.derive && s.derive.type === 'sum') {
      const cs = s.derive.ents.map(K);
      if (cs.every(Boolean)) {
        c = cs[0]; const times = Array.from(new Set([].concat(...cs.map((x) => x.pts.map((p) => p[0]))))).sort((a, b) => a - b); const ix = cs.map(() => 0); const last = cs.map(() => null);
        times.forEach((t) => { cs.forEach((x, k) => { while (ix[k] < x.pts.length && x.pts[ix[k]][0] <= t) { last[k] = x.pts[ix[k]][1]; ix[k]++; } }); pts.push([t, last.some((v) => v != null) ? last.reduce((a, v) => a + (v || 0), 0) : null]); });
      }
    } else if (s.derive) {
      const cp = K(s.derive.p); const cv = K(s.derive.v);
      if (cp && cv) {
        c = cp; const kp = this._unit(s.derive.p) === 'kW' ? 1000 : 1; const vs = cv.pts.filter((x) => x[1] != null); let j = 0;
        pts = cp.pts.map((p) => { if (p[1] == null) return [p[0], null]; while (j + 1 < vs.length && vs[j + 1][0] <= p[0]) j++; const v = vs.length ? vs[j][1] : null; return [p[0], v > 20 ? p[1] * kp / v : null]; });
      }
    } else { c = K(s.entity); pts = c ? c.pts : []; }
    if (s.neg) pts = pts.map((p) => [p[0], p[1] == null ? null : -p[1]]);
    return { c, pts };
  }
  _model(list, rg, o) {
    const R = FV_RANGES[rg]; let t1 = Date.now(); let t0 = t1 - R.ms; let lo = Infinity; let hi = -Infinity; let any = false;
    const series = list.map((s) => {
      const r = this._series(s, rg); const c = r.c; const pts = r.pts; if (c) { t0 = c.t0; t1 = c.t1; }
      pts.forEach((p) => { if (p[1] == null) return; if (p[1] < lo) lo = p[1]; if (p[1] > hi) hi = p[1]; any = true; });
      return Object.assign({}, s, { pts, lin: !!(c && c.lin) });
    });
    if (!any) return { t0, t1, series, empty: true, loading: list.some((s) => (s.derive ? s.derive.ents : [s.entity]).some((e) => this._loading[e + '|' + rg])) };
    if (o.pct) { lo = 0; hi = 100; } else {
      const nonneg = lo >= 0;
      if (o.zero) { lo = Math.min(lo, 0); hi = Math.max(hi, 0); }
      const pad = (hi - lo) * .12 || 1; lo = lo - pad; if (nonneg && !o.zero) lo = Math.max(0, lo); hi += pad;
    }
    const n = o.ticks || 4; const ticks = [];
    if (o.pct) { for (let k = 0; k < n; k++) ticks.push(lo + (hi - lo) * k / (n - 1)); }
    else {
      const raw = (hi - lo) / (n - 1); const mag = Math.pow(10, Math.floor(Math.log10(raw))); const nf = raw / mag; const st = (nf <= 1 ? 1 : nf <= 2 ? 2 : nf <= 5 ? 5 : 10) * mag;
      lo = Math.floor(lo / st) * st; const k = Math.max(1, Math.ceil((hi - lo) / st - 1e-9)); hi = lo + st * k;
      for (let j = 0; j <= k; j++) ticks.push(lo + st * j);
    }
    return { t0, t1, series, lo, hi, ticks, rg };
  }
  _xlabels(m) {
    const n = 5; const out = [];
    for (let k = 0; k < n; k++) {
      const t = m.t0 + (m.t1 - m.t0) * k / (n - 1);
      out.push(m.rg === '24h' ? new Date(t).toLocaleTimeString(this._lang(), { hour: '2-digit', minute: '2-digit' }) : new Date(t).toLocaleDateString(this._lang(), { day: '2-digit', month: '2-digit' }));
    }
    return out;
  }
  _paint(kind) {
    const yax = this._$(kind + 'y'); const plot = this._$(kind + 'p'); const xl = this._$(kind + 'x'); if (!yax || !plot || !xl) return;
    let m; let H; let o = {}; let extra = {};
    if (kind === 'p') {
      const spec = this._panelSpec(); if (!spec) return;
      H = 170; o = { pct: spec.unit === '%', ticks: spec.unit === '%' ? 5 : 4, zero: !!spec.bi };
      m = this._model([{ entity: spec.entity, derive: spec.derive, neg: spec.neg, color: spec.col, name: spec.name, unit: spec.unit, dec: spec.dec }], this._prng, o);
      extra = { spec };
    } else {
      const h = this._config.history; H = 240; o = { zero: true, ticks: 7 };
      m = this._model(h.series.filter((s) => s.entity).map((s, k) => ({ entity: s.entity, color: fvHex(s.color, ['#5fd0ff', '#ffb43a', '#6f9bff', '#2ee87a', '#ff8a5c', '#b28cff'][k % 6]), name: this._name(s), unit: this._unit(s.entity), dec: 0 })), this._hrng, o);
    }
    if (m.empty) { yax.innerHTML = ''; xl.innerHTML = ''; this._cm[kind] = null; plot.innerHTML = `<svg viewBox="0 0 600 ${H}" preserveAspectRatio="none" style="height:${kind === 'h' ? (this._config.history.height || 260) : H}px"></svg><div class="nod">${m.loading ? 'Carico lo storico…' : 'Nessun dato nel periodo'}</div>`; return; }
    const W = 600; const Y = (v) => H - 5 - (v - m.lo) / (m.hi - m.lo) * (H - 10); const X = (t) => (t - m.t0) / (m.t1 - m.t0) * W;
    let svg = m.ticks.map((t) => `<line x1="0" x2="${W}" y1="${Y(t).toFixed(1)}" y2="${Y(t).toFixed(1)}" stroke="rgba(255,255,255,.07)" stroke-width="1" vector-effect="non-scaling-stroke"/>`).join('');
    if ((kind === 'h' || (extra.spec && extra.spec.bi)) && m.lo < 0 && m.hi > 0) svg += `<line x1="0" x2="${W}" y1="${Y(0).toFixed(1)}" y2="${Y(0).toFixed(1)}" stroke="rgba(255,255,255,.25)" stroke-width="1" vector-effect="non-scaling-stroke"/>`;
    let stroke = null;
    if (kind === 'p' && m.rg !== '24h') for (let d = 1; d < 7; d++) { const x = (d / 7 * W).toFixed(1); svg += `<line x1="${x}" x2="${x}" y1="0" y2="${H}" stroke="rgba(255,255,255,.05)" stroke-width="1" vector-effect="non-scaling-stroke"/>`; }
    if (kind === 'p' && extra.spec.bands && extra.spec.bands.on) {
      const bands = [{ f: -Infinity, c: extra.spec.bands.base }].concat(extra.spec.bands.rows); const cl = (q) => fvClamp(q, 0, H); let stops = '';
      for (let k = bands.length - 1; k >= 0; k--) {
        const top = k + 1 < bands.length ? cl(Y(bands[k + 1].f)) : 0; const bot = k === 0 ? H : cl(Y(bands[k].f));
        stops += `<stop offset="${(top / H * 100).toFixed(2)}%" stop-color="${bands[k].c}"/><stop offset="${(bot / H * 100).toFixed(2)}%" stop-color="${bands[k].c}"/>`;
      }
      svg = `<defs><linearGradient id="fvtg" gradientUnits="userSpaceOnUse" x1="0" y1="0" x2="0" y2="${H}">${stops}</linearGradient></defs>` + svg;
      bands.slice(1).filter((b) => b.f > m.lo && b.f < m.hi).forEach((b) => { svg += `<line x1="0" x2="${W}" y1="${Y(b.f).toFixed(1)}" y2="${Y(b.f).toFixed(1)}" stroke="${b.c}" stroke-opacity=".55" stroke-width="1" stroke-dasharray="5 5" vector-effect="non-scaling-stroke"/>`; });
      stroke = 'url(#fvtg)';
    }
    const base0 = kind === 'p' ? Y(Math.max(m.lo, 0)) : Y(0);
    m.series.forEach((s) => {
      if (!s.pts.length) return; const segs = []; let cur = null; let prev = null;
      /* lo storico registra solo i cambi di stato: il valore resta invariato fino al cambio successivo (gradino, non rampa); i periodi "non disponibile" restano vuoti */
      s.pts.forEach((p) => {
        if (p[1] == null) { if (cur) { if (!s.lin && prev) cur.push([X(p[0]), Y(prev[1])]); segs.push(cur); cur = null; } prev = null; return; }
        if (!cur) cur = []; if (s.lin) cur.push([X(p[0]), Y(p[1])]); else { if (prev) cur.push([X(p[0]), Y(prev[1])]); cur.push([X(p[0]), Y(p[1])]); } prev = p;
      });
      if (cur) { if (!s.lin && prev && prev[0] < m.t1) cur.push([X(m.t1), Y(prev[1])]); segs.push(cur); }
      segs.forEach((q) => {
      if (!q.length) return; const pts = q.map((p) => p[0].toFixed(1) + ',' + p[1].toFixed(1)).join(' ');
      if (kind === 'p' || (this._config.history.look === 'areas')) svg += `<polygon points="${q[0][0].toFixed(1)},${base0.toFixed(1)} ${pts} ${q[q.length - 1][0].toFixed(1)},${base0.toFixed(1)}" fill="${stroke || s.color}" fill-opacity="${kind === 'p' ? .14 : .1}"/>`;
      svg += `<polyline points="${pts}" fill="none" stroke="${stroke || s.color}" stroke-width="${kind === 'p' ? 2 : 1.8}" stroke-linejoin="round" vector-effect="non-scaling-stroke"/>`;
      });
    });
    const hpx = kind === 'p' ? 170 : (this._config.history.height || 260);
    const fmt = (v) => this._f(v, m.series[0].dec != null && kind === 'p' ? (m.series[0].dec === '' ? null : m.series[0].dec) : 0);
    yax.style.height = hpx + 'px';
    yax.innerHTML = m.ticks.map((t) => `<span style="top:${(Y(t) / H * 100).toFixed(2)}%">${kind === 'p' ? fvEsc(this._fmtv(t, m.series[0])) : fvEsc(fmt(t))}</span>`).join('');
    plot.innerHTML = `<svg viewBox="0 0 ${W} ${H}" preserveAspectRatio="none" style="height:${hpx}px" aria-hidden="true">${svg}</svg><span class="cur"></span>${m.series.map((s) => `<span class="dot" style="background:${s.color};box-shadow:0 0 10px ${s.color}"></span>`).join('')}<span class="tip"></span>`;
    xl.innerHTML = this._xlabels(m).map((x) => `<span>${x}</span>`).join('');
    this._cm[kind] = { m, Y, H };
    if (kind === 'p') this._patchStats(m);
  }
  _patchStats(m) {
    const el = this._$('pst'); if (!el) return; const s = m.series[0]; const v = s.pts.map((p) => p[1]).filter((x) => x != null); if (!v.length) { el.innerHTML = ''; return; }
    const f = (x) => this._fmtv(x, s); const avg = v.reduce((a, b) => a + b, 0) / v.length;
    el.innerHTML = [['MIN', Math.min(...v)], ['MEDIA', avg], ['MAX', Math.max(...v)]].map(([l, x]) => `<div><span>${l}</span><b>${fvEsc(f(x))}</b></div>`).join('');
  }
  _plotOf(e) { const p = e.composedPath ? e.composedPath() : []; return p.find((n) => n && n.classList && n.classList.contains('cplot')); }
  _pmove(e) {
    const pl = this._plotOf(e); if (!pl) return; const kind = pl.dataset.k; const cm = this._cm[kind]; if (!cm) return;
    const r = pl.getBoundingClientRect(); if (!r.width) return; const f = fvClamp((e.clientX - r.left) / r.width, 0, 1); const m = cm.m; const t = m.t0 + f * (m.t1 - m.t0);
    const cur = pl.querySelector('.cur'); const dots = pl.querySelectorAll('.dot'); const tip = pl.querySelector('.tip'); if (!cur || !tip) return;
    cur.style.display = 'block'; cur.style.left = (f * 100) + '%'; let rows = '';
    m.series.forEach((s, k) => {
      const a = s.pts; if (!a.length) { dots[k].style.display = 'none'; return; }
      let lo = 0; let hi = a.length - 1; while (lo < hi) { const mid = (lo + hi + 1) >> 1; if (a[mid][0] <= t) lo = mid; else hi = mid - 1; }
      const v = a[lo][1]; const d = dots[k]; if (v == null) { d.style.display = 'none'; rows += `<span class="tr"><i style="background:${s.color}"></i><span style="flex:1;color:rgba(255,255,255,.8)">${fvEsc(s.name)}</span><b style="color:rgba(255,255,255,.5)">non disp.</b></span>`; return; } d.style.display = 'block'; d.style.left = (f * 100) + '%'; d.style.top = (cm.Y(v) / cm.H * 100).toFixed(2) + '%';
      const sp = kind === 'p' ? this._panelSpec() : null; const colr = sp ? fvColorOf(sp.ind, v, sp.col) : s.color;
      d.style.background = colr; d.style.boxShadow = '0 0 10px ' + colr;
      rows += `<span class="tr"><i style="background:${colr}"></i><span style="flex:1;color:rgba(255,255,255,.8)">${fvEsc(s.name)}</span><b style="color:${colr}">${fvEsc(kind === 'p' ? this._fmtv(v, s) : this._f(v, s.dec === '' ? null : s.dec) + (s.unit ? ' ' + s.unit : ''))}</b></span>`;
    });
    tip.innerHTML = `<span class="tt">${fvEsc(this._tfmt(t, m.rg))}</span>${rows}`;
    tip.style.display = 'flex'; tip.style.left = (f * 100) + '%'; tip.style.transform = f < .15 ? 'translateX(10px)' : f > .85 ? 'translateX(calc(-100% - 10px))' : 'translateX(-50%)';
  }
  _pleave(e) {
    const pl = this._plotOf(e); if (!pl) return;
    pl.querySelectorAll('.dot').forEach((d) => { d.style.display = 'none'; }); const c = pl.querySelector('.cur'); const t = pl.querySelector('.tip'); if (c) c.style.display = 'none'; if (t) t.style.display = 'none';
  }

  /* ---------- pannello dello storico (indicatore, fonte, batteria, utenza) ---------- */
  _pmet(e, x) { return e ? Object.assign({ id: 'w', label: 'POTENZA', entity: e }, x || {}) : null; }
  _vmet(e) { return e ? { id: 'v', label: 'TENSIONE', entity: e, unit: this._unit(e) || 'V' } : null; }
  _smet(e, label) { return e ? { id: 's', label: label || 'SOC', entity: e, unit: this._unit(e) || '%', dec: 0 } : null; }
  /* corrente: dall'entità se c'è, altrimenti potenza / tensione */
  _amet(a, p, v) { if (a) return { id: 'a', label: 'CORRENTE', entity: a, unit: this._unit(a) || 'A' }; return p && v ? { id: 'a', label: 'CORRENTE', derive: { type: 'ratio', p, v, ents: [p, v] }, unit: 'A', dec: 1 } : null; }
  _biGrid() { return { p: { c: FV_COL.rete, l: 'PRELIEVO DALLA RETE' }, n: { c: FV_COL.red, l: 'IMMISSIONE IN RETE' } }; }
  _biBat(bc) { const pos = !bc || bc.charging_positive !== false; return pos ? { p: { c: FV_COL.bat, l: 'IN CARICA' }, n: { c: FV_COL.red, l: 'IN SCARICA' } } : { p: { c: FV_COL.red, l: 'IN SCARICA' }, n: { c: FV_COL.bat, l: 'IN CARICA' } }; }
  _solMets(s) { return [this._pmet(s.entity), this._vmet(s.voltage_entity), this._amet(s.current_entity, s.entity, s.voltage_entity)]; }
  _batMets(bc) { return [this._pmet(bc.entity, { bi: this._biBat(bc) }), this._smet(bc.soc_entity)]; }
  _specVal(sp) {
    let v;
    if (sp.derive && sp.derive.type === 'sum') v = sp.derive.ents.reduce((a, e) => a + (this._raw(e) || 0), 0);
    else if (sp.derive) { const p = this._pw(sp.derive.p); const u = this._raw(sp.derive.v); v = p != null && u > 20 ? p / u : null; }
    else v = this._raw(sp.entity);
    return v == null ? null : (sp.neg ? -v : v);
  }
  _fmtv(v, s) { if (v == null) return '—'; if (s.unit === 'W') return this._fw(v); return this._f(v, s.dec === '' ? null : s.dec) + (s.unit ? ' ' + s.unit : ''); }
  _mkSpec(name, sub, col, mets) {
    mets = mets.filter(Boolean); if (!mets.length) return null;
    const m = mets.find((x) => x.id === this._met) || mets[0];
    const ents = m.derive ? m.derive.ents : [m.entity];
    const sp = { entity: m.entity || ents[0], ents, derive: m.derive || null, neg: !!m.neg, name, sub: sub || '', unit: m.unit != null ? m.unit : this._unit(m.entity || ents[0]), dec: m.dec != null ? m.dec : '', col: m.col || col, bands: null, ind: null, bi: m.bi || null, tabs: mets.length > 1 ? mets.map((x) => ({ id: x.id, label: x.label })) : [], met: m.id };
    if (m.bi) { sp.ind = { color: m.bi.n.c, thresholds: [{ value: 0, color: m.bi.p.c }] }; sp.bands = fvBands(sp.ind, m.bi.p.c); sp.col = fvColorOf(sp.ind, this._specVal(sp), m.bi.p.c); }
    return sp;
  }
  _panelSpec() {
    const s = this._sel; if (!s) return null; const c = this._config; const C = FV_COL;
    if (s.kind === 'ind') {
      const it = c.indicators[s.i]; if (!it || !it.entity) return null; const v = this._raw(it.entity); const b = fvBands(it, '#5fd0ff');
      return { entity: it.entity, ents: [it.entity], name: this._name(it), sub: '', tabs: [], unit: it.unit != null && it.unit !== '' ? it.unit : this._unit(it.entity), dec: it.decimals != null ? it.decimals : '', col: fvColorOf(it, v, '#5fd0ff'), bands: b, ind: it };
    }
    if (s.kind === 'src') {
      const bi = s.i === 5 ? 1 : 0; const bcfg = bi ? c.battery2 : c.battery;
      if (s.i === 0) { const nm = this._smp().length > 1 ? (c.solar.name && c.solar.name !== 'Solare' ? c.solar.name : 'MPPT 1') : (c.solar.name || 'Solare'); return this._mkSpec(nm, this._smp().length > 1 ? 'INGRESSO SOLARE' : (c.solar.sub || ''), C.sol, this._solMets(c.solar)); }
      if (s.i >= 7 && s.i <= 9) { const mk = { 7: 'mppt2', 8: 'mppt3', 9: 'mppt4' }[s.i]; return this._mkSpec(c.solar[mk].name || 'MPPT ' + (s.i - 5), 'INGRESSO SOLARE', C.sol, this._solMets(c.solar[mk])); }
      if (s.i === 1) return this._mkSpec(c.grid.name || 'Rete', this._flowData().volt != null ? this._f(this._flowData().volt) + ' ' + this._flowData().vu : '', C.rete, [this._pmet(c.grid.entity, { bi: this._biGrid(), neg: c.grid.import_positive === false }), this._vmet(c.grid.voltage_entity)]);
      if (s.i === 3) return this._mkSpec(c.home.name || 'Casa', '', C.casa, [this._pmet(c.home.entity)]);
      if (s.i === 2 || s.i === 5) return this._mkSpec(this._batName(bi), '', C.bat, this._batMets(bcfg));
      return null;
    }
    if (s.kind === 'load') {
      const l = c.loads[s.i]; if (!l || !l.entity) return null;
      return this._mkSpec(this._name(l), l.sub || '', C.ind, [this._pmet(l.entity), this._smet(l.soc_entity, 'SOC AUTO')]);
    }
    if (s.kind === 'mx') return this._mxSpec(s.key);
    if (s.kind === 'sub') { const par = this._subParent(s.key); if (!par) return null; const x = this._subs(par.l)[s.i]; if (!x) return null; return this._mkSpec(this._name(par.l) + ' · ' + x.name, 'SOTTOCARICO', C.ind, [this._pmet(x.entity)]); }
    return null;
  }
  _mxSpec(key) {
    const c = this._config; const C = FV_COL; const p = String(key).split('-'); const t = p[0]; const i = +p[1]; const iv = c.inverters[i];
    if (t === 'r') {
      const ents = c.inverters.map((v) => v.phase && v.phase.entity).filter(Boolean); const neg = c.grid.import_positive === false;
      const w = c.grid.entity ? this._pmet(c.grid.entity, { bi: this._biGrid(), neg }) : (ents.length ? { id: 'w', label: 'POTENZA', derive: { type: 'sum', ents }, unit: this._unit(ents[0]) || 'W', bi: this._biGrid() } : null);
      return this._mkSpec(c.grid.name || 'Rete Enel', c.inverters.length === 3 ? 'TRIFASE' : '', C.rete, [w]);
    }
    if (!iv) return null; const ivn = iv.name || 'Inverter ' + (i + 1);
    if (t === 'f') { const ph = iv.phase || {}; return this._mkSpec(ph.name || 'Fase L' + (i + 1), ivn, C.rete, [this._pmet(ph.entity, { bi: this._biGrid(), neg: ph.import_positive === false }), this._vmet(ph.voltage_entity)]); }
    if (t === 'm') { const j = +p[2]; const m = this._mppts(iv)[j]; if (!m) return null; return this._mkSpec(m.name || 'MPPT ' + (j + 1), ivn + ' · INGRESSO SOLARE', C.sol, this._solMets(m)); }
    if (t === 'c') { const h = iv.home || {}; return this._mkSpec(h.name || 'Casa ' + (i + 1), ivn, C.casa, [this._pmet(h.entity)]); }
    if (t === 'b') { const b = iv.battery || {}; return this._mkSpec(b.name || 'Batteria ' + (i + 1), ivn, C.bat, this._batMets(b)); }
    if (t === 'l') { const l = (iv.loads || [])[+p[2]]; if (!l || !l.entity) return null; return this._mkSpec(this._name(l), ivn + (l.sub ? ' · ' + l.sub : ''), C.ind, [this._pmet(l.entity), this._smet(l.soc_entity, 'SOC AUTO')]); }
    return null;
  }
  _panelHost() { const s = this._sel; return this._$(s && s.kind !== 'ind' ? 'cpanel' : 'panel'); }
  _renderPanel() {
    const el = this._panelHost(); if (!el) return; const sp = this._panelSpec();
    if (!sp) { el.innerHTML = ''; return; }
    const rg = (r) => `<button type="button" class="pill ${this._prng === r ? 'on' : ''}" data-act="range" data-t="p" data-r="${r}">${FV_RANGES[r].label.replace(' ', '')}</button>`;
    const thl = !sp.bi && sp.bands && sp.bands.on ? `<div class="thl"><span style="letter-spacing:.14em;color:rgba(255,255,255,.5)">SOGLIE</span><span><i style="background:${sp.bands.base}"></i>&lt; ${fvEsc(this._f(sp.bands.rows[0].f))}</span>${sp.bands.rows.map((r) => `<span><i style="background:${r.c}"></i>≥ ${fvEsc(this._f(r.f))}${sp.unit ? ' ' + fvEsc(sp.unit) : ''}</span>`).join('')}</div>` : '';
    const tabs = sp.tabs.length ? `<div class="pills" style="align-self:flex-start;flex-wrap:wrap">${sp.tabs.map((t) => `<button type="button" class="pill ${sp.met === t.id ? 'on' : ''}" data-act="met" data-m="${t.id}">${fvEsc(t.label)}</button>`).join('')}</div>` : '';
    const bil = sp.bi ? `<div class="bil"><span style="color:${sp.bi.p.c}">▲ ${fvEsc(sp.bi.p.l)}</span><span style="color:${sp.bi.n.c}">▼ ${fvEsc(sp.bi.n.l)}</span></div>` : '';
    el.innerHTML = `<div class="pnl" style="border-color:${sp.col}77;background:linear-gradient(180deg,${sp.col}14,rgba(8,12,20,.6));box-shadow:0 0 30px ${sp.col}22">
      <div class="ph"><div style="display:flex;flex-direction:column;gap:2px"><span class="pl">${fvEsc(sp.name.toUpperCase())}</span>${sp.sub ? `<span class="tip0">${fvEsc(sp.sub)}</span>` : ''}<span class="pv" data-live="1" style="color:${sp.col}"></span></div>
      <div style="display:flex;align-items:center;gap:8px"><div class="pills">${rg('24h')}${rg('7g')}</div><button type="button" class="xb" data-act="close" aria-label="Chiudi storico">${fvIcon('x', '#fff', 16, 2)}</button></div></div>
      ${tabs}${bil}<div class="plotw"><div class="yax" id="py" style="height:170px"></div><div class="pc"><div class="cplot" id="pp" data-k="p" style="height:170px"></div><div class="xl" id="px"></div></div></div>${thl}<div class="stats" id="pst"></div></div>`;
    this._patchPanel(); this._paint('p');
  }
  _patchPanel() {
    const sp = this._panelSpec(); const inl = this._$('panel'); const mod = this._$('cpanel'); const pop = this._$('cpop'); if (!inl || !mod) return;
    const useMod = !!(sp && this._sel && this._sel.kind !== 'ind'); const el = useMod ? mod : inl; const other = useMod ? inl : mod;
    if (other.innerHTML) { if (other === mod) { clearTimeout(this._ct); this._ct = setTimeout(() => { if (!(pop && pop.classList.contains('on'))) mod.innerHTML = ''; }, 520); } else other.innerHTML = ''; } this._popOn(pop, useMod);
    if (!sp) { if (el.innerHTML) el.innerHTML = ''; this._pkey = null; return; }
    const key = JSON.stringify(this._sel) + this._prng + this._met + sp.col;
    if (this._pkey !== key) { this._pkey = key; this._renderPanel(); return; }
    if (useMod) { const sh = pop && pop.querySelector('.sheet'); if (sh) { sh.style.borderColor = sp.col + '80'; sh.style.boxShadow = '0 0 50px ' + sp.col + '33'; } }
    const lv = el.querySelector('[data-live]'); if (!lv) return; const v = this._specVal(sp);
    lv.textContent = this._fmtv(v, sp); lv.style.color = sp.col;
  }

  /* ---------- storico potenze ---------- */
  _renderHist() {
    const el = this._$('hist'); if (!el) return; const h = this._config.history; const list = h.series.filter((s) => s.entity);
    if (!list.length) { el.innerHTML = `<div class="box"><div class="hh"><span>${fvEsc(h.title || 'STORICO')}</span></div><div class="empty" style="margin-top:12px">Aggiungi le serie del grafico dall'editor.</div></div>`; return; }
    const rg = (r) => `<button type="button" class="pill ${this._hrng === r ? 'on' : ''}" data-act="range" data-t="h" data-r="${r}">${FV_RANGES[r].label.replace(' ', '')}</button>`;
    const cols = ['#5fd0ff', '#ffb43a', '#6f9bff', '#2ee87a', '#ff8a5c', '#b28cff'];
    const hp = h.height || 260;
    el.innerHTML = `<div class="box" style="display:flex;flex-direction:column;gap:12px"><div class="hh"><span>${fvEsc(h.title || 'STORICO')} · ${fvEsc({ '24h': 'ULTIME 24 ORE', '7g': 'ULTIMI 7 GIORNI', '30g': 'ULTIMI 30 GIORNI' }[this._hrng])}</span><div class="pills">${h.ranges.map(rg).join('')}</div></div>
      <div class="leg" id="hl">${h.series.filter((s) => s.entity).map((s, k) => `<span><i style="background:${fvHex(s.color, cols[k % 6])}"></i>${fvEsc(this._name(s))}<b data-now="${k}" style="color:${fvHex(s.color, cols[k % 6])};font-weight:500"></b></span>`).join('')}</div>
      <div class="plotw"><div class="yax" id="hy" style="height:${hp}px;width:52px"></div><div class="pc"><div class="cplot" id="hp" data-k="h" style="height:${hp}px"></div><div class="xl" id="hx"></div></div></div></div>`;
    this._patchLegend(); this._paint('h');
  }
  _patchLegend() {
    const el = this._$('hl'); if (!el) return; const list = this._config.history.series.filter((s) => s.entity);
    el.querySelectorAll('[data-now]').forEach((b) => {
      const s = list[+b.dataset.now]; if (!s) return; const v = this._raw(s.entity); const u = this._unit(s.entity);
      b.textContent = v == null ? '' : this._f(v, 0) + (u ? ' ' + u : '');
    });
  }

  /* ---------- inverter ---------- */
  /* impostazioni inverter in uso: quelle dell'inverter aperto (multi inverter) oppure quelle generali */
  _ax() { const c = this._config; return this._axi != null && c.inverters[this._axi] ? c.inverters[this._axi].axpert : c.axpert; }
  _lockCfg() { const lk = this._config.axpert.lock; return { on: !!(lk.enabled && String(lk.pin || '').length), pin: String(lk.pin || ''), sec: Math.max(5, +lk.seconds || 30), pc: lk.protect_controls !== false, ps: lk.protect_switches !== false }; }
  _locked(kind) { const k = this._lockCfg(); return k.on && (kind === 'sw' ? k.ps : k.pc) && this._lock.left <= 0; }
  _guard(kind, run) {
    const k = this._lockCfg(); if (!k.on || !(kind === 'sw' ? k.ps : k.pc)) { run(); return; }
    if (this._lock.left > 0) { this._lock.left = k.sec; run(); return; }
    this._pend = run; this._lock = { left: 0, ask: true, pin: '', err: false, want: kind }; this._sigs.axp = null; this._update();
  }
  _startTimer() {
    clearInterval(this._iv);
    this._iv = setInterval(() => {
      this._lock.left--; const e = this.shadowRoot.querySelector('[data-left]');
      if (this._lock.left <= 0) { clearInterval(this._iv); this._lock.left = 0; this._sigs.axp = null; this._update(); } else if (e) e.textContent = this._lock.left;
    }, 1000);
  }
  _key(d) {
    const k = this._lockCfg(); const L = this._lock;
    if (d === 'x') { this._pend = null; this._lock = { left: 0, ask: false, pin: '', err: false, want: null }; }
    else if (d === 'b') { L.pin = L.pin.slice(0, -1); L.err = false; }
    else {
      L.pin += d; L.err = false;
      if (L.pin.length >= k.pin.length) {
        if (L.pin === k.pin) { const run = this._pend; this._pend = null; this._lock = { left: k.sec, ask: false, pin: '', err: false, want: null }; this._startTimer(); if (run) run(); }
        else { L.pin = ''; L.err = true; }
      }
    }
    this._sigs.axp = null; this._update();
  }
  _fid(it) { const st = this._st(it.entity); return { st, dead: !st || st.state === 'unavailable' || st.state === 'unknown' }; }
  _renderAxp() {
    const el = this._$('axp'); if (!el) return; const ax = this._ax(); const lk = this._lockCfg(); const L = this._lock; const O = FV_COL.axp;
    const lockI = (s) => fvIcon('lock', 'rgba(255,255,255,.65)', s || 16, 2);
    const nm = { ctl: 'MODIFICARE LE IMPOSTAZIONI', sw: 'COMANDARE GLI INTERRUTTORI' };
    let keypad = '';
    if (lk.on && L.ask) {
      const dots = Array.from({ length: lk.pin.length }, (_, i) => `<i style="${i < L.pin.length ? 'background:' + (L.err ? '#ff5a5a' : O) + ';' : ''}${L.err ? 'border-color:#ff5a5a' : ''}"></i>`).join('');
      const keys = ['1', '2', '3', '4', '5', '6', '7', '8', '9'].map((d) => `<button type="button" data-act="key" data-d="${d}">${d}</button>`).join('') + '<button type="button" data-act="key" data-d="x" aria-label="Annulla">✕</button><button type="button" data-act="key" data-d="0">0</button><button type="button" data-act="key" data-d="b" aria-label="Cancella">⌫</button>';
      keypad = `<div class="kp"><span class="kt">PASSWORD PER ${nm[L.want] || nm.ctl}</span><div class="kd">${dots}</div><span class="ke">${L.err ? 'PASSWORD ERRATA' : ''}</span><div class="kg">${keys}</div></div>`;
    }
    let status = '';
    if (lk.on && !L.ask) status = L.left > 0 ? `<div class="unl"><span>SBLOCCATO · SI RIBLOCCA TRA <b data-left="1" style="font-weight:500">${L.left}</b> s</span><button type="button" data-act="relock">BLOCCA</button></div>` : `<div class="lkr">${lockI(14)}IMPOSTAZIONI E INTERRUTTORI PROTETTI DA PASSWORD</div>`;
    const lc = this._locked('ctl'); const ls = this._locked('sw'); const dead = ax.controls.concat(ax.switches).filter((i) => i.entity);
    const online = !dead.length || dead.some((i) => !this._fid(i).dead);
    const ctl = ax.controls.map((it, i) => {
      if (!it.entity) return ''; const { st, dead: dd } = this._fid(it); const name = this._name(it); const dom = fvDomain(it.entity); const a = (st && st.attributes) || {};
      if (dom === 'number' || dom === 'input_number') {
        const v = this._raw(it.entity); const u = a.unit_of_measurement || '';
        return `<div class="stp" ${dd ? 'style="opacity:.55"' : ''}><div style="justify-content:space-between"><span class="lab">${fvEsc(name.toUpperCase())}</span>${lc ? lockI() : ''}</div><div><button type="button" data-act="step" data-i="${i}" data-d="-1" aria-label="Diminuisci">−</button><b>${v == null ? '—' : fvEsc(this._f(v) + (u ? ' ' + u : ''))}</b><button type="button" data-act="step" data-i="${i}" data-d="1" aria-label="Aumenta">+</button></div></div>`;
      }
      const opts = Array.isArray(a.options) ? a.options : []; const cur = st ? st.state : '';
      if ((it.display === 'segments' || (it.display !== 'dropdown' && opts.length > 0 && opts.length <= 3)) && opts.length) {
        return `<div style="display:flex;flex-direction:column;gap:6px;${dd ? 'opacity:.55' : ''}"><span class="lab" style="display:flex;justify-content:space-between">${fvEsc(name.toUpperCase())}${lc ? lockI() : ''}</span><div class="seg" style="grid-template-columns:repeat(${opts.length},minmax(0,1fr))">${opts.map((o) => `<button type="button" class="${o === cur ? 'on' : ''}" data-act="opt" data-i="${i}" data-v="${fvEsc(o)}">${fvEsc(o)}</button>`).join('')}</div></div>`;
      }
      return `<label class="fld" ${dd ? 'style="opacity:.55"' : ''}><span class="lab">${fvEsc(name.toUpperCase())}</span>${lc ? `<button type="button" class="ov" data-act="ask" data-kind="ctl" aria-label="Sblocca con password per modificare"></button><span class="lk">${lockI()}</span>` : ''}<select data-act="sel" data-i="${i}">${opts.map((o) => `<option value="${fvEsc(o)}" ${o === cur ? 'selected' : ''}>${fvEsc(o)}</option>`).join('') || `<option>${fvEsc(cur || '—')}</option>`}</select></label>`;
    }).join('');
    const sws = ax.switches.map((it, i) => {
      if (!it.entity) return ''; const { st, dead: dd } = this._fid(it); const on = st && st.state === 'on';
      return `<button type="button" class="sw" data-act="tog" data-i="${i}" style="border-color:${on ? O + '80' : 'rgba(255,255,255,.1)'};background:${on ? O + '1a' : 'rgba(255,255,255,.03)'};box-shadow:${on ? '0 0 22px ' + O + '29' : 'none'};opacity:${dd ? .55 : 1}">
        <span class="ib" style="border-color:${on ? O + '80' : 'rgba(255,255,255,.1)'}">${fvIcon(it.icon || 'bolt', on ? O : 'rgba(255,255,255,.6)', 20, 1.8)}</span>
        <span class="sn"><b>${fvEsc(this._name(it))}</b><i style="color:${on ? O : 'rgba(255,255,255,.6)'}">${dd ? 'NON DISPONIBILE' : on ? 'ATTIVO' : 'SPENTO'}</i></span>${ls ? lockI(18) : ''}<span class="tg ${on ? 'on' : ''}" style="background:${on ? O : 'rgba(255,255,255,.18)'}"></span></button>`;
    }).join('');
    const rds = ax.readings.filter((r) => r.entity);
    const rd = rds.length ? `<div class="rd"><button type="button" data-act="rd" aria-expanded="${this._rdOpen}"><span>${fvEsc(ax.readings_title || 'Inverter FV')}</span><span style="transform:rotate(${this._rdOpen ? 180 : 0}deg);display:flex">${fvIcon('chev', 'rgba(255,255,255,.8)', 18, 2)}</span></button>${this._rdOpen ? `<div class="gr">${rds.map((r, k) => `<div><span>${fvEsc(this._name(r).toUpperCase())}</span><b data-rd="${k}"></b></div>`).join('')}</div>` : ''}</div>` : '';
    const empty = !ctl && !sws && !rd ? '<div class="empty">Aggiungi impostazioni, interruttori e letture dall\'editor.</div>' : '';
    el.innerHTML = `<div class="axp"><div class="axh"><span class="lg"><span>${fvIcon('inv', O, 22, 1.7)}</span><span><b>${fvEsc(ax.title || (this._axi != null ? (this._config.inverters[this._axi].name || 'Inverter ' + (this._axi + 1)) : 'Inverter'))}</b><i>INVERTER · IMPOSTAZIONI</i></span></span><span class="mono" style="font-size:10px;letter-spacing:.14em;color:${online ? '#2ee87a' : '#ff5a5a'}">● ${online ? 'ONLINE' : 'OFFLINE'}</span></div>
      ${keypad}${status}${ctl ? `<div class="ctl">${ctl}</div>` : ''}${sws ? `<div class="ctl">${sws}</div>` : ''}${rd}${empty}</div>`;
    this._patchReadings();
  }
  _patchReadings() {
    const el = this._$('axp'); if (!el) return; const rds = this._ax().readings.filter((r) => r.entity);
    el.querySelectorAll('[data-rd]').forEach((b) => {
      const r = rds[+b.dataset.rd]; if (!r) return; const st = this._st(r.entity); if (!st) { b.textContent = '—'; return; }
      const v = parseFloat(st.state); const u = st.attributes.unit_of_measurement;
      b.textContent = isNaN(v) ? st.state : this._f(v, r.decimals) + (u ? ' ' + u : '');
    });
  }

  /* ---------- eventi ---------- */
  _closePop() {
    const pp = this._$('pop'); this._popOn(pp, false);
    clearInterval(this._iv); this._lock = { left: 0, ask: false, pin: '', err: false, want: null }; this._pend = null; this._sigs.axp = null; this._update();
  }
  _click(e) {
    if (e.target && e.target.id === 'pop') { this._closePop(); return; }
    if (e.target && e.target.id === 'cpop') { this._closeSel(); return; }
    if (e.target && e.target.id === 'spop') { this._subOpen = null; this._renderSubPop(); return; }
    if (e.target && e.target.id === 'bpop') { this._bpOpen = false; this._renderBatPop(); return; }
    const p = e.composedPath ? e.composedPath() : []; const el = p.find((n) => n && n.dataset && n.dataset.act); if (!el) return; const a = el.dataset.act; const ax = this._ax(); const i = +el.dataset.i;
    if (a === 'open' || a === 'sub' || a === 'bpop' || a === 'axpop') { const r = el.getBoundingClientRect(); this._org = { x: r.left + r.width / 2, y: r.top + r.height / 2 }; if (a === 'sub') this._orgSub = this._org; }
    if (a === 'open') {
      const kind = el.dataset.kind;
      if (kind === 'ind') {
        const same = this._sel && this._sel.kind === kind && this._sel.i === i; this._sel = same ? null : { kind, i }; this._met = 'w'; this._sigs.tiles = null; this._update();
        if (!same) { const pn = this._$('panel'); if (pn && pn.scrollIntoView) pn.scrollIntoView({ block: 'nearest', behavior: 'smooth' }); }
      } else { if (kind === 'sub') { this._subOpen = null; this._renderSubPop(); } this._sel = { kind, i, key: el.dataset.key || '' }; this._met = el.dataset.met || 'w'; this._pkey = null; this._sigs.tiles = null; this._update(); }
    } else if (a === 'close') this._closeSel();
    else if (a === 'sub') this._openSub(el.dataset.ref);
    else if (a === 'spclose') { this._subOpen = null; this._renderSubPop(); }
    else if (a === 'met') { this._met = el.dataset.m; this._pkey = null; this._update(); }
    else if (a === 'bpop') { this._bpOpen = true; this._renderBatPop(); }
    else if (a === 'bpclose') { this._bpOpen = false; this._renderBatPop(); }
    else if (a === 'axpop') { this._axi = el.dataset.ax != null && el.dataset.ax !== '' ? +el.dataset.ax : null; this._sigs.axp = null; this._update(); this._popOn(this._$('pop'), true); }
    else if (a === 'popclose') this._closePop();
    else if (a === 'range') {
      if (el.dataset.t === 'p') { this._prng = el.dataset.r; this._pkey = null; } else { this._hrng = el.dataset.r; this._sigs.hist = null; }
      this._update(); this._loadAll();
    } else if (a === 'ask') this._guard(el.dataset.kind, () => {});
    else if (a === 'key') this._key(el.dataset.d);
    else if (a === 'relock') { clearInterval(this._iv); this._lock = { left: 0, ask: false, pin: '', err: false, want: null }; this._sigs.axp = null; this._update(); }
    else if (a === 'rd') { this._rdOpen = !this._rdOpen; this._sigs.axp = null; this._update(); }
    else if (a === 'opt') { const it = ax.controls[i]; if (it && this._hass) this._guard('ctl', () => this._hass.callService(fvDomain(it.entity), 'select_option', { entity_id: it.entity, option: el.dataset.v })); }
    else if (a === 'step') {
      const it = ax.controls[i]; if (!it || !this._hass) return; const st = this._st(it.entity); if (!st) return; const at = st.attributes; const step = +at.step || 1; const v = parseFloat(st.state); if (isNaN(v)) return;
      let nv = v + (+el.dataset.d) * step; if (at.min != null) nv = Math.max(+at.min, nv); if (at.max != null) nv = Math.min(+at.max, nv);
      this._guard('ctl', () => this._hass.callService(fvDomain(it.entity), 'set_value', { entity_id: it.entity, value: nv }));
    } else if (a === 'tog') { const it = ax.switches[i]; if (it && this._hass) this._guard('sw', () => this._hass.callService('homeassistant', 'toggle', { entity_id: it.entity })); }
  }
  _change(e) {
    const el = e.composedPath ? e.composedPath()[0] : e.target; if (!el || !el.dataset || el.dataset.act !== 'sel' || !this._hass) return;
    const it = this._ax().controls[+el.dataset.i]; if (!it) return; const v = el.value;
    this._guard('ctl', () => this._hass.callService(fvDomain(it.entity), 'select_option', { entity_id: it.entity, option: v }));
  }
}

/* ======================= EDITOR ======================= */
const FV_ED_CSS = `
:host { display: block; }
.ed { display: flex; flex-direction: column; gap: 14px; }
.multi details[data-id="src.solar"], .multi details[data-id="src.battery"], .multi details[data-id="src.battery2"], .multi details[data-id="src.home"], .multi details[data-id="loads"], .single details[data-id="inverters"] { display: none; }
label { display: flex; flex-direction: column; gap: 6px; font-size: 12.5px; color: var(--secondary-text-color); }
input[type=text], input[type=number], select { font: inherit; font-size: 14px; padding: 10px 12px; border-radius: 10px; min-height: 40px;
  border: 1px solid var(--divider-color, #666); background: var(--card-background-color, transparent); color: var(--primary-text-color); }
input[type=color] { width: 100%; height: 40px; padding: 2px; border-radius: 10px; border: 1px solid var(--divider-color, #666); background: transparent; }
label.chk { flex-direction: row; align-items: center; gap: 10px; font-size: 14px; color: var(--primary-text-color); }
label.chk input { width: auto; }
details { border: 1px solid var(--divider-color, #666); border-radius: 12px; padding: 0 14px; }
details details { border-color: color-mix(in srgb, var(--divider-color, #666) 70%, transparent); background: color-mix(in srgb, var(--primary-text-color, #fff) 3%, transparent); }
summary { cursor: pointer; padding: 13px 0; font-weight: 600; font-size: 14px; }
.tb { display: flex; flex-direction: column; gap: 12px; padding: 0 0 14px; }
.g2 > *, .g3 > *, .thr > * { min-width: 0; }
input[type=text], input[type=number], select { width: 100%; box-sizing: border-box; }
.g2 { display: grid; grid-template-columns: 1fr 1fr; gap: 10px; }
.g3 { display: grid; grid-template-columns: 1fr 1fr 1fr; gap: 10px; }
.chks { display: flex; flex-wrap: wrap; gap: 6px 18px; }
.hint { font-size: 12px; color: var(--secondary-text-color); line-height: 1.5; }
.bar { display: flex; flex-wrap: wrap; gap: 6px; }
.b { font: inherit; font-size: 12.5px; padding: 7px 12px; border-radius: 999px; cursor: pointer; border: 1px solid var(--divider-color, #666); background: transparent; color: var(--primary-text-color); }
.b:hover { border-color: var(--primary-color); }
.b[disabled] { opacity: .4; cursor: default; }
.b.pri { border-color: var(--primary-color); color: var(--primary-color); }
.b.del { color: var(--error-color, #db4437); }
.sub { border-top: 1px dashed var(--divider-color, #666); padding-top: 10px; display: flex; flex-direction: column; gap: 10px; }
.sub h4 { margin: 0; font-size: 13px; font-weight: 600; color: var(--primary-text-color); }
.thr { display: grid; grid-template-columns: 1fr 70px auto; gap: 8px; align-items: end; }
ha-entity-picker { display: block; }
`;

class FvHudCardEditor extends HTMLElement {
  constructor() {
    super();
    this.attachShadow({ mode: 'open' });
    const r = this.shadowRoot;
    r.addEventListener('input', (e) => this._field(e));
    r.addEventListener('change', (e) => this._field(e));
    r.addEventListener('click', (e) => this._click(e));
    r.addEventListener('toggle', (e) => { const d = e.target; if (d && d.dataset && d.dataset.id) { if (d.open) this._open.add(d.dataset.id); else this._open.delete(d.dataset.id); } }, true);
  }
  get _open() { return FvHudCardEditor._O || (FvHudCardEditor._O = new Set(['g'])); }
  set _open(v) { FvHudCardEditor._O = v; }
  /* riallinea le sezioni aperte con quelle davvero aperte nel DOM prima di ridisegnare, così una modifica non le richiude */
  _syncOpen() {
    const cur = new Map(); this.shadowRoot.querySelectorAll('details[data-id]').forEach((d) => cur.set(d.dataset.id, d.open));
    if (!cur.size) return; const next = new Set(); this._open.forEach((id) => { if (!cur.has(id)) next.add(id); }); cur.forEach((o, id) => { if (o) next.add(id); }); this._open = next;
  }
  setConfig(config) {
    const s = JSON.stringify(config); if (this._emitted === s) return;
    const c = JSON.parse(s);
    ['solar', 'grid', 'battery', 'battery2', 'home', 'axpert', 'history'].forEach((k) => { if (!c[k] || typeof c[k] !== 'object') c[k] = {}; });
    if (!c.axpert.lock || typeof c.axpert.lock !== 'object') c.axpert.lock = {};
    ['loads', 'indicators', 'inverters'].forEach((k) => { if (!Array.isArray(c[k])) c[k] = []; });
    c.inverters.forEach((v) => { ['phase', 'battery', 'home'].forEach((k) => { if (!v[k] || typeof v[k] !== 'object') v[k] = {}; }); if (!Array.isArray(v.mppt)) v.mppt = []; if (!Array.isArray(v.loads)) v.loads = []; });
    ['controls', 'switches', 'readings'].forEach((k) => { if (!Array.isArray(c.axpert[k])) c.axpert[k] = []; });
    if (!Array.isArray(c.history.series)) c.history.series = [];
    this._config = c; this._ensurePicker(); this._syncOpen(); this._render();
  }
  set hass(h) {
    const first = !this._hass; this._hass = h; if (!this._config) return;
    if (first) this._render(); else this.shadowRoot.querySelectorAll('ha-entity-picker').forEach((p) => { p.hass = h; });
  }
  async _ensurePicker() {
    if (customElements.get('ha-entity-picker') || this._tried) return; this._tried = true;
    try { const helpers = await window.loadCardHelpers(); const c = await helpers.createCardElement({ type: 'entities', entities: [] }); await c.constructor.getConfigElement(); } catch (err) { /* campo di testo */ }
    if (customElements.get('ha-entity-picker')) { this._syncOpen(); this._render(); }
  }
  _emit() { this._emitted = JSON.stringify(this._config); this.dispatchEvent(new CustomEvent('config-changed', { detail: { config: JSON.parse(this._emitted) }, bubbles: true, composed: true })); }

  _get(path) { return path.split('.').reduce((o, k) => (o == null ? undefined : o[k]), this._config); }
  _setPath(path, v) {
    const parts = path.split('.'); let o = this._config;
    for (let i = 0; i < parts.length - 1; i++) { const k = parts[i]; if (o[k] == null) o[k] = /^\d+$/.test(parts[i + 1]) ? [] : {}; o = o[k]; }
    const last = parts[parts.length - 1]; const empty = v === '' || v == null || (typeof v === 'number' && isNaN(v));
    if (empty) delete o[last]; else o[last] = v;
  }
  _arr(path) { const parts = path.split('.'); let o = this._config; for (let i = 0; i < parts.length; i++) { const k = parts[i]; if (o[k] == null) o[k] = i === parts.length - 1 ? [] : {}; o = o[k]; } return o; }

  _field(e) {
    const el = e.composedPath()[0]; if (!el || !el.dataset || !el.dataset.p || !this._config) return;
    if (el.tagName === 'HA-ENTITY-PICKER') return; const kind = el.dataset.k; const p = el.dataset.p;
    if (kind === 'num') this._setPath(p, el.value === '' ? '' : Number(el.value));
    else if (kind === 'bool') this._setPath(p, el.checked ? true : '');
    else if (kind === 'boolf') this._setPath(p, el.checked ? '' : false);
    else if (kind === 'list') { const on = Array.from(this.shadowRoot.querySelectorAll(`input[data-p="${p}"]`)).filter((i) => i.checked).map((i) => i.dataset.v); this._setPath(p, on.length ? on : ''); }
    else if (kind === 'text' && el.type === 'color') { if (e.type !== 'change') return; this._setPath(p, el.value); }
    else { if (e.type === 'change' && el.type === 'text' && false) return; this._setPath(p, el.value); }
    this._emit();
    if (el.dataset.re) { this._syncOpen(); this._render(); }
  }
  _click(e) {
    const b = e.composedPath()[0]; const el = b && b.closest ? b.closest('[data-ea]') : null; if (!el || el.disabled) return;
    const a = el.dataset.ea; const path = el.dataset.arr; const idx = +el.dataset.idx; const arr = this._arr(path);
    const dflt = { loads: { entity: '', icon: 'bolt' }, indicators: { entity: '', color: '#5fd0ff' }, thresholds: { value: '', color: '#ffb43a' }, controls: { entity: '' }, switches: { entity: '', icon: 'bolt' }, readings: { entity: '' }, series: { entity: '' }, sub_loads: { name: '', entity: '' } };
    const key = path.split('.').pop(); const max = (key === 'loads' && path.indexOf('inverters.') === 0 ? FV_MAX_LOADS_INV : { sub_loads: FV_MAX_SUB, loads: FV_MAX_LOADS, indicators: FV_MAX_IND, series: FV_MAX_SERIES, inverters: FV_MAX_INV }[key]) || 99;
    if (a === 'add') { if (arr.length >= max) return; const o = key === 'inverters' ? { name: '', phase: { entity: '', voltage_entity: '' }, mppt: [{ entity: '' }], battery: { entity: '', soc_entity: '' }, home: { entity: '' }, loads: [] } : Object.assign({}, dflt[key] || { entity: '' }); if (key === 'series') o.color = ['#5fd0ff', '#ffb43a', '#6f9bff', '#2ee87a', '#ff8a5c', '#b28cff'][arr.length % 6]; arr.push(o); this._open.add(path + '.' + (arr.length - 1)); this._open.add(path.split('.').slice(0, -1).join('.') || path); }
    else if (a === 'del') arr.splice(idx, 1);
    else if (a === 'up' && idx > 0) { [arr[idx - 1], arr[idx]] = [arr[idx], arr[idx - 1]]; }
    else if (a === 'down' && idx < arr.length - 1) { [arr[idx + 1], arr[idx]] = [arr[idx], arr[idx + 1]]; }
    else if (a !== 'add') return;
    this._open = new Set(Array.from(this._open).filter((k) => !new RegExp('^' + path.replace(/\./g, '\\.') + '\\.\\d').test(k) || a === 'add'));
    if (a === 'add') this._open.add(path + '.' + (arr.length - 1));
    this._emit(); this._render();
  }

  _txt(label, p, ph, kind, re) {
    const v = this._get(p);
    return `<label>${fvEsc(label)}<input type="${kind === 'color' ? 'color' : 'text'}" data-p="${p}" data-k="text" ${re ? 'data-re="1"' : ''} value="${fvEsc(v == null ? (kind === 'color' ? ph : '') : v)}" placeholder="${fvEsc(ph || '')}"></label>`;
  }
  _numf(label, p, ph) { const v = this._get(p); return `<label>${fvEsc(label)}<input type="number" step="any" data-p="${p}" data-k="num" value="${v == null ? '' : v}" placeholder="${fvEsc(ph == null ? '' : ph)}"></label>`; }
  _chk(label, p, kind, on, re) { return `<label class="chk"><input type="checkbox" data-p="${p}" data-k="${kind}" ${re ? 'data-re="1"' : ''} ${on ? 'checked' : ''}>${fvEsc(label)}</label>`; }
  _sel(label, p, opts, cur, re) { return `<label>${fvEsc(label)}<select data-p="${p}" data-k="text" ${re ? 'data-re="1"' : ''}>${opts.map(([v, l]) => `<option value="${fvEsc(v)}" ${String(cur == null ? '' : cur) === v ? 'selected' : ''}>${fvEsc(l)}</option>`).join('')}</select></label>`; }
  _pick(label, p, doms) {
    const v = this._get(p) || '';
    if (customElements.get('ha-entity-picker')) return `<ha-entity-picker data-p="${p}" data-dom="${doms.join(',')}" data-label="${fvEsc(label)}"></ha-entity-picker>`;
    return `<label>${fvEsc(label)}<input type="text" list="ents" data-p="${p}" data-k="text" value="${fvEsc(v)}" placeholder="dominio.nome_entita"></label>`;
  }
  _bar(path, i, n) { return `<div class="bar"><button type="button" class="b" data-ea="up" data-arr="${path}" data-idx="${i}" ${i === 0 ? 'disabled' : ''}>↑ Su</button><button type="button" class="b" data-ea="down" data-arr="${path}" data-idx="${i}" ${i === n - 1 ? 'disabled' : ''}>↓ Giù</button><button type="button" class="b del" data-ea="del" data-arr="${path}" data-idx="${i}">Elimina</button></div>`; }
  _det(id, title, body) { return `<details data-id="${id}" ${this._open.has(id) ? 'open' : ''}><summary>${fvEsc(title)}</summary><div class="tb">${body}</div></details>`; }
  _nm(it, fb) { if (it.name) return it.name; const st = this._hass && it.entity ? this._hass.states[it.entity] : null; return (st && st.attributes.friendly_name) || it.entity || fb; }

  _render() {
    const c = this._config; if (!c) return; const h = this._hass; const hasPicker = !!customElements.get('ha-entity-picker');
    const P = ['sensor', 'input_number', 'number'];
    const subEd = (base, l) => { const sl = Array.isArray(l.sub_loads) ? l.sub_loads : [];
      const items = sl.map((x, j) => this._det(`${base}.sub_loads.${j}`, `${j + 1} · ${this._nm(x || {}, 'da configurare')}`, this._pick('Potenza del sottocarico (W o kW)', `${base}.sub_loads.${j}.entity`, P) + this._txt('Nome', `${base}.sub_loads.${j}.name`, 'Nome') + this._bar(`${base}.sub_loads`, j, sl.length))).join('');
      return `<div class="sub"><h4>Sottocarichi (${sl.length}/${FV_MAX_SUB})</h4><div class="hint">Dettagliano questa utenza: sul quadrato appare un pulsante che apre l'elenco dei sottocarichi con il loro storico.</div>${items}<div class="bar"><button type="button" class="b pri" data-ea="add" data-arr="${base}.sub_loads" ${sl.length >= FV_MAX_SUB ? 'disabled' : ''}>+ Aggiungi sottocarico</button></div></div>`; };
    const src = (k, label, fields) => this._det('src.' + k, label, fields);
    const sources = src('solar', 'Solare', this._pick('Potenza prodotta (W o kW) — con il secondo MPPT compilato è quella dell\'MPPT 1', 'solar.entity', P) + `<div class="g2">${this._txt('Nome', 'solar.name', 'Solare')}${this._txt('Testo sotto il valore', 'solar.sub', 'PV1 + PV2')}</div>` + this._pick('Tensione di stringa (V, opzionale: appare nel grafico)', 'solar.voltage_entity', P) + this._pick('Corrente di stringa (A, opzionale: se vuota la calcolo da potenza / tensione)', 'solar.current_entity', P)
        + [['mppt2', 'Secondo', 2], ['mppt3', 'Terzo', 3], ['mppt4', 'Quarto', 4]].map(([k, w, nn]) => this._det('src.' + k, w + ' MPPT (opzionale)', this._pick('Potenza dell\'MPPT ' + nn + ' (W o kW)', 'solar.' + k + '.entity', P) + this._txt('Nome', 'solar.' + k + '.name', 'MPPT ' + nn) + this._pick('Tensione di stringa (V, opzionale)', 'solar.' + k + '.voltage_entity', P) + this._pick('Corrente di stringa (A, opzionale)', 'solar.' + k + '.current_entity', P) + (k === 'mppt2' ? '<div class="hint">Con più MPPT la card mostra i cerchi affiancati che si uniscono in una sola linea verso l\'inverter; il totale solare è la somma (fino a 4 MPPT).</div>' : ''))).join(''))
      + src('grid', 'Rete', this._pick('Potenza prelevata dalla rete (W o kW)', 'grid.entity', P) + this._pick('Tensione di rete (opzionale)', 'grid.voltage_entity', P) + this._pick('Frequenza di rete in Hz (opzionale, mostrata nel riquadro inverter)', 'grid.frequency_entity', P) + this._txt('Nome', 'grid.name', 'Rete Enel') + this._chk('Potenza positiva = prelievo dalla rete (togli la spunta se il tuo sensore è al contrario). L\'immissione in rete è negativa e il grafico la mostra sotto lo zero.', 'grid.import_positive', 'boolf', c.grid.import_positive !== false))
      + src('battery', 'Batteria', this._pick('Potenza della batteria (W o kW)', 'battery.entity', P) + this._pick('Carica della batteria (%)', 'battery.soc_entity', P) + this._txt('Nome', 'battery.name', 'Batteria 1') + `<div class="g2">${this._numf('Capacità totale del pacco (kWh)', 'battery.capacity_kwh', 'es. 10,24')}${this._numf('Carica residua desiderata (%)', 'battery.min_soc', 20)}</div><div class="hint">La capacità è quella di tutto il pacco (somma delle batterie). Con la capacità impostata compare il tempo stimato: in carica, quanto manca al 100 %; in scarica, quanto resta prima della carica residua desiderata.</div>`
        + this._chk('Potenza positiva = in carica (togli la spunta se il tuo sensore è al contrario)', 'battery.charging_positive', 'boolf', c.battery.charging_positive !== false))
      + src('battery2', 'Batteria 2 (opzionale)', this._pick('Potenza della batteria 2 (W o kW)', 'battery2.entity', P) + this._pick('Carica della batteria 2 (%)', 'battery2.soc_entity', P) + this._txt('Nome', 'battery2.name', 'Batteria 2')
        + this._chk('Potenza positiva = in carica (togli la spunta se il tuo sensore è al contrario)', 'battery2.charging_positive', 'boolf', (c.battery2 || {}).charging_positive !== false) + '<div class="hint">Se compilata, la card mostra due cerchi batteria affiancati. Se lasci vuoto ne mostra uno solo.</div>')
      + src('home', 'Casa', this._pick('Consumo della casa (opzionale: se vuoto lo calcolo dai flussi)', 'home.entity', P) + this._txt('Nome', 'home.name', 'Casa'));
    const loads = (c.loads || []).map((l, i) => this._det('loads.' + i, `${i + 1} · ${this._nm(l, 'da configurare')}`,
      this._pick('Potenza dell\'utenza (W o kW)', `loads.${i}.entity`, P) + `<div class="g2">${this._txt('Nome', `loads.${i}.name`, 'Nome')}${this._sel('Icona', `loads.${i}.icon`, FV_ICONS, l.icon || 'bolt')}</div>`
      + this._txt('Testo sotto il nome (opzionale)', `loads.${i}.sub`, 'es. CLIMA') + this._pick('…oppure entità da mostrare sotto il nome (es. umidità)', `loads.${i}.sub_entity`, ['sensor', 'binary_sensor', 'input_number', 'number']) + this._pick('Carica dell\'auto in % (per auto / wallbox, opzionale: appare sopra e nel grafico)', `loads.${i}.soc_entity`, P) + subEd('loads.' + i, l) + this._bar('loads', i, c.loads.length))).join('');
    const inds = (c.indicators || []).map((it, i) => {
      const th = (it.thresholds || []).map((r, k) => `<div class="thr">${this._numf('Da questo valore in su', `indicators.${i}.thresholds.${k}.value`, '')}${this._txt('Colore', `indicators.${i}.thresholds.${k}.color`, '#ffb43a', 'color')}<button type="button" class="b del" data-ea="del" data-arr="indicators.${i}.thresholds" data-idx="${k}">✕</button></div>`).join('');
      return this._det('indicators.' + i, `${i + 1} · ${this._nm(it, 'da configurare')}`,
        this._pick('Entità', `indicators.${i}.entity`, P) + `<div class="g2">${this._txt('Nome', `indicators.${i}.name`, 'Nome')}${this._txt('Unità (vuoto = quella dell\'entità)', `indicators.${i}.unit`, '')}</div>`
        + `<div class="g3">${this._numf('Minimo della barra', `indicators.${i}.min`, 0)}${this._numf('Massimo della barra', `indicators.${i}.max`, 100)}${this._numf('Decimali', `indicators.${i}.decimals`, 'auto')}</div>`
        + `<div class="sub"><h4>Colori e soglie</h4>${this._txt('Colore di base (sotto la prima soglia)', `indicators.${i}.color`, '#5fd0ff', 'color')}${th || '<div class="hint">Nessuna soglia: l\'indicatore resta sempre del colore di base.</div>'}
        <div class="bar"><button type="button" class="b pri" data-ea="add" data-arr="indicators.${i}.thresholds">+ Aggiungi soglia</button></div>${this._chk('Disattiva le soglie di questo indicatore (le righe restano salvate)', `indicators.${i}.thresholds_off`, 'bool', !!it.thresholds_off)}
        <div class="hint">Ogni soglia vale «da questo valore in su». Le soglie si possono mettere in qualsiasi ordine e quante ne vuoi.</div></div>` + this._bar('indicators', i, c.indicators.length));
    }).join('');
    const ax = c.axpert || {}; const lk = ax.lock || {};
    const axl = (b, ax) => ({
      ctl: (ax.controls || []).map((it, i) => this._det(b + '.controls.' + i, `${i + 1} · ${this._nm(it, 'da configurare')}`, this._pick('Entità (select o number)', `${b}.controls.${i}.entity`, ['select', 'input_select', 'number', 'input_number']) + this._txt('Nome', `${b}.controls.${i}.name`, 'Nome')
        + this._sel('Aspetto (per le select)', `${b}.controls.${i}.display`, [['', 'Automatico (3 opzioni o meno: pulsanti, altrimenti elenco)'], ['segments', 'Pulsanti'], ['dropdown', 'Elenco a discesa']], it.display || '') + this._bar(b + '.controls', i, ax.controls.length))).join(''),
      sws: (ax.switches || []).map((it, i) => this._det(b + '.switches.' + i, `${i + 1} · ${this._nm(it, 'da configurare')}`, this._pick('Entità', `${b}.switches.${i}.entity`, ['switch', 'input_boolean', 'light', 'fan']) + `<div class="g2">${this._txt('Nome', `${b}.switches.${i}.name`, 'Nome')}${this._sel('Icona', `${b}.switches.${i}.icon`, FV_ICONS, it.icon || 'bolt')}</div>` + this._bar(b + '.switches', i, ax.switches.length))).join(''),
      rds: (ax.readings || []).map((it, i) => this._det(b + '.readings.' + i, `${i + 1} · ${this._nm(it, 'da configurare')}`, this._pick('Entità', `${b}.readings.${i}.entity`, ['sensor', 'binary_sensor', 'input_number', 'number']) + `<div class="g2">${this._txt('Nome', `${b}.readings.${i}.name`, 'Nome')}${this._numf('Decimali', `${b}.readings.${i}.decimals`, 'auto')}</div>` + this._bar(b + '.readings', i, ax.readings.length))).join(''),
    });
    const gax = axl('axpert', ax); const ctl = gax.ctl; const sws = gax.sws; const rds = gax.rds;
    const hs = c.history || {};
    const ser = (hs.series || []).map((it, i) => this._det('history.series.' + i, `${i + 1} · ${this._nm(it, 'da configurare')}`, this._pick('Entità (W o kW)', `history.series.${i}.entity`, P) + `<div class="g2">${this._txt('Nome', `history.series.${i}.name`, 'Nome')}${this._txt('Colore', `history.series.${i}.color`, '#5fd0ff', 'color')}</div>` + this._bar('history.series', i, hs.series.length))).join('');
    const rg = hs.ranges || ['24h', '7g', '30g'];
    const datalist = !hasPicker && h ? `<datalist id="ents">${Object.keys(h.states).sort().map((i) => `<option value="${fvEsc(i)}"></option>`).join('')}</datalist>` : '';
    const add = (path, label, n, max) => `<div class="bar"><button type="button" class="b pri" data-ea="add" data-arr="${path}" ${n >= max ? 'disabled' : ''}>${label}</button></div>`;
    const invs = (c.inverters || []).map((v, i) => {
      const b = 'inverters.' + i; const ph = v.phase || {}; const bt = v.battery || {}; const nl = (v.loads || []).length; const va = Object.assign({ controls: [], switches: [], readings: [] }, v.axpert || {}); const ia = axl(b + '.axpert', va);
      const mp = (j) => this._det(b + '.mppt' + j, 'MPPT ' + (j + 1) + (j ? ' (opzionale)' : ''), this._pick('Potenza (W o kW)', `${b}.mppt.${j}.entity`, P) + this._pick('Tensione di stringa (V, opzionale)', `${b}.mppt.${j}.voltage_entity`, P) + this._pick('Corrente di stringa (A, opzionale: se vuota la calcolo da potenza / tensione)', `${b}.mppt.${j}.current_entity`, P) + this._txt('Nome', `${b}.mppt.${j}.name`, 'MPPT ' + (j + 1)));
      const ls = (v.loads || []).map((l, k) => this._det(`${b}.loads.${k}`, `${k + 1} · ${this._nm(l, 'da configurare')}`, this._pick('Potenza dell\'utenza (W o kW)', `${b}.loads.${k}.entity`, P) + `<div class="g2">${this._txt('Nome', `${b}.loads.${k}.name`, 'Nome')}${this._sel('Icona', `${b}.loads.${k}.icon`, FV_ICONS, l.icon || 'bolt')}</div>` + this._pick('Carica dell\'auto in % (per auto / wallbox, opzionale)', `${b}.loads.${k}.soc_entity`, P) + subEd(b + '.loads.' + k, l) + this._bar(b + '.loads', k, nl))).join('');
      return this._det('inverters.' + i, `${i + 1} · ${v.name || 'Inverter ' + (i + 1)}`,
        this._txt('Nome', `${b}.name`, 'Inverter ' + (i + 1))
        + `<div class="sub"><h4>Fase di rete</h4>${this._pick('Potenza della fase (W o kW)', `${b}.phase.entity`, P)}${this._pick('Tensione della fase (opzionale)', `${b}.phase.voltage_entity`, P)}${this._txt('Nome', `${b}.phase.name`, 'Fase L' + (i + 1))}${this._chk('Potenza positiva = prelievo dalla rete (togli la spunta se il tuo sensore è al contrario: l\'immissione in rete diventa negativa nel grafico)', `${b}.phase.import_positive`, 'boolf', ph.import_positive !== false)}</div>`
        + `<div class="sub"><h4>Solare (MPPT)</h4>${mp(0)}${mp(1)}${mp(2)}${mp(3)}</div>`
        + `<div class="sub"><h4>Batteria</h4>${this._pick('Potenza della batteria (W o kW)', `${b}.battery.entity`, P)}${this._pick('Carica della batteria (%)', `${b}.battery.soc_entity`, P)}${this._txt('Nome', `${b}.battery.name`, 'Batteria ' + (i + 1))}<div class="g2">${this._numf('Capacità (kWh)', `${b}.battery.capacity_kwh`, 'es. 5,12')}${this._numf('Carica residua desiderata (%)', `${b}.battery.min_soc`, 20)}</div>${this._chk('Potenza positiva = in carica (togli la spunta se il tuo sensore è al contrario)', `${b}.battery.charging_positive`, 'boolf', bt.charging_positive !== false)}</div>`
        + `<div class="sub"><h4>Casa</h4>${this._pick('Consumo della casa (opzionale: se vuoto lo calcolo dai flussi)', `${b}.home.entity`, P)}${this._txt('Nome', `${b}.home.name`, 'Casa ' + (i + 1))}</div>`
        + `<div class="sub"><h4>Utenze (${nl}/${FV_MAX_LOADS_INV})</h4>${ls}${add(b + '.loads', '+ Aggiungi utenza', nl, FV_MAX_LOADS_INV)}</div>`
        + `<div class="sub"><h4>Impostazioni inverter (popup dell'inverter)</h4>${this._txt('Titolo', `${b}.axpert.title`, v.name || 'Inverter ' + (i + 1))}<div class="hint">Se compili almeno un campo, il riquadro dell'inverter diventa cliccabile e apre queste impostazioni. La password è quella della sezione «Inverter».</div><h4>Impostazioni (select / number)</h4>${ia.ctl}${add(b + '.axpert.controls', '+ Aggiungi impostazione', 0, 99)}<h4>Interruttori</h4>${ia.sws}${add(b + '.axpert.switches', '+ Aggiungi interruttore', 0, 99)}<h4>Letture</h4>${ia.rds}${add(b + '.axpert.readings', '+ Aggiungi lettura', 0, 99)}</div>`
        + this._bar('inverters', i, c.inverters.length));
    }).join('');
    this.shadowRoot.innerHTML = `<style>${FV_ED_CSS}</style><div class="ed ${c.mode === 'multi' ? 'multi' : 'single'}">
      ${this._det('g', 'Generale', `<div class="g2">${this._txt('Titolo', 'title', 'Fotovoltaico')}${this._txt('Sopra il titolo', 'subtitle', 'ENERGIA')}</div>` + this._sel('Modalità', 'mode', [['', 'Singolo inverter'], ['multi', 'Multi inverter (fino a 3, uno per fase)']], c.mode || '', true) + '<div class="hint">Multi inverter: ogni inverter ha la sua fase di rete, i suoi MPPT, la sua batteria e le sue utenze. La sezione «Rete» resta quella della rete totale (se vuota la calcolo sommando le fasi).</div>' + (c.mode === 'multi' ? this._chk('Batteria unica collegata a più inverter: la capacità totale e la carica residua desiderata si impostano solo nel primo inverter (per i tempi di carica/scarica uso quella capacità; le potenze le sommo da tutti gli inverter)', 'shared_battery', 'bool', !!c.shared_battery, true) : ''))}
      ${this._det('src', 'Fonti e casa', sources)}
      ${this._det('loads', `Utenze (${(c.loads || []).length}/${FV_MAX_LOADS})`, (loads || '<div class="hint">Nessuna utenza. Ne puoi aggiungere fino a ' + FV_MAX_LOADS + ': ognuna ha la sua linea animata e la sua quota sul consumo.</div>') + add('loads', '+ Aggiungi utenza', (c.loads || []).length, FV_MAX_LOADS))}
      ${this._det('inverters', `Inverter (${(c.inverters || []).length}/${FV_MAX_INV})`, (invs || '<div class="hint">Nessun inverter. Aggiungine fino a ' + FV_MAX_INV + ' (uno per fase).</div>') + add('inverters', '+ Aggiungi inverter', (c.inverters || []).length, FV_MAX_INV))}
      ${this._det('indicators', `Indicatori (${(c.indicators || []).length}/${FV_MAX_IND})`, this._sel('Aspetto', 'indicators_look', [['', 'Anello'], ['tiles', 'Tessere con barra']], c.indicators_look || '') + (inds || '<div class="hint">Nessun indicatore. Ne puoi aggiungere fino a ' + FV_MAX_IND + ' (3 file da 6 su schermo largo). Toccandoli la card mostra lo storico a 24 ore e 7 giorni.</div>') + add('indicators', '+ Aggiungi indicatore', (c.indicators || []).length, FV_MAX_IND))}
      ${this._det('axpert', 'Inverter: impostazioni, interruttori, letture', `<div class="g2">${this._txt('Titolo', 'axpert.title', 'Inverter')}${this._txt('Titolo delle letture', 'axpert.readings_title', 'Inverter FV')}</div>
        <div class="sub"><h4>Impostazioni (select / number)</h4>${ctl}${add('axpert.controls', '+ Aggiungi impostazione', 0, 99)}</div>
        <div class="sub"><h4>Interruttori</h4>${sws}${add('axpert.switches', '+ Aggiungi interruttore', 0, 99)}</div>
        <div class="sub"><h4>Letture (Inverter FV)</h4>${rds}${add('axpert.readings', '+ Aggiungi lettura', 0, 99)}</div>
        <div class="sub"><h4>Password</h4>${this._chk('Proteggi con password', 'axpert.lock.enabled', 'bool', !!lk.enabled, true)}
          ${lk.enabled ? `<div class="g2">${this._txt('Password (solo cifre)', 'axpert.lock.pin', '1234')}${this._numf('Si riblocca dopo (secondi)', 'axpert.lock.seconds', 30)}</div>${this._chk('Proteggi le impostazioni', 'axpert.lock.protect_controls', 'boolf', lk.protect_controls !== false)}${this._chk('Proteggi gli interruttori', 'axpert.lock.protect_switches', 'boolf', lk.protect_switches !== false)}
          <div class="hint">Una sola password sblocca tutto per il tempo indicato. Serve a evitare i tocchi involontari: la password resta scritta nella configurazione della plancia, quindi non è una protezione di sicurezza.</div>` : ''}</div>`)}
      ${this._det('history', 'Storico potenze', `<div class="g2">${this._txt('Titolo', 'history.title', 'STORICO POTENZE')}${this._numf('Altezza del grafico (px)', 'history.height', 260)}</div>
        ${this._sel('Stile', 'history.look', [['', 'Linee'], ['areas', 'Linee con area']], hs.look || '')}
        <div><div class="hint" style="margin-bottom:6px">Intervalli selezionabili</div><div class="chks">${[['24h', '24 ore'], ['7g', '7 giorni'], ['30g', '30 giorni']].map(([r, l]) => `<label class="chk"><input type="checkbox" data-p="history.ranges" data-k="list" data-v="${r}" ${rg.includes(r) ? 'checked' : ''}>${l}</label>`).join('')}</div></div>
        <div class="sub"><h4>Serie (${(hs.series || []).length}/${FV_MAX_SERIES})</h4>${ser}${add('history.series', '+ Aggiungi serie', (hs.series || []).length, FV_MAX_SERIES)}</div>`)}
      ${this._det('info', 'Informazioni', `<div class="hint">Versione installata</div><div style="font-size:20px;font-weight:600;padding:2px 0 10px">${fvEsc(FV_VERSION)}</div><div class="hint">Se dopo un aggiornamento qui vedi ancora il numero vecchio, la pagina sta usando il file in cache: controlla che la risorsa punti al file nuovo e ricarica.</div>`)}
    </div>${datalist}`;
    this.shadowRoot.querySelectorAll('ha-entity-picker').forEach((p) => {
      const path = p.dataset.p; p.hass = h; p.label = p.dataset.label; p.value = this._get(path) || ''; p.allowCustomEntity = true;
      const doms = p.dataset.dom.split(','); p.includeDomains = doms; p.setAttribute('include-domains', JSON.stringify(doms));
      p.addEventListener('value-changed', (ev) => { ev.stopPropagation(); const v = ((ev.detail && ev.detail.value) || '').trim(); if ((this._get(path) || '') === v) return; this._setPath(path, v); this._emit(); });
    });
  }
}

customElements.define('fv-hud-card', FvHudCard);
customElements.define('fv-hud-card-editor', FvHudCardEditor);
window.customCards = window.customCards || [];
window.customCards.push({
  type: 'fv-hud-card',
  documentationURL: 'https://github.com/Memme1989/fv-hud-card',
  name: 'FV HUD Card',
  description: 'Fotovoltaico a tutta pagina, a singolo o multi inverter: flusso animato, popup con grafico (potenza, tensione, corrente, SOC) per ogni elemento, fino a 10 utenze, fino a 18 indicatori con soglie colorate e storico, impostazioni inverter protette da password, storico potenze. Tutto configurabile dall\'editor.',
});
