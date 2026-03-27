'use strict';

window.DFIS = window.DFIS || {};

(function () {
  function esc(value) {
    return String(value ?? '')
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#39;');
  }

  function city() {
    return DFIS.live?.getCurrentCityConfig?.() || { label: 'Delhi', fullName: 'Delhi NCT' };
  }

  function wards() {
    return Array.isArray(DFIS.WARDS) ? DFIS.WARDS.slice() : [];
  }

  function hotspots() {
    return Array.isArray(DFIS.HOTSPOTS) ? DFIS.HOTSPOTS.slice() : [];
  }

  function riskPillClass(risk) {
    return DFIS.utils?.riskClass ? DFIS.utils.riskClass(risk) : `rp-${risk}`;
  }

  function wardHotspotMap() {
    const map = {};
    hotspots().forEach((row) => {
      const key = row.dist || 'Unknown';
      if (!map[key]) map[key] = { hotspots: 0, critical: 0 };
      map[key].hotspots += 1;
      if (row.risk === 'critical') map[key].critical += 1;
    });
    return map;
  }

  function enrichedRows() {
    const hsMap = wardHotspotMap();
    return wards().map((row) => {
      const meta = hsMap[row.dist || row.name] || hsMap[row.name] || { hotspots: 0, critical: 0 };
      const readiness = typeof row.readiness === 'number'
        ? row.readiness
        : DFIS.utils?.computeScore
          ? DFIS.utils.computeScore(row)
          : 0;
      const risk = row.risk === 'low' ? 'prepared' : row.risk;
      return {
        ...row,
        readiness,
        hotspots: meta.hotspots,
        critical_hotspots: meta.critical,
        ui_risk: risk,
      };
    }).sort((a, b) => a.readiness - b.readiness);
  }

  function riskCounts(rows) {
    return {
      critical: rows.filter((row) => row.ui_risk === 'critical').length,
      high: rows.filter((row) => row.ui_risk === 'medium').length,
      prepared: rows.filter((row) => row.ui_risk === 'prepared').length,
    };
  }

  function mediumCount(rows) {
    return rows.filter((row) => row.readiness >= 40 && row.readiness < 70).length;
  }

  function queryState() {
    return {
      text: (document.getElementById('wardSearch')?.value || '').trim().toLowerCase(),
      district: document.getElementById('wardDistrictSelect')?.value || 'all',
      risk: document.querySelector('.ward-filter-chip.active')?.dataset.filter || 'all',
    };
  }

  function filteredRows() {
    const { text, district, risk } = queryState();
    return enrichedRows().filter((row) => {
      if (district !== 'all' && row.dist !== district) return false;
      if (risk === 'critical' && row.readiness >= 40) return false;
      if (risk === 'medium' && (row.readiness < 40 || row.readiness >= 70)) return false;
      if (risk === 'prepared' && row.readiness < 70) return false;
      if (!text) return true;
      const haystack = [row.name, row.dist].join(' ').toLowerCase();
      return haystack.includes(text);
    });
  }

  function componentBar(value, tone) {
    const pct = Math.max(0, Math.min(100, Number(value || 0)));
    return `
      <div class="ward-mini">
        <div class="ward-mini-track">
          <div class="ward-mini-fill ward-mini-${tone}" style="width:${pct}%"></div>
        </div>
        <span>${pct}%</span>
      </div>`;
  }

  function priorityAction(row) {
    if (row.readiness < 40) return 'EMERGENCY: Deploy pumps + evacuate';
    if (row.readiness < 55) return 'Pre-position pumps + alert residents';
    if (row.readiness < 70) return 'Drain inspection + field readiness';
    return 'Maintain readiness and monitoring';
  }

  function renderHero() {
    const rows = enrichedRows();
    const counts = riskCounts(rows);
    const med = mediumCount(rows);
    const totalHotspots = hotspots().length;
    const cityCfg = city();
    const eyebrow = document.getElementById('wardHeroEyebrow');
    const desc = document.getElementById('wardHeroDesc');
    if (eyebrow) eyebrow.textContent = `${cityCfg.fullName} · ${rows.length} wards · derived from ${totalHotspots} hotspots`;
    if (desc) desc.textContent = `${rows.length} API/model readiness rows · ${totalHotspots} hotspots linked through live district context · scores refresh with backend updates`;
    const set = (id, v) => { const el = document.getElementById(id); if (el) el.textContent = v; };
    set('wardBadgeCritical', `${counts.critical} Critical`);
    set('wardBadgeHigh', `${rows.filter((row) => row.readiness < 55 && row.readiness >= 40).length} High`);
    set('wardBadgeMedium', `${med} Medium`);
    set('wardBadgePrepared', `${counts.prepared} Prepared`);
    set('wardBadgeCoverage', `${totalHotspots} Hotspots · ${rows.length} Wards`);
    set('wardCardCritical', counts.critical);
    set('wardCardHigh', rows.filter((row) => row.readiness < 55 && row.readiness >= 40).length);
    set('wardCardMedium', med);
    set('wardCardPrepared', counts.prepared);
    set('wardCardCoverage', totalHotspots);

    const worst = rows.slice(0, 2).map((row) => row.name).join(' · ');
    const highDistricts = [...new Set(rows.filter((row) => row.readiness < 55).map((row) => row.dist))].slice(0, 3).join(' · ');
    const preparedDistricts = [...new Set(rows.filter((row) => row.readiness >= 70).map((row) => row.dist))].slice(0, 3).join(' · ');
    set('wardCriticalMeta', worst || 'No critical wards');
    set('wardHighMeta', highDistricts || 'No strained districts');
    set('wardMediumMeta', [...new Set(rows.filter((row) => row.readiness >= 55 && row.readiness < 70).map((row) => row.dist))].slice(0, 3).join(' · ') || 'No medium wards');
    set('wardPreparedMeta', preparedDistricts || 'No prepared wards');
    set('wardCoverageMeta', rows.length ? `~${Math.max(1, Math.round(totalHotspots / rows.length))} per ward avg` : 'No ward coverage');
  }

  function renderDimensions() {
    const rows = enrichedRows();
    const avg = (key) => rows.length ? Math.round(rows.reduce((sum, row) => sum + Number(row[key] || 0), 0) / rows.length) : 0;
    const items = [
      { label: 'Drainage Capacity', value: avg('drain'), tone: 'critical', note: 'Assesses ward-level drain carrying efficiency under the active flood-risk context.' },
      { label: 'Pump Availability', value: avg('pump'), tone: 'high', note: 'Reflects current pumping readiness and field equipment availability across mapped wards.' },
      { label: 'Road Drainage Condition', value: avg('road'), tone: 'medium', note: 'Indicates expected road-network drainage performance during surface runoff conditions.' },
      { label: 'Emergency Response Capacity', value: avg('response'), tone: 'high', note: 'Measures operational response strength for rapid intervention and crew deployment.' },
      { label: 'Citizen Preparedness Index', value: avg('prep'), tone: 'prepared', note: 'Represents public-facing readiness, local awareness, and preventive preparedness posture.' },
    ];
    const el = document.getElementById('wardDimensions');
    if (!el) return;
    el.innerHTML = items.map((item) => `
      <div class="ward-dim-row">
        <div class="ward-dim-value">${item.value}%</div>
        <div class="ward-dim-body">
          <div class="ward-dim-label">${esc(item.label)}</div>
          <div class="ward-dim-note">${esc(item.note)}</div>
          <div class="ward-dim-track"><div class="ward-dim-fill ward-dim-${item.tone}" style="width:${item.value}%"></div></div>
        </div>
      </div>`).join('');
  }

  function renderWorst() {
    const rows = enrichedRows().slice(0, 5);
    const el = document.getElementById('wardWorstList');
    if (!el) return;
    el.innerHTML = rows.map((row) => `
      <div class="ward-worst-item ward-worst-${row.readiness < 40 ? 'critical' : 'high'}">
        <div>
          <div class="ward-worst-name">${esc(row.name)}</div>
          <div class="ward-worst-sub">${esc(row.dist)} · ${row.hotspots} hotspots · ${row.critical_hotspots} critical · ${esc(priorityAction(row))}</div>
        </div>
        <div class="ward-worst-score">${row.readiness}<span>/100</span></div>
      </div>`).join('');
  }

  function renderConditions() {
    const cache = DFIS.live?._cache || {};
    const rain = cache.modelRainfall?.current_mm_hr ?? cache.rainfall?.currentMmHr ?? 0;
    const water = cache.modelYamuna?.current_level_m ?? cache.yamuna?.level ?? '—';
    const waterStatus = cache.modelYamuna?.status ?? cache.yamuna?.status ?? '—';
    const soil = cache.soil?.pct ?? '—';
    const pred = cache.prediction ? `${Math.round((cache.prediction.flood_probability || 0) * 100)}%` : '—';
    const el = document.getElementById('wardLiveConditions');
    if (!el) return;
    el.innerHTML = `
      <span class="ward-live-pill">Live Conditions</span>
      <span>Rainfall: ${esc(rain)}mm/hr</span>
      <span>Yamuna: ${esc(water)}m [${esc(waterStatus)}]</span>
      <span>Soil: ${esc(soil)}%</span>
      <span>XGBoost Risk: ${esc(pred)}</span>
      <span class="ward-live-note">Readiness scores reflect current backend ward and hotspot data</span>`;
  }

  function populateDistricts() {
    const select = document.getElementById('wardDistrictSelect');
    if (!select) return;
    const prev = select.value || 'all';
    const districts = [...new Set(enrichedRows().map((row) => row.dist).filter(Boolean))].sort();
    select.innerHTML = '<option value="all">All Districts</option>' + districts.map((dist) => `<option value="${esc(dist)}">${esc(dist)}</option>`).join('');
    select.value = districts.includes(prev) || prev === 'all' ? prev : 'all';
  }

  function renderTable() {
    const rows = filteredRows();
    const tbody = document.getElementById('wardTableBody');
    if (!tbody) return;
    tbody.innerHTML = rows.map((row) => `
      <tr>
        <td class="ward-name-cell">${esc(row.name)}</td>
        <td>${esc(row.dist)}</td>
        <td class="ward-mono">${row.hotspots}</td>
        <td class="ward-mono">${row.critical_hotspots}</td>
        <td><span class="rpill ${riskPillClass(row.readiness < 40 ? 'critical' : row.readiness < 70 ? 'high' : 'low')}">${esc(row.readiness < 40 ? 'critical' : row.readiness < 70 ? 'high' : 'prepared')}</span></td>
        <td>${componentBar(row.drain, 'medium')}</td>
        <td>${componentBar(row.pump, 'critical')}</td>
        <td>${componentBar(row.road, 'medium')}</td>
        <td>${componentBar(row.response, 'critical')}</td>
        <td>
          <div class="ward-mini ward-score">
            <div class="ward-mini-track"><div class="ward-mini-fill ward-mini-medium" style="width:${row.readiness}%"></div></div>
            <span>${row.readiness}/100</span>
          </div>
        </td>
        <td class="ward-action-cell">${esc(priorityAction(row))}</td>
      </tr>`).join('');
    const meta = document.getElementById('wardTableMeta');
    if (meta) meta.textContent = `Showing ${rows.length} of ${enrichedRows().length} wards · ${hotspots().length} hotspots`;
  }

  function setFilter(filter) {
    document.querySelectorAll('.ward-filter-chip').forEach((chip) => {
      chip.classList.toggle('active', chip.dataset.filter === filter);
    });
    renderTable();
  }

  function bind() {
    const search = document.getElementById('wardSearch');
    const district = document.getElementById('wardDistrictSelect');
    [search, district].forEach((el) => {
      if (!el || el.dataset.bound === '1') return;
      el.addEventListener(el.tagName === 'INPUT' ? 'input' : 'change', renderTable);
      el.dataset.bound = '1';
    });
    document.querySelectorAll('.ward-filter-chip').forEach((chip) => {
      if (chip.dataset.bound === '1') return;
      chip.addEventListener('click', () => setFilter(chip.dataset.filter || 'all'));
      chip.dataset.bound = '1';
    });
  }

  function renderAll() {
    renderHero();
    renderDimensions();
    renderWorst();
    renderConditions();
    populateDistricts();
    bind();
    renderTable();
  }

  DFIS.pages = DFIS.pages || {};
  DFIS.pages.wards = `
    <div class="ward-shell">
      <div class="pg-header ward-hero">
        <div>
          <div class="pg-eyebrow" id="wardHeroEyebrow">Active City · Wards · Readiness</div>
          <div class="pg-title">Ward-Level Pre-Monsoon Readiness Score</div>
          <div class="pg-desc" id="wardHeroDesc">Loading API/model readiness rows...</div>
        </div>
        <div class="ward-hero-badges">
          <div class="badge b-danger" id="wardBadgeCritical">0 Critical</div>
          <div class="badge b-info" id="wardBadgeHigh">0 High</div>
          <div class="badge b-warn" id="wardBadgeMedium">0 Medium</div>
          <div class="badge b-safe" id="wardBadgePrepared">0 Prepared</div>
          <div class="badge b-accent" id="wardBadgeCoverage">0 Hotspots · 0 Wards</div>
        </div>
      </div>

      <div class="ward-metrics">
        <div class="ward-stat ward-stat-critical">
          <div class="ward-stat-icon">⛑</div>
          <div class="ward-stat-label">Critical Wards</div>
          <div class="ward-stat-value" id="wardCardCritical">0</div>
          <div class="ward-stat-sub">Lowest readiness from live ward rows</div>
          <div class="ward-stat-meta" id="wardCriticalMeta">Awaiting /wards</div>
        </div>
        <div class="ward-stat ward-stat-high">
          <div class="ward-stat-icon">⚠</div>
          <div class="ward-stat-label">High Risk Wards</div>
          <div class="ward-stat-value" id="wardCardHigh">0</div>
          <div class="ward-stat-sub">Strained readiness and hotspot pressure</div>
          <div class="ward-stat-meta" id="wardHighMeta">Awaiting /wards</div>
        </div>
        <div class="ward-stat ward-stat-medium">
          <div class="ward-stat-icon">📋</div>
          <div class="ward-stat-label">Medium Wards</div>
          <div class="ward-stat-value" id="wardCardMedium">0</div>
          <div class="ward-stat-sub">Monitor and inspect drainage</div>
          <div class="ward-stat-meta" id="wardMediumMeta">Awaiting /wards</div>
        </div>
        <div class="ward-stat ward-stat-prepared">
          <div class="ward-stat-icon">☑</div>
          <div class="ward-stat-label">Prepared Wards</div>
          <div class="ward-stat-value" id="wardCardPrepared">0</div>
          <div class="ward-stat-sub">Higher readiness under live backend data</div>
          <div class="ward-stat-meta" id="wardPreparedMeta">Awaiting /wards</div>
        </div>
        <div class="ward-stat ward-stat-coverage">
          <div class="ward-stat-icon">📍</div>
          <div class="ward-stat-label">Hotspots Covered</div>
          <div class="ward-stat-value" id="wardCardCoverage">0</div>
          <div class="ward-stat-sub">All live hotspots assigned to ward context</div>
          <div class="ward-stat-meta" id="wardCoverageMeta">Awaiting /hotspots</div>
        </div>
      </div>

      <div class="ward-grid">
        <div class="card ward-panel">
          <div class="card-head">
            <div class="card-htitle">Readiness Score — 5 Dimensions</div>
            <div class="badge b-info">API Components</div>
          </div>
          <div class="card-body" id="wardDimensions"></div>
        </div>
        <div class="card ward-panel">
          <div class="card-head">
            <div class="card-htitle">Worst 5 Wards — Immediate Action</div>
            <div class="badge b-danger">Emergency Priority</div>
          </div>
          <div class="card-body ward-worst-list" id="wardWorstList"></div>
        </div>
      </div>

      <div class="ward-live-strip" id="wardLiveConditions"></div>

      <div class="ward-toolbar">
        <div class="ward-search">
          <span>⌕</span>
          <input id="wardSearch" type="text" placeholder="Search ward name or district..." />
        </div>
        <select id="wardDistrictSelect" class="ward-select">
          <option value="all">All Districts</option>
        </select>
        <div class="ward-table-meta" id="wardTableMeta">Showing 0 of 0 wards</div>
      </div>

      <div class="card ward-panel">
        <div class="card-head">
          <div class="card-htitle">All Wards — Readiness Dashboard</div>
          <div class="ward-filter-row">
            <button class="chip ward-filter-chip active" data-filter="all" type="button">All</button>
            <button class="chip ward-filter-chip" data-filter="critical" type="button">Critical</button>
            <button class="chip ward-filter-chip" data-filter="medium" type="button">Medium</button>
            <button class="chip ward-filter-chip" data-filter="prepared" type="button">Prepared</button>
          </div>
        </div>
        <div class="ward-table-wrap">
          <table class="dtable ward-table">
            <thead>
              <tr>
                <th>Ward</th>
                <th>District</th>
                <th>Hotspots</th>
                <th>Critical</th>
                <th>Flood Risk</th>
                <th>Drainage %</th>
                <th>Pumps %</th>
                <th>Roads %</th>
                <th>Response %</th>
                <th>Readiness Score</th>
                <th>Priority Action</th>
              </tr>
            </thead>
            <tbody id="wardTableBody"></tbody>
          </table>
        </div>
      </div>
    </div>`;

  DFIS.wards = DFIS.wards || {};
  DFIS.wards.render = renderAll;
  DFIS.wards.setFilter = setFilter;

  if (DFIS.app?.pageHooks) {
    DFIS.app.pageHooks.wards = renderAll;
  }
  if (DFIS.app?._liveRefreshHooks) {
    DFIS.app._liveRefreshHooks.wards = renderAll;
  }
})();
