/* ============================================================
   DFIS — Delhi Flood Intelligence System
   js/send-laert.js — Send Alerts Module
   ============================================================ */
'use strict';
window.DFIS = window.DFIS || {};

DFIS.alerts = (function () {

  // ── inject spin keyframe once ──────────────────────────────
  (function () {
    if (!document.getElementById('al-spin-style')) {
      const s = document.createElement('style');
      s.id = 'al-spin-style';
      s.textContent = '@keyframes al-spin { to { transform: rotate(360deg); } }';
      document.head.appendChild(s);
    }
  })();

  // ── constants ──────────────────────────────────────────────
  const COLORS = ['#0ea5e9', '#22c55e', '#f97316', '#ef4444', '#a855f7', '#06b6d4', '#ec4899'];
  const SEV_LABEL = { red: 'CRITICAL', orange: 'HIGH', yellow: 'MEDIUM', teal: 'ADVISORY' };
  const SEV_EMOJI = { red: '[CRITICAL]', orange: '[HIGH]', yellow: '[MEDIUM]', teal: '[ADVISORY]' };
  const DEFAULT_CONTACTS = [];

  // ── state ──────────────────────────────────────────────────
  let _sev       = 'red';
  let _tab       = 'today';
  let _sentToday = 0;

  // ── helpers ────────────────────────────────────────────────
  function colorFor(i) { return COLORS[i % COLORS.length]; }
  function initials(n) { return n.trim().split(/\s+/).map(function(w){return w[0];}).join('').slice(0,2).toUpperCase(); }
  function currentCity() { return (DFIS.live && DFIS.live.getCurrentCityConfig) ? DFIS.live.getCurrentCityConfig() : { label:'City', fullName:'City', agency:'Authority' }; }
  function genRef()  { return 'DHRISTI/' + currentCity().label.toUpperCase() + '/' + new Date().getFullYear() + '/' + (Math.floor(Math.random()*9000)+1000); }
  function genDate() { return new Date().toLocaleString('en-IN',{day:'2-digit',month:'short',year:'numeric',hour:'2-digit',minute:'2-digit',hour12:false}); }
  function el(id)    { return document.getElementById(id); }
  function storageKey(base) { return base + '_' + currentCity().key; }
  function runtimeRegions() {
    var city = currentCity();
    var seen = {};
    var regions = [];
    (DFIS.HOTSPOTS || []).forEach(function(h) {
      var region = (h.dist || '').trim();
      if (!region || seen[region]) return;
      seen[region] = true;
      regions.push(region);
    });
    if (!seen[city.fullName]) regions.push(city.fullName);
    return regions;
  }
  function buildRuntimeContacts() {
    var city = currentCity();
    return runtimeRegions().map(function(region, index) {
      return {
        id: 1000 + index,
        name: region + ' Control Room',
        phone: 'N/A',
        role: city.agency + ' Duty Desk',
        region: region,
      };
    });
  }

  // ── storage ────────────────────────────────────────────────
  function loadContacts() {
    try {
      var s = localStorage.getItem(storageKey('dfis_contacts'));
      if (s) {
        var parsed = JSON.parse(s);
        if (Array.isArray(parsed) && parsed.length) return parsed;
      }
    } catch(e) {}
    var generated = buildRuntimeContacts();
    return generated.length ? generated : DEFAULT_CONTACTS.slice();
  }
  function saveContacts() { localStorage.setItem(storageKey('dfis_contacts'), JSON.stringify(_contacts)); }
  function loadHistory()  { try { return JSON.parse(localStorage.getItem(storageKey('dfis_alert_history')) || '[]'); } catch(e) { return []; } }
  function saveHistory()  { localStorage.setItem(storageKey('dfis_alert_history'), JSON.stringify(_history)); }

  var _contacts = loadContacts();
  var _history  = loadHistory();

  // ── message builder ────────────────────────────────────────
  function buildMessage(dtype, region, ward, sev) {
    if (!region) return '';
    var loc = ward ? ward + ', ' + region : region;
    var ref = genRef(), dt = genDate();
    var sl  = SEV_LABEL[sev] || 'ALERT';
    var authority = currentCity().agency + ' ' + currentCity().label;

    var msgs = {
      flood:
'[' + sl + '] FLOOD / WATERLOGGING ALERT\n' +
'Ref: ' + ref + ' | Issued: ' + dt + '\n' +
'Authority: ' + authority + '\n\n' +
'Location: ' + loc + '\n\n' +
'Situation: Active waterlogging and flood conditions reported.\n\n' +
'Advisory:\n' +
'- Avoid all waterlogged roads and underpasses\n' +
'- Move valuables to higher ground immediately\n' +
'- Do NOT wade through floodwater\n' +
'- Follow evacuation routes if instructed\n\n' +
'Emergency: 1077 | NDRF: 011-24363260 | Police: 112',

      rain:
'[' + sl + '] HEAVY RAINFALL WARNING\n' +
'Ref: ' + ref + ' | Issued: ' + dt + '\n' +
'Authority: Weather + ' + authority + '\n\n' +
'Location: ' + loc + '\n\n' +
'Forecast: Intense rainfall expected in next 3-6 hours.\n\n' +
'Advisory:\n' +
'- Remain indoors; avoid non-essential travel\n' +
'- Secure loose objects on rooftops and terraces\n' +
'- Keep emergency kit ready (medicines, ID, water)\n' +
'- Monitor DFIS and local authority updates\n\n' +
'DDMA Helpline: 1077',

      yamuna:
'[' + sl + '] WATER LEVEL ALERT - URGENT\n' +
'Ref: ' + ref + ' | Issued: ' + dt + '\n' +
'Authority: Dhristi / Flood Monitoring / ' + authority + '\n\n' +
'Location: ' + loc + '\n\n' +
'Status: Water level has reached ' + (sl === 'CRITICAL' ? 'DANGER MARK' : 'WARNING STAGE') + ' near ' + loc + '.\n\n' +
'IMMEDIATE ACTION:\n' +
'- Floodplain residents MUST evacuate NOW\n' +
'- Emergency transport: call 1077\n' +
'- Relief camps are operational\n' +
'- Do NOT return until official All Clear\n\n' +
'CWC Flood Control Room: 011-26107185 | Emergency: 112',

      drainage:
'[' + sl + '] DRAIN / SEWER OVERFLOW\n' +
'Ref: ' + ref + ' | Issued: ' + dt + '\n' +
'Authority: Urban Services / ' + authority + '\n\n' +
'Location: ' + loc + '\n\n' +
'Incident: Stormwater drain overflow detected.\n\n' +
'Advisory:\n' +
'- Do NOT contact floodwater (disease risk)\n' +
'- Boil drinking water until further notice\n' +
'- MCD pump teams are deployed\n' +
'- Report overflow: 1800-11-0505\n\n' +
'Emergency: 1077',

      evacuation:
'[MANDATORY EVACUATION ORDER]\n' +
'Ref: ' + ref + ' | Issued: ' + dt + '\n' +
'Authority: ' + authority + '\n\n' +
'EVACUATION ZONE: ' + loc + '\n\n' +
'THIS IS A MANDATORY ORDER. Leave immediately.\n\n' +
'Instructions:\n' +
'1. Leave NOW - do not wait\n' +
'2. Carry: photo ID, medicines, mobile (charged)\n' +
'3. Go to nearest designated relief camp\n' +
'4. Call 1077 for emergency transport\n' +
'5. Do NOT return until official All Clear\n\n' +
'Emergency: 112 | DDMA: 1077',

      relief:
'[' + sl + '] RELIEF CAMP ACTIVATED\n' +
'Ref: ' + ref + ' | Issued: ' + dt + '\n' +
'Authority: ' + authority + '\n\n' +
'Location: ' + loc + '\n\n' +
'Relief camp is now operational. Facilities:\n' +
'- Safe shelter (families and individuals)\n' +
'- Food and clean drinking water (24x7)\n' +
'- First aid and medical assistance\n' +
'- Blankets and emergency supplies\n\n' +
'DDMA Helpline: 1077',

      allclear:
'[ALL CLEAR - STAND DOWN]\n' +
'Ref: ' + ref + ' | Issued: ' + dt + '\n' +
'Authority: ' + authority + '\n\n' +
'Location: ' + loc + '\n\n' +
'Flood/emergency conditions have normalised.\n\n' +
'- Residents may return home safely\n' +
'- Exercise caution near low-lying areas\n' +
'- Inspect premises before entering\n' +
'- Report damage: 1800-11-0505\n' +
'- Monsoon season ongoing - stay prepared\n\n' +
'Thank you for your cooperation. - ' + authority,
    };
    return msgs[dtype] || '';
  }

  var _quickTpls = {
    evacuate:    function(r,w) { return buildMessage('evacuation', r, w, 'red'); },
    stayindoors: function(r,w) {
      var loc = w ? w + ', ' + r : r;
      return '[HIGH] STAY INDOORS - ' + loc + '\nRef: ' + genRef() + ' | Issued: ' + genDate() + '\nAuthority: ' + currentCity().agency + ' ' + currentCity().label + '\n\nSevere weather conditions reported. Residents advised to stay indoors.\n\n- Avoid all unnecessary travel\n- Keep emergency numbers accessible\n- Monitor Dhristi updates\n\nHelpline: 1077';
    },
    reliefcamp:  function(r,w) { return buildMessage('relief', r, w, 'orange'); },
    yamunarise:  function(r,w) { return buildMessage('yamuna', r, w, 'red'); },
    pumps: function(r,w) {
      var loc = w ? w + ', ' + r : r;
      return '[ADVISORY] PUMP TEAMS DEPLOYED - ' + loc + '\nRef: ' + genRef() + ' | Issued: ' + genDate() + '\nAuthority: Urban Services / ' + currentCity().agency + ' ' + currentCity().label + '\n\nPump and dewatering teams dispatched to ' + loc + '. Operations underway.\n\nEstimated clearance: 2-4 hours.\nUrgent assistance: 1077';
    },
    allcleartpl: function(r,w) { return buildMessage('allclear', r, w, 'teal'); },
  };

  // ── render contacts ────────────────────────────────────────
  function contactRow(c, i, showCheck) {
    var col = colorFor(i);
    var ini = initials(c.name);
    var shortReg = c.region.split('(')[0].trim();
    var avatar = '<div style="width:30px;height:30px;border-radius:50%;background:' + col + '22;color:' + col + ';display:grid;place-items:center;font-weight:700;font-size:11px;flex-shrink:0">' + ini + '</div>';
    var info = '<div><div style="font-size:12px;font-weight:600">' + c.name + '</div><div style="font-size:10px;color:var(--muted)">' + c.phone + ' - ' + c.role + '</div></div>';
    var tag = '<span style="font-family:var(--font-mono);font-size:9px;padding:2px 7px;border-radius:3px;background:var(--raised);border:1px solid var(--rim);color:var(--info);white-space:nowrap">' + shortReg + '</span>';
    if (showCheck) {
      return '<div style="display:flex;align-items:center;justify-content:space-between;padding:9px 12px;background:var(--abyss);border-radius:7px;margin-bottom:6px;border:1px solid var(--rim)">' +
        '<div style="display:flex;align-items:center;gap:10px"><input type="checkbox" id="al-chk' + c.id + '" checked style="width:14px;height:14px;accent-color:var(--info);cursor:pointer">' + avatar + info + '</div>' + tag +
      '</div>';
    }
    return '<div style="display:flex;align-items:center;justify-content:space-between;padding:9px 12px;background:var(--abyss);border-radius:7px;margin-bottom:6px;border:1px solid var(--rim)">' +
      '<div style="display:flex;align-items:center;gap:10px">' + avatar + info + '</div>' +
      '<div style="text-align:right">' + tag + '<br><button onclick="DFIS.alerts.removeContact(' + c.id + ')" style="margin-top:4px;background:none;border:none;font-size:10px;color:var(--muted);cursor:pointer;padding:0">x Remove</button></div>' +
    '</div>';
  }

  function renderContactList() {
    var cl   = el('al-contact-list');
    var fl   = el('al-full-contacts');
    var chip = el('al-contact-chip');
    var stat = el('al-stat-contacts');
    if (cl)   cl.innerHTML   = _contacts.map(function(c,i){ return contactRow(c,i,true);  }).join('');
    if (fl)   fl.innerHTML   = _contacts.map(function(c,i){ return contactRow(c,i,false); }).join('');
    if (chip) chip.textContent = _contacts.length + ' Active';
    if (stat) stat.textContent = _contacts.length;
  }

  function updateStats() {
    var s = el('al-stat-sent');
    var d = el('al-stat-delivered');
    var t = el('al-stat-total');
    var b = el('alert-sent-badge');
    var h = el('al-hist-chip');
    if (s) s.textContent = _sentToday;
    if (d) d.textContent = _sentToday;
    if (t) t.textContent = _history.length;
    if (b) b.textContent = _sentToday + ' Sent Today';
    if (h) h.textContent = _history.length + ' Records';
  }

  // ── toast ──────────────────────────────────────────────────
  function showToast(icon, title, sub) {
    var t = document.getElementById('dfis-al-toast');
    if (!t) {
      t = document.createElement('div');
      t.id = 'dfis-al-toast';
      t.style.cssText = [
        'position:fixed','bottom:24px','right:24px',
        'background:var(--surface)','border:1px solid var(--rim)',
        'border-radius:10px','padding:14px 18px','min-width:280px',
        'box-shadow:0 8px 32px rgba(0,0,0,.5)',
        'display:flex','gap:12px','align-items:center',
        'transform:translateY(130%)',
        'transition:transform .35s cubic-bezier(.34,1.56,.64,1)',
        'z-index:9999'
      ].join(';');
      t.innerHTML = '<div id="dfis-al-ti" style="font-size:20px"></div><div><div id="dfis-al-tt" style="font-size:13px;font-weight:700;color:var(--text)"></div><div id="dfis-al-ts" style="font-size:11px;color:var(--muted);margin-top:2px"></div></div>';
      document.body.appendChild(t);
    }
    document.getElementById('dfis-al-ti').textContent = icon;
    document.getElementById('dfis-al-tt').textContent = title;
    document.getElementById('dfis-al-ts').textContent = sub;
    t.style.transform = 'translateY(0)';
    clearTimeout(t._tmr);
    t._tmr = setTimeout(function(){ t.style.transform = 'translateY(130%)'; }, 3800);
  }

  function inferRouteTarget(region, ward, dtype, sev) {
    var label = (ward ? ward + ', ' : '') + (region || '');
    var severity = sev === 'red' ? 'severe' : sev === 'orange' ? 'high' : sev === 'yellow' ? 'moderate' : 'normal';
    if (dtype === 'yamuna' || dtype === 'evacuation') severity = severity === 'normal' ? 'high' : severity;
    return { label: label || region || currentCity().fullName, severity: severity };
  }

  function ensureRouteButton() {
    var area = el('al-send-area');
    if (!area || el('al-route-btn')) return;
    var btn = document.createElement('button');
    btn.id = 'al-route-btn';
    btn.className = 'chip active';
    btn.textContent = 'Open Route For Selected Area';
    btn.style.cssText = 'width:100%;margin-top:10px;padding:12px;border-radius:8px;cursor:pointer';
    btn.onclick = function() { DFIS.alerts.openRouteFromForm(); };
    area.appendChild(btn);
  }

  function populateRegions() {
    var regionEl = el('al-region');
    var regions = runtimeRegions();
    var options = regions.map(function(region){ return '<option>' + region + '</option>'; }).join('') +
      '<option value="' + currentCity().fullName + '">' + currentCity().fullName + '</option>';
    if (regionEl) {
      regionEl.innerHTML = '<option value="">Select runtime region</option>' + options;
    }

    var histFilter = el('al-hist-filter');
    if (histFilter) {
      histFilter.innerHTML = '<option value="">All Regions</option>' + options;
    }

    var addRegion = el('al-nc-region');
    if (addRegion) {
      addRegion.innerHTML = '<option value="' + currentCity().fullName + '">' + currentCity().fullName + '</option>' + options;
    }
  }

  // ── public API ─────────────────────────────────────────────
  return {

    init: function() {
      _contacts = loadContacts();
      _history  = loadHistory();
      populateRegions();
      if (!_contacts.length) _contacts = buildRuntimeContacts();
      renderContactList();
      this.renderHistory();
      updateStats();
      ensureRouteButton();
    },

    setSev: function(sev, btn) {
      _sev = sev;
      var row = el('al-sev-row');
      if (row) row.querySelectorAll('.chip').forEach(function(b){ b.classList.remove('active'); });
      if (btn) btn.classList.add('active');
      this.generateMessage();
    },

    generateMessage: function() {
      var dtype  = el('al-dtype');
      var region = el('al-region');
      var ward   = el('al-ward');
      var body   = el('al-msgbody');
      if (!dtype || !region || !body) return;
      if (!region.value) return;
      body.value = buildMessage(dtype.value, region.value, ward ? ward.value.trim() : '', _sev);
      this.updateCharBar();
    },

    applyTpl: function(key) {
      var region = (el('al-region') || {}).value || currentCity().fullName;
      var ward   = ((el('al-ward')  || {}).value || '').trim();
      var fn = _quickTpls[key];
      var body = el('al-msgbody');
      if (fn && body) { body.value = fn(region, ward); this.updateCharBar(); }
    },

    updateCharBar: function() {
      var body = el('al-msgbody');
      var cnt  = el('al-charcount');
      var fill = el('al-charfill');
      if (!body || !cnt || !fill) return;
      var n = body.value.length;
      cnt.textContent = n;
      fill.style.width = Math.min(100, (n/160)*100) + '%';
      fill.style.background = n > 160 ? 'var(--danger)' : n > 130 ? 'var(--warn)' : 'var(--safe)';
    },

    filterByRegion: function() {
      var region = (el('al-region') || {}).value || '';
      var city = currentCity();
      _contacts.forEach(function(c) {
        var chk = el('al-chk' + c.id);
        if (chk) chk.checked = !region || c.region === region || c.region === city.fullName || region === city.fullName;
      });
    },

    openRouteFromForm: function() {
      var dtype  = (el('al-dtype') || {}).value || 'flood';
      var region = (el('al-region') || {}).value || '';
      var ward   = ((el('al-ward') || {}).value || '').trim();
      if (!region && !ward) {
        showToast('âš ï¸', 'No Area Selected', 'Select a region or ward before opening a route.');
        return;
      }
      var target = inferRouteTarget(region, ward, dtype, _sev);
      if (window.DFIS && DFIS.app && typeof DFIS.app.openRouteForLocation === 'function') {
        DFIS.app.openRouteForLocation(target.label, { severity: target.severity, source: 'alert-form' });
      }
    },

    selectAll: function(val) {
      _contacts.forEach(function(c) {
        var chk = el('al-chk' + c.id);
        if (chk) chk.checked = val;
      });
    },

    send: function() {
      var self    = this;
      var region  = (el('al-region')  || {}).value  || '';
      var msg     = ((el('al-msgbody') || {}).value  || '').trim();
      if (!region) { showToast('⚠️', 'No Region', 'Please select a target region.'); return; }
      if (!msg)    { showToast('⚠️', 'No Message', 'Please compose or generate an alert.'); return; }

      var chosen = _contacts.filter(function(c) {
        var chk = el('al-chk' + c.id);
        return chk && chk.checked;
      });
      if (!chosen.length) { showToast('⚠️', 'No Recipients', 'Select at least one contact.'); return; }

      var btn  = el('al-send-btn');
      var prog = el('al-send-progress');
      var area = el('al-send-area');
      if (btn)  btn.disabled = true;
      if (area) area.style.display = 'none';
      if (prog) prog.style.display = 'block';

      setTimeout(function() {
        if (btn)  btn.disabled = false;
        if (area) area.style.display = 'block';
        if (prog) prog.style.display = 'none';

        var now   = new Date();
        var dtype = el('al-dtype');
        var ward  = ((el('al-ward') || {}).value || '').trim();

        var record = {
          id:         now.getTime(),
          ref:        genRef(),
          severity:   _sev,
          region:     region,
          ward:       ward,
          type:       dtype ? dtype.options[dtype.selectedIndex].text : '',
          message:    msg,
          recipients: chosen.map(function(c){ return { name:c.name, phone:c.phone, role:c.role }; }),
          timestamp:  now.toISOString(),
          date:       now.toLocaleDateString('en-IN'),
          time:       now.toLocaleTimeString('en-IN',{hour:'2-digit',minute:'2-digit',hour12:false}),
        };

        _history.unshift(record);
        saveHistory();
        _sentToday += chosen.length;
        updateStats();
        self.renderHistory();
        showToast('✅', 'Alert Dispatched', chosen.length + ' contact' + (chosen.length > 1 ? 's' : '') + ' notified — ' + region.split('(')[0].trim());
      }, 1800);
    },

    switchTab: function(tab, btn) {
      _tab = tab;
      ['al-tab-today','al-tab-all','al-tab-critical'].forEach(function(id){
        var b = el(id); if (b) b.classList.remove('active');
      });
      if (btn) btn.classList.add('active');
      this.renderHistory();
    },

    renderHistory: function() {
      var list = el('al-history-list');
      if (!list) return;
      var regionF = (el('al-hist-filter') || {}).value || '';
      var today   = new Date().toLocaleDateString('en-IN');
      var data    = _history.slice();
      if (_tab === 'today')    data = data.filter(function(r){ return r.date === today; });
      if (_tab === 'critical') data = data.filter(function(r){ return r.severity === 'red'; });
      if (regionF) data = data.filter(function(r){ return r.region === regionF; });

      if (!data.length) {
        list.innerHTML = '<div style="text-align:center;padding:28px 0;color:var(--muted);font-size:12px">No alert records match this filter.</div>';
        return;
      }

      var sevColor = { red:'var(--danger)', orange:'var(--accent)', yellow:'var(--warn)', teal:'var(--info)' };
      var sevLbl   = { red:'[CRITICAL]', orange:'[HIGH]', yellow:'[MEDIUM]', teal:'[ADVISORY]' };

      list.innerHTML = data.map(function(r) {
        var col   = sevColor[r.severity] || 'var(--muted)';
        var pills = r.recipients.map(function(rc){
          return '<span style="font-size:10px;padding:2px 7px;border-radius:10px;background:var(--abyss);border:1px solid var(--rim);color:var(--info)">' + rc.name + '</span>';
        }).join(' ');
        var safeMsg = r.message.replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/\n/g,'<br>');
        return '<div style="border-radius:7px;padding:11px 13px;margin-bottom:7px;border:1px solid var(--rim);background:var(--abyss);border-left:3px solid ' + col + ';cursor:pointer" onclick="this.querySelector(\'.al-fm\').style.display=this.querySelector(\'.al-fm\').style.display===\'none\'?\'block\':\'none\'">' +
          '<div style="display:flex;justify-content:space-between;align-items:flex-start;gap:8px">' +
            '<div style="flex:1;min-width:0"><div style="font-size:12px;font-weight:600">' + sevLbl[r.severity] + ' — ' + r.region.split('(')[0].trim() + (r.ward ? ' / ' + r.ward : '') + '</div>' +
            '<div style="font-size:10px;color:var(--muted);margin-top:3px">' + r.type + ' — Ref: <span style="font-family:var(--font-mono)">' + r.ref + '</span></div></div>' +
            '<div style="text-align:right;flex-shrink:0"><div style="font-family:var(--font-mono);font-size:10px;color:var(--muted)">' + r.time + '</div><div style="font-family:var(--font-mono);font-size:10px;color:var(--muted)">' + r.date + '</div></div>' +
          '</div>' +
          '<div style="display:flex;flex-wrap:wrap;gap:4px;margin-top:7px">' + pills + '</div>' +
          '<div class="al-fm" style="display:none;margin-top:8px;padding:10px;background:var(--surface);border-radius:5px;border:1px solid var(--rim);font-size:11px;color:var(--text);line-height:1.7;font-family:var(--font-mono)">' + safeMsg + '</div>' +
          '<div style="font-size:10px;color:var(--muted);margin-top:5px">Click to expand message</div>' +
        '</div>';
      }).join('');
    },

    exportCSV: function() {
      if (!_history.length) { showToast('ℹ️', 'Nothing to Export', 'No history found.'); return; }
      var rows = [['Ref','Date','Time','Severity','Region','Ward','Type','Recipients','Message']];
      _history.forEach(function(r) {
        rows.push([
          r.ref, r.date, r.time,
          SEV_LABEL[r.severity] || r.severity,
          r.region, r.ward || '',
          '"' + r.type + '"',
          '"' + r.recipients.map(function(rc){ return rc.name; }).join('; ') + '"',
          '"' + r.message.replace(/"/g,'""').replace(/\n/g,' ') + '"',
        ]);
      });
      var csv  = rows.map(function(r){ return r.join(','); }).join('\n');
      var a    = document.createElement('a');
      a.href   = URL.createObjectURL(new Blob([csv],{type:'text/csv'}));
      a.download = 'DFIS_AlertHistory_' + new Date().toISOString().slice(0,10) + '.csv';
      a.click();
      showToast('⬇️', 'Export Complete', 'CSV downloaded.');
    },

    clearHistory: function() {
      if (!confirm('Clear ALL alert history? This cannot be undone.')) return;
      _history = [];
      saveHistory();
      updateStats();
      this.renderHistory();
      showToast('🗑️', 'History Cleared', 'All records removed.');
    },

    openAddModal: function() {
      var m = el('al-modal'); if (m) { m.style.display = 'grid'; }
    },
    closeAddModal: function() {
      var m = el('al-modal'); if (m) { m.style.display = 'none'; }
    },

    saveContact: function() {
      var name   = ((el('al-nc-name')   || {}).value || '').trim();
      var phone  = ((el('al-nc-phone')  || {}).value || '').trim();
      var role   = ((el('al-nc-role')   || {}).value || '').trim();
      var region = (el('al-nc-region')  || {}).value || '';
      if (!name || !phone) { showToast('⚠️', 'Missing Fields', 'Enter name and phone.'); return; }
      _contacts.push({ id: Date.now(), name: name, phone: phone, role: role || 'Contact', region: region });
      saveContacts();
      renderContactList();
      this.closeAddModal();
      ['al-nc-name','al-nc-phone','al-nc-role'].forEach(function(id){ var e = el(id); if(e) e.value=''; });
      showToast('✅', 'Contact Added', name + ' registered.');
    },

    removeContact: function(id) {
      if (!confirm('Remove this contact?')) return;
      _contacts = _contacts.filter(function(c){ return c.id !== id; });
      saveContacts();
      renderContactList();
      showToast('🗑️', 'Removed', 'Contact deleted.');
    },
  };

})();
