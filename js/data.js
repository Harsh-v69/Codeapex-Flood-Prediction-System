/* ============================================================
   Dhristi
   js/data.js - Runtime data containers only
   ============================================================ */

'use strict';

window.DFIS = window.DFIS || {};

DFIS.CITY = {
  name: 'Loading...',
  area_km2: 0,
  wards: 0,
  districts: 0,
  gridCells: 0,
  hotspots: 0,
  gridSize: 'Dynamic',
};

DFIS.YAMUNA = {
  dangerLevel: 0,
  warningLevel: 0,
  currentLevel: 0,
  riseRate: 0,
  dischargeRate: '-',
  gaugeStations: [],
};

DFIS.RAINFALL_HOURS = [];
DFIS.RAINFALL_VALUES = [];
DFIS.DISTRICTS = [];
DFIS.HOTSPOTS = [];
DFIS.WARDS = [];
DFIS.YAMUNA_COLONIES = [];
DFIS.FLOOD_STAGES = [];
DFIS.TOP_RISKS = [];

DFIS.FEATURES = [
  {
    icon: '🧭',
    tier: 'core',
    name: 'Multi-Source Data Integration',
    desc: 'Forecast APIs, flood feeds, hotspot datasets, and operational layers are merged into one city-aware runtime pipeline.',
    tags: ['APIs', 'Datasets', 'Runtime'],
  },
  {
    icon: '🗺️',
    tier: 'core',
    name: 'Flood Risk Models',
    desc: 'Delhi, Mumbai, and Sikkim risk outputs are generated from backend model pipelines and exposed consistently across the UI.',
    tags: ['Predictions', 'Risk Scores', 'Backend'],
  },
  {
    icon: '📍',
    tier: 'core',
    name: 'Hotspot Detection and Mapping',
    desc: 'Forecast hotspots are rendered on the active city map with live severity filters and route handoff.',
    tags: ['Leaflet', 'Hotspots', 'Severity Filters'],
  },
  {
    icon: '📊',
    tier: 'core',
    name: 'Readiness and Operations',
    desc: 'Readiness scoring, district summaries, and operational response views are derived from live backend outputs.',
    tags: ['Readiness', 'Operations', 'Response'],
  },
  {
    icon: '🌊',
    tier: 'advanced',
    name: 'Water Level Intelligence',
    desc: 'Current water levels and next 24-hour peak context are shown for each active city using city-specific water sources.',
    tags: ['Yamuna', 'Arabian Sea', 'Teesta', '24h Outlook'],
  },
  {
    icon: '🤖',
    tier: 'core',
    name: 'GenAI Assistant',
    desc: 'City-aware operations copilot grounded in live forecast, hotspot, alert, and readiness data for Delhi, Mumbai, and Sikkim.',
    tags: ['Officer Chat', 'Decision Support', 'Live Grounding'],
  },
  {
    icon: '🌧️',
    tier: 'advanced',
    name: 'Monsoon Scenario Simulator',
    desc: 'Scenario inputs are passed through the model-backed forecast flow instead of a fixed frontend-only formula.',
    tags: ['Simulator', 'Forecast Inputs', 'Model-Backed'],
  },
  {
    icon: '⚡',
    tier: 'advanced',
    name: 'Live Data Pipeline',
    desc: 'Weather, flood, marine, hotspot, and readiness data propagate through the dashboard without static placeholder values.',
    tags: ['Open-Meteo', 'Flood API', 'Live Refresh'],
  },
  {
    icon: '🚨',
    tier: 'advanced',
    name: 'Alerting and Dispatch Actions',
    desc: 'Alerts, route suggestions, and deployment actions are generated from the active city forecast state.',
    tags: ['Alerts', 'Dispatch', 'Routing'],
  },
];

DFIS.PIPELINE = [
  { icon: '📥', name: 'Inputs', color: '#22d3ee' },
  { icon: '🧪', name: 'Processing', color: '#38bdf8' },
  { icon: '🤖', name: 'Inference', color: '#4ade80' },
  { icon: '📊', name: 'Outputs', color: '#facc15' },
  { icon: '🗺️', name: 'Dashboard', color: '#f97316' },
];

DFIS.MAP_HOTSPOTS = [];
DFIS.SIM_DISTRICTS = [];
DFIS.SIM_DIST_BASE = [];
DFIS.DRAIN_MULTS = { full: 1, '75': 0.75, '50': 0.5, blocked: 0.15 };
