/* FV HUD Card — Fotovoltaico a tutta pagina: flusso di energia con 8 utenze, indicatori con soglie e storico,
 * impostazioni inverter protette da password, storico a più serie.
 * Modalità singolo inverter (1-4 MPPT, 1-2 batterie) o multi inverter (fino a 3, una fase ciascuno, 1-4 MPPT ciascuno);
 * ogni cerchio / utenza apre un popup con il grafico (potenza, tensione, corrente, SOC).
 * Installazione: HACS / Marketplace (consigliata) oppure risorsa JavaScript module /local/fv-hud-card.js
 * Uso:  type: custom:fv-hud-card  (si configura dall'editor visuale)
 */
const FV_VERSION = '1.53.0';

/* ---------- costi e bolletta: fasce orarie, periodi e calcolo ---------- */
const FV_BILL_LBL = { fixed: ['Energia'], bi: ['F1', 'F23'], night: ['Giorno', 'Notte e festivi'], tiers: ['F1', 'F2', 'F3'] };
function fvBillBands(t) { return FV_BILL_LBL[t] || FV_BILL_LBL.fixed; }
/* regole standard ARERA: fascia (0 = F1, 1 = F2), giorni (wd lun-ven, ws lun-sab, sat sabato, sun domenica e festivi), ore di inizio e fine; il resto va all'ultima fascia */
function fvBillStd(t) {
  if (t === 'bi') return [{ b: 0, d: 'wd', a: 8, z: 19 }];
  if (t === 'night') return [{ b: 0, d: 'ws', a: 7, z: 23 }];
  if (t === 'tiers') return [{ b: 0, d: 'wd', a: 8, z: 19 }, { b: 1, d: 'wd', a: 7, z: 8 }, { b: 1, d: 'wd', a: 19, z: 23 }, { b: 1, d: 'sat', a: 7, z: 23 }];
  return [];
}
function fvEaster(y) { const a = y % 19; const b = Math.floor(y / 100); const c = y % 100; const d = Math.floor(b / 4); const e = b % 4; const f = Math.floor((b + 8) / 25); const g = Math.floor((b - f + 1) / 3); const h = (19 * a + b - d - g + 15) % 30; const i = Math.floor(c / 4); const k = c % 4; const l = (32 + 2 * e + 2 * i - h - k) % 7; const m = Math.floor((a + 11 * h + 22 * l) / 451); const mo = Math.floor((h + l - 7 * m + 114) / 31); const da = ((h + l - 7 * m + 114) % 31) + 1; return new Date(y, mo - 1, da); }
function fvHoliday(d) {
  const m = d.getMonth() + 1; const g = d.getDate();
  if ([[1, 1], [1, 6], [4, 25], [5, 1], [6, 2], [8, 15], [11, 1], [12, 8], [12, 25], [12, 26]].some((x) => x[0] === m && x[1] === g)) return true;
  const e = fvEaster(d.getFullYear()); const pm = new Date(e.getFullYear(), e.getMonth(), e.getDate() + 1); return d.getMonth() === pm.getMonth() && g === pm.getDate();
}
function fvDayType(d) { const w = d.getDay(); if (w === 0 || fvHoliday(d)) return 'sun'; return w === 6 ? 'sat' : 'wd'; }
function fvBand(d, b) {
  const t = b.type || 'fixed'; const n = fvBillBands(t).length; if (n < 2) return 0;
  const rules = b.sched === 'c' && Array.isArray(b.rules) && b.rules.length ? b.rules : fvBillStd(t); const dt = fvDayType(d); const h = d.getHours();
  for (const r of rules) {
    const dd = r.d; const ok = dd === 'all' || dd === dt || (dd === 'ws' && dt !== 'sun') || (dd === 'wd' && dt === 'wd');
    if (ok && h >= Number(r.a) && h < Number(r.z)) return Math.min(n - 1, Math.max(0, Number(r.b) || 0));
  }
  return n - 1;
}
function fvAddM(d, n) { const x = new Date(d.getFullYear(), d.getMonth() + n, 1); x.setDate(Math.min(d.getDate(), new Date(x.getFullYear(), x.getMonth() + 1, 0).getDate())); return x; }
function fvIso(x) { return x.getFullYear() + '-' + String(x.getMonth() + 1).padStart(2, '0') + '-' + String(x.getDate()).padStart(2, '0'); }
/* periodo di fatturazione in corso: parte dalla data scelta e avanza di 1 (mensile) o 2 (bimestrale) mesi */
function fvBillPer(b, now) {
  const n = b.period === 'mo' ? 1 : 2; let s0 = b.start ? new Date(b.start + 'T00:00:00') : null;
  if (!s0 || isNaN(s0)) { s0 = new Date(now.getFullYear(), now.getMonth(), 1); if (n === 2 && now.getMonth() % 2 === 1) s0 = new Date(now.getFullYear(), now.getMonth() - 1, 1); }
  let k = 0; let g = 0;
  if (s0 <= now) { while (fvAddM(s0, (k + 1) * n) <= now && g++ < 600) k++; } else { while (fvAddM(s0, k * n) > now && g++ < 600) k--; }
  return { s: fvAddM(s0, k * n), e: fvAddM(s0, (k + 1) * n), n };
}
/* storico automatico: chiave nell'archivio utente di Home Assistant (legata al contatore), sovrapposizioni e unione con lo storico manuale */
function fvBillKey(c) {
  const g = c.grid || {}; const ids = g.energy_entity ? [g.energy_entity] : (c.mode === 'multi' ? (c.inverters || []).map((v) => v.phase && v.phase.energy_entity).filter(Boolean) : []);
  return 'fv_hud_bills_' + (ids.join('_') || 'x').toLowerCase().replace(/[^a-z0-9_]/g, '_').slice(0, 80);
}
function fvOverlap(a, b) { return a.from < b.to && a.to > b.from; }
/* le bollette inserite a mano hanno la precedenza sulle stimate dello stesso periodo; si tengono al massimo `mx` voci, scartando le più vecchie */
function fvBillMerge(manual, est, mx) {
  const m = (manual || []).filter((h) => h && h.from && h.to); const e = (est || []).filter((h) => h && h.from && h.to && !m.some((x) => fvOverlap(x, h)));
  return m.concat(e.map((h) => Object.assign({}, h, { est: true }))).sort((a, b) => (a.from < b.from ? -1 : 1)).slice(-mx);
}
function fvBillCalc(b, kb, days, per) {
  const P = b.prices || {}; const N = (x) => Number(x) || 0; let en = 0; kb.forEach((k, i) => { en += k * N(P['p' + (i + 1)]); });
  const kwh = kb.reduce((a, x) => a + x, 0); const rete = kwh * N(b.network); const qf = N(b.fixed_month) * days / 30; const qp = N(b.power_kw) * N(b.power_price) * days / 30; const ac = kwh * N(b.excise);
  const vat = b.vat == null || b.vat === '' ? 10 : N(b.vat); const iv = (en + rete + qf + qp + ac) * vat / 100; const tb = en + rete + qf + qp + ac + iv; const tvy = b.tv_year != null && b.tv_year !== '' ? N(b.tv_year) : N(b.tv) * 10; let tvn = 0; if (per && per.s) { for (let i = 0; i < (per.n || 1); i++) { if (fvAddM(per.s, i).getMonth() < 10) tvn++; } } const tv = tvy / 10 * tvn;
  return { kwh, en, rete, qf, qp, ac, iv, tb, tv, vat, tot: tb + tv };
}

