'use strict';

window.DFIS = window.DFIS || {};

DFIS.assistant = {
  histories: {
    delhi: [],
    mumbai: [],
    sikkim: [],
  },
  _loading: false,

  init() {
    this._cacheEls();
    if (!this.els.thread) return;
    this._bind();
    this._renderHistory();
    this.refreshContext(false);
  },

  refreshContext(force) {
    this._cacheEls();
    if (!this.els.thread) return;

    const history = this._history();
    if (history.length) {
      this._renderHistory();
      this._renderSidebarFromPayload(history[history.length - 1]?.payload || null);
      return;
    }
    this._renderHistory();
    this._renderSidebarFromPayload(null);
  },

  async send(message) {
    const text = String(message || this.els.input?.value || '').trim();
    if (!text || this._loading) return;

    this._pushMessage({ role: 'user', text, ts: new Date().toISOString() });
    if (this.els.input) this.els.input.value = '';
    this._renderHistory();
    this._setLoading(true, 'Assistant is grounding the reply in live city data...');

    try {
      const payload = await this._post(text);
      this._pushMessage({
        role: 'assistant',
        text: payload.answer,
        payload,
        ts: payload.timestamp || new Date().toISOString(),
      });
      this._renderHistory();
      this._renderSidebarFromPayload(payload);
    } catch (err) {
      const fallback = this._fallbackPayload(text, err);
      this._pushMessage({
        role: 'assistant',
        text: fallback.answer,
        payload: fallback,
        ts: new Date().toISOString(),
      });
      this._renderHistory();
      this._renderSidebarFromPayload(fallback);
    } finally {
      this._setLoading(false, 'Grounding from live API and datasets');
    }
  },

  _cacheEls() {
    this.els = {
      thread: document.getElementById('assistantThread'),
      input: document.getElementById('assistantInput'),
      send: document.getElementById('assistantSendBtn'),
      briefing: document.getElementById('assistantBriefing'),
      sources: document.getElementById('assistantSources'),
      suggestions: document.getElementById('assistantSuggestions'),
      status: document.getElementById('assistantStatus'),
      horizon: document.getElementById('assistantHorizon'),
    };
  },

  _bind() {
    if (this.els.send) {
      this.els.send.onclick = () => this.send();
    }
    if (this.els.input) {
      this.els.input.onkeydown = (event) => {
        if (event.key === 'Enter' && !event.shiftKey) {
          event.preventDefault();
          this.send();
        }
      };
    }
  },

  async _loadBriefing() {
    return;
  },

  async _post(message) {
    const history = this._history().slice(-6).map((item) => ({
      role: item.role,
      content: item.text,
    }));
    const response = await fetch((DFIS.live?.API_BASE || '') + '/assistant/chat', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        city: DFIS.live?.currentCity || 'delhi',
        message,
        history,
      }),
    });
    if (!response.ok) throw new Error('assistant ' + response.status);
    return response.json();
  },

  _fallbackPayload(message, err) {
    const city = DFIS.live?.getCurrentCityConfig?.() || { label: 'Delhi', fullName: 'Delhi NCT', riverLabel: 'Yamuna' };
    const live = DFIS.live?._cache || null;
    const backendUrl = (DFIS.live?.API_BASE || '/assistant') + '/chat';
    const reason = err?.message ? 'The assistant endpoint returned ' + err.message + '.' : 'The assistant endpoint is unavailable.';

    return {
      answer: city.label + ' assistant could not answer this question because the model-backed chat service is unavailable right now. Start the FastAPI backend in `dfis/python/api.py` and make sure `' + backendUrl + '` is reachable.',
      situation: [
        reason,
        'This UI is configured to use model-backed responses instead of hardcoded chat output.',
        'Current city: ' + city.fullName + '.',
      ],
      actions: [
        'Start the backend with `python api.py` from the `dfis/python` folder.',
        `Keep the backend running on \`${DFIS.live?.API_BASE || 'the backend API host'}\`.`,
        'Refresh the page and ask the question again.',
      ],
      watch_points: [
        'If another app is using port 8000, this chat route may still fail.',
        'The rest of the dashboard can still use cached live context, but chat should come only from the backend assistant route.',
      ],
      suggestions: [
        'What should officers do first in the top hotspot?',
        'Explain the current flood risk for this city.',
        'Do we need evacuation or only field deployment?',
        'Which ward or locality needs pumps first?',
        'Give me a short officer briefing for the next 6 hours.',
        'Which roads or routes are most likely to be affected?',
      ],
      sources: [
        'FastAPI assistant route: /assistant/chat',
        'Current city runtime context',
      ],
      timestamp: new Date().toISOString(),
      forecast_start: live?.backend?.status?.live_inputs?.forecast_start || live?.ts || new Date().toISOString(),
      forecast_end: live?.backend?.status?.live_inputs?.forecast_end || live?.ts || new Date().toISOString(),
    };
  },

  _buildLocalReply(context) {
    const {
      message,
      err,
      city,
      hotspot,
      weakest,
      rainNow,
      rainTotal,
      waterNow,
      waterPeak,
      hotspots,
      wards,
    } = context;
    const text = String(message || '').toLowerCase();
    const endpointNote = err?.message ? ' The backend chat endpoint is unavailable right now (' + err.message + '), so this reply is using the live dashboard data already loaded in the page.' : '';
    const riskLevel = this._deriveRiskLevel(rainNow, rainTotal, waterPeak, hotspot);
    const topHotspots = hotspots.slice(0, 3).map((item) => item.loc).filter(Boolean);
    const topWeakWards = wards
      .slice()
      .sort((a, b) => this._wardScore(a) - this._wardScore(b))
      .slice(0, 3)
      .map((item) => item.name)
      .filter(Boolean);

    const situation = [
      'Current focus city: ' + city.fullName + '.',
      hotspot ? 'Most relevant visible hotspot: ' + hotspot.loc + '.' : 'No hotspot match was found in the current visible list.',
      weakest ? 'Lowest visible readiness unit: ' + weakest.name + '.' : 'Readiness rows are limited in the current cache.',
    ];

    if (text.includes('evac')) {
      const shouldEvacuate = riskLevel === 'critical' || rainNow >= 60 || waterPeak >= waterNow + 0.5;
      return {
        answer: shouldEvacuate
          ? 'Evacuation planning should start now for the highest-risk pockets, especially around ' + (hotspot?.loc || city.fullName) + '. Conditions look serious enough that field deployment alone may be too weak if rainfall intensifies further.' + endpointNote
          : 'Based on the live dashboard context, immediate field deployment and drain clearance are the first move, not broad evacuation yet. Keep evacuation teams on standby for ' + (hotspot?.loc || city.fullName) + ' if rainfall or water levels worsen.' + endpointNote,
        situation,
        actions: [
          hotspot ? 'Stage response teams, pumps, and medical support near ' + hotspot.loc + '.' : 'Stage response teams near the top-risk area.',
          'Prepare a targeted evacuation list for low-lying homes, but trigger full movement only if water starts entering habitations or the forecast worsens.',
          weakest ? 'Raise readiness in ' + weakest.name + ' so shelters, roads, and drainage are usable if evacuation becomes necessary.' : 'Check shelter readiness before conditions worsen.',
        ],
        watch_points: [
          'Watch for fast water rise, drain overflow, and road cutoff reports in the next few hours.',
          city.riverLabel + ' peak forecast is about ' + waterPeak + ' m, with current level near ' + waterNow + ' m.',
        ],
        suggestions: [
          'Which localities should be evacuated first?',
          'What should field teams do in the next 2 hours?',
          'Give me a short officer briefing for this area.',
          'Which shelters should be kept on standby?',
          'What should traffic police prepare for first?',
        ],
      };
    }

    if (text.includes('what should') || text.includes('what do') || text.includes('should i do') || text.includes('officer')) {
      return {
        answer: 'Officers should prioritize ' + (hotspot?.loc || city.fullName) + ' first, because it is the strongest visible risk signal in the current dashboard context. Start with field deployment, drainage clearance, and route protection before the peak rainfall window.' + endpointNote,
        situation,
        actions: [
          hotspot ? 'Send the first field team to ' + hotspot.loc + ' for on-ground verification and waterlogging control.' : 'Send the first field team to the current top-risk zone.',
          weakest ? 'Assign support crews to ' + weakest.name + ' to improve pumps, road access, and response coverage.' : 'Reinforce the weakest readiness area.',
          'Keep one command update cycle focused on the next 24-hour rainfall peak of about ' + rainNow + ' mm/hr.',
        ],
        watch_points: [
          'Next 24-hour rainfall total is about ' + rainTotal + ' mm.',
          'Escalate if local complaints begin matching the hotspot pattern outside the top visible cells.',
        ],
        suggestions: [
          'Do we need evacuation or only field deployment?',
          'Which hotspot should get pumps first?',
          'Summarize the flood risk in simple words.',
          'Which teams should move in the next 2 hours?',
          'Where should route diversions be prepared?',
        ],
      };
    }

    if (text.includes('risk') || text.includes('safe') || text.includes('danger') || text.includes('flood')) {
      return {
        answer: city.fullName + ' is currently in a ' + riskLevel + ' operational risk posture from the dashboard\'s visible data. The strongest signals are rainfall near ' + rainTotal + ' mm over 24 hours, a peak intensity near ' + rainNow + ' mm/hr, and hotspot pressure around ' + (hotspot?.loc || city.fullName) + '.' + endpointNote,
        situation: situation.concat([
          topHotspots.length ? 'Top visible hotspots: ' + topHotspots.join(', ') + '.' : 'Hotspot ranking is limited in the current cache.',
        ]),
        actions: [
          'Keep monitoring concentrated in the top three visible hotspots.',
          weakest ? 'Strengthen readiness in ' + weakest.name + ' before the next rain pulse.' : 'Strengthen the weakest readiness area.',
        ],
        watch_points: [
          city.riverLabel + ' current level is about ' + waterNow + ' m and may peak near ' + waterPeak + ' m.',
          'If any hotspot shifts from nuisance flooding to property entry, treat that as an escalation trigger.',
        ],
        suggestions: [
          'Explain the risk for my area.',
          'What should officers do first?',
          'Should we activate shelters?',
          'Which hotspots are most critical right now?',
          'How serious is the next 24-hour rainfall window?',
        ],
      };
    }

    if (text.includes('prepare') || text.includes('readiness') || text.includes('team') || text.includes('deploy')) {
      return {
        answer: 'Preparation should focus on the weakest readiness areas first, with ' + (weakest?.name || city.fullName) + ' needing the most visible support in the current data. The goal is to improve drainage, pumps, and field response before the peak impact window.' + endpointNote,
        situation: situation.concat([
          topWeakWards.length ? 'Lowest visible readiness units: ' + topWeakWards.join(', ') + '.' : 'Visible readiness list is short right now.',
        ]),
        actions: [
          weakest ? 'Pre-position pumps and road-clearing teams in ' + weakest.name + '.' : 'Pre-position pumps in the weakest readiness area.',
          hotspot ? 'Pair readiness teams with hotspot surveillance near ' + hotspot.loc + '.' : 'Pair readiness teams with hotspot surveillance.',
          'Brief ward staff on the next 24-hour rainfall peak and escalation protocol.',
        ],
        watch_points: [
          'Check whether drain and road components improve after deployment.',
          'Keep reserve crews available for hotspot spillover into neighboring wards.',
        ],
        suggestions: [
          'Which ward is least prepared right now?',
          'Where should pumps be deployed first?',
          'Give me a deployment checklist.',
          'Which road links need backup planning?',
          'What support should be staged before peak rain?',
        ],
      };
    }

    return {
      answer: city.label + ' assistant is answering from the live dashboard context for this question. Right now the main operational picture shows rainfall around ' + rainTotal + ' mm over the next 24 hours, peak intensity near ' + rainNow + ' mm/hr, and the most visible concern near ' + (hotspot?.loc || city.fullName) + '.' + endpointNote,
      situation,
      actions: [
        hotspot ? 'Inspect ' + hotspot.loc + ' first and confirm ground conditions.' : 'Inspect the top visible hotspot first.',
        weakest ? 'Improve readiness in ' + weakest.name + '.' : 'Improve the weakest readiness area.',
      ],
      watch_points: [
        city.riverLabel + ' forecast peak is around ' + waterPeak + ' m.',
        'Backend assistant route should be restored if you want fully free-form AI responses beyond the dashboard-grounded fallback.',
      ],
      suggestions: [
        'What should officers do first?',
        'Explain flood risk for this city.',
        'Do we need evacuation or only deployment?',
        'Which hotspot needs immediate attention?',
        'Which teams should be placed on standby?',
        'Give me a quick city control-room briefing.',
      ],
    };
  },

  _pickRelevantHotspot(message, hotspots) {
    const text = String(message || '').toLowerCase();
    return hotspots.find((item) => {
      const fields = [item?.loc, item?.dist, item?.cause].filter(Boolean).join(' ').toLowerCase();
      return fields && text && text.split(/\s+/).some((token) => token.length > 3 && fields.includes(token));
    }) || null;
  },

  _pickWeakestWard(wards) {
    return wards.slice().sort((a, b) => this._wardScore(a) - this._wardScore(b))[0] || null;
  },

  _wardScore(ward) {
    if (!ward) return 9999;
    if (DFIS.utils && typeof DFIS.utils.computeScore === 'function') {
      return DFIS.utils.computeScore(ward);
    }
    const values = ['drain', 'pump', 'road', 'response']
      .map((key) => Number(ward[key]))
      .filter((value) => !Number.isNaN(value));
    if (!values.length) return 9999;
    return Math.round(values.reduce((sum, value) => sum + value, 0) / values.length);
  },

  _deriveRiskLevel(rainNow, rainTotal, waterPeak, hotspot) {
    const hotspotRisk = String(hotspot?.risk || '').toLowerCase();
    if (hotspotRisk === 'critical' || rainNow >= 80 || rainTotal >= 150) return 'critical';
    if (hotspotRisk === 'high' || rainNow >= 35 || rainTotal >= 60 || waterPeak >= 205) return 'high';
    if (hotspotRisk === 'medium' || rainNow > 7.5 || rainTotal > 15) return 'moderate';
    return 'low';
  },

  _history() {
    const city = DFIS.live?.currentCity || 'delhi';
    if (!this.histories[city]) this.histories[city] = [];
    return this.histories[city];
  },

  _pushMessage(message, replaceAssistantIntro) {
    const history = this._history();
    if (replaceAssistantIntro && history.length === 1 && history[0].role === 'assistant') {
      history[0] = message;
      return;
    }
    history.push(message);
  },

  _renderHistory() {
    if (!this.els.thread) return;
    const history = this._history();
    this.els.thread.innerHTML = '';
    if (!history.length) {
      const empty = document.createElement('div');
      empty.className = 'assistant-body';
      empty.style.color = 'var(--muted)';
      empty.textContent = 'Ask anything. The assistant will use Gemini for chat and live dashboard data when your question needs it.';
      this.els.thread.appendChild(empty);
      return;
    }

    history.forEach((message) => {
      const wrap = document.createElement('div');
      wrap.className = 'assistant-msg ' + message.role;

      const avatar = document.createElement('div');
      avatar.className = 'assistant-avatar';
      avatar.textContent = message.role === 'assistant' ? '🤖' : '👮';

      const bubble = document.createElement('div');
      bubble.className = 'assistant-bubble';

      const meta = document.createElement('div');
      meta.className = 'assistant-meta';
      meta.textContent = (message.role === 'assistant' ? 'Dhristi Copilot' : 'Officer Query') + ' · ' + this._formatTime(message.ts);

      const body = document.createElement('div');
      body.className = 'assistant-body';
      body.textContent = message.text;

      bubble.appendChild(meta);
      bubble.appendChild(body);

      wrap.appendChild(avatar);
      wrap.appendChild(bubble);
      this.els.thread.appendChild(wrap);
    });

    this.els.thread.scrollTop = this.els.thread.scrollHeight;
  },

  _appendList(parent, title, items) {
    const rows = this._normaliseList(items);
    if (!rows.length) return;
    const heading = document.createElement('div');
    heading.className = 'assistant-meta';
    heading.style.marginTop = '12px';
    heading.textContent = title;
    parent.appendChild(heading);

    const list = document.createElement('div');
    list.className = 'assistant-list';
    rows.forEach((item) => {
      const row = document.createElement('div');
      row.className = 'assistant-list-item';
      row.textContent = item;
      list.appendChild(row);
    });
    parent.appendChild(list);
  },

  _renderSidebarFromPayload(payload) {
    const live = DFIS.live?._cache || null;
    const city = DFIS.live?.getCurrentCityConfig?.() || { fullName: 'Delhi NCT' };
    const active = payload || this._fallbackPayload('', null);

    if (this.els.briefing) {
      const summary = typeof active.answer === 'string' && active.answer.trim()
        ? active.answer
        : 'Chat naturally with the assistant. It will pull in live forecast and model data only when your question needs it.';
      this.els.briefing.textContent = summary;
    }

    if (this.els.sources) {
      this.els.sources.innerHTML = '';
      this._normaliseList(active.sources).forEach((source) => {
        const row = document.createElement('div');
        row.style.marginBottom = '6px';
        row.textContent = source;
        this.els.sources.appendChild(row);
      });
    }

    const suggestions = this._normaliseList(active.suggestions).length
      ? this._normaliseList(active.suggestions)
      : this._defaultSuggestions();
    this._renderSuggestions(suggestions);

    if (this.els.horizon) {
      const start = active.forecast_start ? this._formatWindow(active.forecast_start) : '';
      const end = active.forecast_end ? this._formatWindow(active.forecast_end) : '';
      this.els.horizon.textContent = start && end ? start + ' → ' + end : 'Next 24 hours';
    }

    if (this.els.status) {
      const risk = active.metrics?.risk_level || live?.prediction?.risk_level || 'LIVE';
      this.els.status.textContent = city.fullName + ' · next 24h grounded reply · ' + risk;
    }
  },

  _renderSuggestions(items) {
    if (!this.els.suggestions) return;
    this.els.suggestions.innerHTML = '';
    this._normaliseList(items).forEach((item) => {
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.className = 'assistant-suggestion';
      btn.textContent = item;
      btn.onclick = () => {
        if (this.els.input) this.els.input.value = item;
        this.send(item);
      };
      this.els.suggestions.appendChild(btn);
    });
  },

  _normaliseList(items) {
    if (Array.isArray(items)) {
      return items
        .map((item) => String(item || '').trim())
        .filter(Boolean);
    }
    if (typeof items === 'string') {
      return items
        .split(/\n|[.;]\s+/)
        .map((item) => item.trim())
        .filter(Boolean);
    }
    if (items && typeof items === 'object') {
      return Object.values(items)
        .map((item) => String(item || '').trim())
        .filter(Boolean);
    }
    return [];
  },

  _defaultSuggestions() {
    const city = DFIS.live?.getCurrentCityConfig?.() || { fullName: 'Delhi NCT' };
    const topHotspot = DFIS.HOTSPOTS[0]?.loc || city.fullName;
    const weakWard = DFIS.WARDS.slice().sort((a, b) => DFIS.utils.computeScore(a) - DFIS.utils.computeScore(b))[0]?.name || city.fullName;
    return [
      'What should officers do first in ' + topHotspot + '?',
      'How should we prepare ' + weakWard + ' for the next 24 hours?',
      'Do we need evacuation or only field deployment?',
      'Explain the current flood risk for ' + city.fullName + '.',
      'Which hotspot should get pumps first in ' + city.fullName + '?',
      'Give me a short control-room briefing for ' + city.fullName + '.',
      'Which roads or low-lying areas should be watched first?',
    ];
  },

  _setLoading(loading, text) {
    this._loading = !!loading;
    if (this.els.send) this.els.send.disabled = !!loading;
    if (this.els.status) this.els.status.textContent = text;
  },

  _formatTime(value) {
    try {
      return new Date(value).toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit' });
    } catch (e) {
      return '--:--';
    }
  },

  _formatWindow(value) {
    try {
      return new Date(value).toLocaleString('en-IN', { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit', hour12: false });
    } catch (e) {
      return value || '';
    }
  },
};
