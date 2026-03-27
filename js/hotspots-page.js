'use strict';

window.DFIS = window.DFIS || {};

(function () {
  const riskOrder = { critical: 4, high: 3, medium: 2, low: 1 };
  const riskColors = {
    critical: 'var(--danger)',
    high: 'var(--accent)',
    medium: 'var(--warn)',
    low: 'var(--safe)',
  };

  function escapeHtml(value) {
    return String(value ?? '')
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#39;');
  }

  function titleCase(value) {
    const text = String(value || '').trim().toLowerCase();
    if (!text) return 'Unknown';
    return text.charAt(0).toUpperCase() + text.slice(1);
  }

  function cityConfig() {
    return DFIS.live?.getCurrentCityConfig?.() || {
      label: 'Delhi',
      fullName: 'Delhi NCT',
      areaKm2: DFIS.CITY?.area_km2 || 1484,
      districts: DFIS.CITY?.districts || 0,
    };
  }

  function hotspots() {
    return Array.isArray(DFIS.HOTSPOTS) ? DFIS.HOTSPOTS.slice() : [];
  }

  function summaryCounts() {
    const rows = hotspots();
    const critical = rows.filter((row) => row.risk === 'critical').length;
    const high = rows.filter((row) => row.risk === 'high').length;
    const medium = rows.filter((row) => row.risk === 'medium').length;
    const low = rows.filter((row) => row.risk === 'low').length;
    return {
      total: rows.length,
      critical,
      high,
      medium,
      low,
      districts: new Set(rows.map((row) => row.dist || 'Unknown')).size,
    };
  }

  function districtRows() {
    const rows = Array.isArray(DFIS.DISTRICTS) ? DFIS.DISTRICTS.slice() : [];
    if (rows.length) return rows;

    const grouped = {};
    hotspots().forEach((row) => {
      const key = row.dist || 'Unknown';
      if (!grouped[key]) grouped[key] = { name: key, total: 0, critical: 0 };
      grouped[key].total += 1;
      if (row.risk === 'critical') grouped[key].critical += 1;
    });
    return Object.values(grouped).sort((a, b) => b.total - a.total);
  }

  function currentFilters() {
    const district = document.getElementById('hotspotDistrictFilter')?.value || 'all';
    const risk = document.getElementById('hotspotRiskFilter')?.value || 'all';
    const query = (document.getElementById('hotspotSearch')?.value || '').trim().toLowerCase();
    return { district, risk, query };
  }

  function filteredHotspots() {
    const { district, risk, query } = currentFilters();
    return hotspots()
      .filter((row) => district === 'all' || (row.dist || 'Unknown') === district)
      .filter((row) => risk === 'all' || row.risk === risk)
      .filter((row) => {
        if (!query) return true;
        const haystack = [
          row.id,
          row.loc,
          row.dist,
          row.cause,
          row.action,
          row.drain,
        ].join(' ').toLowerCase();
        return haystack.includes(query);
      })
      .sort((a, b) => {
        const riskGap = (riskOrder[b.risk] || 0) - (riskOrder[a.risk] || 0);
        if (riskGap) return riskGap;
        return (b.score || 0) - (a.score || 0);
      });
  }

  function primaryCause(row) {
    return row.cause || '—';
  }

  function drainBadge(row) {
    const cap = typeof row.drain_capacity_pct === 'number' ? row.drain_capacity_pct : null;
    if (cap == null) return { label: '—', cls: 'b-muted' };
    if (cap < 50) return { label: `${cap}% cap`, cls: 'b-danger' };
    if (cap < 75) return { label: `${cap}% cap`, cls: 'b-warn' };
    return { label: `${cap}% cap`, cls: 'b-muted' };
  }

  function xgboostBadge(row) {
    return `<span class="hotspot-live-pill hotspot-live-${escapeHtml(row.risk || 'low')}">AI ${escapeHtml(titleCase(row.risk || 'low'))}</span>`;
  }

  function riskPill(row) {
    const cls = DFIS.utils?.riskClass ? DFIS.utils.riskClass(row.risk) : `rp-${row.risk || 'low'}`;
    return `<span class="rpill ${escapeHtml(cls)}">${escapeHtml(row.risk || 'low')}</span>`;
  }

  function recommendedAction(row) {
    return row.action || '—';
  }

  function populateDistrictFilter() {
    const select = document.getElementById('hotspotDistrictFilter');
    if (!select) return;
    const previous = select.value || 'all';
    const options = districtRows().map((row) => row.name).filter(Boolean);
    select.innerHTML = '<option value="all">All Districts</option>' +
      options.map((name) => `<option value="${escapeHtml(name)}">${escapeHtml(name)}</option>`).join('');
    select.value = options.includes(previous) || previous === 'all' ? previous : 'all';
  }

  function updateHero() {
    const city = cityConfig();
    const counts = summaryCounts();
    const desc = document.getElementById('hotspotHeroDesc');
    const distributionBadge = document.getElementById('hotspotDistributionBadge');
    if (desc) {
      desc.textContent = `${counts.total} API-scored hotspots across ${Math.max(counts.districts, city.districts || 0)} districts · Live model predictions · ${city.fullName} · ${city.areaKm2} km²`;
    }
    if (distributionBadge) {
      distributionBadge.textContent = `${counts.total} Hotspots · Real Counts`;
    }
    const setText = (id, value) => {
      const el = document.getElementById(id);
      if (el) el.textContent = value;
    };
    setText('hotspotBadgeCritical', `${counts.critical} Critical`);
    setText('hotspotBadgeHigh', `${counts.high} High`);
    setText('hotspotBadgeMedium', `${counts.medium} Medium`);
    setText('hotspotBadgeLow', `${counts.low} Low`);
    setText('hotspotCriticalCount', counts.critical);
    setText('hotspotHighCount', counts.high);
    setText('hotspotMediumCount', counts.medium);
    setText('hotspotLowCount', counts.low);
    setText('hotspotDistrictCount', Math.max(counts.districts, city.districts || 0));
    setText('hotspotCriticalSub', `of ${counts.total} model-scored cells`);
    setText('hotspotHighSub', `of ${counts.total} model-scored cells`);
    setText('hotspotMediumSub', `monitor closely across active districts`);
    setText('hotspotLowSub', `routine checks across live backend feed`);
    setText('hotspotDistrictSub', `${city.fullName} · ${city.areaKm2} km²`);
    setText('hotspotModelSub', `${counts.total} live rows from /hotspots`);
    setText('hotspotCriticalMeta', districtRows().slice(0, 3).map((row) => row.name).join(' · ') || 'No hotspot districts yet');
    setText('hotspotHighMeta', districtRows().slice(0, 3).map((row) => row.name).join(' · ') || 'No hotspot districts yet');
    setText('hotspotMediumMeta', districtRows().slice(3, 6).map((row) => row.name).join(' · ') || 'Watching secondary districts');
    setText('hotspotLowMeta', districtRows().slice(-3).map((row) => row.name).join(' · ') || 'Low-risk districts');
    setText('hotspotDistrictMeta', 'All zones monitored from backend feed');
    setText('hotspotModelMeta', `Scoring all ${counts.total} live hotspots`);
  }

  function renderDistrictBars(containerId) {
    const el = document.getElementById(containerId);
    if (!el) return;
    const rows = districtRows();
    const maxTotal = Math.max(...rows.map((row) => row.total || 0), 1);
    el.innerHTML = rows.map((row) => {
      const critical = Number(row.critical || 0);
      const total = Number(row.total || 0);
      const criticalPct = total ? (critical / total) * 100 : 0;
      const totalPct = (total / maxTotal) * 100;
      const tone = critical >= 10 ? 'critical' : critical >= 3 ? 'high' : critical >= 1 ? 'medium' : 'low';
      return `
        <div class="hotspot-district-row">
          <div class="hotspot-district-head">
            <span>${escapeHtml(row.name)}</span>
            <span style="color:${riskColors[tone]}">${critical} critical / ${total}</span>
          </div>
          <div class="hotspot-district-track">
            <div class="hotspot-district-fill hotspot-district-fill-${tone}" style="width:${criticalPct}%"></div>
            <div class="hotspot-district-tail" style="width:${Math.max(totalPct - criticalPct, 0)}%"></div>
          </div>
        </div>`;
    }).join('');
  }

  function renderTable(tbodyId) {
    const tbody = document.getElementById(tbodyId);
    if (!tbody) return;
    const city = cityConfig();
    const rows = filteredHotspots();
    tbody.innerHTML = rows.map((row) => {
      const drain = drainBadge(row);
      const scoreColor = riskColors[row.risk] || 'var(--text)';
      return `
        <tr class="hotspot-row" data-location="${escapeHtml(row.loc)}">
          <td class="hotspot-zone-id">${escapeHtml(row.id)}</td>
          <td class="hotspot-location-cell">
            <div class="hotspot-location-name">${escapeHtml(row.loc)}</div>
          </td>
          <td>${escapeHtml(row.dist || city.label)}</td>
          <td><span class="hotspot-score" style="color:${scoreColor}">${escapeHtml(row.score)}/100</span></td>
          <td>${riskPill(row)}</td>
          <td>${xgboostBadge(row)}</td>
          <td class="hotspot-cause-cell">${escapeHtml(primaryCause(row))}</td>
          <td class="hotspot-elev">${escapeHtml(Number(row.elev || 0).toFixed(1))}m</td>
          <td><span class="badge ${escapeHtml(drain.cls)}">${escapeHtml(drain.label)}</span></td>
          <td class="hotspot-action-cell">${escapeHtml(recommendedAction(row))}</td>
        </tr>`;
    }).join('');

    tbody.querySelectorAll('tr.hotspot-row').forEach((tr, index) => {
      tr.addEventListener('click', () => {
        const row = rows[index];
        if (!row) return;
        DFIS.app?.openRouteForLocation?.(row.loc, {
          severity: row.risk === 'critical' ? 'severe' : row.risk === 'high' ? 'high' : 'moderate',
          source: 'hotspot-table',
        });
      });
    });

    const meta = document.getElementById('hotspotTableMeta');
    if (meta) meta.textContent = `Showing ${rows.length} of ${hotspots().length}`;
  }

  function attachFilters() {
    const search = document.getElementById('hotspotSearch');
    const district = document.getElementById('hotspotDistrictFilter');
    const risk = document.getElementById('hotspotRiskFilter');
    [search, district, risk].forEach((el) => {
      if (!el || el.dataset.bound === '1') return;
      const eventName = el.tagName === 'INPUT' ? 'input' : 'change';
      el.addEventListener(eventName, () => renderTable('hotspotTbody'));
      el.dataset.bound = '1';
    });
  }

  function renderAll() {
    updateHero();
    populateDistrictFilter();
    attachFilters();
    renderDistrictBars('districtBars');
    renderTable('hotspotTbody');
  }

  DFIS.pages = DFIS.pages || {};
  DFIS.pages.hotspots = `
    <div class="hotspot-shell">
      <div class="pg-header hotspot-hero">
        <div>
          <div class="pg-eyebrow">Active City · GIS Analysis · Live Scoring</div>
          <div class="pg-title">Flood Micro-Hotspot Detection</div>
          <div class="pg-desc" id="hotspotHeroDesc">Loading model-scored hotspot coverage from the active backend...</div>
        </div>
        <div class="hotspot-hero-badges">
          <div class="badge b-danger" id="hotspotBadgeCritical">0 Critical</div>
          <div class="badge b-info" id="hotspotBadgeHigh">0 High</div>
          <div class="badge b-warn" id="hotspotBadgeMedium">0 Medium</div>
          <div class="badge b-safe" id="hotspotBadgeLow">0 Low</div>
        </div>
      </div>
      <div class="hotspot-metrics">
        <div class="hotspot-stat hotspot-stat-critical">
          <div class="hotspot-stat-icon"></div>
          <div class="hotspot-stat-label">Critical Zones</div>
          <div class="hotspot-stat-value" id="hotspotCriticalCount">0</div>
          <div class="hotspot-stat-sub" id="hotspotCriticalSub">Loading live hotspot counts</div>
          <div class="hotspot-stat-meta" id="hotspotCriticalMeta">Awaiting /hotspots</div>
        </div>
        <div class="hotspot-stat hotspot-stat-high">
          <div class="hotspot-stat-icon"></div>
          <div class="hotspot-stat-label">High Risk Zones</div>
          <div class="hotspot-stat-value" id="hotspotHighCount">0</div>
          <div class="hotspot-stat-sub" id="hotspotHighSub">Loading live hotspot counts</div>
          <div class="hotspot-stat-meta" id="hotspotHighMeta">Awaiting /hotspots</div>
        </div>
        <div class="hotspot-stat hotspot-stat-medium">
          <div class="hotspot-stat-icon"></div>
          <div class="hotspot-stat-label">Medium Risk Zones</div>
          <div class="hotspot-stat-value" id="hotspotMediumCount">0</div>
          <div class="hotspot-stat-sub" id="hotspotMediumSub">Loading live hotspot counts</div>
          <div class="hotspot-stat-meta" id="hotspotMediumMeta">Awaiting /hotspots</div>
        </div>
        <div class="hotspot-stat hotspot-stat-low">
          <div class="hotspot-stat-icon"></div>
          <div class="hotspot-stat-label">Low Risk Zones</div>
          <div class="hotspot-stat-value" id="hotspotLowCount">0</div>
          <div class="hotspot-stat-sub" id="hotspotLowSub">Loading live hotspot counts</div>
          <div class="hotspot-stat-meta" id="hotspotLowMeta">Awaiting /hotspots</div>
        </div>
        <div class="hotspot-stat hotspot-stat-info">
          <div class="hotspot-stat-icon hotspot-pin-icon"></div>
          <div class="hotspot-stat-label">Districts Covered</div>
          <div class="hotspot-stat-value" id="hotspotDistrictCount">0</div>
          <div class="hotspot-stat-sub" id="hotspotDistrictSub">Loading coverage</div>
          <div class="hotspot-stat-meta" id="hotspotDistrictMeta">Awaiting /hotspots</div>
        </div>
        <div class="hotspot-stat hotspot-stat-model">
          <div class="hotspot-stat-icon hotspot-model-icon">AI</div>
          <div class="hotspot-stat-label">AI Model · Live</div>
          <div class="hotspot-stat-value hotspot-model-name">XGBoost</div>
          <div class="hotspot-stat-sub" id="hotspotModelSub">Loading rows from backend</div>
          <div class="hotspot-stat-meta" id="hotspotModelMeta">Scoring live</div>
        </div>
      </div>
      <div class="card hotspot-panel">
        <div class="card-head">
          <div class="card-htitle">Hotspot Distribution by District</div>
          <div class="badge b-accent" id="hotspotDistributionBadge">0 Hotspots · Real Counts</div>
        </div>
        <div class="card-body hotspot-distribution-body">
          <div id="districtBars" class="hotspot-district-bars"></div>
        </div>
      </div>
      <div class="hotspot-toolbar">
        <div class="hotspot-search">
          <span class="hotspot-search-icon">⌕</span>
          <input id="hotspotSearch" type="text" placeholder="Search location, district, cause ..." />
        </div>
        <select id="hotspotDistrictFilter" class="hotspot-select">
          <option value="all">All Districts</option>
        </select>
        <select id="hotspotRiskFilter" class="hotspot-select">
          <option value="all">All Risk Levels</option>
          <option value="critical">Critical</option>
          <option value="high">High</option>
          <option value="medium">Medium</option>
          <option value="low">Low</option>
        </select>
        <div class="hotspot-toolbar-meta" id="hotspotTableMeta">Showing 0 of 0</div>
      </div>
      <div class="card hotspot-panel">
        <div class="card-head">
          <div class="card-htitle">Top Critical Micro-Hotspots</div>
          <div class="hotspot-table-head-badges">
            <div class="badge b-danger">Immediate Action Required</div>
            <div class="badge b-info">Sort: Score</div>
            <div class="badge b-muted">Live District View</div>
          </div>
        </div>
        <div class="hotspot-table-wrap">
          <table class="dtable hotspot-table">
            <thead>
              <tr>
                <th>Zone ID</th>
                <th>Location / Area</th>
                <th>District</th>
                <th>Risk Score</th>
                <th>Risk Level</th>
                <th>Live XGBoost</th>
                <th>Primary Cause</th>
                <th>Elevation (m)</th>
                <th>Drain Status</th>
                <th>Recommended Action</th>
              </tr>
            </thead>
            <tbody id="hotspotTbody"></tbody>
          </table>
        </div>
      </div>
    </div>`;

  DFIS.hotspotsPage = {
    init: renderAll,
    refresh: renderAll,
    renderDistrictBars,
    renderTable,
  };

  DFIS.charts = DFIS.charts || {};
  DFIS.charts.renderDistrictBars = renderDistrictBars;

  if (DFIS.app && DFIS.app.pageHooks) {
    DFIS.app.pageHooks.hotspots = function () {
      DFIS.hotspotsPage.init();
    };
  }
  if (DFIS.app && DFIS.app._liveRefreshHooks) {
    DFIS.app._liveRefreshHooks.hotspots = function () {
      DFIS.hotspotsPage.refresh();
    };
  }
})();
