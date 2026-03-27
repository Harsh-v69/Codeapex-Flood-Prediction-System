/* ============================================================
   DFIS — Delhi Flood Intelligence System
   js/app.js — Main Application Controller
   ============================================================ */
'use strict';
window.DFIS = window.DFIS || {};
DFIS.app = {
  currentPage: 'dashboard',
  PAGE_STORAGE_KEY: 'dfis_active_page',
  init() {
    DFIS.app.initRain();
    DFIS.app.initClock();
    DFIS.app.initNav();
    DFIS.app.showPage(DFIS.app._loadSavedPage());
    if (DFIS.live && typeof DFIS.live.start === 'function') {
      DFIS.live.start();
    }
  },
  initRain() {
    const c = document.getElementById('rainContainer');
    if (!c) return;
    for (let i = 0; i < 50; i++) {
      const d = document.createElement('div');
      d.className = 'rdrop';
      const h = Math.random() * 100 + 60;
      d.style.cssText = 'left:' + (Math.random()*100) + '%;height:' + h + 'px;animation-duration:' + (Math.random()*2+0.8) + 's;animation-delay:' + (Math.random()*4) + 's;';
      c.appendChild(d);
    }
  },
  initClock() {
    function tick() {
      const t  = DFIS.utils.timeIST();
      const ce = document.getElementById('clockEl');
      const fe = document.getElementById('footerTime');
      const mu = document.getElementById('mapUpdateTime');
      if (ce) ce.textContent = 'IST ' + t;
      if (fe) fe.textContent = 'Last sync: ' + t;
      if (mu) mu.textContent = t;
    }
    tick();
    setInterval(tick, 1000);
  },
  initNav() {
    document.querySelectorAll('.ntab').forEach(tab => {
      tab.addEventListener('click', () => {
        const page = tab.getAttribute('data-page');
        if (page) DFIS.app.showPage(page);
      });
    });
  },
  showPage(id) {
    const nextPage = DFIS.pages && DFIS.pages[id] ? id : 'dashboard';
    DFIS.app.currentPage = nextPage;
    DFIS.app._savePage(nextPage);
    document.querySelectorAll('.ntab').forEach(t => {
      t.classList.toggle('on', t.getAttribute('data-page') === nextPage);
    });
    const main = document.getElementById('mainContent');
    if (!main) return;
    const tpl = DFIS.pages && DFIS.pages[nextPage];
    if (!tpl) {
      main.innerHTML = '<div class="page on" style="padding:40px;color:var(--muted)">Page not found: ' + nextPage + '</div>';
      return;
    }
    main.innerHTML = '<div class="page on" id="page-' + nextPage + '">' + tpl + '</div>';
    try {
      const hook = DFIS.app.pageHooks[nextPage];
      if (hook) hook();
    } catch(e) { console.warn('[DFIS] pageHook error:', e); }
    try {
      if (DFIS.live && DFIS.live._cache) DFIS.live._updateDOM(DFIS.live._cache);
    } catch(e) {}
  },
  _loadSavedPage() {
    try {
      const saved = localStorage.getItem(DFIS.app.PAGE_STORAGE_KEY);
      if (saved && DFIS.pages && DFIS.pages[saved]) return saved;
    } catch (e) {}
    return 'dashboard';
  },
  _savePage(page) {
    try {
      localStorage.setItem(DFIS.app.PAGE_STORAGE_KEY, page);
    } catch (e) {}
  },
  pageHooks: {
    dashboard() {
      DFIS.map.renderDashboardMap('mainMapWrap');
      DFIS.charts.renderRainfallBar('rainfallBar');
      DFIS.charts.renderTopRisks('topRiskList');
    },
    hotspots() {
      DFIS.charts.renderDistrictBars('districtBars');
      DFIS.app._renderMethodology('methodologyBody');
      DFIS.app._renderHotspotTable('hotspotTbody');
    },
    wards() {
      DFIS.wards.render('all');
    },
    yamuna() {
      DFIS.charts.renderYamunaChart('yamunaChartWrap');
      DFIS.charts.renderFloodStages('floodStages');
      DFIS.app._renderGaugeTable('gaugeTableWrap');
      DFIS.app._renderYamunaColonies('yamunaColonies');
    },
    simulator() {
      if (DFIS.live && DFIS.live._cache) {
        const d = DFIS.live._cache;
        const sRain   = document.getElementById('sRain');
        const sYamuna = document.getElementById('sYamuna');
        const sSoil   = document.getElementById('sSoil');
        DFIS.simulator?.configureForCity?.();
        if (sRain   && d.rainfall && d.rainfall.currentMmHr)  sRain.value   = Math.min(250, Math.round(d.rainfall.currentMmHr));
        if (sYamuna && d.yamuna  && d.yamuna.level)           sYamuna.value = Math.round(d.yamuna.level * 100);
        if (sSoil   && d.soil    && d.soil.pct)               sSoil.value   = d.soil.pct;
      }
      DFIS.simulator.run();
    },
    routes() {
      if (DFIS.routes && typeof DFIS.routes.init === 'function') {
        DFIS.routes.init();
      } else {
        console.warn('[DFIS] DFIS.routes not loaded - make sure route.js is included before app.js');
      }
    },
    // ── Send Alerts ──────────────────────────────────────────
    alerts() {
      if (DFIS.alerts && typeof DFIS.alerts.init === 'function') {
        DFIS.alerts.init();
      } else {
        console.warn('[DFIS] DFIS.alerts not loaded — make sure send-laert.js is included before app.js');
      }
    },
    assistant() {
      if (DFIS.assistant && typeof DFIS.assistant.init === 'function') {
        DFIS.assistant.init();
      } else {
        console.warn('[DFIS] DFIS.assistant not loaded - make sure assistant.js is included before app.js');
      }
    },
    features() {
      DFIS.app._renderFeatures('featGrid');
    },
    architecture() {
      DFIS.app._renderTechStack('techStackBody');
      DFIS.charts.renderPipeline('pipelineRow');
    },
  },
  _liveRefreshHooks: {
    dashboard() {
      DFIS.charts && DFIS.charts.renderRainfallBar('rainfallBar');
      DFIS.charts && DFIS.charts.renderTopRisks('topRiskList');
      DFIS.map && DFIS.map.renderHotspots();
    },
    hotspots() {
      DFIS.charts && DFIS.charts.renderDistrictBars('districtBars');
      const tbody = document.getElementById('hotspotTbody');
      if (tbody) tbody.innerHTML = '';
      DFIS.app._renderHotspotTable('hotspotTbody');
    },
    yamuna() {
      DFIS.charts && DFIS.charts.renderYamunaChart('yamunaChartWrap');
      DFIS.app._renderGaugeTable('gaugeTableWrap');
    },
    wards() {
      DFIS.wards && DFIS.wards.render(DFIS.wards.currentFilter);
    },
    assistant() {
      DFIS.assistant && DFIS.assistant.refreshContext && DFIS.assistant.refreshContext(true);
    },
  },
  _renderMethodology(id) {
    const el = document.getElementById(id);
    if (!el) return;
    const city = DFIS.live?.getCurrentCityConfig?.() || { label: 'Delhi', fullName: 'Delhi NCT' };
    const steps = [
      { color:'var(--safe)',   phase:'Step 1 - Data Ingestion',        body:'City-specific geospatial and hydrology layers are loaded for ' + city.fullName + ', then aligned to the dashboard data contract.', tags:['GeoJSON','CSV','Model Inputs'] },
      { color:'var(--info)',   phase:'Step 2 - Weather Context',       body:'Live weather and flood conditions are fetched for the selected city and normalized into rainfall, humidity, wind, and soil signals.', tags:['Open-Meteo','Flood API','Normalization'] },
      { color:'var(--warn)',   phase:'Step 3 - Risk Scoring',          body:'The active city model computes hotspot probabilities, water risk context, and readiness components without frontend hardcoded values.', tags:['Model Inference','Risk Scores','Backend API'] },
      { color:'var(--accent)', phase:'Step 4 - Operational Output',    body:'Calculated hotspots, alerts, and readiness rows are pushed into the UI, route planning, and monitoring cards for ' + city.label + '.', tags:['Dashboard','Alerts','Readiness'] },
    ];
    el.innerHTML = steps.map(s =>
      '<div style="background:var(--abyss);border-radius:8px;padding:12px;border-left:3px solid ' + s.color + ';margin-bottom:10px">' +
        '<div style="font-family:var(--font-mono);font-size:9px;color:' + s.color + ';letter-spacing:2px;text-transform:uppercase;margin-bottom:4px">' + s.phase + '</div>' +
        '<div style="font-size:11px;color:var(--muted);margin-bottom:8px">' + s.body + '</div>' +
        '<div style="display:flex;flex-wrap:wrap;gap:4px">' + s.tags.map(t => '<span class="ttag">' + t + '</span>').join('') + '</div>' +
      '</div>'
    ).join('');
  },
  _deriveRouteTarget(label) {
    const city = DFIS.live?.getCurrentCityConfig?.()?.key || 'delhi';
    if (city === 'sikkim') {
      return { destination: label || 'CITY_CENTER', origin: 'CITY_CENTER', severity: 'high' };
    }
    if (city === 'mumbai') {
      const text = (label || '').toLowerCase();
      if (text.includes('sion') || text.includes('dadar')) return { destination: 'Dadar', origin: 'BKC', severity: 'high' };
      if (text.includes('kurla') || text.includes('chembur')) return { destination: 'Kurla', origin: 'BKC', severity: 'severe' };
      if (text.includes('andheri') || text.includes('jogeshwari')) return { destination: 'Andheri', origin: 'Andheri', severity: 'high' };
      return { destination: 'Dadar', origin: 'BKC', severity: 'high' };
    }
    const text = (label || '').toLowerCase();
    if (text.includes('shahdara')) return { destination: 'Shahdara', origin: 'Saket', severity: 'severe' };
    if (text.includes('geeta')) return { destination: 'GeetaColony', origin: 'ITO', severity: 'high' };
    if (text.includes('burari') || text.includes('sonia vihar')) return { destination: 'Burari', origin: 'ITO', severity: 'high' };
    if (text.includes('rohini')) return { destination: 'Rohini', origin: 'Rohini', severity: 'moderate' };
    if (text.includes('mustafabad') || text.includes('yamuna pushta') || text.includes('gokulpuri') || text.includes('loni')) {
      return { destination: 'Shahdara', origin: 'ITO', severity: 'severe' };
    }
    if (text.includes('trilokpuri') || text.includes('patparganj')) return { destination: 'GeetaColony', origin: 'ITO', severity: 'moderate' };
    return { destination: 'Shahdara', origin: 'Saket', severity: 'high' };
  },
  openRouteForLocation(label, meta = {}) {
    const target = DFIS.app._deriveRouteTarget(label);
    const severityRank = { normal: 0, moderate: 1, high: 2, severe: 3 };
    const severity = meta.severity && severityRank[meta.severity] !== undefined
      ? meta.severity
      : target.severity;
    const origin = meta.origin || target.origin;
    const destination = meta.destination || target.destination;

    if (DFIS.routes && typeof DFIS.routes.setScenario === 'function') {
      DFIS.routes.setScenario({
        origin,
        destination,
        severity,
        source: meta.source || 'hotspot',
      });
    } else {
      DFIS.routeState = { origin, destination, severity, source: meta.source || 'hotspot' };
    }
    DFIS.app.showPage('routes');
  },
  _renderHotspotTable(tbodyId) {
    const tbody = document.getElementById(tbodyId);
    if (!tbody) return;
    DFIS.HOTSPOTS.forEach(h => {
      const rClass     = DFIS.utils.riskClass(h.risk);
      const scoreColor = { critical:'var(--danger)', high:'var(--accent)', medium:'var(--warn)', low:'var(--safe)' }[h.risk];
      const drainBadge = h.drain.includes('Blocked') || h.drain === 'Overflow' ? 'b-danger' : h.drain.includes('Choked') ? 'b-warn' : 'b-muted';
      const tr = document.createElement('tr');
      tr.style.cursor = 'pointer';
      tr.innerHTML =
        '<td style="font-family:var(--font-mono);font-size:11px;color:var(--muted)">' + h.id + '</td>' +
        '<td style="font-weight:600">' + h.loc + '</td>' +
        '<td style="color:var(--muted)">' + h.dist + '</td>' +
        '<td><span style="font-family:var(--font-mono);font-weight:700;color:' + scoreColor + '">' + h.score + '/100</span></td>' +
        '<td><span class="rpill ' + rClass + '">' + h.risk + '</span></td>' +
        '<td style="color:var(--muted);font-size:11px;max-width:200px">' + h.cause + '</td>' +
        '<td style="font-family:var(--font-mono);color:' + ((h.risk === 'critical' || h.risk === 'high') ? 'var(--danger)' : 'var(--muted)') + '">' + h.elev + 'm</td>' +
        '<td><span class="badge ' + drainBadge + '">' + h.drain + '</span></td>' +
        '<td style="font-size:11px;color:var(--muted)">' + h.action + '<div style="margin-top:6px;color:var(--info);font-family:var(--font-mono);font-size:10px">Open route plan</div></td>';
      tr.addEventListener('click', () => {
        DFIS.app.openRouteForLocation(h.loc, { severity: h.risk === 'critical' ? 'severe' : h.risk === 'high' ? 'high' : 'moderate', source: 'hotspot-table' });
      });
      tbody.appendChild(tr);
    });
  },
  _renderGaugeTable(id) {
    const el = document.getElementById(id);
    if (!el) return;
    const sc = { WARNING:'rp-high', NORMAL:'rp-low', DANGER:'rp-critical', RELEASE:'rp-critical' };
    const rows = DFIS.YAMUNA.gaugeStations.map(s =>
      '<tr>' +
        '<td>' + s.name + '</td>' +
        '<td style="font-family:var(--font-mono);color:' + (s.current >= (s.danger ?? Number.POSITIVE_INFINITY) ? 'var(--danger)' : s.current >= (s.warning ?? Number.POSITIVE_INFINITY) ? 'var(--warn)' : 'var(--safe)') + '">' + (s.current != null ? s.current : 'PEAK') + '</td>' +
        '<td style="font-family:var(--font-mono);color:var(--muted)">' + (s.danger != null ? s.danger : 'N/A') + '</td>' +
        '<td><span class="rpill ' + (sc[s.status] || 'rp-low') + '">' + s.status + '</span></td>' +
        '<td style="color:' + (s.trend.includes('up') || s.trend.includes('Rising') ? 'var(--danger)' : 'var(--safe)') + '">' + s.trend + '</td>' +
      '</tr>'
    ).join('');
    el.innerHTML = '<table class="dtable"><thead><tr><th>Station</th><th>Level (m)</th><th>Danger (m)</th><th>Status</th><th>Trend</th></tr></thead><tbody>' + rows + '</tbody></table>';
  },
  _renderYamunaColonies(id) {
    const el = document.getElementById(id);
    if (!el) return;
    const ss = {
      EVACUATE: { bg:'rgba(244,63,94,0.08)',  border:'rgba(244,63,94,0.2)',  pill:'rp-critical' },
      ALERT:    { bg:'rgba(249,115,22,0.08)', border:'rgba(249,115,22,0.2)', pill:'rp-high' },
      WATCH:    { bg:'rgba(250,204,21,0.06)', border:'rgba(250,204,21,0.2)', pill:'rp-medium' },
    };
    el.innerHTML = DFIS.YAMUNA_COLONIES.map(c => {
      const st = ss[c.status] || ss.WATCH;
      return '<div style="background:' + st.bg + ';border:1px solid ' + st.border + ';border-radius:6px;padding:10px 14px;display:flex;justify-content:space-between;align-items:center;margin-bottom:6px">' +
        '<div><div style="font-size:12px;font-weight:600">' + c.name + '</div><div style="font-size:11px;color:var(--muted)">' + c.pop + ' · ' + c.zone + '</div></div>' +
        '<span class="rpill ' + st.pill + '">' + c.status + '</span></div>';
    }).join('');
  },
  _renderFeatures(id) {
    const el = document.getElementById(id);
    if (!el) return;
    const tc = { core:'ft-core', advanced:'ft-adv', innovative:'ft-inn' };
    const tl = { core:'Core', advanced:'Advanced', innovative:'Innovative' };
    el.innerHTML = DFIS.FEATURES.map(f =>
      '<div class="feat-card ' + tc[f.tier] + '-card">' +
        '<div class="feat-tier ' + tc[f.tier] + '">' + tl[f.tier] + '</div>' +
        '<span class="feat-icon">' + f.icon + '</span>' +
        '<div class="feat-name">' + f.name + '</div>' +
        '<div class="feat-desc">' + f.desc + '</div>' +
        '<div class="feat-tags">' + f.tags.map(t => '<span class="ftag">' + t + '</span>').join('') + '</div>' +
      '</div>'
    ).join('');
  },
  _renderTechStack(id) {
    const el = document.getElementById(id);
    if (!el) return;
    const city = DFIS.live?.getCurrentCityConfig?.() || { fullName: 'Active City' };
    const stack = [
      { color:'var(--safe)',   label:'City Context',    tools:[city.fullName, 'Datasets', 'Hotspot Coordinates', 'Operational Regions'] },
      { color:'var(--info)',   label:'Machine Learning', tools:['XGBoost / dataset inference', 'Probability scoring', 'Readiness scoring'] },
      { color:'var(--accent)', label:'Visualization',    tools:['Leaflet', 'Charts', 'Dynamic templates', 'Live dashboard updates'] },
      { color:'var(--warn)',   label:'Live Data Sources', tools:['Open-Meteo', 'Flood API', 'Backend endpoints', 'Stored datasets'] },
      { color:'var(--yamuna)', label:'Backend & Infra',  tools:['FastAPI', 'Model files', 'Browser runtime', 'Routing Machine'] },
    ];
    el.innerHTML = stack.map(s =>
      '<div style="background:var(--abyss);border-radius:8px;padding:12px;margin-bottom:10px">' +
        '<div style="font-family:var(--font-mono);font-size:9px;color:' + s.color + ';letter-spacing:2px;text-transform:uppercase;margin-bottom:8px">' + s.label + '</div>' +
        '<div style="display:flex;flex-wrap:wrap;gap:5px">' + s.tools.map(t => '<span class="ttag">' + t + '</span>').join('') + '</div>' +
      '</div>'
    ).join('');
  },
};
document.addEventListener('DOMContentLoaded', () => DFIS.app.init());
