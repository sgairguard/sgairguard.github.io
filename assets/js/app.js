// SG AirGuard web page: fetches NEA readings from data.gov.sg (no API key) and renders them.
// Never shows a guessed number: late data is labelled with its time, and a broken payload shows an error.
import {
  REGIONS, GROUPS, pm25Band, psiBand, psiAdvisoryLevel, PSI_ADVISORY_LEVELS,
  pm25BarFraction, psiRangeFractions, projectPsiForecast,
  hourActionKey, showMaskLine, showDoctorLine, psiAdviceKey,
  parsePm25, parsePsi, NeaPayloadError, islandwide, historyPoints, topWeatherForecast,
  isLate, sgtDate, sgtParts, HOUR,
} from './logic.js';
import { STRINGS } from './i18n.js';
import { VIEW_BOX, ISLANDS, REGION_CLIPS, DIVIDERS, BADGE_POSITIONS } from './map-geometry.js';

const API_PSI = 'https://api-open.data.gov.sg/v2/real-time/api/psi';
const API_PM25 = 'https://api-open.data.gov.sg/v2/real-time/api/pm25';
const API_WEATHER = 'https://api.data.gov.sg/v1/environment/2-hour-weather-forecast';
const FETCH_TIMEOUT_MS = 15_000;
const REFRESH_EVERY_MS = 5 * 60_000;
const TICK_MS = 60_000;
const MOMENTUM_HISTORY_MS = 3 * HOUR;
const SVG_NS = 'http://www.w3.org/2000/svg';

// Per-viewer conveniences only; the page works the same when storage is blocked.
const storage = {
  get(key) { try { return localStorage.getItem(`sgairguard.${key}`); } catch { return null; } },
  set(key, value) { try { localStorage.setItem(`sgairguard.${key}`, value); } catch { /* storage blocked */ } },
};

function initialLang() {
  const param = new URLSearchParams(location.search).get('lang');
  if (param === 'zh' || param === 'en') return param;
  const saved = storage.get('lang');
  if (saved === 'zh' || saved === 'en') return saved;
  return (navigator.languages ?? [navigator.language]).some((l) => /^zh/i.test(l)) ? 'zh' : 'en';
}

const prefs = {
  lang: initialLang(),
  group: GROUPS.includes(storage.get('group')) ? storage.get('group') : 'healthy',
  large: storage.get('text') === 'large',
};

const state = { data: null, error: null, refreshFailed: false, lastAttempt: 0, loading: false };

// ---- Fetching -------------------------------------------------------------------

async function fetchJson(url) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
  try {
    const res = await fetch(url, { signal: controller.signal, cache: 'no-store' });
    if (!res.ok) throw new Error(`HTTP ${res.status} from ${new URL(url).pathname}`);
    return await res.json();
  } finally {
    clearTimeout(timer);
  }
}

const pm25ForDate = (date) => fetchJson(`${API_PM25}?date=${date}`).then(parsePm25);

async function loadData(now) {
  const [psiResult, pm25Result, weatherResult] = await Promise.allSettled([
    fetchJson(API_PSI).then(parsePsi),
    pm25ForDate(sgtDate(now)),
    fetchJson(API_WEATHER),
  ]);
  if (psiResult.status === 'rejected') throw psiResult.reason;
  if (pm25Result.status === 'rejected') throw pm25Result.reason;

  const psiItems = psiResult.value;
  let pm25Items = pm25Result.value;
  if (psiItems.length === 0) throw new NeaPayloadError('NEA returned no PSI readings');

  // Just after midnight today's list is short: add yesterday's for the 3-hour momentum.
  const span = pm25Items.length ? pm25Items[0].t - pm25Items[pm25Items.length - 1].t : 0;
  if (span < MOMENTUM_HISTORY_MS) {
    try {
      pm25Items = [...pm25Items, ...(await pm25ForDate(sgtDate(now - 24 * HOUR)))].sort((a, b) => b.t - a.t);
    } catch (err) {
      if (pm25Items.length === 0) throw err;
      console.warn('SG AirGuard: yesterday\'s PM2.5 history unavailable; forecast uses today only.', err.message);
    }
  }
  if (pm25Items.length === 0) throw new NeaPayloadError('NEA returned no PM2.5 readings');

  let weather = null;
  if (weatherResult.status === 'fulfilled') {
    weather = topWeatherForecast(weatherResult.value);
  } else {
    console.warn('SG AirGuard: 2-hour weather forecast unavailable; forecast assumes no rain.', weatherResult.reason?.message);
  }

  return { pm25: pm25Items[0], psi: psiItems[0], history: historyPoints(pm25Items), weather };
}

