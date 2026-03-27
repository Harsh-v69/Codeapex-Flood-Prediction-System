/* ============================================================
   Dhristi
   js/wards.js - Readiness table and filtering
   ============================================================ */

'use strict';

window.DFIS = window.DFIS || {};

DFIS.wards = {
  currentFilter: 'all',

  render(filter) {
    DFIS.wards.currentFilter = filter || 'all';
    const tbody = document.getElementById('wardTableBody');
    if (!tbody) return;
    tbody.innerHTML = '';

    const allRows = Array.isArray(DFIS.WARDS) ? DFIS.WARDS : [];
    const data = DFIS.wards._filter(DFIS.wards.currentFilter);
    DFIS.wards._renderSummary(allRows);

    data.forEach((w) => {
      const score = DFIS.utils.computeScore(w);
      const rClass = DFIS.utils.riskClass(w.risk);
      const mkBar = (v) => DFIS.utils.scoreBar(v);
      const scoreBar = DFIS.utils.scoreBar(score, score + '/100');

      const tr = document.createElement('tr');
      tr.innerHTML = `
        <td style="font-weight:600;font-size:12px">${w.name}</td>
        <td style="color:var(--muted)">${w.dist}</td>
        <td><span class="rpill ${rClass}">${w.risk}</span></td>
        <td>${mkBar(w.drain)}</td>
        <td>${mkBar(w.pump)}</td>
        <td>${mkBar(w.road)}</td>
        <td>${mkBar(w.response)}</td>
        <td>${scoreBar}</td>
        <td style="font-size:11px;color:var(--muted)">${w.action}</td>`;
      tbody.appendChild(tr);
    });
  },

  setFilter(f) {
    const ids = { all: 'filterAll', critical: 'filterCritical', medium: 'filterMed', good: 'filterGood' };
    Object.values(ids).forEach((id) => {
      const el = document.getElementById(id);
      if (el) el.classList.remove('active');
    });
    const active = document.getElementById(ids[f]);
    if (active) active.classList.add('active');
    DFIS.wards.render(f);
  },

  _filter(f) {
    if (f === 'all') return DFIS.WARDS;
    if (f === 'critical') return DFIS.WARDS.filter((w) => w.risk === 'critical' || w.risk === 'high');
    if (f === 'medium') return DFIS.WARDS.filter((w) => w.risk === 'medium');
    if (f === 'good') return DFIS.WARDS.filter((w) => w.risk === 'low');
    return DFIS.WARDS;
  },

  renderResGap(containerId) {
    const el = document.getElementById(containerId);
    if (!el) return;

    const gaps = (DFIS.WARDS || []).slice(0, 5).map((ward) => ({
      ward: ward.name,
      need: ward.risk === 'critical' ? 'Immediate pumps and field team' : ward.risk === 'medium' ? 'Drain inspection and readiness boost' : 'Routine preventive checks',
      severity: ward.risk === 'medium' ? 'high' : ward.risk,
    }));

    el.innerHTML = '';
    gaps.forEach((g) => {
      const isCritical = g.severity === 'critical';
      const c = isCritical ? 'rgba(244,63,94,0.2)' : 'rgba(249,115,22,0.2)';
      const row = DFIS.utils.el('div');
      row.style.cssText = `background:var(--abyss);border:1px solid ${c};border-radius:6px;padding:10px 14px;display:flex;align-items:center;justify-content:space-between;gap:10px;margin-bottom:8px`;
      row.innerHTML = `
        <div>
          <div style="font-size:12px;font-weight:600;color:var(--text);margin-bottom:2px">${g.ward}</div>
          <div style="font-size:11px;color:var(--muted)">${g.need}</div>
        </div>
        <span class="rpill ${isCritical ? 'rp-critical' : 'rp-high'}">${g.severity}</span>`;
      el.appendChild(row);
    });
  },

  _renderSummary(rows) {
    const set = (id, value) => {
      const el = document.getElementById(id);
      if (el) el.textContent = value;
    };

    const critical = rows.filter((w) => w.risk === 'critical' || w.risk === 'high').length;
    const moderate = rows.filter((w) => w.risk === 'medium').length;
    const prepared = rows.filter((w) => w.risk === 'low').length;
    const avgScore = rows.length
      ? Math.round(rows.reduce((sum, w) => sum + DFIS.utils.computeScore(w), 0) / rows.length)
      : 0;

    const weakest = rows.length
      ? rows.slice().sort((a, b) => DFIS.utils.computeScore(a) - DFIS.utils.computeScore(b))[0]
      : null;
    const strongest = rows.length
      ? rows.slice().sort((a, b) => DFIS.utils.computeScore(b) - DFIS.utils.computeScore(a))[0]
      : null;

    set('wardCriticalVal', critical);
    set('wardModerateVal', moderate);
    set('wardPreparedVal', prepared);
    set('wardAverageVal', avgScore + '/100');

    set('wardCriticalSub', rows.length + ' readiness units analyzed');
    set('wardModerateSub', rows.length + ' readiness units analyzed');
    set('wardPreparedSub', rows.length + ' readiness units analyzed');
    set('wardAverageSub', 'Calculated from current readiness table');

    set('wardCriticalDelta', weakest ? 'Lowest readiness: ' + weakest.name : 'Highest intervention need');
    set('wardModerateDelta', critical > 0 ? critical + ' units need urgent support' : 'Mostly stable watchlist');
    set('wardPreparedDelta', strongest ? 'Best ready: ' + strongest.name : 'Operationally stable');
    set('wardAverageDelta', avgScore >= 70 ? 'City readiness is stable' : avgScore >= 40 ? 'City readiness is strained' : 'City readiness is critical');
  },
};
