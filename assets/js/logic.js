// Pure logic for the SG AirGuard web page. Mirrors the Android app's Kotlin sources so both agree:
// bands (core/model AirQualityBands.kt), PSI forecast (CalculateProjectedPsiForecastUseCase.kt),
// bars (HeroFormatters.kt, PsiForecastBarLogic.kt), advice (NeaOneHourAdvice.kt, PsiForecastGaugeCard.kt)
// and payload bounds (NeaPayloadValidator.kt). Tests: docs/web/test/logic.test.mjs.

export const REGIONS = ['north', 'west', 'central', 'east', 'south'];
export const GROUPS = ['healthy', 'elderly', 'chronic'];

const HOUR_MS = 3_600_000;
const SGT_OFFSET_MS = 8 * HOUR_MS;

// NEA treats data older than this as late (owner decision, 25 Oct 2026).
export const LATE_AFTER_MS = 2 * HOUR_MS;

// NeaPayloadValidator bounds: anything outside is a broken reading, not a value to show.
const MAX_PM25_READING = 2000;
const MAX_PSI_READING = 1000;

// ---- Bands ----------------------------------------------------------------

// NEA 1-hour PM2.5 band upper thresholds (µg/m³).
const PM25_NORMAL_MAX = 55;
const PM25_ELEVATED_MAX = 150;
const PM25_HIGH_MAX = 250;

/** NEA 1-hour PM2.5 band, 1 (Normal) to 4 (Very High). */
export function pm25Band(pm25) {
  if (pm25 <= PM25_NORMAL_MAX) return 1;
  if (pm25 <= PM25_ELEVATED_MAX) return 2;
  if (pm25 <= PM25_HIGH_MAX) return 3;
  return 4;
}

/** NEA PSI descriptor: good, moderate, unhealthy, veryUnhealthy or hazardous. */
export function psiBand(psi) {
  if (psi <= 50) return 'good';
  if (psi <= 100) return 'moderate';
  if (psi <= 200) return 'unhealthy';
  if (psi <= 300) return 'veryUnhealthy';
  return 'hazardous';
}

/** NEA's four PSI health-advisory levels: goodModerate, unhealthy, veryUnhealthy, hazardous. */
export function psiAdvisoryLevel(psi) {
  if (psi <= 100) return 'goodModerate';
  if (psi <= 200) return 'unhealthy';
  if (psi <= 300) return 'veryUnhealthy';
  return 'hazardous';
}

export const PSI_ADVISORY_LEVELS = ['goodModerate', 'unhealthy', 'veryUnhealthy', 'hazardous'];

// ---- Bars -----------------------------------------------------------------

/** The overview PM2.5 bar: segment weights per band across 0..300 µg/m³ (HeroFormatters.kt). */
export const PM25_BAR_SEGMENTS = [55, 95, 100, 50];
const PM25_BAR_MAX = 300;
const PSI_BAR_MAX = 400;

const clamp01 = (x) => Math.min(1, Math.max(0, x));

export const pm25BarFraction = (pm25) => clamp01(pm25 / PM25_BAR_MAX);
export const psiBarFraction = (psi) => clamp01(psi / PSI_BAR_MAX);

/** The forecast range on the PSI bar as [start, end] fractions. */
export function psiRangeFractions(low, high) {
  const a = psiBarFraction(low);
  const b = psiBarFraction(high);
  return [Math.min(a, b), Math.max(a, b)];
}

// ---- PSI forecast (port of CalculateProjectedPsiForecastUseCase) -----------

// NEA PSI sub-index breakpoints: [PM2.5 min, PM2.5 max, PSI min, PSI max].
const SUB_INDEX_SEGMENTS = [
  [12.1, 55.4, 51, 100],
  [55.5, 150.4, 101, 200],
  [150.5, 250.4, 201, 300],
  [250.5, 350.4, 301, 400],
  [350.5, 500, 401, 500],
];
const PM25_GOOD_MAX = 12;
const PSI_GOOD_MAX = 50;

const MIN_PROJECTED_PSI = 10;
const MAX_PROJECTED_PSI = 500;
const MAX_RAW_LOW_PSI = 488;
const MIN_SPREAD = 12;
const ROLLING_24H_HOURS = 24;
const MOMENTUM_TARGET_HOURS = 3;
const MIN_MOMENTUM_DELTA_PER_HOUR = -10;
const MAX_MOMENTUM_DELTA_PER_HOUR = 10;
const WEIGHT_PSI_24H = 0.6;
const WEIGHT_CURRENT_PM25_SUB_INDEX = 0.25;
const WEIGHT_MOMENTUM_SUB_INDEX = 0.15;
const WET_LOW_MULTIPLIER = 0.8;
const DRY_LOW_MULTIPLIER = 0.9;
const WET_HIGH_MULTIPLIER = 1.05;
const DRY_HIGH_MULTIPLIER = 1.18;