async function refresh() {
  if (state.loading) return;
  state.loading = true;
  state.lastAttempt = Date.now();
  try {
    state.data = await loadData(state.lastAttempt);
    state.error = null;
    state.refreshFailed = false;
  } catch (err) {
    console.warn('SG AirGuard: could not load NEA readings.', err.message);
    if (state.data) state.refreshFailed = true;
    else state.error = err;
  } finally {
    state.loading = false;
    render();
  }
}

// ---- DOM helpers ----------------------------------------------------------------

function el(tag, props = {}, children = []) {
  const node = document.createElement(tag);
  for (const [key, value] of Object.entries(props)) {
    if (value === undefined || value === null) continue;
    if (key === 'class') node.className = value;
    else if (key === 'text') node.textContent = value;
    else node.setAttribute(key, value);
  }
  for (const child of [].concat(children)) if (child) node.append(child);
  return node;
}

function svg(tag, attrs = {}, children = []) {
  const node = document.createElementNS(SVG_NS, tag);
  for (const [key, value] of Object.entries(attrs)) node.setAttribute(key, value);
  for (const child of children) node.append(child);
  return node;
}

const byId = (id) => document.getElementById(id);

// Live regions re-announce on every change, so only replace their content when it differs.
function replaceIfChanged(container, nodes) {
  const key = nodes.map((n) => n.outerHTML).join('');
  if (container.dataset.rendered === key) return;
  container.dataset.rendered = key;
  container.replaceChildren(...nodes);
}

// Constant icon shapes (Material-style), drawn in currentColor.
const ICON_PATHS = {
  ok: ['M8 12.5l2.6 2.6L16 9.6'],
  info: ['M12 11v6', 'M12 7.5v.5'],
  warn: ['M12 10v4.5', 'M12 17.2v.3'],
  report: ['M12 7v6', 'M12 16.5v.5'],
  clock: ['M12 7v5.5l3.5 2'],
};

function icon(name, size = 22) {
  const shape = name === 'warn'
    ? svg('path', { d: 'M12 3.5L21.5 20h-19z', fill: 'none', stroke: 'currentColor', 'stroke-width': '2', 'stroke-linejoin': 'round' })
    : name === 'report'
      ? svg('path', { d: 'M8.2 3h7.6L21 8.2v7.6L15.8 21H8.2L3 15.8V8.2z', fill: 'none', stroke: 'currentColor', 'stroke-width': '2', 'stroke-linejoin': 'round' })
      : svg('circle', { cx: '12', cy: '12', r: '9', fill: 'none', stroke: 'currentColor', 'stroke-width': '2' });
  const strokes = ICON_PATHS[name].map((d) => svg('path', {
    d, fill: 'none', stroke: 'currentColor', 'stroke-width': '2.3', 'stroke-linecap': 'round', 'stroke-linejoin': 'round',
  }));
  return svg('svg', { width: String(size), height: String(size), viewBox: '0 0 24 24', 'aria-hidden': 'true' }, [shape, ...strokes]);
}

const BAND_ICONS = { 1: 'ok', 2: 'info', 3: 'warn', 4: 'report' };
const PSI_TONES = { good: 'b1', moderate: 'b2', unhealthy: 'pu', veryUnhealthy: 'b3', hazardous: 'b4' };
const LEVEL_TONES = { goodModerate: 'b1', unhealthy: 'pu', veryUnhealthy: 'b3', hazardous: 'b4' };

