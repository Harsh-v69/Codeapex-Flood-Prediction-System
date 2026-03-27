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
    return DFIS.live?.getCurrentCityConfig?.() || { label: 'Delhi', fullName: 'Delhi NCT', riverLabel: 'Yamuna', waterBodyLabel: 'Yamuna River' };
  }

  function yamunaData() {
    return DFIS.YAMUNA || {};
  }

  function cache() {
    return DFIS.live?._cache || {};
  }

  function fmtLevel(value) {
    return typeof value === 'number' ? `${value.toFixed(2)}m` : '—';
  }

  function fmtDischarge(value) {
    if (typeof value !== 'number') return '—';
    if (value >= 1000) return `${(value / 1000).toFixed(1)}K m³/s`;
    return `${Math.round(value)} m³/s`;
  }

  function statusTone(status) {
    const text = String(status || '').toUpperCase();
    if (text === 'DANGER') return 'critical';
    if (text === 'WARNING') return 'warn';
    return 'safe';
  }

  function buildSeries() {
    const y = yamunaData();
    const current = typeof y.currentLevel === 'number' ? y.currentLevel : 0;
    const peak = typeof y.forecastPeakLevel === 'number' ? y.forecastPeakLevel : current;
    const delta = peak - current;
    const points = [];
    for (let i = 0; i < 8; i += 1) {
      const ratio = i / 7;
      const shaped = ratio < 0.5 ? ratio * 0.7 : 0.35 + (ratio - 0.5) * 1.3;
      points.push(+(current + delta * shaped).toFixed(2));
    }
    return points;
  }

  function renderHero() {
    const cfg = city();
    const y = yamunaData();
    const c = cache();
    const eyebrow = document.getElementById('yamunaHeroEyebrow');
    const desc = document.getElementById('yamunaHeroDesc');
    if (eyebrow) eyebrow.textContent = `${cfg.label.toUpperCase()} · ${cfg.riverLabel.toUpperCase()} RIVER MONITORING`;
    if (desc) {
      const source = c.modelYamuna?.source || 'Live flood API + model context';
      desc.textContent = `Calculated water-level monitoring from backend API/model · Forecast window ${esc(c.modelYamuna?.forecast_start || c.yamuna?.trend || 'live')} · ${esc(source)}`;
    }
    const set = (id, value) => {
      const el = document.getElementById(id);
      if (el) el.textContent = value;
    };
    set('yamunaCurrentLevel', fmtLevel(y.currentLevel));
    set('yamunaCurrentMeta', `${cfg.riverLabel} gauge`);
    set('yamunaCurrentDelta', y.levelChange > 0 ? `↑ ${y.levelChange.toFixed(2)}m` : y.levelChange < 0 ? `↓ ${Math.abs(y.levelChange).toFixed(2)}m` : 'Stable');
    set('yamunaDangerLevel', fmtLevel(y.dangerLevel));
    set('yamunaDangerMeta', y.currentLevel != null && y.dangerLevel != null ? `ETA breach: ${(y.currentLevel >= y.dangerLevel) ? 'breached' : 'stable · not rising'}` : 'Model threshold');
    set('yamunaWarningLevel', fmtLevel(y.warningLevel));
    set('yamunaWarningMeta', (typeof y.warningLevel === 'number' && typeof y.currentLevel === 'number') ? `${(y.warningLevel - y.currentLevel).toFixed(2)}m ${y.currentLevel < y.warningLevel ? 'below warning level' : 'above warning level'}` : 'Model threshold');
    set('yamunaDischarge', fmtDischarge(y.dischargeRate));
    set('yamunaDischargeMeta', y.source || 'Backend source');
    set('yamunaStatus', String(y.status || 'UNKNOWN').toUpperCase());
    set('yamunaStatusMeta', y.pctToDanger != null ? `${y.pctToDanger}% of danger threshold` : 'Awaiting backend threshold');
  }

  function renderTrend() {
    const el = document.getElementById('yamunaTrendChart');
    if (!el) return;
    const y = yamunaData();
    const points = buildSeries();
    const min = Math.min(...points, y.warningLevel || points[0], y.dangerLevel || points[0]);
    const max = Math.max(...points, y.warningLevel || points[0], y.dangerLevel || points[0]);
    const span = Math.max(max - min, 0.5);
    el.innerHTML = points.map((point, idx) => {
      const h = ((point - min) / span) * 100;
      return `<div class="yamuna-proj-col">
        <div class="yamuna-proj-bar ${idx === points.length - 1 ? 'is-peak' : ''}" style="height:${Math.max(h, 4)}%"></div>
        <span>${idx * 4}h</span>
      </div>`;
    }).join('') +
    `<div class="yamuna-threshold yamuna-threshold-warning" style="bottom:${((y.warningLevel - min) / span) * 100}%">Warning ${fmtLevel(y.warningLevel)}</div>` +
    `<div class="yamuna-threshold yamuna-threshold-danger" style="bottom:${((y.dangerLevel - min) / span) * 100}%">Danger ${fmtLevel(y.dangerLevel)}</div>`;
  }

  function renderComputed() {
    const el = document.getElementById('yamunaComputedList');
    if (!el) return;
    const y = yamunaData();
    const c = cache();
    const rows = [
      ['Current level', fmtLevel(y.currentLevel)],
      ['Forecast peak (24h)', fmtLevel(y.forecastPeakLevel)],
      ['Warning threshold', fmtLevel(y.warningLevel)],
      ['Danger threshold', fmtLevel(y.dangerLevel)],
      ['Discharge', fmtDischarge(y.dischargeRate)],
      ['Flood risk', c.prediction ? `${Math.round((c.prediction.flood_probability || 0) * 100)}% · ${c.prediction.risk_level}` : '—'],
    ];
    el.innerHTML = rows.map(([label, value]) => `<div class="yamuna-metric-row"><span>${esc(label)}</span><strong>${esc(value)}</strong></div>`).join('');
  }

  function renderStations() {
    const el = document.getElementById('yamunaStations');
    if (!el) return;
    const stations = Array.isArray(yamunaData().gaugeStations) ? yamunaData().gaugeStations : [];
    if (!stations.length) {
      el.innerHTML = '<div class="yamuna-empty">No gauge data returned by /yamuna yet.</div>';
      return;
    }
    el.innerHTML = stations.map((station) => `
      <div class="yamuna-station-card">
        <div class="yamuna-station-name">${esc(station.name)}</div>
        <div class="yamuna-station-level">${fmtLevel(station.current)}</div>
        <div class="yamuna-station-meta">Forecast ${fmtLevel(station.forecast)} · Danger ${fmtLevel(station.danger)}</div>
        <div class="yamuna-station-pill tone-${statusTone(station.status)}">${esc(station.status)}</div>
      </div>`).join('');
  }

  function renderImpact() {
    const el = document.getElementById('yamunaImpact');
    if (!el) return;
    const y = yamunaData();
    const cards = [
      {
        title: 'Status',
        body: String(y.status || 'UNKNOWN').toUpperCase(),
        tone: statusTone(y.status),
      },
      {
        title: 'Distance to warning',
        body: (typeof y.warningLevel === 'number' && typeof y.currentLevel === 'number') ? `${(y.warningLevel - y.currentLevel).toFixed(2)}m` : '—',
        tone: 'warn',
      },
      {
        title: 'Distance to danger',
        body: (typeof y.dangerLevel === 'number' && typeof y.currentLevel === 'number') ? `${(y.dangerLevel - y.currentLevel).toFixed(2)}m` : '—',
        tone: 'critical',
      },
      {
        title: 'Model source',
        body: yamunaData().source || 'Backend data',
        tone: 'info',
      },
    ];
    el.innerHTML = cards.map((card) => `
      <div class="yamuna-impact-card tone-${card.tone}">
        <span>${esc(card.title)}</span>
        <strong>${esc(card.body)}</strong>
      </div>`).join('');
  }

  function renderAll() {
    renderHero();
    renderTrend();
    renderComputed();
    renderStations();
    renderImpact();
  }

  DFIS.pages = DFIS.pages || {};
  DFIS.pages.yamuna = `
    <div class="yamuna-shell">
      <div class="pg-header yamuna-hero">
        <div>
          <div class="pg-eyebrow" id="yamunaHeroEyebrow">River Monitoring</div>
          <div class="pg-title">Water Level Intelligence</div>
          <div class="pg-desc" id="yamunaHeroDesc">Loading calculated water-level context from the backend...</div>
        </div>
      </div>

      <div class="yamuna-metrics">
        <div class="yamuna-stat tone-safe">
          <div class="yamuna-stat-label">Current Level · Live</div>
          <div class="yamuna-stat-value" id="yamunaCurrentLevel">—</div>
          <div class="yamuna-stat-sub" id="yamunaCurrentMeta">Gauge</div>
          <div class="yamuna-stat-meta" id="yamunaCurrentDelta">—</div>
        </div>
        <div class="yamuna-stat tone-critical">
          <div class="yamuna-stat-label">Danger Level</div>
          <div class="yamuna-stat-value" id="yamunaDangerLevel">—</div>
          <div class="yamuna-stat-sub">Model threshold</div>
          <div class="yamuna-stat-meta" id="yamunaDangerMeta">—</div>
        </div>
        <div class="yamuna-stat tone-warn">
          <div class="yamuna-stat-label">Warning Level</div>
          <div class="yamuna-stat-value" id="yamunaWarningLevel">—</div>
          <div class="yamuna-stat-sub">Model threshold</div>
          <div class="yamuna-stat-meta" id="yamunaWarningMeta">—</div>
        </div>
        <div class="yamuna-stat tone-safe">
          <div class="yamuna-stat-label">Discharge Rate · Live</div>
          <div class="yamuna-stat-value" id="yamunaDischarge">—</div>
          <div class="yamuna-stat-sub" id="yamunaDischargeMeta">Backend source</div>
          <div class="yamuna-stat-meta">Calculated from /yamuna</div>
        </div>
        <div class="yamuna-stat tone-info">
          <div class="yamuna-stat-label">Yamuna Status · Live</div>
          <div class="yamuna-stat-value status-text" id="yamunaStatus">—</div>
          <div class="yamuna-stat-sub" id="yamunaStatusMeta">—</div>
          <div class="yamuna-stat-meta">No frontend hardcoded gauge values</div>
        </div>
      </div>

      <div class="yamuna-grid">
        <div class="card yamuna-panel">
          <div class="card-head">
            <div class="card-htitle">Calculated 24h Level Progression</div>
            <div class="badge b-info">From current + forecast peak</div>
          </div>
          <div class="card-body">
            <div id="yamunaTrendChart" class="yamuna-trend-chart"></div>
          </div>
        </div>
        <div class="card yamuna-panel">
          <div class="card-head">
            <div class="card-htitle">Computed Water Metrics</div>
            <div class="badge b-accent">API / Model</div>
          </div>
          <div class="card-body" id="yamunaComputedList"></div>
        </div>
      </div>

      <div class="yamuna-grid">
        <div class="card yamuna-panel">
          <div class="card-head">
            <div class="card-htitle">Gauge Stations Returned by Backend</div>
          </div>
          <div class="card-body yamuna-station-grid" id="yamunaStations"></div>
        </div>
        <div class="card yamuna-panel">
          <div class="card-head">
            <div class="card-htitle">Flood Stage Impact</div>
          </div>
          <div class="card-body yamuna-impact-grid" id="yamunaImpact"></div>
        </div>
      </div>
    </div>`;

  if (DFIS.app?.pageHooks) {
    DFIS.app.pageHooks.yamuna = renderAll;
  }
  if (DFIS.app?._liveRefreshHooks) {
    DFIS.app._liveRefreshHooks.yamuna = renderAll;
  }
})();
