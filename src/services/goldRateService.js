/**
 * goldRateService.js
 * ------------------------------------------------------------------
 * Live Gold & Silver market feed service (gold-api.com).
 *
 * - Reads configuration ONLY from import.meta.env (never hardcoded).
 * - Fetches 24K gold (XAU) + silver (XAG) in USD/troy-ounce and
 *   converts to INR per gram using the USD->INR exchange rate.
 * - Derives 22K (91.67%) and 18K (75%) gold prices from the 24K rate.
 * - Retries failed requests (3 attempts), aborts stale requests,
 *   caches the last good response in localStorage (60s TTL) and
 *   falls back to the cache when the API is unreachable.
 * - Never throws: callers receive a clean normalized payload or null.
 * ------------------------------------------------------------------
 */

import { applyIndianRetail } from './goldRateAdapter';

const API_BASE_URL = (import.meta.env.VITE_GOLD_API_URL || 'https://api.gold-api.com').replace(/\/+$/, '');
const API_KEY = import.meta.env.VITE_GOLD_API_KEY || '';

const CACHE_KEY = 'live_metal_rates_cache_v1';
const PREV_PRICE_KEY = 'live_metal_prev_price_v1';
const FX_CACHE_KEY = 'live_fx_rate_v1';
const CACHE_TTL_MS = 60 * 1000; // 60 seconds — cache freshness rule
const FX_CACHE_TTL_MS = 60 * 1000; // FX cache follows the same 60s rule
const RETRY_ATTEMPTS = 3;
const REQUEST_TIMEOUT_MS = 10000;
const BACKOFF_BASE_MS = 800;

// 1 troy ounce = 31.1034768 grams (exact, per spec)
const GRAMS_PER_TROY_OUNCE = 31.1034768;
const TROY_OUNCE_TO_GRAM = 1 / GRAMS_PER_TROY_OUNCE;

// USD -> INR sources, tried in order. The first must not be sent any
// custom headers: a CORS preflight would be rejected by open.er-api.com.
const FX_ENDPOINTS = [
  'https://open.er-api.com/v6/latest/USD',
  'https://api.frankfurter.dev/v1/latest?base=USD&symbols=INR'
];

// Abort controller for the in-flight request (cancels stale fetches).
let activeAbortController = null;

// Last classified market error, surfaced to the UI for toasts.
let lastMarketError = null;

/**
 * Reads the cached market payload from localStorage.
 * @returns {object|null} normalized payload or null when stale/absent.
 */
export function getCachedLiveRates() {
  try {
    const raw = localStorage.getItem(CACHE_KEY);
    if (!raw) return null;
    const cached = JSON.parse(raw);
    if (!cached || !cached.timestamp) return null;
    if (Date.now() - new Date(cached.timestamp).getTime() > CACHE_TTL_MS) return null;
    // Migrate payloads cached before the retail adapter existed.
    return cached.retailGold ? cached : applyIndianRetail(cached);
  } catch {
    return null;
  }
}

/**
 * Reads the cached FX rate (USD -> INR) from localStorage.
 * @returns {number|null} cached INR rate or null when stale/absent
 */
export function getCachedFxRate() {
  try {
    const raw = localStorage.getItem(FX_CACHE_KEY);
    if (!raw) return null;
    const fx = JSON.parse(raw);
    if (!fx || typeof fx.rate !== 'number' || fx.rate <= 0) return null;
    if (Date.now() - fx.fetchedAt > FX_CACHE_TTL_MS) return null;
    return fx.rate;
  } catch {
    return null;
  }
}

/**
 * Classifies a fetch failure into a human readable market error.
 * @param {Error} error thrown by the fetch pipeline
 * @param {number} status optional HTTP status
 */
function classifyError(error, status) {
  if (status === 401 || status === 403) return { code: 'auth', message: 'Invalid or expired API key.' };
  if (status === 404) return { code: 'not_found', message: 'Market endpoint not found.' };
  if (status === 429) return { code: 'rate_limit', message: 'Market API rate limit reached.' };
  if (status >= 500) return { code: 'server', message: 'Market API server error.' };
  if (error && error.name === 'AbortError') return { code: 'timeout', message: 'Market feed timed out.' };
  return { code: 'network', message: 'Network error while fetching market feed.' };
}

/**
 * Single fetch with a hard timeout.
 * @param {string} url endpoint
 * @param {AbortSignal} signal shared abort signal
 * @param {object} options
 * @param {boolean} options.withAuth send the x-api-key header (gold-api.com only)
 * @returns {Promise<object>} parsed JSON
 */
