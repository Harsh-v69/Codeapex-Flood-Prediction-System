/* ============================================================
   DFIS — Delhi Flood Intelligence System
   js/charts.js — Chart Rendering (Rainfall, Yamuna, Bars)
   ============================================================ */

'use strict';

DFIS.charts = {

  /** Render hourly rainfall bar chart */
  renderRainfallBar(containerId) {
    const c = document.getElementById(containerId);
    if (!c) return;
    c.innerHTML = '';
    const vals = DFIS.RAINFALL_VALUES;
    const hrs  = DFIS.RAINFALL_HOURS;
    const mx   = Math.max(...vals);

    hrs.forEach((h, i) => {
      const col = DFIS.utils.el('div', 'bar-col');
      const pct = (vals[i] / mx) * 90;
      const bar = DFIS.utils.el('div', 'bar-fill');
      bar.style.height     = `${pct}%`;
      bar.style.background = vals[i] > 60 ? 'var(--danger)' : vals[i] > 35 ? 'var(--warn)' : 'var(--yamuna)';
      bar.style.width      = '100%';
      bar.title            = `${h}:00 — ${vals[i]}mm`;

      const lbl = DFIS.utils.el('span', 'bar-xlabel');
      lbl.textContent = h;
      col.appendChild(bar);
      col.appendChild(lbl);
      c.appendChild(col);
    });
  },

  /** Render district hotspot distribution bars */
  renderDistrictBars(containerId) {
    const el = document.getElementById(containerId);
    if (!el) return;
    el.innerHTML = '';
    const mx = Math.max(...DFIS.DISTRICTS.map(d => d.total));

    DFIS.DISTRICTS.forEach(d => {
      const row = DFIS.utils.el('div');
      row.innerHTML = `
        <div style="display:flex;justify-content:space-between;margin-bottom:4px;font-size:11px">
          <span style="color:var(--text)">${d.name}</span>
          <span style="font-family:var(--font-mono);color:${d.color}">${d.critical} critical / ${d.total}</span>
        </div>
        <div style="height:8px;background:var(--rim);border-radius:4px;overflow:hidden;display:flex">
          <div style="width:${(d.critical/mx)*100}%;background:${d.color};border-radius:4px;transition:width 1s"></div>
          <div style="width:${((d.total-d.critical)/mx)*100}%;background:rgba(77,106,138,0.2);transition:width 1s"></div>
        </div>`;
      el.appendChild(row);
    });
  },

  /** Render Yamuna level chart (48-hour history) */
  renderYamunaChart(containerId) {
    const c = document.getElementById(containerId);
    if (!c) return;
    c.innerHTML = '';
    c.className = 'yamuna-chart-wrap';

    const danger = DFIS.YAMUNA.dangerLevel;
    const warn   = DFIS.YAMUNA.warningLevel;
    const mn = 201.5, mx = 206;

    // Generate simulated 48-hour trend
    const vals = [];
    for (let i = 0; i < 48; i++) {
      const base = 202.5 + Math.sin(i * 0.12) * 0.4;
      const rise = i > 30 ? (i - 30) * 0.08 : 0;
      vals.push(+(base + rise + Math.random() * 0.1).toFixed(2));
    }
    vals[47] = DFIS.YAMUNA.currentLevel;

    vals.forEach(v => {
      const col = DFIS.utils.el('div', 'yamuna-bar-col');
      const pct = ((v - mn) / (mx - mn)) * 100;
      const bar = DFIS.utils.el('div', 'yamuna-bar-fill');
      bar.style.height     = `${pct}%`;
      bar.style.background = v > danger ? 'var(--danger)' : v > warn ? 'var(--warn)' : 'var(--yamuna)';
      bar.title = `Level: ${v}m`;
      col.appendChild(bar);
      c.appendChild(col);
    });

    // Danger line overlay
    const dangerPct = ((danger - mn) / (mx - mn)) * 100;
    const warnPct   = ((warn   - mn) / (mx - mn)) * 100;
    ['yamuna-danger-line','yamuna-warn-line'].forEach((cls, i) => {
      const line = DFIS.utils.el('div', cls);
      line.style.bottom = `calc(${i===0 ? dangerPct : warnPct}% + 24px)`;
      c.appendChild(line);
    });
  },

  /** Render flood stages list */
  renderFloodStages(containerId) {
    const el = document.getElementById(containerId);
    if (!el) return;
    el.innerHTML = '';
    DFIS.FLOOD_STAGES.forEach(s => {
      const row = DFIS.utils.el('div');
      row.style.cssText = `background:var(--abyss);border-left:3px solid ${s.color};border-radius:0 6px 6px 0;padding:10px 14px;margin-bottom:6px`;
      row.innerHTML = `
        <div style="display:flex;justify-content:space-between;margin-bottom:3px">
          <span style="font-family:var(--font-mono);font-size:10px;color:var(--muted)">${s.level}</span>
          <span style="font-size:11px;font-weight:600;color:${s.color}">${s.label}</span>
        </div>
        <div style="font-size:11px;color:var(--muted)">${s.impact}</div>`;
      el.appendChild(row);
    });
  },

  /** Render Top-Risk summary list */
  renderTopRisks(containerId) {
    const el = document.getElementById(containerId);
    if (!el) return;
    el.innerHTML = '';
    DFIS.TOP_RISKS.forEach(t => {
      const color = t.risk === 'critical' ? 'var(--danger)' : 'var(--accent)';
      const row   = DFIS.utils.el('div');
      row.style.cssText = 'display:flex;align-items:center;justify-content:space-between;gap:10px;margin-bottom:8px;cursor:pointer;padding:8px 10px;border-radius:8px;border:1px solid transparent;transition:border-color .2s,background .2s';
      row.innerHTML = `
        <div style="font-size:12px;color:var(--text);flex:1">${t.name}<div style="margin-top:4px;font-size:10px;color:var(--info);font-family:var(--font-mono)">Open route plan</div></div>
        <div style="font-family:var(--font-mono);font-size:12px;font-weight:700;color:${color}">${t.score}/100</div>`;
      row.addEventListener('mouseenter', () => {
        row.style.borderColor = 'rgba(56,189,248,0.35)';
        row.style.background = 'rgba(8,145,178,0.08)';
      });
      row.addEventListener('mouseleave', () => {
        row.style.borderColor = 'transparent';
        row.style.background = 'transparent';
      });
      row.addEventListener('click', () => {
        DFIS.app.openRouteForLocation(t.name, {
          severity: t.risk === 'critical' ? 'severe' : 'high',
          source: 'dashboard-top-risk',
        });
      });
      el.appendChild(row);
    });
  },

  /** Render data pipeline flow */
  renderPipeline(containerId) {
    const el = document.getElementById(containerId);
    if (!el) return;
    el.innerHTML = '';
    el.className = 'pipeline-row';
    DFIS.PIPELINE.forEach((s, i) => {
      const step = DFIS.utils.el('div', 'pipeline-step');
      step.style.border = `1px solid ${s.color}40`;
      step.innerHTML = `
        <div style="font-size:20px;margin-bottom:4px">${s.icon}</div>
        <div style="font-family:var(--font-mono);font-size:9px;color:${s.color};line-height:1.3">${s.name}</div>`;
      el.appendChild(step);
      if (i < DFIS.PIPELINE.length - 1) {
        const arr = DFIS.utils.el('div', 'pipeline-arrow');
        arr.textContent = '→';
        el.appendChild(arr);
      }
    });
  },
};
