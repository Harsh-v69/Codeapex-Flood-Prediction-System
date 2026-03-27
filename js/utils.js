/* ============================================================
   DFIS — Delhi Flood Intelligence System
   js/utils.js — Shared Utility Functions
   ============================================================ */

'use strict';

DFIS.utils = {

  /** Return CSS color variable for a readiness score */
  scoreColor(s) {
    if (s < 40) return 'var(--danger)';
    if (s < 70) return 'var(--warn)';
    return 'var(--safe)';
  },

  /** Compute 5-component readiness score from ward object */
  computeScore(w) {
    return Math.round(
      0.30 * w.drain    +
      0.25 * w.pump     +
      0.20 * w.road     +
      0.15 * w.response +
      0.10 * ((w.drain + w.pump) / 2)
    );
  },

  /** Return risk-pill CSS class from risk string */
  riskClass(risk) {
    return { critical:'rp-critical', high:'rp-high', medium:'rp-medium', low:'rp-low' }[risk] || 'rp-low';
  },

  /** Build a score bar HTML string */
  scoreBar(value, label) {
    const color = DFIS.utils.scoreColor(value);
    return `
      <div class="sbar-wrap">
        <div class="sbar">
          <div class="sbar-fill" style="width:${value}%;background:${color}"></div>
        </div>
        <div class="sbar-num" style="color:${color}">${label !== undefined ? label : value + '%'}</div>
      </div>`;
  },

  /** Format IST time string HH:MM:SS */
  timeIST() {
    const n = new Date();
    return `${n.getHours().toString().padStart(2,'0')}:${n.getMinutes().toString().padStart(2,'0')}:${n.getSeconds().toString().padStart(2,'0')}`;
  },

  /** Animate a number from 0 → target */
  animateCounter(el, target, suffix = '') {
    let val = 0;
    const step = target / 60;
    const timer = setInterval(() => {
      val = Math.min(val + step, target);
      el.textContent = Math.floor(val).toLocaleString() + suffix;
      if (val >= target) clearInterval(timer);
    }, 25);
  },

  /** Clamp a value between min and max */
  clamp(v, min, max) { return Math.min(Math.max(v, min), max); },

  /** Create a DOM element with optional class and innerHTML */
  el(tag, cls, html) {
    const e = document.createElement(tag);
    if (cls)  e.className = cls;
    if (html) e.innerHTML = html;
    return e;
  },
};