async function fetchWithTimeout(url, signal, { withAuth = false } = {}) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
  const onOuterAbort = () => controller.abort();

  signal.addEventListener('abort', onOuterAbort);

  try {
    const headers = {};
    // Auth is scoped to the metals API. Sending it to the FX provider
    // would trigger a CORS preflight that most FX providers reject.
    if (withAuth && API_KEY) headers['x-api-key'] = API_KEY;

    const res = await fetch(url, { headers, signal: controller.signal });
    if (!res.ok) {
      const err = new Error(`HTTP ${res.status}`);
      err.status = res.status;
      throw err;
    }
    return await res.json();
  } finally {
    clearTimeout(timer);
    signal.removeEventListener('abort', onOuterAbort);
  }
}

/**
 * Resolves the current USD -> INR rate with endpoint fallback + cache.
 * @param {AbortSignal} signal shared abort signal
 * @returns {Promise<number>} INR per USD
 */
async function fetchFxRate(signal) {
  let lastErr = null;
  for (const url of FX_ENDPOINTS) {
    try {
      // withAuth: false — never send custom headers to FX providers.
      const data = await fetchWithTimeout(url, signal, { withAuth: false });
      const inr = data && data.rates && parseFloat(data.rates.INR);
      if (inr && inr > 0) {
        try {
          localStorage.setItem(FX_CACHE_KEY, JSON.stringify({ rate: inr, fetchedAt: Date.now() }));
        } catch { /* cache is best-effort only */ }
        return inr;
      }
      lastErr = new Error('Missing INR rate from FX provider.');
    } catch (err) {
      lastErr = err;
    }
  }
  // All providers unreachable — fall back to a recent FX snapshot.
  const stale = getCachedFxRate();
  if (stale) return stale;
  throw (lastErr || new Error('No FX provider available.'));
}

/**
 * Computes the change vs the previously seen price (kept in localStorage).
 */
function computeChange(normalized) {
  try {
    const prevRaw = localStorage.getItem(PREV_PRICE_KEY);
    if (prevRaw) {
      const prev = JSON.parse(prevRaw);
      if (prev && typeof prev.gold === 'number' && prev.gold > 0) {
        normalized.change = normalized.gold - prev.gold;
        normalized.changePercent = ((normalized.change / prev.gold) * 100);
        normalized.silverChange = normalized.silver - (prev.silver || normalized.silver);
        normalized.silverChangePercent = prev.silver ? ((normalized.silverChange / prev.silver) * 100) : 0;
      }
    }
    localStorage.setItem(PREV_PRICE_KEY, JSON.stringify({ gold: normalized.gold, silver: normalized.silver, at: normalized.timestamp }));
  } catch {
    /* cache is best-effort only */
  }
  return normalized;
}

/**
 * Fetches XAU + XAG prices and resolves to a single unit of account.
 *
 * Primary path: INR-priced endpoints (/price/XAU/INR, /price/XAG/INR).
 *   gold-api.com converts USD -> INR server-side and returns the price
 *   in ₹/troy-ounce plus the exchangeRate it used. No client-side FX.
 *
 * Fallback path: USD/troy-ounce endpoints + our own USD->INR chain
 *   (open.er-api.com -> frankfurter.dev -> cached FX snapshot).
 *
 * @param {AbortSignal} signal shared abort signal
 * @returns {Promise<object|null>} { goldPerOz, silverPerOz, inrPerUsd, inrPriced, marketTimestamp }
 */
async function fetchPrices(signal) {
  // 1) INR-priced endpoints (server-side FX conversion).
  try {
    const [goldData, silverData] = await Promise.all([
      fetchWithTimeout(`${API_BASE_URL}/price/XAU/INR`, signal, { withAuth: true }),
      fetchWithTimeout(`${API_BASE_URL}/price/XAG/INR`, signal, { withAuth: true })
    ]);
    if (goldData.price && silverData.price && goldData.exchangeRate) {
      return {
        goldPerOz: goldData.price,          // ₹ / troy ounce
        silverPerOz: silverData.price,      // ₹ / troy ounce
        inrPerUsd: goldData.exchangeRate,
        inrPriced: true,
        marketTimestamp: goldData.updatedAt || null
      };
    }
    throw new Error('INR-priced metal response missing required fields.');
  } catch {
    // 2) Fallback: USD/troy-ounce + client-side FX chain.
    const [goldData, silverData] = await Promise.all([
      fetchWithTimeout(`${API_BASE_URL}/price/XAU`, signal, { withAuth: true }),
      fetchWithTimeout(`${API_BASE_URL}/price/XAG`, signal, { withAuth: true })
    ]);
    const inrPerUsd = await fetchFxRate(signal);
    if (!goldData.price || !silverData.price || !inrPerUsd) return null;
    return {
      goldPerOz: goldData.price,            // USD / troy ounce
      silverPerOz: silverData.price,        // USD / troy ounce
      inrPerUsd,
      inrPriced: false,
      marketTimestamp: goldData.updatedAt || null
    };
  }
}