const pm25Tone = (value, stale) => (stale || value === null ? 'tone-stale' : `tone-b${pm25Band(value)}`);
const psiTone = (value, stale) => (stale || value === null ? 'tone-stale' : `tone-${PSI_TONES[psiBand(value)]}`);
const fmt = (n) => String(Math.round(n));

// ---- Rendering --------------------------------------------------------------------

function applyStatic(s) {
  document.documentElement.lang = s.htmlLang;
  document.documentElement.classList.toggle('large', prefs.large);
  document.title = s.pageTitle;
  for (const node of document.querySelectorAll('[data-i18n]')) {
    const value = s[node.dataset.i18n];
    if (typeof value === 'string') node.textContent = value;
  }
  for (const node of document.querySelectorAll('[data-i18n-aria]')) {
    node.setAttribute('aria-label', s[node.dataset.i18nAria]);
  }
  const lang = byId('lang-toggle');
  lang.textContent = s.langSwitch;
  lang.lang = s.langSwitchLang;
  lang.setAttribute('aria-label', s.langSwitchLabel);
  const text = byId('text-toggle');
  text.textContent = s.textLarger;
  text.setAttribute('aria-pressed', String(prefs.large));
  byId('play-link').href = s.playUrl;
  const badge = byId('play-badge');
  badge.src = s.badgeSrc;
  badge.alt = s.badgeAlt;
  byId('map-key').setAttribute('aria-label', s.mapKey);
}

function renderStatus(s, view, now) {
  const status = byId('status');
  if (state.error && !state.data) {
    const retry = el('button', { type: 'button', class: 'pill', text: s.retry });
    replaceIfChanged(status, [el('section', { class: 'banner banner-error', 'aria-labelledby': 'h-error' }, [
      icon('report', 28),
      el('div', { class: 'stack-sm' }, [
        el('h2', { id: 'h-error', text: s.errorHeading }),
        el('p', { text: state.error instanceof NeaPayloadError ? s.errorChanged : s.errorBody }),
        el('p', {}, el('a', { href: 'https://www.haze.gov.sg', text: s.lateLink })),
        retry,
      ]),
    ])]);
    // The banner may be reused unchanged, so bind to whichever retry button is in the page.
    status.querySelector('button').onclick = refresh;
    return;
  }
  if (view?.late) {
    const hours = Math.max(2, Math.floor((now - view.readingT) / HOUR));
    replaceIfChanged(status, [el('section', { class: 'banner banner-late', 'aria-labelledby': 'h-late' }, [
      icon('clock', 28),
      el('div', { class: 'stack-sm' }, [
        el('h2', { id: 'h-late', text: s.lateHeading }),
        el('p', { text: s.lateBody(s.time(sgtParts(view.readingT)), s.ago(hours)) }),
        el('p', {}, el('a', { href: 'https://www.haze.gov.sg', text: s.lateLink })),
      ]),
    ])]);
  } else if (view && state.refreshFailed) {
    replaceIfChanged(status, [el('p', { class: 'banner banner-late', text: s.refreshFailed(s.time(sgtParts(view.readingT))) })]);
  } else {
    replaceIfChanged(status, []);
  }
}

function pm25Bar(value) {
  const marker = el('span', { class: 'marker' });
  marker.style.setProperty('left', `${(pm25BarFraction(value) * 100).toFixed(2)}%`);
  return el('div', { class: 'pm25-bar', 'aria-hidden': 'true' }, [
    el('div', { class: 'segments' }, [1, 2, 3, 4].map((b) => el('span', { class: `seg-b${b}` }))),
    marker,
  ]);
}