/* Lingue dell'interfaccia: la chiave dei dizionari è il testo italiano originale; {0}, {1}… sono i valori inseriti. */
const FV_UI = ['it', 'en', 'es', 'fr', 'de'];
const FV_BILL_TYPES = [['fixed', 'Prezzo fisso'], ['bi', 'Biorario'], ['night', 'Notte e festivi'], ['tiers', 'A fasce']];
const FV_LANG_OPTS = [['', 'Automatica (come Home Assistant)'], ['it', 'Italiano'], ['en', 'English'], ['es', 'Español'], ['fr', 'Français'], ['de', 'Deutsch']];
const FV_TR = {
  en: {"STIMATA": "ESTIMATED","Calcolata in automatico: modificala per inserire l'importo reale.": "Calculated automatically: edit it to enter the real amount.","STIMATA: calcolata in automatico con i tuoi prezzi. Per l'importo reale modificala nell'editor (Costi e bolletta).": "ESTIMATED: calculated automatically with your prices. For the real amount, edit it in the editor (Costs and bill).","A fine periodo la bolletta viene aggiunta da sola come STIMATA; quando vuoi, modificala con l'importo reale.": "At the end of the period the bill is added automatically as ESTIMATED; edit it with the real amount whenever you like.","Automatica (come Home Assistant)": "Automatic (same as Home Assistant)","Fulmine": "Lightning","Ventola": "Fan","Lavatrice": "Washing machine","Cucina": "Kitchen","Computer": "Computer","Presa": "Socket","Televisore": "TV","Auto": "Car","Luce": "Light","Caldaia": "Boiler","Clima": "A/C","Acqua": "Water","Pompa": "Pump","Stufa": "Heater","Inverter": "Inverter","Casa": "Home","Contatore": "Meter","Configurazione mancante": "Missing configuration","Elemento": "Item","Chiudi": "Close","Solare": "Solar","Batteria": "Battery","Batteria {0}": "Battery {0}","Storico {0}": "History {0}","Sottocarico": "Sub-load","Sottocarichi": "Sub-loads","Sottocarichi {0}": "Sub-loads {0}","UTENZA": "LOAD","Inverter {0}": "Inverter {0}","TOCCA PER LO STORICO": "TAP FOR HISTORY","{0} · SOTTOCARICHI": "{0} · SUB-LOADS","{0} SOTTOCARICO": "{0} SUB-LOAD","{0} SOTTOCARICHI": "{0} SUB-LOADS","Carichi non monitorati {0}": "Unmonitored loads {0}","Carichi non monitorati": "Unmonitored loads","Impostazioni {0}": "Settings {0}","IN {0}": "IN {0}","IMPOSTAZIONI": "SETTINGS","Impostazioni inverter": "Inverter settings","OUT {0}": "OUT {0}","IMPOSTA": "SET","BATTERIA PIENA": "BATTERY FULL","PIENA TRA {0}": "FULL IN {0}","SOTTO IL {0} %": "BELOW {0} %","{0} % TRA {1}": "{0} % IN {1}","{0} carica": "{0} charge","{0} potenza": "{0} power","Rete": "Grid","INVERTER": "INVERTER","IN": "IN","CATENA ENERGETICA · FONTI › INVERTER › CASA › UTENZE": "ENERGY CHAIN · SOURCES › INVERTER › HOME › LOADS","Apri l'editor della card e collega le entità: fonti, utenze, indicatori, inverter e storico.": "Open the card editor and link your entities: sources, loads, indicators, inverters and history.","SOLARE": "SOLAR","RETE": "GRID","BATTERIA": "BATTERY","TRIFASE": "THREE-PHASE","Rete Enel": "Utility grid","INVERTER {0}": "INVERTER {0}","Fase L{0}": "Phase L{0}","Casa {0}": "Home {0}","RETE TRIFASE": "THREE-PHASE GRID","{0} INVERTER": "{0} INVERTERS","{0} INVERTER · {0} CASE CON LE LORO UTENZE": "{0} INVERTERS · {0} HOMES WITH THEIR LOADS","Dettaglio batterie": "Battery details","BATTERIE": "BATTERIES","IN CARICA": "CHARGING","IN SCARICA": "DISCHARGING","FERMA": "IDLE","BATTERIE · TOTALE": "BATTERIES · TOTAL","{0} batteria, una per inverter": "{0} battery, one per inverter","{0} batterie, una per inverter": "{0} batteries, one per inverter","IN EQUILIBRIO": "BALANCED","POTENZA NETTA": "NET POWER","CARICA MEDIA": "AVERAGE CHARGE","ENTRA · {0} batt.": "CHARGING · {0} batt.","ESCE · {0} batt.": "DISCHARGING · {0} batt.","INDICATORI": "INDICATORS","Carico lo storico…": "Loading history…","Nessun dato nel periodo": "No data in this period","MIN": "MIN","MEDIA": "AVG","MAX": "MAX","non disp.": "n/a","POTENZA": "POWER","TENSIONE": "VOLTAGE","CORRENTE": "CURRENT","PRELIEVO DALLA RETE": "GRID IMPORT","IMMISSIONE IN RETE": "GRID EXPORT","INGRESSO SOLARE": "SOLAR INPUT","SOC AUTO": "CAR SOC","SOGLIE": "THRESHOLDS","Chiudi storico": "Close history","STORICO": "HISTORY","Aggiungi le serie del grafico dall'editor.": "Add the chart series from the editor.","PASSWORD PER MODIFICARE LE IMPOSTAZIONI": "PASSWORD TO CHANGE SETTINGS","PASSWORD PER COMANDARE GLI INTERRUTTORI": "PASSWORD TO OPERATE THE SWITCHES","Annulla": "Cancel","Cancella": "Clear","PASSWORD ERRATA": "WRONG PASSWORD","SBLOCCATO · SI RIBLOCCA TRA {0} s": "UNLOCKED · RELOCKS IN {0} s","BLOCCA": "LOCK","IMPOSTAZIONI E INTERRUTTORI PROTETTI DA PASSWORD": "SETTINGS AND SWITCHES ARE PASSWORD PROTECTED","Diminuisci": "Decrease","Aumenta": "Increase","Sblocca con password per modificare": "Unlock with password to edit","NON DISPONIBILE": "UNAVAILABLE","ATTIVO": "ON","SPENTO": "OFF","Inverter FV": "PV inverter","Aggiungi impostazioni, interruttori e letture dall'editor.": "Add settings, switches and readings from the editor.","INVERTER · IMPOSTAZIONI": "INVERTER · SETTINGS","ONLINE": "ONLINE","OFFLINE": "OFFLINE","dominio.nome_entita": "domain.entity_name","↑ Su": "↑ Up","↓ Giù": "↓ Down","Elimina": "Delete","da configurare": "to be set up","Potenza del sottocarico (W o kW)": "Sub-load power (W or kW)","Nome": "Name","Sottocarichi ({0}/{1})": "Sub-loads ({0}/{1})","Dettagliano questa utenza: sul quadrato appare un pulsante che apre l'elenco dei sottocarichi con il loro storico.": "They break this load down: a button appears on the tile that opens the list of sub-loads with their history.","+ Aggiungi sottocarico": "+ Add sub-load","Potenza prodotta (W o kW) — con il secondo MPPT compilato è quella dell'MPPT 1": "Power produced (W or kW) — when the second MPPT is filled in, this is MPPT 1 only","Testo sotto il valore": "Text under the value","Tensione di stringa (V, opzionale: appare nel grafico)": "String voltage (V, optional: shown in the chart)","Corrente di stringa (A, opzionale: se vuota la calcolo da potenza / tensione)": "String current (A, optional: if empty it is computed from power / voltage)","Potenza dell'MPPT {0} (W o kW)": "MPPT {0} power (W or kW)","Tensione di stringa (V, opzionale)": "String voltage (V, optional)","Corrente di stringa (A, opzionale)": "String current (A, optional)","Con più MPPT la card mostra i cerchi affiancati che si uniscono in una sola linea verso l'inverter; il totale solare è la somma (fino a 4 MPPT).": "With several MPPTs the card shows the circles side by side, merging into a single line towards the inverter; the solar total is their sum (up to 4 MPPTs).","Potenza prelevata dalla rete (W o kW)": "Power drawn from the grid (W or kW)","Tensione di rete (opzionale)": "Grid voltage (optional)","Frequenza di rete in Hz (opzionale, mostrata nel riquadro inverter)": "Grid frequency in Hz (optional, shown in the inverter box)","Potenza positiva = prelievo dalla rete (togli la spunta se il tuo sensore è al contrario). L'immissione in rete è negativa e il grafico la mostra sotto lo zero.": "Positive power = drawn from the grid (uncheck if your sensor works the other way round). Export to the grid is negative and the chart shows it below zero.","Potenza della batteria (W o kW)": "Battery power (W or kW)","Carica della batteria (%)": "Battery charge (%)","Batteria 1": "Battery 1","Capacità totale del pacco (kWh)": "Total pack capacity (kWh)","es. 10,24": "e.g. 10.24","Carica residua desiderata (%)": "Desired remaining charge (%)","La capacità è quella di tutto il pacco (somma delle batterie). Con la capacità impostata compare il tempo stimato: in carica, quanto manca al 100 %; in scarica, quanto resta prima della carica residua desiderata.": "The capacity is that of the whole pack (sum of the batteries). With the capacity set, an estimated time appears: while charging, the time left to 100 %; while discharging, the time left before the desired remaining charge.","Potenza positiva = in carica (togli la spunta se il tuo sensore è al contrario)": "Positive power = charging (uncheck if your sensor works the other way round)","Potenza della batteria 2 (W o kW)": "Battery 2 power (W or kW)","Carica della batteria 2 (%)": "Battery 2 charge (%)","Batteria 2": "Battery 2","Se compilata, la card mostra due cerchi batteria affiancati. Se lasci vuoto ne mostra uno solo.": "If filled in, the card shows two battery circles side by side. If left empty it shows just one.","Batteria 2 (opzionale)": "Battery 2 (optional)","Consumo della casa (opzionale: se vuoto lo calcolo dai flussi)": "Home consumption (optional: if empty it is computed from the flows)","Potenza dell'utenza (W o kW)": "Load power (W or kW)","Icona": "Icon","Testo sotto il nome (opzionale)": "Text under the name (optional)","es. CLIMA": "e.g. A/C","…oppure entità da mostrare sotto il nome (es. umidità)": "…or an entity to show under the name (e.g. humidity)","Carica dell'auto in % (per auto / wallbox, opzionale: appare sopra e nel grafico)": "Car charge in % (for car / wallbox, optional: shown above and in the chart)","Da questo valore in su": "From this value up","Colore": "Color","Entità": "Entity","Unità (vuoto = quella dell'entità)": "Unit (empty = the entity's own)","Minimo della barra": "Bar minimum","Massimo della barra": "Bar maximum","Decimali": "Decimals","auto": "auto","Colori e soglie": "Colors and thresholds","Colore di base (sotto la prima soglia)": "Base color (below the first threshold)","Nessuna soglia: l'indicatore resta sempre del colore di base.": "No thresholds: the indicator always keeps the base color.","+ Aggiungi soglia": "+ Add threshold","Disattiva le soglie di questo indicatore (le righe restano salvate)": "Turn off the thresholds of this indicator (the rows stay saved)","Ogni soglia vale «da questo valore in su». Le soglie si possono mettere in qualsiasi ordine e quante ne vuoi.": "Each threshold means \"from this value up\". Thresholds can be in any order and as many as you like.","Entità (select o number)": "Entity (select or number)","Aspetto (per le select)": "Look (for selects)","Automatico (3 opzioni o meno: pulsanti, altrimenti elenco)": "Automatic (3 options or fewer: buttons, otherwise a list)","Pulsanti": "Buttons","Elenco a discesa": "Dropdown list","Entità (W o kW)": "Entity (W or kW)","MPPT {0} (opzionale)": "MPPT {0} (optional)","MPPT {0}": "MPPT {0}","Potenza (W o kW)": "Power (W or kW)","Carica dell'auto in % (per auto / wallbox, opzionale)": "Car charge in % (for car / wallbox, optional)","Fase di rete": "Grid phase","Potenza della fase (W o kW)": "Phase power (W or kW)","Tensione della fase (opzionale)": "Phase voltage (optional)","Potenza positiva = prelievo dalla rete (togli la spunta se il tuo sensore è al contrario: l'immissione in rete diventa negativa nel grafico)": "Positive power = drawn from the grid (uncheck if your sensor works the other way round: export to the grid becomes negative in the chart)","Solare (MPPT)": "Solar (MPPT)","Capacità (kWh)": "Capacity (kWh)","es. 5,12": "e.g. 5.12","Utenze ({0}/{1})": "Loads ({0}/{1})","+ Aggiungi utenza": "+ Add load","Impostazioni inverter (popup dell'inverter)": "Inverter settings (inverter popup)","Titolo": "Title","Se compili almeno un campo, il riquadro dell'inverter diventa cliccabile e apre queste impostazioni. La password è quella della sezione «Inverter».": "If you fill in at least one field, the inverter box becomes clickable and opens these settings. The password is the one in the \"Inverter\" section.","Impostazioni (select / number)": "Settings (select / number)","+ Aggiungi impostazione": "+ Add setting","Interruttori": "Switches","+ Aggiungi interruttore": "+ Add switch","Letture": "Readings","+ Aggiungi lettura": "+ Add reading","Lingua": "Language","Fotovoltaico": "Photovoltaic","Sopra il titolo": "Above the title","ENERGIA": "ENERGY","Modalità": "Mode","Singolo inverter": "Single inverter","Multi inverter (fino a 3, uno per fase)": "Multi inverter (up to 3, one per phase)","Multi inverter: ogni inverter ha la sua fase di rete, i suoi MPPT, la sua batteria e le sue utenze. La sezione «Rete» resta quella della rete totale (se vuota la calcolo sommando le fasi).": "Multi inverter: each inverter has its own grid phase, MPPTs, battery and loads. The \"Grid\" section stays the total grid (if empty it is computed by summing the phases).","Batteria unica collegata a più inverter: la capacità totale e la carica residua desiderata si impostano solo nel primo inverter (per i tempi di carica/scarica uso quella capacità; le potenze le sommo da tutti gli inverter)": "Single battery shared by several inverters: set the total capacity and desired remaining charge only on the first inverter (charge/discharge times use that capacity; powers are summed across all inverters)","Generale": "General","Fonti e casa": "Sources and home","Nessuna utenza. Ne puoi aggiungere fino a {0}: ognuna ha la sua linea animata e la sua quota sul consumo.": "No loads. You can add up to {0}: each has its own animated line and its share of consumption.","Inverter ({0}/{1})": "Inverters ({0}/{1})","Nessun inverter. Aggiungine fino a {0} (uno per fase).": "No inverters. Add up to {0} (one per phase).","+ Aggiungi inverter": "+ Add inverter","Indicatori ({0}/{1})": "Indicators ({0}/{1})","Aspetto": "Look","Anello": "Ring","Tessere con barra": "Tiles with bar","Barra a soglie visibili": "Bar with visible thresholds","Anello a soglie visibili": "Ring with visible thresholds","Nessun indicatore. Ne puoi aggiungere fino a {0} (3 file da 6 su schermo largo). Toccandoli la card mostra lo storico a 24 ore e 7 giorni.": "No indicators. You can add up to {0} (3 rows of 6 on a wide screen). Tapping them shows the 24-hour and 7-day history.","+ Aggiungi indicatore": "+ Add indicator","Titolo delle letture": "Readings title","Letture (Inverter FV)": "Readings (PV inverter)","Password": "Password","Proteggi con password": "Protect with password","Password (solo cifre)": "Password (digits only)","Si riblocca dopo (secondi)": "Relocks after (seconds)","Proteggi le impostazioni": "Protect the settings","Proteggi gli interruttori": "Protect the switches","Una sola password sblocca tutto per il tempo indicato. Serve a evitare i tocchi involontari: la password resta scritta nella configurazione della plancia, quindi non è una protezione di sicurezza.": "A single password unlocks everything for the time set. It is meant to prevent accidental taps: the password is stored in the dashboard configuration, so it is not a security protection.","Inverter: impostazioni, interruttori, letture": "Inverter: settings, switches, readings","STORICO POTENZE": "POWER HISTORY","Altezza del grafico (px)": "Chart height (px)","Stile": "Style","Linee": "Lines","Linee con area": "Lines with area","Intervalli selezionabili": "Selectable ranges","Serie ({0}/{1})": "Series ({0}/{1})","+ Aggiungi serie": "+ Add series","Storico potenze": "Power history","Versione installata": "Installed version","Se dopo un aggiornamento qui vedi ancora il numero vecchio, la pagina sta usando il file in cache: controlla che la risorsa punti al file nuovo e ricarica.": "If after an update you still see the old number here, the page is using the cached file: check that the resource points to the new file and reload.","Informazioni": "About","24 H": "24 H","7 G": "7 D","30 G": "30 D","24 ore": "24 hours","7 giorni": "7 days","30 giorni": "30 days","Secondo MPPT (opzionale)": "Second MPPT (optional)","Terzo MPPT (opzionale)": "Third MPPT (optional)","Quarto MPPT (opzionale)": "Fourth MPPT (optional)","QUOTA SUL CONSUMO": "SHARE OF CONSUMPTION","IMPOSTAZIONI INVERTER": "INVERTER SETTINGS","ULTIME 24 ORE": "LAST 24 HOURS","ULTIMI 7 GIORNI": "LAST 7 DAYS","ULTIMI 30 GIORNI": "LAST 30 DAYS","ENERGIA CONSUMATA": "ENERGY CONSUMED","ENERGIA PRODOTTA": "ENERGY PRODUCED","ENERGIA PRELEVATA": "ENERGY IMPORTED","ENERGIA BATTERIA · ENTRATA E USCITA": "BATTERY ENERGY · IN AND OUT","ENERGIA DELLA RETE · PRELIEVO E IMMISSIONE": "GRID ENERGY · IMPORT AND EXPORT","rispetto a ieri": "vs yesterday","rispetto alla settimana prima": "vs the previous week","rispetto al mese prima": "vs the previous month","rispetto all'anno prima": "vs the previous year","PRELEVATA": "IMPORTED","IMMESSA": "EXPORTED","Caricamento…": "Loading…","Impossibile leggere le statistiche di energia": "Could not read the energy statistics","Nessun dato di energia in questo periodo": "No energy data for this period","Tocca una barra per il dettaglio": "Tap a bar for details","SALDO": "BALANCE","MEDIA / ORA": "AVG / HOUR","MEDIA / MESE": "AVG / MONTH","MEDIA / GIORNO": "AVG / DAY","PICCO": "PEAK","MINIMO": "MINIMUM","GIORNO": "DAY","SETTIMANA": "WEEK","MESE": "MONTH","ANNO": "YEAR","OGGI": "TODAY","Periodo precedente": "Previous period","Periodo successivo": "Next period","Scegli la data": "Pick a date","Energia consumata: contatore in kWh (opzionale)": "Energy consumed: meter in kWh (optional)","Energia prodotta: contatore in kWh (opzionale)": "Energy produced: meter in kWh (optional)","Energia prelevata dalla rete: contatore in kWh (opzionale)": "Energy imported from the grid: meter in kWh (optional)","Energia immessa in rete: contatore in kWh (opzionale)": "Energy exported to the grid: meter in kWh (optional)","Energia in carica: contatore in kWh (opzionale)": "Energy charged: meter in kWh (optional)","Energia in scarica: contatore in kWh (opzionale)": "Energy discharged: meter in kWh (optional)","I contatori di energia (kWh) devono essere sensori con totale che cresce (state_class total_increasing o total), registrati da Home Assistant. Con un contatore configurato, il popup mostra l'energia per giorno, settimana, mese e anno.": "Energy meters (kWh) must be sensors with an ever-increasing total (state_class total_increasing or total), recorded by Home Assistant. With a meter set, the popup shows the energy per day, week, month and year.","MPPT · ENERGIA TOTALE": "MPPT · TOTAL ENERGY","SOMMA DEGLI {0} MPPT": "SUM OF {0} MPPTs","BATTERIE · ENERGIA TOTALE": "BATTERIES · TOTAL ENERGY","SOMMA DELLE 2 BATTERIE": "SUM OF THE 2 BATTERIES","Energia totale MPPT": "Total MPPT energy","Energia totale batterie": "Total battery energy","Energia prodotta totale di tutti gli MPPT: contatore in kWh (opzionale, con 2 o più MPPT)": "Total energy produced by all MPPTs: meter in kWh (optional, with 2 or more MPPTs)","Energia in carica totale delle due batterie: contatore in kWh (opzionale)": "Total energy charged into the two batteries: meter in kWh (optional)","Energia in scarica totale delle due batterie: contatore in kWh (opzionale)": "Total energy discharged from the two batteries: meter in kWh (optional)","Se hai un solo contatore che somma tutti gli MPPT, mettilo qui: sul punto dove le linee si uniscono compare un pallino che apre l'energia per giorno, settimana, mese e anno. Con un solo MPPT usa il campo qui sopra.": "If you have a single meter that sums all MPPTs, put it here: a small dot appears where the lines join and opens the energy per day, week, month and year. With a single MPPT use the field above.","Se hai un solo contatore che somma le due batterie, mettilo nei due campi «totale»: sul punto dove le linee delle batterie si uniscono compare un pallino che apre l'energia entrata e uscita. Con una sola batteria usa i campi della Batteria 1.": "If you have a single meter that sums the two batteries, put it in the two «total» fields: a small dot appears where the battery lines join and opens the energy in and out. With a single battery use the Battery 1 fields.","AUTO {0}": "CAR {0}","Nome del SOC 1 (es. Renault 5)": "Name of SOC 1 (e.g. Renault 5)","Carica della seconda auto in % (opzionale)": "Second car charge in % (optional)","Nome del SOC 2": "Name of SOC 2","Carica della terza auto in % (opzionale)": "Third car charge in % (optional)","Nome del SOC 3": "Name of SOC 3","Con più di un SOC il popup mostra una scheda per ciascuno (con il nome che scegli) e sulla tile i valori si alternano ogni 5 secondi con la dicitura AUTO 1, AUTO 2, AUTO 3.": "With more than one SOC the popup shows a tab for each (with the name you choose) and on the tile the values alternate every 5 seconds labelled CAR 1, CAR 2, CAR 3.","SPEGNI": "TURN OFF","ACCENDI": "TURN ON","AVVIA": "START","ACCESO": "ON","INVIO COMANDO…": "SENDING COMMAND…","Pulsante di comando nel popup": "Control button in the popup","Entità da comandare (opzionale)": "Entity to control (optional)","Nome del pulsante": "Button name","Nome del pulsante quando è attivo": "Button name when active","Nel popup di questa utenza compare un pulsante per accendere o spegnere l'entità scelta (switch, luce, ecc.). Con button, input_button, script e scene il pulsante la avvia soltanto.": "The popup of this load shows a button to turn the chosen entity on or off (switch, light, etc.). With button, input_button, script and scene the button only starts it.","Entità non disponibile o non valida": "Entity unavailable or invalid","AGGIORNATO {0}": "UPDATED {0}","{0} s fa": "{0} s ago","{0} min fa": "{0} min ago","{0} h {1} min fa": "{0} h {1} min ago","Allerta entità": "Entity alert","MPPT": "MPPT","Casa e utenze": "Home and loads","Mostra un triangolo giallo sul cerchio o riquadro dell'entità quando Home Assistant la segnala non disponibile (unavailable), sconosciuta (unknown), vuota o inesistente. Scegli le sezioni da controllare.": "Shows a yellow triangle on the entity's circle or tile when Home Assistant reports it as unavailable, unknown, empty or non-existent. Choose which sections to monitor.","+ Aggiungi bolletta": "+ Add bill","+ Aggiungi fascia oraria": "+ Add time band","A fasce": "By time bands","A fine periodo, a questo ritmo:": "At the end of the period, at this pace:","Accisa": "Excise duty","Accisa (€/kWh)": "Excise duty (€/kWh)","Al (escluso)": "To (excluded)","Alle ore": "Until hour","Altre voci": "Other items","Apri bollette": "Open bills","BOLLETTA": "BILL","BOLLETTE": "BILLS","Bimestrale": "Every two months","Biorario": "Two-band","COSTO MEDIO": "AVERAGE COST","Calcolo bolletta": "Bill calculation","Canone TV": "TV licence fee","Canone TV (€/mese)": "TV licence fee (€/month)","Canone TV (€/anno, 10 rate gen–ott)": "TV licence fee (€/year, 10 instalments Jan–Oct)","Costi e bolletta": "Costs and bill","Dal": "From","Dalle ore": "From hour","Data di partenza del calcolo (inizio di un periodo di fatturazione)": "Calculation start date (start of a billing period)","Domenica e festivi": "Sunday and holidays","ENERGIA IMMESSA IN RETE": "ENERGY FED INTO THE GRID","Energia": "Energy","Energia (kWh)": "Energy (kWh)","F23": "F23","Fascia": "Band","Fatturazione": "Billing","GIORNO {0}/{1}": "DAY {0}/{1}","Giorni": "Days","Giorno": "Day","IMMESSI OGGI": "FED IN TODAY","IVA (%)": "VAT (%)","IVA {0} %": "VAT {0} %","Imposta il prezzo nell'editor": "Set the price in the editor","Lun–Sab": "Mon–Sat","Lun–Ven": "Mon–Fri","Massimo {0} bollette (un anno).": "At most {0} bills (one year).","Mensile": "Monthly","Mostra il calcolo della bolletta": "Show the bill calculation","Mostra ricavo energia immessa": "Show revenue from energy fed in","Nessuna bolletta nello storico. Aggiungile dall'editor della card (Costi e bolletta).": "No bills in the history. Add them from the card editor (Costs and bill).","Notte e festivi": "Night and holidays","Orari": "Hours","Orari delle fasce": "Band hours","Orari interi (0–24). Quello che non rientra nelle fasce indicate va all'ultima fascia: {0}. I festivi nazionali contano come domenica.": "Whole hours (0–24). Anything outside the listed bands goes to the last band: {0}. National holidays count as Sunday.","PRELIEVO PER FASE": "DRAW PER PHASE","PROSSIMA BOLLETTA · STIMA IN TEMPO REALE": "NEXT BILL · REAL-TIME ESTIMATE","Per la stima della bolletta scegli il contatore dell'energia prelevata della Rete (Fonti e casa).": "To estimate the bill, choose the Grid energy-drawn meter (Sources and home).","Personalizzati": "Custom","Potenza impegnata (kW)": "Contracted power (kW)","Prezzi": "Prices","Prezzo energia (€/kWh)": "Energy price (€/kWh)","Prezzo energia immessa in rete (€/kWh)": "Price of energy fed into the grid (€/kWh)","Prezzo fisso": "Fixed price","Prezzo {0} (€/kWh)": "{0} price (€/kWh)","Quota fissa": "Fixed charge","Quota fissa (€/mese)": "Fixed charge (€/month)","Quota potenza": "Power charge","Quota potenza (€/kW al mese)": "Power charge (€/kW per month)","RICAVO": "REVENUE","Rete e oneri": "Network and charges","Rete e oneri (€/kWh)": "Network and charges (€/kWh)","Ricavo energia immessa": "Revenue from energy fed in","STORICO · ULTIMI 12 MESI · {0} BOLLETTE": "HISTORY · LAST 12 MONTHS · {0} BILLS","Sabato": "Saturday","Serve il contatore dell'energia immessa nella Rete (Fonti e casa). Sotto il cerchio Rete compaiono i kWh immessi oggi e nel popup della Rete il ricavo.": "It needs the Grid energy-fed-in meter (Sources and home). Under the Grid circle the kWh fed in today appear, and the revenue in the Grid popup.","Serve il contatore dell'energia prelevata della Rete (Fonti e casa). Il ricavo dell'energia immessa non fa parte della bolletta.": "It needs the Grid energy-drawn meter (Sources and home). Revenue from energy fed in is not part of the bill.","Standard (ARERA)": "Standard (ARERA)","Standard: F1 lun–ven 8–19; F2 lun–ven 7–8 e 19–23, sabato 7–23; F3 il resto (notte, domenica e festivi).": "Standard: F1 Mon–Fri 8–19; F2 Mon–Fri 7–8 and 19–23, Saturday 7–23; F3 the rest (night, Sunday and holidays).","Standard: F1 lun–ven 8–19; F23 il resto (sera, notte, sabato, domenica e festivi).": "Standard: F1 Mon–Fri 8–19; F23 the rest (evening, night, Saturday, Sunday and holidays).","Standard: giorno lun–sab 7–23; notte e festivi il resto.": "Standard: day Mon–Sat 7–23; night and holidays the rest.","Storico bollette": "Bill history","TOTALE 12 MESI": "12-MONTH TOTAL","Tipo di contratto": "Contract type","Totale bolletta": "Bill total","Totale da pagare": "Total to pay","Tutti i giorni": "Every day","Valuta": "Currency","al giorno": "per day","finora": "so far","giorno {0} di {1}": "day {0} of {1}","nel periodo": "in the period","per kWh, tutto compreso": "per kWh, all included","prima bolletta dello storico": "first bill in the history","rispetto alla precedente": "compared with the previous one","{0} bollette": "{0} bills","CARICHI": "LOADS","Percentuale dei carichi sul totale delle uscite degli inverter (invece che sull'inverter che li alimenta)": "Load percentage on the total of all inverter outputs (instead of the inverter that feeds them)"},
  es: {"STIMATA": "ESTIMADA","Calcolata in automatico: modificala per inserire l'importo reale.": "Calculada automáticamente: edítala para introducir el importe real.","STIMATA: calcolata in automatico con i tuoi prezzi. Per l'importo reale modificala nell'editor (Costi e bolletta).": "ESTIMADA: calculada automáticamente con tus precios. Para el importe real, edítala en el editor (Costes y factura).","A fine periodo la bolletta viene aggiunta da sola come STIMATA; quando vuoi, modificala con l'importo reale.": "Al final del periodo la factura se añade sola como ESTIMADA; cuando quieras, edítala con el importe real.","Automatica (come Home Assistant)": "Automático (igual que Home Assistant)","Fulmine": "Rayo","Ventola": "Ventilador","Lavatrice": "Lavadora","Cucina": "Cocina","Computer": "Ordenador","Presa": "Enchufe","Televisore": "Televisor","Auto": "Coche","Luce": "Luz","Caldaia": "Caldera","Clima": "Clima","Acqua": "Agua","Pompa": "Bomba","Stufa": "Estufa","Inverter": "Inversor","Casa": "Casa","Contatore": "Contador","Configurazione mancante": "Falta la configuración","Elemento": "Elemento","Chiudi": "Cerrar","Solare": "Solar","Batteria": "Batería","Batteria {0}": "Batería {0}","Storico {0}": "Histórico {0}","Sottocarico": "Subcarga","Sottocarichi": "Subcargas","Sottocarichi {0}": "Subcargas {0}","UTENZA": "CARGA","Inverter {0}": "Inversor {0}","TOCCA PER LO STORICO": "TOCA PARA EL HISTÓRICO","{0} · SOTTOCARICHI": "{0} · SUBCARGAS","{0} SOTTOCARICO": "{0} SUBCARGA","{0} SOTTOCARICHI": "{0} SUBCARGAS","Carichi non monitorati {0}": "Cargas no monitorizadas {0}","Carichi non monitorati": "Cargas no monitorizadas","Impostazioni {0}": "Ajustes {0}","IN {0}": "ENT {0}","IMPOSTAZIONI": "AJUSTES","Impostazioni inverter": "Ajustes del inversor","OUT {0}": "SAL {0}","IMPOSTA": "AJUSTAR","BATTERIA PIENA": "BATERÍA LLENA","PIENA TRA {0}": "LLENA EN {0}","SOTTO IL {0} %": "BAJO EL {0} %","{0} % TRA {1}": "{0} % EN {1}","{0} carica": "{0} carga","{0} potenza": "{0} potencia","Rete": "Red","INVERTER": "INVERSOR","IN": "ENT","CATENA ENERGETICA · FONTI › INVERTER › CASA › UTENZE": "CADENA ENERGÉTICA · FUENTES › INVERSOR › CASA › CARGAS","Apri l'editor della card e collega le entità: fonti, utenze, indicatori, inverter e storico.": "Abre el editor de la tarjeta y enlaza las entidades: fuentes, cargas, indicadores, inversores e histórico.","SOLARE": "SOLAR","RETE": "RED","BATTERIA": "BATERÍA","TRIFASE": "TRIFÁSICA","Rete Enel": "Red eléctrica","INVERTER {0}": "INVERSOR {0}","Fase L{0}": "Fase L{0}","Casa {0}": "Casa {0}","RETE TRIFASE": "RED TRIFÁSICA","{0} INVERTER": "{0} INVERSORES","{0} INVERTER · {0} CASE CON LE LORO UTENZE": "{0} INVERSORES · {0} CASAS CON SUS CARGAS","Dettaglio batterie": "Detalle de baterías","BATTERIE": "BATERÍAS","IN CARICA": "CARGANDO","IN SCARICA": "DESCARGANDO","FERMA": "EN REPOSO","BATTERIE · TOTALE": "BATERÍAS · TOTAL","{0} batteria, una per inverter": "{0} batería, una por inversor","{0} batterie, una per inverter": "{0} baterías, una por inversor","IN EQUILIBRIO": "EN EQUILIBRIO","POTENZA NETTA": "POTENCIA NETA","CARICA MEDIA": "CARGA MEDIA","ENTRA · {0} batt.": "CARGAN · {0} bat.","ESCE · {0} batt.": "DESCARGAN · {0} bat.","INDICATORI": "INDICADORES","Carico lo storico…": "Cargando el histórico…","Nessun dato nel periodo": "Sin datos en el periodo","MIN": "MÍN","MEDIA": "MEDIA","MAX": "MÁX","non disp.": "n/d","POTENZA": "POTENCIA","TENSIONE": "TENSIÓN","CORRENTE": "CORRIENTE","PRELIEVO DALLA RETE": "CONSUMO DE LA RED","IMMISSIONE IN RETE": "INYECCIÓN A LA RED","INGRESSO SOLARE": "ENTRADA SOLAR","SOC AUTO": "SOC COCHE","SOGLIE": "UMBRALES","Chiudi storico": "Cerrar histórico","STORICO": "HISTÓRICO","Aggiungi le serie del grafico dall'editor.": "Añade las series del gráfico desde el editor.","PASSWORD PER MODIFICARE LE IMPOSTAZIONI": "CONTRASEÑA PARA CAMBIAR LOS AJUSTES","PASSWORD PER COMANDARE GLI INTERRUTTORI": "CONTRASEÑA PARA ACCIONAR LOS INTERRUPTORES","Annulla": "Cancelar","Cancella": "Borrar","PASSWORD ERRATA": "CONTRASEÑA INCORRECTA","SBLOCCATO · SI RIBLOCCA TRA {0} s": "DESBLOQUEADO · SE BLOQUEA EN {0} s","BLOCCA": "BLOQUEAR","IMPOSTAZIONI E INTERRUTTORI PROTETTI DA PASSWORD": "AJUSTES E INTERRUPTORES PROTEGIDOS CON CONTRASEÑA","Diminuisci": "Disminuir","Aumenta": "Aumentar","Sblocca con password per modificare": "Desbloquea con contraseña para modificar","NON DISPONIBILE": "NO DISPONIBLE","ATTIVO": "ACTIVO","SPENTO": "APAGADO","Inverter FV": "Inversor FV","Aggiungi impostazioni, interruttori e letture dall'editor.": "Añade ajustes, interruptores y lecturas desde el editor.","INVERTER · IMPOSTAZIONI": "INVERSOR · AJUSTES","ONLINE": "EN LÍNEA","OFFLINE": "SIN CONEXIÓN","dominio.nome_entita": "dominio.nombre_entidad","↑ Su": "↑ Subir","↓ Giù": "↓ Bajar","Elimina": "Eliminar","da configurare": "por configurar","Potenza del sottocarico (W o kW)": "Potencia de la subcarga (W o kW)","Nome": "Nombre","Sottocarichi ({0}/{1})": "Subcargas ({0}/{1})","Dettagliano questa utenza: sul quadrato appare un pulsante che apre l'elenco dei sottocarichi con il loro storico.": "Detallan esta carga: en el recuadro aparece un botón que abre la lista de subcargas con su histórico.","+ Aggiungi sottocarico": "+ Añadir subcarga","Potenza prodotta (W o kW) — con il secondo MPPT compilato è quella dell'MPPT 1": "Potencia producida (W o kW) — con el segundo MPPT rellenado es la del MPPT 1","Testo sotto il valore": "Texto bajo el valor","Tensione di stringa (V, opzionale: appare nel grafico)": "Tensión de string (V, opcional: aparece en el gráfico)","Corrente di stringa (A, opzionale: se vuota la calcolo da potenza / tensione)": "Corriente de string (A, opcional: si está vacía se calcula con potencia / tensión)","Potenza dell'MPPT {0} (W o kW)": "Potencia del MPPT {0} (W o kW)","Tensione di stringa (V, opzionale)": "Tensión de string (V, opcional)","Corrente di stringa (A, opzionale)": "Corriente de string (A, opcional)","Con più MPPT la card mostra i cerchi affiancati che si uniscono in una sola linea verso l'inverter; il totale solare è la somma (fino a 4 MPPT).": "Con varios MPPT la tarjeta muestra los círculos en paralelo que se unen en una sola línea hacia el inversor; el total solar es la suma (hasta 4 MPPT).","Potenza prelevata dalla rete (W o kW)": "Potencia tomada de la red (W o kW)","Tensione di rete (opzionale)": "Tensión de red (opcional)","Frequenza di rete in Hz (opzionale, mostrata nel riquadro inverter)": "Frecuencia de red en Hz (opcional, se muestra en el recuadro del inversor)","Potenza positiva = prelievo dalla rete (togli la spunta se il tuo sensore è al contrario). L'immissione in rete è negativa e il grafico la mostra sotto lo zero.": "Potencia positiva = consumo de la red (desmarca si tu sensor funciona al revés). La inyección a la red es negativa y el gráfico la muestra bajo cero.","Potenza della batteria (W o kW)": "Potencia de la batería (W o kW)","Carica della batteria (%)": "Carga de la batería (%)","Batteria 1": "Batería 1","Capacità totale del pacco (kWh)": "Capacidad total del pack (kWh)","es. 10,24": "p. ej. 10,24","Carica residua desiderata (%)": "Carga residual deseada (%)","La capacità è quella di tutto il pacco (somma delle batterie). Con la capacità impostata compare il tempo stimato: in carica, quanto manca al 100 %; in scarica, quanto resta prima della carica residua desiderata.": "La capacidad es la de todo el pack (suma de las baterías). Con la capacidad indicada aparece el tiempo estimado: al cargar, lo que falta para el 100 %; al descargar, lo que queda antes de la carga residual deseada.","Potenza positiva = in carica (togli la spunta se il tuo sensore è al contrario)": "Potencia positiva = cargando (desmarca si tu sensor funciona al revés)","Potenza della batteria 2 (W o kW)": "Potencia de la batería 2 (W o kW)","Carica della batteria 2 (%)": "Carga de la batería 2 (%)","Batteria 2": "Batería 2","Se compilata, la card mostra due cerchi batteria affiancati. Se lasci vuoto ne mostra uno solo.": "Si se rellena, la tarjeta muestra dos círculos de batería en paralelo. Si se deja vacía muestra solo uno.","Batteria 2 (opzionale)": "Batería 2 (opcional)","Consumo della casa (opzionale: se vuoto lo calcolo dai flussi)": "Consumo de la casa (opcional: si está vacío se calcula con los flujos)","Potenza dell'utenza (W o kW)": "Potencia de la carga (W o kW)","Icona": "Icono","Testo sotto il nome (opzionale)": "Texto bajo el nombre (opcional)","es. CLIMA": "p. ej. CLIMA","…oppure entità da mostrare sotto il nome (es. umidità)": "…o entidad a mostrar bajo el nombre (p. ej. humedad)","Carica dell'auto in % (per auto / wallbox, opzionale: appare sopra e nel grafico)": "Carga del coche en % (para coche / wallbox, opcional: aparece arriba y en el gráfico)","Da questo valore in su": "Desde este valor en adelante","Colore": "Color","Entità": "Entidad","Unità (vuoto = quella dell'entità)": "Unidad (vacío = la de la entidad)","Minimo della barra": "Mínimo de la barra","Massimo della barra": "Máximo de la barra","Decimali": "Decimales","auto": "auto","Colori e soglie": "Colores y umbrales","Colore di base (sotto la prima soglia)": "Color base (bajo el primer umbral)","Nessuna soglia: l'indicatore resta sempre del colore di base.": "Sin umbrales: el indicador mantiene siempre el color base.","+ Aggiungi soglia": "+ Añadir umbral","Disattiva le soglie di questo indicatore (le righe restano salvate)": "Desactivar los umbrales de este indicador (las filas se conservan)","Ogni soglia vale «da questo valore in su». Le soglie si possono mettere in qualsiasi ordine e quante ne vuoi.": "Cada umbral significa «desde este valor en adelante». Los umbrales pueden ir en cualquier orden y puedes poner los que quieras.","Entità (select o number)": "Entidad (select o number)","Aspetto (per le select)": "Aspecto (para los select)","Automatico (3 opzioni o meno: pulsanti, altrimenti elenco)": "Automático (3 opciones o menos: botones; si no, lista)","Pulsanti": "Botones","Elenco a discesa": "Lista desplegable","Entità (W o kW)": "Entidad (W o kW)","MPPT {0} (opzionale)": "MPPT {0} (opcional)","MPPT {0}": "MPPT {0}","Potenza (W o kW)": "Potencia (W o kW)","Carica dell'auto in % (per auto / wallbox, opzionale)": "Carga del coche en % (para coche / wallbox, opcional)","Fase di rete": "Fase de red","Potenza della fase (W o kW)": "Potencia de la fase (W o kW)","Tensione della fase (opzionale)": "Tensión de la fase (opcional)","Potenza positiva = prelievo dalla rete (togli la spunta se il tuo sensore è al contrario: l'immissione in rete diventa negativa nel grafico)": "Potencia positiva = consumo de la red (desmarca si tu sensor funciona al revés: la inyección a la red pasa a ser negativa en el gráfico)","Solare (MPPT)": "Solar (MPPT)","Capacità (kWh)": "Capacidad (kWh)","es. 5,12": "p. ej. 5,12","Utenze ({0}/{1})": "Cargas ({0}/{1})","+ Aggiungi utenza": "+ Añadir carga","Impostazioni inverter (popup dell'inverter)": "Ajustes del inversor (ventana del inversor)","Titolo": "Título","Se compili almeno un campo, il riquadro dell'inverter diventa cliccabile e apre queste impostazioni. La password è quella della sezione «Inverter».": "Si rellenas al menos un campo, el recuadro del inversor se vuelve pulsable y abre estos ajustes. La contraseña es la de la sección «Inversor».","Impostazioni (select / number)": "Ajustes (select / number)","+ Aggiungi impostazione": "+ Añadir ajuste","Interruttori": "Interruptores","+ Aggiungi interruttore": "+ Añadir interruptor","Letture": "Lecturas","+ Aggiungi lettura": "+ Añadir lectura","Lingua": "Idioma","Fotovoltaico": "Fotovoltaica","Sopra il titolo": "Sobre el título","ENERGIA": "ENERGÍA","Modalità": "Modo","Singolo inverter": "Inversor único","Multi inverter (fino a 3, uno per fase)": "Multi inversor (hasta 3, uno por fase)","Multi inverter: ogni inverter ha la sua fase di rete, i suoi MPPT, la sua batteria e le sue utenze. La sezione «Rete» resta quella della rete totale (se vuota la calcolo sommando le fasi).": "Multi inversor: cada inversor tiene su fase de red, sus MPPT, su batería y sus cargas. La sección «Red» sigue siendo la de la red total (si está vacía se calcula sumando las fases).","Batteria unica collegata a più inverter: la capacità totale e la carica residua desiderata si impostano solo nel primo inverter (per i tempi di carica/scarica uso quella capacità; le potenze le sommo da tutti gli inverter)": "Batería única conectada a varios inversores: la capacidad total y la carga residual deseada se indican solo en el primer inversor (para los tiempos de carga/descarga se usa esa capacidad; las potencias se suman de todos los inversores)","Generale": "General","Fonti e casa": "Fuentes y casa","Nessuna utenza. Ne puoi aggiungere fino a {0}: ognuna ha la sua linea animata e la sua quota sul consumo.": "Ninguna carga. Puedes añadir hasta {0}: cada una tiene su línea animada y su cuota del consumo.","Inverter ({0}/{1})": "Inversores ({0}/{1})","Nessun inverter. Aggiungine fino a {0} (uno per fase).": "Ningún inversor. Añade hasta {0} (uno por fase).","+ Aggiungi inverter": "+ Añadir inversor","Indicatori ({0}/{1})": "Indicadores ({0}/{1})","Aspetto": "Aspecto","Anello": "Anillo","Tessere con barra": "Mosaicos con barra","Barra a soglie visibili": "Barra con umbrales visibles","Anello a soglie visibili": "Anillo con umbrales visibles","Nessun indicatore. Ne puoi aggiungere fino a {0} (3 file da 6 su schermo largo). Toccandoli la card mostra lo storico a 24 ore e 7 giorni.": "Ningún indicador. Puedes añadir hasta {0} (3 filas de 6 en pantalla ancha). Al tocarlos la tarjeta muestra el histórico de 24 horas y 7 días.","+ Aggiungi indicatore": "+ Añadir indicador","Titolo delle letture": "Título de las lecturas","Letture (Inverter FV)": "Lecturas (inversor FV)","Password": "Contraseña","Proteggi con password": "Proteger con contraseña","Password (solo cifre)": "Contraseña (solo cifras)","Si riblocca dopo (secondi)": "Se bloquea de nuevo tras (segundos)","Proteggi le impostazioni": "Proteger los ajustes","Proteggi gli interruttori": "Proteger los interruptores","Una sola password sblocca tutto per il tempo indicato. Serve a evitare i tocchi involontari: la password resta scritta nella configurazione della plancia, quindi non è una protezione di sicurezza.": "Una sola contraseña lo desbloquea todo durante el tiempo indicado. Sirve para evitar toques accidentales: la contraseña queda escrita en la configuración del panel, así que no es una protección de seguridad.","Inverter: impostazioni, interruttori, letture": "Inversor: ajustes, interruptores, lecturas","STORICO POTENZE": "HISTÓRICO DE POTENCIAS","Altezza del grafico (px)": "Altura del gráfico (px)","Stile": "Estilo","Linee": "Líneas","Linee con area": "Líneas con área","Intervalli selezionabili": "Intervalos seleccionables","Serie ({0}/{1})": "Series ({0}/{1})","+ Aggiungi serie": "+ Añadir serie","Storico potenze": "Histórico de potencias","Versione installata": "Versión instalada","Se dopo un aggiornamento qui vedi ancora il numero vecchio, la pagina sta usando il file in cache: controlla che la risorsa punti al file nuovo e ricarica.": "Si tras una actualización sigues viendo aquí el número antiguo, la página está usando el archivo en caché: comprueba que el recurso apunte al archivo nuevo y recarga.","Informazioni": "Información","24 H": "24 H","7 G": "7 D","30 G": "30 D","24 ore": "24 horas","7 giorni": "7 días","30 giorni": "30 días","Secondo MPPT (opzionale)": "Segundo MPPT (opcional)","Terzo MPPT (opzionale)": "Tercer MPPT (opcional)","Quarto MPPT (opzionale)": "Cuarto MPPT (opcional)","QUOTA SUL CONSUMO": "PARTE DEL CONSUMO","IMPOSTAZIONI INVERTER": "AJUSTES DEL INVERSOR","ULTIME 24 ORE": "ÚLTIMAS 24 HORAS","ULTIMI 7 GIORNI": "ÚLTIMOS 7 DÍAS","ULTIMI 30 GIORNI": "ÚLTIMOS 30 DÍAS","ENERGIA CONSUMATA": "ENERGÍA CONSUMIDA","ENERGIA PRODOTTA": "ENERGÍA PRODUCIDA","ENERGIA PRELEVATA": "ENERGÍA TOMADA DE LA RED","ENERGIA BATTERIA · ENTRATA E USCITA": "ENERGÍA DE LA BATERÍA · ENTRADA Y SALIDA","ENERGIA DELLA RETE · PRELIEVO E IMMISSIONE": "ENERGÍA DE LA RED · CONSUMO E INYECCIÓN","rispetto a ieri": "respecto a ayer","rispetto alla settimana prima": "respecto a la semana anterior","rispetto al mese prima": "respecto al mes anterior","rispetto all'anno prima": "respecto al año anterior","PRELEVATA": "TOMADA","IMMESSA": "INYECTADA","Caricamento…": "Cargando…","Impossibile leggere le statistiche di energia": "No se pudieron leer las estadísticas de energía","Nessun dato di energia in questo periodo": "No hay datos de energía en este periodo","Tocca una barra per il dettaglio": "Toca una barra para ver el detalle","SALDO": "SALDO","MEDIA / ORA": "MEDIA / HORA","MEDIA / MESE": "MEDIA / MES","MEDIA / GIORNO": "MEDIA / DÍA","PICCO": "PICO","MINIMO": "MÍNIMO","GIORNO": "DÍA","SETTIMANA": "SEMANA","MESE": "MES","ANNO": "AÑO","OGGI": "HOY","Periodo precedente": "Periodo anterior","Periodo successivo": "Periodo siguiente","Scegli la data": "Elige la fecha","Energia consumata: contatore in kWh (opzionale)": "Energía consumida: contador en kWh (opcional)","Energia prodotta: contatore in kWh (opzionale)": "Energía producida: contador en kWh (opcional)","Energia prelevata dalla rete: contatore in kWh (opzionale)": "Energía tomada de la red: contador en kWh (opcional)","Energia immessa in rete: contatore in kWh (opzionale)": "Energía inyectada a la red: contador en kWh (opcional)","Energia in carica: contatore in kWh (opzionale)": "Energía en carga: contador en kWh (opcional)","Energia in scarica: contatore in kWh (opzionale)": "Energía en descarga: contador en kWh (opcional)","I contatori di energia (kWh) devono essere sensori con totale che cresce (state_class total_increasing o total), registrati da Home Assistant. Con un contatore configurato, il popup mostra l'energia per giorno, settimana, mese e anno.": "Los contadores de energía (kWh) deben ser sensores con un total que solo crece (state_class total_increasing o total), registrados por Home Assistant. Con un contador configurado, la ventana muestra la energía por día, semana, mes y año.","MPPT · ENERGIA TOTALE": "MPPT · ENERGÍA TOTAL","SOMMA DEGLI {0} MPPT": "SUMA DE LOS {0} MPPT","BATTERIE · ENERGIA TOTALE": "BATERÍAS · ENERGÍA TOTAL","SOMMA DELLE 2 BATTERIE": "SUMA DE LAS 2 BATERÍAS","Energia totale MPPT": "Energía total MPPT","Energia totale batterie": "Energía total baterías","Energia prodotta totale di tutti gli MPPT: contatore in kWh (opzionale, con 2 o più MPPT)": "Energía total producida por todos los MPPT: contador en kWh (opcional, con 2 o más MPPT)","Energia in carica totale delle due batterie: contatore in kWh (opzionale)": "Energía total de carga de las dos baterías: contador en kWh (opcional)","Energia in scarica totale delle due batterie: contatore in kWh (opzionale)": "Energía total de descarga de las dos baterías: contador en kWh (opcional)","Se hai un solo contatore che somma tutti gli MPPT, mettilo qui: sul punto dove le linee si uniscono compare un pallino che apre l'energia per giorno, settimana, mese e anno. Con un solo MPPT usa il campo qui sopra.": "Si tienes un solo contador que suma todos los MPPT, ponlo aquí: en el punto donde se unen las líneas aparece un puntito que abre la energía por día, semana, mes y año. Con un solo MPPT usa el campo de arriba.","Se hai un solo contatore che somma le due batterie, mettilo nei due campi «totale»: sul punto dove le linee delle batterie si uniscono compare un pallino che apre l'energia entrata e uscita. Con una sola batteria usa i campi della Batteria 1.": "Si tienes un solo contador que suma las dos baterías, ponlo en los dos campos «total»: en el punto donde se unen las líneas de las baterías aparece un puntito que abre la energía de entrada y salida. Con una sola batería usa los campos de la Batería 1.","AUTO {0}": "COCHE {0}","Nome del SOC 1 (es. Renault 5)": "Nombre del SOC 1 (p. ej. Renault 5)","Carica della seconda auto in % (opzionale)": "Carga del segundo coche en % (opcional)","Nome del SOC 2": "Nombre del SOC 2","Carica della terza auto in % (opzionale)": "Carga del tercer coche en % (opcional)","Nome del SOC 3": "Nombre del SOC 3","Con più di un SOC il popup mostra una scheda per ciascuno (con il nome che scegli) e sulla tile i valori si alternano ogni 5 secondi con la dicitura AUTO 1, AUTO 2, AUTO 3.": "Con más de un SOC el popup muestra una pestaña para cada uno (con el nombre que elijas) y en la tarjeta los valores se alternan cada 5 segundos con la indicación COCHE 1, COCHE 2, COCHE 3.","SPEGNI": "APAGAR","ACCENDI": "ENCENDER","AVVIA": "INICIAR","ACCESO": "ENCENDIDO","INVIO COMANDO…": "ENVIANDO COMANDO…","Pulsante di comando nel popup": "Botón de control en el popup","Entità da comandare (opzionale)": "Entidad a controlar (opcional)","Nome del pulsante": "Nombre del botón","Nome del pulsante quando è attivo": "Nombre del botón cuando está activo","Nel popup di questa utenza compare un pulsante per accendere o spegnere l'entità scelta (switch, luce, ecc.). Con button, input_button, script e scene il pulsante la avvia soltanto.": "El popup de este consumo muestra un botón para encender o apagar la entidad elegida (switch, luz, etc.). Con button, input_button, script y scene el botón solo la inicia.","Entità non disponibile o non valida": "Entidad no disponible o no válida","AGGIORNATO {0}": "ACTUALIZADO {0}","{0} s fa": "hace {0} s","{0} min fa": "hace {0} min","{0} h {1} min fa": "hace {0} h {1} min","Allerta entità": "Alerta de entidad","MPPT": "MPPT","Casa e utenze": "Casa y consumos","Mostra un triangolo giallo sul cerchio o riquadro dell'entità quando Home Assistant la segnala non disponibile (unavailable), sconosciuta (unknown), vuota o inesistente. Scegli le sezioni da controllare.": "Muestra un triángulo amarillo en el círculo o recuadro de la entidad cuando Home Assistant la indica como no disponible, desconocida, vacía o inexistente. Elige las secciones a controlar.","+ Aggiungi bolletta": "+ Añadir factura","+ Aggiungi fascia oraria": "+ Añadir franja horaria","A fasce": "Por franjas","A fine periodo, a questo ritmo:": "Al final del periodo, a este ritmo:","Accisa": "Impuesto especial","Accisa (€/kWh)": "Impuesto especial (€/kWh)","Al (escluso)": "Hasta (excluido)","Alle ore": "Hasta la hora","Altre voci": "Otros conceptos","Apri bollette": "Abrir facturas","BOLLETTA": "FACTURA","BOLLETTE": "FACTURAS","Bimestrale": "Bimestral","Biorario": "Bihorario","COSTO MEDIO": "COSTE MEDIO","Calcolo bolletta": "Cálculo de la factura","Canone TV": "Canon de TV","Canone TV (€/mese)": "Canon de TV (€/mes)","Canone TV (€/anno, 10 rate gen–ott)": "Canon de TV (€/año, 10 cuotas ene–oct)","Costi e bolletta": "Costes y factura","Dal": "Desde","Dalle ore": "Desde la hora","Data di partenza del calcolo (inizio di un periodo di fatturazione)": "Fecha de inicio del cálculo (inicio de un periodo de facturación)","Domenica e festivi": "Domingo y festivos","ENERGIA IMMESSA IN RETE": "ENERGÍA INYECTADA A LA RED","Energia": "Energía","Energia (kWh)": "Energía (kWh)","F23": "F23","Fascia": "Franja","Fatturazione": "Facturación","GIORNO {0}/{1}": "DÍA {0}/{1}","Giorni": "Días","Giorno": "Día","IMMESSI OGGI": "INYECTADOS HOY","IVA (%)": "IVA (%)","IVA {0} %": "IVA {0} %","Imposta il prezzo nell'editor": "Indica el precio en el editor","Lun–Sab": "Lun–Sáb","Lun–Ven": "Lun–Vie","Massimo {0} bollette (un anno).": "Máximo {0} facturas (un año).","Mensile": "Mensual","Mostra il calcolo della bolletta": "Mostrar el cálculo de la factura","Mostra ricavo energia immessa": "Mostrar ingresos por energía inyectada","Nessuna bolletta nello storico. Aggiungile dall'editor della card (Costi e bolletta).": "No hay facturas en el historial. Añádelas desde el editor de la tarjeta (Costes y factura).","Notte e festivi": "Noche y festivos","Orari": "Horarios","Orari delle fasce": "Horarios de las franjas","Orari interi (0–24). Quello che non rientra nelle fasce indicate va all'ultima fascia: {0}. I festivi nazionali contano come domenica.": "Horas enteras (0–24). Lo que no entra en las franjas indicadas va a la última franja: {0}. Los festivos nacionales cuentan como domingo.","PRELIEVO PER FASE": "CONSUMO POR FASE","PROSSIMA BOLLETTA · STIMA IN TEMPO REALE": "PRÓXIMA FACTURA · ESTIMACIÓN EN TIEMPO REAL","Per la stima della bolletta scegli il contatore dell'energia prelevata della Rete (Fonti e casa).": "Para estimar la factura elige el contador de energía consumida de la Red (Fuentes y casa).","Personalizzati": "Personalizados","Potenza impegnata (kW)": "Potencia contratada (kW)","Prezzi": "Precios","Prezzo energia (€/kWh)": "Precio de la energía (€/kWh)","Prezzo energia immessa in rete (€/kWh)": "Precio de la energía inyectada a la red (€/kWh)","Prezzo fisso": "Precio fijo","Prezzo {0} (€/kWh)": "Precio {0} (€/kWh)","Quota fissa": "Cuota fija","Quota fissa (€/mese)": "Cuota fija (€/mes)","Quota potenza": "Cuota de potencia","Quota potenza (€/kW al mese)": "Cuota de potencia (€/kW al mes)","RICAVO": "INGRESOS","Rete e oneri": "Red y cargos","Rete e oneri (€/kWh)": "Red y cargos (€/kWh)","Ricavo energia immessa": "Ingresos por energía inyectada","STORICO · ULTIMI 12 MESI · {0} BOLLETTE": "HISTORIAL · ÚLTIMOS 12 MESES · {0} FACTURAS","Sabato": "Sábado","Serve il contatore dell'energia immessa nella Rete (Fonti e casa). Sotto il cerchio Rete compaiono i kWh immessi oggi e nel popup della Rete il ricavo.": "Necesita el contador de energía inyectada de la Red (Fuentes y casa). Bajo el círculo Red aparecen los kWh inyectados hoy y, en el popup de la Red, los ingresos.","Serve il contatore dell'energia prelevata della Rete (Fonti e casa). Il ricavo dell'energia immessa non fa parte della bolletta.": "Necesita el contador de energía consumida de la Red (Fuentes y casa). Los ingresos por energía inyectada no forman parte de la factura.","Standard (ARERA)": "Estándar (ARERA)","Standard: F1 lun–ven 8–19; F2 lun–ven 7–8 e 19–23, sabato 7–23; F3 il resto (notte, domenica e festivi).": "Estándar: F1 lun–vie 8–19; F2 lun–vie 7–8 y 19–23, sábado 7–23; F3 el resto (noche, domingo y festivos).","Standard: F1 lun–ven 8–19; F23 il resto (sera, notte, sabato, domenica e festivi).": "Estándar: F1 lun–vie 8–19; F23 el resto (tarde, noche, sábado, domingo y festivos).","Standard: giorno lun–sab 7–23; notte e festivi il resto.": "Estándar: día lun–sáb 7–23; noche y festivos el resto.","Storico bollette": "Historial de facturas","TOTALE 12 MESI": "TOTAL 12 MESES","Tipo di contratto": "Tipo de contrato","Totale bolletta": "Total de la factura","Totale da pagare": "Total a pagar","Tutti i giorni": "Todos los días","Valuta": "Moneda","al giorno": "al día","finora": "hasta ahora","giorno {0} di {1}": "día {0} de {1}","nel periodo": "en el periodo","per kWh, tutto compreso": "por kWh, todo incluido","prima bolletta dello storico": "primera factura del historial","rispetto alla precedente": "respecto a la anterior","{0} bollette": "{0} facturas","CARICHI": "CARGAS","Percentuale dei carichi sul totale delle uscite degli inverter (invece che sull'inverter che li alimenta)": "Porcentaje de las cargas sobre el total de las salidas de los inversores (en lugar del inversor que las alimenta)"},
  fr: {"STIMATA": "ESTIMÉE","Calcolata in automatico: modificala per inserire l'importo reale.": "Calculée automatiquement : modifiez-la pour saisir le montant réel.","STIMATA: calcolata in automatico con i tuoi prezzi. Per l'importo reale modificala nell'editor (Costi e bolletta).": "ESTIMÉE : calculée automatiquement avec vos prix. Pour le montant réel, modifiez-la dans l'éditeur (Coûts et facture).","A fine periodo la bolletta viene aggiunta da sola come STIMATA; quando vuoi, modificala con l'importo reale.": "À la fin de la période, la facture est ajoutée automatiquement comme ESTIMÉE ; modifiez-la quand vous voulez avec le montant réel.","Automatica (come Home Assistant)": "Automatique (comme Home Assistant)","Fulmine": "Éclair","Ventola": "Ventilateur","Lavatrice": "Lave-linge","Cucina": "Cuisine","Computer": "Ordinateur","Presa": "Prise","Televisore": "Téléviseur","Auto": "Voiture","Luce": "Lumière","Caldaia": "Chaudière","Clima": "Clim","Acqua": "Eau","Pompa": "Pompe","Stufa": "Poêle","Inverter": "Onduleur","Casa": "Maison","Contatore": "Compteur","Configurazione mancante": "Configuration manquante","Elemento": "Élément","Chiudi": "Fermer","Solare": "Solaire","Batteria": "Batterie","Batteria {0}": "Batterie {0}","Storico {0}": "Historique {0}","Sottocarico": "Sous-charge","Sottocarichi": "Sous-charges","Sottocarichi {0}": "Sous-charges {0}","UTENZA": "CHARGE","Inverter {0}": "Onduleur {0}","TOCCA PER LO STORICO": "TOUCHEZ POUR L'HISTORIQUE","{0} · SOTTOCARICHI": "{0} · SOUS-CHARGES","{0} SOTTOCARICO": "{0} SOUS-CHARGE","{0} SOTTOCARICHI": "{0} SOUS-CHARGES","Carichi non monitorati {0}": "Charges non surveillées {0}","Carichi non monitorati": "Charges non surveillées","Impostazioni {0}": "Réglages {0}","IN {0}": "IN {0}","IMPOSTAZIONI": "RÉGLAGES","Impostazioni inverter": "Réglages de l'onduleur","OUT {0}": "OUT {0}","IMPOSTA": "RÉGLER","BATTERIA PIENA": "BATTERIE PLEINE","PIENA TRA {0}": "PLEINE DANS {0}","SOTTO IL {0} %": "SOUS {0} %","{0} % TRA {1}": "{0} % DANS {1}","{0} carica": "{0} charge","{0} potenza": "{0} puissance","Rete": "Réseau","INVERTER": "ONDULEUR","IN": "IN","CATENA ENERGETICA · FONTI › INVERTER › CASA › UTENZE": "CHAÎNE D'ÉNERGIE · SOURCES › ONDULEUR › MAISON › CHARGES","Apri l'editor della card e collega le entità: fonti, utenze, indicatori, inverter e storico.": "Ouvrez l'éditeur de la carte et reliez vos entités : sources, charges, indicateurs, onduleurs et historique.","SOLARE": "SOLAIRE","RETE": "RÉSEAU","BATTERIA": "BATTERIE","TRIFASE": "TRIPHASÉ","Rete Enel": "Réseau électrique","INVERTER {0}": "ONDULEUR {0}","Fase L{0}": "Phase L{0}","Casa {0}": "Maison {0}","RETE TRIFASE": "RÉSEAU TRIPHASÉ","{0} INVERTER": "{0} ONDULEURS","{0} INVERTER · {0} CASE CON LE LORO UTENZE": "{0} ONDULEURS · {0} MAISONS AVEC LEURS CHARGES","Dettaglio batterie": "Détail des batteries","BATTERIE": "BATTERIES","IN CARICA": "EN CHARGE","IN SCARICA": "EN DÉCHARGE","FERMA": "À L'ARRÊT","BATTERIE · TOTALE": "BATTERIES · TOTAL","{0} batteria, una per inverter": "{0} batterie, une par onduleur","{0} batterie, una per inverter": "{0} batteries, une par onduleur","IN EQUILIBRIO": "ÉQUILIBRÉES","POTENZA NETTA": "PUISSANCE NETTE","CARICA MEDIA": "CHARGE MOYENNE","ENTRA · {0} batt.": "EN CHARGE · {0} batt.","ESCE · {0} batt.": "EN DÉCHARGE · {0} batt.","INDICATORI": "INDICATEURS","Carico lo storico…": "Chargement de l'historique…","Nessun dato nel periodo": "Aucune donnée sur la période","MIN": "MIN","MEDIA": "MOY","MAX": "MAX","non disp.": "n.d.","POTENZA": "PUISSANCE","TENSIONE": "TENSION","CORRENTE": "COURANT","PRELIEVO DALLA RETE": "SOUTIRAGE DU RÉSEAU","IMMISSIONE IN RETE": "INJECTION DANS LE RÉSEAU","INGRESSO SOLARE": "ENTRÉE SOLAIRE","SOC AUTO": "SOC VOITURE","SOGLIE": "SEUILS","Chiudi storico": "Fermer l'historique","STORICO": "HISTORIQUE","Aggiungi le serie del grafico dall'editor.": "Ajoutez les séries du graphique depuis l'éditeur.","PASSWORD PER MODIFICARE LE IMPOSTAZIONI": "MOT DE PASSE POUR MODIFIER LES RÉGLAGES","PASSWORD PER COMANDARE GLI INTERRUTTORI": "MOT DE PASSE POUR COMMANDER LES INTERRUPTEURS","Annulla": "Annuler","Cancella": "Effacer","PASSWORD ERRATA": "MOT DE PASSE INCORRECT","SBLOCCATO · SI RIBLOCCA TRA {0} s": "DÉVERROUILLÉ · SE REVERROUILLE DANS {0} s","BLOCCA": "VERROUILLER","IMPOSTAZIONI E INTERRUTTORI PROTETTI DA PASSWORD": "RÉGLAGES ET INTERRUPTEURS PROTÉGÉS PAR MOT DE PASSE","Diminuisci": "Diminuer","Aumenta": "Augmenter","Sblocca con password per modificare": "Déverrouillez avec le mot de passe pour modifier","NON DISPONIBILE": "INDISPONIBLE","ATTIVO": "ACTIF","SPENTO": "ÉTEINT","Inverter FV": "Onduleur PV","Aggiungi impostazioni, interruttori e letture dall'editor.": "Ajoutez réglages, interrupteurs et mesures depuis l'éditeur.","INVERTER · IMPOSTAZIONI": "ONDULEUR · RÉGLAGES","ONLINE": "EN LIGNE","OFFLINE": "HORS LIGNE","dominio.nome_entita": "domaine.nom_entite","↑ Su": "↑ Monter","↓ Giù": "↓ Descendre","Elimina": "Supprimer","da configurare": "à configurer","Potenza del sottocarico (W o kW)": "Puissance de la sous-charge (W ou kW)","Nome": "Nom","Sottocarichi ({0}/{1})": "Sous-charges ({0}/{1})","Dettagliano questa utenza: sul quadrato appare un pulsante che apre l'elenco dei sottocarichi con il loro storico.": "Elles détaillent cette charge : un bouton apparaît sur la tuile et ouvre la liste des sous-charges avec leur historique.","+ Aggiungi sottocarico": "+ Ajouter une sous-charge","Potenza prodotta (W o kW) — con il secondo MPPT compilato è quella dell'MPPT 1": "Puissance produite (W ou kW) — si le deuxième MPPT est renseigné, c'est celle du MPPT 1","Testo sotto il valore": "Texte sous la valeur","Tensione di stringa (V, opzionale: appare nel grafico)": "Tension de string (V, facultatif : affichée dans le graphique)","Corrente di stringa (A, opzionale: se vuota la calcolo da potenza / tensione)": "Courant de string (A, facultatif : si vide, calculé à partir de la puissance / tension)","Potenza dell'MPPT {0} (W o kW)": "Puissance du MPPT {0} (W ou kW)","Tensione di stringa (V, opzionale)": "Tension de string (V, facultatif)","Corrente di stringa (A, opzionale)": "Courant de string (A, facultatif)","Con più MPPT la card mostra i cerchi affiancati che si uniscono in una sola linea verso l'inverter; il totale solare è la somma (fino a 4 MPPT).": "Avec plusieurs MPPT, la carte affiche les cercles côte à côte qui se rejoignent en une seule ligne vers l'onduleur ; le total solaire est la somme (jusqu'à 4 MPPT).","Potenza prelevata dalla rete (W o kW)": "Puissance soutirée au réseau (W ou kW)","Tensione di rete (opzionale)": "Tension du réseau (facultatif)","Frequenza di rete in Hz (opzionale, mostrata nel riquadro inverter)": "Fréquence du réseau en Hz (facultatif, affichée dans le cadre de l'onduleur)","Potenza positiva = prelievo dalla rete (togli la spunta se il tuo sensore è al contrario). L'immissione in rete è negativa e il grafico la mostra sotto lo zero.": "Puissance positive = soutirage du réseau (décochez si votre capteur fonctionne à l'envers). L'injection dans le réseau est négative et le graphique l'affiche sous zéro.","Potenza della batteria (W o kW)": "Puissance de la batterie (W ou kW)","Carica della batteria (%)": "Charge de la batterie (%)","Batteria 1": "Batterie 1","Capacità totale del pacco (kWh)": "Capacité totale du pack (kWh)","es. 10,24": "ex. 10,24","Carica residua desiderata (%)": "Charge résiduelle souhaitée (%)","La capacità è quella di tutto il pacco (somma delle batterie). Con la capacità impostata compare il tempo stimato: in carica, quanto manca al 100 %; in scarica, quanto resta prima della carica residua desiderata.": "La capacité est celle de tout le pack (somme des batteries). Une fois la capacité renseignée, le temps estimé s'affiche : en charge, le temps restant avant 100 % ; en décharge, le temps restant avant la charge résiduelle souhaitée.","Potenza positiva = in carica (togli la spunta se il tuo sensore è al contrario)": "Puissance positive = en charge (décochez si votre capteur fonctionne à l'envers)","Potenza della batteria 2 (W o kW)": "Puissance de la batterie 2 (W ou kW)","Carica della batteria 2 (%)": "Charge de la batterie 2 (%)","Batteria 2": "Batterie 2","Se compilata, la card mostra due cerchi batteria affiancati. Se lasci vuoto ne mostra uno solo.": "Si elle est renseignée, la carte affiche deux cercles de batterie côte à côte. Sinon, un seul.","Batteria 2 (opzionale)": "Batterie 2 (facultatif)","Consumo della casa (opzionale: se vuoto lo calcolo dai flussi)": "Consommation de la maison (facultatif : si vide, calculée à partir des flux)","Potenza dell'utenza (W o kW)": "Puissance de la charge (W ou kW)","Icona": "Icône","Testo sotto il nome (opzionale)": "Texte sous le nom (facultatif)","es. CLIMA": "ex. CLIM","…oppure entità da mostrare sotto il nome (es. umidità)": "…ou entité à afficher sous le nom (ex. humidité)","Carica dell'auto in % (per auto / wallbox, opzionale: appare sopra e nel grafico)": "Charge de la voiture en % (pour voiture / wallbox, facultatif : affichée au-dessus et dans le graphique)","Da questo valore in su": "À partir de cette valeur","Colore": "Couleur","Entità": "Entité","Unità (vuoto = quella dell'entità)": "Unité (vide = celle de l'entité)","Minimo della barra": "Minimum de la barre","Massimo della barra": "Maximum de la barre","Decimali": "Décimales","auto": "auto","Colori e soglie": "Couleurs et seuils","Colore di base (sotto la prima soglia)": "Couleur de base (sous le premier seuil)","Nessuna soglia: l'indicatore resta sempre del colore di base.": "Aucun seuil : l'indicateur garde toujours la couleur de base.","+ Aggiungi soglia": "+ Ajouter un seuil","Disattiva le soglie di questo indicatore (le righe restano salvate)": "Désactiver les seuils de cet indicateur (les lignes restent enregistrées)","Ogni soglia vale «da questo valore in su». Le soglie si possono mettere in qualsiasi ordine e quante ne vuoi.": "Chaque seuil signifie « à partir de cette valeur ». Les seuils peuvent être dans n'importe quel ordre et en nombre illimité.","Entità (select o number)": "Entité (select ou number)","Aspetto (per le select)": "Apparence (pour les select)","Automatico (3 opzioni o meno: pulsanti, altrimenti elenco)": "Automatique (3 options ou moins : boutons, sinon liste)","Pulsanti": "Boutons","Elenco a discesa": "Liste déroulante","Entità (W o kW)": "Entité (W ou kW)","MPPT {0} (opzionale)": "MPPT {0} (facultatif)","MPPT {0}": "MPPT {0}","Potenza (W o kW)": "Puissance (W ou kW)","Carica dell'auto in % (per auto / wallbox, opzionale)": "Charge de la voiture en % (pour voiture / wallbox, facultatif)","Fase di rete": "Phase du réseau","Potenza della fase (W o kW)": "Puissance de la phase (W ou kW)","Tensione della fase (opzionale)": "Tension de la phase (facultatif)","Potenza positiva = prelievo dalla rete (togli la spunta se il tuo sensore è al contrario: l'immissione in rete diventa negativa nel grafico)": "Puissance positive = soutirage du réseau (décochez si votre capteur fonctionne à l'envers : l'injection dans le réseau devient négative dans le graphique)","Solare (MPPT)": "Solaire (MPPT)","Capacità (kWh)": "Capacité (kWh)","es. 5,12": "ex. 5,12","Utenze ({0}/{1})": "Charges ({0}/{1})","+ Aggiungi utenza": "+ Ajouter une charge","Impostazioni inverter (popup dell'inverter)": "Réglages de l'onduleur (fenêtre de l'onduleur)","Titolo": "Titre","Se compili almeno un campo, il riquadro dell'inverter diventa cliccabile e apre queste impostazioni. La password è quella della sezione «Inverter».": "Si vous renseignez au moins un champ, le cadre de l'onduleur devient cliquable et ouvre ces réglages. Le mot de passe est celui de la section « Onduleur ».","Impostazioni (select / number)": "Réglages (select / number)","+ Aggiungi impostazione": "+ Ajouter un réglage","Interruttori": "Interrupteurs","+ Aggiungi interruttore": "+ Ajouter un interrupteur","Letture": "Mesures","+ Aggiungi lettura": "+ Ajouter une mesure","Lingua": "Langue","Fotovoltaico": "Photovoltaïque","Sopra il titolo": "Au-dessus du titre","ENERGIA": "ÉNERGIE","Modalità": "Mode","Singolo inverter": "Onduleur unique","Multi inverter (fino a 3, uno per fase)": "Multi-onduleurs (jusqu'à 3, un par phase)","Multi inverter: ogni inverter ha la sua fase di rete, i suoi MPPT, la sua batteria e le sue utenze. La sezione «Rete» resta quella della rete totale (se vuota la calcolo sommando le fasi).": "Multi-onduleurs : chaque onduleur a sa phase du réseau, ses MPPT, sa batterie et ses charges. La section « Réseau » reste celle du réseau total (si vide, calculée en additionnant les phases).","Batteria unica collegata a più inverter: la capacità totale e la carica residua desiderata si impostano solo nel primo inverter (per i tempi di carica/scarica uso quella capacità; le potenze le sommo da tutti gli inverter)": "Batterie unique reliée à plusieurs onduleurs : la capacité totale et la charge résiduelle souhaitée se renseignent uniquement sur le premier onduleur (les temps de charge/décharge utilisent cette capacité ; les puissances sont additionnées sur tous les onduleurs)","Generale": "Général","Fonti e casa": "Sources et maison","Nessuna utenza. Ne puoi aggiungere fino a {0}: ognuna ha la sua linea animata e la sua quota sul consumo.": "Aucune charge. Vous pouvez en ajouter jusqu'à {0} : chacune a sa ligne animée et sa part de la consommation.","Inverter ({0}/{1})": "Onduleurs ({0}/{1})","Nessun inverter. Aggiungine fino a {0} (uno per fase).": "Aucun onduleur. Ajoutez-en jusqu'à {0} (un par phase).","+ Aggiungi inverter": "+ Ajouter un onduleur","Indicatori ({0}/{1})": "Indicateurs ({0}/{1})","Aspetto": "Apparence","Anello": "Anneau","Tessere con barra": "Tuiles avec barre","Barra a soglie visibili": "Barre à seuils visibles","Anello a soglie visibili": "Anneau à seuils visibles","Nessun indicatore. Ne puoi aggiungere fino a {0} (3 file da 6 su schermo largo). Toccandoli la card mostra lo storico a 24 ore e 7 giorni.": "Aucun indicateur. Vous pouvez en ajouter jusqu'à {0} (3 rangées de 6 sur grand écran). En les touchant, la carte affiche l'historique sur 24 heures et 7 jours.","+ Aggiungi indicatore": "+ Ajouter un indicateur","Titolo delle letture": "Titre des mesures","Letture (Inverter FV)": "Mesures (onduleur PV)","Password": "Mot de passe","Proteggi con password": "Protéger par mot de passe","Password (solo cifre)": "Mot de passe (chiffres uniquement)","Si riblocca dopo (secondi)": "Reverrouillage après (secondes)","Proteggi le impostazioni": "Protéger les réglages","Proteggi gli interruttori": "Protéger les interrupteurs","Una sola password sblocca tutto per il tempo indicato. Serve a evitare i tocchi involontari: la password resta scritta nella configurazione della plancia, quindi non è una protezione di sicurezza.": "Un seul mot de passe déverrouille tout pendant la durée indiquée. Il sert à éviter les appuis involontaires : le mot de passe est écrit dans la configuration du tableau de bord, ce n'est donc pas une protection de sécurité.","Inverter: impostazioni, interruttori, letture": "Onduleur : réglages, interrupteurs, mesures","STORICO POTENZE": "HISTORIQUE DES PUISSANCES","Altezza del grafico (px)": "Hauteur du graphique (px)","Stile": "Style","Linee": "Lignes","Linee con area": "Lignes avec aire","Intervalli selezionabili": "Périodes sélectionnables","Serie ({0}/{1})": "Séries ({0}/{1})","+ Aggiungi serie": "+ Ajouter une série","Storico potenze": "Historique des puissances","Versione installata": "Version installée","Se dopo un aggiornamento qui vedi ancora il numero vecchio, la pagina sta usando il file in cache: controlla che la risorsa punti al file nuovo e ricarica.": "Si après une mise à jour vous voyez encore l'ancien numéro ici, la page utilise le fichier en cache : vérifiez que la ressource pointe vers le nouveau fichier et rechargez.","Informazioni": "Informations","24 H": "24 H","7 G": "7 J","30 G": "30 J","24 ore": "24 heures","7 giorni": "7 jours","30 giorni": "30 jours","Secondo MPPT (opzionale)": "Deuxième MPPT (facultatif)","Terzo MPPT (opzionale)": "Troisième MPPT (facultatif)","Quarto MPPT (opzionale)": "Quatrième MPPT (facultatif)","QUOTA SUL CONSUMO": "PART DE LA CONSOMMATION","IMPOSTAZIONI INVERTER": "RÉGLAGES DE L'ONDULEUR","ULTIME 24 ORE": "DERNIÈRES 24 HEURES","ULTIMI 7 GIORNI": "7 DERNIERS JOURS","ULTIMI 30 GIORNI": "30 DERNIERS JOURS","ENERGIA CONSUMATA": "ÉNERGIE CONSOMMÉE","ENERGIA PRODOTTA": "ÉNERGIE PRODUITE","ENERGIA PRELEVATA": "ÉNERGIE SOUTIRÉE AU RÉSEAU","ENERGIA BATTERIA · ENTRATA E USCITA": "ÉNERGIE DE LA BATTERIE · ENTRÉE ET SORTIE","ENERGIA DELLA RETE · PRELIEVO E IMMISSIONE": "ÉNERGIE DU RÉSEAU · SOUTIRAGE ET INJECTION","rispetto a ieri": "par rapport à hier","rispetto alla settimana prima": "par rapport à la semaine précédente","rispetto al mese prima": "par rapport au mois précédent","rispetto all'anno prima": "par rapport à l'année précédente","PRELEVATA": "SOUTIRÉE","IMMESSA": "INJECTÉE","Caricamento…": "Chargement…","Impossibile leggere le statistiche di energia": "Impossible de lire les statistiques d'énergie","Nessun dato di energia in questo periodo": "Aucune donnée d'énergie pour cette période","Tocca una barra per il dettaglio": "Touchez une barre pour le détail","SALDO": "SOLDE","MEDIA / ORA": "MOY. / HEURE","MEDIA / MESE": "MOY. / MOIS","MEDIA / GIORNO": "MOY. / JOUR","PICCO": "PIC","MINIMO": "MINIMUM","GIORNO": "JOUR","SETTIMANA": "SEMAINE","MESE": "MOIS","ANNO": "ANNÉE","OGGI": "AUJOURD'HUI","Periodo precedente": "Période précédente","Periodo successivo": "Période suivante","Scegli la data": "Choisir la date","Energia consumata: contatore in kWh (opzionale)": "Énergie consommée : compteur en kWh (facultatif)","Energia prodotta: contatore in kWh (opzionale)": "Énergie produite : compteur en kWh (facultatif)","Energia prelevata dalla rete: contatore in kWh (opzionale)": "Énergie soutirée au réseau : compteur en kWh (facultatif)","Energia immessa in rete: contatore in kWh (opzionale)": "Énergie injectée dans le réseau : compteur en kWh (facultatif)","Energia in carica: contatore in kWh (opzionale)": "Énergie en charge : compteur en kWh (facultatif)","Energia in scarica: contatore in kWh (opzionale)": "Énergie en décharge : compteur en kWh (facultatif)","I contatori di energia (kWh) devono essere sensori con totale che cresce (state_class total_increasing o total), registrati da Home Assistant. Con un contatore configurato, il popup mostra l'energia per giorno, settimana, mese e anno.": "Les compteurs d'énergie (kWh) doivent être des capteurs dont le total ne fait qu'augmenter (state_class total_increasing ou total), enregistrés par Home Assistant. Avec un compteur configuré, la fenêtre affiche l'énergie par jour, semaine, mois et année.","MPPT · ENERGIA TOTALE": "MPPT · ÉNERGIE TOTALE","SOMMA DEGLI {0} MPPT": "SOMME DES {0} MPPT","BATTERIE · ENERGIA TOTALE": "BATTERIES · ÉNERGIE TOTALE","SOMMA DELLE 2 BATTERIE": "SOMME DES 2 BATTERIES","Energia totale MPPT": "Énergie totale MPPT","Energia totale batterie": "Énergie totale batteries","Energia prodotta totale di tutti gli MPPT: contatore in kWh (opzionale, con 2 o più MPPT)": "Énergie totale produite par tous les MPPT : compteur en kWh (facultatif, avec 2 MPPT ou plus)","Energia in carica totale delle due batterie: contatore in kWh (opzionale)": "Énergie totale chargée dans les deux batteries : compteur en kWh (facultatif)","Energia in scarica totale delle due batterie: contatore in kWh (opzionale)": "Énergie totale déchargée des deux batteries : compteur en kWh (facultatif)","Se hai un solo contatore che somma tutti gli MPPT, mettilo qui: sul punto dove le linee si uniscono compare un pallino che apre l'energia per giorno, settimana, mese e anno. Con un solo MPPT usa il campo qui sopra.": "Si vous avez un seul compteur qui additionne tous les MPPT, mettez-le ici : un petit point apparaît à la jonction des lignes et ouvre l'énergie par jour, semaine, mois et année. Avec un seul MPPT, utilisez le champ ci-dessus.","Se hai un solo contatore che somma le due batterie, mettilo nei due campi «totale»: sul punto dove le linee delle batterie si uniscono compare un pallino che apre l'energia entrata e uscita. Con una sola batteria usa i campi della Batteria 1.": "Si vous avez un seul compteur qui additionne les deux batteries, mettez-le dans les deux champs « total » : un petit point apparaît à la jonction des lignes des batteries et ouvre l'énergie entrante et sortante. Avec une seule batterie, utilisez les champs de la Batterie 1.","AUTO {0}": "VOITURE {0}","Nome del SOC 1 (es. Renault 5)": "Nom du SOC 1 (ex. Renault 5)","Carica della seconda auto in % (opzionale)": "Charge de la deuxième voiture en % (facultatif)","Nome del SOC 2": "Nom du SOC 2","Carica della terza auto in % (opzionale)": "Charge de la troisième voiture en % (facultatif)","Nome del SOC 3": "Nom du SOC 3","Con più di un SOC il popup mostra una scheda per ciascuno (con il nome che scegli) e sulla tile i valori si alternano ogni 5 secondi con la dicitura AUTO 1, AUTO 2, AUTO 3.": "Avec plusieurs SOC, la fenêtre affiche un onglet pour chacun (avec le nom de votre choix) et sur la tuile les valeurs alternent toutes les 5 secondes avec la mention VOITURE 1, VOITURE 2, VOITURE 3.","SPEGNI": "ÉTEINDRE","ACCENDI": "ALLUMER","AVVIA": "LANCER","ACCESO": "ALLUMÉ","INVIO COMANDO…": "ENVOI DE LA COMMANDE…","Pulsante di comando nel popup": "Bouton de commande dans le popup","Entità da comandare (opzionale)": "Entité à commander (facultatif)","Nome del pulsante": "Nom du bouton","Nome del pulsante quando è attivo": "Nom du bouton quand il est actif","Nel popup di questa utenza compare un pulsante per accendere o spegnere l'entità scelta (switch, luce, ecc.). Con button, input_button, script e scene il pulsante la avvia soltanto.": "Le popup de cette charge affiche un bouton pour allumer ou éteindre l'entité choisie (switch, lumière, etc.). Avec button, input_button, script et scene, le bouton ne fait que la lancer.","Entità non disponibile o non valida": "Entité indisponible ou invalide","AGGIORNATO {0}": "MIS À JOUR {0}","{0} s fa": "il y a {0} s","{0} min fa": "il y a {0} min","{0} h {1} min fa": "il y a {0} h {1} min","Allerta entità": "Alerte d'entité","MPPT": "MPPT","Casa e utenze": "Maison et charges","Mostra un triangolo giallo sul cerchio o riquadro dell'entità quando Home Assistant la segnala non disponibile (unavailable), sconosciuta (unknown), vuota o inesistente. Scegli le sezioni da controllare.": "Affiche un triangle jaune sur le cercle ou la tuile de l'entité lorsque Home Assistant la signale indisponible, inconnue, vide ou inexistante. Choisissez les sections à surveiller.","+ Aggiungi bolletta": "+ Ajouter une facture","+ Aggiungi fascia oraria": "+ Ajouter une plage horaire","A fasce": "Par tranches","A fine periodo, a questo ritmo:": "À la fin de la période, à ce rythme :","Accisa": "Accise","Accisa (€/kWh)": "Accise (€/kWh)","Al (escluso)": "Au (exclu)","Alle ore": "Jusqu'à l'heure","Altre voci": "Autres postes","Apri bollette": "Ouvrir les factures","BOLLETTA": "FACTURE","BOLLETTE": "FACTURES","Bimestrale": "Bimestrielle","Biorario": "Biohoraire","COSTO MEDIO": "COÛT MOYEN","Calcolo bolletta": "Calcul de la facture","Canone TV": "Redevance TV","Canone TV (€/mese)": "Redevance TV (€/mois)","Canone TV (€/anno, 10 rate gen–ott)": "Redevance TV (€/an, 10 échéances janv.–oct.)","Costi e bolletta": "Coûts et facture","Dal": "Du","Dalle ore": "À partir de l'heure","Data di partenza del calcolo (inizio di un periodo di fatturazione)": "Date de départ du calcul (début d'une période de facturation)","Domenica e festivi": "Dimanche et jours fériés","ENERGIA IMMESSA IN RETE": "ÉNERGIE INJECTÉE DANS LE RÉSEAU","Energia": "Énergie","Energia (kWh)": "Énergie (kWh)","F23": "F23","Fascia": "Tranche","Fatturazione": "Facturation","GIORNO {0}/{1}": "JOUR {0}/{1}","Giorni": "Jours","Giorno": "Jour","IMMESSI OGGI": "INJECTÉS AUJOURD'HUI","IVA (%)": "TVA (%)","IVA {0} %": "TVA {0} %","Imposta il prezzo nell'editor": "Indiquez le prix dans l'éditeur","Lun–Sab": "Lun–Sam","Lun–Ven": "Lun–Ven","Massimo {0} bollette (un anno).": "Au maximum {0} factures (un an).","Mensile": "Mensuelle","Mostra il calcolo della bolletta": "Afficher le calcul de la facture","Mostra ricavo energia immessa": "Afficher le revenu de l'énergie injectée","Nessuna bolletta nello storico. Aggiungile dall'editor della card (Costi e bolletta).": "Aucune facture dans l'historique. Ajoutez-les depuis l'éditeur de la carte (Coûts et facture).","Notte e festivi": "Nuit et jours fériés","Orari": "Horaires","Orari delle fasce": "Horaires des tranches","Orari interi (0–24). Quello che non rientra nelle fasce indicate va all'ultima fascia: {0}. I festivi nazionali contano come domenica.": "Heures entières (0–24). Ce qui n'entre pas dans les tranches indiquées va à la dernière tranche : {0}. Les jours fériés nationaux comptent comme dimanche.","PRELIEVO PER FASE": "PRÉLÈVEMENT PAR PHASE","PROSSIMA BOLLETTA · STIMA IN TEMPO REALE": "PROCHAINE FACTURE · ESTIMATION EN TEMPS RÉEL","Per la stima della bolletta scegli il contatore dell'energia prelevata della Rete (Fonti e casa).": "Pour estimer la facture, choisissez le compteur d'énergie prélevée du Réseau (Sources et maison).","Personalizzati": "Personnalisés","Potenza impegnata (kW)": "Puissance souscrite (kW)","Prezzi": "Prix","Prezzo energia (€/kWh)": "Prix de l'énergie (€/kWh)","Prezzo energia immessa in rete (€/kWh)": "Prix de l'énergie injectée dans le réseau (€/kWh)","Prezzo fisso": "Prix fixe","Prezzo {0} (€/kWh)": "Prix {0} (€/kWh)","Quota fissa": "Part fixe","Quota fissa (€/mese)": "Part fixe (€/mois)","Quota potenza": "Part puissance","Quota potenza (€/kW al mese)": "Part puissance (€/kW par mois)","RICAVO": "REVENU","Rete e oneri": "Réseau et charges","Rete e oneri (€/kWh)": "Réseau et charges (€/kWh)","Ricavo energia immessa": "Revenu de l'énergie injectée","STORICO · ULTIMI 12 MESI · {0} BOLLETTE": "HISTORIQUE · 12 DERNIERS MOIS · {0} FACTURES","Sabato": "Samedi","Serve il contatore dell'energia immessa nella Rete (Fonti e casa). Sotto il cerchio Rete compaiono i kWh immessi oggi e nel popup della Rete il ricavo.": "Il faut le compteur d'énergie injectée du Réseau (Sources et maison). Sous le cercle Réseau s'affichent les kWh injectés aujourd'hui et, dans le popup du Réseau, le revenu.","Serve il contatore dell'energia prelevata della Rete (Fonti e casa). Il ricavo dell'energia immessa non fa parte della bolletta.": "Il faut le compteur d'énergie prélevée du Réseau (Sources et maison). Le revenu de l'énergie injectée ne fait pas partie de la facture.","Standard (ARERA)": "Standard (ARERA)","Standard: F1 lun–ven 8–19; F2 lun–ven 7–8 e 19–23, sabato 7–23; F3 il resto (notte, domenica e festivi).": "Standard : F1 lun–ven 8–19 ; F2 lun–ven 7–8 et 19–23, samedi 7–23 ; F3 le reste (nuit, dimanche et jours fériés).","Standard: F1 lun–ven 8–19; F23 il resto (sera, notte, sabato, domenica e festivi).": "Standard : F1 lun–ven 8–19 ; F23 le reste (soir, nuit, samedi, dimanche et jours fériés).","Standard: giorno lun–sab 7–23; notte e festivi il resto.": "Standard : jour lun–sam 7–23 ; nuit et jours fériés le reste.","Storico bollette": "Historique des factures","TOTALE 12 MESI": "TOTAL 12 MOIS","Tipo di contratto": "Type de contrat","Totale bolletta": "Total de la facture","Totale da pagare": "Total à payer","Tutti i giorni": "Tous les jours","Valuta": "Devise","al giorno": "par jour","finora": "jusqu'ici","giorno {0} di {1}": "jour {0} sur {1}","nel periodo": "sur la période","per kWh, tutto compreso": "par kWh, tout compris","prima bolletta dello storico": "première facture de l'historique","rispetto alla precedente": "par rapport à la précédente","{0} bollette": "{0} factures","CARICHI": "CHARGES","Percentuale dei carichi sul totale delle uscite degli inverter (invece che sull'inverter che li alimenta)": "Pourcentage des charges sur le total des sorties des onduleurs (au lieu de l'onduleur qui les alimente)"},
  de: {"STIMATA": "GESCHÄTZT","Calcolata in automatico: modificala per inserire l'importo reale.": "Automatisch berechnet: bearbeite sie, um den echten Betrag einzutragen.","STIMATA: calcolata in automatico con i tuoi prezzi. Per l'importo reale modificala nell'editor (Costi e bolletta).": "GESCHÄTZT: automatisch mit deinen Preisen berechnet. Für den echten Betrag im Editor bearbeiten (Kosten und Rechnung).","A fine periodo la bolletta viene aggiunta da sola come STIMATA; quando vuoi, modificala con l'importo reale.": "Am Periodenende wird die Rechnung automatisch als GESCHÄTZT hinzugefügt; bearbeite sie jederzeit mit dem echten Betrag.","Automatica (come Home Assistant)": "Automatisch (wie Home Assistant)","Fulmine": "Blitz","Ventola": "Lüfter","Lavatrice": "Waschmaschine","Cucina": "Küche","Computer": "Computer","Presa": "Steckdose","Televisore": "Fernseher","Auto": "Auto","Luce": "Licht","Caldaia": "Heizkessel","Clima": "Klima","Acqua": "Wasser","Pompa": "Pumpe","Stufa": "Ofen","Inverter": "Wechselrichter","Casa": "Haus","Contatore": "Zähler","Configurazione mancante": "Konfiguration fehlt","Elemento": "Element","Chiudi": "Schließen","Solare": "Solar","Batteria": "Batterie","Batteria {0}": "Batterie {0}","Storico {0}": "Verlauf {0}","Sottocarico": "Unterverbraucher","Sottocarichi": "Unterverbraucher","Sottocarichi {0}": "Unterverbraucher {0}","UTENZA": "VERBRAUCHER","Inverter {0}": "Wechselrichter {0}","TOCCA PER LO STORICO": "TIPPEN FÜR DEN VERLAUF","{0} · SOTTOCARICHI": "{0} · UNTERVERBRAUCHER","{0} SOTTOCARICO": "{0} UNTERVERBRAUCHER","{0} SOTTOCARICHI": "{0} UNTERVERBRAUCHER","Carichi non monitorati {0}": "Nicht erfasste Lasten {0}","Carichi non monitorati": "Nicht erfasste Lasten","Impostazioni {0}": "Einstellungen {0}","IN {0}": "IN {0}","IMPOSTAZIONI": "EINSTELLUNGEN","Impostazioni inverter": "Wechselrichter-Einstellungen","OUT {0}": "OUT {0}","IMPOSTA": "EINSTELLEN","BATTERIA PIENA": "BATTERIE VOLL","PIENA TRA {0}": "VOLL IN {0}","SOTTO IL {0} %": "UNTER {0} %","{0} % TRA {1}": "{0} % IN {1}","{0} carica": "{0} Ladung","{0} potenza": "{0} Leistung","Rete": "Netz","INVERTER": "WECHSELRICHTER","IN": "IN","CATENA ENERGETICA · FONTI › INVERTER › CASA › UTENZE": "ENERGIEKETTE · QUELLEN › WECHSELRICHTER › HAUS › VERBRAUCHER","Apri l'editor della card e collega le entità: fonti, utenze, indicatori, inverter e storico.": "Öffne den Karteneditor und verknüpfe deine Entitäten: Quellen, Verbraucher, Kennzahlen, Wechselrichter und Verlauf.","SOLARE": "SOLAR","RETE": "NETZ","BATTERIA": "BATTERIE","TRIFASE": "DREIPHASIG","Rete Enel": "Stromnetz","INVERTER {0}": "WECHSELRICHTER {0}","Fase L{0}": "Phase L{0}","Casa {0}": "Haus {0}","RETE TRIFASE": "DREIPHASIGES NETZ","{0} INVERTER": "{0} WECHSELRICHTER","{0} INVERTER · {0} CASE CON LE LORO UTENZE": "{0} WECHSELRICHTER · {0} HÄUSER MIT IHREN VERBRAUCHERN","Dettaglio batterie": "Batteriedetails","BATTERIE": "BATTERIEN","IN CARICA": "LÄDT","IN SCARICA": "ENTLÄDT","FERMA": "INAKTIV","BATTERIE · TOTALE": "BATTERIEN · GESAMT","{0} batteria, una per inverter": "{0} Batterie, eine pro Wechselrichter","{0} batterie, una per inverter": "{0} Batterien, eine pro Wechselrichter","IN EQUILIBRIO": "AUSGEGLICHEN","POTENZA NETTA": "NETTOLEISTUNG","CARICA MEDIA": "MITTLERE LADUNG","ENTRA · {0} batt.": "LADEN · {0} Batt.","ESCE · {0} batt.": "ENTLADEN · {0} Batt.","INDICATORI": "KENNZAHLEN","Carico lo storico…": "Verlauf wird geladen…","Nessun dato nel periodo": "Keine Daten im Zeitraum","MIN": "MIN","MEDIA": "Ø","MAX": "MAX","non disp.": "n. v.","POTENZA": "LEISTUNG","TENSIONE": "SPANNUNG","CORRENTE": "STROM","PRELIEVO DALLA RETE": "NETZBEZUG","IMMISSIONE IN RETE": "NETZEINSPEISUNG","INGRESSO SOLARE": "SOLAREINGANG","SOC AUTO": "SOC AUTO","SOGLIE": "SCHWELLEN","Chiudi storico": "Verlauf schließen","STORICO": "VERLAUF","Aggiungi le serie del grafico dall'editor.": "Füge die Diagrammreihen im Editor hinzu.","PASSWORD PER MODIFICARE LE IMPOSTAZIONI": "PASSWORT ZUM ÄNDERN DER EINSTELLUNGEN","PASSWORD PER COMANDARE GLI INTERRUTTORI": "PASSWORT ZUM BEDIENEN DER SCHALTER","Annulla": "Abbrechen","Cancella": "Löschen","PASSWORD ERRATA": "FALSCHES PASSWORT","SBLOCCATO · SI RIBLOCCA TRA {0} s": "ENTSPERRT · SPERRT WIEDER IN {0} s","BLOCCA": "SPERREN","IMPOSTAZIONI E INTERRUTTORI PROTETTI DA PASSWORD": "EINSTELLUNGEN UND SCHALTER SIND PASSWORTGESCHÜTZT","Diminuisci": "Verringern","Aumenta": "Erhöhen","Sblocca con password per modificare": "Mit Passwort entsperren, um zu ändern","NON DISPONIBILE": "NICHT VERFÜGBAR","ATTIVO": "EIN","SPENTO": "AUS","Inverter FV": "PV-Wechselrichter","Aggiungi impostazioni, interruttori e letture dall'editor.": "Füge Einstellungen, Schalter und Messwerte im Editor hinzu.","INVERTER · IMPOSTAZIONI": "WECHSELRICHTER · EINSTELLUNGEN","ONLINE": "ONLINE","OFFLINE": "OFFLINE","dominio.nome_entita": "domain.entitaetsname","↑ Su": "↑ Hoch","↓ Giù": "↓ Runter","Elimina": "Löschen","da configurare": "noch einzurichten","Potenza del sottocarico (W o kW)": "Leistung des Unterverbrauchers (W oder kW)","Nome": "Name","Sottocarichi ({0}/{1})": "Unterverbraucher ({0}/{1})","Dettagliano questa utenza: sul quadrato appare un pulsante che apre l'elenco dei sottocarichi con il loro storico.": "Sie schlüsseln diesen Verbraucher auf: Auf der Kachel erscheint eine Schaltfläche, die die Liste der Unterverbraucher mit ihrem Verlauf öffnet.","+ Aggiungi sottocarico": "+ Unterverbraucher hinzufügen","Potenza prodotta (W o kW) — con il secondo MPPT compilato è quella dell'MPPT 1": "Erzeugte Leistung (W oder kW) — ist der zweite MPPT ausgefüllt, ist es die des MPPT 1","Testo sotto il valore": "Text unter dem Wert","Tensione di stringa (V, opzionale: appare nel grafico)": "Strangspannung (V, optional: erscheint im Diagramm)","Corrente di stringa (A, opzionale: se vuota la calcolo da potenza / tensione)": "Strangstrom (A, optional: wenn leer, wird er aus Leistung / Spannung berechnet)","Potenza dell'MPPT {0} (W o kW)": "Leistung des MPPT {0} (W oder kW)","Tensione di stringa (V, opzionale)": "Strangspannung (V, optional)","Corrente di stringa (A, opzionale)": "Strangstrom (A, optional)","Con più MPPT la card mostra i cerchi affiancati che si uniscono in una sola linea verso l'inverter; il totale solare è la somma (fino a 4 MPPT).": "Bei mehreren MPPT zeigt die Karte die Kreise nebeneinander, die sich zu einer einzigen Linie zum Wechselrichter vereinen; die Solargesamtleistung ist die Summe (bis zu 4 MPPT).","Potenza prelevata dalla rete (W o kW)": "Aus dem Netz bezogene Leistung (W oder kW)","Tensione di rete (opzionale)": "Netzspannung (optional)","Frequenza di rete in Hz (opzionale, mostrata nel riquadro inverter)": "Netzfrequenz in Hz (optional, im Wechselrichterfeld angezeigt)","Potenza positiva = prelievo dalla rete (togli la spunta se il tuo sensore è al contrario). L'immissione in rete è negativa e il grafico la mostra sotto lo zero.": "Positive Leistung = Netzbezug (Haken entfernen, wenn dein Sensor umgekehrt arbeitet). Die Netzeinspeisung ist negativ und wird im Diagramm unter null angezeigt.","Potenza della batteria (W o kW)": "Batterieleistung (W oder kW)","Carica della batteria (%)": "Batterieladung (%)","Batteria 1": "Batterie 1","Capacità totale del pacco (kWh)": "Gesamtkapazität des Akkupacks (kWh)","es. 10,24": "z. B. 10,24","Carica residua desiderata (%)": "Gewünschte Restladung (%)","La capacità è quella di tutto il pacco (somma delle batterie). Con la capacità impostata compare il tempo stimato: in carica, quanto manca al 100 %; in scarica, quanto resta prima della carica residua desiderata.": "Die Kapazität ist die des gesamten Akkupacks (Summe der Batterien). Ist die Kapazität gesetzt, erscheint die geschätzte Zeit: beim Laden die Zeit bis 100 %, beim Entladen die Zeit bis zur gewünschten Restladung.","Potenza positiva = in carica (togli la spunta se il tuo sensore è al contrario)": "Positive Leistung = lädt (Haken entfernen, wenn dein Sensor umgekehrt arbeitet)","Potenza della batteria 2 (W o kW)": "Leistung der Batterie 2 (W oder kW)","Carica della batteria 2 (%)": "Ladung der Batterie 2 (%)","Batteria 2": "Batterie 2","Se compilata, la card mostra due cerchi batteria affiancati. Se lasci vuoto ne mostra uno solo.": "Ist sie ausgefüllt, zeigt die Karte zwei Batteriekreise nebeneinander. Bleibt sie leer, wird nur einer angezeigt.","Batteria 2 (opzionale)": "Batterie 2 (optional)","Consumo della casa (opzionale: se vuoto lo calcolo dai flussi)": "Hausverbrauch (optional: wenn leer, wird er aus den Flüssen berechnet)","Potenza dell'utenza (W o kW)": "Leistung des Verbrauchers (W oder kW)","Icona": "Symbol","Testo sotto il nome (opzionale)": "Text unter dem Namen (optional)","es. CLIMA": "z. B. KLIMA","…oppure entità da mostrare sotto il nome (es. umidità)": "…oder Entität, die unter dem Namen angezeigt wird (z. B. Luftfeuchtigkeit)","Carica dell'auto in % (per auto / wallbox, opzionale: appare sopra e nel grafico)": "Ladestand des Autos in % (für Auto / Wallbox, optional: erscheint oben und im Diagramm)","Da questo valore in su": "Ab diesem Wert","Colore": "Farbe","Entità": "Entität","Unità (vuoto = quella dell'entità)": "Einheit (leer = die der Entität)","Minimo della barra": "Minimum des Balkens","Massimo della barra": "Maximum des Balkens","Decimali": "Nachkommastellen","auto": "auto","Colori e soglie": "Farben und Schwellen","Colore di base (sotto la prima soglia)": "Grundfarbe (unter der ersten Schwelle)","Nessuna soglia: l'indicatore resta sempre del colore di base.": "Keine Schwelle: Die Kennzahl behält immer die Grundfarbe.","+ Aggiungi soglia": "+ Schwelle hinzufügen","Disattiva le soglie di questo indicatore (le righe restano salvate)": "Schwellen dieser Kennzahl deaktivieren (die Zeilen bleiben gespeichert)","Ogni soglia vale «da questo valore in su». Le soglie si possono mettere in qualsiasi ordine e quante ne vuoi.": "Jede Schwelle gilt „ab diesem Wert“. Die Schwellen können in beliebiger Reihenfolge und beliebiger Anzahl angelegt werden.","Entità (select o number)": "Entität (select oder number)","Aspetto (per le select)": "Darstellung (für Selects)","Automatico (3 opzioni o meno: pulsanti, altrimenti elenco)": "Automatisch (bis 3 Optionen: Schaltflächen, sonst Liste)","Pulsanti": "Schaltflächen","Elenco a discesa": "Dropdown-Liste","Entità (W o kW)": "Entität (W oder kW)","MPPT {0} (opzionale)": "MPPT {0} (optional)","MPPT {0}": "MPPT {0}","Potenza (W o kW)": "Leistung (W oder kW)","Carica dell'auto in % (per auto / wallbox, opzionale)": "Ladestand des Autos in % (für Auto / Wallbox, optional)","Fase di rete": "Netzphase","Potenza della fase (W o kW)": "Leistung der Phase (W oder kW)","Tensione della fase (opzionale)": "Spannung der Phase (optional)","Potenza positiva = prelievo dalla rete (togli la spunta se il tuo sensore è al contrario: l'immissione in rete diventa negativa nel grafico)": "Positive Leistung = Netzbezug (Haken entfernen, wenn dein Sensor umgekehrt arbeitet: die Netzeinspeisung wird im Diagramm negativ)","Solare (MPPT)": "Solar (MPPT)","Capacità (kWh)": "Kapazität (kWh)","es. 5,12": "z. B. 5,12","Utenze ({0}/{1})": "Verbraucher ({0}/{1})","+ Aggiungi utenza": "+ Verbraucher hinzufügen","Impostazioni inverter (popup dell'inverter)": "Wechselrichter-Einstellungen (Popup des Wechselrichters)","Titolo": "Titel","Se compili almeno un campo, il riquadro dell'inverter diventa cliccabile e apre queste impostazioni. La password è quella della sezione «Inverter».": "Füllst du mindestens ein Feld aus, wird das Wechselrichterfeld anklickbar und öffnet diese Einstellungen. Das Passwort ist das aus dem Abschnitt „Wechselrichter“.","Impostazioni (select / number)": "Einstellungen (select / number)","+ Aggiungi impostazione": "+ Einstellung hinzufügen","Interruttori": "Schalter","+ Aggiungi interruttore": "+ Schalter hinzufügen","Letture": "Messwerte","+ Aggiungi lettura": "+ Messwert hinzufügen","Lingua": "Sprache","Fotovoltaico": "Photovoltaik","Sopra il titolo": "Über dem Titel","ENERGIA": "ENERGIE","Modalità": "Modus","Singolo inverter": "Einzelner Wechselrichter","Multi inverter (fino a 3, uno per fase)": "Mehrere Wechselrichter (bis zu 3, einer pro Phase)","Multi inverter: ogni inverter ha la sua fase di rete, i suoi MPPT, la sua batteria e le sue utenze. La sezione «Rete» resta quella della rete totale (se vuota la calcolo sommando le fasi).": "Mehrere Wechselrichter: Jeder Wechselrichter hat seine eigene Netzphase, seine MPPT, seine Batterie und seine Verbraucher. Der Abschnitt „Netz“ bleibt das Gesamtnetz (wenn leer, wird es als Summe der Phasen berechnet).","Batteria unica collegata a più inverter: la capacità totale e la carica residua desiderata si impostano solo nel primo inverter (per i tempi di carica/scarica uso quella capacità; le potenze le sommo da tutti gli inverter)": "Eine Batterie an mehreren Wechselrichtern: Gesamtkapazität und gewünschte Restladung werden nur beim ersten Wechselrichter eingetragen (für die Lade-/Entladezeiten wird diese Kapazität verwendet; die Leistungen werden über alle Wechselrichter summiert)","Generale": "Allgemein","Fonti e casa": "Quellen und Haus","Nessuna utenza. Ne puoi aggiungere fino a {0}: ognuna ha la sua linea animata e la sua quota sul consumo.": "Keine Verbraucher. Du kannst bis zu {0} hinzufügen: Jeder hat seine animierte Linie und seinen Anteil am Verbrauch.","Inverter ({0}/{1})": "Wechselrichter ({0}/{1})","Nessun inverter. Aggiungine fino a {0} (uno per fase).": "Kein Wechselrichter. Füge bis zu {0} hinzu (einen pro Phase).","+ Aggiungi inverter": "+ Wechselrichter hinzufügen","Indicatori ({0}/{1})": "Kennzahlen ({0}/{1})","Aspetto": "Darstellung","Anello": "Ring","Tessere con barra": "Kacheln mit Balken","Barra a soglie visibili": "Balken mit sichtbaren Schwellen","Anello a soglie visibili": "Ring mit sichtbaren Schwellen","Nessun indicatore. Ne puoi aggiungere fino a {0} (3 file da 6 su schermo largo). Toccandoli la card mostra lo storico a 24 ore e 7 giorni.": "Keine Kennzahlen. Du kannst bis zu {0} hinzufügen (3 Reihen à 6 auf breitem Bildschirm). Beim Antippen zeigt die Karte den Verlauf für 24 Stunden und 7 Tage.","+ Aggiungi indicatore": "+ Kennzahl hinzufügen","Titolo delle letture": "Titel der Messwerte","Letture (Inverter FV)": "Messwerte (PV-Wechselrichter)","Password": "Passwort","Proteggi con password": "Mit Passwort schützen","Password (solo cifre)": "Passwort (nur Ziffern)","Si riblocca dopo (secondi)": "Sperrt wieder nach (Sekunden)","Proteggi le impostazioni": "Einstellungen schützen","Proteggi gli interruttori": "Schalter schützen","Una sola password sblocca tutto per il tempo indicato. Serve a evitare i tocchi involontari: la password resta scritta nella configurazione della plancia, quindi non è una protezione di sicurezza.": "Ein einziges Passwort entsperrt alles für die angegebene Zeit. Es dient dazu, versehentliche Berührungen zu vermeiden: Das Passwort steht in der Konfiguration des Dashboards und ist daher kein Sicherheitsschutz.","Inverter: impostazioni, interruttori, letture": "Wechselrichter: Einstellungen, Schalter, Messwerte","STORICO POTENZE": "LEISTUNGSVERLAUF","Altezza del grafico (px)": "Höhe des Diagramms (px)","Stile": "Stil","Linee": "Linien","Linee con area": "Linien mit Fläche","Intervalli selezionabili": "Wählbare Zeiträume","Serie ({0}/{1})": "Reihen ({0}/{1})","+ Aggiungi serie": "+ Reihe hinzufügen","Storico potenze": "Leistungsverlauf","Versione installata": "Installierte Version","Se dopo un aggiornamento qui vedi ancora il numero vecchio, la pagina sta usando il file in cache: controlla che la risorsa punti al file nuovo e ricarica.": "Siehst du nach einem Update hier noch die alte Nummer, verwendet die Seite die zwischengespeicherte Datei: Prüfe, ob die Ressource auf die neue Datei zeigt, und lade neu.","Informazioni": "Info","24 H": "24 H","7 G": "7 T","30 G": "30 T","24 ore": "24 Stunden","7 giorni": "7 Tage","30 giorni": "30 Tage","Secondo MPPT (opzionale)": "Zweiter MPPT (optional)","Terzo MPPT (opzionale)": "Dritter MPPT (optional)","Quarto MPPT (opzionale)": "Vierter MPPT (optional)","QUOTA SUL CONSUMO": "ANTEIL AM VERBRAUCH","IMPOSTAZIONI INVERTER": "WECHSELRICHTER-EINSTELLUNGEN","ULTIME 24 ORE": "LETZTE 24 STUNDEN","ULTIMI 7 GIORNI": "LETZTE 7 TAGE","ULTIMI 30 GIORNI": "LETZTE 30 TAGE","ENERGIA CONSUMATA": "VERBRAUCHTE ENERGIE","ENERGIA PRODOTTA": "ERZEUGTE ENERGIE","ENERGIA PRELEVATA": "AUS DEM NETZ BEZOGENE ENERGIE","ENERGIA BATTERIA · ENTRATA E USCITA": "BATTERIEENERGIE · EIN UND AUS","ENERGIA DELLA RETE · PRELIEVO E IMMISSIONE": "NETZENERGIE · BEZUG UND EINSPEISUNG","rispetto a ieri": "gegenüber gestern","rispetto alla settimana prima": "gegenüber der Vorwoche","rispetto al mese prima": "gegenüber dem Vormonat","rispetto all'anno prima": "gegenüber dem Vorjahr","PRELEVATA": "BEZOGEN","IMMESSA": "EINGESPEIST","Caricamento…": "Wird geladen…","Impossibile leggere le statistiche di energia": "Energiestatistiken konnten nicht gelesen werden","Nessun dato di energia in questo periodo": "Keine Energiedaten für diesen Zeitraum","Tocca una barra per il dettaglio": "Balken antippen für Details","SALDO": "SALDO","MEDIA / ORA": "Ø / STUNDE","MEDIA / MESE": "Ø / MONAT","MEDIA / GIORNO": "Ø / TAG","PICCO": "SPITZE","MINIMO": "MINIMUM","GIORNO": "TAG","SETTIMANA": "WOCHE","MESE": "MONAT","ANNO": "JAHR","OGGI": "HEUTE","Periodo precedente": "Voriger Zeitraum","Periodo successivo": "Nächster Zeitraum","Scegli la data": "Datum wählen","Energia consumata: contatore in kWh (opzionale)": "Verbrauchte Energie: Zähler in kWh (optional)","Energia prodotta: contatore in kWh (opzionale)": "Erzeugte Energie: Zähler in kWh (optional)","Energia prelevata dalla rete: contatore in kWh (opzionale)": "Aus dem Netz bezogene Energie: Zähler in kWh (optional)","Energia immessa in rete: contatore in kWh (opzionale)": "Ins Netz eingespeiste Energie: Zähler in kWh (optional)","Energia in carica: contatore in kWh (opzionale)": "Geladene Energie: Zähler in kWh (optional)","Energia in scarica: contatore in kWh (opzionale)": "Entladene Energie: Zähler in kWh (optional)","I contatori di energia (kWh) devono essere sensori con totale che cresce (state_class total_increasing o total), registrati da Home Assistant. Con un contatore configurato, il popup mostra l'energia per giorno, settimana, mese e anno.": "Energiezähler (kWh) müssen Sensoren mit stetig steigender Summe sein (state_class total_increasing oder total), die von Home Assistant aufgezeichnet werden. Ist ein Zähler gesetzt, zeigt das Popup die Energie pro Tag, Woche, Monat und Jahr.","MPPT · ENERGIA TOTALE": "MPPT · GESAMTENERGIE","SOMMA DEGLI {0} MPPT": "SUMME DER {0} MPPT","BATTERIE · ENERGIA TOTALE": "BATTERIEN · GESAMTENERGIE","SOMMA DELLE 2 BATTERIE": "SUMME DER 2 BATTERIEN","Energia totale MPPT": "MPPT-Gesamtenergie","Energia totale batterie": "Batterie-Gesamtenergie","Energia prodotta totale di tutti gli MPPT: contatore in kWh (opzionale, con 2 o più MPPT)": "Gesamte erzeugte Energie aller MPPT: Zähler in kWh (optional, ab 2 MPPT)","Energia in carica totale delle due batterie: contatore in kWh (opzionale)": "Gesamte Ladeenergie der beiden Batterien: Zähler in kWh (optional)","Energia in scarica totale delle due batterie: contatore in kWh (opzionale)": "Gesamte Entladeenergie der beiden Batterien: Zähler in kWh (optional)","Se hai un solo contatore che somma tutti gli MPPT, mettilo qui: sul punto dove le linee si uniscono compare un pallino che apre l'energia per giorno, settimana, mese e anno. Con un solo MPPT usa il campo qui sopra.": "Wenn du nur einen Zähler hast, der alle MPPT summiert, trage ihn hier ein: Am Punkt, an dem die Linien zusammenlaufen, erscheint ein kleiner Punkt, der die Energie pro Tag, Woche, Monat und Jahr öffnet. Bei nur einem MPPT nutze das Feld oben.","Se hai un solo contatore che somma le due batterie, mettilo nei due campi «totale»: sul punto dove le linee delle batterie si uniscono compare un pallino che apre l'energia entrata e uscita. Con una sola batteria usa i campi della Batteria 1.": "Wenn du nur einen Zähler hast, der beide Batterien summiert, trage ihn in die beiden «Gesamt»-Felder ein: Am Punkt, an dem die Batterielinien zusammenlaufen, erscheint ein kleiner Punkt, der die eingehende und ausgehende Energie öffnet. Bei nur einer Batterie nutze die Felder der Batterie 1.","AUTO {0}": "AUTO {0}","Nome del SOC 1 (es. Renault 5)": "Name von SOC 1 (z. B. Renault 5)","Carica della seconda auto in % (opzionale)": "Ladestand des zweiten Autos in % (optional)","Nome del SOC 2": "Name von SOC 2","Carica della terza auto in % (opzionale)": "Ladestand des dritten Autos in % (optional)","Nome del SOC 3": "Name von SOC 3","Con più di un SOC il popup mostra una scheda per ciascuno (con il nome che scegli) e sulla tile i valori si alternano ogni 5 secondi con la dicitura AUTO 1, AUTO 2, AUTO 3.": "Bei mehreren SOC zeigt das Popup für jeden einen Reiter (mit dem gewählten Namen), und auf der Kachel wechseln die Werte alle 5 Sekunden mit der Bezeichnung AUTO 1, AUTO 2, AUTO 3.","SPEGNI": "AUSSCHALTEN","ACCENDI": "EINSCHALTEN","AVVIA": "STARTEN","ACCESO": "AN","INVIO COMANDO…": "BEFEHL WIRD GESENDET…","Pulsante di comando nel popup": "Schaltfläche im Popup","Entità da comandare (opzionale)": "Zu steuernde Entität (optional)","Nome del pulsante": "Name der Schaltfläche","Nome del pulsante quando è attivo": "Name der Schaltfläche, wenn aktiv","Nel popup di questa utenza compare un pulsante per accendere o spegnere l'entità scelta (switch, luce, ecc.). Con button, input_button, script e scene il pulsante la avvia soltanto.": "Im Popup dieses Verbrauchers erscheint eine Schaltfläche zum Ein- oder Ausschalten der gewählten Entität (Switch, Licht usw.). Bei button, input_button, script und scene wird sie nur gestartet.","Entità non disponibile o non valida": "Entität nicht verfügbar oder ungültig","AGGIORNATO {0}": "AKTUALISIERT {0}","{0} s fa": "vor {0} s","{0} min fa": "vor {0} Min.","{0} h {1} min fa": "vor {0} Std. {1} Min.","Allerta entità": "Entitätswarnung","MPPT": "MPPT","Casa e utenze": "Haus und Verbraucher","Mostra un triangolo giallo sul cerchio o riquadro dell'entità quando Home Assistant la segnala non disponibile (unavailable), sconosciuta (unknown), vuota o inesistente. Scegli le sezioni da controllare.": "Zeigt ein gelbes Dreieck am Kreis oder Feld der Entität, wenn Home Assistant sie als nicht verfügbar, unbekannt, leer oder nicht vorhanden meldet. Wähle die zu überwachenden Bereiche.","+ Aggiungi bolletta": "+ Rechnung hinzufügen","+ Aggiungi fascia oraria": "+ Zeitband hinzufügen","A fasce": "Nach Zeitbändern","A fine periodo, a questo ritmo:": "Zum Periodenende, bei diesem Tempo:","Accisa": "Verbrauchsteuer","Accisa (€/kWh)": "Verbrauchsteuer (€/kWh)","Al (escluso)": "Bis (ausgenommen)","Alle ore": "Bis Uhr","Altre voci": "Weitere Posten","Apri bollette": "Rechnungen öffnen","BOLLETTA": "RECHNUNG","BOLLETTE": "RECHNUNGEN","Bimestrale": "Zweimonatlich","Biorario": "Zwei-Zeitbänder","COSTO MEDIO": "DURCHSCHNITTSKOSTEN","Calcolo bolletta": "Rechnungsberechnung","Canone TV": "TV-Gebühr","Canone TV (€/mese)": "TV-Gebühr (€/Monat)","Canone TV (€/anno, 10 rate gen–ott)": "TV-Gebühr (€/Jahr, 10 Raten Jan–Okt)","Costi e bolletta": "Kosten und Rechnung","Dal": "Von","Dalle ore": "Ab Uhr","Data di partenza del calcolo (inizio di un periodo di fatturazione)": "Startdatum der Berechnung (Beginn einer Abrechnungsperiode)","Domenica e festivi": "Sonntag und Feiertage","ENERGIA IMMESSA IN RETE": "INS NETZ EINGESPEISTE ENERGIE","Energia": "Energie","Energia (kWh)": "Energie (kWh)","F23": "F23","Fascia": "Zeitband","Fatturazione": "Abrechnung","GIORNO {0}/{1}": "TAG {0}/{1}","Giorni": "Tage","Giorno": "Tag","IMMESSI OGGI": "HEUTE EINGESPEIST","IVA (%)": "MwSt. (%)","IVA {0} %": "MwSt. {0} %","Imposta il prezzo nell'editor": "Preis im Editor festlegen","Lun–Sab": "Mo–Sa","Lun–Ven": "Mo–Fr","Massimo {0} bollette (un anno).": "Höchstens {0} Rechnungen (ein Jahr).","Mensile": "Monatlich","Mostra il calcolo della bolletta": "Rechnungsberechnung anzeigen","Mostra ricavo energia immessa": "Erlös aus eingespeister Energie anzeigen","Nessuna bolletta nello storico. Aggiungile dall'editor della card (Costi e bolletta).": "Keine Rechnungen im Verlauf. Füge sie im Karteneditor hinzu (Kosten und Rechnung).","Notte e festivi": "Nacht und Feiertage","Orari": "Zeiten","Orari delle fasce": "Zeiten der Zeitbänder","Orari interi (0–24). Quello che non rientra nelle fasce indicate va all'ultima fascia: {0}. I festivi nazionali contano come domenica.": "Ganze Stunden (0–24). Alles außerhalb der angegebenen Zeitbänder gehört zum letzten Zeitband: {0}. Nationale Feiertage zählen als Sonntag.","PRELIEVO PER FASE": "BEZUG PRO PHASE","PROSSIMA BOLLETTA · STIMA IN TEMPO REALE": "NÄCHSTE RECHNUNG · ECHTZEIT-SCHÄTZUNG","Per la stima della bolletta scegli il contatore dell'energia prelevata della Rete (Fonti e casa).": "Für die Rechnungsschätzung den Zähler der aus dem Netz bezogenen Energie wählen (Quellen und Haus).","Personalizzati": "Benutzerdefiniert","Potenza impegnata (kW)": "Vertragsleistung (kW)","Prezzi": "Preise","Prezzo energia (€/kWh)": "Energiepreis (€/kWh)","Prezzo energia immessa in rete (€/kWh)": "Preis der ins Netz eingespeisten Energie (€/kWh)","Prezzo fisso": "Festpreis","Prezzo {0} (€/kWh)": "Preis {0} (€/kWh)","Quota fissa": "Grundgebühr","Quota fissa (€/mese)": "Grundgebühr (€/Monat)","Quota potenza": "Leistungspreis","Quota potenza (€/kW al mese)": "Leistungspreis (€/kW pro Monat)","RICAVO": "ERLÖS","Rete e oneri": "Netz und Abgaben","Rete e oneri (€/kWh)": "Netz und Abgaben (€/kWh)","Ricavo energia immessa": "Erlös aus eingespeister Energie","STORICO · ULTIMI 12 MESI · {0} BOLLETTE": "VERLAUF · LETZTE 12 MONATE · {0} RECHNUNGEN","Sabato": "Samstag","Serve il contatore dell'energia immessa nella Rete (Fonti e casa). Sotto il cerchio Rete compaiono i kWh immessi oggi e nel popup della Rete il ricavo.": "Benötigt den Zähler der ins Netz eingespeisten Energie (Quellen und Haus). Unter dem Netz-Kreis erscheinen die heute eingespeisten kWh, im Netz-Popup der Erlös.","Serve il contatore dell'energia prelevata della Rete (Fonti e casa). Il ricavo dell'energia immessa non fa parte della bolletta.": "Benötigt den Zähler der aus dem Netz bezogenen Energie (Quellen und Haus). Der Erlös aus eingespeister Energie ist nicht Teil der Rechnung.","Standard (ARERA)": "Standard (ARERA)","Standard: F1 lun–ven 8–19; F2 lun–ven 7–8 e 19–23, sabato 7–23; F3 il resto (notte, domenica e festivi).": "Standard: F1 Mo–Fr 8–19; F2 Mo–Fr 7–8 und 19–23, Samstag 7–23; F3 der Rest (Nacht, Sonntag und Feiertage).","Standard: F1 lun–ven 8–19; F23 il resto (sera, notte, sabato, domenica e festivi).": "Standard: F1 Mo–Fr 8–19; F23 der Rest (Abend, Nacht, Samstag, Sonntag und Feiertage).","Standard: giorno lun–sab 7–23; notte e festivi il resto.": "Standard: Tag Mo–Sa 7–23; Nacht und Feiertage der Rest.","Storico bollette": "Rechnungsverlauf","TOTALE 12 MESI": "SUMME 12 MONATE","Tipo di contratto": "Vertragsart","Totale bolletta": "Rechnungssumme","Totale da pagare": "Zu zahlender Betrag","Tutti i giorni": "Jeden Tag","Valuta": "Währung","al giorno": "pro Tag","finora": "bisher","giorno {0} di {1}": "Tag {0} von {1}","nel periodo": "im Zeitraum","per kWh, tutto compreso": "pro kWh, alles inklusive","prima bolletta dello storico": "erste Rechnung im Verlauf","rispetto alla precedente": "gegenüber der vorherigen","{0} bollette": "{0} Rechnungen","CARICHI": "LASTEN","Percentuale dei carichi sul totale delle uscite degli inverter (invece che sull'inverter che li alimenta)": "Prozentanteil der Lasten an der Summe aller Wechselrichter-Ausgänge (statt am speisenden Wechselrichter)"}
};
function fvUiLang(cfgLang, hass) {
  let l = cfgLang && cfgLang !== 'auto' ? String(cfgLang) : String((hass && ((hass.locale && hass.locale.language) || hass.language)) || (typeof navigator !== 'undefined' && navigator.language) || 'en');
  l = l.slice(0, 2).toLowerCase(); return FV_UI.indexOf(l) >= 0 ? l : 'en';
}
function fvTr(l, s, a) {
  let r = l !== 'it' && FV_TR[l] && Object.prototype.hasOwnProperty.call(FV_TR[l], s) ? FV_TR[l][s] : s;
  if (a && a.length) r = r.replace(/\{(\d+)\}/g, (m, i) => (a[+i] == null ? '' : a[+i]));
  return r;
}

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
.chips { display: flex; flex-wrap: wrap; gap: 8px; min-width: 0; max-width: 100%; }
.chip { padding: 10px 14px; border-radius: 999px; border: 1px solid; font-family: 'IBM Plex Mono', ui-monospace, monospace; font-size: 11px; letter-spacing: .08em; max-width: 100%; box-sizing: border-box; overflow: hidden; text-overflow: ellipsis; }
@media (max-width: 520px) { .chip { padding: 9px 12px; font-size: 10.5px; letter-spacing: .04em; } }
.cols span { text-wrap: balance; }
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
.nd .eco { position: absolute; left: 50%; top: calc(100% + 30px); transform: translateX(-50%); white-space: nowrap; pointer-events: none; display: flex; align-items: center; gap: 6px; padding: 3px 10px; border-radius: 999px; border: 1px solid #6ee7b7; background: rgba(8,12,20,.9); font-family: 'IBM Plex Mono', ui-monospace, monospace; font-size: 10px; letter-spacing: .06em; }
.nd .eco span { color: rgba(255,255,255,.6); } .nd .eco b { color: #6ee7b7; font-weight: 700; }
.nr .nd .eco { top: calc(100% + 22px); font-size: 8.5px; padding: 3px 10px; gap: 0; flex-direction: column; border-radius: 12px; line-height: 1.25; }
.bhint { font-size: 11px; color: rgba(255,255,255,.55); line-height: 1.4; }
.blrow { display: flex; justify-content: space-between; gap: 8px; padding: 5px 0; font-size: 12px; } .blbar { display: flex; flex-direction: column; justify-content: flex-end; align-items: center; gap: 4px; flex: 1; min-width: 0; height: 100%; background: transparent; border: 0; padding: 0; color: inherit; cursor: pointer; }
.ld { position: absolute; transform: translate(-50%, -50%); width: 24.167%; aspect-ratio: 290 / 64; border-radius: 16px; border: 1.5px solid; background: linear-gradient(90deg, rgba(178,140,255,.12), rgba(8,12,20,.97) 55%); display: flex; align-items: center; gap: 12px; padding: 0 16px; text-align: left; }
.ld .ic { width: 38px; height: 38px; flex: none; border-radius: 11px; border: 1px solid; display: flex; align-items: center; justify-content: center; }
.ld .tx { flex: 1; min-width: 0; display: flex; flex-direction: column; gap: 2px; }
.ld .tx b { font-size: 14px; font-weight: 600; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.ld .tx i { font-style: normal; font-family: 'IBM Plex Mono', ui-monospace, monospace; font-size: 9.5px; letter-spacing: .08em; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.ld .vv { font-size: 17px; font-weight: 600; white-space: nowrap; }
.bw { position: absolute; inset: 0; border-radius: inherit; overflow: hidden; pointer-events: none; }
.wr { position: absolute; width: 22px; height: 20px; pointer-events: none; z-index: 3; filter: drop-shadow(0 0 6px rgba(255,210,74,.6)); overflow: visible; }
.wr.tr { right: -7px; top: -9px; } .wr.tl { left: -7px; top: -9px; } .wr.bl { left: -7px; bottom: -9px; }
.upd { display: flex; align-items: center; gap: 6px; margin-top: 4px; font-family: 'IBM Plex Mono', ui-monospace, monospace; font-size: 9.5px; letter-spacing: .1em; color: rgba(255,255,255,.4); }
.upd i { width: 6px; height: 6px; border-radius: 50%; flex: none; }
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
.tbz { position: relative; width: 100%; height: 8px; display: block; }
.tbz i { position: absolute; top: 0; bottom: 0; }
.tbz b { position: absolute; top: -4px; bottom: -4px; width: 2px; margin-left: -1px; background: #fff; opacity: .9; border-radius: 1px; }
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
.actr { display: flex; align-items: center; justify-content: space-between; gap: 12px; flex-wrap: wrap; padding: 10px 14px; border-radius: 16px; border: 1px solid rgba(255,255,255,.18); }
.actt { font-family: 'IBM Plex Mono', ui-monospace, monospace; font-size: 11px; letter-spacing: .14em; flex: 1 1 120px; }
.actb { min-height: 44px; padding: 0 22px; border-radius: 999px; border: 1.5px solid; color: #fff; font-family: 'IBM Plex Mono', ui-monospace, monospace; font-size: 12px; font-weight: 600; letter-spacing: .12em; margin-left: auto; }
.actb:disabled { opacity: .5; }
.enb { display: flex; flex-direction: column; gap: 10px; border-top: 1px solid rgba(255,255,255,.1); padding-top: 12px; }
.enh { display: flex; align-items: baseline; justify-content: space-between; gap: 10px; flex-wrap: wrap; }
.enl { font-family: 'IBM Plex Mono', ui-monospace, monospace; font-size: 11px; letter-spacing: .16em; color: rgba(255,255,255,.7); }
.enn { display: flex; align-items: center; gap: 6px; flex-wrap: wrap; }
.enn .xb:disabled { opacity: .3; }
.ent { flex: 1 1 140px; text-align: center; font-size: 15px; font-weight: 600; min-width: 0; }
.dti { min-height: 44px; padding: 0 10px; border-radius: 12px; border: 1px solid rgba(255,255,255,.25); background: rgba(255,255,255,.05); color: #fff; font-family: 'IBM Plex Mono', ui-monospace, monospace; font-size: 12px; color-scheme: dark; }
.entot { display: flex; align-items: baseline; gap: 18px; flex-wrap: wrap; }
.enk { font-family: 'IBM Plex Mono', ui-monospace, monospace; font-size: 10px; letter-spacing: .12em; min-height: 12px; }
.env { font-size: 28px; font-weight: 700; }
.enbars { display: flex; align-items: stretch; gap: 2px; height: 120px; }
.enc { flex: 1; min-width: 0; display: flex; flex-direction: column; cursor: pointer; }
.en1 { flex: 1 1 0; min-height: 0; display: flex; align-items: flex-end; }
.en2 { flex: 1 1 0; min-height: 0; display: flex; align-items: flex-start; }
.en1 i, .en2 i { display: block; width: 100%; }
.en1 i { border-radius: 3px 3px 0 0; } .en2 i { border-radius: 0 0 3px 3px; }
.enax { display: flex; gap: 2px; font-family: 'IBM Plex Mono', ui-monospace, monospace; font-size: 9.5px; color: rgba(255,255,255,.5); }
.enax span { flex: 1; min-width: 0; text-align: center; white-space: nowrap; overflow: visible; }
.enrd { min-height: 20px; font-family: 'IBM Plex Mono', ui-monospace, monospace; font-size: 12px; color: rgba(255,255,255,.8); }
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
.fld select option { color: #fff; background: #1c1c1c; }
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
.tdot { position: absolute; transform: translate(-50%, -50%); border-radius: 50%; border: 1.5px solid; background: rgba(8,12,20,.97); display: flex; align-items: center; justify-content: center; padding: 0; z-index: 3; cursor: pointer; }
.tdot i { display: block; width: 38%; height: 38%; border-radius: 50%; }
.tdot::after { content: ''; position: absolute; inset: -10px; border-radius: 50%; }
.tdot:focus-visible { outline: 2px solid #fff; outline-offset: 2px; }
.sbg:focus-visible { outline: 2px solid #fff; outline-offset: 2px; }
.sbr { position: relative; overflow: hidden; display: flex; align-items: center; gap: 12px; text-align: left; width: 100%; padding: 12px 14px; min-height: 56px; border-radius: 14px; border: 1px solid rgba(255,255,255,.1); background: rgba(255,255,255,.03); color: #fff; cursor: pointer; font: inherit; }
.sqr { position: absolute; transform: translate(-50%, -50%); aspect-ratio: 1; box-sizing: border-box; border: 1.5px solid; background: linear-gradient(160deg, rgba(178,140,255,.14), rgba(8,12,20,.97) 65%); display: flex; flex-direction: column; align-items: center; justify-content: flex-start; gap: 2px; padding: 6px 0 5px; border-radius: 16px; color: #fff; cursor: pointer; }
.sqr .q1 { white-space: nowrap; font-family: 'IBM Plex Mono', ui-monospace, monospace; font-size: 9px; font-weight: 500; letter-spacing: .04em; line-height: 1; color: #2ee87a; }
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
    this._lock = { left: 0, ask: false, pin: '', err: false, want: null }; this._rdOpen = true; this._narrow = false; this._ep = 'd'; this._ed = null; this._eh = null; this._ec = {}; this._el = {};
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
    if (!config) throw new Error(fvTr(fvUiLang(null, null), 'Configurazione mancante'));
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
    c.economy = Object.assign({}, c.economy || {}); c.economy.export = Object.assign({}, c.economy.export || {}); c.economy.bill = Object.assign({}, c.economy.bill || {});
    ['history', 'rules'].forEach((k) => { if (!Array.isArray(c.economy.bill[k])) c.economy.bill[k] = []; });
    if (!Array.isArray(c.history.series)) c.history.series = [];
    if (!Array.isArray(c.history.ranges) || !c.history.ranges.length) c.history.ranges = ['24h', '7g', '30g'];
    this._cfg0 = c; this._applyLang();
  }
  /* lingua dell'interfaccia: quella scelta nell'editor oppure quella di Home Assistant; i testi di default della configurazione si traducono con essa */
  _ul() { return fvUiLang(this._cfg0 ? this._cfg0.language : null, this._hass); }
  _t(s, ...a) { return fvTr(this._lc || this._ul(), s, a); }
  _applyLang() {
    const l = this._ul(); this._lc = l; const c = JSON.parse(JSON.stringify(this._cfg0));
    const lz = (o, k) => { if (o && typeof o[k] === 'string') o[k] = fvTr(l, o[k]); };
    lz(c, 'title'); lz(c, 'subtitle'); lz(c.solar, 'name'); lz(c.grid, 'name'); lz(c.battery, 'name'); lz(c.battery2, 'name'); lz(c.home, 'name'); lz(c.axpert, 'title'); lz(c.history, 'title');
    this._config = c; this._ents = null; this._cache = {}; this._sigs = {}; this._bl = null; this._ecv = null; this._ec = {}; this._arTs = 0; this._est = null; this._sel = null; this._met = 'w'; this._bpOpen = false; this._axi = null; this._hrng = c.history.ranges[0];
    this._build(); this._update(true);
  }
  set hass(h) { this._hass = h; if (this._config) { if (this._cfg0 && this._ul() !== this._lc) this._applyLang(); else this._update(false); } }

  connectedCallback() {
    if (!this._ro) this._ro = new ResizeObserver(() => this._measure());
    this._ro.observe(this);
    clearInterval(this._utm); this._utm = setInterval(() => this._tickUpd(), 1000); clearInterval(this._rtm); this._rtm = setInterval(() => { this._rot = (this._rot || 0) + 1; if (!this.shadowRoot) return; this.shadowRoot.querySelectorAll('[data-soc]').forEach((el) => { const t = this._socTxt(el.dataset.soc.split('|'), !!el.dataset.short); if (t) el.textContent = t; }); }, 5000);
    this._timer = setInterval(() => { if (!this.isConnected || !this._hass) return; this._enLoad(true); Object.keys(this._cache).forEach((k) => { const [id, rg] = k.split('|'); this._fetch(id, rg).then((r) => { this._cache[k] = r; this._paint('p'); this._paint('h'); }).catch(() => {}); }); }, 300000);
    this._measure();
  }
  disconnectedCallback() { if (this._ro) this._ro.disconnect(); clearInterval(this._timer); clearInterval(this._iv); clearInterval(this._rtm); clearInterval(this._utm); }

  _measure() {
    const w = this.clientWidth; if (!w || !this._config) return;
    const narrow = w < 980; const root = this.shadowRoot.querySelector('.root');
    if (root) root.classList.toggle('sm', w < 560);
    if (narrow !== this._narrow) { this._narrow = narrow; this._sigs.flow = null; this._update(false); }
  }

  /* ---------- dati ---------- */
  _flowIds() {
    const c = this._config; const a = [c.solar.entity, c.solar.mppt2.entity, c.solar.mppt3.entity, c.solar.mppt4.entity, c.grid.entity, c.grid.voltage_entity, c.grid.frequency_entity, c.battery.entity, c.battery.soc_entity, c.battery2.entity, c.battery2.soc_entity, c.home.entity];
    c.loads.forEach((l) => { a.push(l.entity, l.sub_entity, l.soc_entity, l.soc2_entity, l.soc3_entity, l.action_entity); (l.sub_loads || []).forEach((x) => x && a.push(x.entity, x.action_entity)); });
    c.inverters.forEach((v) => { a.push(v.phase.entity, v.phase.voltage_entity, v.battery.entity, v.battery.soc_entity, v.home.entity); (v.mppt || []).forEach((m) => m && a.push(m.entity)); v.loads.forEach((l) => { a.push(l.entity, l.soc_entity, l.soc2_entity, l.soc3_entity, l.action_entity); (l.sub_loads || []).forEach((x) => x && a.push(x.entity, x.action_entity)); }); });
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
  _lang() { const l = this._cfg0 && this._cfg0.language; if (l && l !== 'auto') return l; return (this._hass && this._hass.locale && this._hass.locale.language) || this._lc || 'it'; }
  _f(v, dec) {
    if (v == null || isNaN(v)) return '—';
    const o = dec != null && dec !== '' ? { minimumFractionDigits: +dec, maximumFractionDigits: +dec } : { minimumFractionDigits: 0, maximumFractionDigits: Math.abs(v) >= 1000 ? 0 : Math.abs(v) >= 100 ? 1 : 2 };
    return Number(v).toLocaleString(this._lang(), o);
  }
  _fw(w) { if (w == null) return '—'; return Math.abs(w) >= 1000 ? (w / 1000).toLocaleString(this._lang(), { minimumFractionDigits: 2, maximumFractionDigits: 2 }) + ' kW' : Math.round(w).toLocaleString(this._lang()) + ' W'; }
  _name(it, fb) { if (it && it.name) return it.name; const st = this._st(it && it.entity); return (st && st.attributes.friendly_name) || fb || (it && it.entity) || this._t('Elemento'); }
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
      <div class="head"><div><div class="kick">${fvEsc(c.subtitle || this._t('ENERGIA'))}</div><div class="h1">${fvEsc(c.title || this._t('Fotovoltaico'))}</div></div><div class="chips" id="chips"></div></div>
      <div class="box"><div class="cols"><span>${this._t('CATENA ENERGETICA · FONTI › INVERTER › CASA › UTENZE')}</span><span class="lc">${this._t('QUOTA SUL CONSUMO')}</span></div><div id="flow"></div></div>
      <div id="panel"></div><div id="tiles"></div>
      <div class="two"><div class="b" id="hist" style="flex:1 1 100%"></div></div>
    </div>
    <div class="pop" id="pop"><div class="sheet"><div class="phd"><span>${this._t('IMPOSTAZIONI INVERTER')}</span><button type="button" class="xb" data-act="popclose" aria-label="${this._t('Chiudi')}">${fvIcon('x', '#fff', 16, 2)}</button></div><div id="axp"></div></div></div>
    <div class="pop" id="cpop"><div class="sheet cs"><div id="cpanel"></div></div></div>
    <div class="pop" id="bpop"><div class="sheet cs" style="max-width:520px"><div id="bpbody"></div></div></div>
    <div class="pop" id="blpop"><div class="sheet cs" style="max-width:720px;border-color:rgba(110,231,183,.5);box-shadow:0 0 60px rgba(110,231,183,.18)"><div id="blbody"></div></div></div>
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
    this._reg('flow', S(this._flowIds()) + '#' + this._narrow + c.mode + (h ? '1' : '0') + '#' + this._econSig(), () => { this._renderFlow(); });
    this._reg('tiles', S(c.indicators.map((i) => i.entity)) + '#' + JSON.stringify(this._sel) + (h ? '1' : '0'), () => { this._renderTiles(); });
    this._patchPanel();
    if (this._subOpen) this._renderSubPop();
    const axx = this._ax(); const axIds = axx.controls.concat(axx.switches).map((i) => i.entity);
    const L = this._lock; this._reg('axp', S(axIds) + '#' + (L.left > 0) + L.ask + L.pin + L.err + L.want + this._rdOpen + this._axi + (h ? '1' : '0'), () => { this._renderAxp(); });
    this._patchReadings();
    this._reg('hist', this._hrng + '#' + (h ? '1' : '0'), () => { this._renderHist(); });
    this._patchLegend();
    if (h && ids.length) this._loadAll();
    this._econ();
  }

  /* ---------- flusso ---------- */
  /* Sostituisce il disegno del flusso senza far ripartire le animazioni: prima legge a che punto del ciclo
     è ogni linea animata, poi, dopo aver ricostruito il DOM, rimette ogni linea nello stesso punto del ciclo
     (anche se nel frattempo è cambiata la velocità). Senza questo, ogni aggiornamento di un sensore faceva "scattare" le linee. */
  _setFlow(html) {
    const el = this._$('flow'); if (!el) return; const keep = {}; const cnt = {};
    const key = (p) => { const k = p.getAttribute('d') + '|' + p.getAttribute('stroke'); cnt[k] = (cnt[k] || 0) + 1; return k + '#' + cnt[k]; };
    const durOf = (p) => (parseFloat(p.style.animationDuration) || 1) * 1000;
    try {
      el.querySelectorAll('path.fl').forEach((p) => { const a = p.getAnimations && p.getAnimations()[0]; if (a && a.currentTime != null) { const d = durOf(p); keep[key(p)] = ((a.currentTime % d) + d) % d / d; } });
    } catch (e) { /* senza Web Animations si riparte da zero come prima */ }
    el.innerHTML = html;
    try {
      Object.keys(cnt).forEach((k) => { cnt[k] = 0; });
      el.querySelectorAll('path.fl').forEach((p) => { const f = keep[key(p)]; if (f == null) return; const a = p.getAnimations && p.getAnimations()[0]; if (a) a.currentTime = f * durOf(p); });
    } catch (e) { /* idem */ }
  }
  _edge(d, w, col, o) {
    const sw = (o && o.sw) || 2; const dw = (o && o.dw) || 4; const on = w > 5; const dur = (on ? Math.max(.45, 2.4 - Math.log10(w) * .5) : 1).toFixed(2);
    return `<path d="${d}" fill="none" stroke="${col}" stroke-opacity="${on ? .3 : .1}" stroke-width="${sw}"/><path class="${on ? 'fl' : ''}" d="${d}" fill="none" stroke="${col}" stroke-opacity="${on ? 1 : 0}" stroke-width="${dw}" style="animation-duration:${dur}s"/>`;
  }
  _S(a, b) { const m = (a[0] + b[0]) / 2; return `M${a[0]} ${a[1]}C${m} ${a[1]} ${m} ${b[1]} ${b[0]} ${b[1]}`; }
  _V(a, b) { const m = (a[1] + b[1]) / 2; return `M${a[0]} ${a[1]}C${a[0]} ${m} ${b[0]} ${m} ${b[0]} ${b[1]}`; }
  _smp() { const s = this._config.solar; const nm0 = s.name && s.name !== this._t('Solare') ? s.name : ''; const L = [{ cfg: s, i: 0, name: nm0 || 'MPPT 1' }]; [['mppt2', 7, 'MPPT 2'], ['mppt3', 8, 'MPPT 3'], ['mppt4', 9, 'MPPT 4']].forEach(([k, i, nm]) => { const m = s[k]; if (m && m.entity) L.push({ cfg: m, i, name: m.name || nm }); }); return L; }
  _mppt2On() { const m = this._config.solar.mppt2; return !!(m && m.entity); }
  _bat2On() { const b = this._config.battery2; return !!(b && (b.entity || b.soc_entity)); }
  _batName(i) { const b = i ? this._config.battery2 : this._config.battery; if (!this._bat2On()) return b.name || this._t('Batteria'); return b.name && b.name !== this._t('Batteria') ? b.name : this._t('Batteria {0}', i + 1); }
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
    const zone = (cls, d, lab, inner) => (!d ? `<span class="${cls}">${inner}</span>` : `<span class="${cls} zn" ${this._dk(d)} role="button" aria-label="${fvEsc(this._t('Storico {0}', lab))}" style="--zc:${o.col}">${inner}</span>`);
    const vst = o.fs ? ` style="font-size:${o.fs}px"` : '';
    const vs = `<span class="s" style="color:${a ? o.col : 'rgba(255,255,255,.6)'}${o.ss ? ';font-size:' + o.ss + 'px' : ''}">${fvEsc(o.sub)}</span>`;
    const isz = o.is || (nar ? (sp ? 14 : 18) : (sp ? 20 : 22));
    const inner = sp ? zone('zt', sp.top, sp.topLab, fvIcon(o.ic, o.col, isz) + `<span class="v"${vst}>${fvEsc(o.val)}</span>`) + zone('zb', sp.bot, sp.botLab, vs)
      : fvIcon(o.ic, o.col, isz) + `<span class="v"${vst}>${fvEsc(o.val)}</span>` + vs;
    const click = !sp && o.src ? `${this._dk(o.src)} role="button" aria-label="${fvEsc(this._t('Storico {0}', o.lab))}" ` : '';
    return `<div class="nd" ${click}style="${!sp && o.src ? 'cursor:pointer;' : ''}left:${(p[0] / W * 100).toFixed(3)}%;top:${(p[1] / H * 100).toFixed(3)}%;width:${(sz / W * 100).toFixed(3)}%;aspect-ratio:1;opacity:${a ? 1 : .62}">
      ${o.wr ? this._wrHtml(o.wp || 'tr') : ''}<div class="c" style="border-color:${a ? o.col : 'rgba(255,255,255,.22)'};box-shadow:${a ? '0 0 26px ' + o.col + '55' : 'none'}">${inner}</div>
      <span class="l"${o.labTop ? ' style="top:auto;bottom:100%;margin-top:0;margin-bottom:6px"' : ''}>${fvEsc(o.lab)}</span>${o.eco ? `<span class="eco"><span>${fvEsc(o.eco.t)}</span><b>${fvEsc(o.eco.v)}</b></span>` : ''}</div>`;
  }
  /* ---------- sottocarichi ---------- */
  _subs(l) { return (l && Array.isArray(l.sub_loads) ? l.sub_loads : []).filter((x) => x && x.entity).slice(0, FV_MAX_SUB).map((x) => ({ name: this._name(x, this._t('Sottocarico')), entity: x.entity, act: this._actOf(x), w: Math.max(0, this._pw(x.entity) || 0) })); }
  _sbHtml(ref, x, y, sz, nm) {
    return `<button type="button" class="sbg" data-act="sub" data-ref="${ref}" title="${fvEsc(this._t('Sottocarichi'))}" aria-label="${fvEsc(this._t('Sottocarichi {0}', nm))}" style="left:${x.toFixed(3)}%;top:${y.toFixed(3)}%;width:${sz}px;height:${sz}px"><svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="#b28cff" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M4 7h16M4 12h16M4 17h10"/></svg></button>`;
  }
  _subParent(ref) {
    const c = this._config; const p = String(ref || '').split('-');
    if (p[0] === 'l') { const l = c.loads[+p[1]]; return l ? { l, sub: this._t('UTENZA') } : null; }
    if (p[0] === 'm') { const iv = c.inverters[+p[1]]; const l = iv && (iv.loads || [])[+p[2]]; return l ? { l, sub: (iv.name || this._t('Inverter {0}', +p[1] + 1)).toUpperCase() } : null; }
    return null;
  }
  _renderSubPop() {
    const pop = this._$('spop'); const body = this._$('spbody'); if (!pop || !body) return;
    const par = this._subOpen ? this._subParent(this._subOpen) : null; const sb = par ? this._subs(par.l) : [];
    if (!par || !sb.length) { this._popOn(pop, false); return; }
    this._popOn(pop, true);
    const l = par.l; const tw = Math.max(0, this._pw(l.entity) || 0); const tot = Math.max(1, tw); const PAL = ['#7aa8ff', '#5fd0ff', '#ff9ad5', '#ffd24a', '#2ee87a', '#ff8a5c'];
    const rows = sb.map((x, j) => { const c = PAL[j % PAL.length]; const pc = Math.round(x.w / tot * 100); return `<button type="button" class="sbr" data-act="open" data-kind="sub" data-i="${j}" data-key="${fvEsc(this._subOpen)}" aria-label="${fvEsc(this._t('Storico {0}', x.name))}">
      <span style="width:10px;height:10px;flex:none;border-radius:3px;background:${c};box-shadow:0 0 10px ${c}88"></span>
      <span style="flex:1;min-width:0;display:flex;flex-direction:column;gap:2px"><span style="font-size:14.5px;font-weight:600">${fvEsc(x.name)}</span><span class="mono" style="font-size:9.5px;letter-spacing:.06em;color:rgba(255,255,255,.5)">${this._t('TOCCA PER LO STORICO')}</span></span>
      <span style="display:flex;flex-direction:column;align-items:flex-end;gap:2px"><span style="font-size:16px;font-weight:600;color:${x.w > 5 ? '#fff' : 'rgba(255,255,255,.55)'}">${fvEsc(this._fw(x.w))}</span><span class="mono" style="font-size:10px;color:rgba(255,255,255,.55)">${pc} %</span></span>
      <span style="position:absolute;left:0;bottom:0;height:3px;width:${fvClamp(pc, 0, 100)}%;background:${c};box-shadow:0 0 10px ${c}"></span></button>`; }).join('');
    const rest = Math.max(0, tw - sb.reduce((a, x) => a + (x.w || 0), 0)); const rpc = Math.round(rest / tot * 100);
    const restRow = rest >= 1 ? `<div class="sbr" style="cursor:default;border-style:dashed;border-color:rgba(255,111,181,.45);background:rgba(255,111,181,.06)">
      <span style="width:10px;height:10px;flex:none;border-radius:3px;background:#ff6fb5;box-shadow:0 0 10px #ff6fb588"></span>
      <span style="flex:1;min-width:0;font-size:14.5px;font-weight:600">${fvEsc(this._t('Carichi non monitorati'))}</span>
      <span style="display:flex;flex-direction:column;align-items:flex-end;gap:2px"><span style="font-size:16px;font-weight:600">${fvEsc(this._fw(rest))}</span><span class="mono" style="font-size:10px;color:rgba(255,255,255,.55)">${rpc} %</span></span>
      <span style="position:absolute;left:0;bottom:0;height:3px;width:${fvClamp(rpc, 0, 100)}%;background:#ff6fb5;box-shadow:0 0 10px #ff6fb5"></span></div>` : '';
    const sheet = pop.querySelector('.sheet'); if (sheet) { sheet.style.borderColor = '#b28cff80'; sheet.style.boxShadow = '0 0 50px #b28cff33'; }
    body.innerHTML = `<div style="padding:18px 20px 22px;display:flex;flex-direction:column;gap:12px">
      <div style="display:flex;justify-content:space-between;align-items:flex-start;gap:12px"><div><div class="mono" style="font-size:11px;letter-spacing:.16em;color:rgba(255,255,255,.7)">${fvEsc(this._t('{0} · SOTTOCARICHI', this._name(l).toUpperCase()))}</div><div class="mono" style="font-size:10px;letter-spacing:.12em;color:rgba(255,255,255,.45);margin-top:2px">${fvEsc(par.sub)} · ${this._t(sb.length === 1 ? '{0} SOTTOCARICO' : '{0} SOTTOCARICHI', sb.length)}</div><div style="font-size:28px;font-weight:700;color:#b28cff;margin-top:4px">${fvEsc(this._fw(tw))}</div></div><button type="button" class="xb" data-act="spclose" aria-label="${this._t('Chiudi')}">${fvIcon('x', '#fff', 16, 2)}</button></div>
      <div style="display:flex;flex-direction:column;gap:8px">${rows}${restRow}</div></div>`;
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
    const se = this._socEnts(l).map((x) => x.e); soc = this._socTxt(se, this._narrow);
    const nm = this._name(l);
    const nsub = this._subs(l).length; const sbg = nsub ? this._sbHtml('m-' + key.slice(2), (p[0] + sq / 2) / W * 100, (p[1] - sq / 2) / H * 100, this._narrow ? 22 : 26, nm) : '';
    return `<button type="button" class="sqr" ${this._dk({ kind: 'mx', key, met: 'w' })} title="${fvEsc(nm)}" aria-label="${fvEsc(this._t('Storico {0}', nm))}" style="left:${(p[0] / W * 100).toFixed(3)}%;top:${(p[1] / H * 100).toFixed(3)}%;width:${(sq / W * 100).toFixed(3)}%;border-color:${on ? col : 'rgba(255,255,255,.22)'};box-shadow:${on ? '0 0 18px ' + col + '44' : 'none'};opacity:${on ? 1 : .62}">
      ${soc ? `<span class="q1" data-soc="${fvEsc(se.join('|'))}"${this._narrow ? ' data-short="1"' : ''}>${fvEsc(soc)}</span>` : ''}${fvIcon(l.icon || 'bolt', col, this._narrow ? 14 : 16)}<span class="q2" style="color:${on ? '#fff' : 'rgba(255,255,255,.6)'}">${pct} %</span><span class="q3">${fvEsc(nm)}</span><span class="q4 mono" style="color:${col}">${fvEsc(this._fw(w))}</span><span class="bw"><span class="qb" style="width:${fvClamp(pct, 0, 100)}%"></span></span>${this._wr('loads', [l.entity]) ? this._wrHtml('bl') : ''}</button>${sbg}`;
  }
  /* triangolo "carichi non monitorati": casa meno la somma delle utenze inserite, con la quota sul consumo */
  _unHtml(p, W, H, sz, o) {
    const col = '#ff6fb5'; const on = o.on; const c = on ? col : 'rgba(255,255,255,.6)';
    return `<div class="un" role="img" aria-label="${fvEsc(this._t('Carichi non monitorati {0}', o.val))}" style="position:absolute;left:${(p[0] / W * 100).toFixed(3)}%;top:${(p[1] / H * 100).toFixed(3)}%;width:${(sz / W * 100).toFixed(3)}%;aspect-ratio:100 / 90;transform:translate(-50%,-50%);opacity:${on ? 1 : .55};pointer-events:none">
      <svg viewBox="0 0 100 90" style="position:absolute;inset:0;width:100%;height:100%;overflow:visible;filter:drop-shadow(0 0 ${on ? o.gr : 0}px ${col}99)" aria-hidden="true"><polygon points="4,5 96,5 50,86" fill="rgba(8,12,20,.96)" stroke="${on ? col : 'rgba(255,255,255,.22)'}" stroke-width="2.4" stroke-linejoin="round"/></svg>
      <div style="position:absolute;left:0;right:0;top:6%;display:flex;flex-direction:column;align-items:center"><span style="font-size:${o.fs}px;font-weight:700;white-space:nowrap;color:${c}">${fvEsc(o.val)}</span><span style="font-size:${o.ps}px;font-weight:600;white-space:nowrap;color:${c};opacity:.85">${fvEsc(o.pct)}</span></div>
      <span style="position:absolute;left:50%;bottom:100%;transform:translateX(-50%);${o.nar ? `margin-bottom:2px;width:46px;white-space:normal;text-align:center;line-height:1.1;font-size:7px;padding:1px 3px;border-radius:7px;background:rgba(8,12,20,.95);border:1px solid rgba(255,111,181,.35)` : `margin-bottom:3px;white-space:nowrap;font-size:${o.ls}px`};color:${c}">${this._t('Carichi non monitorati')}</span></div>`;
  }
  _invHtml(p, W, H, wd, ht, o) {
    const n = this._narrow; const ax = o.ax != null;
    return `<div class="ivb" ${ax ? `data-act="axpop" data-ax="${o.ax}" role="button" aria-label="${fvEsc(this._t('Impostazioni {0}', o.name))}" ` : ''}style="${ax ? 'cursor:pointer;' : ''}left:${(p[0] / W * 100).toFixed(3)}%;top:${(p[1] / H * 100).toFixed(3)}%;width:${(wd / W * 100).toFixed(3)}%;aspect-ratio:${wd} / ${ht};padding:${n ? 4 : 8}px;border-radius:${n ? 18 : 20}px">${fvIcon('inv', FV_COL.axp, n ? 14 : 20)}<span class="mono" style="font-size:${n ? 8 : 9.5}px;letter-spacing:${n ? '.1' : '.14'}em;color:#ff8a5c">${fvEsc(o.name)}</span><span style="font-size:${n ? 15 : 18}px;font-weight:700;line-height:1.1">${fvEsc(o.out)}</span><span class="mono" style="font-size:${n ? 7.5 : 9}px;letter-spacing:.04em;color:rgba(255,255,255,.7)">${this._t('IN {0}', fvEsc(o.inn))}</span>${ax ? `<span class="mono" style="font-size:${n ? 6.5 : 8}px;letter-spacing:.1em;color:#ff8a5c;opacity:.85">⚙ ${this._t('IMPOSTAZIONI')}</span>` : ''}</div>`;
  }
  _loadHtml(l, i, w, home, style) {
    const on = w > 5; const pct = Math.round(w / Math.max(1, home) * 100); const col = FV_COL.ind;
    let sub = l.sub || ''; if (l.sub_entity) { const st = this._st(l.sub_entity); if (st) { const u = st.attributes.unit_of_measurement; const nv = parseFloat(st.state); sub = (isNaN(nv) ? st.state : this._f(nv)) + (u ? ' ' + u : ''); } }
    const se = this._socEnts(l).map((x) => x.e); const socT = this._socTxt(se); const subH = socT ? `<span data-soc="${fvEsc(se.join('|'))}" style="color:#2ee87a">${fvEsc(socT)}</span>` : fvEsc(sub); if (socT) sub = socT;
    return `<button type="button" class="ld" data-act="open" data-kind="load" data-i="${i}" aria-label="${fvEsc(this._t('Storico {0}', this._name(l)))}" style="${style};border-color:${on ? col : 'rgba(255,255,255,.22)'};box-shadow:${on ? '0 0 22px ' + col + '40' : 'none'};opacity:${on ? 1 : .62};color:#fff">
      <span class="ic" style="border-color:${on ? col : 'rgba(255,255,255,.22)'}">${fvIcon(l.icon || 'bolt', col, 20)}</span>
      <span class="tx"><b>${fvEsc(this._name(l))}</b><i style="color:${on ? col : 'rgba(255,255,255,.6)'}">${subH}${sub ? ' · ' : ''}${pct} %</i></span>
      <span class="vv" style="color:${on ? col : 'rgba(255,255,255,.6)'}">${fvEsc(this._fw(w))}</span><span class="bw"><span class="bar" style="width:${fvClamp(pct, 0, 100)}%"></span></span>${this._wr('loads', [l.entity]) ? this._wrHtml('tl') : ''}</button>`;
  }
  _loadCircle(l, i, w, style) {
    const on = w > 5; const col = FV_COL.ind; const bd = on ? col : 'rgba(255,255,255,.22)'; const vc = on ? col : 'rgba(255,255,255,.6)';
    const sel = this._sel && this._sel.kind === 'load' && this._sel.i === i;
    return `<button type="button" class="ldc" data-act="open" data-kind="load" data-i="${i}" aria-label="${fvEsc(this._t('Storico {0}', this._name(l)))}" style="${style};opacity:${on ? 1 : .62}">
      <span class="c" style="border-color:${bd};box-shadow:${on ? '0 0 18px ' + col + '55' : 'none'}${sel ? ',0 0 0 2px ' + col : ''}">${fvIcon(l.icon || 'bolt', col, 14)}<span class="v" style="color:${vc}">${fvEsc(this._fw(w))}</span></span>
      <span class="l">${fvEsc(this._name(l))}</span>${this._wr('loads', [l.entity]) ? this._wrHtml('tl') : ''}</button>`;
  }
  _axBox(p, W, H, w, h, o) {
    const n = this._narrow;
    return `<div data-act="axpop" role="button" aria-label="${this._t('Impostazioni inverter')}" style="cursor:pointer;position:absolute;left:${(p[0] / W * 100).toFixed(3)}%;top:${(p[1] / H * 100).toFixed(3)}%;width:${(w / W * 100).toFixed(3)}%;aspect-ratio:${w} / ${h};transform:translate(-50%,-50%);padding:${n ? 6 : 14}px;border-radius:${n ? 16 : 22}px;border:1.5px solid ${FV_COL.axp};background:linear-gradient(160deg,rgba(255,138,92,.16),rgba(8,12,20,.97) 60%);box-shadow:0 0 34px rgba(255,138,92,.3);display:flex;flex-direction:column;align-items:center;justify-content:center;gap:${n ? 2 : 4}px;text-align:center">
      ${fvIcon('inv', FV_COL.axp, n ? 20 : 26)}<span class="mono" style="font-size:${n ? 8 : 10}px;letter-spacing:.16em;color:${FV_COL.axp}">${fvEsc(o.name)}</span>
      <span style="font-size:${n ? 14 : 21}px;font-weight:700;white-space:nowrap">${fvEsc(o.inn)}</span>
      <span class="mono" style="font-size:${n ? 8 : 9.5}px;letter-spacing:.06em;color:rgba(255,255,255,.7);white-space:nowrap">${fvEsc(o.sub)}</span>
      <span class="mono" style="font-size:${n ? 8 : 9.5}px;letter-spacing:.06em;color:#5fd0ff;white-space:nowrap">${this._t('OUT {0}', fvEsc(o.out))}</span>
      <span class="mono" style="margin-top:${n ? 1 : 4}px;font-size:${n ? 7 : 8.5}px;letter-spacing:.12em;color:${FV_COL.axp};opacity:.85;white-space:nowrap">⚙ ${n ? this._t('IMPOSTA') : this._t('IMPOSTAZIONI')}</span></div>`;
  }
  _etaChip(d, cap, min) {
    cap = Number(cap);
    if (!(cap > 0) || d.soc == null) return '';
    min = min != null && min !== '' ? Number(min) : 20;
    const fmt = (h) => { const m = Math.round(h * 60); if (m < 1) return '< 1 min'; if (m < 60) return m + ' min'; const hh = Math.floor(m / 60); const mm = m % 60; return hh + ' h' + (mm ? ' ' + mm + ' min' : ''); };
    let t = ''; let col = FV_COL.bat;
    if (d.b > 5) t = d.soc >= 100 ? this._t('BATTERIA PIENA') : this._t('PIENA TRA {0}', fmt((100 - d.soc) / 100 * cap * 1000 / d.b));
    else if (d.b < -5) { col = FV_COL.red; t = d.soc <= min ? this._t('SOTTO IL {0} %', min) : this._t('{0} % TRA {1}', min, fmt((d.soc - min) / 100 * cap * 1000 / -d.b)); }
    else return '';
    return `<span class="chip" style="border-color:${col}66;background:${col}14;color:${col}">${fvEsc(t)}</span>`;
  }
  _renderFlow() {
    if (this._config.mode === 'multi' && this._config.inverters.length) { this._renderMulti(); return; }
    const c = this._config; const d = this._flowData(); const nar = this._narrow; const C = FV_COL; const f = d.f;
    const n = c.loads.length; const lr = 25; const bats = d.bats; const nb = bats.length; const dense = n > 8; const dual = d.dual;
    const step = dense && !nar ? 62 : 72;
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
      unTri = this._unHtml([P.casa[0], ty], W, H, sz2, { val: this._fw(un), pct: Math.round(un / Math.max(1, d.home) * 100) + ' %', on, fs: nar ? 10 : 13, ps: nar ? 8 : 10, ls: nar ? 8 : 11.5, gr: nar ? 6 : 10, nar });
    }
    const holes = (dual ? P.m : [P.sol]).map((p) => `<circle cx="${p[0]}" cy="${p[1]}" r="${(dual ? msz : sz) / 2 + 2}" fill="#000"/>`).join('') + [P.rete].concat(P.b).map((p) => `<circle cx="${p[0]}" cy="${p[1]}" r="${sz / 2 + 2}" fill="#000"/>`).join('') + `<circle cx="${P.casa[0]}" cy="${P.casa[1]}" r="${cs / 2 + 2}" fill="#000"/>`
      + `<rect x="${P.inv[0] - iw / 2 - 1}" y="${P.inv[1] - ih / 2 - 1}" width="${iw + 2}" height="${ih + 2}" rx="${nar ? 17 : 22}" fill="#000"/>`
      + (nar ? lp.map((p) => `<circle cx="${p[0]}" cy="${p[1]}" r="${lr + 2}" fill="#000"/>`).join('') : lp.map((p) => `<rect x="${p[0] - 147}" y="${p[1] - ldH / 2}" width="294" height="${ldH}" rx="18" fill="#000"/>`).join(''));
    const volt = d.volt != null ? this._f(d.volt) + ' ' + d.vu : '';
    const fr = c.grid.frequency_entity ? this._raw(c.grid.frequency_entity) : null;
    const batNode = (bt, i) => {
      const cfg = i ? c.battery2 : c.battery; const nm = this._batName(i); const ip = i ? 5 : 2; const col = bt.b < -5 ? C.red : C.bat;
      return this._nodeHtml(P.b[i], W, H, sz, { col, ic: 'bat', val: bt.soc != null ? this._f(bt.soc, 0) + ' %' : '—', sub: cfg.entity ? (bt.b >= 0 ? '+' : '−') + this._fw(Math.abs(bt.b)) : '', lab: nm, active: !!cfg.entity, wr: this._wr('battery', [cfg.entity, cfg.soc_entity]), src: cfg.entity ? { kind: 'src', i: ip, met: 'w' } : (cfg.soc_entity ? { kind: 'src', i: ip, met: 's' } : null),
        split: cfg.entity && cfg.soc_entity ? { top: { kind: 'src', i: ip, met: 's' }, topLab: this._t('{0} carica', nm), bot: { kind: 'src', i: ip, met: 'w' }, botLab: this._t('{0} potenza', nm) } : null });
    };
    const solNode = (pos, val, act, lab, src, wr) => this._nodeHtml(pos, W, H, msz, { col: C.sol, ic: 'sol', val: this._fw(val), sub: dual ? '' : (c.solar.sub || ''), lab, labTop: true, active: act, src, wr });
    const solName = c.solar.name && c.solar.name !== this._t('Solare') ? c.solar.name : '';
    const solNodes = dual
      ? d.ms.map((w, k) => solNode(P.m[k], w, w > 5, sm[k].name, { kind: 'src', i: sm[k].i }, this._wr('mppt', [sm[k].cfg.entity, sm[k].cfg.voltage_entity, sm[k].cfg.current_entity]))).join('')
      : this._nodeHtml(P.sol, W, H, sz, { col: C.sol, ic: 'sol', val: this._fw(c.solar.entity ? d.pv : null), sub: c.solar.sub || '', lab: c.solar.name || this._t('Solare'), labTop: true, active: d.pv > 5, src: c.solar.entity ? { kind: 'src', i: 0 } : null, wr: this._wr('mppt', [c.solar.entity, c.solar.voltage_entity, c.solar.current_entity]) });
    const nodes = solNodes
      + this._nodeHtml(P.rete, W, H, sz, { col: C.rete, ic: 'rete', val: (d.g < -5 ? '−' : '') + this._fw(c.grid.entity ? Math.abs(d.g) : null), sub: volt, lab: c.grid.name || this._t('Rete'), active: Math.abs(d.g) > 5, src: c.grid.entity ? { kind: 'src', i: 1 } : null, eco: this._ecoTxt(), wr: this._wr('rete', [c.grid.entity, c.grid.voltage_entity, c.grid.frequency_entity]) })
      + bats.map(batNode).join('')
      + this._axBox(P.inv, W, H, iw, ih, { name: nar ? (this._ul() === 'de' ? 'WR' : this._t('INVERTER')) : (c.axpert.title || this._t('INVERTER')).toUpperCase(), inn: this._fw(d.pv + d.grid + f.bc), sub: nar ? (fr != null ? this._f(fr, 1) + ' Hz' : this._t('IN')) : this._t('IN') + (fr != null ? ' · ' + this._f(fr, 2) + ' Hz' : ''), out: this._fw(d.home) })
      + this._nodeHtml(P.casa, W, H, cs, { col: C.casa, ic: 'casa', val: this._fw(d.home), sub: volt, lab: c.home.name || this._t('Casa'), active: true, wr: this._wr('loads', [c.home.entity]), wp: nar ? 'tl' : 'tr', src: c.home.entity ? { kind: 'src', i: 3 } : null })
      + unTri;
    const tdot = (pos, i, lab, col) => `<button type="button" class="tdot" ${this._dk({ kind: 'src', i, met: 'w' })} title="${fvEsc(lab)}" aria-label="${fvEsc(lab)}" style="left:${(pos[0] / W * 100).toFixed(3)}%;top:${(pos[1] / H * 100).toFixed(3)}%;width:${nar ? 15 : 20}px;height:${nar ? 15 : 20}px;border-color:${col};box-shadow:0 0 8px ${col}77"><i style="background:${col}"></i></button>`;
    const tdots = (dual && c.solar.energy_total_entity ? tdot([P.inv[0], iTop[1] - (nar ? 34 : 60)], 10, this._t('Energia totale MPPT'), C.sol) : '') + (nb === 2 && (c.battery.energy_total_in_entity || c.battery.energy_total_out_entity) ? tdot(mid, 11, this._t('Energia totale batterie'), C.bat) : '');
    const wst = `width:${(294 / W * 100).toFixed(3)}%;aspect-ratio:294 / ${ldH}`;
    const loadsWide = nar ? c.loads.map((l, k) => this._loadCircle(l, k, d.loads[k].w, `left:${(lp[k][0] / W * 100).toFixed(3)}%;top:${(lp[k][1] / H * 100).toFixed(3)}%;width:${(lr * 2 / W * 100).toFixed(3)}%;aspect-ratio:1`)).join('') : c.loads.map((l, k) => this._loadHtml(l, k, d.loads[k].w, d.home, `left:${(lp[k][0] / W * 100).toFixed(3)}%;top:${(lp[k][1] / H * 100).toFixed(3)}%;${wst}`)).join('');
    const sbgs = c.loads.map((l, k) => (this._subs(l).length ? this._sbHtml('l-' + k, nar ? (lp[k][0] + lr * .71) / W * 100 : (lp[k][0] + 147) / W * 100, nar ? (lp[k][1] - lr * .71) / H * 100 : (lp[k][1] - ldH / 2) / H * 100, nar ? 20 : 26, this._name(l)) : '')).join('');
    const body = `<div class="fw ${nar ? 'nr' : ''}" style="aspect-ratio:${W} / ${H};${nar ? 'max-width:420px;margin:0 auto' : ''}"><svg class="flow" viewBox="0 0 ${W} ${H}" aria-hidden="true"><defs><mask id="fvmk"><rect x="-200" y="-200" width="3000" height="3000" fill="#fff"/>${holes}</mask></defs><g mask="url(#fvmk)">${E.join('')}</g></svg>${nodes}${loadsWide}${sbgs}${tdots}</div>`;
    const lc = this.shadowRoot.querySelector('.cols .lc'); if (lc) lc.style.display = nar ? 'none' : '';
    const cl = this.shadowRoot.querySelector('.cols span'); if (cl) cl.textContent = this._t('CATENA ENERGETICA · FONTI › INVERTER › CASA › UTENZE');
    const empty = !c.solar.entity && !c.grid.entity && !c.battery.entity ? `<div class="empty" style="margin-bottom:12px">${this._t("Apri l'editor della card e collega le entità: fonti, utenze, indicatori, inverter e storico.")}</div>` : '';
    this._setFlow(empty + body);
    const chip = (t, col) => `<span class="chip" style="border-color:${col}66;background:${col}14;color:${col}">${fvEsc(t)}</span>`;
    this._$('chips').innerHTML = chip((dual ? this._t('SOLARE') : (c.solar.name || this._t('SOLARE'))).toUpperCase() + ' ' + this._fw(c.solar.entity ? d.pv : null), C.sol) + chip(this._t('RETE') + ' ' + (d.g < -5 ? '↑ ' : '↓ ') + this._fw(c.grid.entity ? Math.abs(d.g) : null), C.rete) + chip(this._t('BATTERIA') + ' ' + (d.soc != null ? this._f(d.soc, 0) + ' %' : '—'), bcol) + this._etaChip(d, c.battery.capacity_kwh, c.battery.min_soc) + this._blChip();
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
    nd(nar ? [88, 70] : [85, cm], nar ? 72 : 110, { col: C.rete, ic: 'rete', val: (totW < -5 ? '−' : '') + this._fw(Math.abs(totW)), sub: N === 3 ? this._t('TRIFASE') : this._t('RETE'), lab: c.grid.name || this._t('Rete Enel'), active: Math.abs(totW) > 5, eco: this._ecoTxt(), wr: this._wr('rete', invs.map((v) => v.phase && v.phase.entity)), fs: nar ? 14 : 18, ss: nar ? 8 : 9.5, is: nar ? 18 : 22, src: { kind: 'mx', key: 'r' } });
    if (nar) {
      /* dorsale a sinistra che alimenta le fasi */
      eb([52, 70], [5, 70], d.sumPh, C.rete); eb([5, 70], [5, cy[0]], d.sumPh, C.rete);
      for (let i = 0; i < N - 1; i++) eb([5, cy[i]], [5, cy[i + 1]], d.inv.slice(i + 1).reduce((a, x) => a + x.pw, 0), C.rete);
    }
    d.inv.forEach((v, i) => {
      const iv = invs[i]; const c0 = cy[i]; const ph = iv.phase || {}; const ivn = (iv.name || this._t('INVERTER {0}', i + 1)).toUpperCase();
      nd(nar ? [88, c0] : [250, c0], nar ? 52 : 96, { col: C.rete, ic: 'rete', val: this._fw(v.pw), sub: v.v != null ? this._f(v.v, 1) + ' ' + v.vu : '', lab: ph.name || this._t('Fase L{0}', i + 1), active: Math.abs(v.pw) > 5, wr: this._wr('rete', [ph.entity, ph.voltage_entity]), fs: nar ? 11 : 16, ss: nar ? 7.5 : 9.5, is: nar ? 14 : 20, src: { kind: 'mx', key: 'f-' + i } });
      if (nar) { eb([5, c0], [62, c0], v.pw, C.rete); eb([114, c0], [138, c0], v.pw, C.rete); }
      else { E.push(v.pw >= 0 ? this._edge(this._S([140, cm], [202, c0]), v.pw, C.rete) : this._edge(this._S([202, c0], [140, cm]), -v.pw, C.rete)); eb([298, c0], [379, c0], v.pw, C.rete); }
      const ms = this._mppts(iv); const nM = ms.length; const msz = nar ? (nM >= 4 ? 44 : nM === 3 ? 48 : 50) : 64; const my = c0 - (nar ? 95 : 125);
      const mcx = nar ? (nM >= 4 ? 160 : nM === 3 ? 176 : IX) : IX; const mgp = nar ? (nM >= 4 ? 46 : nM === 3 ? 54 : 60) : 90;
      v.ms.forEach((m, j) => {
        const px = nM === 1 ? IX : nM === 2 ? (j ? IX + (nar ? 30 : 45) : IX - (nar ? 30 : 45)) : mcx + (j - (nM - 1) / 2) * mgp; const tx = nM <= 2 ? px : IX + (px - mcx) * (nar ? .65 : .45);
        nd([px, my], msz, { col: C.sol, ic: 'sol', val: this._fw(m.w), sub: '', lab: ms[j].name || 'MPPT ' + (j + 1), labTop: true, active: m.w > 5, wr: this._wr('mppt', [ms[j].entity, ms[j].voltage_entity, ms[j].current_entity]), fs: nar ? (nM >= 4 ? 9.5 : 11) : 12.5, ss: 8, is: nar ? (nM >= 4 ? 12 : 14) : 16, src: { kind: 'mx', key: 'm-' + i + '-' + j } });
        const y1 = my + msz / 2; const y2 = c0 - (nar ? 40 : 61); const ym = (y1 + y2) / 2;
        E.push(this._edge(tx === px ? this._L([px, y1], [px, y2]) : 'M' + px + ' ' + y1 + ' C' + px + ' ' + ym + ' ' + tx + ' ' + ym + ' ' + tx + ' ' + y2, m.w, C.sol));
      });
      if (v.bon) {
        const by = c0 + (nar ? 98 : 135); const bs = nar ? 62 : 72; const bcol = v.bw < 0 ? C.red : C.bat; const bnm = (iv.battery && iv.battery.name) || this._t('Batteria {0}', i + 1); const y0 = c0 + (nar ? 40 : 61);
        nd([IX, by], bs, { col: bcol, ic: 'bat', val: v.soc != null ? this._f(v.soc, 0) + ' %' : '—', sub: (v.bw >= 0 ? '+' : '−') + this._fw(Math.abs(v.bw)), lab: bnm, active: true, wr: this._wr('battery', [iv.battery && iv.battery.entity, iv.battery && iv.battery.soc_entity]), fs: nar ? 12 : 13.5, ss: nar ? 9 : 10.5, is: nar ? 12 : 14,
          split: { top: { kind: 'mx', key: 'b-' + i, met: 's' }, topLab: this._t('{0} carica', bnm), bot: { kind: 'mx', key: 'b-' + i, met: 'w' }, botLab: this._t('{0} potenza', bnm) } });
        E.push(v.bw >= 0 ? this._edge(this._L([IX, y0], [IX, by - bs / 2]), v.bw, C.bat) : this._edge(this._L([IX, by - bs / 2], [IX, y0]), -v.bw, C.red));
      }
      nodes.push(this._invHtml([IX, c0], W, H, nar ? 96 : 150, nar ? 77 : 120, { name: ivn, out: this._fw(v.out), inn: this._fw(v.inn), ax: ['controls', 'switches', 'readings'].some((k) => iv.axpert[k].some((x) => x && x.entity)) ? i : null }));
      hr.push(nar ? { x: IX - 49, y: c0 - 40, w: 98, h: 80, rx: 18 } : { x: IX - 76, y: c0 - 61, w: 152, h: 122, rx: 20 });
      const hm = iv.home || {};
      nd(nar ? [296, c0] : [720, c0], nar ? 56 : 110, { col: C.casa, ic: 'casa', val: this._fw(v.out), sub: ivn, lab: hm.name || this._t('Casa {0}', i + 1), active: true, wr: this._wr('loads', [hm.entity]), wp: nar ? 'tl' : 'tr', fs: nar ? 12 : 17, ss: nar ? 7 : 9, is: nar ? 16 : 22, src: hm.entity ? { kind: 'mx', key: 'c-' + i } : null });
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
        const rw = rows[Math.floor(o.k / 4)]; const p = [XS[o.k % 4], rw.yc]; const pct = Math.round(o.w / Math.max(1, c.loads_pct_total ? d.home : v.out) * 100);
        nodes.push(this._sqHtml(o.l, 'l-' + i + '-' + o.k, p, W, H, sq, o.w, pct)); hr.push({ x: p[0] - sq / 2, y: p[1] - sq / 2, w: sq, h: sq, rx: 14 });
      });
    });
    const holes = hc.map((h) => `<circle cx="${h[0]}" cy="${h[1]}" r="${h[2]}" fill="#000"/>`).join('') + hr.map((h) => `<rect x="${h.x}" y="${h.y}" width="${h.w}" height="${h.h}" rx="${h.rx}" fill="#000"/>`).join('');
    const body = `<div class="fw ${nar ? 'nr' : ''}" style="aspect-ratio:${W} / ${H};${nar ? 'max-width:420px;margin:0 auto' : ''}"><svg class="flow" viewBox="0 0 ${W} ${H}" aria-hidden="true"><defs><mask id="fvmk"><rect x="-200" y="-200" width="3000" height="3000" fill="#fff"/>${holes}</mask></defs><g mask="url(#fvmk)">${E.join('')}</g></svg>${nodes.join('')}</div>`;
    const lc = this.shadowRoot.querySelector('.cols .lc'); if (lc) lc.style.display = 'none';
    const cl = this.shadowRoot.querySelector('.cols span'); if (cl) cl.textContent = (N === 3 ? this._t('RETE TRIFASE') + ' · ' : '') + (N === 1 ? this._t('{0} INVERTER', N) : this._t('{0} INVERTER · {0} CASE CON LE LORO UTENZE', N));
    this._setFlow(body);
    const chip = (t, col) => `<span class="chip" style="border-color:${col}66;background:${col}14;color:${col}">${fvEsc(t)}</span>`;
    const eq = Math.abs(d.net) < 20; const bcol = eq ? '#9fb0c4' : d.net > 0 ? C.bat : C.red; const sg = (w) => (w >= 0 ? '+' : '−') + this._fw(Math.abs(w));
    const bchip = d.nb ? `<button type="button" class="chip" data-act="bpop" aria-label="${this._t('Dettaglio batterie')}" style="border-color:${bcol}66;background:${bcol}14;color:${bcol};cursor:pointer">${fvEsc(this._t('BATTERIE') + ' ' + (d.soc != null ? this._f(d.soc, 0) + ' %' : '—') + ' · ' + sg(d.net))}</button>` : '';
    const sh = !!this._config.shared_battery; const cap = sh ? (Number(invs[0] && invs[0].battery && invs[0].battery.capacity_kwh) || 0) : invs.reduce((a, v) => a + (Number(v.battery && v.battery.capacity_kwh) || 0), 0); const mn = ((sh ? invs.slice(0, 1) : invs).find((v) => v.battery && v.battery.min_soc != null && v.battery.min_soc !== '') || { battery: {} }).battery.min_soc;
    this._$('chips').innerHTML = chip(this._t('SOLARE') + ' ' + this._fw(d.pv), C.sol) + chip(this._t('RETE') + ' ' + (totW < -5 ? '↑ ' : '↓ ') + this._fw(Math.abs(totW)), C.rete) + chip(this._t('CARICHI') + ' ' + this._fw(d.home), C.ind) + bchip + this._etaChip({ b: d.net, soc: d.soc }, cap, mn) + this._blChip();
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
      return `<div style="padding:10px 14px;border-radius:14px;border:1px solid rgba(255,255,255,.1);display:flex;flex-direction:column;gap:7px"><div style="display:flex;justify-content:space-between;align-items:baseline;gap:8px"><div><div style="font-size:14px;font-weight:600">${fvEsc((iv.battery && iv.battery.name) || this._t('Batteria {0}', i + 1))}</div><div class="mono" style="font-size:10px;letter-spacing:.08em;color:rgba(255,255,255,.5)">${fvEsc((iv.name || this._t('Inverter {0}', i + 1)) + (v.soc != null ? ' · ' + this._f(v.soc, 0) + ' %' : ''))}</div></div><div style="text-align:right"><div style="font-size:16px;font-weight:700;color:${col}">${fvEsc(sg(v.bw))}</div><div class="mono" style="font-size:9.5px;letter-spacing:.1em;color:${col}">${v.bw > 5 ? this._t('IN CARICA') : v.bw < -5 ? this._t('IN SCARICA') : this._t('FERMA')}</div></div></div>
        <div style="position:relative;height:6px;border-radius:3px;background:rgba(255,255,255,.07)"><i style="position:absolute;top:0;bottom:0;left:${(v.bw >= 0 ? 50 : 50 - wd).toFixed(1)}%;width:${wd.toFixed(1)}%;background:${col};border-radius:3px"></i><b style="position:absolute;left:50%;top:-2px;bottom:-2px;width:1px;background:rgba(255,255,255,.4)"></b></div></div>`;
    }).join('');
    const sheet = pop.querySelector('.sheet'); if (sheet) { sheet.style.borderColor = vcol + '80'; sheet.style.boxShadow = '0 0 50px ' + vcol + '2e'; }
    body.innerHTML = `<div style="padding:18px 20px 22px;display:flex;flex-direction:column;gap:14px">
      <div style="display:flex;justify-content:space-between;align-items:flex-start;gap:12px"><div><div class="mono" style="font-size:11px;letter-spacing:.16em;color:rgba(255,255,255,.7)">${this._t('BATTERIE · TOTALE')}</div><div style="font-size:12.5px;color:rgba(255,255,255,.55);margin-top:3px">${this._t(rows.length === 1 ? '{0} batteria, una per inverter' : '{0} batterie, una per inverter', rows.length)}</div></div><button type="button" class="xb" data-act="bpclose" aria-label="${this._t('Chiudi')}">${fvIcon('x', '#fff', 16, 2)}</button></div>
      <span class="mono" style="align-self:flex-start;padding:8px 14px;border-radius:999px;border:1px solid ${vcol}66;background:${vcol}18;font-size:11px;letter-spacing:.12em;color:${vcol}">${eq ? this._t('IN EQUILIBRIO') : net > 0 ? this._t('IN CARICA') : this._t('IN SCARICA')}</span>
      <div style="display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:10px">${box(this._t('POTENZA NETTA'), sg(net), vcol, true)}${box(this._t('CARICA MEDIA'), d.soc != null ? this._f(d.soc, 0) + ' %' : '—', vcol, true)}</div>
      <div style="display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:10px">${box(this._t('ENTRA · {0} batt.', gin.length), gin.length ? '+' + this._fw(gin.reduce((a, x) => a + x.v.bw, 0)) : '—', C.bat, false)}${box(this._t('ESCE · {0} batt.', gout.length), gout.length ? '−' + this._fw(-gout.reduce((a, x) => a + x.v.bw, 0)) : '—', C.red, false)}</div>
      <div style="display:flex;flex-direction:column;gap:8px">${list}</div></div>`;
  }

  /* ---------- indicatori ---------- */
  _indVal(i) { const it = this._config.indicators[i]; return it ? this._raw(it.entity) : null; }
  _renderTiles() {
    const c = this._config; const el = this._$('tiles'); if (!el) return;
    if (!c.indicators.length) { el.innerHTML = ''; return; }
    const lk = c.indicators_look || ''; const ring = lk !== 'tiles' && lk !== 'barsT'; const ringT = lk === 'ringT'; const barT = lk === 'barsT';
    const items = c.indicators.map((it, i) => {
      const v = this._indVal(i); const col = fvColorOf(it, v, '#5fd0ff'); const sel = this._sel && this._sel.kind === 'ind' && this._sel.i === i;
      const mn = it.min != null && it.min !== '' ? +it.min : 0; const mx = it.max != null && it.max !== '' ? +it.max : 100;
      /* se la scala attraversa lo zero (min < 0 < max) lo zero va nel punto giusto e la barra parte da lì */
      const zc = mn < 0 && mx > 0; const z = zc ? -mn / (mx - mn) : 0; const f = v == null ? (zc ? z : 0) : fvClamp((v - mn) / ((mx - mn) || 1), 0, 1);
      const u = it.unit != null && it.unit !== '' ? it.unit : this._unit(it.entity); const txt = v == null ? '—' : this._f(v, it.decimals) + (u ? ' ' + u : '');
      const bd = sel ? col : (v != null && f > .01 ? col + '55' : 'rgba(255,255,255,.08)');
      /* aspetti «a soglie visibili»: fasce delle soglie sempre visibili sbiadite, riempimento acceso dallo zero al valore */
      if (ringT || barT) {
        const bz = fvBands(it, '#5fd0ff'); const bs = [{ f: -Infinity, c: bz.base }].concat(bz.on ? bz.rows : []); const pcf = (x) => fvClamp((x - mn) / ((mx - mn) || 1), 0, 1);
        const zn = bs.map((q, k) => ({ a: k ? pcf(q.f) : 0, b: k < bs.length - 1 ? pcf(bs[k + 1].f) : 1, c: q.c })); const lo = Math.min(z, f); const hi = Math.max(z, f);
        const bdT = sel ? col : (v != null && Math.abs(f - z) > .01 ? col + '55' : 'rgba(255,255,255,.08)');
        if (barT) {
          const zs = zn.map((q) => { const ll = Math.max(q.a, lo); const lw = Math.max(0, Math.min(q.b, hi) - ll); return `<i style="left:${(q.a * 100).toFixed(2)}%;width:${((q.b - q.a) * 100).toFixed(2)}%;background:${q.c};opacity:.22"></i>${lw > 1e-4 ? `<i style="left:${(ll * 100).toFixed(2)}%;width:${(lw * 100).toFixed(2)}%;background:${q.c};box-shadow:0 0 10px ${q.c}"></i>` : ''}`; }).join('');
          return `<button type="button" class="tile" data-act="open" data-kind="ind" data-i="${i}" aria-label="${fvEsc(this._t('Storico {0}', this._name(it)))}" style="border-color:${bdT};background:${sel ? col + '18' : 'rgba(255,255,255,.04)'};box-shadow:${sel ? '0 0 22px ' + col + '55' : 'none'}">
        <span class="tl">${fvEsc(this._name(it).toUpperCase())}</span><span class="tv" style="color:${col}">${fvEsc(txt)}</span>
        <span class="tbz">${zs}${zc ? `<b style="left:${(z * 100).toFixed(2)}%"></b>` : ''}</span></button>`;
        }
        const A = (x) => (135 + 270 * x) * Math.PI / 180; const P = (x, r) => (60 + r * Math.cos(A(x))).toFixed(2) + ' ' + (60 + r * Math.sin(A(x))).toFixed(2);
        const rp = (t0, t1) => (t1 - t0 > 1e-4 ? `M${P(t0, 46)}A46 46 0 ${270 * (t1 - t0) > 180 ? 1 : 0} 1 ${P(t1, 46)}` : '');
        const rz = zn.map((q) => { const d0 = rp(q.a, q.b); return d0 ? `<path d="${d0}" fill="none" stroke="${q.c}" stroke-width="7" stroke-opacity=".22"/>` : ''; }).join('');
        const rl = zn.map((q) => { const d1 = rp(Math.max(q.a, lo), Math.min(q.b, hi)); return d1 ? `<path d="${d1}" fill="none" stroke="${q.c}" stroke-width="7" style="filter:drop-shadow(0 0 5px ${q.c})"/>` : ''; }).join('');
        return `<button type="button" class="rt" data-act="open" data-kind="ind" data-i="${i}" aria-label="${fvEsc(this._t('Storico {0}', this._name(it)))}" style="border-color:${bdT};background:${sel ? col + '18' : 'rgba(255,255,255,.04)'};box-shadow:${sel ? '0 0 22px ' + col + '55' : 'none'}">
          <span class="rw"><svg viewBox="0 0 120 112" style="width:100%;display:block" aria-hidden="true">${rz}${rl}${zc ? `<path d="M${P(z, 37)}L${P(z, 54)}" stroke="rgba(255,255,255,.9)" stroke-width="2" stroke-linecap="round"/>` : ''}</svg><span class="rv" style="color:${col}">${fvEsc(txt)}</span></span>
          <span class="rl">${fvEsc(this._name(it).toUpperCase())}</span></button>`;
      }
      if (ring && zc) {
        const A = (x) => (135 + 270 * x) * Math.PI / 180; const P = (x, r) => (60 + r * Math.cos(A(x))).toFixed(1) + ' ' + (60 + r * Math.sin(A(x))).toFixed(1); const d = Math.abs(f - z) < .004 ? .004 * (f >= z ? 1 : -1) : f - z; const e = z + d;
        return `<button type="button" class="rt" data-act="open" data-kind="ind" data-i="${i}" aria-label="${fvEsc(this._t('Storico {0}', this._name(it)))}" style="border-color:${bd};background:${Math.abs(f - z) > .01 ? col + '12' : 'rgba(255,255,255,.03)'};box-shadow:${sel ? '0 0 22px ' + col + '55' : 'none'}">
          <span class="rw"><svg viewBox="0 0 120 112" style="width:100%;display:block" aria-hidden="true"><path d="M27.5 92.5A46 46 0 1 1 92.5 92.5" fill="none" stroke="rgba(255,255,255,.1)" stroke-width="7" stroke-linecap="round"/><path d="M${P(z, 38)}L${P(z, 54)}" stroke="rgba(255,255,255,.45)" stroke-width="2"/><path d="M${P(z, 46)}A46 46 0 ${Math.abs(d) * 270 > 180 ? 1 : 0} ${d >= 0 ? 1 : 0} ${P(e, 46)}" fill="none" stroke="${col}" stroke-width="7" stroke-linecap="round" style="filter:drop-shadow(0 0 6px ${col})"/></svg><span class="rv">${fvEsc(txt)}</span></span>
          <span class="rl">${fvEsc(this._name(it).toUpperCase())}</span></button>`;
      }
      if (ring) {
        const ff = Math.max(.004, f); const b = (135 + 270 * ff) * Math.PI / 180; const rx = (60 + 46 * Math.cos(b)).toFixed(1); const ry = (60 + 46 * Math.sin(b)).toFixed(1);
        return `<button type="button" class="rt" data-act="open" data-kind="ind" data-i="${i}" aria-label="${fvEsc(this._t('Storico {0}', this._name(it)))}" style="border-color:${bd};background:${f > .01 ? col + '12' : 'rgba(255,255,255,.03)'};box-shadow:${sel ? '0 0 22px ' + col + '55' : 'none'}">
          <span class="rw"><svg viewBox="0 0 120 112" style="width:100%;display:block" aria-hidden="true"><path d="M27.5 92.5A46 46 0 1 1 92.5 92.5" fill="none" stroke="rgba(255,255,255,.1)" stroke-width="7" stroke-linecap="round"/><path d="M27.5 92.5A46 46 0 ${270 * ff > 180 ? 1 : 0} 1 ${rx} ${ry}" fill="none" stroke="${col}" stroke-width="7" stroke-linecap="round" style="filter:drop-shadow(0 0 6px ${col})"/></svg><span class="rv">${fvEsc(txt)}</span></span>
          <span class="rl">${fvEsc(this._name(it).toUpperCase())}</span></button>`;
      }
      return `<button type="button" class="tile" data-act="open" data-kind="ind" data-i="${i}" aria-label="${fvEsc(this._t('Storico {0}', this._name(it)))}" style="border-color:${bd};background:${sel ? col + '18' : col + '12'};box-shadow:${sel ? '0 0 22px ' + col + '55' : 'none'}">
        <span class="tl">${fvEsc(this._name(it).toUpperCase())}</span><span class="tv" style="color:${col}">${fvEsc(txt)}</span>
        <span class="tb">${zc ? `<i style="position:absolute;top:0;bottom:0;left:${(Math.min(f, z) * 100).toFixed(1)}%;width:${(Math.abs(f - z) * 100).toFixed(1)}%;background:${col}"></i><b style="position:absolute;left:${(z * 100).toFixed(1)}%;top:0;bottom:0;width:1px;background:rgba(255,255,255,.5)"></b>` : `<i style="width:${(f * 100).toFixed(1)}%;background:${col}"></i>`}</span></button>`;
    }).join('');
    el.innerHTML = `<div class="hh" style="margin-bottom:10px"><span>${this._t('INDICATORI')}</span><span style="color:rgba(255,255,255,.5);letter-spacing:.08em;font-size:10px">${this._t('TOCCA PER LO STORICO')}</span></div><div class="tiles ${ring ? 'rings' : ''}">${items}</div>`;
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
    if (m.empty) { yax.innerHTML = ''; xl.innerHTML = ''; this._cm[kind] = null; plot.innerHTML = `<svg viewBox="0 0 600 ${H}" preserveAspectRatio="none" style="height:${kind === 'h' ? (this._config.history.height || 260) : H}px"></svg><div class="nod">${m.loading ? this._t('Carico lo storico…') : this._t('Nessun dato nel periodo')}</div>`; return; }
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
    el.innerHTML = [[this._t('MIN'), Math.min(...v)], [this._t('MEDIA'), avg], [this._t('MAX'), Math.max(...v)]].map(([l, x]) => `<div><span>${l}</span><b>${fvEsc(f(x))}</b></div>`).join('');
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
      const v = a[lo][1]; const d = dots[k]; if (v == null) { d.style.display = 'none'; rows += `<span class="tr"><i style="background:${s.color}"></i><span style="flex:1;color:rgba(255,255,255,.8)">${fvEsc(s.name)}</span><b style="color:rgba(255,255,255,.5)">${this._t('non disp.')}</b></span>`; return; } d.style.display = 'block'; d.style.left = (f * 100) + '%'; d.style.top = (cm.Y(v) / cm.H * 100).toFixed(2) + '%';
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
  _pmet(e, x) { return e ? Object.assign({ id: 'w', label: this._t('POTENZA'), entity: e }, x || {}) : null; }
  _vmet(e) { return e ? { id: 'v', label: this._t('TENSIONE'), entity: e, unit: this._unit(e) || 'V' } : null; }
  _socEnts(l) { return [[l.soc_entity, l.soc_name], [l.soc2_entity, l.soc2_name], [l.soc3_entity, l.soc3_name]].filter((x) => x[0]).map((x) => ({ e: x[0], n: x[1] || '' })); }
  _socMets(l) { const L = this._socEnts(l); return L.map((x, k) => { const m = this._smet(x.e, L.length === 1 ? this._t('SOC AUTO') : (x.n || this._t('AUTO {0}', k + 1))); m.id = k ? 's' + (k + 1) : 's'; return m; }); }
  _socTxt(ents, short) {
    const L = (ents || []).filter(Boolean); if (!L.length) return ''; const v = (e) => { const x = this._raw(e); return x == null ? null : this._f(x, 0); };
    if (L.length === 1) { const a = v(L[0]); return a == null ? '' : 'SOC ' + a + ' %'; }
    const k = (this._rot || 0) % L.length; const a = v(L[k]) == null ? '—' : v(L[k]); return this._t('AUTO {0}', k + 1) + (short ? ' ' + a + '%' : ' · ' + a + ' %');
  }
  _alOn(sec) { const a = this._config && this._config.alerts; return !!(a && a[sec]); }
  _entBad(e) {
    if (!e || !this._hass || !this._hass.states) return false; const st = this._hass.states[e]; if (!st) return true; const sv = st.state;
    if (sv === 'unknown') return !['button', 'input_button', 'scene', 'script'].includes(fvDomain(e));
    return sv === 'unavailable' || sv === '' || sv == null || sv === 'None' || sv === 'none' || sv === 'null';
  }
  _wr(sec, ents) { return this._alOn(sec) && ents.some((e) => this._entBad(e)); }
  _wrHtml(pos) { return `<svg class="wr ${pos}" viewBox="0 0 24 22" role="img" aria-label="${fvEsc(this._t('Entità non disponibile o non valida'))}"><title>${fvEsc(this._t('Entità non disponibile o non valida'))}</title><path d="M12 1.5 23 20.5H1z" fill="#ffd24a" stroke="#0b111c" stroke-width="1.2" stroke-linejoin="round"/><path d="M12 8v6M12 16.8v.1" stroke="#0b111c" stroke-width="2" stroke-linecap="round" fill="none"/></svg>`; }
  _ageSec(sp) {
    const H = this._hass; if (!H || !H.states) return null; let mx = null;
    ((sp && sp.ents) || []).forEach((e) => { const st = e && H.states[e]; if (!st || !st.last_updated) return; const t = Date.parse(st.last_updated); if (isNaN(t)) return; const v = Math.max(0, Math.floor((Date.now() - t) / 1000)); mx = mx == null ? v : Math.max(mx, v); });
    return mx;
  }
  _agoTxt(v) { return v < 60 ? this._t('{0} s fa', v) : v < 3600 ? this._t('{0} min fa', Math.floor(v / 60)) : this._t('{0} h {1} min fa', Math.floor(v / 3600), Math.floor(v % 3600 / 60)); }
  _updHtml(sp) { const v = this._ageSec(sp); if (v == null) return ''; return `<span class="upd" data-upd="1"><i style="background:${v < 3 ? '#34d399' : 'rgba(255,255,255,.3)'};box-shadow:${v < 3 ? '0 0 6px #34d399' : 'none'}"></i><span>${fvEsc(this._t('AGGIORNATO {0}', this._agoTxt(v)))}</span></span>`; }
  _tickUpd() {
    if (!this.shadowRoot || !this._sel) return; const sp = this._panelSpec(); if (!sp) return; const els = this.shadowRoot.querySelectorAll('.upd'); if (!els.length) return; const h = this._updHtml(sp); if (!h) return;
    els.forEach((el) => { if (el.outerHTML !== h) el.outerHTML = h; });
  }
  _actOf(l) { return l && l.action_entity ? { e: l.action_entity, n: l.action_name || '', n2: l.action_name_on || '' } : null; }
  _actInfo(a) {
    const d = fvDomain(a.e); const st = this._hass && this._hass.states[a.e]; const sv = st ? st.state : null; const press = d === 'button' || d === 'input_button' || d === 'scene' || d === 'script';
    const on = !press && sv === 'on'; const pend = !!(this._actP && this._actP.e === a.e && Date.now() < this._actP.t); const na = !st || sv === 'unavailable' || (!press && sv === 'unknown');
    return { press, on, pend, na: na && !pend, bt: pend ? '…' : on ? (a.n2 || this._t('SPEGNI')) : (a.n || this._t(press ? 'AVVIA' : 'ACCENDI')), tx: press ? '' : pend ? this._t('INVIO COMANDO…') : on ? this._t('ACCESO') : na ? this._t('NON DISPONIBILE') : this._t('SPENTO') };
  }
  _actHtml(sp) {
    const a = sp && sp.act; if (!a) return ''; const i = this._actInfo(a); const G = '#34d399'; const c = i.on ? G : i.pend ? '#fbbf24' : 'rgba(255,255,255,.75)';
    return `<div class="actr" style="border-color:${i.on ? G + '80' : 'rgba(255,255,255,.18)'};background:${i.on ? G + '14' : 'rgba(255,255,255,.03)'}"><span class="actt" style="color:${c}">${fvEsc(i.tx)}</span><button type="button" class="actb" data-act="doact" ${i.na || i.pend ? 'disabled' : ''} style="border-color:${i.on ? 'rgba(255,255,255,.35)' : sp.col};background:${i.on ? 'transparent' : sp.col + '33'};box-shadow:${i.on ? 'none' : '0 0 18px ' + sp.col + '55'}">${fvEsc(i.bt)}</button></div>`;
  }
  _doAct() {
    const sp = this._panelSpec(); const a = sp && sp.act; if (!a || !this._hass) return; const i = this._actInfo(a); if (i.pend || i.na) return; const d = fvDomain(a.e);
    let dom = 'homeassistant'; let svc = i.on ? 'turn_off' : 'turn_on'; if (d === 'button' || d === 'input_button') { dom = d; svc = 'press'; } else if (d === 'scene' || d === 'script') { dom = d; svc = 'turn_on'; }
    this._actP = { e: a.e, t: Date.now() + 1500 }; clearTimeout(this._actT); this._actT = setTimeout(() => { this._actP = null; this._patchPanel(); }, 1600);
    try { Promise.resolve(this._hass.callService(dom, svc, { entity_id: a.e })).catch(() => { this._actP = null; this._patchPanel(); }); } catch (e) { this._actP = null; }
    this._patchPanel();
  }
  _smet(e, label) { return e ? { id: 's', label: label || 'SOC', entity: e, unit: this._unit(e) || '%', dec: 0 } : null; }
  /* corrente: dall'entità se c'è, altrimenti potenza / tensione */
  _amet(a, p, v) { if (a) return { id: 'a', label: this._t('CORRENTE'), entity: a, unit: this._unit(a) || 'A' }; return p && v ? { id: 'a', label: this._t('CORRENTE'), derive: { type: 'ratio', p, v, ents: [p, v] }, unit: 'A', dec: 1 } : null; }
  _biGrid() { return { p: { c: FV_COL.rete, l: this._t('PRELIEVO DALLA RETE') }, n: { c: FV_COL.red, l: this._t('IMMISSIONE IN RETE') } }; }
  _biBat(bc) { const pos = !bc || bc.charging_positive !== false; return pos ? { p: { c: FV_COL.bat, l: this._t('IN CARICA') }, n: { c: FV_COL.red, l: this._t('IN SCARICA') } } : { p: { c: FV_COL.red, l: this._t('IN SCARICA') }, n: { c: FV_COL.bat, l: this._t('IN CARICA') } }; }
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
    if (s.kind === 'src' && (s.i === 10 || s.i === 11)) {
      const eo = { entity: '', ents: [], derive: null, neg: false, unit: '', dec: '', bands: null, ind: null, bi: null, tabs: [], met: 'w', eo: true };
      if (s.i === 10) return Object.assign(eo, { name: this._t('MPPT · ENERGIA TOTALE'), sub: this._t('SOMMA DEGLI {0} MPPT', this._smp().length), col: C.sol });
      return Object.assign(eo, { name: this._t('BATTERIE · ENERGIA TOTALE'), sub: this._t('SOMMA DELLE 2 BATTERIE'), col: C.bat });
    }
    if (s.kind === 'src') {
      const bi = s.i === 5 ? 1 : 0; const bcfg = bi ? c.battery2 : c.battery;
      if (s.i === 0) { const nm = this._smp().length > 1 ? (c.solar.name && c.solar.name !== this._t('Solare') ? c.solar.name : 'MPPT 1') : (c.solar.name || this._t('Solare')); return this._mkSpec(nm, this._smp().length > 1 ? this._t('INGRESSO SOLARE') : (c.solar.sub || ''), C.sol, this._solMets(c.solar)); }
      if (s.i >= 7 && s.i <= 9) { const mk = { 7: 'mppt2', 8: 'mppt3', 9: 'mppt4' }[s.i]; return this._mkSpec(c.solar[mk].name || 'MPPT ' + (s.i - 5), this._t('INGRESSO SOLARE'), C.sol, this._solMets(c.solar[mk])); }
      if (s.i === 1) return this._mkSpec(c.grid.name || 'Rete', this._flowData().volt != null ? this._f(this._flowData().volt) + ' ' + this._flowData().vu : '', C.rete, [this._pmet(c.grid.entity, { bi: this._biGrid(), neg: c.grid.import_positive === false }), this._vmet(c.grid.voltage_entity)]);
      if (s.i === 3) return this._mkSpec(c.home.name || 'Casa', '', C.casa, [this._pmet(c.home.entity)]);
      if (s.i === 2 || s.i === 5) return this._mkSpec(this._batName(bi), '', C.bat, this._batMets(bcfg));
      return null;
    }
    if (s.kind === 'load') {
      const l = c.loads[s.i]; if (!l || !l.entity) return null;
      const sp = this._mkSpec(this._name(l), l.sub || '', C.ind, [this._pmet(l.entity), ...this._socMets(l)]); if (sp) sp.act = this._actOf(l); return sp;
    }
    if (s.kind === 'mx') return this._mxSpec(s.key);
    if (s.kind === 'sub') { const par = this._subParent(s.key); if (!par) return null; const x = this._subs(par.l)[s.i]; if (!x) return null; const sp = this._mkSpec(this._name(par.l) + ' · ' + x.name, 'SOTTOCARICO', C.ind, [this._pmet(x.entity)]); if (sp) sp.act = x.act; return sp; }
    return null;
  }
  _mxSpec(key) {
    const c = this._config; const C = FV_COL; const p = String(key).split('-'); const t = p[0]; const i = +p[1]; const iv = c.inverters[i];
    if (t === 'r') {
      const ents = c.inverters.map((v) => v.phase && v.phase.entity).filter(Boolean); const neg = c.grid.import_positive === false;
      const w = c.grid.entity ? this._pmet(c.grid.entity, { bi: this._biGrid(), neg }) : (ents.length ? { id: 'w', label: this._t('POTENZA'), derive: { type: 'sum', ents }, unit: this._unit(ents[0]) || 'W', bi: this._biGrid() } : null);
      return this._mkSpec(c.grid.name || this._t('Rete Enel'), c.inverters.length === 3 ? this._t('TRIFASE') : '', C.rete, [w]);
    }
    if (!iv) return null; const ivn = iv.name || this._t('Inverter {0}', i + 1);
    if (t === 'f') { const ph = iv.phase || {}; return this._mkSpec(ph.name || this._t('Fase L{0}', i + 1), ivn, C.rete, [this._pmet(ph.entity, { bi: this._biGrid(), neg: ph.import_positive === false }), this._vmet(ph.voltage_entity)]); }
    if (t === 'm') { const j = +p[2]; const m = this._mppts(iv)[j]; if (!m) return null; return this._mkSpec(m.name || 'MPPT ' + (j + 1), ivn + ' · ' + this._t('INGRESSO SOLARE'), C.sol, this._solMets(m)); }
    if (t === 'c') { const h = iv.home || {}; return this._mkSpec(h.name || this._t('Casa {0}', i + 1), ivn, C.casa, [this._pmet(h.entity)]); }
    if (t === 'b') { const b = iv.battery || {}; return this._mkSpec(b.name || this._t('Batteria {0}', i + 1), ivn, C.bat, this._batMets(b)); }
    if (t === 'l') { const l = (iv.loads || [])[+p[2]]; if (!l || !l.entity) return null; const sp = this._mkSpec(this._name(l), ivn + (l.sub ? ' · ' + l.sub : ''), C.ind, [this._pmet(l.entity), ...this._socMets(l)]); if (sp) sp.act = this._actOf(l); return sp; }
    return null;
  }
  _panelHost() { const s = this._sel; return this._$(s && s.kind !== 'ind' ? 'cpanel' : 'panel'); }
  _renderPanel() {
    const el = this._panelHost(); if (!el) return; const sp = this._panelSpec();
    if (!sp) { el.innerHTML = ''; return; }
    const rg = (r) => `<button type="button" class="pill ${this._prng === r ? 'on' : ''}" data-act="range" data-t="p" data-r="${r}">${this._t(FV_RANGES[r].label).replace(' ', '')}</button>`;
    const thl = !sp.bi && sp.bands && sp.bands.on ? `<div class="thl"><span style="letter-spacing:.14em;color:rgba(255,255,255,.5)">${this._t('SOGLIE')}</span><span><i style="background:${sp.bands.base}"></i>&lt; ${fvEsc(this._f(sp.bands.rows[0].f))}</span>${sp.bands.rows.map((r) => `<span><i style="background:${r.c}"></i>≥ ${fvEsc(this._f(r.f))}${sp.unit ? ' ' + fvEsc(sp.unit) : ''}</span>`).join('')}</div>` : '';
    const tabs = sp.tabs.length ? `<div class="pills" style="align-self:flex-start;flex-wrap:wrap">${sp.tabs.map((t) => `<button type="button" class="pill ${sp.met === t.id ? 'on' : ''}" data-act="met" data-m="${t.id}">${fvEsc(t.label)}</button>`).join('')}</div>` : '';
    const bil = sp.bi ? `<div class="bil"><span style="color:${sp.bi.p.c}">▲ ${fvEsc(sp.bi.p.l)}</span><span style="color:${sp.bi.n.c}">▼ ${fvEsc(sp.bi.n.l)}</span></div>` : '';
    if (sp.eo) {
      el.innerHTML = `<div class="pnl" style="border-color:${sp.col}77;background:linear-gradient(180deg,${sp.col}14,rgba(8,12,20,.6));box-shadow:0 0 30px ${sp.col}22">
      <div class="ph"><div style="display:flex;flex-direction:column;gap:2px"><span class="pl">${fvEsc(sp.name.toUpperCase())}</span><span class="tip0">${fvEsc(sp.sub)}</span>${this._updHtml(sp)}</div>
      <div style="display:flex;align-items:center;gap:8px"><button type="button" class="xb" data-act="close" aria-label="${this._t('Chiudi storico')}">${fvIcon('x', '#fff', 16, 2)}</button></div></div>
      ${this._enCfg() ? '<div class="enb" id="enb"></div>' : ''}</div>`;
      this._patchPanel(); this._renderEn(); this._enLoad(); return;
    }
    el.innerHTML = `<div class="pnl" style="border-color:${sp.col}77;background:linear-gradient(180deg,${sp.col}14,rgba(8,12,20,.6));box-shadow:0 0 30px ${sp.col}22">
      <div class="ph"><div style="display:flex;flex-direction:column;gap:2px"><span class="pl">${fvEsc(sp.name.toUpperCase())}</span> ${sp.sub ? `<span class="tip0">${fvEsc(sp.sub)}</span>` : ''}${this._updHtml(sp)}<span class="pv" data-live="1" style="color:${sp.col}"></span></div>
      <div style="display:flex;align-items:center;gap:8px"><div class="pills">${rg('24h')}${rg('7g')}</div><button type="button" class="xb" data-act="close" aria-label="${this._t('Chiudi storico')}">${fvIcon('x', '#fff', 16, 2)}</button></div></div>
      ${tabs}${this._actHtml(sp)}${bil}<div class="plotw"><div class="yax" id="py" style="height:170px"></div><div class="pc"><div class="cplot" id="pp" data-k="p" style="height:170px"></div><div class="xl" id="px"></div></div></div>${thl}<div class="stats" id="pst"></div>${this._enCfg() ? '<div class="enb" id="enb"></div>' : ''}</div>`;
    this._patchPanel(); this._paint('p'); this._renderEn(); this._enLoad();
  }
  _patchPanel() {
    const sp = this._panelSpec(); const inl = this._$('panel'); const mod = this._$('cpanel'); const pop = this._$('cpop'); if (!inl || !mod) return;
    const useMod = !!(sp && this._sel && this._sel.kind !== 'ind'); const el = useMod ? mod : inl; const other = useMod ? inl : mod;
    if (other.innerHTML) { if (other === mod) { clearTimeout(this._ct); this._ct = setTimeout(() => { if (!(pop && pop.classList.contains('on'))) mod.innerHTML = ''; }, 520); } else other.innerHTML = ''; } this._popOn(pop, useMod);
    if (!sp) { if (el.innerHTML) el.innerHTML = ''; this._pkey = null; return; }
    const key = JSON.stringify(this._sel) + this._prng + this._met + sp.col;
    if (this._pkey !== key) { this._pkey = key; this._renderPanel(); return; }
    if (useMod) { const sh = pop && pop.querySelector('.sheet'); if (sh) { sh.style.borderColor = sp.col + '80'; sh.style.boxShadow = '0 0 50px ' + sp.col + '33'; } }
    const ue = el.querySelector('.upd'); if (ue) { const uh = this._updHtml(sp); if (uh && ue.outerHTML !== uh) ue.outerHTML = uh; }
    const ar = el.querySelector('.actr'); if (ar && sp.act) { const h = this._actHtml(sp); if (this._actH !== h) { this._actH = h; ar.outerHTML = h; } } else this._actH = null;
    const lv = el.querySelector('[data-live]'); if (!lv) return; const v = this._specVal(sp);
    lv.textContent = this._fmtv(v, sp); lv.style.color = sp.col;
  }

  /* ---------- energia per periodo (contatori in kWh, statistiche del recorder) ---------- */
  _enCfg() {
    const s = this._sel; if (!s) return null; const c = this._config; let o = null;
    const gr = (g) => ({ a: (g || {}).energy_entity, b: (g || {}).energy_out_entity, mode: 'grid' });
    const bt = (b) => ({ a: (b || {}).energy_in_entity, b: (b || {}).energy_out_entity, mode: 'bat' });
    const one = (x, m) => ({ a: x && x.energy_entity, b: '', mode: m });
    if (s.kind === 'load') o = one(c.loads[s.i], 'cons');
    else if (s.kind === 'src') {
      if (s.i === 10) o = { a: c.solar.energy_total_entity, b: '', mode: 'prod' };
      else if (s.i === 11) o = { a: c.battery.energy_total_in_entity, b: c.battery.energy_total_out_entity, mode: 'bat' };
      else if (s.i === 0) o = one(c.solar, 'prod'); else if (s.i >= 7 && s.i <= 9) o = one(c.solar[{ 7: 'mppt2', 8: 'mppt3', 9: 'mppt4' }[s.i]], 'prod');
      else if (s.i === 1) o = gr(c.grid); else if (s.i === 3) o = one(c.home, 'cons'); else if (s.i === 2) o = bt(c.battery); else if (s.i === 5) o = bt(c.battery2);
    } else if (s.kind === 'mx') {
      const p = String(s.key).split('-'); const t = p[0]; const iv = c.inverters[+p[1]];
      if (t === 'r') o = gr(c.grid);
      else if (iv) { if (t === 'f') o = gr(iv.phase); else if (t === 'm') o = one(this._mppts(iv)[+p[2]], 'prod'); else if (t === 'c') o = one(iv.home, 'cons'); else if (t === 'b') o = bt(iv.battery); else if (t === 'l') o = one((iv.loads || [])[+p[2]], 'cons'); }
    }
    if (!o || (!o.a && !o.b)) return null; if (o.mode === 'grid' && !o.a) return null;
    return o;
  }
  _enDay() { const t = new Date(); t.setHours(0, 0, 0, 0); let d = this._ed ? new Date(this._ed + 'T00:00:00') : new Date(t); if (isNaN(d) || d > t) d = new Date(t); return { d, t }; }
  _enIso(x) { return x.getFullYear() + '-' + String(x.getMonth() + 1).padStart(2, '0') + '-' + String(x.getDate()).padStart(2, '0'); }
  _enR(p, d) {
    let s; let e;
    if (p === 'd') { s = new Date(d); e = new Date(d.getFullYear(), d.getMonth(), d.getDate() + 1); }
    else if (p === 'w') { s = new Date(d.getFullYear(), d.getMonth(), d.getDate() - ((d.getDay() + 6) % 7)); e = new Date(s.getFullYear(), s.getMonth(), s.getDate() + 7); }
    else if (p === 'm') { s = new Date(d.getFullYear(), d.getMonth(), 1); e = new Date(d.getFullYear(), d.getMonth() + 1, 1); }
    else { s = new Date(d.getFullYear(), 0, 1); e = new Date(d.getFullYear() + 1, 0, 1); }
    return { s, e };
  }
  _enSh(p, d, n) {
    if (p === 'd') return new Date(d.getFullYear(), d.getMonth(), d.getDate() + n);
    if (p === 'w') return new Date(d.getFullYear(), d.getMonth(), d.getDate() + 7 * n);
    if (p === 'm') { const x = new Date(d.getFullYear(), d.getMonth() + n, 1); return new Date(x.getFullYear(), x.getMonth(), Math.min(d.getDate(), new Date(x.getFullYear(), x.getMonth() + 1, 0).getDate())); }
    return new Date(d.getFullYear() + n, d.getMonth(), Math.min(d.getDate(), 28));
  }
  _enN(p, s) { return p === 'd' ? 24 : p === 'w' ? 7 : p === 'm' ? new Date(s.getFullYear(), s.getMonth() + 1, 0).getDate() : 12; }
  _enBS(p, s, j) { return p === 'd' ? new Date(s.getFullYear(), s.getMonth(), s.getDate(), j) : p === 'y' ? new Date(s.getFullYear(), j, 1) : new Date(s.getFullYear(), s.getMonth(), s.getDate() + j); }
  async _enFetch(id, p, r) {
    const PER = { d: 'hour', w: 'day', m: 'day', y: 'month' }; const n = this._enN(p, r.s);
    const q = { type: 'recorder/statistics_during_period', start_time: r.s.toISOString(), end_time: r.e.toISOString(), statistic_ids: [id], period: PER[p], types: ['change', 'sum'], units: { energy: 'kWh' } };
    let res; try { res = await this._hass.callWS(q); } catch (e) { delete q.units; res = await this._hass.callWS(q); }
    const arr = (res && res[id]) || []; const vals = new Array(n).fill(null); let ps = null; let any = false;
    arr.forEach((x) => {
      const t = typeof x.start === 'number' ? x.start : Date.parse(x.start); let v = x.change; if ((v == null || isNaN(v)) && x.sum != null && ps != null) v = x.sum - ps; if (x.sum != null) ps = x.sum; if (v == null || isNaN(v)) return;
      const dt = new Date(t); let j; if (p === 'd') j = dt.getHours(); else if (p === 'y') j = dt.getMonth(); else j = Math.round((new Date(dt.getFullYear(), dt.getMonth(), dt.getDate()) - r.s) / 864e5);
      if (j < 0 || j >= n) return; vals[j] = (vals[j] || 0) + Math.max(0, v); any = true;
    });
    return { vals, any, ts: Date.now() };
  }
  _enLoad(force) {
    const cf = this._enCfg(); if (!cf || !this._hass) return; const p = this._ep; const { d } = this._enDay(); const r = this._enR(p, d); const pr = this._enR(p, this._enSh(p, d, -1)); const jobs = []; const now = Date.now();
    [cf.a, cf.b].filter(Boolean).forEach((id) => [r, pr].forEach((rg) => {
      const k = id + '|' + p + '|' + rg.s.getTime(); const e = this._ec[k]; const live = rg.e.getTime() > now;
      if (e && !(live && (force || now - e.ts > 120000))) return; if (this._el[k]) return; this._el[k] = true;
      jobs.push(this._enFetch(id, p, rg).then((x) => { this._ec[k] = x; }).catch(() => { this._ec[k] = { vals: new Array(this._enN(p, rg.s)).fill(null), any: false, ts: now, err: true }; }).then(() => { delete this._el[k]; }));
    }));
    if (jobs.length) Promise.all(jobs).then(() => this._renderEn());
  }
  _renderEn() {
    const el = this._$('enb'); if (!el) return; const cf = this._enCfg(); if (!cf) { el.innerHTML = ''; return; }
    const sp = this._panelSpec(); const col = sp ? sp.col : '#5fd0ff'; const p = this._ep; const { d, t } = this._enDay(); const r = this._enR(p, d); const pr = this._enR(p, this._enSh(p, d, -1));
    const n = this._enN(p, r.s); const now = Date.now(); const L = this._lang(); const pad = (x) => String(x).padStart(2, '0');
    const get = (id, rg) => (id ? this._ec[id + '|' + p + '|' + rg.s.getTime()] || null : null);
    const A = get(cf.a, r); const B = get(cf.b, r); const PA = get(cf.a, pr);
    const waiting = (cf.a && !A) || (cf.b && !B); const bi = cf.mode === 'bat' || (cf.mode === 'grid' && !!(cf.a && cf.b));
    const va = (A && A.vals) || new Array(n).fill(null); const vb = bi ? ((B && B.vals) || new Array(n).fill(null)) : new Array(n).fill(null);
    const fut = va.map((_, j) => this._enBS(p, r.s, j).getTime() > now); let k = 0; fut.forEach((f) => { if (!f) k++; });
    const sum = (a) => a.reduce((x, v, j) => x + (fut[j] || v == null ? 0 : v), 0); const tot = sum(va); const tot2 = sum(vb);
    const ptot = PA && PA.vals ? PA.vals.slice(0, k).reduce((x, v) => x + (v || 0), 0) : 0;
    const fk = (x) => (x < 1 ? Math.round(x * 1000) + ' Wh' : x.toLocaleString(L, { minimumFractionDigits: x < 10 ? 2 : 1, maximumFractionDigits: x < 10 ? 2 : 1 }) + ' kWh');
    const fs = (x) => (x < 0 ? '−' : '+') + fk(Math.abs(x));
    const bat = cf.mode === 'bat'; const cUp = bat ? '#2ee87a' : col; const cDn = bat ? '#ff5a5a' : '#2ee87a';
    const mx = Math.max(0.0001, ...va.map((x, j) => (fut[j] ? 0 : Math.max(x || 0, vb[j] || 0))));
    const eh = this._eh; const lab = (j) => { const b = this._enBS(p, r.s, j); return p === 'd' ? pad(j) + ':00 – ' + pad((j + 1) % 24) + ':00' : p === 'y' ? b.toLocaleDateString(L, { month: 'long', year: 'numeric' }) : b.toLocaleDateString(L, { weekday: 'short', day: 'numeric', month: 'short' }); };
    const tk = (j) => { const b = this._enBS(p, r.s, j); return p === 'd' ? (j % 3 === 0 ? pad(j) : '') : p === 'w' ? b.toLocaleDateString(L, { weekday: 'short', day: 'numeric' }) : p === 'm' ? (j === 0 || (j + 1) % 5 === 0 ? String(j + 1) : '') : b.toLocaleDateString(L, { month: 'short' }); };
    const bars = va.map((x, j) => { const h1 = fut[j] || x == null ? 2 : Math.max(3, Math.round(x / mx * 100)); const h2 = fut[j] || vb[j] == null ? 2 : Math.max(3, Math.round(vb[j] / mx * 100)); const o = fut[j] ? 0.18 : eh == null || eh === j ? 1 : 0.55;
      return `<div class="enc" data-act="enh" data-j="${j}"><div class="en1"><i style="height:${h1}%;background:${eh === j ? '#fff' : cUp};opacity:${o}"></i></div>${bi ? `<div class="en2"><i style="height:${h2}%;background:${cDn};opacity:${o}"></i></div>` : ''}</div>`; }).join('');
    const ax = va.map((_, j) => `<span>${fvEsc(tk(j))}</span>`).join('');
    const ttl = p === 'd' ? d.toLocaleDateString(L, { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' }) : p === 'w' ? r.s.toLocaleDateString(L, { day: 'numeric', month: 'short' }) + ' – ' + new Date(r.e.getTime() - 864e5).toLocaleDateString(L, { day: 'numeric', month: 'short', year: 'numeric' }) : p === 'm' ? d.toLocaleDateString(L, { month: 'long', year: 'numeric' }) : String(d.getFullYear());
    const nxt = this._enR(p, this._enSh(p, d, 1)).s; const canN = nxt <= t;
    const verb = cf.mode === 'prod' ? 'ENERGIA PRODOTTA' : bat ? 'ENERGIA BATTERIA · ENTRATA E USCITA' : cf.mode === 'grid' ? (bi ? 'ENERGIA DELLA RETE · PRELIEVO E IMMISSIONE' : 'ENERGIA PRELEVATA') : 'ENERGIA CONSUMATA';
    const dl = ptot > 0 ? Math.round((tot - ptot) / ptot * 100) : 0; const up = dl >= 0; const good = cf.mode === 'prod' ? up : !up;
    const cmpTxt = !bi && ptot > 0 && k > 0 ? (up ? '▲ +' : '▼ ') + dl + ' % ' + this._t(p === 'd' ? 'rispetto a ieri' : p === 'w' ? 'rispetto alla settimana prima' : p === 'm' ? 'rispetto al mese prima' : "rispetto all'anno prima") : '';
    const l1 = bat ? '▲ ' + this._t('IN CARICA') : '▲ ' + this._t('PRELEVATA'); const l2 = bat ? '▼ ' + this._t('IN SCARICA') : '▼ ' + this._t('IMMESSA');
    const okv = va.filter((x, j) => !fut[j] && x != null); const hover = eh != null && eh < n;
    const note = waiting ? this._t('Caricamento…') : (A && A.err) || (B && B.err) ? this._t('Impossibile leggere le statistiche di energia') : !((A && A.any) || (B && B.any)) ? this._t('Nessun dato di energia in questo periodo') : hover ? lab(eh) + ' · ' + (fut[eh] ? '—' : bi ? '▲ ' + fk(va[eh] || 0) + '   ▼ ' + fk(vb[eh] || 0) : fk(va[eh] || 0)) : this._t('Tocca una barra per il dettaglio');
    const st = bi ? [[bat ? 'IN CARICA' : 'PRELEVATA', fk(tot)], [bat ? 'IN SCARICA' : 'IMMESSA', fk(tot2)], ['SALDO', fs(bat ? tot - tot2 : tot - tot2)]] : [[p === 'd' ? 'MEDIA / ORA' : p === 'y' ? 'MEDIA / MESE' : 'MEDIA / GIORNO', okv.length ? fk(tot / okv.length) : '—'], ['PICCO', okv.length ? fk(Math.max(...okv)) : '—'], ['MINIMO', okv.length ? fk(Math.min(...okv)) : '—']];
    const per = [['GIORNO', 'd'], ['SETTIMANA', 'w'], ['MESE', 'm'], ['ANNO', 'y']].map(([l, id]) => `<button type="button" class="pill ${p === id ? 'on' : ''}" data-act="enp" data-p="${id}">${this._t(l)}</button>`).join('');
    const ex = (this._config.economy || {}).export || {}; let mn = '';
    if (cf.mode === 'grid' && cf.b && ex.enabled) {
      const pr = Number(ex.price); const hasP = ex.price !== '' && ex.price != null && !isNaN(pr);
      mn = `<div style="display:flex;align-items:center;justify-content:space-between;gap:12px;border-radius:14px;border:1px solid rgba(110,231,183,.4);padding:10px 14px"><div><div class="enk">${fvEsc(this._t('ENERGIA IMMESSA IN RETE'))}</div><div class="env" style="color:#6ee7b7">${waiting ? '…' : fvEsc(fk(tot2))}</div></div><div style="text-align:right"><div class="enk">${fvEsc(this._t('RICAVO'))}</div><div class="env" style="color:#34d399">${waiting || !hasP ? (hasP ? '…' : '—') : '+' + fvEsc(this._eur(tot2 * pr))}</div><div class="enk" style="letter-spacing:.04em">${hasP ? '× ' + fvEsc(this._num(pr, 3) + ' ' + this._cur() + '/kWh') : fvEsc(this._t('Imposta il prezzo nell\'editor'))}</div></div></div>`;
    }
    el.innerHTML = `<div class="enh"><span class="enl">${this._t(verb)}</span><span style="color:${good ? '#2ee87a' : '#ff9a5c'};font-family:'IBM Plex Mono',ui-monospace,monospace;font-size:10px;letter-spacing:.08em">${fvEsc(cmpTxt)}</span></div>
      <div class="pills" style="align-self:flex-start;flex-wrap:wrap">${per}</div>
      <div class="enn"><button type="button" class="xb" data-act="enn" data-d="-1" aria-label="${fvEsc(this._t('Periodo precedente'))}">‹</button><span class="ent">${fvEsc(ttl)}</span><button type="button" class="xb" data-act="enn" data-d="1" aria-label="${fvEsc(this._t('Periodo successivo'))}" ${canN ? '' : 'disabled'}>›</button><input type="date" class="dti" data-act="end" value="${this._enIso(d)}" max="${this._enIso(t)}" aria-label="${fvEsc(this._t('Scegli la data'))}"><button type="button" class="pill" data-act="ent">${this._t('OGGI')}</button></div>
      <div class="entot"><div><div class="enk" style="color:${cUp}">${bi ? fvEsc(l1) : ''}</div><div class="env" style="color:${cUp}">${waiting ? '…' : fvEsc(fk(tot))}</div></div>${bi ? `<div><div class="enk" style="color:${cDn}">${fvEsc(l2)}</div><div class="env" style="color:${cDn}">${waiting ? '…' : fvEsc(fk(tot2))}</div></div>` : ''}</div>
      <div class="enbars">${bars}</div><div class="enax">${ax}</div><div class="enrd">${fvEsc(note)}</div>
      <div class="stats">${st.map(([l, v]) => `<div><span>${this._t(l)}</span><b>${fvEsc(v)}</b></div>`).join('')}</div>${mn}`;
  }

  /* ---------- costi e bolletta ---------- */
  _econ() { if (!this._hass || !this._config) return; this._ecLoad(); this._blLoad(); }
  _eco() { return this._config.economy || { export: {}, bill: {} }; }
  _cur() { return this._eco().currency || '€'; }
  _num(x, dg) { return Number(x).toLocaleString(this._lang(), { minimumFractionDigits: dg, maximumFractionDigits: dg }); }
  _eur(x) { return this._num(x, 2) + ' ' + this._cur(); }
  _econSig() { const e = this._eco(); return (e.export.enabled ? 'x' : '') + (e.bill.enabled ? 'b' : '') + (this._ecv ? this._ecv.sig : '') + '|' + (this._bl ? this._bl.sig : ''); }
  _blIds() {
    const c = this._config; const g = c.grid || {}; const inv = c.mode === 'multi' ? (c.inverters || []) : [];
    const ph = inv.map((v) => (v.phase && v.phase.energy_entity) || ''); const phO = inv.map((v) => (v.phase && v.phase.energy_out_entity) || '');
    return { tot: g.energy_entity ? [g.energy_entity] : ph.filter(Boolean), ph, out: g.energy_out_entity ? [g.energy_out_entity] : phO.filter(Boolean) };
  }
  _ecoTxt() {
    const ex = this._eco().export; if (!ex.enabled || !this._blIds().out.length) return null; const v = this._ecv; const x = v && v.kwh;
    const t = x == null ? '—' : x < 1 ? Math.round(x * 1000) + ' Wh' : this._num(x, 2) + ' kWh';
    return { t: this._t('IMMESSI OGGI'), v: '▼ ' + t };
  }
  async _ecLoad(force) {
    const ex = this._eco().export; if (!ex.enabled || !this._hass || this._ecBusy) return; const ids = this._blIds().out; if (!ids.length) return;
    const now = Date.now(); if (!force && this._ecv && now - this._ecv.ts < 120000) return; this._ecBusy = true;
    try { const s = new Date(); s.setHours(0, 0, 0, 0); const e = new Date(s.getFullYear(), s.getMonth(), s.getDate() + 1); let k = 0; for (const id of ids) { const r = await this._enFetch(id, 'd', { s, e }); (r.vals || []).forEach((v) => { k += v || 0; }); } this._ecv = { ts: now, kwh: k, sig: k.toFixed(2) }; }
    catch (x) { this._ecv = { ts: now, kwh: null, sig: 'e' }; }
    this._ecBusy = false; this._sigs.flow = null; this._update(false);
  }
  async _blHours(id, s, e) {
    const q = { type: 'recorder/statistics_during_period', start_time: s.toISOString(), end_time: e.toISOString(), statistic_ids: [id], period: 'hour', types: ['change', 'sum'], units: { energy: 'kWh' } };
    let res; try { res = await this._hass.callWS(q); } catch (x) { delete q.units; res = await this._hass.callWS(q); }
    const arr = (res && res[id]) || []; const out = []; let ps = null;
    arr.forEach((x) => { const t = typeof x.start === 'number' ? x.start : Date.parse(x.start); let v = x.change; if ((v == null || isNaN(v)) && x.sum != null && ps != null) v = x.sum - ps; if (x.sum != null) ps = x.sum; if (v == null || isNaN(v)) return; out.push({ t, v: Math.max(0, v) }); });
    return out;
  }
  async _blLoad(force) {
    const b = this._eco().bill; if (!b.enabled || !this._hass || this._blBusy) return; const now = Date.now(); if (!force && this._bl && now - this._bl.ts < 300000) return;
    const ids = this._blIds(); if (!ids.tot.length) { this._bl = { ts: now, miss: true, sig: 'm' }; this._sigs.flow = null; this._update(false); this._renderBlPop(); return; }
    this._blBusy = true; let res;
    try {
      const d0 = new Date(); const p = fvBillPer(b, d0); const nb = fvBillBands(b.type || 'fixed').length; const kb = new Array(nb).fill(0); const end = new Date(Math.min(p.e.getTime(), now));
      for (const id of ids.tot) { const hs = await this._blHours(id, p.s, end); hs.forEach((x) => { kb[fvBand(new Date(x.t), b)] += x.v; }); }
      const ph = []; const pe = this._blIds().ph; if (pe.filter(Boolean).length > 1) { for (const id of pe) { let k = 0; if (id) { (await this._blHours(id, p.s, end)).forEach((x) => { k += x.v; }); } ph.push(k); } }
      const t0 = new Date(d0.getFullYear(), d0.getMonth(), d0.getDate()); const dayN = Math.round((t0 - p.s) / 864e5) + 1; const daysT = Math.round((p.e - p.s) / 864e5); const el = Math.max(0.5, (now - p.s.getTime()) / 864e5);
      const cur = fvBillCalc(b, kb, dayN, p); const proj = fvBillCalc(b, kb.map((x) => x * daysT / el), daysT, p);
      res = { ts: now, p, dayN, daysT, kb, ph, cur, proj, sig: Math.round(cur.tot * 100) + '|' + dayN };
    } catch (x) { res = { ts: now, err: true, sig: 'e' }; }
    this._blBusy = false; this._bl = res; this._sigs.flow = null; this._update(false); this._renderBlPop(); this._blArchive();
  }
  async _estGet() { try { const r = await this._hass.callWS({ type: 'frontend/get_user_data', key: fvBillKey(this._config) }); const v = r && r.value; return v && Array.isArray(v.items) ? v.items.filter((h) => h && h.from && h.to) : []; } catch (x) { return null; } }
  async _estSet(items) { try { await this._hass.callWS({ type: 'frontend/set_user_data', key: fvBillKey(this._config), value: { v: 1, items } }); return true; } catch (x) { return false; } }
  /* a fine periodo la bolletta chiusa viene aggiunta allo storico come STIMATA (calcolata dalle statistiche con i prezzi impostati) e si scartano le più vecchie oltre il massimo */
  async _blArchive(force) {
    const b = this._eco().bill; if (!b.enabled || !this._hass || this._arBusy) return; const now = Date.now(); if (!force && this._arTs && now - this._arTs < 6 * 36e5) return;
    const ids = this._blIds().tot; if (!ids.length) return; this._arBusy = true; this._arTs = now;
    try {
      let est = await this._estGet(); if (est === null) { this._est = []; this._arBusy = false; return; }
      const manual = (b.history || []).filter((h) => h && h.from && h.to); const mx = b.period === 'mo' ? 12 : 6; const nb = fvBillBands(b.type || 'fixed').length; let ch = false;
      const n0 = est.length; est = est.filter((h) => !manual.some((x) => fvOverlap(x, h))); if (est.length !== n0) ch = true;
      const lim = b.start ? new Date(b.start + 'T00:00:00') : null; const hasLim = !!lim && !isNaN(lim); let p = fvBillPer(b, new Date()); let n = 0;
      while (n < mx) {
        p = fvBillPer(b, new Date(p.s.getTime() - 1)); n++; if (hasLim ? p.s < lim : n > 1) break;
        const it = { from: fvIso(p.s), to: fvIso(p.e) }; if (manual.some((x) => fvOverlap(x, it)) || est.some((x) => fvOverlap(x, it))) continue;
        const kb = new Array(nb).fill(0); for (const id of ids) { (await this._blHours(id, p.s, p.e)).forEach((x) => { kb[fvBand(new Date(x.t), b)] += x.v; }); }
        const c = fvBillCalc(b, kb, Math.round((p.e - p.s) / 864e5), p); if (c.kwh > 0) { est.push(Object.assign(it, { kwh: Math.round(c.kwh * 10) / 10, total: Math.round(c.tot * 100) / 100 })); ch = true; }
      }
      const keep = fvBillMerge(manual, est, mx).filter((h) => h.est); const k2 = est.filter((h) => keep.some((k) => k.from === h.from && k.to === h.to)); if (k2.length !== est.length) ch = true;
      est = k2.sort((a, c2) => (a.from < c2.from ? -1 : 1)); if (ch) await this._estSet(est); this._est = est;
    } catch (x) { if (!this._est) this._est = []; }
    this._arBusy = false; this._renderBlPop();
  }
  _blChip() {
    const b = this._eco().bill; if (!b.enabled) return ''; const l = this._bl; const tx = l && !l.miss && !l.err && l.cur ? this._t('BOLLETTA') + ' ' + this._eur(l.cur.tot) + ' · ' + this._t('GIORNO {0}/{1}', l.dayN, l.daysT) + ' · ' + this._t('STORICO') + ' ›' : this._t('BOLLETTE') + ' ›';
    return `<button type="button" class="chip" data-act="blpop" aria-label="${fvEsc(this._t('Apri bollette'))}" style="border-color:rgba(110,231,183,.5);background:rgba(110,231,183,.1);color:#6ee7b7;cursor:pointer;white-space:nowrap">€ ${fvEsc(tx)}</button>`;
  }
  _blLbl(h) {
    const L = this._lang(); const f = new Date(h.from + 'T00:00:00'); const t = new Date(h.to + 'T00:00:00'); if (isNaN(f) || isNaN(t)) return '—'; const l = new Date(t.getTime() - 864e5);
    const m = (x) => { const s = x.toLocaleDateString(L, { month: 'short' }).replace('.', ''); return s.charAt(0).toUpperCase() + s.slice(1); };
    if (f.getFullYear() === l.getFullYear()) return f.getMonth() === l.getMonth() ? m(f) + ' ' + f.getFullYear() : m(f) + ' – ' + m(l) + ' ' + l.getFullYear();
    return m(f) + ' ' + f.getFullYear() + ' – ' + m(l) + ' ' + l.getFullYear();
  }
  _blShort(h) {
    const L = this._lang(); const f = new Date(h.from + 'T00:00:00'); const t = new Date(h.to + 'T00:00:00'); if (isNaN(f) || isNaN(t)) return '—'; const l = new Date(t.getTime() - 864e5);
    const m = (x) => x.toLocaleDateString(L, { month: 'short' }).replace('.', '').toUpperCase();
    return f.getFullYear() === l.getFullYear() && f.getMonth() === l.getMonth() ? m(f) : m(f) + '–' + m(l);
  }
  _renderBlPop() {
    const pop = this._$('blpop'); const body = this._$('blbody'); if (!pop || !body) return; this._popOn(pop, !!this._blOpen); if (!this._blOpen) return;
    const b = this._eco().bill; const L = this._lang(); const hist = fvBillMerge(b.history, this._est, b.period === 'mo' ? 12 : 6); const l = this._bl; const T = (x) => fvEsc(this._t(x));
    const lab = (t) => `<div class="mono" style="font-size:9.5px;letter-spacing:.12em;color:rgba(255,255,255,.55)">${t}</div>`;
    let hero = '';
    if (!l || (!l.cur && !l.miss && !l.err)) hero = `<div class="bhint" style="padding:6px 2px">${T('Caricamento…')}</div>`;
    else if (l.miss) hero = `<div class="bhint" style="padding:6px 2px;color:rgba(255,255,255,.7)">${T("Per la stima della bolletta scegli il contatore dell'energia prelevata della Rete (Fonti e casa).")}</div>`;
    else if (l.err) hero = `<div class="bhint" style="padding:6px 2px;color:rgba(255,255,255,.7)">${T('Impossibile leggere le statistiche di energia')}</div>`;
    else {
      const c = l.cur; const bl = fvBillBands(b.type || 'fixed'); const ps = l.p; const pl = ps.s.toLocaleDateString(L, { day: 'numeric', month: 'short' }) + ' – ' + new Date(ps.e.getTime() - 864e5).toLocaleDateString(L, { day: 'numeric', month: 'short' });
      const enl = this._t('Energia') + ' · ' + (bl.length > 1 ? l.kb.map((k, i) => this._t(bl[i]) + ' ' + Math.round(k)).join(' · ') + ' kWh' : Math.round(c.kwh) + ' kWh');
      const rows = [[enl, c.en], [this._t('Rete e oneri'), c.rete], c.qf ? [this._t('Quota fissa'), c.qf] : null, c.qp ? [this._t('Quota potenza') + ' · ' + this._num(Number(b.power_kw) || 0, 1) + ' kW', c.qp] : null, c.ac ? [this._t('Accisa'), c.ac] : null, [this._t('IVA {0} %', this._num(c.vat, 0)), c.iv], [this._t('Totale bolletta'), c.tb, 1], c.tv ? [this._t('Canone TV'), c.tv] : null].filter(Boolean);
      const phl = l.ph && l.ph.length > 1 ? `<div class="mono" style="font-size:10.5px;color:#9fc7ff;padding:6px 10px;border-radius:10px;border:1px solid rgba(143,168,255,.35);background:rgba(143,168,255,.07)">${T('PRELIEVO PER FASE')} · ${l.ph.map((k, i) => 'L' + (i + 1) + ' ' + Math.round(k)).join(' · ')} kWh</div>` : '';
      hero = `<div style="border-radius:16px;border:1px solid rgba(110,231,183,.4);background:rgba(110,231,183,.06);padding:12px 14px;display:flex;flex-direction:column;gap:10px">
        <div style="display:flex;justify-content:space-between;align-items:baseline;gap:8px;flex-wrap:wrap"><div class="mono" style="font-size:10px;letter-spacing:.18em;color:#6ee7b7">${T('PROSSIMA BOLLETTA · STIMA IN TEMPO REALE')}</div><div class="mono" style="font-size:9.5px;color:rgba(255,255,255,.55)">${fvEsc(pl)} · ${fvEsc(this._t('giorno {0} di {1}', l.dayN, l.daysT))}</div></div>
        <div style="display:flex;align-items:baseline;gap:12px;flex-wrap:wrap"><div style="font-size:30px;font-weight:800;color:#6ee7b7">${fvEsc(this._eur(c.tot))}</div><div style="font-size:12px;color:rgba(255,255,255,.65)">${fvEsc(this._t('finora'))} · ${fvEsc(Math.round(c.kwh) + ' kWh')} · ${fvEsc(this._eur(c.tot / Math.max(1, l.dayN)) + ' ' + this._t('al giorno'))}</div></div>
        <div style="height:6px;border-radius:3px;background:rgba(255,255,255,.1);overflow:hidden"><div style="height:100%;width:${Math.min(100, Math.round(l.dayN / l.daysT * 100))}%;background:#6ee7b7"></div></div>
        <div style="font-size:12.5px;color:rgba(255,255,255,.8)">${T('A fine periodo, a questo ritmo:')} <b>≈ ${fvEsc(this._eur(l.proj.tot))}</b></div>${phl}
        <div style="border-top:1px solid rgba(255,255,255,.1)">${rows.map((r) => `<div class="blrow" style="${r[2] ? 'border-top:1px solid rgba(255,255,255,.18);font-weight:700' : ''}"><span style="color:rgba(255,255,255,.75)">${fvEsc(r[0])}</span><span>${fvEsc(this._eur(r[1]))}</span></div>`).join('')}</div></div>`;
    }
    let histHtml = '';
    if (hist.length) {
      const sel = this._blSel != null && hist[this._blSel] ? this._blSel : hist.length - 1; const mx = Math.max(1, ...hist.map((h) => Number(h.total) || 0)); const tot = hist.reduce((a, h) => a + (Number(h.total) || 0), 0); const kt = hist.reduce((a, h) => a + (Number(h.kwh) || 0), 0);
      const cur = hist[sel]; const prev = sel > 0 ? hist[sel - 1] : null; const df = prev ? (Number(cur.total) || 0) - (Number(prev.total) || 0) : 0;
      const tiles = [[this._t('TOTALE 12 MESI'), this._eur(tot), this._t('{0} bollette', hist.length)], [this._t('ENERGIA PRELEVATA'), kt ? Math.round(kt) + ' kWh' : '—', this._t('nel periodo')]];
      histHtml = `<div style="display:flex;flex-wrap:wrap;gap:8px">${tiles.map((t) => `<div style="flex:1 1 130px;border-radius:14px;border:1px solid rgba(255,255,255,.12);padding:8px 12px">${lab(fvEsc(t[0]))}<div style="font-size:18px;font-weight:700">${fvEsc(t[1])}</div><div class="mono" style="font-size:9px;color:rgba(255,255,255,.45)">${fvEsc(t[2])}</div></div>`).join('')}</div>
        <div style="border-radius:16px;border:1px solid rgba(255,255,255,.12);padding:12px 14px;display:flex;flex-direction:column;gap:8px">
          <div style="font-size:12.5px;color:rgba(255,255,255,.8)">${fvEsc(this._blLbl(cur))}${cur.est ? ` <i class="mono" style="font-size:9px;font-style:normal;letter-spacing:.1em;padding:1px 6px;border-radius:999px;border:1px dashed rgba(95,208,255,.6);color:#5fd0ff">${T('STIMATA')}</i>` : ''} · <b style="font-size:16px">${fvEsc(this._eur(Number(cur.total) || 0))}</b>${cur.kwh ? ' · ' + fvEsc(Math.round(cur.kwh) + ' kWh') : ''} · <span style="color:${df > 0 ? '#ffb066' : '#6ee7b7'}">${prev ? fvEsc((df >= 0 ? '+' : '−') + this._eur(Math.abs(df)) + ' ' + this._t('rispetto alla precedente')) : T('prima bolletta dello storico')}</span></div>
          <div style="display:flex;align-items:flex-end;gap:8px;height:150px">${hist.map((h, i) => `<button type="button" class="blbar" data-act="blsel" data-j="${i}" aria-label="${fvEsc(this._blLbl(h))}"><span class="mono" style="font-size:10px;color:${i === sel ? '#fff' : 'rgba(255,255,255,.55)'}">${fvEsc(Math.round(Number(h.total) || 0) + ' ' + this._cur())}</span><span style="width:100%;height:${Math.round((Number(h.total) || 0) / mx * 120)}px;border-radius:8px 8px 3px 3px;background:${i === sel ? 'linear-gradient(180deg,#5fd0ff,#2b7fb0)' : 'rgba(95,208,255,.28)'};border:1px ${h.est ? 'dashed' : 'solid'} ${i === sel ? '#5fd0ff' : 'rgba(95,208,255,.4)'}"></span></button>`).join('')}</div>
          <div style="display:flex;gap:8px">${hist.map((h) => `<div class="mono" style="flex:1;min-width:0;text-align:center;font-size:9px;color:rgba(255,255,255,.55)">${fvEsc(this._blShort(h))}</div>`).join('')}</div></div>
        <div style="border-radius:16px;border:1px solid rgba(255,255,255,.12);overflow:hidden">${hist.slice().reverse().map((h) => { const j = hist.indexOf(h); const k = Number(h.kwh) || 0; const t = Number(h.total) || 0; return `<button type="button" data-act="blsel" data-j="${j}" style="width:100%;display:grid;grid-template-columns:1.6fr 1fr 1fr;gap:6px;padding:10px 14px;border:0;border-top:1px solid rgba(255,255,255,.08);background:${j === sel ? 'rgba(95,208,255,.10)' : 'transparent'};text-align:left;font-size:12.5px;color:inherit"><span>${fvEsc(this._blLbl(h))}${h.est ? ` <i class="mono" style="font-size:9px;font-style:normal;letter-spacing:.1em;padding:1px 6px;border-radius:999px;border:1px dashed rgba(95,208,255,.6);color:#5fd0ff">${T('STIMATA')}</i>` : ''}</span><span style="text-align:right">${k ? fvEsc(Math.round(k) + ' kWh') : '—'}</span><span style="text-align:right;font-weight:700">${fvEsc(this._eur(t))}</span></button>`; }).join('')}</div>${hist.some((h) => h.est) ? `<div class="bhint">${T("STIMATA: calcolata in automatico con i tuoi prezzi. Per l'importo reale modificala nell'editor (Costi e bolletta).")}</div>` : ''}`;
    } else histHtml = `<div class="bhint">${T("Nessuna bolletta nello storico. Aggiungile dall'editor della card (Costi e bolletta).")}</div>`;
    body.innerHTML = `<div style="display:flex;flex-direction:column;gap:14px;padding:20px">
      <div style="display:flex;justify-content:space-between;align-items:flex-start;gap:12px"><div><div class="mono" style="font-size:11px;letter-spacing:.22em;color:#6ee7b7">${T('BOLLETTE')}</div><div class="mono" style="font-size:10px;letter-spacing:.12em;color:rgba(255,255,255,.5);margin-top:4px">${fvEsc(this._t('STORICO · ULTIMI 12 MESI · {0} BOLLETTE', hist.length))}</div></div><button type="button" class="xb" data-act="blclose" aria-label="${fvEsc(this._t('Chiudi'))}">✕</button></div>${hero}${histHtml}</div>`;
  }

  /* ---------- storico potenze ---------- */
  _renderHist() {
    const el = this._$('hist'); if (!el) return; const h = this._config.history; const list = h.series.filter((s) => s.entity);
    if (!list.length) { el.innerHTML = `<div class="box"><div class="hh"><span>${fvEsc(h.title || this._t('STORICO'))}</span></div><div class="empty" style="margin-top:12px">${this._t("Aggiungi le serie del grafico dall'editor.")}</div></div>`; return; }
    const rg = (r) => `<button type="button" class="pill ${this._hrng === r ? 'on' : ''}" data-act="range" data-t="h" data-r="${r}">${this._t(FV_RANGES[r].label).replace(' ', '')}</button>`;
    const cols = ['#5fd0ff', '#ffb43a', '#6f9bff', '#2ee87a', '#ff8a5c', '#b28cff'];
    const hp = h.height || 260;
    el.innerHTML = `<div class="box" style="display:flex;flex-direction:column;gap:12px"><div class="hh"><span>${fvEsc(h.title || this._t('STORICO'))} · ${fvEsc(this._t({ '24h': 'ULTIME 24 ORE', '7g': 'ULTIMI 7 GIORNI', '30g': 'ULTIMI 30 GIORNI' }[this._hrng]))}</span><div class="pills">${h.ranges.map(rg).join('')}</div></div>
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
    const nm = { ctl: this._t('PASSWORD PER MODIFICARE LE IMPOSTAZIONI'), sw: this._t('PASSWORD PER COMANDARE GLI INTERRUTTORI') };
    let keypad = '';
    if (lk.on && L.ask) {
      const dots = Array.from({ length: lk.pin.length }, (_, i) => `<i style="${i < L.pin.length ? 'background:' + (L.err ? '#ff5a5a' : O) + ';' : ''}${L.err ? 'border-color:#ff5a5a' : ''}"></i>`).join('');
      const keys = ['1', '2', '3', '4', '5', '6', '7', '8', '9'].map((d) => `<button type="button" data-act="key" data-d="${d}">${d}</button>`).join('') + '<button type="button" data-act="key" data-d="x" aria-label="' + this._t('Annulla') + '">✕</button><button type="button" data-act="key" data-d="0">0</button><button type="button" data-act="key" data-d="b" aria-label="' + this._t('Cancella') + '">⌫</button>';
      keypad = `<div class="kp"><span class="kt">${nm[L.want] || nm.ctl}</span><div class="kd">${dots}</div><span class="ke">${L.err ? this._t('PASSWORD ERRATA') : ''}</span><div class="kg">${keys}</div></div>`;
    }
    let status = '';
    if (lk.on && !L.ask) status = L.left > 0 ? `<div class="unl"><span>${this._t('SBLOCCATO · SI RIBLOCCA TRA {0} s', `<b data-left="1" style="font-weight:500">${L.left}</b>`)}</span><button type="button" data-act="relock">${this._t('BLOCCA')}</button></div>` : `<div class="lkr">${lockI(14)}${this._t('IMPOSTAZIONI E INTERRUTTORI PROTETTI DA PASSWORD')}</div>`;
    const lc = this._locked('ctl'); const ls = this._locked('sw'); const dead = ax.controls.concat(ax.switches).filter((i) => i.entity);
    const online = !dead.length || dead.some((i) => !this._fid(i).dead);
    const ctl = ax.controls.map((it, i) => {
      if (!it.entity) return ''; const { st, dead: dd } = this._fid(it); const name = this._name(it); const dom = fvDomain(it.entity); const a = (st && st.attributes) || {};
      if (dom === 'number' || dom === 'input_number') {
        const v = this._raw(it.entity); const u = a.unit_of_measurement || '';
        return `<div class="stp" ${dd ? 'style="opacity:.55"' : ''}><div style="justify-content:space-between"><span class="lab">${fvEsc(name.toUpperCase())}</span>${lc ? lockI() : ''}</div><div><button type="button" data-act="step" data-i="${i}" data-d="-1" aria-label="${this._t('Diminuisci')}">−</button><b>${v == null ? '—' : fvEsc(this._f(v) + (u ? ' ' + u : ''))}</b><button type="button" data-act="step" data-i="${i}" data-d="1" aria-label="${this._t('Aumenta')}">+</button></div></div>`;
      }
      const opts = Array.isArray(a.options) ? a.options : []; const cur = st ? st.state : '';
      if ((it.display === 'segments' || (it.display !== 'dropdown' && opts.length > 0 && opts.length <= 3)) && opts.length) {
        return `<div style="display:flex;flex-direction:column;gap:6px;${dd ? 'opacity:.55' : ''}"><span class="lab" style="display:flex;justify-content:space-between">${fvEsc(name.toUpperCase())}${lc ? lockI() : ''}</span><div class="seg" style="grid-template-columns:repeat(${opts.length},minmax(0,1fr))">${opts.map((o) => `<button type="button" class="${o === cur ? 'on' : ''}" data-act="opt" data-i="${i}" data-v="${fvEsc(o)}">${fvEsc(o)}</button>`).join('')}</div></div>`;
      }
      return `<label class="fld" ${dd ? 'style="opacity:.55"' : ''}><span class="lab">${fvEsc(name.toUpperCase())}</span>${lc ? `<button type="button" class="ov" data-act="ask" data-kind="ctl" aria-label="${this._t('Sblocca con password per modificare')}"></button><span class="lk">${lockI()}</span>` : ''}<select data-act="sel" data-i="${i}">${opts.map((o) => `<option value="${fvEsc(o)}" ${o === cur ? 'selected' : ''}>${fvEsc(o)}</option>`).join('') || `<option>${fvEsc(cur || '—')}</option>`}</select></label>`;
    }).join('');
    const sws = ax.switches.map((it, i) => {
      if (!it.entity) return ''; const { st, dead: dd } = this._fid(it); const on = st && st.state === 'on';
      return `<button type="button" class="sw" data-act="tog" data-i="${i}" style="border-color:${on ? O + '80' : 'rgba(255,255,255,.1)'};background:${on ? O + '1a' : 'rgba(255,255,255,.03)'};box-shadow:${on ? '0 0 22px ' + O + '29' : 'none'};opacity:${dd ? .55 : 1}">
        <span class="ib" style="border-color:${on ? O + '80' : 'rgba(255,255,255,.1)'}">${fvIcon(it.icon || 'bolt', on ? O : 'rgba(255,255,255,.6)', 20, 1.8)}</span>
        <span class="sn"><b>${fvEsc(this._name(it))}</b><i style="color:${on ? O : 'rgba(255,255,255,.6)'}">${dd ? this._t('NON DISPONIBILE') : on ? this._t('ATTIVO') : this._t('SPENTO')}</i></span>${ls ? lockI(18) : ''}<span class="tg ${on ? 'on' : ''}" style="background:${on ? O : 'rgba(255,255,255,.18)'}"></span></button>`;
    }).join('');
    const rds = ax.readings.filter((r) => r.entity);
    const rd = rds.length ? `<div class="rd"><button type="button" data-act="rd" aria-expanded="${this._rdOpen}"><span>${fvEsc(ax.readings_title || this._t('Inverter FV'))}</span><span style="transform:rotate(${this._rdOpen ? 180 : 0}deg);display:flex">${fvIcon('chev', 'rgba(255,255,255,.8)', 18, 2)}</span></button>${this._rdOpen ? `<div class="gr">${rds.map((r, k) => `<div><span>${fvEsc(this._name(r).toUpperCase())}</span><b data-rd="${k}"></b></div>`).join('')}</div>` : ''}</div>` : '';
    const empty = !ctl && !sws && !rd ? `<div class="empty">${this._t("Aggiungi impostazioni, interruttori e letture dall'editor.")}</div>` : '';
    el.innerHTML = `<div class="axp"><div class="axh"><span class="lg"><span>${fvIcon('inv', O, 22, 1.7)}</span><span><b>${fvEsc(ax.title || (this._axi != null ? (this._config.inverters[this._axi].name || this._t('Inverter {0}', this._axi + 1)) : this._t('Inverter')))}</b><i>${this._t('INVERTER · IMPOSTAZIONI')}</i></span></span><span class="mono" style="font-size:10px;letter-spacing:.14em;color:${online ? '#2ee87a' : '#ff5a5a'}">● ${online ? this._t('ONLINE') : this._t('OFFLINE')}</span></div>
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
    if (e.target && e.target.id === 'blpop') { this._blOpen = false; this._renderBlPop(); return; }
    const p = e.composedPath ? e.composedPath() : []; const el = p.find((n) => n && n.dataset && n.dataset.act); if (!el) return; const a = el.dataset.act; const ax = this._ax(); const i = +el.dataset.i;
    if (a === 'open' || a === 'sub' || a === 'bpop' || a === 'blpop' || a === 'axpop') { const r = el.getBoundingClientRect(); this._org = { x: r.left + r.width / 2, y: r.top + r.height / 2 }; if (a === 'sub') this._orgSub = this._org; }
    if (a === 'open') {
      const kind = el.dataset.kind;
      if (kind === 'ind') {
        const same = this._sel && this._sel.kind === kind && this._sel.i === i; this._sel = same ? null : { kind, i }; this._met = 'w'; this._sigs.tiles = null; this._update();
        if (!same) { const pn = this._$('panel'); if (pn && pn.scrollIntoView) pn.scrollIntoView({ block: 'nearest', behavior: 'smooth' }); }
      } else { if (kind === 'sub') { this._subOpen = null; this._renderSubPop(); } this._sel = { kind, i, key: el.dataset.key || '' }; this._met = el.dataset.met || 'w'; this._pkey = null; this._sigs.tiles = null; this._update(); }
    } else if (a === 'close') this._closeSel();
    else if (a === 'sub') this._openSub(el.dataset.ref);
    else if (a === 'spclose') { this._subOpen = null; this._renderSubPop(); }
    else if (a === 'doact') this._doAct();
    else if (a === 'met') { this._met = el.dataset.m; this._pkey = null; this._update(); }
    else if (a === 'bpop') { this._bpOpen = true; this._renderBatPop(); }
    else if (a === 'blpop') { this._blOpen = true; this._blSel = null; this._renderBlPop(); this._blLoad(true); this._blArchive(true); }
    else if (a === 'blclose') { this._blOpen = false; this._renderBlPop(); }
    else if (a === 'blsel') { this._blSel = +el.dataset.j; this._renderBlPop(); }
    else if (a === 'bpclose') { this._bpOpen = false; this._renderBatPop(); }
    else if (a === 'axpop') { this._axi = el.dataset.ax != null && el.dataset.ax !== '' ? +el.dataset.ax : null; this._sigs.axp = null; this._update(); this._popOn(this._$('pop'), true); }
    else if (a === 'popclose') this._closePop();
    else if (a === 'enp') { this._ep = el.dataset.p; this._eh = null; this._renderEn(); this._enLoad(); }
    else if (a === 'enn') { const { d, t } = this._enDay(); let nd = this._enSh(this._ep, d, +el.dataset.d); if (nd > t) nd = t; this._ed = this._enIso(nd); this._eh = null; this._renderEn(); this._enLoad(); }
    else if (a === 'ent') { this._ed = null; this._eh = null; this._renderEn(); this._enLoad(); }
    else if (a === 'enh') { const j = +el.dataset.j; this._eh = this._eh === j ? null : j; this._renderEn(); }
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
    const el = e.composedPath ? e.composedPath()[0] : e.target; if (el && el.dataset && el.dataset.act === 'end') { if (el.value) { this._ed = el.value; this._eh = null; this._renderEn(); this._enLoad(); } return; }
    if (!el || !el.dataset || el.dataset.act !== 'sel' || !this._hass) return;
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
  _ul() { return fvUiLang(this._config ? this._config.language : null, this._hass); }
  _t(s, ...a) { return fvTr(this._ul(), s, a); }
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
    c.economy = Object.assign({}, c.economy || {}); c.economy.export = Object.assign({}, c.economy.export || {}); c.economy.bill = Object.assign({}, c.economy.bill || {});
    ['history', 'rules'].forEach((k) => { if (!Array.isArray(c.economy.bill[k])) c.economy.bill[k] = []; });
    this._config = c; this._ensurePicker(); this._syncOpen(); this._render();
  }
  set hass(h) {
    const first = !this._hass; this._hass = h; if (!this._config) return; if (first) this._estLoad();
    if (first) this._render(); else this.shadowRoot.querySelectorAll('ha-entity-picker').forEach((p) => { p.hass = h; });
  }
  async _estLoad() {
    if (!this._hass || !this._config) return; let v = null; try { const r = await this._hass.callWS({ type: 'frontend/get_user_data', key: fvBillKey(this._config) }); v = r && r.value; } catch (x) { v = null; }
    this._est = v && Array.isArray(v.items) ? v.items.filter((h) => h && h.from && h.to) : []; if (this._open && this._open.has('eco')) this._render();
  }
  async _estSave() { try { await this._hass.callWS({ type: 'frontend/set_user_data', key: fvBillKey(this._config), value: { v: 1, items: this._est || [] } }); } catch (x) { /* archivio non disponibile */ } }
  /* modificando una bolletta stimata diventa una bolletta inserita a mano (con l'importo reale) e lascia l'archivio automatico */
  _estEdit(el) {
    const j = +el.dataset.est; const h = (this._est || [])[j]; if (!h) return; const f = el.dataset.f; const o = { from: h.from, to: h.to, kwh: h.kwh, total: h.total };
    o[f] = f === 'from' || f === 'to' ? el.value : (el.value === '' ? '' : Number(el.value)); if (!o.from || !o.to) return;
    const arr = this._arr('economy.bill.history'); arr.push(o); const mxh = (this._get('economy.bill') || {}).period === 'mo' ? 12 : 6; while (arr.length > mxh) arr.shift();
    this._est.splice(j, 1); this._estSave(); this._emit(); this._render();
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
    const el = e.composedPath()[0]; if (el && el.dataset && el.dataset.est !== undefined) { if (e.type === 'change') this._estEdit(el); return; }
    if (!el || !el.dataset || !el.dataset.p || !this._config) return;
    if (el.tagName === 'HA-ENTITY-PICKER') return; const kind = el.dataset.k; const p = el.dataset.p;
    if (kind === 'num') this._setPath(p, el.value === '' ? '' : Number(el.value));
    else if (kind === 'bool') this._setPath(p, el.checked ? true : '');
    else if (kind === 'boolf') this._setPath(p, el.checked ? '' : false);
    else if (kind === 'list') { const on = Array.from(this.shadowRoot.querySelectorAll(`input[data-p="${p}"]`)).filter((i) => i.checked).map((i) => i.dataset.v); this._setPath(p, on.length ? on : ''); }
    else if (kind === 'text' && el.type === 'color') { if (e.type !== 'change') return; this._setPath(p, el.value); }
    else { if (e.type === 'change' && el.type === 'text' && false) return; this._setPath(p, el.value); }
    if (p === 'economy.bill.sched' || p === 'economy.bill.type') { const bb = this._get('economy.bill') || {}; if (bb.sched === 'c') this._setPath('economy.bill.rules', fvBillStd(bb.type || 'fixed').map((r) => Object.assign({}, r, { b: String(r.b) }))); }
    this._emit();
    if (el.dataset.re) { this._syncOpen(); this._render(); }
  }
  _click(e) {
    const b = e.composedPath()[0]; const dl = b && b.closest ? b.closest('[data-estdel]') : null; if (dl) { (this._est || []).splice(+dl.dataset.estdel, 1); this._estSave(); this._render(); return; }
    const el = b && b.closest ? b.closest('[data-ea]') : null; if (!el || el.disabled) return;
    const a = el.dataset.ea; const path = el.dataset.arr; const idx = +el.dataset.idx; const arr = this._arr(path);
    const dflt = { loads: { entity: '', icon: 'bolt' }, indicators: { entity: '', color: '#5fd0ff' }, thresholds: { value: '', color: '#ffb43a' }, controls: { entity: '' }, switches: { entity: '', icon: 'bolt' }, readings: { entity: '' }, series: { entity: '' }, sub_loads: { name: '', entity: '' }, rules: { b: '0', d: 'wd', a: 8, z: 19 }, history: { from: '', to: '', kwh: '', total: '' } };
    const key = path.split('.').pop(); const max = (key === 'loads' && path.indexOf('inverters.') === 0 ? FV_MAX_LOADS_INV : { sub_loads: FV_MAX_SUB, loads: FV_MAX_LOADS, indicators: FV_MAX_IND, series: FV_MAX_SERIES, inverters: FV_MAX_INV, rules: 12, history: 99 }[key]) || 99;
    if (a === 'add') { if (arr.length >= max) return; const o = key === 'inverters' ? { name: '', phase: { entity: '', voltage_entity: '' }, mppt: [{ entity: '' }], battery: { entity: '', soc_entity: '' }, home: { entity: '' }, loads: [] } : Object.assign({}, dflt[key] || { entity: '' }); if (key === 'series') o.color = ['#5fd0ff', '#ffb43a', '#6f9bff', '#2ee87a', '#ff8a5c', '#b28cff'][arr.length % 6]; if (key === 'history') { const bb = this._get('economy.bill') || {}; const n = bb.period === 'mo' ? 1 : 2; const mxTo = [].concat(arr, this._est || []).reduce((m, x) => (x && x.to && x.to > m ? x.to : m), ''); const fr = mxTo ? new Date(mxTo + 'T00:00:00') : fvBillPer(bb, new Date()).s; o.from = fvIso(fr); o.to = fvIso(fvAddM(fr, n)); }
      arr.push(o); if (key === 'history') { const mxh = (this._get('economy.bill') || {}).period === 'mo' ? 12 : 6; while (arr.length > mxh) arr.shift(); } this._open.add(path + '.' + (arr.length - 1)); this._open.add(path.split('.').slice(0, -1).join('.') || path); }
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
    ph = ph ? this._t(ph) : ph;
    return `<label>${fvEsc(this._t(label))}<input type="${kind === 'color' ? 'color' : 'text'}" data-p="${p}" data-k="text" ${re ? 'data-re="1"' : ''} value="${fvEsc(v == null ? (kind === 'color' ? ph : '') : v)}" placeholder="${fvEsc(ph || '')}"></label>`;
  }
  _numf(label, p, ph) { const v = this._get(p); if (typeof ph === 'string') ph = this._t(ph); return `<label>${fvEsc(this._t(label))}<input type="number" step="any" data-p="${p}" data-k="num" value="${v == null ? '' : v}" placeholder="${fvEsc(ph == null ? '' : ph)}"></label>`; }
  _chk(label, p, kind, on, re) { return `<label class="chk"><input type="checkbox" data-p="${p}" data-k="${kind}" ${re ? 'data-re="1"' : ''} ${on ? 'checked' : ''}>${fvEsc(this._t(label))}</label>`; }
  _sel(label, p, opts, cur, re) { return `<label>${fvEsc(this._t(label))}<select data-p="${p}" data-k="text" ${re ? 'data-re="1"' : ''}>${opts.map(([v, l]) => `<option value="${fvEsc(v)}" ${String(cur == null ? '' : cur) === v ? 'selected' : ''}>${fvEsc(this._t(l))}</option>`).join('')}</select></label>`; }
  _pick(label, p, doms) {
    const v = this._get(p) || '';
    if (customElements.get('ha-entity-picker')) return `<ha-entity-picker data-p="${p}" data-dom="${doms.join(',')}" data-label="${fvEsc(this._t(label))}"></ha-entity-picker>`;
    return `<label>${fvEsc(this._t(label))}<input type="text" list="ents" data-p="${p}" data-k="text" value="${fvEsc(v)}" placeholder="${fvEsc(this._t('dominio.nome_entita'))}"></label>`;
  }
  _bar(path, i, n) { return `<div class="bar"><button type="button" class="b" data-ea="up" data-arr="${path}" data-idx="${i}" ${i === 0 ? 'disabled' : ''}>${this._t('↑ Su')}</button><button type="button" class="b" data-ea="down" data-arr="${path}" data-idx="${i}" ${i === n - 1 ? 'disabled' : ''}>${this._t('↓ Giù')}</button><button type="button" class="b del" data-ea="del" data-arr="${path}" data-idx="${i}">${this._t('Elimina')}</button></div>`; }
  _actEd(base) {
    return '<div class="sub"><h4>' + this._t('Pulsante di comando nel popup') + '</h4>' + this._pick('Entità da comandare (opzionale)', base + '.action_entity', ['switch', 'light', 'input_boolean', 'fan', 'automation', 'script', 'scene', 'button', 'input_button'])
      + '<div class="g2">' + this._txt('Nome del pulsante', base + '.action_name', 'ACCENDI') + this._txt('Nome del pulsante quando è attivo', base + '.action_name_on', 'SPEGNI') + '</div>'
      + '<div class="hint">' + this._t("Nel popup di questa utenza compare un pulsante per accendere o spegnere l'entità scelta (switch, luce, ecc.). Con button, input_button, script e scene il pulsante la avvia soltanto.") + '</div></div>';
  }
  _socEd(base) { return this._txt('Nome del SOC 1 (es. Renault 5)', base + '.soc_name', 'AUTO 1') + this._pick('Carica della seconda auto in % (opzionale)', base + '.soc2_entity', ['sensor', 'input_number', 'number']) + this._txt('Nome del SOC 2', base + '.soc2_name', 'AUTO 2') + this._pick('Carica della terza auto in % (opzionale)', base + '.soc3_entity', ['sensor', 'input_number', 'number']) + this._txt('Nome del SOC 3', base + '.soc3_name', 'AUTO 3') + '<div class="hint">' + this._t("Con più di un SOC il popup mostra una scheda per ciascuno (con il nome che scegli) e sulla tile i valori si alternano ogni 5 secondi con la dicitura AUTO 1, AUTO 2, AUTO 3.") + '</div>'; }
  _det(id, title, body) { return `<details data-id="${id}" ${this._open.has(id) ? 'open' : ''}><summary>${fvEsc(this._t(title))}</summary><div class="tb">${body}</div></details>`; }
  _nm(it, fb) { if (it.name) return it.name; const st = this._hass && it.entity ? this._hass.states[it.entity] : null; return (st && st.attributes.friendly_name) || it.entity || this._t(fb); }

  _ecoEd(c) {
    const e = c.economy || {}; const ex = e.export || {}; const b = e.bill || {}; const type = b.type || 'fixed'; const bands = fvBillBands(type); const BP = 'economy.bill.';
    const sub = (h, body) => `<div class="sub"><h4>${this._t(h)}</h4>${body}</div>`;
    const dt = (label, p) => `<label>${fvEsc(this._t(label))}<input type="date" data-p="${p}" data-k="text" value="${fvEsc(this._get(p) || '')}"></label>`;
    const pr = bands.map((x, i) => this._numf(bands.length > 1 ? this._t('Prezzo {0} (€/kWh)', this._t(x)) : 'Prezzo energia (€/kWh)', BP + 'prices.p' + (i + 1), '0,12')).join('');
    const dOpts = [['wd', 'Lun–Ven'], ['ws', 'Lun–Sab'], ['sat', 'Sabato'], ['sun', 'Domenica e festivi'], ['all', 'Tutti i giorni']];
    const bOpts = bands.slice(0, -1).map((x, i) => [String(i), x]);
    let sch = '';
    if (bands.length > 1) {
      sch = sub('Orari delle fasce', this._sel('Orari', BP + 'sched', [['', 'Standard (ARERA)'], ['c', 'Personalizzati']], b.sched || '', true) + (b.sched === 'c' ? (b.rules || []).map((r, i) => `<div class="sub" style="border-top:1px dashed var(--divider-color,#666)"><div class="g2">${this._sel('Fascia', `${BP}rules.${i}.b`, bOpts, String(r.b == null ? '0' : r.b))}${this._sel('Giorni', `${BP}rules.${i}.d`, dOpts, r.d || 'wd')}</div><div class="g2">${this._numf('Dalle ore', `${BP}rules.${i}.a`, '8')}${this._numf('Alle ore', `${BP}rules.${i}.z`, '19')}</div><div class="bar"><button type="button" class="b del" data-ea="del" data-arr="${BP}rules" data-idx="${i}">${this._t('Elimina')}</button></div></div>`).join('') + `<button type="button" class="b" data-ea="add" data-arr="${BP}rules">${this._t('+ Aggiungi fascia oraria')}</button><div class="hint">${this._t("Orari interi (0–24). Quello che non rientra nelle fasce indicate va all'ultima fascia: {0}. I festivi nazionali contano come domenica.", this._t(bands[bands.length - 1]))}</div>` : `<div class="hint">${type === 'tiers' ? this._t("Standard: F1 lun–ven 8–19; F2 lun–ven 7–8 e 19–23, sabato 7–23; F3 il resto (notte, domenica e festivi).") : type === 'bi' ? this._t('Standard: F1 lun–ven 8–19; F23 il resto (sera, notte, sabato, domenica e festivi).') : this._t('Standard: giorno lun–sab 7–23; notte e festivi il resto.')}</div>`));
    }
    const hs = (b.history || []); const mxh = b.period === 'mo' ? 12 : 6;
    const rowM = (h, i) => `<div class="sub" style="border-top:1px dashed var(--divider-color,#666)"><div class="g2">${dt('Dal', `${BP}history.${i}.from`)}${dt('Al (escluso)', `${BP}history.${i}.to`)}</div><div class="g2">${this._numf('Energia (kWh)', `${BP}history.${i}.kwh`)}${this._numf('Totale da pagare', `${BP}history.${i}.total`)}</div><div class="bar"><button type="button" class="b del" data-ea="del" data-arr="${BP}history" data-idx="${i}">${this._t('Elimina')}</button></div></div>`;
    const estL = (this._est || []).filter((h) => !hs.some((x) => x && x.from && x.to && fvOverlap(x, h)));
    const estRow = (h, j) => `<div class="sub" style="border-top:1px dashed var(--divider-color,#666)"><div class="bar"><span class="b" style="border-style:dashed;color:#5fd0ff;pointer-events:none">${this._t('STIMATA')}</span></div><div class="g2"><label>${fvEsc(this._t('Dal'))}<input type="date" data-est="${j}" data-f="from" value="${fvEsc(h.from)}"></label><label>${fvEsc(this._t('Al (escluso)'))}<input type="date" data-est="${j}" data-f="to" value="${fvEsc(h.to)}"></label></div><div class="g2"><label>${fvEsc(this._t('Energia (kWh)'))}<input type="number" step="any" data-est="${j}" data-f="kwh" value="${fvEsc(h.kwh == null ? '' : h.kwh)}"></label><label>${fvEsc(this._t('Totale da pagare'))}<input type="number" step="any" data-est="${j}" data-f="total" value="${fvEsc(h.total == null ? '' : h.total)}"></label></div><div class="bar"><button type="button" class="b del" data-estdel="${j}">${this._t('Elimina')}</button></div><div class="hint">${this._t("Calcolata in automatico: modificala per inserire l'importo reale.")}</div></div>`;
    const hl = hs.map((h, i) => ({ f: h.from || '9', h: rowM(h, i) })).concat(estL.map((h) => ({ f: h.from, h: estRow(h, this._est.indexOf(h)) }))).sort((a, c2) => (a.f < c2.f ? 1 : -1)).map((r) => r.h).join('');
    const bill = b.enabled ? `<div class="g2">${this._sel('Tipo di contratto', BP + 'type', FV_BILL_TYPES, type, true)}${this._sel('Fatturazione', BP + 'period', [['', 'Bimestrale'], ['mo', 'Mensile']], b.period || '', true)}</div>`
      + dt('Data di partenza del calcolo (inizio di un periodo di fatturazione)', BP + 'start') + `<div class="hint">${this._t("Serve il contatore dell'energia prelevata della Rete (Fonti e casa). Il ricavo dell'energia immessa non fa parte della bolletta.")}</div>`
      + sub('Prezzi', `<div class="g2">${pr}</div>`) + sch
      + sub('Altre voci', `<div class="g2">${this._numf('Rete e oneri (€/kWh)', BP + 'network', '0,044939')}${this._numf('Accisa (€/kWh)', BP + 'excise', '0,0227')}</div><div class="g2">${this._numf('Quota fissa (€/mese)', BP + 'fixed_month')}${this._numf('IVA (%)', BP + 'vat', '10')}</div><div class="g3">${this._numf('Potenza impegnata (kW)', BP + 'power_kw', '3')}${this._numf('Quota potenza (€/kW al mese)', BP + 'power_price')}${this._numf('Canone TV (€/anno, 10 rate gen–ott)', BP + 'tv_year', '90')}</div>`)
      + sub('Storico bollette', `<div class="hint">${this._t('Massimo {0} bollette (un anno).', mxh)}</div><div class="hint">${this._t("A fine periodo la bolletta viene aggiunta da sola come STIMATA; quando vuoi, modificala con l'importo reale.")}</div>${hl}<button type="button" class="b" data-ea="add" data-arr="${BP}history">${this._t('+ Aggiungi bolletta')}</button>`) : '';
    return sub('Ricavo energia immessa', this._chk('Mostra ricavo energia immessa', 'economy.export.enabled', 'bool', !!ex.enabled, true) + (ex.enabled ? `<div class="g2">${this._txt('Valuta', 'economy.currency', '€')}${this._numf('Prezzo energia immessa in rete (€/kWh)', 'economy.export.price', '0,11')}</div><div class="hint">${this._t("Serve il contatore dell'energia immessa nella Rete (Fonti e casa). Sotto il cerchio Rete compaiono i kWh immessi oggi e nel popup della Rete il ricavo.")}</div>` : ''))
      + sub('Calcolo bolletta', this._chk('Mostra il calcolo della bolletta', BP + 'enabled', 'bool', !!b.enabled, true) + bill);
  }
  _render() {
    const c = this._config; if (!c) return; const h = this._hass; const hasPicker = !!customElements.get('ha-entity-picker');
    const P = ['sensor', 'input_number', 'number'];
    const subEd = (base, l) => { const sl = Array.isArray(l.sub_loads) ? l.sub_loads : [];
      const items = sl.map((x, j) => this._det(`${base}.sub_loads.${j}`, `${j + 1} · ${this._nm(x || {}, 'da configurare')}`, this._pick('Potenza del sottocarico (W o kW)', `${base}.sub_loads.${j}.entity`, P) + this._txt('Nome', `${base}.sub_loads.${j}.name`, 'Nome') + this._actEd(`${base}.sub_loads.${j}`) + this._bar(`${base}.sub_loads`, j, sl.length))).join('');
      return `<div class="sub"><h4>${this._t('Sottocarichi ({0}/{1})', sl.length, FV_MAX_SUB)}</h4><div class="hint">${this._t("Dettagliano questa utenza: sul quadrato appare un pulsante che apre l'elenco dei sottocarichi con il loro storico.")}</div>${items}<div class="bar"><button type="button" class="b pri" data-ea="add" data-arr="${base}.sub_loads" ${sl.length >= FV_MAX_SUB ? 'disabled' : ''}>${this._t("+ Aggiungi sottocarico")}</button></div></div>`; };
    const src = (k, label, fields) => this._det('src.' + k, label, fields);
    const sources = src('solar', 'Solare', this._pick('Potenza prodotta (W o kW) — con il secondo MPPT compilato è quella dell\'MPPT 1', 'solar.entity', P) + `<div class="g2">${this._txt('Nome', 'solar.name', 'Solare')}${this._txt('Testo sotto il valore', 'solar.sub', 'PV1 + PV2')}</div>` + this._pick('Tensione di stringa (V, opzionale: appare nel grafico)', 'solar.voltage_entity', P) + this._pick('Corrente di stringa (A, opzionale: se vuota la calcolo da potenza / tensione)', 'solar.current_entity', P) + this._pick('Energia prodotta: contatore in kWh (opzionale)', 'solar.energy_entity', P) + this._pick('Energia prodotta totale di tutti gli MPPT: contatore in kWh (opzionale, con 2 o più MPPT)', 'solar.energy_total_entity', P) + '<div class="hint">' + this._t("Se hai un solo contatore che somma tutti gli MPPT, mettilo qui: sul punto dove le linee si uniscono compare un pallino che apre l'energia per giorno, settimana, mese e anno. Con un solo MPPT usa il campo qui sopra.") + '</div>'
        + [['mppt2', 'Secondo MPPT (opzionale)', 2], ['mppt3', 'Terzo MPPT (opzionale)', 3], ['mppt4', 'Quarto MPPT (opzionale)', 4]].map(([k, w, nn]) => this._det('src.' + k, w, this._pick(this._t('Potenza dell\'MPPT {0} (W o kW)', nn), 'solar.' + k + '.entity', P) + this._txt('Nome', 'solar.' + k + '.name', 'MPPT ' + nn) + this._pick('Tensione di stringa (V, opzionale)', 'solar.' + k + '.voltage_entity', P) + this._pick('Corrente di stringa (A, opzionale)', 'solar.' + k + '.current_entity', P) + this._pick('Energia prodotta: contatore in kWh (opzionale)', 'solar.' + k + '.energy_entity', P) + (k === 'mppt2' ? '<div class="hint">' + this._t("Con più MPPT la card mostra i cerchi affiancati che si uniscono in una sola linea verso l'inverter; il totale solare è la somma (fino a 4 MPPT).") + '</div>' : ''))).join(''))
      + src('grid', 'Rete', this._pick('Potenza prelevata dalla rete (W o kW)', 'grid.entity', P) + this._pick('Energia prelevata dalla rete: contatore in kWh (opzionale)', 'grid.energy_entity', P) + this._pick('Energia immessa in rete: contatore in kWh (opzionale)', 'grid.energy_out_entity', P) + this._pick('Tensione di rete (opzionale)', 'grid.voltage_entity', P) + this._pick('Frequenza di rete in Hz (opzionale, mostrata nel riquadro inverter)', 'grid.frequency_entity', P) + this._txt('Nome', 'grid.name', 'Rete Enel') + this._chk('Potenza positiva = prelievo dalla rete (togli la spunta se il tuo sensore è al contrario). L\'immissione in rete è negativa e il grafico la mostra sotto lo zero.', 'grid.import_positive', 'boolf', c.grid.import_positive !== false))
      + src('battery', 'Batteria', this._pick('Potenza della batteria (W o kW)', 'battery.entity', P) + this._pick('Carica della batteria (%)', 'battery.soc_entity', P) + this._pick('Energia in carica: contatore in kWh (opzionale)', 'battery.energy_in_entity', P) + this._pick('Energia in scarica: contatore in kWh (opzionale)', 'battery.energy_out_entity', P) + this._txt('Nome', 'battery.name', 'Batteria 1') + `<div class="g2">${this._numf('Capacità totale del pacco (kWh)', 'battery.capacity_kwh', 'es. 10,24')}${this._numf('Carica residua desiderata (%)', 'battery.min_soc', 20)}</div><div class="hint">${this._t("La capacità è quella di tutto il pacco (somma delle batterie). Con la capacità impostata compare il tempo stimato: in carica, quanto manca al 100 %; in scarica, quanto resta prima della carica residua desiderata.")}</div>`
        + this._chk('Potenza positiva = in carica (togli la spunta se il tuo sensore è al contrario)', 'battery.charging_positive', 'boolf', c.battery.charging_positive !== false))
      + src('battery2', 'Batteria 2 (opzionale)', this._pick('Potenza della batteria 2 (W o kW)', 'battery2.entity', P) + this._pick('Carica della batteria 2 (%)', 'battery2.soc_entity', P) + this._pick('Energia in carica: contatore in kWh (opzionale)', 'battery2.energy_in_entity', P) + this._pick('Energia in scarica: contatore in kWh (opzionale)', 'battery2.energy_out_entity', P) + this._pick('Energia in carica totale delle due batterie: contatore in kWh (opzionale)', 'battery.energy_total_in_entity', P) + this._pick('Energia in scarica totale delle due batterie: contatore in kWh (opzionale)', 'battery.energy_total_out_entity', P) + '<div class="hint">' + this._t("Se hai un solo contatore che somma le due batterie, mettilo nei due campi «totale»: sul punto dove le linee delle batterie si uniscono compare un pallino che apre l'energia entrata e uscita. Con una sola batteria usa i campi della Batteria 1.") + '</div>' + this._txt('Nome', 'battery2.name', 'Batteria 2')
        + this._chk('Potenza positiva = in carica (togli la spunta se il tuo sensore è al contrario)', 'battery2.charging_positive', 'boolf', (c.battery2 || {}).charging_positive !== false) + '<div class="hint">' + this._t("Se compilata, la card mostra due cerchi batteria affiancati. Se lasci vuoto ne mostra uno solo.") + '</div>')
      + src('home', 'Casa', this._pick('Consumo della casa (opzionale: se vuoto lo calcolo dai flussi)', 'home.entity', P) + this._pick('Energia consumata: contatore in kWh (opzionale)', 'home.energy_entity', P) + this._txt('Nome', 'home.name', 'Casa'));
    const loads = (c.loads || []).map((l, i) => this._det('loads.' + i, `${i + 1} · ${this._nm(l, 'da configurare')}`,
      this._pick('Potenza dell\'utenza (W o kW)', `loads.${i}.entity`, P) + this._pick('Energia consumata: contatore in kWh (opzionale)', `loads.${i}.energy_entity`, P) + `<div class="g2">${this._txt('Nome', `loads.${i}.name`, 'Nome')}${this._sel('Icona', `loads.${i}.icon`, FV_ICONS, l.icon || 'bolt', 1)}</div>`
      + this._txt('Testo sotto il nome (opzionale)', `loads.${i}.sub`, 'es. CLIMA') + this._pick('…oppure entità da mostrare sotto il nome (es. umidità)', `loads.${i}.sub_entity`, ['sensor', 'binary_sensor', 'input_number', 'number']) + (l.icon === 'car' ? this._pick('Carica dell\'auto in % (per auto / wallbox, opzionale: appare sopra e nel grafico)', `loads.${i}.soc_entity`, P) + this._socEd(`loads.${i}`) : '') + this._actEd(`loads.${i}`) + subEd('loads.' + i, l) + this._bar('loads', i, c.loads.length))).join('');
    const inds = (c.indicators || []).map((it, i) => {
      const th = (it.thresholds || []).map((r, k) => `<div class="thr">${this._numf('Da questo valore in su', `indicators.${i}.thresholds.${k}.value`, '')}${this._txt('Colore', `indicators.${i}.thresholds.${k}.color`, '#ffb43a', 'color')}<button type="button" class="b del" data-ea="del" data-arr="indicators.${i}.thresholds" data-idx="${k}">✕</button></div>`).join('');
      return this._det('indicators.' + i, `${i + 1} · ${this._nm(it, 'da configurare')}`,
        this._pick('Entità', `indicators.${i}.entity`, P) + `<div class="g2">${this._txt('Nome', `indicators.${i}.name`, 'Nome')}${this._txt('Unità (vuoto = quella dell\'entità)', `indicators.${i}.unit`, '')}</div>`
        + `<div class="g3">${this._numf('Minimo della barra', `indicators.${i}.min`, 0)}${this._numf('Massimo della barra', `indicators.${i}.max`, 100)}${this._numf('Decimali', `indicators.${i}.decimals`, 'auto')}</div>`
        + `<div class="sub"><h4>${this._t("Colori e soglie")}</h4>${this._txt('Colore di base (sotto la prima soglia)', `indicators.${i}.color`, '#5fd0ff', 'color')}${th || '<div class="hint">' + this._t("Nessuna soglia: l'indicatore resta sempre del colore di base.") + '</div>'}
        <div class="bar"><button type="button" class="b pri" data-ea="add" data-arr="indicators.${i}.thresholds">${this._t("+ Aggiungi soglia")}</button></div>${this._chk('Disattiva le soglie di questo indicatore (le righe restano salvate)', `indicators.${i}.thresholds_off`, 'bool', !!it.thresholds_off)}
        <div class="hint">${this._t("Ogni soglia vale «da questo valore in su». Le soglie si possono mettere in qualsiasi ordine e quante ne vuoi.")}</div></div>` + this._bar('indicators', i, c.indicators.length));
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
    const add = (path, label, n, max) => `<div class="bar"><button type="button" class="b pri" data-ea="add" data-arr="${path}" ${n >= max ? 'disabled' : ''}>${this._t(label)}</button></div>`;
    const invs = (c.inverters || []).map((v, i) => {
      const b = 'inverters.' + i; const ph = v.phase || {}; const bt = v.battery || {}; const nl = (v.loads || []).length; const va = Object.assign({ controls: [], switches: [], readings: [] }, v.axpert || {}); const ia = axl(b + '.axpert', va);
      const mp = (j) => this._det(b + '.mppt' + j, this._t(j ? 'MPPT {0} (opzionale)' : 'MPPT {0}', j + 1), this._pick('Potenza (W o kW)', `${b}.mppt.${j}.entity`, P) + this._pick('Tensione di stringa (V, opzionale)', `${b}.mppt.${j}.voltage_entity`, P) + this._pick('Corrente di stringa (A, opzionale: se vuota la calcolo da potenza / tensione)', `${b}.mppt.${j}.current_entity`, P) + this._pick('Energia prodotta: contatore in kWh (opzionale)', `${b}.mppt.${j}.energy_entity`, P) + this._txt('Nome', `${b}.mppt.${j}.name`, 'MPPT ' + (j + 1)));
      const ls = (v.loads || []).map((l, k) => this._det(`${b}.loads.${k}`, `${k + 1} · ${this._nm(l, 'da configurare')}`, this._pick('Potenza dell\'utenza (W o kW)', `${b}.loads.${k}.entity`, P) + this._pick('Energia consumata: contatore in kWh (opzionale)', `${b}.loads.${k}.energy_entity`, P) + `<div class="g2">${this._txt('Nome', `${b}.loads.${k}.name`, 'Nome')}${this._sel('Icona', `${b}.loads.${k}.icon`, FV_ICONS, l.icon || 'bolt', 1)}</div>` + (l.icon === 'car' ? this._pick('Carica dell\'auto in % (per auto / wallbox, opzionale)', `${b}.loads.${k}.soc_entity`, P) + this._socEd(`${b}.loads.${k}`) : '') + this._actEd(`${b}.loads.${k}`) + subEd(b + '.loads.' + k, l) + this._bar(b + '.loads', k, nl))).join('');
      return this._det('inverters.' + i, `${i + 1} · ${v.name || this._t('Inverter {0}', i + 1)}`,
        this._txt('Nome', `${b}.name`, this._t('Inverter {0}', i + 1))
        + `<div class="sub"><h4>${this._t("Fase di rete")}</h4>${this._pick('Potenza della fase (W o kW)', `${b}.phase.entity`, P) + this._pick('Energia prelevata dalla rete: contatore in kWh (opzionale)', `${b}.phase.energy_entity`, P) + this._pick('Energia immessa in rete: contatore in kWh (opzionale)', `${b}.phase.energy_out_entity`, P)}${this._pick('Tensione della fase (opzionale)', `${b}.phase.voltage_entity`, P)}${this._txt('Nome', `${b}.phase.name`, this._t('Fase L{0}', i + 1))}${this._chk('Potenza positiva = prelievo dalla rete (togli la spunta se il tuo sensore è al contrario: l\'immissione in rete diventa negativa nel grafico)', `${b}.phase.import_positive`, 'boolf', ph.import_positive !== false)}</div>`
        + `<div class="sub"><h4>${this._t("Solare (MPPT)")}</h4>${mp(0)}${mp(1)}${mp(2)}${mp(3)}</div>`
        + `<div class="sub"><h4>${this._t("Batteria")}</h4>${this._pick('Potenza della batteria (W o kW)', `${b}.battery.entity`, P)}${this._pick('Carica della batteria (%)', `${b}.battery.soc_entity`, P) + this._pick('Energia in carica: contatore in kWh (opzionale)', `${b}.battery.energy_in_entity`, P) + this._pick('Energia in scarica: contatore in kWh (opzionale)', `${b}.battery.energy_out_entity`, P)}${this._txt('Nome', `${b}.battery.name`, this._t('Batteria {0}', i + 1))}<div class="g2">${this._numf('Capacità (kWh)', `${b}.battery.capacity_kwh`, 'es. 5,12')}${this._numf('Carica residua desiderata (%)', `${b}.battery.min_soc`, 20)}</div>${this._chk('Potenza positiva = in carica (togli la spunta se il tuo sensore è al contrario)', `${b}.battery.charging_positive`, 'boolf', bt.charging_positive !== false)}</div>`
        + `<div class="sub"><h4>${this._t("Casa")}</h4>${this._pick('Consumo della casa (opzionale: se vuoto lo calcolo dai flussi)', `${b}.home.entity`, P) + this._pick('Energia consumata: contatore in kWh (opzionale)', `${b}.home.energy_entity`, P)}${this._txt('Nome', `${b}.home.name`, this._t('Casa {0}', i + 1))}</div>`
        + `<div class="sub"><h4>${this._t('Utenze ({0}/{1})', nl, FV_MAX_LOADS_INV)}</h4>${ls}${add(b + '.loads', '+ Aggiungi utenza', nl, FV_MAX_LOADS_INV)}</div>`
        + `<div class="sub"><h4>${this._t("Impostazioni inverter (popup dell'inverter)")}</h4>${this._txt('Titolo', `${b}.axpert.title`, v.name || this._t('Inverter {0}', i + 1))}<div class="hint">${this._t("Se compili almeno un campo, il riquadro dell'inverter diventa cliccabile e apre queste impostazioni. La password è quella della sezione «Inverter».")}</div><h4>${this._t("Impostazioni (select / number)")}</h4>${ia.ctl}${add(b + '.axpert.controls', '+ Aggiungi impostazione', 0, 99)}<h4>${this._t("Interruttori")}</h4>${ia.sws}${add(b + '.axpert.switches', '+ Aggiungi interruttore', 0, 99)}<h4>${this._t("Letture")}</h4>${ia.rds}${add(b + '.axpert.readings', '+ Aggiungi lettura', 0, 99)}</div>`
        + this._bar('inverters', i, c.inverters.length));
    }).join('');
    this.shadowRoot.innerHTML = `<style>${FV_ED_CSS}</style><div class="ed ${c.mode === 'multi' ? 'multi' : 'single'}">
      ${this._det('g', 'Generale', this._sel('Lingua', 'language', FV_LANG_OPTS, c.language || '', true) + `<div class="g2">${this._txt('Titolo', 'title', 'Fotovoltaico')}${this._txt('Sopra il titolo', 'subtitle', 'ENERGIA')}</div>` + this._sel('Modalità', 'mode', [['', 'Singolo inverter'], ['multi', 'Multi inverter (fino a 3, uno per fase)']], c.mode || '', true) + '<div class="hint">' + this._t("Multi inverter: ogni inverter ha la sua fase di rete, i suoi MPPT, la sua batteria e le sue utenze. La sezione «Rete» resta quella della rete totale (se vuota la calcolo sommando le fasi).") + '</div>' + (c.mode === 'multi' ? this._chk('Batteria unica collegata a più inverter: la capacità totale e la carica residua desiderata si impostano solo nel primo inverter (per i tempi di carica/scarica uso quella capacità; le potenze le sommo da tutti gli inverter)', 'shared_battery', 'bool', !!c.shared_battery, true) + this._chk("Percentuale dei carichi sul totale delle uscite degli inverter (invece che sull'inverter che li alimenta)", 'loads_pct_total', 'bool', !!c.loads_pct_total, true) : ''))}
      ${this._det('src', 'Fonti e casa', sources)}
      ${this._det('loads', this._t('Utenze ({0}/{1})', (c.loads || []).length, FV_MAX_LOADS), (loads || '<div class="hint">' + this._t('Nessuna utenza. Ne puoi aggiungere fino a {0}: ognuna ha la sua linea animata e la sua quota sul consumo.', FV_MAX_LOADS) + '</div>') + add('loads', '+ Aggiungi utenza', (c.loads || []).length, FV_MAX_LOADS))}
      ${this._det('inverters', this._t('Inverter ({0}/{1})', (c.inverters || []).length, FV_MAX_INV), (invs || '<div class="hint">' + this._t('Nessun inverter. Aggiungine fino a {0} (uno per fase).', FV_MAX_INV) + '</div>') + add('inverters', '+ Aggiungi inverter', (c.inverters || []).length, FV_MAX_INV))}
      ${this._det('indicators', this._t('Indicatori ({0}/{1})', (c.indicators || []).length, FV_MAX_IND), this._sel('Aspetto', 'indicators_look', [['', 'Anello'], ['tiles', 'Tessere con barra'], ['barsT', 'Barra a soglie visibili'], ['ringT', 'Anello a soglie visibili']], c.indicators_look || '') + (inds || '<div class="hint">' + this._t('Nessun indicatore. Ne puoi aggiungere fino a {0} (3 file da 6 su schermo largo). Toccandoli la card mostra lo storico a 24 ore e 7 giorni.', FV_MAX_IND) + '</div>') + add('indicators', '+ Aggiungi indicatore', (c.indicators || []).length, FV_MAX_IND))}
      ${this._det('axpert', 'Inverter: impostazioni, interruttori, letture', `<div class="g2">${this._txt('Titolo', 'axpert.title', 'Inverter')}${this._txt('Titolo delle letture', 'axpert.readings_title', 'Inverter FV')}</div>
        <div class="sub"><h4>${this._t("Impostazioni (select / number)")}</h4>${ctl}${add('axpert.controls', '+ Aggiungi impostazione', 0, 99)}</div>
        <div class="sub"><h4>${this._t("Interruttori")}</h4>${sws}${add('axpert.switches', '+ Aggiungi interruttore', 0, 99)}</div>
        <div class="sub"><h4>${this._t("Letture (Inverter FV)")}</h4>${rds}${add('axpert.readings', '+ Aggiungi lettura', 0, 99)}</div>
        <div class="sub"><h4>${this._t("Password")}</h4>${this._chk('Proteggi con password', 'axpert.lock.enabled', 'bool', !!lk.enabled, true)}
          ${lk.enabled ? `<div class="g2">${this._txt('Password (solo cifre)', 'axpert.lock.pin', '1234')}${this._numf('Si riblocca dopo (secondi)', 'axpert.lock.seconds', 30)}</div>${this._chk('Proteggi le impostazioni', 'axpert.lock.protect_controls', 'boolf', lk.protect_controls !== false)}${this._chk('Proteggi gli interruttori', 'axpert.lock.protect_switches', 'boolf', lk.protect_switches !== false)}
          <div class="hint">${this._t("Una sola password sblocca tutto per il tempo indicato. Serve a evitare i tocchi involontari: la password resta scritta nella configurazione della plancia, quindi non è una protezione di sicurezza.")}</div>` : ''}</div>`)}
      ${this._det('history', 'Storico potenze', `<div class="g2">${this._txt('Titolo', 'history.title', 'STORICO POTENZE')}${this._numf('Altezza del grafico (px)', 'history.height', 260)}</div>
        ${this._sel('Stile', 'history.look', [['', 'Linee'], ['areas', 'Linee con area']], hs.look || '')}
        <div><div class="hint" style="margin-bottom:6px">${this._t("Intervalli selezionabili")}</div><div class="chks">${[['24h', '24 ore'], ['7g', '7 giorni'], ['30g', '30 giorni']].map(([r, l]) => `<label class="chk"><input type="checkbox" data-p="history.ranges" data-k="list" data-v="${r}" ${rg.includes(r) ? 'checked' : ''}>${this._t(l)}</label>`).join('')}</div></div>
        <div class="sub"><h4>${this._t('Serie ({0}/{1})', (hs.series || []).length, FV_MAX_SERIES)}</h4>${ser}${add('history.series', '+ Aggiungi serie', (hs.series || []).length, FV_MAX_SERIES)}</div>`)}
      ${this._det('eco', 'Costi e bolletta', this._ecoEd(c))}
      ${this._det('alerts', 'Allerta entità', `<div class="hint" style="margin-bottom:10px">${this._t("Mostra un triangolo giallo sul cerchio o riquadro dell'entità quando Home Assistant la segnala non disponibile (unavailable), sconosciuta (unknown), vuota o inesistente. Scegli le sezioni da controllare.")}</div><div class="chks">${this._chk('Rete', 'alerts.rete', 'bool', !!(c.alerts && c.alerts.rete))}${this._chk('MPPT', 'alerts.mppt', 'bool', !!(c.alerts && c.alerts.mppt))}${this._chk('Batteria', 'alerts.battery', 'bool', !!(c.alerts && c.alerts.battery))}${this._chk('Casa e utenze', 'alerts.loads', 'bool', !!(c.alerts && c.alerts.loads))}</div>`)}
      ${this._det('info', 'Informazioni', `<div class="hint" style="margin-bottom:10px">${this._t("I contatori di energia (kWh) devono essere sensori con totale che cresce (state_class total_increasing o total), registrati da Home Assistant. Con un contatore configurato, il popup mostra l'energia per giorno, settimana, mese e anno.")}</div><div class="hint">${this._t("Versione installata")}</div><div style="font-size:20px;font-weight:600;padding:2px 0 10px">${fvEsc(FV_VERSION)}</div><div class="hint">${this._t("Se dopo un aggiornamento qui vedi ancora il numero vecchio, la pagina sta usando il file in cache: controlla che la risorsa punti al file nuovo e ricarica.")}</div>`)}
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
  name: 'FV HUD Card',
  documentationURL: 'https://github.com/Memme1989/fv-hud-card',
  description: 'Full-page photovoltaic view for single or multi inverter setups: animated flow, chart popups (power, voltage, current, SOC) for every element, up to 10 loads, up to 18 indicators with colored thresholds and history, password-protected inverter settings, power history. IT / EN / ES / FR / DE, everything configurable from the editor.',
});
