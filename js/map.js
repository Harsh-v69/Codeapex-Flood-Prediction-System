/* ============================================================
   Dhristi
   js/map.js - City map rendering
   ============================================================ */

'use strict';

window.DFIS = window.DFIS || {};

DFIS.map = {
  HOTSPOT_COLORS: {
    critical: '#f43f5e',
    high: '#f97316',
    medium: '#facc15',
    low: '#4ade80',
  },

  _leafletMap: null,
  _leafletLayer: null,
  _riskFilter: 'all',

  recenterToCity() {
    if (!DFIS.map._leafletMap) return;
    const city = DFIS.live?.getCurrentCityConfig?.() || { lat: 28.6139, lon: 77.2090, zoom: 11 };
    DFIS.map._leafletMap.setView([city.lat, city.lon], city.zoom || 11, { animate: false });
  },

  renderDashboardMap(containerId = 'mainMapWrap') {
    const wrap = document.getElementById(containerId);
    if (!wrap) return;

    wrap.innerHTML = [
      '<div id="cityMapCanvas" class="city-map-canvas"></div>',
      DFIS.map.buildToolbar(),
      DFIS.map.buildInfoPanel(),
    ].join('');

    const city = DFIS.live?.getCurrentCityConfig?.() || { lat: 28.6139, lon: 77.2090, zoom: 11 };
    const mapNode = document.getElementById('cityMapCanvas');
    if (!mapNode || typeof L === 'undefined') return;

    if (DFIS.map._leafletMap) {
      DFIS.map._leafletMap.remove();
      DFIS.map._leafletMap = null;
      DFIS.map._leafletLayer = null;
    }

    const map = L.map(mapNode, {
      zoomControl: true,
      attributionControl: true,
    }).setView([city.lat, city.lon], city.zoom || 11);

    L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
      maxZoom: 18,
      attribution: '&copy; OpenStreetMap',
    }).addTo(map);

    DFIS.map._leafletMap = map;
    DFIS.map._leafletLayer = L.layerGroup().addTo(map);
    DFIS.map.renderHotspots();
  },

  setFilter(filter) {
    DFIS.map._riskFilter = filter || 'all';
    DFIS.map.renderHotspots();
  },

  _filteredHotspots() {
    const points = Array.isArray(DFIS.HOTSPOTS) ? DFIS.HOTSPOTS : [];
    if (DFIS.map._riskFilter === 'all') return points;
    return points.filter((hotspot) => hotspot.risk === DFIS.map._riskFilter);
  },

  _updateToolbar() {
    const points = Array.isArray(DFIS.HOTSPOTS) ? DFIS.HOTSPOTS : [];
    const counts = {
      all: points.length,
      critical: points.filter((h) => h.risk === 'critical').length,
      high: points.filter((h) => h.risk === 'high').length,
      medium: points.filter((h) => h.risk === 'medium').length,
      low: points.filter((h) => h.risk === 'low').length,
    };
    const set = (id, text) => {
      const el = document.getElementById(id);
      if (el) el.textContent = text;
    };
    set('mapFilterAllCount', counts.all);
    set('mapFilterCriticalCount', counts.critical);
    set('mapFilterHighCount', counts.high);
    set('mapFilterMediumCount', counts.medium);
    set('mapFilterLowCount', counts.low);

    ['all', 'critical', 'high', 'medium', 'low'].forEach((risk) => {
      const el = document.getElementById('mapFilter-' + risk);
      if (el) el.classList.toggle('active', DFIS.map._riskFilter === risk);
    });
  },

  renderHotspots() {
    if (!DFIS.map._leafletMap || !DFIS.map._leafletLayer || typeof L === 'undefined') return;
    DFIS.map.recenterToCity();
    DFIS.map._leafletLayer.clearLayers();

    const points = DFIS.map._filteredHotspots();
    const bounds = [];

    points.forEach((hotspot) => {
      if (typeof hotspot.lat !== 'number' || typeof hotspot.lon !== 'number') return;
      const risk = hotspot.risk || 'low';
      const color = DFIS.map.HOTSPOT_COLORS[risk] || DFIS.map.HOTSPOT_COLORS.low;
      const marker = L.circleMarker([hotspot.lat, hotspot.lon], {
        radius: risk === 'critical' ? 9 : risk === 'high' ? 8 : risk === 'medium' ? 7 : 6,
        color,
        weight: 2,
        fillColor: color,
        fillOpacity: 0.35,
      });

      const popup = [
        '<div class="map-popup">',
        '<div class="map-popup-title">' + hotspot.loc + '</div>',
        '<div>Risk: <strong>' + risk.toUpperCase() + '</strong></div>',
        '<div>District/Ward: ' + (hotspot.dist || 'N/A') + '</div>',
        '<div>Score: ' + hotspot.score + '/100</div>',
        '<div>Action: ' + (hotspot.action || 'Monitor') + '</div>',
        '</div>',
      ].join('');
      marker.bindPopup(popup);
      marker.on('click', () => {
        if (DFIS.app && typeof DFIS.app.openRouteForLocation === 'function') {
          const severity = risk === 'critical' ? 'severe' : risk === 'high' ? 'high' : 'moderate';
          DFIS.app.openRouteForLocation(hotspot.loc, { severity, source: 'dashboard-map' });
        }
      });

      marker.addTo(DFIS.map._leafletLayer);
      bounds.push([hotspot.lat, hotspot.lon]);
    });

    if (bounds.length) {
      DFIS.map._leafletMap.fitBounds(bounds, { padding: [30, 30], maxZoom: 12 });
    } else {
      DFIS.map.recenterToCity();
    }

    DFIS.map._updateToolbar();
  },

  buildInfoPanel() {
    return `
      <div class="map-info-panel">
        <div class="mip-title">Live Metrics</div>
        <div class="mip-row"><span class="mip-key">Total Hotspots</span><span class="mip-val">0</span></div>
        <div class="mip-row"><span class="mip-key">Critical Zones</span><span class="mip-val">0</span></div>
        <div class="mip-row"><span class="mip-key">Water Level</span><span class="mip-val">-</span></div>
        <div class="mip-row"><span class="mip-key">Rainfall</span><span class="mip-val">-</span></div>
        <div class="mip-row"><span class="mip-key">At-Risk Pop.</span><span class="mip-val">-</span></div>
        <div class="mip-row"><span class="mip-key">Last Update</span><span class="mip-val" id="mapUpdateTime">-</span></div>
      </div>`;
  },

  buildToolbar() {
    return `
      <div class="map-toolbar">
        <button class="map-filter-chip active" id="mapFilter-all" onclick="DFIS.map.setFilter('all')">All <span id="mapFilterAllCount">0</span></button>
        <button class="map-filter-chip critical" id="mapFilter-critical" onclick="DFIS.map.setFilter('critical')">Critical <span id="mapFilterCriticalCount">0</span></button>
        <button class="map-filter-chip high" id="mapFilter-high" onclick="DFIS.map.setFilter('high')">High <span id="mapFilterHighCount">0</span></button>
        <button class="map-filter-chip medium" id="mapFilter-medium" onclick="DFIS.map.setFilter('medium')">Medium <span id="mapFilterMediumCount">0</span></button>
        <button class="map-filter-chip low" id="mapFilter-low" onclick="DFIS.map.setFilter('low')">Low <span id="mapFilterLowCount">0</span></button>
      </div>`;
  },
};
