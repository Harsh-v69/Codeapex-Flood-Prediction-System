/* ============================================================
   Dhristi
   js/route.js - Live hotspot routing
   ============================================================ */
'use strict';

window.DFIS = window.DFIS || {};
DFIS.routeState = DFIS.routeState || {
  origin: 'CITY_CENTER',
  destination: '',
  severity: 'normal',
  source: 'manual',
};

DFIS.routes = (() => {
  let bound = false;
  let map = null;
  let mapHost = null;
  let markerLayer = null;
  let routingControl = null;
  let fallbackRouteLine = null;
  let liveLocations = {};

  function cityConfig() {
    return DFIS.live?.getCurrentCityConfig?.() || { label: 'City', fullName: 'City', lat: 20.5937, lon: 78.9629, zoom: 11 };
  }

  function toNumber(value) {
    if (typeof value === 'number' && Number.isFinite(value)) return value;
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : null;
  }

  function fallbackPoint(index, city) {
    const radius = 0.03 + ((index % 5) * 0.008);
    const angle = ((index % 12) / 12) * Math.PI * 2;
    return {
      lat: +(city.lat + Math.sin(angle) * radius).toFixed(6),
      lng: +(city.lon + Math.cos(angle) * radius).toFixed(6),
    };
  }

  function buildLocations() {
    const city = cityConfig();
    const locations = {
      CITY_CENTER: {
        label: city.fullName + ' Control Center',
        lat: city.lat,
        lng: city.lon,
        district: city.label,
        kind: 'origin',
      },
    };

    const districtHubs = {};

    (DFIS.HOTSPOTS || []).slice(0, 25).forEach((hotspot, index) => {
      const lat = toNumber(hotspot.lat);
      const lng = toNumber(hotspot.lon ?? hotspot.lng);
      const fallback = fallbackPoint(index, city);
      const district = hotspot.dist || city.label;
      locations['HOTSPOT_' + index] = {
        label: hotspot.loc || hotspot.name || ('Hotspot ' + (index + 1)),
        lat: lat ?? fallback.lat,
        lng: lng ?? fallback.lng,
        district,
        risk: hotspot.risk || 'low',
        kind: 'hotspot',
        isFallbackCoord: lat == null || lng == null,
      };
      if (!districtHubs[district]) {
        districtHubs[district] = {
          label: district + ' Response Hub',
          lat: lat ?? fallback.lat,
          lng: lng ?? fallback.lng,
          district,
          risk: hotspot.risk || 'low',
          kind: 'origin',
          isFallbackCoord: lat == null || lng == null,
        };
      }
    });
    Object.entries(districtHubs).forEach(([district, value], index) => {
      locations['DISTRICT_' + index] = value;
    });
    liveLocations = locations;
    return locations;
  }

  function recenterToCity() {
    if (!map) return;
    const city = cityConfig();
    map.setView([city.lat, city.lon], city.zoom || 11, { animate: false });
  }

  function teardownMap() {
    try {
      if (routingControl && map) map.removeControl(routingControl);
    } catch (_) {}
    try {
      if (markerLayer && map) map.removeLayer(markerLayer);
    } catch (_) {}
    try {
      if (map) map.remove();
    } catch (_) {}
    map = null;
    mapHost = null;
    markerLayer = null;
    routingControl = null;
    fallbackRouteLine = null;
  }

  function init() {
    bindEvents();
    populateLocationSelects();
    renderRegionGroups();
    hydrateScenario();
    calculateRoute();
  }

  function bindEvents() {
    if (bound) return;
    ['ro-origin', 'ro-dest', 'ro-severity'].forEach((id) => {
      document.getElementById(id)?.addEventListener('change', calculateRoute);
    });
    ['ro-origin-search', 'ro-dest-search'].forEach((id) => {
      document.getElementById(id)?.addEventListener('input', handleFilterInput);
    });
    document.getElementById('ro-calc-btn')?.addEventListener('click', calculateRoute);
    document.getElementById('ro-swap-btn')?.addEventListener('click', swapRoute);
    bound = true;
  }

  function populateLocationSelects() {
    buildLocations();
    const originEl = document.getElementById('ro-origin');
    const destEl = document.getElementById('ro-dest');
    if (!originEl || !destEl) return;
    renderLocationOptions(originEl, '', 'origin');
    renderLocationOptions(destEl, '', 'destination');
    const coverage = document.getElementById('ro-coverage');
    if (coverage) coverage.textContent = cityConfig().fullName;
    recenterToCity();
  }

  function renderLocationOptions(selectEl, query, mode) {
    const activeValue = selectEl.value;
    const q = (query || '').trim().toLowerCase();
    const options = Object.entries(liveLocations)
      .filter(([key, value]) => {
        if (mode === 'destination' && key === 'CITY_CENTER') return false;
        return !q || value.label.toLowerCase().includes(q) || (value.district || '').toLowerCase().includes(q);
      })
      .sort((a, b) => a[1].label.localeCompare(b[1].label));

    selectEl.innerHTML = options.map(([key, value]) =>
      `<option value="${key}">${value.label} • ${(value.district || cityConfig().label)}</option>`
    ).join('');

    if (activeValue && liveLocations[activeValue]) {
      selectEl.value = activeValue;
    } else if (mode === 'origin' && liveLocations.CITY_CENTER) {
      selectEl.value = 'CITY_CENTER';
    } else if (mode === 'destination') {
      const firstHotspot = Object.keys(liveLocations).find((key) => key !== 'CITY_CENTER');
      if (firstHotspot) selectEl.value = firstHotspot;
    }
  }

  function renderRegionGroups() {
    const wrap = document.getElementById('ro-region-groups');
    if (!wrap) return;
    const city = cityConfig();
    const groups = {};
    Object.entries(liveLocations).forEach(([key, value]) => {
      if (key === 'CITY_CENTER') return;
      const groupKey = value.district || city.label;
      if (!groups[groupKey]) groups[groupKey] = [];
      groups[groupKey].push({ key, value });
    });
    wrap.innerHTML = Object.entries(groups).map(([region, entries]) => `
      <div class="ro-region">
        <b>${region}</b>
        <div class="ro-chips">
          ${entries.slice(0, 6).map(({ key, value }) => `<button class="chip" data-route-pick="${key}" type="button">${value.label}</button>`).join('')}
        </div>
      </div>
    `).join('');
    wrap.querySelectorAll('[data-route-pick]').forEach((btn) => {
      btn.addEventListener('click', () => applyQuickPick(btn.getAttribute('data-route-pick')));
    });
  }

  function applyQuickPick(key) {
    if (!liveLocations[key]) return;
    setSelectValue('ro-origin', 'CITY_CENTER');
    setSelectValue('ro-dest', key);
    calculateRoute();
  }

  function swapRoute() {
    const originEl = document.getElementById('ro-origin');
    const destEl = document.getElementById('ro-dest');
    if (!originEl || !destEl) return;
    const nextOrigin = destEl.value;
    const nextDest = originEl.value;
    if (liveLocations[nextOrigin]) originEl.value = nextOrigin;
    if (liveLocations[nextDest]) destEl.value = nextDest;
    calculateRoute();
  }

  function hydrateScenario() {
    applySavedState();
    const signal = document.getElementById('ro-live-signal');
    if (signal) signal.textContent = inferSeverity().label;
  }

  function applySavedState() {
    const originEl = document.getElementById('ro-origin');
    const destinationEl = document.getElementById('ro-dest');
    const severityEl = document.getElementById('ro-severity');
    const detected = inferSeverity();
    if (originEl) originEl.value = liveLocations[DFIS.routeState.origin] ? DFIS.routeState.origin : 'CITY_CENTER';
    if (destinationEl) {
      const fallback = Object.keys(liveLocations).find((key) => key !== 'CITY_CENTER') || 'CITY_CENTER';
      destinationEl.value = liveLocations[DFIS.routeState.destination] ? DFIS.routeState.destination : fallback;
    }
    if (severityEl) severityEl.value = DFIS.routeState.severity || detected.level;
  }

  function handleFilterInput(event) {
    const id = event?.target?.id || '';
    const query = event?.target?.value || '';
    if (id === 'ro-origin-search') renderLocationOptions(document.getElementById('ro-origin'), query, 'origin');
    if (id === 'ro-dest-search') renderLocationOptions(document.getElementById('ro-dest'), query, 'destination');
  }

  function inferSeverity() {
    const live = DFIS.live && DFIS.live._cache ? DFIS.live._cache : {};
    const rainfall = live.rainfall?.currentMmHr || 0;
    const level = live.yamuna?.level || 0;
    const dangerLevel = DFIS.YAMUNA?.dangerLevel ?? (cityConfig().key === 'mumbai' ? 3.5 : 205.33);
    const warningLevel = DFIS.YAMUNA?.warningLevel ?? (cityConfig().key === 'mumbai' ? 2.8 : 204.8);
    if (rainfall >= 120 || level >= dangerLevel) return { level: 'severe', label: 'Auto severity: severe flood routing' };
    if (rainfall >= 75 || level >= warningLevel) return { level: 'high', label: 'Auto severity: high flood routing' };
    if (rainfall >= 35) return { level: 'moderate', label: 'Auto severity: moderate flood routing' };
    return { level: 'normal', label: 'Auto severity: normal operations' };
  }

  function calculateRoute() {
    buildLocations();
    const origin = document.getElementById('ro-origin')?.value;
    const destination = document.getElementById('ro-dest')?.value;
    const severity = document.getElementById('ro-severity')?.value || inferSeverity().level;
    if (!origin || !destination || !liveLocations[origin] || !liveLocations[destination]) return;

    DFIS.routeState = { origin, destination, severity, source: 'manual' };
    const model = {
      origin,
      destination,
      severity,
      originData: liveLocations[origin],
      destinationData: liveLocations[destination],
    };
    renderResult(model);
    renderMap(model);
  }

  function renderResult(model) {
    const result = document.getElementById('ro-result');
    if (!result) return;
    result.classList.add('show');
    const distanceKm = estimateDistanceKm(model.originData, model.destinationData);
    const etaMin = estimateTravelMinutes(distanceKm, model.severity);
    setText('ro-headline', `${model.originData.label} to ${model.destinationData.label}`);
    setText('ro-risk-pill', model.severity === 'severe' ? 'Severe flood reroute' : model.severity === 'high' ? 'High flood reroute' : model.severity === 'moderate' ? 'Moderate flood watch' : 'Primary corridor active');
    setText('ro-best-dist', `${distanceKm.toFixed(1)} km`);
    setText('ro-best-time', `${etaMin} min`);
    setText('ro-best-safety', getSafetyLabel(model.severity, model.destinationData));
    setText('ro-path', `${model.originData.label} -> ${model.destinationData.label}`);
    setText('ro-reason', buildReasonText(model));
    setText('ro-advisory', buildAdvisory(model));
    renderRibbon([model.originData.label, model.destinationData.label]);
    renderSteps(buildFallbackSteps(model));
  }

  function estimateDistanceKm(a, b) {
    const toRad = (v) => (v * Math.PI) / 180;
    const r = 6371;
    const dLat = toRad(b.lat - a.lat);
    const dLng = toRad(b.lng - a.lng);
    const x = Math.sin(dLat / 2) ** 2 + Math.cos(toRad(a.lat)) * Math.cos(toRad(b.lat)) * Math.sin(dLng / 2) ** 2;
    return 2 * r * Math.atan2(Math.sqrt(x), Math.sqrt(1 - x));
  }

  function estimateTravelMinutes(distanceKm, severity) {
    const multiplier = { normal: 2.2, moderate: 2.7, high: 3.1, severe: 3.7 }[severity] || 2.5;
    return Math.max(8, Math.round(distanceKm * multiplier));
  }

  function getSafetyLabel(severity, destination) {
    if (severity === 'severe' || destination.risk === 'critical') return 'Controlled high-risk approach';
    if (severity === 'high' || destination.risk === 'high') return 'Medium risk, rerouted';
    if (severity === 'moderate' || destination.risk === 'medium') return 'Low-to-medium risk';
    return 'Primary corridor clear';
  }

  function buildReasonText(model) {
    const basis = model.destinationData.isFallbackCoord
      ? 'using fallback route coordinates because the hotspot feed did not include full geolocation'
      : 'using current street routing where available';
    return `Route targets the selected live hotspot in ${model.destinationData.district || cityConfig().label} ${basis}.`;
  }

  function buildAdvisory(model) {
    return `${model.destinationData.label} is currently one of the active computed hotspots. Dispatch crews should verify local waterlogging before final approach.`;
  }

  function renderMap(model) {
    const wrap = document.getElementById('ro-map');
    if (!wrap) return;
    if (typeof L === 'undefined') {
      wrap.textContent = 'Leaflet failed to load.';
      return;
    }
    const city = cityConfig();
    if (map && mapHost !== wrap) {
      teardownMap();
    }
    if (!map) {
      wrap.textContent = '';
      map = L.map(wrap, { zoomControl: true, attributionControl: true }).setView([city.lat, city.lon], city.zoom || 11);
      mapHost = wrap;
      L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
        maxZoom: 18,
        attribution: '&copy; OpenStreetMap contributors',
      }).addTo(map);
      markerLayer = L.layerGroup().addTo(map);
      initRoutingControl();
    }
    setTimeout(() => map && map.invalidateSize(), 0);
    recenterToCity();

    markerLayer.clearLayers();
    if (fallbackRouteLine) {
      markerLayer.removeLayer(fallbackRouteLine);
      fallbackRouteLine = null;
    }

    Object.values(liveLocations).forEach((item) => {
      if (typeof item.lat !== 'number' || typeof item.lng !== 'number') return;
      const isOrigin = item.label === model.originData.label;
      const isDest = item.label === model.destinationData.label;
      const marker = L.circleMarker([item.lat, item.lng], {
        radius: isOrigin || isDest ? 8 : 5,
        weight: 2,
        color: isOrigin ? '#166534' : isDest ? '#991b1b' : '#1d4ed8',
        fillColor: isOrigin ? '#22c55e' : isDest ? '#ef4444' : '#60a5fa',
        fillOpacity: isOrigin || isDest ? 1 : 0.6,
      }).addTo(markerLayer);
      marker.bindPopup(`<strong>${item.label}</strong><br>${item.district || city.label}`);
    });

    if (routingControl) {
      routingControl.setWaypoints([
        L.latLng(model.originData.lat, model.originData.lng),
        L.latLng(model.destinationData.lat, model.destinationData.lng),
      ]);
    } else {
      renderFallbackRoute(model);
    }
  }

  function initRoutingControl() {
    if (!map || typeof L.Routing === 'undefined' || routingControl) return;
    routingControl = L.Routing.control({
      waypoints: [],
      addWaypoints: false,
      draggableWaypoints: false,
      fitSelectedRoutes: false,
      routeWhileDragging: false,
      show: false,
      lineOptions: {
        styles: [
          { color: '#1d4ed8', opacity: 0.95, weight: 8 },
          { color: '#93c5fd', opacity: 0.55, weight: 4 },
        ],
      },
      createMarker: () => null,
      router: L.Routing.osrmv1({
        serviceUrl: 'https://router.project-osrm.org/route/v1',
      }),
    }).addTo(map);

    if (routingControl.getContainer()) routingControl.getContainer().style.display = 'none';

    routingControl.on('routesfound', (event) => {
      const route = event.routes && event.routes[0];
      if (!route) return;
      const km = route.summary?.totalDistance ? route.summary.totalDistance / 1000 : 0;
      const min = route.summary?.totalTime ? Math.round(route.summary.totalTime / 60) : 0;
      setText('ro-best-dist', `${km.toFixed(1)} km`);
      setText('ro-best-time', `${Math.max(1, min)} min`);
      setText('ro-turn-label', 'OSRM street-level guidance');
      renderSteps(buildRoutingSteps(route.instructions || []));
      if (route.bounds) map.fitBounds(route.bounds, { padding: [30, 30] });
    });

    routingControl.on('routingerror', () => {
      const origin = liveLocations[DFIS.routeState.origin];
      const destination = liveLocations[DFIS.routeState.destination];
      if (origin && destination) {
        renderFallbackRoute({ originData: origin, destinationData: destination });
        setText('ro-turn-label', 'Fallback checkpoint guidance');
        renderSteps(buildFallbackSteps({ originData: origin, destinationData: destination }));
      }
    });
  }

  function renderFallbackRoute(model) {
    fallbackRouteLine = L.polyline([
      [model.originData.lat, model.originData.lng],
      [model.destinationData.lat, model.destinationData.lng],
    ], {
      color: '#1d4ed8',
      weight: 7,
      opacity: 0.95,
      dashArray: '10 6',
    }).addTo(markerLayer);
    map.fitBounds(fallbackRouteLine.getBounds(), { padding: [30, 30] });
  }

  function buildRoutingSteps(instructions) {
    if (!instructions.length) return [];
    return instructions.slice(0, 10).map((step, index) => ({
      index: index + 1,
      text: normalizeInstruction(step.text || 'Continue'),
      distance: typeof step.distance === 'number' ? `${(step.distance / 1000).toFixed(step.distance >= 1000 ? 1 : 2)} km` : '',
      time: typeof step.time === 'number' ? `${Math.max(1, Math.round(step.time / 60))} min` : '',
    }));
  }

  function buildFallbackSteps(model) {
    return [
      { index: 1, text: `Start from ${model.originData.label}`, distance: '', time: '' },
      { index: 2, text: `Proceed toward ${model.destinationData.district || cityConfig().label}`, distance: '', time: '' },
      { index: 3, text: `Arrive at ${model.destinationData.label}`, distance: '', time: '' },
    ];
  }

  function renderSteps(steps) {
    const el = document.getElementById('ro-steps');
    if (!el) return;
    if (!steps.length) {
      el.innerHTML = '<div class="ro-step"><div class="ro-stepnum">--</div><div class="ro-steptext">Directions will appear here after a route is calculated.</div></div>';
      return;
    }
    el.innerHTML = steps.map((step) => `
      <div class="ro-step">
        <div class="ro-stepnum">${step.index}</div>
        <div>
          <div class="ro-steptext">${step.text}</div>
          <div class="ro-stepmeta">${[step.distance, step.time].filter(Boolean).join(' • ')}</div>
        </div>
      </div>
    `).join('');
  }

  function renderRibbon(path) {
    const el = document.getElementById('ro-ribbon');
    if (!el) return;
    el.innerHTML = path.map((label, index) => {
      const cls = index === 0 ? 'ro-stop origin' : index === path.length - 1 ? 'ro-stop dest' : 'ro-stop';
      return `<div class="${cls}">${label}</div>`;
    }).join('');
  }

  function normalizeInstruction(text) {
    return text.replace(/\bHead\b/i, 'Proceed').replace(/\bwaypoint\b/ig, 'checkpoint');
  }

  function setText(id, value) {
    const el = document.getElementById(id);
    if (el) el.textContent = value;
  }

  function setSelectValue(id, value) {
    const el = document.getElementById(id);
    if (el) el.value = value;
  }

  function setScenario(state) {
    buildLocations();
    const fallbackDestination = Object.keys(liveLocations).find((key) => key !== 'CITY_CENTER') || 'CITY_CENTER';
    const resolveKey = (value, fallback) => {
      if (value && liveLocations[value]) return value;
      const text = (value || '').toLowerCase();
      const match = Object.entries(liveLocations).find(([, item]) =>
        item.label === value ||
        item.label.toLowerCase().includes(text) ||
        ((item.district || '').toLowerCase().includes(text) && item.kind === 'hotspot')
      );
      return match ? match[0] : fallback;
    };
    DFIS.routeState = {
      origin: resolveKey(state.origin, 'CITY_CENTER'),
      destination: resolveKey(state.destination, fallbackDestination),
      severity: state.severity || inferSeverity().level,
      source: state.source || 'simulator',
    };
  }

  return {
    init,
    calculateRoute,
    setScenario,
    locations: () => Object.keys(liveLocations),
    refreshLocations: populateLocationSelects,
    recenterToCity,
  };
})();
