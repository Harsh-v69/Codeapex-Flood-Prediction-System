/* ============================================================
   Dhristi
   js/pages.js - Generic page templates
   ============================================================ */
'use strict';
window.DFIS = window.DFIS || {};

DFIS.pages = {
  dashboard: `
    <div class="pg-header">
      <div>
        <div class="pg-eyebrow">Active City · Next 24-Hour Flood Outlook</div>
        <div class="pg-title">Flood Intelligence Dashboard</div>
        <div class="pg-desc">Monitoring next 24-hour hotspot forecasts, rainfall outlook, water level outlook, and readiness from the active city backend</div>
      </div>
      <div style="display:flex;gap:8px;flex-wrap:wrap;align-items:center">
        <div class="badge b-danger">🔴 0 Critical</div>
        <div class="badge b-warn">🟡 0 Elevated</div>
        <div class="badge b-safe">🟢 0 Prepared</div>
        <div style="font-family:var(--font-mono);font-size:10px;color:var(--muted);padding:4px 10px;background:var(--raised);border:1px solid var(--rim);border-radius:4px" id="liveDataStatus">⌛ Loading live data...</div>
      </div>
    </div>
    <div style="display:flex;gap:10px;margin-bottom:14px;flex-wrap:wrap">
      <div style="background:var(--surface);border:1px solid var(--rim);border-radius:6px;padding:7px 14px;font-family:var(--font-mono);font-size:11px;color:var(--muted);display:flex;align-items:center;gap:6px">🌡 <span id="live-temp">...</span></div>
      <div style="background:var(--surface);border:1px solid var(--rim);border-radius:6px;padding:7px 14px;font-family:var(--font-mono);font-size:11px;color:var(--muted);display:flex;align-items:center;gap:6px">💧 Humidity <span id="live-humidity">...</span></div>
      <div style="background:var(--surface);border:1px solid var(--rim);border-radius:6px;padding:7px 14px;font-family:var(--font-mono);font-size:11px;color:var(--muted);display:flex;align-items:center;gap:6px">🌬 Wind <span id="live-wind">...</span></div>
      <div style="background:var(--surface);border:1px solid rgba(249,115,22,0.3);border-radius:6px;padding:7px 14px;font-family:var(--font-mono);font-size:11px;color:var(--accent);display:flex;align-items:center;gap:6px;flex:1;min-width:200px">⚡ <span id="live-alert-strip">Fetching model alerts...</span></div>
    </div>
    <div class="stats-row">
      <div class="scard s-danger"><div class="scard-icon">🔴</div><div class="scard-label">Critical Hotspots</div><div class="scard-val">0</div><div class="scard-sub">Next 24h high-priority zones</div><div class="scard-delta delta-up">Waiting for forecast...</div></div>
      <div class="scard s-warn"><div class="scard-icon">🟡</div><div class="scard-label">Elevated Risk Zones</div><div class="scard-val">0</div><div class="scard-sub">Next 24h high and moderate watch zones</div><div class="scard-delta delta-up">Waiting for forecast...</div></div>
      <div class="scard s-safe"><div class="scard-icon">🟢</div><div class="scard-label">Low Risk Zones</div><div class="scard-val">0</div><div class="scard-sub">Next 24h lower-risk areas</div><div class="scard-delta delta-dn">Waiting for forecast...</div></div>
      <div class="scard s-yamuna"><div class="scard-icon">💧</div><div class="scard-label">Water Level <span style="font-size:8px;color:var(--info)">(LIVE)</span></div><div class="scard-val" id="live-yamuna-val">-</div><div class="scard-sub">Thresholds from active backend</div><div class="scard-delta delta-up" id="live-yamuna-trend">Loading...</div></div>
      <div class="scard s-info"><div class="scard-icon">🌧️</div><div class="scard-label">Rainfall Now <span style="font-size:8px;color:var(--info)">(LIVE)</span></div><div class="scard-val" id="live-rainfall-val">-</div><div class="scard-sub" id="live-rainfall-sub">Loading 24h outlook...</div><div class="scard-delta delta-up" id="live-rainfall-cat">Loading...</div></div>
      <div class="scard s-accent"><div class="scard-icon">🏙️</div><div class="scard-label">City Readiness <span style="font-size:8px;color:var(--info)">(LIVE)</span></div><div class="scard-val" id="live-readiness-val">-</div><div class="scard-sub">Calculated from backend readiness rows</div><div class="scard-delta delta-up">Loading...</div></div>
    </div>
    <div class="card dashboard-overview" aria-label="flood summary">
      <div class="card-body dashboard-overview-body">
        <div class="pg-header overview-topline">
          <div class="overview-heading">
            <div class="pg-eyebrow">Active City · Next 24-Hour Flood Outlook</div>
            <div class="pg-title">Flood Intelligence Dashboard</div>
            <div class="pg-desc">Key forecast, live weather, water level, and readiness for the selected city.</div>
          </div>
          <div class="overview-status">
            <div class="status-badge-row">
              <div class="badge b-danger">⛔ 0 Critical</div>
              <div class="badge b-warn">⚠ 0 Elevated</div>
              <div class="badge b-safe">✓ 0 Low Risk</div>
            </div>
            <div class="overview-status-note" id="dashboardLiveDataStatus">Loading live data...</div>
          </div>
        </div>
        <div class="overview-highlight">
          <div class="overview-highlight-label">Priority Summary</div>
          <div class="overview-highlight-value" id="dashboard24HourSummary">Loading summary...</div>
        </div>
        <div class="overview-meta-row">
          <div class="overview-chip">
            <span class="overview-chip-label">Temperature</span>
            <span class="overview-chip-value" id="dashboardLiveTemp">...</span>
          </div>
          <div class="overview-chip">
            <span class="overview-chip-label">Humidity</span>
            <span class="overview-chip-value" id="dashboardLiveHumidity">...</span>
          </div>
          <div class="overview-chip">
            <span class="overview-chip-label">Wind</span>
            <span class="overview-chip-value" id="dashboardLiveWind">...</span>
          </div>
          <div class="overview-chip overview-chip-alert">
            <span class="overview-chip-label">Priority Update</span>
            <span class="overview-chip-value" id="dashboardAlertStrip">Fetching alerts...</span>
          </div>
        </div>
        <div class="stats-row overview-kpis">
          <div class="scard s-danger"><div class="scard-icon">⛔</div><div class="scard-label">Critical Areas</div><div class="scard-val">0</div><div class="scard-sub">Priority action areas</div><div class="scard-delta delta-up">Waiting for forecast...</div></div>
          <div class="scard s-warn"><div class="scard-icon">⚠</div><div class="scard-label">Elevated Risk</div><div class="scard-val">0</div><div class="scard-sub">Watch and response areas</div><div class="scard-delta delta-up">Waiting for forecast...</div></div>
          <div class="scard s-safe"><div class="scard-icon">✓</div><div class="scard-label">Low Risk</div><div class="scard-val">0</div><div class="scard-sub">Routine monitoring areas</div><div class="scard-delta delta-dn">Waiting for forecast...</div></div>
          <div class="scard s-yamuna"><div class="scard-icon">≈</div><div class="scard-label">Water Level</div><div class="scard-val" id="dashboardWaterLevel">-</div><div class="scard-sub">Current monitored level</div><div class="scard-delta delta-up" id="dashboardWaterTrend">Loading...</div></div>
          <div class="scard s-info"><div class="scard-icon">☔</div><div class="scard-label">Rainfall</div><div class="scard-val" id="dashboardRainfallVal">-</div><div class="scard-sub" id="dashboardRainfallSub">Loading forecast...</div><div class="scard-delta delta-up" id="dashboardRainfallCat">Loading...</div></div>
          <div class="scard s-accent"><div class="scard-icon">⌂</div><div class="scard-label">Readiness</div><div class="scard-val" id="dashboardReadinessVal">-</div><div class="scard-sub">Operational readiness score</div><div class="scard-delta delta-up" id="dashboardReadinessNote">Loading...</div></div>
        </div>
      </div>
    </div>
    <div class="g-main">
      <div class="card">
        <div class="card-head">
          <div class="card-htitle">🗺️ City Flood Risk Map — Next 24h Hotspot Outlook</div>
          <div style="display:flex;gap:6px"><div class="badge b-info">Auto-refresh 5min</div><div class="badge b-accent">Model linked</div></div>
        </div>
        <div class="map-wrap" id="mainMapWrap"></div>
      </div>
      <div class="col-stack">
        <div class="card">
          <div class="card-head"><div class="card-htitle">📈 Hourly Rainfall — Next 24h</div><div class="badge b-warn">Forecast window</div></div>
          <div class="card-body"><div class="barchart" id="rainfallBar"></div></div>
        </div>
        <div class="card">
          <div class="card-head"><div class="card-htitle">⚡ Forecast Alerts</div><div class="badge b-danger">Next 24h</div></div>
          <div class="card-body" style="padding:12px 18px"><div id="live-alerts-panel" style="font-size:12px;color:var(--muted)">⌛ Fetching alerts...</div></div>
        </div>
        <div class="card">
          <div class="card-head"><div class="card-htitle">🏆 Top 5 At-Risk Areas</div></div>
          <div class="card-body" style="padding:12px 18px"><div id="topRiskList"></div></div>
        </div>
      </div>
    </div>`,

  hotspots: `
    <div class="pg-header">
      <div>
        <div class="pg-eyebrow">Active City · GIS Analysis</div>
        <div class="pg-title">Calculated Flood Hotspots</div>
        <div class="pg-desc">Hotspots are listed from the current backend calculation, dataset analysis, or model prediction</div>
      </div>
    </div>
    <div class="g2">
      <div class="card"><div class="card-head"><div class="card-htitle">📍 Hotspot Distribution by District / Ward</div></div><div class="card-body"><div id="districtBars"></div></div></div>
      <div class="card"><div class="card-head"><div class="card-htitle">🔬 Runtime Methodology</div></div><div class="card-body" id="methodologyBody"></div></div>
    </div>
    <div class="card">
      <div class="card-head"><div class="card-htitle">🚨 Top Critical Hotspots</div><div class="badge b-danger">Immediate Action Required</div></div>
      <div style="overflow-x:auto">
        <table class="dtable">
          <thead><tr><th>Zone ID</th><th>Location / Area</th><th>District / Ward</th><th>Risk Score</th><th>Flood Risk</th><th>Primary Cause</th><th>Elevation (m)</th><th>Drain Status</th><th>Recommended Action</th></tr></thead>
          <tbody id="hotspotTbody"></tbody>
        </table>
      </div>
    </div>`,

  wards: `
    <div class="pg-header">
      <div>
        <div class="pg-eyebrow">Active City · Readiness Overview</div>
        <div class="pg-title">Readiness Score Dashboard</div>
        <div class="pg-desc">Composite readiness scoring from backend-generated drainage, pumps, roads, response, and preparedness values</div>
      </div>
      <div style="display:flex;gap:8px;flex-wrap:wrap">
        <div class="badge b-danger">🔴 Critical</div>
        <div class="badge b-warn">🟡 Moderate</div>
        <div class="badge b-safe">🟢 Prepared</div>
      </div>
    </div>
    <div class="stats-row">
      <div class="scard s-danger"><div class="scard-label">Critical Units</div><div class="scard-val" id="wardCriticalVal">0</div><div class="scard-sub" id="wardCriticalSub">Backend readiness rows</div><div class="scard-delta delta-up" id="wardCriticalDelta">Highest intervention need</div></div>
      <div class="scard s-warn"><div class="scard-label">Moderate Units</div><div class="scard-val" id="wardModerateVal">0</div><div class="scard-sub" id="wardModerateSub">Backend readiness rows</div><div class="scard-delta delta-up" id="wardModerateDelta">Needs readiness boost</div></div>
      <div class="scard s-safe"><div class="scard-label">Prepared Units</div><div class="scard-val" id="wardPreparedVal">0</div><div class="scard-sub" id="wardPreparedSub">Backend readiness rows</div><div class="scard-delta delta-dn" id="wardPreparedDelta">Operationally stable</div></div>
      <div class="scard s-info"><div class="scard-label">Average Readiness</div><div class="scard-val" id="wardAverageVal">0/100</div><div class="scard-sub" id="wardAverageSub">Calculated from current readiness table</div><div class="scard-delta delta-up" id="wardAverageDelta">Loading live summary</div></div>
    </div>
    <div class="card">
      <div class="card-head">
        <div class="card-htitle">📋 Readiness Dashboard</div>
        <div style="display:flex;gap:6px;flex-wrap:wrap">
          <div class="chip active" id="filterAll" onclick="DFIS.wards.setFilter('all')">All</div>
          <div class="chip" id="filterCritical" onclick="DFIS.wards.setFilter('critical')">Critical</div>
          <div class="chip" id="filterMed" onclick="DFIS.wards.setFilter('medium')">Moderate</div>
          <div class="chip" id="filterGood" onclick="DFIS.wards.setFilter('good')">Prepared</div>
        </div>
      </div>
      <div style="overflow-x:auto">
        <table class="dtable">
          <thead><tr><th>Ward / Cell</th><th>District</th><th>Flood Risk</th><th>Drainage %</th><th>Pumps %</th><th>Roads %</th><th>Response %</th><th>Readiness Score</th><th>Priority Action</th></tr></thead>
          <tbody id="wardTableBody"></tbody>
        </table>
      </div>
    </div>`,

  yamuna: `
    <div class="pg-header">
      <div>
        <div class="pg-eyebrow">Active City · Water Monitoring</div>
        <div class="pg-title">Water Level Intelligence</div>
        <div class="pg-desc">Live water level context and flood thresholds from the current city backend</div>
      </div>
      <div class="badge b-warn">Runtime thresholds</div>
    </div>
    <div class="stats-row">
      <div class="scard s-yamuna"><div class="scard-icon">📏</div><div class="scard-label">Current Level</div><div class="scard-val" id="live-yamuna-level-big">-</div><div class="scard-sub">Backend-provided gauge context</div><div class="scard-delta delta-up" id="live-yamuna-status">Loading...</div></div>
      <div class="scard s-danger"><div class="scard-icon">🚨</div><div class="scard-label">Danger Level</div><div class="scard-val">Live</div><div class="scard-sub">Runtime threshold</div></div>
      <div class="scard s-warn"><div class="scard-icon">⚠️</div><div class="scard-label">Warning Level</div><div class="scard-val">Live</div><div class="scard-sub">Runtime threshold</div></div>
      <div class="scard s-info"><div class="scard-icon">🌊</div><div class="scard-label">Discharge / Flow</div><div class="scard-val">Live</div><div class="scard-sub">Live flood source if available</div></div>
      <div class="scard s-accent"><div class="scard-icon">🏘️</div><div class="scard-label">Impact Context</div><div class="scard-val">Live</div><div class="scard-sub">Derived from current conditions</div></div>
    </div>
    <div class="g2">
      <div class="card">
        <div class="card-head"><div class="card-htitle">📊 Water Level Trend</div><div class="badge b-danger">Live</div></div>
        <div class="card-body">
          <div id="yamunaChartWrap"></div>
          <div style="display:flex;justify-content:space-between;font-family:var(--font-mono);font-size:9px;color:var(--muted);margin-top:6px"><span>48hrs ago</span><span>36hrs</span><span>24hrs</span><span>12hrs</span><span>Now</span></div>
        </div>
      </div>
      <div class="card"><div class="card-head"><div class="card-htitle">🌊 Flood Stage Impact</div></div><div class="card-body"><div id="floodStages"></div></div></div>
    </div>
    <div class="g2">
      <div class="card"><div class="card-head"><div class="card-htitle">🌉 Water Level Stations</div></div><div class="card-body" id="gaugeTableWrap"></div></div>
      <div class="card"><div class="card-head"><div class="card-htitle">🏘️ High-Risk Areas Near Water</div><div class="badge b-danger">Calculated</div></div><div class="card-body"><div id="yamunaColonies"></div></div></div>
    </div>`,

  simulator: `
    <div class="pg-header">
      <div>
        <div class="pg-eyebrow">Active City · Scenario Engine</div>
        <div class="pg-title">What-If Flood Scenario Simulator</div>
        <div class="pg-desc">Run runtime scenarios against the active city context and open a route to the most exposed hotspot</div>
      </div>
      <div class="badge b-info">Interactive</div>
    </div>
    <div class="g2">
      <div class="card">
        <div class="card-head"><div class="card-htitle">🏛️ Scenario Parameters</div><div class="badge b-accent">Live city mode</div></div>
        <div class="card-body">
          <div class="slider-group">
            <div><div class="slider-label"><span class="slider-name">🌧️ Rainfall Intensity</span><span class="slider-val" id="sRainVal">50 mm/hr</span></div><input type="range" id="sRain" min="5" max="250" value="50" oninput="DFIS.simulator.run()"><div class="slider-range-labels"><span>Light</span><span>Extreme</span></div></div>
            <div><div class="slider-label"><span class="slider-name">⏱️ Storm Duration</span><span class="slider-val" id="sDurVal">3 hrs</span></div><input type="range" id="sDur" min="1" max="24" value="3" oninput="DFIS.simulator.run()"><div class="slider-range-labels"><span>1 hr</span><span>24 hrs</span></div></div>
            <div><div class="slider-label"><span class="slider-name" id="sim-water-label">💧 Water Level at Start</span><span class="slider-val" id="sYamunaVal">2.50 m</span></div><input type="range" id="sYamuna" min="100" max="40000" value="250" oninput="DFIS.simulator.run()"><div class="slider-range-labels"><span id="sim-water-range-desc">Low</span><span>Extreme</span></div></div>
            <div><div class="slider-label"><span class="slider-name">🌱 Soil Saturation</span><span class="slider-val" id="sSoilVal">65%</span></div><input type="range" id="sSoil" min="0" max="100" value="65" oninput="DFIS.simulator.run()"><div class="slider-range-labels"><span>Dry</span><span>Saturated</span></div></div>
          </div>
          <div style="margin-top:20px">
            <div style="font-family:var(--font-mono);font-size:9px;color:var(--muted);text-transform:uppercase;letter-spacing:1px;margin-bottom:10px">Drainage Condition</div>
            <div style="display:grid;grid-template-columns:1fr 1fr;gap:8px">
              <div class="chip active" id="dchip-full" onclick="DFIS.simulator.setDrain('full')">Full Capacity</div>
              <div class="chip" id="dchip-75" onclick="DFIS.simulator.setDrain('75')">75% Capacity</div>
              <div class="chip" id="dchip-50" onclick="DFIS.simulator.setDrain('50')">50% Capacity</div>
              <div class="chip" id="dchip-blocked" onclick="DFIS.simulator.setDrain('blocked')">Blocked Drains</div>
            </div>
          </div>
          <div style="margin-top:16px">
            <div style="font-family:var(--font-mono);font-size:9px;color:var(--muted);text-transform:uppercase;letter-spacing:1px;margin-bottom:10px">Preset Scenarios</div>
            <div style="display:flex;gap:8px;flex-wrap:wrap">
              <div class="chip" onclick="DFIS.simulator.loadPreset('normal')">Normal</div>
              <div class="chip" onclick="DFIS.simulator.loadPreset('2023')">Heavy</div>
              <div class="chip" onclick="DFIS.simulator.loadPreset('extreme')">Extreme</div>
            </div>
          </div>
        </div>
      </div>
      <div class="col-stack">
        <div class="card">
          <div class="card-head"><div class="card-htitle">📊 Simulation Output</div><div class="badge b-info" id="simScenarioLabel">Custom Scenario</div></div>
          <div class="card-body">
            <div style="display:grid;grid-template-columns:1fr 1fr 1fr;gap:10px;margin-bottom:16px">
              <div style="background:var(--abyss);border-radius:8px;padding:14px;text-align:center"><div style="font-family:var(--font-mono);font-size:9px;color:var(--muted);margin-bottom:4px;text-transform:uppercase">Flooded Zones</div><div id="outZones" style="font-family:var(--font-display);font-size:28px;font-weight:800;color:var(--danger)">-</div></div>
              <div style="background:var(--abyss);border-radius:8px;padding:14px;text-align:center"><div style="font-family:var(--font-mono);font-size:9px;color:var(--muted);margin-bottom:4px;text-transform:uppercase">Pop. at Risk</div><div id="outPop" style="font-family:var(--font-display);font-size:28px;font-weight:800;color:var(--warn)">-</div></div>
              <div style="background:var(--abyss);border-radius:8px;padding:14px;text-align:center"><div style="font-family:var(--font-mono);font-size:9px;color:var(--muted);margin-bottom:4px;text-transform:uppercase">Warning Lead</div><div id="outWarning" style="font-family:var(--font-display);font-size:28px;font-weight:800;color:var(--info)">-</div></div>
            </div>
            <div id="simActions" class="sim-out"></div>
          </div>
        </div>
        <div class="card"><div class="card-head"><div class="card-htitle">🏙️ Area Impact Prediction</div></div><div class="card-body"><div id="distImpact"></div></div></div>
      </div>
    </div>`,

  resources: `
    <div class="pg-header">
      <div>
        <div class="pg-eyebrow">Active City · Resource Deployment</div>
        <div class="pg-title">Emergency Resource Deployment</div>
        <div class="pg-desc">Action suggestions and resource gaps are generated from the current readiness and hotspot state</div>
      </div>
      <div class="badge b-warn">Runtime Mode</div>
    </div>
    <div class="g2">
      <div class="card">
        <div class="card-head"><div class="card-htitle">🤖 Runtime Resource Recommendations</div><div class="badge b-accent">Model linked</div></div>
        <div class="card-body">
          <div style="font-size:12px;color:var(--muted);line-height:1.7">Recommendations below are generated from the active city state and the currently most exposed readiness rows.</div>
        </div>
      </div>
      <div class="card"><div class="card-head"><div class="card-htitle">📍 Resource Gap Analysis</div></div><div class="card-body"><div id="resGapList"></div></div></div>
    </div>`,

  alerts: `
    <div class="alerts-shell">
      <div class="pg-header alerts-hero">
        <div>
          <div class="pg-eyebrow">Delhi · DDMA · Emergency Communications</div>
          <div class="pg-title">Send Emergency Alerts</div>
          <div class="pg-desc">Issue official DDMA-formatted notifications to registered ward officers, coordinators and field teams.</div>
        </div>
        <div class="alerts-hero-badges">
          <div class="badge b-danger">3 Critical Zones</div>
          <div class="badge b-info" id="alert-sent-badge">0 Sent Today</div>
        </div>
      </div>

      <div class="alerts-metrics">
        <div class="alerts-stat alerts-stat-safe"><div class="alerts-stat-icon">👥</div><div class="alerts-stat-label">Registered Contacts</div><div class="alerts-stat-value" id="al-stat-contacts">0</div><div class="alerts-stat-sub">Ward officers & coordinators</div></div>
        <div class="alerts-stat alerts-stat-info"><div class="alerts-stat-icon">📨</div><div class="alerts-stat-label">Alerts Sent Today</div><div class="alerts-stat-value" id="al-stat-sent">0</div><div class="alerts-stat-sub">This session</div></div>
        <div class="alerts-stat alerts-stat-accent"><div class="alerts-stat-icon">📋</div><div class="alerts-stat-label">Total History</div><div class="alerts-stat-value" id="al-stat-total">0</div><div class="alerts-stat-sub">Stored locally</div></div>
        <div class="alerts-stat alerts-stat-danger"><div class="alerts-stat-icon">🗺️</div><div class="alerts-stat-label">Critical Zones</div><div class="alerts-stat-value">3</div><div class="alerts-stat-sub">Require immediate alerts</div></div>
        <div class="alerts-stat alerts-stat-safe"><div class="alerts-stat-icon">✅</div><div class="alerts-stat-label">Delivered</div><div class="alerts-stat-value" id="al-stat-delivered">0</div><div class="alerts-stat-sub">Successfully dispatched</div></div>
      </div>

      <div class="alerts-grid">
        <div class="alerts-col-main">
          <div class="card alerts-panel">
            <div class="card-head"><div class="card-htitle">📢 Compose Official Alert</div><div class="badge b-accent">DDMA Format</div></div>
            <div class="card-body alerts-panel-body">
              <div class="alerts-field">
                <div class="alerts-label">Alert Severity</div>
                <div class="alerts-severity-grid" id="al-sev-row">
                  <button class="chip active alerts-sev critical" id="al-sev-red" onclick="DFIS.alerts.setSev('red',this)">🔴 Critical</button>
                  <button class="chip alerts-sev high" id="al-sev-orange" onclick="DFIS.alerts.setSev('orange',this)">🟠 High</button>
                  <button class="chip alerts-sev medium" id="al-sev-yellow" onclick="DFIS.alerts.setSev('yellow',this)">🟡 Medium</button>
                  <button class="chip alerts-sev advisory" id="al-sev-teal" onclick="DFIS.alerts.setSev('teal',this)">🔵 Advisory</button>
                </div>
              </div>
              <div class="alerts-field">
                <div class="alerts-label">Event / Disaster Type</div>
                <select id="al-dtype" class="alerts-input" onchange="DFIS.alerts.generateMessage()">
                  <option value="flood">Flood / Waterlogging</option>
                  <option value="rain">Heavy Rainfall Warning</option>
                  <option value="water">Water Level Alert</option>
                  <option value="drainage">Drain / Sewer Overflow</option>
                  <option value="evacuation">Evacuation Order</option>
                  <option value="relief">Relief Camp Activation</option>
                  <option value="allclear">All Clear</option>
                </select>
              </div>
              <div class="alerts-field">
                <div class="alerts-label">Target Region</div>
                <select id="al-region" class="alerts-input" onchange="DFIS.alerts.generateMessage(); DFIS.alerts.filterByRegion(); DFIS.alerts.renderHistory();">
                  <option value="">-- Select Region --</option>
                </select>
              </div>
              <div class="alerts-field">
                <div class="alerts-label">Ward / Locality (Optional)</div>
                <input type="text" id="al-ward" class="alerts-input" placeholder="e.g. Ward 36N, Saket Block C..." oninput="DFIS.alerts.generateMessage()"/>
              </div>
              <div class="alerts-field">
                <div class="alerts-label">Quick Templates</div>
                <div class="alerts-templates">
                  <button class="chip alerts-template" onclick="DFIS.alerts.applyTpl('evacuate')">🚨 Evacuate</button>
                  <button class="chip alerts-template" onclick="DFIS.alerts.applyTpl('stayindoors')">🏠 Stay Indoors</button>
                  <button class="chip alerts-template" onclick="DFIS.alerts.applyTpl('reliefcamp')">⛺ Relief Camp</button>
                  <button class="chip alerts-template" onclick="DFIS.alerts.applyTpl('yamunarise')">🌊 Yamuna Rising</button>
                  <button class="chip alerts-template" onclick="DFIS.alerts.applyTpl('pumps')">🌀 Pumps Deployed</button>
                  <button class="chip alerts-template" onclick="DFIS.alerts.applyTpl('allcleartpl')">✅ All Clear</button>
                </div>
              </div>
              <div class="alerts-field">
                <div class="alerts-label">Message Body</div>
                <textarea id="al-msgbody" class="alerts-textarea" oninput="DFIS.alerts.updateCharBar()" rows="8" placeholder="Select region and event type to auto-generate a DDMA alert..."></textarea>
              </div>
              <div class="alerts-charbar">
                <span><span id="al-charcount">0</span> chars</span>
                <div class="alerts-chartrack"><div id="al-charfill"></div></div>
                <span>160 SMS</span>
              </div>
              <div class="alerts-recipient-block">
                <div class="alerts-recipient-head">
                  <div class="alerts-label" style="margin:0">Recipients</div>
                  <div class="alerts-recipient-actions">
                    <button class="chip" onclick="DFIS.alerts.selectAll(true)">All</button>
                    <button class="chip" onclick="DFIS.alerts.selectAll(false)">None</button>
                    <button class="chip" onclick="DFIS.alerts.openAddModal()">+ Add</button>
                  </div>
                </div>
                <div id="al-contact-list"></div>
              </div>
              <div id="al-send-progress" class="alerts-progress" style="display:none">
                <div class="alerts-progress-spinner"></div>
                <div><div class="alerts-progress-title">Dispatching alert</div><div class="alerts-progress-sub">Preparing notification batches for selected contacts...</div></div>
              </div>
              <div id="al-send-area" class="alerts-send-stack">
                <button id="al-send-btn" class="alerts-primary-btn" type="button" onclick="DFIS.alerts.send()">📩 Dispatch Alert To Selected Contacts</button>
              </div>
            </div>
          </div>
        </div>

        <div class="alerts-col-side">
          <div class="card alerts-panel">
            <div class="card-head"><div class="card-htitle">👥 Registered Contacts</div><div class="badge b-safe" id="al-contact-chip">0 Active</div></div>
            <div class="card-body alerts-panel-body">
              <div id="al-full-contacts"></div>
            </div>
          </div>
          <div class="card alerts-panel">
            <div class="card-head">
              <div class="card-htitle">📜 Alert History</div>
              <div style="display:flex;gap:6px;flex-wrap:wrap;align-items:center">
                <div class="badge b-info" id="al-hist-chip">0 Records</div>
                <button class="chip" onclick="DFIS.alerts.exportCSV()">CSV</button>
                <button class="chip" onclick="DFIS.alerts.clearHistory()">Clear</button>
              </div>
            </div>
            <div class="card-body alerts-panel-body">
              <div class="alerts-history-tabs">
                <button class="chip active" id="al-tab-today" onclick="DFIS.alerts.switchTab('today', this)">Today</button>
                <button class="chip" id="al-tab-all" onclick="DFIS.alerts.switchTab('all', this)">All</button>
                <button class="chip" id="al-tab-critical" onclick="DFIS.alerts.switchTab('critical', this)">Critical</button>
              </div>
              <select id="al-hist-filter" class="alerts-input" onchange="DFIS.alerts.renderHistory()">
                <option value="">All Regions</option>
              </select>
              <div id="al-history-list" class="alerts-history-list"></div>
            </div>
          </div>
        </div>
      </div>

      <div id="al-modal" class="alerts-modal" style="display:none">
        <div class="alerts-modal-card">
          <div class="alerts-modal-head">
            <div>
              <div class="alerts-label" style="margin-bottom:6px">Add Contact</div>
              <div style="font-size:12px;color:var(--muted)">Register a ward officer, coordinator, or field contact.</div>
            </div>
            <button class="chip" onclick="DFIS.alerts.closeAddModal()">Close</button>
          </div>
          <div class="alerts-modal-grid">
            <input id="al-nc-name" class="alerts-input" placeholder="Full name" />
            <input id="al-nc-phone" class="alerts-input" placeholder="+91 phone number" />
            <input id="al-nc-role" class="alerts-input" placeholder="Role / designation" />
            <select id="al-nc-region" class="alerts-input">
              <option value="All Delhi">All Delhi</option>
              <option value="South Delhi">South Delhi</option>
              <option value="East Delhi">East Delhi</option>
              <option value="North Delhi">North Delhi</option>
              <option value="Yamuna Flood Plains">Yamuna Flood Plains</option>
            </select>
          </div>
          <div class="alerts-modal-actions">
            <button class="alerts-primary-btn" type="button" onclick="DFIS.alerts.saveContact()">Save Contact</button>
          </div>
        </div>
      </div>
    </div>`,

  routes: `
  <div class="ro-header">
    <div class="ro-eye">ACTIVE CITY · LIVE FLOOD RESPONSE ROUTING</div>
    <div class="ro-title">🗺️ Service Route Optimizer</div>
    <div class="ro-sub">Routing is generated from current hotspot coordinates and live street routing when available</div>
  </div>
  <div class="ro-grid">
    <div>
      <div class="ro-card">
        <div class="ro-ch">
          <div class="ro-chtitle">Route Parameters</div>
          <button class="ro-swap" id="ro-swap-btn" type="button">Swap</button>
        </div>
        <div class="ro-cb">
          <div class="ro-live">
            <span>Scenario engine</span>
            <strong id="ro-live-signal">Auto severity: checking live conditions</strong>
          </div>
          <div class="ro-help">Origins and destinations are populated from the active city center and current hotspot list.</div>
          <div class="ro-panelstats">
            <div class="ro-panelstat"><span>Coverage</span><strong id="ro-coverage">Active city</strong></div>
            <div class="ro-panelstat"><span>Mode</span><strong>Live routing</strong></div>
            <div class="ro-panelstat"><span>Map</span><strong>Street + hotspots</strong></div>
          </div>
          <div class="ro-list-grid">
            <div class="ro-listbox">
              <label>Origin Search</label>
              <input id="ro-origin-search" class="ro-search" placeholder="Filter origin list" autocomplete="off" />
              <select id="ro-origin" class="ro-locations" size="10"></select>
            </div>
            <div class="ro-listbox">
              <label>Destination Search</label>
              <input id="ro-dest-search" class="ro-search" placeholder="Filter destination list" autocomplete="off" />
              <select id="ro-dest" class="ro-locations" size="10"></select>
            </div>
          </div>
          <div>
            <label>Flood Severity</label>
            <select id="ro-severity">
              <option value="normal">Normal operations</option>
              <option value="moderate">Moderate flooding</option>
              <option value="high">High flooding</option>
              <option value="severe">Severe flooding</option>
            </select>
          </div>
          <button class="ro-btn" id="ro-calc-btn">Calculate Route</button>
          <div class="ro-regions" id="ro-region-groups"></div>
        </div>
      </div>
    </div>
    <div>
      <div class="ro-card">
        <div class="ro-ch"><div class="ro-chtitle">Live Street Map</div></div>
        <div id="ro-map">Map will appear here</div>
      </div>
      <div class="ro-result" id="ro-result">
        <div class="ro-result-top">
          <div>
            <div class="ro-kicker">Flood Dispatch Plan</div>
            <div class="ro-headline" id="ro-headline">Route ready</div>
          </div>
          <div class="ro-pill" id="ro-risk-pill">Adaptive reroute active</div>
        </div>
        <div class="ro-metrics">
          <div class="ro-metric"><span>Distance</span><strong id="ro-best-dist">--</strong></div>
          <div class="ro-metric"><span>ETA</span><strong id="ro-best-time">--</strong></div>
          <div class="ro-metric"><span>Safety</span><strong id="ro-best-safety">--</strong></div>
        </div>
        <div class="ro-summary"><div class="ro-ribbon" id="ro-ribbon"></div></div>
        <div class="ro-notes">
          <div class="ro-note"><b>Selected Route</b><div id="ro-path">--</div></div>
          <div class="ro-note"><b>Why This Route</b><div id="ro-reason">--</div></div>
          <div class="ro-note"><b>Field Advisory</b><div id="ro-advisory">--</div></div>
        </div>
        <div class="ro-note" style="margin-top:10px">
          <div class="ro-turn-head"><span>Turn-By-Turn</span><em id="ro-turn-label">Live navigation guidance</em></div>
          <div id="ro-steps" class="ro-steps"></div>
        </div>
      </div>
    </div>
  </div>`,

  assistant: `
    <div class="pg-header">
      <div>
        <div class="pg-eyebrow">Active City · Operations Copilot</div>
        <div class="pg-title">GenAI Assistant</div>
        <div class="pg-desc">Ask what officers should do over the next 24 hours using the current city forecast, hotspots, alerts, and readiness data.</div>
      </div>
      <div style="display:flex;gap:8px;flex-wrap:wrap">
        <div class="badge b-safe">Live context</div>
        <div class="badge b-info">24h forecast</div>
      </div>
    </div>
    <div class="assistant-grid">
      <div class="assistant-card assistant-sidebar">
        <div class="assistant-section">
          <div class="assistant-kicker">Suggested asks</div>
          <div class="assistant-suggestions" id="assistantSuggestions"></div>
        </div>
      </div>
      <div class="assistant-card assistant-chat-card">
        <div class="assistant-chat-head">
          <div>
            <div class="assistant-kicker">Officer chat</div>
            <div class="assistant-chat-title">Response guidance for the selected city</div>
          </div>
          <div class="assistant-horizon" id="assistantHorizon">Next 24 hours</div>
        </div>
        <div class="assistant-thread" id="assistantThread"></div>
        <div class="assistant-composer">
          <textarea id="assistantInput" placeholder="Ask what officers should do if flooding occurs, which areas need action first, or whether evacuation is required..." rows="3"></textarea>
          <div class="assistant-actions">
            <div class="assistant-note" id="assistantStatus">Grounding from live API and datasets</div>
            <button class="assistant-send" id="assistantSendBtn" type="button">Ask Assistant</button>
          </div>
        </div>
      </div>
    </div>`,

  features: `
    <div class="pg-header">
      <div>
        <div class="pg-eyebrow">System Design · Feature Breakdown</div>
        <div class="pg-title">Feature Architecture</div>
        <div class="pg-desc">Runtime feature set for live data, model inference, city-aware mapping, and operations</div>
      </div>
      <div style="display:flex;gap:8px;flex-wrap:wrap">
        <div class="badge b-safe">Core</div>
        <div class="badge b-info">Advanced</div>
        <div class="badge b-accent">Operational</div>
      </div>
    </div>
    <div class="feat-grid" id="featGrid"></div>`,

  architecture: `
    <div class="pg-header">
      <div>
        <div class="pg-eyebrow">Technical Blueprint · Implementation</div>
        <div class="pg-title">System Architecture</div>
        <div class="pg-desc">Live ingestion, model inference, computed outputs, and dashboard delivery</div>
      </div>
    </div>
    <div class="g2">
      <div class="card"><div class="card-head"><div class="card-htitle">🏗️ Tech Stack</div></div><div class="card-body" id="techStackBody"></div></div>
      <div class="card"><div class="card-head"><div class="card-htitle">🔄 Data Pipeline</div></div><div class="card-body"><div id="pipelineRow"></div></div></div>
    </div>`,
};