function renderIsland(s, view) {
  const body = byId('island-body');
  body.replaceChildren();
  byId('island').setAttribute('aria-busy', String(!view));
  if (!view) return;
  const { pm25, psi, late } = view;
  const band = pm25 === null ? null : pm25Band(pm25);
  const pmBlock = el('div', { class: `reading reading-main ${pm25Tone(pm25, late)}` }, [
    el('div', { class: 'reading-head' }, [
      el('span', { class: 'reading-label', text: late ? `${s.pm25Label} · ${s.atTime(s.clock(sgtParts(view.readingT)))}` : s.pm25Label }),
      el('span', { class: 'reading-band' }, band === null ? [s.noReading] : [late ? null : icon(BAND_ICONS[band]), s.band[band]]),
    ]),
  ]);
  if (pm25 !== null) {
    pmBlock.append(
      el('span', { class: 'reading-value' }, [el('span', { class: 'num', text: fmt(pm25) }), el('span', { text: s.unit })]),
      pm25Bar(pm25),
    );
  }
  const psiBlock = el('div', { class: `reading reading-row ${psiTone(psi, late)}` }, [
    el('span', { class: 'reading-label', text: s.psiLabel }),
    psi === null
      ? el('span', { text: s.noReading })
      : el('span', { class: 'value' }, [el('span', { class: 'num', text: fmt(psi) }), el('span', { text: s.psi[psiBand(psi)] })]),
  ]);
  body.append(pmBlock, psiBlock);
}

function renderGroups(s) {
  const container = byId('groups');
  if (container.childElementCount === 0) {
    for (const group of GROUPS) {
      const button = el('button', { type: 'button', class: 'group', 'data-group': group });
      button.addEventListener('click', () => {
        prefs.group = group;
        storage.set('group', group);
        render();
      });
      container.append(button);
    }
  }
  for (const button of container.children) {
    button.textContent = s.group[button.dataset.group];
    button.setAttribute('aria-pressed', String(button.dataset.group === prefs.group));
  }
}

function renderAdvice(s, view) {
  renderGroups(s);
  const body = byId('advice-body');
  if (!view) {
    replaceIfChanged(body, []);
    return;
  }
  if (view.late || view.pm25 === null) {
    replaceIfChanged(body, [el('p', { class: 'action', text: s.advicePaused }), el('p', { class: 'muted', text: s.advicePausedBody })]);
    return;
  }
  const band = pm25Band(view.pm25);
  const lines = [el('p', { class: 'action', text: s.hour[hourActionKey(band, prefs.group).slice('hour.'.length)] })];
  if (showMaskLine(band, prefs.group)) lines.push(el('p', { text: s.mask }));
  if (showDoctorLine(band)) lines.push(el('p', { text: s.doctor }));
  lines.push(el('p', { class: 'muted small', text: s.adviceSource }));
  replaceIfChanged(body, lines);
}

function hatchPattern(region, band) {
  const d = band === 2 ? 'M0,8 L8,0' : band === 3 ? 'M0,8 L8,0 M0,0 L8,8' : 'M0,6 L4,2 L8,6';
  return svg('pattern', { id: `hatch-${region}`, width: '8', height: '8', patternUnits: 'userSpaceOnUse' }, [
    svg('path', { d, class: `hatch-line tone-b${band}` }),
  ]);
}

// Callout placement from the app's calculateBadgeOffset: centred on the region, kept 4px inside the map.
// The callout size (--bw, --bh) scales with the map width in site.css.
const BADGE_EDGE_MARGIN = 4;

function mapBadge(s, region, pm25, psi, tone) {
  const [x, y] = BADGE_POSITIONS[region];
  const band = pm25 === null ? null : pm25Band(pm25);
  const badge = el('span', { class: `map-badge ${tone}` }, [
    el('span', { class: 'mb-name' }, [band === null ? null : icon(BAND_ICONS[band], 12), s.region[region]]),
    el('span', { class: 'mb-pm' }, [
      el('span', { class: 'mb-pm-label', text: 'PM2.5 ' }),
      el('span', { class: 'mb-pm-value', text: pm25 === null ? '--' : fmt(pm25) }),
    ]),
    el('span', { class: 'mb-psi', text: `PSI ${psi === null ? '--' : fmt(psi)}` }),
  ]);
  const m = BADGE_EDGE_MARGIN;
  badge.style.setProperty('left', `clamp(${m}px, calc(${x * 100}% - var(--bw) / 2), calc(100% - var(--bw) - ${m}px))`);
  badge.style.setProperty('top', `clamp(${m}px, calc(${y * 100}% - var(--bh) / 2), calc(100% - var(--bh) - ${m}px))`);
  return badge;
}