const clamp = (x, lo, hi) => Math.min(hi, Math.max(lo, x));
// Kotlin's roundToInt rounds halves up, like Math.round for the non-negative values used here.
const roundToInt = (x) => Math.round(x);

export function pm25ToPsiSubIndex(pm25) {
  if (pm25 <= 0) return 0;
  if (pm25 <= PM25_GOOD_MAX) return clamp(roundToInt((PSI_GOOD_MAX / PM25_GOOD_MAX) * pm25), 0, MAX_PROJECTED_PSI);
  const segment = SUB_INDEX_SEGMENTS.find(([, cMax]) => pm25 <= cMax)
    ?? SUB_INDEX_SEGMENTS[SUB_INDEX_SEGMENTS.length - 1];
  const [cMin, cMax, iMin, iMax] = segment;
  return clamp(roundToInt(((iMax - iMin) / (cMax - cMin)) * (pm25 - cMin) + iMin), 0, MAX_PROJECTED_PSI);
}

/** PM2.5 change per hour against the reading closest to 3 hours before the latest. Points: {t, pm25}. */
export function calculateMomentum(points) {
  if (points.length < 2) return 0;
  const sorted = [...points].sort((a, b) => a.t - b.t);
  const latest = sorted[sorted.length - 1];
  const target = latest.t - MOMENTUM_TARGET_HOURS * HOUR_MS;
  let reference = null;
  for (const p of sorted.slice(0, -1)) {
    if (reference === null || Math.abs(p.t - target) < Math.abs(reference.t - target)) reference = p;
  }
  const elapsedHours = Math.max(1, (latest.t - reference.t) / HOUR_MS);
  return clamp((latest.pm25 - reference.pm25) / elapsedHours, MIN_MOMENTUM_DELTA_PER_HOUR, MAX_MOMENTUM_DELTA_PER_HOUR);
}

export function isPrecipitationForecasted(forecast) {
  if (!forecast || !forecast.trim()) return false;
  return /showers|rain|thundery/i.test(forecast);
}

export function forecastCategory(psi) {
  return psiBand(psi);
}

/**
 * Projected 24-hour PSI range. quality: {pm25, psi}; points: [{t, pm25}]; weather: NEA 2-hour forecast text.
 * Returns {lowPsi, highPsi, highEndCategory} or null without a current reading.
 */
export function projectPsiForecast(quality, points, weather) {
  if (!quality) return null;
  const cNow = quality.pm25;
  const psiNow = quality.psi;
  const currentSubIndex = pm25ToPsiSubIndex(cNow);

  const latestT = points.length ? Math.max(...points.map((p) => p.t)) : 0;
  const cutoff = latestT - ROLLING_24H_HOURS * HOUR_MS;
  const validPoints = points.filter((p) => p.t >= cutoff);

  const deltaPerHour = calculateMomentum(validPoints);
  const momentumSubIndex = pm25ToPsiSubIndex(Math.max(0, cNow + deltaPerHour));

  const wet = isPrecipitationForecasted(weather);
  const lowMultiplier = wet ? WET_LOW_MULTIPLIER : DRY_LOW_MULTIPLIER;
  const highMultiplier = wet ? WET_HIGH_MULTIPLIER : DRY_HIGH_MULTIPLIER;

  const baseline = psiNow * WEIGHT_PSI_24H
    + currentSubIndex * WEIGHT_CURRENT_PM25_SUB_INDEX
    + momentumSubIndex * WEIGHT_MOMENTUM_SUB_INDEX;
  const rawLow = clamp(roundToInt(baseline * lowMultiplier), MIN_PROJECTED_PSI, MAX_RAW_LOW_PSI);
  const rawHigh = clamp(roundToInt(baseline * highMultiplier), MIN_PROJECTED_PSI, MAX_PROJECTED_PSI);

  let lowPsi = rawLow;
  let highPsi = rawHigh;
  if (rawHigh - rawLow < MIN_SPREAD) {
    highPsi = Math.min(rawLow + MIN_SPREAD, MAX_PROJECTED_PSI);
    lowPsi = highPsi === MAX_PROJECTED_PSI ? Math.max(MAX_PROJECTED_PSI - MIN_SPREAD, MIN_PROJECTED_PSI) : rawLow;
  }
  return { lowPsi, highPsi, highEndCategory: forecastCategory(highPsi) };
}

