'use strict';

window.DFIS = window.DFIS || {};

DFIS.simulator = {
  drainMode: 'full',
  _requestSeq: 0,
  _latestResult: null,

  DRAIN_FACTORS: {
    full: { runoff: 1.0, water: 1.0, label: 'Full Capacity', drain_condition: 1.0 },
    '75': { runoff: 1.12, water: 1.08, label: '75% Capacity', drain_condition: 0.75 },
    '50': { runoff: 1.28, water: 1.16, label: '50% Capacity', drain_condition: 0.5 },
    blocked: { runoff: 1.5, water: 1.28, label: 'Blocked Drains', drain_condition: 0.15 },
  },

  cityContext() {
    const city = DFIS.live?.getCurrentCityConfig?.() || { key: 'delhi', label: 'Delhi', waterBodyLabel: 'Yamuna River' };
    const live = DFIS.live?._cache || {};
    const water = live.modelYamuna || {};
    const currentLevel = water.current_level_m ?? live.yamuna?.level ?? (city.key === 'mumbai' ? 2.4 : city.key === 'sikkim' ? 6.0 : 204.5);
    const warningLevel = water.warning_level_m ?? (city.key === 'mumbai' ? 2.8 : city.key === 'sikkim' ? 9.0 : 204.5);
    const dangerLevel = water.danger_level_m ?? (city.key === 'mumbai' ? 3.5 : city.key === 'sikkim' ? 12.0 : 205.33);
    return {
      city,
      currentLevel,
      warningLevel,
      dangerLevel,
      waterLabel: city.waterBodyLabel || city.riverLabel || 'Water body',
    };
  },

  configureForCity() {
    const waterSlider = document.getElementById('sYamuna');
    if (!waterSlider) return;
    const context = DFIS.simulator.cityContext();
    const cityKey = context.city.key;
    const span = document.getElementById('sim-water-label');
    const desc = document.getElementById('sim-water-range-desc');
    const scenarioLabel = document.getElementById('simScenarioLabel');
    if (scenarioLabel && scenarioLabel.dataset.city !== cityKey) {
      delete scenarioLabel.dataset.userPreset;
      scenarioLabel.dataset.city = cityKey;
    }

    const step = cityKey === 'delhi' ? 1 : 5;
    const minLevel = cityKey === 'delhi'
      ? Math.max(190, Math.floor((context.warningLevel - 4.5) * 100))
      : Math.max(50, Math.floor((context.warningLevel * 0.45) * 100));
    const maxLevel = cityKey === 'delhi'
      ? Math.max(minLevel + 500, Math.ceil((context.dangerLevel + 3.5) * 100))
      : Math.max(minLevel + 200, Math.ceil((context.dangerLevel * 1.8) * 100));
    const current = Math.round(context.currentLevel * 100);

    waterSlider.min = String(minLevel);
    waterSlider.max = String(maxLevel);
    waterSlider.step = String(step);
    if (!Number.isFinite(+waterSlider.value) || +waterSlider.value < minLevel || +waterSlider.value > maxLevel) {
      waterSlider.value = String(Math.min(maxLevel, Math.max(minLevel, current)));
    }

    if (span) span.textContent = context.waterLabel + ' Level at Start';
    if (desc) desc.textContent = `Warning ${context.warningLevel.toFixed(2)} m · Danger ${context.dangerLevel.toFixed(2)} m`;
    if (scenarioLabel && !scenarioLabel.dataset.userPreset) scenarioLabel.textContent = `${context.city.label} Custom Scenario`;
  },

  setDrain(v, opts = {}) {
    DFIS.simulator.drainMode = v;
    ['full', '75', '50', 'blocked'].forEach((k) => {
      const el = document.getElementById('dchip-' + k);
      if (el) el.classList.toggle('active', k === v);
    });
    if (!opts.silent) DFIS.simulator.run();
  },

  loadPreset(p) {
    const label = document.getElementById('simScenarioLabel');
    if (label) label.dataset.userPreset = 'true';
    const context = DFIS.simulator.cityContext();
    const waterLevel = context.currentLevel;
    const warning = context.warningLevel;
    const danger = context.dangerLevel;
    const baseRain = DFIS.live?._cache?.modelRainfall?.forecast_peak_mm_hr ?? DFIS.live?._cache?.rainfall?.next24PeakMmHr ?? 20;
    const heavyRain = context.city.key === 'mumbai' ? Math.max(90, baseRain * 1.5) : context.city.key === 'sikkim' ? Math.max(75, baseRain * 1.55) : Math.max(110, baseRain * 1.7);
    const extremeRain = context.city.key === 'mumbai' ? Math.max(140, baseRain * 2.1) : context.city.key === 'sikkim' ? Math.max(120, baseRain * 2.0) : Math.max(180, baseRain * 2.2);
    if (p === '2023') {
      document.getElementById('sRain').value = Math.round(heavyRain);
      document.getElementById('sDur').value = context.city.key === 'mumbai' ? 6 : context.city.key === 'sikkim' ? 7 : 8;
      document.getElementById('sYamuna').value = Math.round((warning + Math.max(0, danger - warning) * 0.25) * 100);
      document.getElementById('sSoil').value = 90;
      DFIS.simulator.setDrain('50', { silent: true });
      if (label) label.textContent = 'Heavy Rain Event';
    } else if (p === 'extreme') {
      document.getElementById('sRain').value = Math.round(extremeRain);
      document.getElementById('sDur').value = context.city.key === 'mumbai' ? 12 : context.city.key === 'sikkim' ? 14 : 18;
      document.getElementById('sYamuna').value = Math.round((danger + Math.max(0.15, (danger - warning) * 0.45)) * 100);
      document.getElementById('sSoil').value = 100;
      DFIS.simulator.setDrain('blocked', { silent: true });
      if (label) label.textContent = 'Extreme Flood Event';
    } else {
      document.getElementById('sRain').value = Math.round(Math.max(25, baseRain || 25));
      document.getElementById('sDur').value = 4;
      document.getElementById('sYamuna').value = Math.round(waterLevel * 100);
      document.getElementById('sSoil').value = 50;
      DFIS.simulator.setDrain('full', { silent: true });
      if (label) label.textContent = 'Normal Scenario';
    }
    DFIS.simulator.run();
  },

  _getInputs() {
    return {
      rain: +document.getElementById('sRain').value,
      dur: +document.getElementById('sDur').value,
      water: +document.getElementById('sYamuna').value / 100,
      soil: +document.getElementById('sSoil').value,
    };
  },

  _syncSliderLabels(inputs) {
    DFIS.simulator.configureForCity();
    const setV = (id, val) => {
      const el = document.getElementById(id);
      if (el) el.textContent = val;
    };
    setV('sRainVal', inputs.rain + ' mm/hr');
    setV('sDurVal', inputs.dur + ' hrs');
    setV('sYamunaVal', inputs.water.toFixed(2) + ' m');
    setV('sSoilVal', inputs.soil + '%');
  },

  _getScenarioAdjustedInputs(inputs) {
    const factors = DFIS.simulator.DRAIN_FACTORS[DFIS.simulator.drainMode] || DFIS.simulator.DRAIN_FACTORS.full;
    const live = DFIS.live?._cache || {};
    const cityKey = DFIS.live?.currentCity || 'delhi';
    const liveRain = live.rainfall?.currentMmHr ?? inputs.rain;
    const liveWater = live.modelYamuna?.current_level_m ?? live.yamuna?.level ?? inputs.water;
    const liveSoil = live.soil?.pct ?? inputs.soil;

    const durationLoad = 1 + Math.max(0, inputs.dur - 3) * 0.045;
    const soilCarry = Math.max(0, inputs.dur - 2) * 0.7;
    const rainScenario = Math.max(inputs.rain, liveRain * 0.6);
    const maxRain = cityKey === 'mumbai' ? 180 : cityKey === 'sikkim' ? 160 : 250;
    const waterDurationMultiplier = cityKey === 'mumbai' ? 0.08 : cityKey === 'sikkim' ? 0.14 : 0.12;
    const effectiveRain = Math.min(maxRain, +(rainScenario * durationLoad * factors.runoff).toFixed(2));
    const effectiveWater = +(Math.max(inputs.water, liveWater) * (1 + (inputs.dur / 24) * waterDurationMultiplier) * factors.water).toFixed(2);
    const effectiveSoil = Math.min(100, Math.round(Math.max(inputs.soil, liveSoil) + soilCarry + (factors.runoff - 1) * 18));

    return {
      rainfall_mm: effectiveRain,
      yamuna_level: effectiveWater,
      soil_saturation: effectiveSoil,
      duration_hours: inputs.dur,
      drain_label: factors.label,
      drain_condition: factors.drain_condition,
      drain_factors: factors,
    };
  },

  async _simulateScenario(adjusted) {
    const baseUrl = DFIS.live?.API_BASE || '';
    const response = await fetch(baseUrl + '/simulate', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        rainfall_mm: adjusted.rainfall_mm,
        duration_hr: adjusted.duration_hours,
        yamuna_level: adjusted.yamuna_level,
        soil_saturation: adjusted.soil_saturation,
        drain_condition: adjusted.drain_condition,
        city: DFIS.live?.currentCity || 'delhi',
      }),
    });
    if (!response.ok) {
      throw new Error('/simulate ' + response.status);
    }
    return response.json();
  },

  _severityFromProbability(probability) {
    if (probability >= 0.75) return 'severe';
    if (probability >= 0.5) return 'high';
    if (probability >= 0.28) return 'moderate';
    return 'normal';
  },

  _fallbackScenarioMetrics(adjusted, probability) {
    const context = DFIS.simulator.cityContext();
    const warningLevel = context.warningLevel;
    const hotspotCount = Math.max(8, DFIS.CITY?.hotspots || DFIS.HOTSPOTS?.length || 8);
    const zoneCap = Math.max(24, Math.min(600, hotspotCount * 6));
    const waterPressure = Math.max(0, adjusted.yamuna_level - warningLevel) * 22;
    const rainPressure = adjusted.rainfall_mm * 1.45;
    const soilPressure = adjusted.soil_saturation * 1.1;
    const durationPressure = adjusted.duration_hours * 11;
    const drainPenalty = (1 - (adjusted.drain_condition || 1)) * 140;
    const pressureScore = rainPressure + soilPressure + durationPressure + waterPressure + drainPenalty;
    const floodedZones = Math.max(8, Math.min(zoneCap, Math.round(pressureScore * (0.42 + probability * 0.4))));
    const highRiskCells = Math.max(4, Math.min(floodedZones, Math.round(floodedZones * (0.28 + probability * 0.22))));
    const populationFactor = context.city.key === 'mumbai' ? 4.4 : context.city.key === 'sikkim' ? 1.3 : 3.2;
    const exposedPopulationK = Math.max(4, Math.round(highRiskCells * populationFactor));
    const warningLeadHours = Math.max(
      0.8,
      +(8.8 - (adjusted.duration_hours * 0.18) - (probability * 3.1) - ((1 - (adjusted.drain_condition || 1)) * 2.6)).toFixed(1)
    );
    return {
      floodedZones,
      highRiskCells,
      exposedPopulationK,
      warningLeadHours,
    };
  },

  _computeOutputs(simulation, adjusted) {
    const prediction = simulation?.prediction || {};
    const impact = simulation?.impact_estimate || {};
    const probability = Math.max(0, Math.min(1, +(prediction.flood_probability ?? 0)));
    const backendAffectedCells = Math.max(0, Number(impact.affected_cells ?? 0));
    const backendHighRiskCells = Math.max(0, Number(impact.high_risk_cells ?? 0));
    const wardCount = Math.max(1, DFIS.CITY?.wards || DFIS.WARDS?.length || 1);
    let affectedCells = backendAffectedCells;
    let highRiskCells = backendHighRiskCells;
    let exposedPopulationK = Math.max(
      0,
      Math.round(backendHighRiskCells * Math.max(1.5, Math.min(7.5, wardCount * 0.05)) * (0.16 + probability * 0.34))
    );
    let warningLeadHours = Math.max(
      0.5,
      +(7.5 - (probability * 4.2) - (adjusted.duration_hours * 0.12) - ((adjusted.drain_factors.runoff || 1) - 1) * 1.8).toFixed(1)
    );

    const shouldUseFallback =
      !Number.isFinite(affectedCells) ||
      !Number.isFinite(highRiskCells) ||
      !Number.isFinite(exposedPopulationK) ||
      !Number.isFinite(warningLeadHours) ||
      (probability >= 0.6 && affectedCells === 0);

    if (shouldUseFallback) {
      const fallback = DFIS.simulator._fallbackScenarioMetrics(adjusted, probability);
      affectedCells = fallback.floodedZones;
      highRiskCells = fallback.highRiskCells;
      exposedPopulationK = fallback.exposedPopulationK;
      warningLeadHours = fallback.warningLeadHours;
    }

    return {
      probability,
      floodedZones: affectedCells,
      highRiskCells,
      exposedPopulationK,
      warningLeadHours,
      severity: DFIS.simulator._severityFromProbability(probability),
      prediction,
      impact,
    };
  },

  getRouteRecommendation() {
    const result = DFIS.simulator._latestResult;
    const simTop = result?.impact?.top_hotspots?.[0] || null;
    const hotspots = DFIS.HOTSPOTS || [];
    const top = simTop
      ? {
          loc: simTop.name || simTop.cell_id || 'Top hotspot',
          dist: simTop.district || 'Unknown',
        }
      : (hotspots.find((h) => h.risk === 'critical') || hotspots[0]);
    return {
      origin: 'CITY_CENTER',
      destination: top ? top.loc : 'CITY_CENTER',
      severity: result?.severity || 'normal',
      hotspot: top,
    };
  },

  openRoutePlan() {
    const rec = DFIS.simulator.getRouteRecommendation();
    if (DFIS.routes && typeof DFIS.routes.setScenario === 'function') {
      DFIS.routes.setScenario({
        origin: rec.origin,
        destination: rec.destination,
        severity: rec.severity,
        source: 'simulator',
      });
    } else {
      DFIS.routeState = {
        origin: rec.origin,
        destination: rec.destination,
        severity: rec.severity,
        source: 'simulator',
      };
    }
    if (DFIS.app && typeof DFIS.app.showPage === 'function') DFIS.app.showPage('routes');
  },

  _renderActions(inputs, adjusted, result) {
    const acts = [];
    const probabilityPct = Math.round(result.probability * 100);
    const riskLevel = (result.prediction?.risk_level || 'LOW').toUpperCase();
    const routeRec = DFIS.simulator.getRouteRecommendation();
    const context = DFIS.simulator.cityContext();

    acts.push({ icon: 'MODEL', t: `Model-estimated flood probability is ${probabilityPct}% under this ${inputs.dur}h scenario (${riskLevel}).` });

    if (adjusted.rainfall_mm >= 120) acts.push({ icon: 'RAIN', t: `Scenario-adjusted rainfall reaches ${adjusted.rainfall_mm} mm/hr, which materially increases surface runoff.` });
    if (adjusted.yamuna_level >= context.warningLevel) acts.push({ icon: 'WATER', t: `${context.waterLabel} rises to ${adjusted.yamuna_level.toFixed(2)} m in this scenario, increasing flood-stage pressure.` });
    if (DFIS.simulator.drainMode === 'blocked' || DFIS.simulator.drainMode === '50') acts.push({ icon: 'DRAIN', t: `${adjusted.drain_label} sharply reduces drainage performance and shortens warning lead time.` });
    if (adjusted.soil_saturation >= 85) acts.push({ icon: 'SOIL', t: `Soil saturation climbs to ${adjusted.soil_saturation}%, so additional rainfall is more likely to convert into runoff.` });
    if (routeRec.hotspot) acts.push({ icon: 'ROUTE', t: `Recommended dispatch target: ${routeRec.hotspot.loc} (${routeRec.hotspot.dist}) with ${routeRec.severity} routing priority.`, cta: 'Open optimized route' });
    if (acts.length === 1) acts.push({ icon: 'SAFE', t: 'Low risk — routine monitoring sufficient under the current model scenario.' });

    const actEl = document.getElementById('simActions');
    if (!actEl) return;
    actEl.className = 'sim-out';
    actEl.innerHTML = acts.map((a) => {
      const button = a.cta ? `<button class="chip active" style="margin-left:auto;padding:8px 12px" onclick="DFIS.simulator.openRoutePlan()">${a.cta}</button>` : '';
      return `<div class="sim-out-row" style="display:flex;align-items:center;gap:10px;justify-content:space-between"><span>${a.icon} ${a.t}</span>${button}</div>`;
    }).join('');
  },

  _renderDistrictImpact(result) {
    const di = document.getElementById('distImpact');
    if (!di) return;
    const groups = (DFIS.DISTRICTS || []).slice(0, 10);
    if (!groups.length) {
      di.innerHTML = `<div style="font-size:12px;color:var(--muted)">No district impact data is available until hotspot and ward data load from the backend.</div>`;
      return;
    }
    di.innerHTML = groups.map((district) => {
      const existingPressure = (district.critical || 0) / Math.max(1, district.total || 1);
      const pct = Math.max(0, Math.min(100, Math.round((existingPressure * 0.55 + result.probability * 0.45) * 100)));
      const color = DFIS.utils.scoreColor(100 - pct);
      return `
        <div style="display:flex;align-items:center;gap:10px;font-size:12px;margin-bottom:6px">
          <div style="min-width:110px;color:var(--muted)">${district.name}</div>
          <div style="flex:1;height:6px;background:var(--rim);border-radius:3px;overflow:hidden">
            <div style="height:100%;width:${pct}%;background:${color};border-radius:3px;transition:width 0.6s"></div>
          </div>
          <div style="min-width:38px;text-align:right;font-family:var(--font-mono);font-size:11px;color:${color}">${pct}%</div>
        </div>`;
    }).join('');
  },

  _renderError(message) {
    const set = (id, value) => {
      const el = document.getElementById(id);
      if (el) el.textContent = value;
    };
    set('outZones', '0');
    set('outPop', '0');
    set('outWarning', '0H');
    const actEl = document.getElementById('simActions');
    if (actEl) {
      actEl.className = 'sim-out';
      actEl.innerHTML = `<div class="sim-out-row"><span>SIMULATOR ${message}</span></div>`;
    }
    const di = document.getElementById('distImpact');
    if (di) di.innerHTML = `<div style="font-size:12px;color:var(--muted)">Area impact is unavailable because the backend simulator route could not be reached.</div>`;
  },

  async run() {
    DFIS.simulator.configureForCity();
    const inputs = DFIS.simulator._getInputs();
    DFIS.simulator._syncSliderLabels(inputs);

    const set = (id, value) => {
      const el = document.getElementById(id);
      if (el) el.textContent = value;
    };
    set('outZones', '...');
    set('outPop', '...');
    set('outWarning', '...');

    const seq = ++DFIS.simulator._requestSeq;
    const adjusted = DFIS.simulator._getScenarioAdjustedInputs(inputs);

    try {
      const simulation = await DFIS.simulator._simulateScenario(adjusted);
      if (seq !== DFIS.simulator._requestSeq) return;

      const result = DFIS.simulator._computeOutputs(simulation, adjusted);
      DFIS.simulator._latestResult = result;

      set('outZones', result.floodedZones.toLocaleString());
      set('outPop', result.exposedPopulationK >= 100 ? (result.exposedPopulationK / 100).toFixed(1) + 'L' : result.exposedPopulationK + 'K');
      set('outWarning', result.warningLeadHours.toFixed(1) + 'H');

      DFIS.simulator._renderActions(inputs, adjusted, result);
      DFIS.simulator._renderDistrictImpact(result);
    } catch (_) {
      if (seq !== DFIS.simulator._requestSeq) return;
      DFIS.simulator._latestResult = null;
      DFIS.simulator._renderError('Backend /simulate is unavailable right now.');
    }
  },
};