function renderMap(s, view) {
  const figure = byId('map-figure');
  figure.replaceChildren();
  if (!view) return;
  const defs = svg('defs', {}, [svg('clipPath', { id: 'islands' }, [svg('path', { d: ISLANDS })])]);
  const fills = svg('g', { 'clip-path': 'url(#islands)' });
  const badges = el('div', { 'aria-hidden': 'true' });
  const summary = [];
  for (const region of REGIONS) {
    const value = view.pm25Regions[region];
    const tone = pm25Tone(value, view.late);
    fills.append(svg('path', { d: REGION_CLIPS[region], class: `map-region ${tone}` }));
    if (value !== null && !view.late) {
      const band = pm25Band(value);
      summary.push(s.mapRegionSummary(s.region[region], s.band[band]));
      if (band > 1) {
        defs.append(hatchPattern(region, band));
        fills.append(svg('path', { d: REGION_CLIPS[region], fill: `url(#hatch-${region})` }));
      }
    }
    badges.append(mapBadge(s, region, value, view.psiRegions[region], tone));
  }
  fills.append(svg('path', { d: DIVIDERS, class: 'map-dividers' }));
  const label = view.late ? s.mapLateLabel : s.mapLabel(summary.join(' '));
  figure.append(
    svg('svg', { viewBox: VIEW_BOX, role: 'img', 'aria-label': label }, [defs, fills, svg('path', { d: ISLANDS, class: 'map-coast' })]),
    badges,
  );

  const key = byId('map-key');
  key.replaceChildren();
  const swatchLines = { 2: 'M4 14l8-8M8 18l10-10', 3: 'M5 17L17 5M5 5l12 12', 4: 'M5 11l6-5 6 5M5 16l6-5 6 5' };
  for (const band of [1, 2, 3, 4]) {
    const shapes = [svg('rect', { x: '1', y: '1', width: '20', height: '20', rx: '5', class: 'swatch' })];
    if (swatchLines[band]) shapes.push(svg('path', { d: swatchLines[band], class: 'swatch-line' }));
    key.append(el('li', { class: `tone-b${band}` }, [
      svg('svg', { width: '22', height: '22', viewBox: '0 0 22 22', 'aria-hidden': 'true' }, shapes),
      s.band[band],
    ]));
  }
}

function renderRegions(s, view) {
  const list = byId('regions');
  list.replaceChildren();
  if (!view) return;
  for (const region of REGIONS) {
    const pm = view.pm25Regions[region];
    const psi = view.psiRegions[region];
    const tone = pm25Tone(pm, view.late);
    list.append(el('li', { class: 'region' }, [
      el('h3', { text: s.region[region] }),
      el('span', { class: 'region-towns', text: s.towns[region] }),
      pm === null
        ? el('span', { class: 'region-value', text: s.noReading })
        : el('span', { class: 'region-value' }, [el('span', { class: 'num', text: fmt(pm) }), el('span', { class: 'unit', text: s.pm25Unit })]),
      pm === null ? null : el('span', { class: `chip ${tone}`, text: s.band[pm25Band(pm)] }),
      el('span', {}, [`${s.psiRow} `, el('strong', { text: psi === null ? '–' : fmt(psi) }), psi === null ? '' : ` · ${s.psi[psiBand(psi)]}`]),
    ]));
  }
}