// ---- Advice -----------------------------------------------------------------

export const isVulnerable = (group) => group !== 'healthy';

/** String key for NEA's 1-hour PM2.5 action line. */
export function hourActionKey(band, group) {
  const v = isVulnerable(group);
  switch (band) {
    case 1: return 'hour.normal';
    case 2: return v ? 'hour.elevated.vulnerable' : 'hour.elevated.healthy';
    case 3: return v ? 'hour.high.vulnerable' : 'hour.high.healthy';
    default: return v ? 'hour.veryHigh.vulnerable' : 'hour.veryHigh.healthy';
  }
}

export const showMaskLine = (band, group) => band === 4 || (band === 3 && isVulnerable(group));
export const showDoctorLine = (band) => band >= 2;

/** String key for the PSI forecast advice, based on the high end of the range. */
export function psiAdviceKey(category, group) {
  switch (category) {
    case 'good':
    case 'moderate': return 'psiAdvice.normal';
    case 'unhealthy': return `psiAdvice.unhealthy.${group}`;
    case 'veryUnhealthy': return `psiAdvice.veryUnhealthy.${group}`;
    default: return group === 'healthy' ? 'psiAdvice.hazardous.healthy' : 'psiAdvice.hazardous.vulnerable';
  }
}

// ---- NEA payloads -------------------------------------------------------------

export class NeaPayloadError extends Error {}

function readingOrNull(value, max) {
  return typeof value === 'number' && Number.isFinite(value) && value >= 0 && value <= max ? value : null;
}

function parseItems(json, readingKey, max) {
  const items = json?.data?.items;
  if (json?.code !== 0 || !Array.isArray(items)) {
    throw new NeaPayloadError(`Unexpected NEA response for ${readingKey}`);
  }
  return items.map((item) => {
    const t = Date.parse(item?.timestamp);
    const readings = item?.readings?.[readingKey];
    if (!Number.isFinite(t) || typeof readings !== 'object' || readings === null) {
      throw new NeaPayloadError(`NEA ${readingKey} item is missing its timestamp or readings`);
    }
    const regions = {};
    for (const r of REGIONS) regions[r] = readingOrNull(readings[r], max);
    return { t, regions, national: readingOrNull(readings.national, max) };
  }).sort((a, b) => b.t - a.t);
}

/** v2 pm25 payload -> items newest first: {t, regions: {north: number|null, ...}, national}. */
export const parsePm25 = (json) => parseItems(json, 'pm25_one_hourly', MAX_PM25_READING);

/** v2 psi payload -> items newest first, 24-hour PSI. */
export const parsePsi = (json) => parseItems(json, 'psi_twenty_four_hourly', MAX_PSI_READING);

/** NEA's islandwide figure, or the highest region when NEA leaves it out (as the app does). */
export function islandwide(item) {
  if (item.national !== null) return item.national;
  const values = REGIONS.map((r) => item.regions[r]).filter((v) => v !== null);
  return values.length ? Math.max(...values) : null;
}

/** Islandwide PM2.5 history for the forecast momentum: [{t, pm25}]. */
export function historyPoints(pm25Items) {
  return pm25Items
    .map((item) => ({ t: item.t, pm25: islandwide(item) }))
    .filter((p) => p.pm25 !== null);
}

/** The most common 2-hour forecast across towns (v1 2-hour-weather-forecast), or null. */
export function topWeatherForecast(json) {
  const forecasts = json?.items?.[0]?.forecasts;
  if (!Array.isArray(forecasts) || forecasts.length === 0) return null;
  const counts = new Map();
  for (const f of forecasts) {
    if (typeof f?.forecast === 'string') counts.set(f.forecast, (counts.get(f.forecast) ?? 0) + 1);
  }
  let best = null;
  for (const [text, n] of counts) if (best === null || n > counts.get(best)) best = text;
  return best;
}

// ---- Time ---------------------------------------------------------------------

export const isLate = (readingT, now) => now - readingT > LATE_AFTER_MS;

/** Singapore calendar date (UTC+8, no daylight saving) as YYYY-MM-DD. */
export function sgtDate(t) {
  return new Date(t + SGT_OFFSET_MS).toISOString().slice(0, 10);
}

/** Wall-clock parts of an instant in Singapore time. */
export function sgtParts(t) {
  const d = new Date(t + SGT_OFFSET_MS);
  return {
    year: d.getUTCFullYear(),
    month: d.getUTCMonth(),
    day: d.getUTCDate(),
    weekday: d.getUTCDay(),
    hour: d.getUTCHours(),
    minute: d.getUTCMinutes(),
  };
}

export const HOUR = HOUR_MS;
