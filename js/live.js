/* ============================================================
   Dhristi
   js/live.js - Multi-city live data engine
   ============================================================ */

'use strict';

window.DFIS = window.DFIS || {};

DFIS.live = {
  REFRESH_MS: 5 * 60 * 1000,
  STORAGE_KEY: 'dfis_active_city',
  SNAPSHOT_KEY: 'dfis_city_snapshot',
  API_BASE: (() => {
    const hostname = window.location.hostname || '127.0.0.1';
    const protocol = window.location.protocol === 'file:' ? 'http:' : window.location.protocol;
    return `${protocol}//${hostname}:8000`;
  })(),
  currentCity: 'delhi',
  _cache: null,
  _cityCache: {},
  _timer: null,
  _listeners: [],
  _requestSeq: 0,

  CITIES: {
    delhi: {
      key: 'delhi',
      label: 'Delhi',
      fullName: 'Delhi NCT',
      lat: 28.6139,
      lon: 77.2090,
      zoom: 11,
      wards: 272,
      districts: 11,
      areaKm2: 1484,
      riverLabel: 'Yamuna',
      waterBodyLabel: 'Yamuna River',
      stationLabel: 'Delhi live weather',
      agency: 'DDMA',
    },
    mumbai: {
      key: 'mumbai',
      label: 'Mumbai',
      fullName: 'Mumbai',
      lat: 19.0760,
      lon: 72.8777,
      zoom: 11,
      wards: 24,
      districts: 6,
      areaKm2: 603,
      riverLabel: 'Arabian Sea',
      waterBodyLabel: 'Arabian Sea',
      stationLabel: 'Mumbai marine and weather',
      agency: 'BMC',
    },
    sikkim: {
      key: 'sikkim',
      label: 'Sikkim',
      fullName: 'Sikkim',
      lat: 27.45,
      lon: 88.5,
      zoom: 9,
      wards: 0,
      districts: 0,
      areaKm2: 0,
      riverLabel: 'Teesta',
      waterBodyLabel: 'Teesta River',
      stationLabel: 'Teesta basin live weather',
      agency: 'SSDMA',
    },
  },

  start() {
    DFIS.live.currentCity = DFIS.live._loadSavedCity();
    DFIS.live._cache = DFIS.live._loadSnapshot(DFIS.live.currentCity);
    if (DFIS.live._cache) {
      DFIS.live._cityCache[DFIS.live.currentCity] = DFIS.live._cache;
    }
    const citySelect = document.getElementById('citySelect');
    if (citySelect) {
      citySelect.value = DFIS.live.currentCity;
      if (!citySelect.dataset.boundLiveCity) {
        citySelect.addEventListener('change', (event) => {
          DFIS.live.setCity(event.target.value);
        });
        citySelect.dataset.boundLiveCity = 'true';
      }
    }

    DFIS.live._updateShell();
    if (DFIS.live._cache) {
      DFIS.live._applyToGlobalData(DFIS.live._cache);
      DFIS.live._updateDOM(DFIS.live._cache);
      DFIS.live._updateStatus('loading', null);
    } else {
      DFIS.live._updateStatus('loading', null);
    }
    DFIS.live.fetchAll();
    if (DFIS.live._timer) clearInterval(DFIS.live._timer);
    DFIS.live._timer = setInterval(() => DFIS.live.fetchAll(), DFIS.live.REFRESH_MS);
  },

  onUpdate(fn) {
    if (typeof fn === 'function') DFIS.live._listeners.push(fn);
  },

  getCurrentCityConfig() {
    return DFIS.live.CITIES[DFIS.live.currentCity] || DFIS.live.CITIES.delhi;
  },

  _loadSavedCity() {
    try {
      const saved = localStorage.getItem(DFIS.live.STORAGE_KEY);
      if (saved && DFIS.live.CITIES[saved]) return saved;
    } catch (e) {}
    return DFIS.live.CITIES[DFIS.live.currentCity] ? DFIS.live.currentCity : 'delhi';
  },

  _saveCity(city) {
    try {
      localStorage.setItem(DFIS.live.STORAGE_KEY, city);
    } catch (e) {}
  },

  _loadSnapshot(city) {
    try {
      const raw = sessionStorage.getItem(DFIS.live.SNAPSHOT_KEY + '_' + city);
      if (!raw) return null;
      const parsed = JSON.parse(raw);
      return parsed && parsed.city === city ? parsed : null;
    } catch (e) {
      return null;
    }
  },

  _saveSnapshot(city, data) {
    try {
      sessionStorage.setItem(DFIS.live.SNAPSHOT_KEY + '_' + city, JSON.stringify(data));
    } catch (e) {}
  },

  setCity(city) {
    const normalised = DFIS.live.CITIES[city] ? city : 'delhi';
    DFIS.live._saveCity(normalised);
    if (normalised === DFIS.live.currentCity && DFIS.live._cache) {
      DFIS.live._updateShell();
      DFIS.live._updateDOM(DFIS.live._cache);
      return;
    }
    DFIS.live.currentCity = normalised;
    DFIS.live._cache = DFIS.live._cityCache[normalised] || null;
    const citySelect = document.getElementById('citySelect');
    if (citySelect && citySelect.value !== normalised) citySelect.value = normalised;
    DFIS.live._updateShell();
    if (DFIS.live._cache) {
      DFIS.live._applyToGlobalData(DFIS.live._cache);
      DFIS.live._updateDOM(DFIS.live._cache);
      DFIS.live._updateStatus('loading', null);
    } else {
      DFIS.live._updateStatus('loading', null);
    }
    DFIS.map?.recenterToCity?.();
    DFIS.routes?.recenterToCity?.();
    DFIS.live.fetchAll();
  },

  async fetchAll() {
    const requestSeq = ++DFIS.live._requestSeq;
    const targetCity = DFIS.live.currentCity;
    try {
      if (targetCity === 'sikkim') {
        const data = await DFIS.live._fetchSikkimBundle();
        if (!DFIS.live._shouldApplyRequest(requestSeq, targetCity)) return;
        DFIS.live._commitData(targetCity, data, data.backend?.online ? 'live' : 'error');
        return;
      }
      const [weather, flood] = await Promise.all([
        DFIS.live._fetchWeather(),
        DFIS.live._fetchFlood(),
      ]);
      const data = DFIS.live._process(weather, flood);
      await DFIS.live._hydrateModelData(data);
      if (!DFIS.live._shouldApplyRequest(requestSeq, targetCity)) return;

      DFIS.live._commitData(targetCity, data, data.backend?.online ? 'live' : 'error');
    } catch (err) {
      if (!DFIS.live._shouldApplyRequest(requestSeq, targetCity)) return;
      console.warn('[Dhristi Live] API error:', err.message);
      DFIS.live._updateStatus('error', null);
    }
  },

  async _fetchSikkimBundle() {
    const [status, rainfall, yamuna, hotspots, wards, alerts] = await Promise.all([
      DFIS.live._fetchJson('/status'),
      DFIS.live._fetchJson('/rainfall'),
      DFIS.live._fetchJson('/yamuna'),
      DFIS.live._fetchJson('/hotspots', { limit: 5000 }),
      DFIS.live._fetchJson('/wards'),
      DFIS.live._fetchJson('/alerts'),
    ]);
    DFIS.live._updateCityFromProfile(status?.city_profile);
    const liveInputs = status?.live_inputs || {};
    const readinessRows = wards?.wards || [];
    const readinessAvg = readinessRows.length
      ? Math.round(readinessRows.reduce((sum, row) => sum + (+row.readiness_score || 0), 0) / readinessRows.length)
      : 0;
    return {
      city: 'sikkim',
      ts: status?.timestamp || new Date().toISOString(),
      horizonHours: status?.metrics?.prediction_horizon_hours || 24,
      rainfall: {
        currentMmHr: rainfall?.current_mm_hr ?? 0,
        next24Mm: rainfall?.next_24h_total_mm ?? 0,
        following24Mm: rainfall?.following_24h_total_mm ?? 0,
        next24PeakMmHr: rainfall?.forecast_peak_mm_hr ?? 0,
        rainProb: rainfall?.rain_probability ?? 0,
        chartVals: rainfall?.chart_vals || [],
        chartHours: rainfall?.chart_hours || [],
        intensity: DFIS.live._category(rainfall?.forecast_peak_mm_hr ?? 0),
      },
      yamuna: {
        level: yamuna?.current_level_m ?? 0,
        forecastPeakLevel: yamuna?.forecast_peak_level_24h_m ?? 0,
        status: yamuna?.status || 'NORMAL',
        discharge: yamuna?.discharge_m3s ?? null,
        trend: '24h forecast window',
      },
      soil: {
        pct: liveInputs?.soil_pct ?? 0,
        raw: liveInputs?.soil_raw ?? 0,
      },
      weather: {
        tempC: liveInputs?.temperature_c ?? null,
        humidity: liveInputs?.humidity_pct ?? null,
        windKmh: liveInputs?.wind_kmh ?? null,
      },
      readiness: readinessAvg,
      alerts: [],
      backend: { online: true, status },
      prediction: status?.city_prediction || rainfall?.flood_risk || yamuna?.flood_risk || null,
      modelHotspots: hotspots?.hotspots || [],
      modelHotspotMeta: hotspots || null,
      modelWards: readinessRows,
      modelAlerts: alerts?.alerts || [],
      modelYamuna: yamuna || null,
      modelRainfall: rainfall || null,
    };
  },

  _updateCityFromProfile(profile) {
    if (!profile || !DFIS.live.CITIES.sikkim) return;
    DFIS.live.CITIES.sikkim = {
      ...DFIS.live.CITIES.sikkim,
      label: profile.label || DFIS.live.CITIES.sikkim.label,
      fullName: profile.full_name || DFIS.live.CITIES.sikkim.fullName,
      lat: typeof profile.lat === 'number' ? profile.lat : DFIS.live.CITIES.sikkim.lat,
      lon: typeof profile.lon === 'number' ? profile.lon : DFIS.live.CITIES.sikkim.lon,
      zoom: profile.zoom || DFIS.live.CITIES.sikkim.zoom,
      wards: profile.wards || DFIS.live.CITIES.sikkim.wards,
      districts: profile.districts || DFIS.live.CITIES.sikkim.districts,
      areaKm2: profile.area_km2 || DFIS.live.CITIES.sikkim.areaKm2,
      riverLabel: profile.river_label || DFIS.live.CITIES.sikkim.riverLabel,
      waterBodyLabel: profile.water_body_label || DFIS.live.CITIES.sikkim.waterBodyLabel,
      stationLabel: profile.station_label || DFIS.live.CITIES.sikkim.stationLabel,
      agency: profile.agency || DFIS.live.CITIES.sikkim.agency,
    };
    DFIS.live._updateShell();
    DFIS.map?.recenterToCity?.();
    DFIS.routes?.recenterToCity?.();
  },

  async _fetchWeather() {
    const city = DFIS.live.getCurrentCityConfig();
    const params = new URLSearchParams({
      latitude: city.lat,
      longitude: city.lon,
      current: 'precipitation,rain,temperature_2m,relative_humidity_2m,wind_speed_10m',
      hourly: 'precipitation,rain,soil_moisture_0_to_1cm',
      daily: 'precipitation_sum,precipitation_probability_max',
      timezone: 'Asia/Kolkata',
      forecast_days: '2',
    });
    const r = await fetch('https://api.open-meteo.com/v1/forecast?' + params);
    if (!r.ok) throw new Error('Weather API ' + r.status);
    return r.json();
  },

  async _fetchFlood() {
    const city = DFIS.live.getCurrentCityConfig();
    const params = new URLSearchParams({
      latitude: city.lat,
      longitude: city.lon,
      daily: 'river_discharge',
      forecast_days: '3',
    });
    const r = await fetch('https://flood-api.open-meteo.com/v1/flood?' + params);
    if (!r.ok) throw new Error('Flood API ' + r.status);
    return r.json();
  },

  async _fetchJson(path, extras = {}) {
    const params = new URLSearchParams({ city: DFIS.live.currentCity, ...extras });
    const joiner = path.includes('?') ? '&' : '?';
    const r = await fetch(DFIS.live.API_BASE + path + joiner + params.toString());
    if (!r.ok) throw new Error(path + ' ' + r.status);
    return r.json();
  },

  async _hydrateModelData(data) {
    data.backend = { online: false };
    data.prediction = null;
    data.modelAlerts = [];
    data.modelHotspots = [];
    data.modelHotspotMeta = null;
    data.modelWards = [];
    data.modelYamuna = null;
    data.modelRainfall = null;

    try {
      const [status, prediction, hotspots, wards, alerts, yamuna, rainfall] = await Promise.all([
        DFIS.live._fetchJson('/status'),
        DFIS.live._fetchJson('/predict', {
          rainfall_mm: data.rainfall.next24PeakMmHr,
          rainfall_total_mm: data.rainfall.next24Mm,
          yamuna_level: data.yamuna.forecastPeakLevel,
          soil_saturation: data.soil.pct,
        }),
        DFIS.live._fetchJson('/hotspots', { limit: 5000 }),
        DFIS.live._fetchJson('/wards'),
        DFIS.live._fetchJson('/alerts'),
        DFIS.live._fetchJson('/yamuna'),
        DFIS.live._fetchJson('/rainfall'),
      ]);

      data.backend = { online: true, status };
      data.prediction = prediction || null;
      data.modelHotspots = hotspots?.hotspots || [];
      data.modelHotspotMeta = hotspots || null;
      data.modelWards = wards?.wards || [];
      data.modelAlerts = alerts?.alerts || [];
      data.modelYamuna = yamuna || null;
      data.modelRainfall = rainfall || null;
    } catch (e) {
      console.warn('[Dhristi Live] Model API unavailable:', e.message);
    }
  },

  _shouldApplyRequest(requestSeq, targetCity) {
    return requestSeq === DFIS.live._requestSeq && targetCity === DFIS.live.currentCity;
  },

  _commitData(targetCity, data, state) {
    DFIS.live._cache = data;
    DFIS.live._cityCache[targetCity] = data;
    DFIS.live._saveSnapshot(targetCity, data);
    DFIS.live._applyToGlobalData(data);
    DFIS.live._updateDOM(data);
    DFIS.live._updateStatus(state, new Date());
  },

  _process(weather, flood) {
    const city = DFIS.live.getCurrentCityConfig();
    const nowIST = new Date(new Date().toLocaleString('en-US', { timeZone: 'Asia/Kolkata' }));
    const hIdx = nowIST.getHours();
    const hourlyPrecip = weather.hourly?.precipitation || [];
    const soilArr = weather.hourly?.soil_moisture_0_to_1cm || [];
    const next24Vals = hourlyPrecip.slice(hIdx, hIdx + 24);
    const following24Vals = hourlyPrecip.slice(hIdx + 24, hIdx + 48);

    const currentMmHr = +(weather.current?.precipitation ?? hourlyPrecip[hIdx] ?? 0).toFixed(1);
    const next24Mm = +next24Vals.reduce((sum, value) => sum + (+value || 0), 0).toFixed(1);
    const following24Mm = +following24Vals.reduce((sum, value) => sum + (+value || 0), 0).toFixed(1);
    const next24PeakMmHr = +(next24Vals.length ? Math.max(...next24Vals.map((v) => +v || 0)) : currentMmHr).toFixed(1);
    const rainProb = Math.max(weather.daily?.precipitation_probability_max?.[0] ?? 0, weather.daily?.precipitation_probability_max?.[1] ?? 0);
    const soilRaw = soilArr[hIdx] ?? 0.55;
    const soilPct = Math.round(soilRaw * 100);

    const chartVals = [];
    const chartHours = [];
    for (let i = 0; i < 24; i += 2) {
      chartVals.push(+(hourlyPrecip[i] ?? 0).toFixed(1));
      chartHours.push(String(i).padStart(2, '0'));
    }

    const discharge = flood.daily?.river_discharge?.[0] ?? null;
    const dischargeNext = flood.daily?.river_discharge?.[1] ?? discharge;
    const dischargeForecast = Math.max(discharge ?? 0, dischargeNext ?? 0);
    const fallbackLevel = city.key === 'mumbai' ? 2.4 : 204.83;
    const currentLevel = discharge != null
      ? +(city.key === 'mumbai'
        ? Math.min(4.2, Math.max(1.0, 1.3 + discharge / 1400))
        : Math.min(208.0, Math.max(201.5, 200 + discharge / 1350))).toFixed(2)
      : fallbackLevel;
    const forecastPeakLevel = dischargeForecast != null
      ? +(city.key === 'mumbai'
        ? Math.min(4.2, Math.max(1.0, 1.3 + dischargeForecast / 1400))
        : Math.min(208.0, Math.max(201.5, 200 + dischargeForecast / 1350))).toFixed(2)
      : fallbackLevel;
    const warningLevel = city.key === 'mumbai' ? 2.8 : 204.50;
    const dangerLevel = city.key === 'mumbai' ? 3.5 : 205.33;
    const waterStatus = forecastPeakLevel >= dangerLevel ? 'DANGER' : forecastPeakLevel >= warningLevel ? 'WARNING' : 'NORMAL';

    return {
      city: city.key,
      ts: new Date().toISOString(),
      horizonHours: 24,
      rainfall: { currentMmHr, next24Mm, following24Mm, next24PeakMmHr, rainProb, chartVals, chartHours, intensity: DFIS.live._category(next24PeakMmHr) },
      yamuna: { level: currentLevel, forecastPeakLevel, status: waterStatus, discharge, trend: '24h forecast window' },
      soil: { pct: soilPct, raw: soilRaw },
      weather: {
        tempC: weather.current?.temperature_2m ?? null,
        humidity: weather.current?.relative_humidity_2m ?? null,
        windKmh: weather.current?.wind_speed_10m ?? null,
      },
      readiness: Math.max(10, 100 - Math.round(next24PeakMmHr * 1.2) - Math.round(soilPct * 0.25)),
      alerts: [],
    };
  },

  _category(mmhr) {
    if (mmhr > 100) return { label: 'EXTREME', color: '#dc2626' };
    if (mmhr > 64) return { label: 'VERY HEAVY', color: '#f43f5e' };
    if (mmhr > 35) return { label: 'HEAVY', color: '#f97316' };
    if (mmhr > 7.5) return { label: 'MODERATE', color: '#facc15' };
    if (mmhr > 0) return { label: 'LIGHT', color: '#4ade80' };
    return { label: 'NONE / DRY', color: '#4d6a8a' };
  },

  _applyToGlobalData(d) {
    const liveLevel = d.modelYamuna?.current_level_m ?? d.yamuna.level;
    const liveStatus = d.modelYamuna?.status ?? d.yamuna.status;
    const forecastPeakLevel = d.modelYamuna?.forecast_peak_level_24h_m ?? d.yamuna.forecastPeakLevel;
    const warningLevel = d.modelYamuna?.warning_level_m ?? (DFIS.live.getCurrentCityConfig().key === 'mumbai' ? 2.8 : 204.50);
    const dangerLevel = d.modelYamuna?.danger_level_m ?? (DFIS.live.getCurrentCityConfig().key === 'mumbai' ? 3.5 : 205.33);
    const levelChange = d.modelYamuna?.level_change_m ?? 0;
    const discharge = d.modelYamuna?.discharge_m3s ?? d.yamuna.discharge ?? null;
    const pctToDanger = d.modelYamuna?.pct_to_danger ?? null;

    if (DFIS.YAMUNA) {
      DFIS.YAMUNA.currentLevel = liveLevel;
      DFIS.YAMUNA.warningLevel = warningLevel;
      DFIS.YAMUNA.dangerLevel = dangerLevel;
      DFIS.YAMUNA.forecastPeakLevel = forecastPeakLevel;
      DFIS.YAMUNA.levelChange = levelChange;
      DFIS.YAMUNA.dischargeRate = discharge;
      DFIS.YAMUNA.pctToDanger = pctToDanger;
      DFIS.YAMUNA.status = liveStatus;
      DFIS.YAMUNA.source = d.modelYamuna?.source || '';
      DFIS.YAMUNA.gaugeStations = [{
        name: DFIS.live.getCurrentCityConfig().riverLabel + ' gauge',
        current: liveLevel,
        danger: dangerLevel,
        warning: warningLevel,
        forecast: forecastPeakLevel,
        status: liveStatus,
        trend: d.yamuna.trend,
      }];
    }

    if (Array.isArray(d.modelRainfall?.chart_vals) && d.modelRainfall.chart_vals.length) {
      DFIS.RAINFALL_VALUES = d.modelRainfall.chart_vals;
      DFIS.RAINFALL_HOURS = d.modelRainfall.chart_hours || DFIS.RAINFALL_HOURS;
    } else if (d.rainfall.chartVals.length) {
      DFIS.RAINFALL_VALUES = d.rainfall.chartVals;
      DFIS.RAINFALL_HOURS = d.rainfall.chartHours;
    }

    if (Array.isArray(d.modelHotspots) && d.modelHotspots.length) {
      DFIS.HOTSPOTS = d.modelHotspots.map((h, idx) => {
        const riskLevel = (h.risk_level || 'LOW').toLowerCase();
        const risk = riskLevel === 'moderate' ? 'medium' : riskLevel;
        const score = Math.round((h.probability || 0) * 100);
        const drainCapacity = typeof h.drain_capacity_pct === 'number'
          ? Math.round(h.drain_capacity_pct)
          : null;
        return {
          id: h.cell_id || ('API-' + String(idx + 1).padStart(4, '0')),
          loc: h.name,
          dist: h.district || 'Unknown',
          score,
          risk,
          cause: h.cause || '',
          elev: +(h.elevation_m ?? liveLevel).toFixed(1),
          drain: drainCapacity != null ? (drainCapacity + '% cap') : '',
          drain_capacity_pct: drainCapacity,
          action: h.recommended_action || '',
          lat: h.lat,
          lon: h.lon,
          source: h.source || '',
        };
      });

      DFIS.TOP_RISKS = DFIS.HOTSPOTS.slice(0, 5).map((h) => ({
        name: h.loc,
        score: h.score,
        risk: h.risk,
      }));

      DFIS.DISTRICTS = DFIS.live._buildDistrictSummary(DFIS.HOTSPOTS);
      DFIS.YAMUNA_COLONIES = DFIS.HOTSPOTS.slice(0, 5).map((h) => ({
        name: h.loc,
        pop: '~' + Math.max(5, Math.round(h.score * 0.35)) + ',000',
        zone: h.dist || DFIS.live.getCurrentCityConfig().label,
        status: h.risk === 'critical' ? 'EVACUATE' : h.risk === 'high' ? 'ALERT' : 'WATCH',
      }));
      DFIS.FLOOD_STAGES = [
        { level: 'Below warning', label: 'Normal', color: 'var(--safe)', impact: 'Low flood potential under current conditions.' },
        { level: 'Approaching warning', label: 'Watch', color: 'var(--info)', impact: 'Low-lying areas should increase monitoring.' },
        { level: 'At warning', label: 'Warning', color: 'var(--warn)', impact: 'Localized flooding becomes more likely.' },
        { level: 'At danger', label: 'Danger', color: 'var(--danger)', impact: 'High-risk flood response should be activated.' },
      ];
    } else {
      DFIS.HOTSPOTS = [];
      DFIS.TOP_RISKS = [];
      DFIS.DISTRICTS = [];
      DFIS.YAMUNA_COLONIES = [];
    }

    if (Array.isArray(d.modelWards) && d.modelWards.length) {
      DFIS.WARDS = d.modelWards.map((w) => {
        const readiness = Math.round(w.readiness_score ?? 0);
        return {
          name: w.ward,
          dist: w.district,
          risk: readiness < 40 ? 'critical' : readiness < 70 ? 'medium' : 'low',
          readiness: readiness,
          readiness_level: (w.readiness_level || '').toLowerCase(),
          drain: Math.round(w.components?.drainage ?? readiness),
          pump: Math.round(w.components?.pumps ?? readiness),
          road: Math.round(w.components?.roads ?? readiness),
          response: Math.round(w.components?.emergency ?? readiness),
          prep: Math.round(w.components?.preparedness ?? readiness),
          action: '',
        };
      });
    } else {
      DFIS.WARDS = [];
    }

    const city = DFIS.live.getCurrentCityConfig();
    DFIS.CITY.name = city.fullName;
    DFIS.CITY.area_km2 = city.areaKm2;
    DFIS.CITY.wards = Array.isArray(d.modelWards) && d.modelWards.length ? d.modelWards.length : city.wards;
    DFIS.CITY.districts = DFIS.DISTRICTS.length || city.districts;
    DFIS.CITY.hotspots = d.modelHotspotMeta?.total ?? DFIS.HOTSPOTS.length;

    const displayedTotal = DFIS.HOTSPOTS.length;
    const displayedCritical = DFIS.HOTSPOTS.filter((h) => h.risk === 'critical').length;
    const displayedMedium = DFIS.HOTSPOTS.filter((h) => h.risk === 'high' || h.risk === 'medium').length;
    const displayedLow = DFIS.HOTSPOTS.filter((h) => h.risk === 'low').length;

    d.summary = {
      total: d.modelHotspotMeta?.total ?? displayedTotal,
      critical: displayedCritical,
      medium: displayedMedium,
      low: displayedLow,
      wards: DFIS.CITY.wards,
      districts: DFIS.CITY.districts,
      displayedTotal,
    };
  },

  _actionFromRisk(risk) {
    if (risk === 'critical') return 'Immediate response and route dispatch';
    if (risk === 'high') return 'Pre-position pumps and field alert';
    if (risk === 'medium') return 'Monitor drains and notify ward team';
    return 'Routine monitoring';
  },

  _wardActionFromLevel(level) {
    if (level === 'CRITICAL') return 'Urgent intervention needed';
    if (level === 'MODERATE') return 'Boost field readiness';
    return 'Maintain preparedness';
  },

  _buildDistrictSummary(hotspots) {
    const grouped = {};
    hotspots.forEach((h) => {
      const key = h.dist || 'Unknown';
      if (!grouped[key]) grouped[key] = { total: 0, critical: 0 };
      grouped[key].total += 1;
      if (h.risk === 'critical' || h.risk === 'high') grouped[key].critical += 1;
    });

    return Object.keys(grouped).map((name) => ({
      name,
      total: grouped[name].total,
      critical: grouped[name].critical,
      color: grouped[name].critical > 5 ? 'var(--danger)' : grouped[name].critical > 2 ? 'var(--accent)' : 'var(--warn)',
    })).sort((a, b) => b.total - a.total);
  },

  _getAlertList(d) {
    if (Array.isArray(d.modelAlerts) && d.modelAlerts.length) {
      return d.modelAlerts.map((a) => ({
        sev: a.severity === 'RED' ? 'CRITICAL' : a.severity === 'ORANGE' ? 'HIGH' : a.severity === 'YELLOW' ? 'MEDIUM' : 'LOW',
        msg: a.message,
      }));
    }
    return [{ sev: 'LOW', msg: 'Next 24-hour model monitoring active.' }];
  },

  _updateShell() {
    const city = DFIS.live.getCurrentCityConfig();
    const set = (id, text) => {
      const el = document.getElementById(id);
      if (el) el.textContent = text;
    };

    set('brandTitle', 'Dhristi (Vision)');
    set('brandSub', city.fullName + ' · Multi-City Flood Intelligence · GIS · Hydrology · AI');
    set('cityModeBadge', city.label.toUpperCase() + ' MODE');
    set('footerBrand', 'Dhristi (Vision) · ' + city.fullName + ' flood intelligence dashboard');
    set('footerSource', 'Live weather · Flood API · Next 24h model inference');
    document.title = 'Dhristi (Vision) - ' + city.label + ' Flood Intelligence';
  },

  _updateDOM(d) {
    const city = DFIS.live.getCurrentCityConfig();
    const set = (id, value) => {
      const el = document.getElementById(id);
      if (el) el.textContent = String(value);
    };

    const liveLevel = d.modelYamuna?.current_level_m ?? d.yamuna.level;
    const forecastPeakLevel = d.modelYamuna?.forecast_peak_level_24h_m ?? d.yamuna.forecastPeakLevel;
    const liveStatus = d.modelYamuna?.status ?? d.yamuna.status;
    const liveRainfallNow = d.modelRainfall?.current_mm_hr ?? d.rainfall.currentMmHr;
    const next24Rain = d.modelRainfall?.next_24h_total_mm ?? d.rainfall.next24Mm;
    const next24PeakRain = d.modelRainfall?.forecast_peak_mm_hr ?? d.rainfall.next24PeakMmHr;
    const alertList = DFIS.live._getAlertList(d);

    set('live-rainfall-val', liveRainfallNow + 'mm/hr');
    set('live-rainfall-sub', 'Next 24h: ' + next24Rain + 'mm · Peak: ' + next24PeakRain + 'mm/hr');
    set('live-rainfall-cat', 'Next 24h ' + d.rainfall.intensity.label + ' · ' + d.rainfall.rainProb + '% rain probability');
    set('live-yamuna-val', liveLevel + 'm');
    set('live-yamuna-trend', 'Next 24h peak ' + forecastPeakLevel + 'm · ' + liveStatus);
    set('live-yamuna-level-big', liveLevel + 'm');
    set('live-yamuna-status', 'Next 24h peak ' + forecastPeakLevel + 'm · ' + liveStatus);
    set('live-temp', d.weather.tempC != null ? d.weather.tempC + '°C' : '-');
    set('live-humidity', d.weather.humidity != null ? d.weather.humidity + '%' : '-');
    set('live-wind', d.weather.windKmh != null ? d.weather.windKmh + 'km/h' : '-');

    if (d.prediction) {
      const pct = Math.round(d.prediction.flood_probability * 100);
      set('live-readiness-val', Math.max(10, 100 - pct) + '/100');
    } else {
      set('live-readiness-val', d.readiness + '/100');
    }

    const ticker = document.getElementById('tickerText');
    if (ticker) {
      const predStr = d.prediction ? ' · NEXT 24H AI RISK: ' + d.prediction.risk_level + ' (' + Math.round(d.prediction.flood_probability * 100) + '%)' : '';
      ticker.textContent =
        city.label.toUpperCase() + ' · ' +
        city.riverLabel.toUpperCase() + ' NOW: ' + liveLevel + 'm · NEXT 24H PEAK: ' + forecastPeakLevel + 'm [' + liveStatus + '] · ' +
        'RAINFALL NOW: ' + liveRainfallNow + 'mm/hr · ' +
        'NEXT 24H: ' + next24Rain + 'mm · ' +
        'SOIL: ' + d.soil.pct + '%' + predStr;
    }

    const stripMain = document.getElementById('live-alert-strip-main');
    if (stripMain && alertList.length) stripMain.textContent = alertList.map((a) => a.msg).join(' · ');
    const stripPage = document.getElementById('live-alert-strip');
    if (stripPage && alertList.length) stripPage.textContent = alertList[0].msg;

    const panel = document.getElementById('live-alerts-panel');
    if (panel) {
      const col = { CRITICAL: 'var(--danger)', HIGH: 'var(--accent)', MEDIUM: 'var(--warn)', LOW: 'var(--safe)' };
      panel.innerHTML = alertList.map((a) =>
        '<div style="display:flex;gap:10px;align-items:flex-start;padding:8px 0;border-bottom:1px solid rgba(23,35,56,0.5)">' +
        '<span style="font-family:var(--font-mono);font-size:9px;padding:2px 7px;border-radius:3px;background:' + col[a.sev] + '22;color:' + col[a.sev] + ';border:1px solid ' + col[a.sev] + '44;flex-shrink:0;white-space:nowrap">' + a.sev + '</span>' +
        '<span style="font-size:12px;color:var(--text);line-height:1.5">' + a.msg + '</span>' +
        '</div>'
      ).join('');
    }

    DFIS.live._syncPageCopy(d);
    DFIS.live._updateSummaryCards(d);

    if (DFIS.app?.currentPage === 'dashboard') {
      DFIS.charts?.renderRainfallBar('rainfallBar');
      DFIS.charts?.renderTopRisks('topRiskList');
      DFIS.map?.renderHotspots();
    }
    if (DFIS.app?.currentPage === 'hotspots') {
      DFIS.charts?.renderDistrictBars('districtBars');
      const tbody = document.getElementById('hotspotTbody');
      if (tbody) tbody.innerHTML = '';
      DFIS.app?._renderHotspotTable?.('hotspotTbody');
    }
    if (DFIS.app?.currentPage === 'wards') DFIS.wards?.render(DFIS.wards.currentFilter);
    if (DFIS.app?.currentPage === 'yamuna') DFIS.charts?.renderYamunaChart('yamunaChartWrap');
    if (DFIS.app?.currentPage === 'simulator') DFIS.simulator?.configureForCity?.();
    if (DFIS.app?.currentPage === 'routes') {
      DFIS.routes?.refreshLocations?.();
      DFIS.routes?.calculateRoute?.();
    }
    if (DFIS.app?.currentPage === 'assistant') {
      DFIS.assistant?.refreshContext?.(true);
    }
  },

  _syncPageCopy(d) {
    const city = DFIS.live.getCurrentCityConfig();
    const dashboard = document.getElementById('page-dashboard');
    if (dashboard) {
      const eyebrow = dashboard.querySelector('.pg-eyebrow');
      const title = dashboard.querySelector('.pg-title');
      const desc = dashboard.querySelector('.pg-desc');
      const hotspotCount = d?.summary?.total ?? DFIS.CITY.hotspots;
      const mapTitle = dashboard.querySelector('.card-htitle');
      if (eyebrow) eyebrow.textContent = city.fullName + ' · Next 24-Hour Flood Outlook';
      if (title) title.textContent = 'Flood Intelligence Dashboard';
      if (desc) desc.textContent = 'Monitoring ' + hotspotCount + ' forecast hotspots for the next 24 hours across ' + DFIS.CITY.wards + ' readiness units · ' + DFIS.CITY.area_km2 + ' km²';
      if (mapTitle) mapTitle.textContent = city.label + ' Flood Risk Map — Next 24h Hotspot Outlook';
      const stationBadge = dashboard.querySelector('.g-main .col-stack .card .card-head .badge');
      if (stationBadge) stationBadge.textContent = city.stationLabel;
    }

    const hotspotsPage = document.getElementById('page-hotspots');
    if (hotspotsPage) {
      const eyebrow = hotspotsPage.querySelector('.pg-eyebrow');
      const title = hotspotsPage.querySelector('.pg-title');
      if (eyebrow) eyebrow.textContent = city.fullName + ' · GIS analysis';
      if (title) title.textContent = 'Calculated Flood Hotspots';
      const desc = hotspotsPage.querySelector('.pg-desc');
      if (desc) desc.textContent = 'Model-scored hotspot ranking for the next 24 hours in ' + city.fullName + ' using the active city backend.';
      const titles = hotspotsPage.querySelectorAll('.card .card-head .card-htitle');
      const tableTitle = titles[0];
      const tableCardTitle = titles[2];
      if (tableTitle) tableTitle.textContent = 'Hotspot Distribution by District / Ward';
      if (tableCardTitle) tableCardTitle.textContent = 'Top Critical Hotspots — ' + city.label;
    }

    const wardsPage = document.getElementById('page-wards');
    if (wardsPage) {
      const eyebrow = wardsPage.querySelector('.pg-eyebrow');
      const title = wardsPage.querySelector('.pg-title');
      const desc = wardsPage.querySelector('.pg-desc');
      if (eyebrow) eyebrow.textContent = city.fullName + ' · readiness overview';
      if (title) title.textContent = 'Readiness Score Dashboard';
      if (desc) desc.textContent = 'Calculated readiness from drainage, pumps, roads, emergency response, and preparedness.';
    }

    const riverPage = document.getElementById('page-yamuna');
    if (riverPage) {
      const eyebrow = riverPage.querySelector('.pg-eyebrow');
      const title = riverPage.querySelector('.pg-title');
      const desc = riverPage.querySelector('.pg-desc');
      if (eyebrow) eyebrow.textContent = city.fullName + ' · water level monitoring';
      if (title) title.textContent = city.waterBodyLabel + ' Water Level Intelligence';
      if (desc) desc.textContent = 'Current water level monitoring with next 24-hour flood-stage context for ' + city.fullName + '.';
    }

    const assistantPage = document.getElementById('page-assistant');
    if (assistantPage) {
      const eyebrow = assistantPage.querySelector('.pg-eyebrow');
      const title = assistantPage.querySelector('.pg-title');
      const desc = assistantPage.querySelector('.pg-desc');
      if (eyebrow) eyebrow.textContent = city.fullName + ' · operations copilot';
      if (title) title.textContent = 'GenAI Assistant';
      if (desc) desc.textContent = 'Ask what officers should do over the next 24 hours using live ' + city.label + ' forecast, hotspot, water-level, alert, and readiness data.';
    }

    const alertsPage = document.getElementById('page-alerts');
    if (alertsPage) {
      const eyebrow = alertsPage.querySelector('.pg-eyebrow');
      const title = alertsPage.querySelector('.pg-title');
      const desc = alertsPage.querySelector('.pg-desc');
      const criticalVal = d?.summary?.critical ?? 0;
      if (eyebrow) eyebrow.textContent = city.label + ' · ' + city.agency + ' · Emergency Communications';
      if (title) title.textContent = 'Send Emergency Alerts';
      if (desc) desc.textContent = 'Issue official ' + city.agency + '-formatted notifications to registered control rooms, coordinators, and field teams.';
      const badges = alertsPage.querySelectorAll('.alerts-hero-badges .badge');
      if (badges.length >= 1) badges[0].textContent = criticalVal + ' Critical Zones';
      const criticalMetric = alertsPage.querySelector('.alerts-stat-danger .alerts-stat-value');
      if (criticalMetric) criticalMetric.textContent = criticalVal;
    }

    const simulatorPage = document.getElementById('page-simulator');
    if (simulatorPage) {
      const eyebrow = simulatorPage.querySelector('.pg-eyebrow');
      const title = simulatorPage.querySelector('.pg-title');
      const desc = simulatorPage.querySelector('.pg-desc');
      if (eyebrow) eyebrow.textContent = city.fullName + ' · scenario engine';
      if (title) title.textContent = 'What-If Flood Scenario Simulator';
      if (desc) desc.textContent = 'Run ' + city.label + ' flood scenarios against live rainfall, ' + city.waterBodyLabel + ' levels, soil saturation, and drainage conditions.';
    }
  },

  _updateSummaryCards(d) {
    const dashboard = document.getElementById('page-dashboard');
    if (dashboard && d.summary) {
      const critical = d.summary.critical ?? 0;
      const medium = d.summary.medium ?? 0;
      const low = d.summary.low ?? 0;
      const wards = d.summary.wards ?? 0;

      const badges = dashboard.querySelectorAll('.pg-header .badge');
      if (badges.length >= 3) {
        badges[0].textContent = '🔴 ' + critical + ' Critical';
        badges[1].textContent = '🟡 ' + medium + ' Elevated';
        badges[2].textContent = '🟢 ' + low + ' Prepared';
      }

      const cards = dashboard.querySelectorAll('.stats-row .scard');
      if (cards.length >= 6) {
        const writeCard = (card, value, sub, delta) => {
          const val = card.querySelector('.scard-val');
          const subEl = card.querySelector('.scard-sub');
          const deltaEl = card.querySelector('.scard-delta');
          if (val) val.textContent = value;
          if (subEl) subEl.textContent = sub;
          if (deltaEl) deltaEl.textContent = delta;
        };
        writeCard(cards[0], critical, critical + ' next-24h high-priority zones', 'Forecast from active city model');
        writeCard(cards[1], medium, medium + ' next-24h elevated-risk zones', 'Forecast from active city model');
        writeCard(cards[2], low, low + ' next-24h low-risk zones', 'Forecast from active city model');
        writeCard(cards[5], document.getElementById('live-readiness-val')?.textContent || '0/100', wards + ' readiness units in current city', d.backend?.online ? 'Next 24h backend and model conditions' : 'Fallback weather-only view');
      }
    }

    const mapPanel = document.querySelector('.map-info-panel');
    if (mapPanel) {
      const vals = mapPanel.querySelectorAll('.mip-val');
      if (vals.length >= 5) {
        vals[0].textContent = (DFIS.CITY.hotspots || 0).toLocaleString();
        vals[1].textContent = d.summary?.critical ?? 0;
        vals[2].textContent = (d.modelYamuna?.forecast_peak_level_24h_m ?? d.yamuna.forecastPeakLevel) + 'm';
        vals[3].textContent = (d.modelRainfall?.next_24h_total_mm ?? d.rainfall.next24Mm) + 'mm';
        vals[4].textContent = '~' + Math.max(1, Math.round(((d.summary?.critical ?? 0) + (d.summary?.medium ?? 0)) * 0.12 * 10) / 10) + 'L';
      }
    }
  },

  _updateStatus(state, date) {
    const el = document.getElementById('liveDataStatus');
    if (!el) return;
    if (state === 'loading') {
      el.textContent = 'Loading model data...';
      el.style.color = 'var(--muted)';
    } else if (state === 'live') {
      el.textContent = 'Next 24h model · ' + (date ? date.toTimeString().slice(0, 8) : '') + ' IST';
      el.style.color = 'var(--safe)';
    } else {
      el.textContent = 'Backend offline · showing fallback weather data';
      el.style.color = 'var(--warn)';
    }
  },
};