function renderForecast(s, view) {
  const body = byId('forecast-body');
  body.replaceChildren();
  if (!view) return;
  const forecast = view.late || view.pm25 === null || view.psi === null
    ? null
    : projectPsiForecast({ pm25: view.pm25, psi: view.psi }, view.history, view.weather);
  if (!forecast) {
    body.append(el('p', { class: 'action', text: s.forecastUnavailable }), el('p', { class: 'muted', text: s.forecastLateBody }));
    return;
  }
  const { lowPsi, highPsi, highEndCategory } = forecast;
  const level = psiAdvisoryLevel(highPsi);
  const [start, end] = psiRangeFractions(lowPsi, highPsi);
  const range = el('span', { class: 'range' });
  range.style.setProperty('left', `${(start * 100).toFixed(2)}%`);
  range.style.setProperty('width', `${((end - start) * 100).toFixed(2)}%`);
  body.append(
    el('p', { class: 'forecast-range' }, [
      el('span', { class: 'num', text: `${lowPsi}–${highPsi}` }),
      el('span', { class: `chip tone-${LEVEL_TONES[level]}`, text: s.level[level] }),
    ]),
    el('div', { class: 'stack-sm', role: 'img', 'aria-label': s.forecastRangeLabel(lowPsi, highPsi, s.level[level]) }, [
      el('div', { class: 'psi-bar', 'aria-hidden': 'true' }, [
        el('div', { class: 'segments' }, PSI_ADVISORY_LEVELS.map((l) => el('span', { class: `seg-${LEVEL_TONES[l]}` }))),
        range,
      ]),
      el('div', { class: 'psi-levels', 'aria-hidden': 'true' }, PSI_ADVISORY_LEVELS.map((l) => el('span', { class: `psi-level tone-${LEVEL_TONES[l]}` }, [
        el('strong', { text: s.level[l] }), s.levelRange[l],
      ]))),
    ]),
    el('p', { class: 'muted small', text: s.forecastFor(s.group[prefs.group]) }),
    el('p', { class: 'action', text: s.psiAdvice[psiAdviceKey(highEndCategory, prefs.group).slice('psiAdvice.'.length)] }),
    el('p', { class: 'muted small', text: s.forecastFootnote(highPsi) }),
  );
}

function buildView(now) {
  const { data } = state;
  if (!data) return null;
  const readingT = Math.min(data.pm25.t, data.psi.t);
  return {
    pm25: islandwide(data.pm25),
    psi: islandwide(data.psi),
    pm25Regions: data.pm25.regions,
    psiRegions: data.psi.regions,
    history: data.history,
    weather: data.weather,
    readingT,
    late: isLate(readingT, now),
  };
}

function render() {
  const s = STRINGS[prefs.lang];
  const now = Date.now();
  const view = buildView(now);
  applyStatic(s);
  renderStatus(s, view, now);
  const updated = byId('updated');
  if (!view) {
    updated.textContent = state.error ? '' : s.loading;
  } else {
    const time = s.time(sgtParts(view.readingT));
    updated.textContent = view.late ? s.lastReading(time, s.clock(sgtParts(now))) : s.updated(time);
  }
  renderIsland(s, view);
  renderAdvice(s, view);
  renderMap(s, view);
  renderRegions(s, view);
  renderForecast(s, view);
}

// ---- Start ------------------------------------------------------------------------

function maybeRefresh() {
  if (document.visibilityState === 'visible' && Date.now() - state.lastAttempt >= REFRESH_EVERY_MS) refresh();
}

byId('lang-toggle').addEventListener('click', () => {
  prefs.lang = prefs.lang === 'zh' ? 'en' : 'zh';
  storage.set('lang', prefs.lang);
  render();
});

byId('text-toggle').addEventListener('click', () => {
  prefs.large = !prefs.large;
  storage.set('text', prefs.large ? 'large' : 'standard');
  render();
});

document.addEventListener('visibilitychange', maybeRefresh);
setInterval(() => {
  render(); // moves the page into the late state on time, even between fetches
  maybeRefresh();
}, TICK_MS);

render();
refresh();