/**
 * Fetches live XAU/XAG (INR or USD + FX), normalizes, caches, and returns.
 * @param {object} options
 * @param {boolean} options.force bypass the 60s cache (auto-refresh / manual refresh)
 * @returns {Promise<object|null>} normalized payload or null on failure
 */
export async function fetchLiveMetalRates({ force = false } = {}) {
  // 1. Serve a fresh cache immediately (page loads, other components).
  if (!force) {
    const cached = getCachedLiveRates();
    if (cached) return cached;
  }

  // 2. Cancel any stale request still in flight.
  if (activeAbortController) activeAbortController.abort();
  const abortController = new AbortController();
  activeAbortController = abortController;

  // 3. Retry pipeline.
  for (let attempt = 0; attempt < RETRY_ATTEMPTS; attempt++) {
    try {
      const fetched = await fetchPrices(abortController.signal);
      if (!fetched) {
        lastMarketError = { code: 'parse', message: 'Unexpected market response payload.' };
        return null;
      }

      const { goldPerOz, silverPerOz, inrPerUsd, inrPriced, marketTimestamp } = fetched;
      // Unit conversion: per troy ounce -> per gram, then to INR.
      //  - INR path: price is already ₹/oz, so inrPerUsd is used as identity (1).
      //  - USD path: price × (1/31.1034768) × USD->INR.
      const gold24K = Math.round(goldPerOz * TROY_OUNCE_TO_GRAM * (inrPriced ? 1 : inrPerUsd));
      const silver = Math.round(silverPerOz * TROY_OUNCE_TO_GRAM * (inrPriced ? 1 : inrPerUsd));

      const normalized = {
        gold: gold24K,            // 24K (999), INR/gram
        gold22K: Math.round(gold24K * 22 / 24), // 22K (916), INR/gram
        gold18K: Math.round(gold24K * 18 / 24), // 18K (750), INR/gram
        silver,                   // 99.9%, INR/gram
        currency: 'INR',
        usd: inrPriced ? inrPerUsd : inrPerUsd,
        source: 'gold-api.com',
        status: 'live',
        timestamp: new Date().toISOString(),   // fetch time (app clock)
        marketTimestamp,                        // metals feed update time (API clock)
        cached: false
      };

      computeChange(normalized);
      const enriched = applyIndianRetail(normalized);
      localStorage.setItem(CACHE_KEY, JSON.stringify(enriched));
      lastMarketError = null;
      activeAbortController = null;
      return enriched;
    } catch (err) {
      if (abortController.signal.aborted) {
        // Superseded by a newer request — do not retry.
        return null;
      }
      lastMarketError = classifyError(err, err.status);
      if (attempt < RETRY_ATTEMPTS - 1) {
        await new Promise((r) => setTimeout(r, BACKOFF_BASE_MS * 2 ** attempt));
      }
    }
  }

  // 4. All retries exhausted — fall back to the stale cache if we have one.
  try {
    const raw = localStorage.getItem(CACHE_KEY);
    if (raw) {
      const cached = JSON.parse(raw);
      cached.status = 'cached';
      cached.cached = true;
      return cached.retailGold ? cached : applyIndianRetail(cached);
    }
  } catch {
    /* ignore corrupted cache */
  }
  activeAbortController = null;
  return null;
}

/**
 * Backwards-compatible alias used by LoanManagement.
 * Pass-through to fetchLiveMetalRates; use { force: true } when a fresh
 * (non-cached) rate is required, e.g. at loan issue time.
 * @returns {Promise<object|null>} normalized payload or null
 */
export function getLiveGoldRate(options) {
  return fetchLiveMetalRates(options);
}

/**
 * Returns the last classified market error (for toast notifications).
 * @returns {object|null} { code, message } or null when healthy
 */
export function getLastMarketError() {
  return lastMarketError;
}

/**
 * Market status for the LIVE / Offline indicator.
 * @returns {'live'|'cached'|'offline'} connectivity state
 */
export function getMarketStatus() {
  const cached = getCachedLiveRates();
  if (cached && !cached.cached) return 'live';
  if (cached) return 'cached';
  return 'offline';
}
