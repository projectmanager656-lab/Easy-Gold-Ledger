/**
 * goldRateAdapter.js
 * ------------------------------------------------------------------
 * Converts international spot prices (gold-api.com) into estimated
 * Indian RETAIL gold/silver prices per gram.
 *
 * Formula (all components configurable via .env, never hardcoded prices):
 *
 *   retailFactor = (1 + importDuty) x (1 + GST) x (1 + marketPremium)
 *   retailPrice  = round(spotPrice x retailFactor)
 *
 * Components (India, verified 2026):
 *   - Import duty : 15% (10% BCD + 5% AIDC, effective 13 May 2026,
 *                   applies to gold AND silver bullion).
 *   - GST         : 3% (IGST applied on duty-inclusive value).
 *   - Market premium : the typical spread of Indian jeweller / NBFC
 *                   board rates over the statutory landed cost. It is a
 *                   market figure and can be NEGATIVE — right after the
 *                   May 2026 duty hike the market traded BELOW the full
 *                   statutory stack (old inventory, TRQ concessions,
 *                   demand compression), i.e. roughly -4.5% on top of
 *                   duty + GST. Tune this in .env as your local boards move.
 *
 * Overrides (dotenv / .env):
 *   VITE_GOLD_IMPORT_DUTY_RATE   e.g. 0.15
 *   VITE_GOLD_GST_RATE           e.g. 0.03
 *   VITE_GOLD_MARKET_PREMIUM     e.g. -0.045
 *
 * The adapter only adds RETAIL fields to the normalized payload — the
 * spot values are preserved for transparency (Spot / Retail / Difference).
 * ------------------------------------------------------------------
 */

/**
 * Resolves the retail conversion configuration.
 * @returns {{ importDuty: number, gst: number, marketPremium: number }}
 */
export function getRetailConfig() {
  const num = (value, fallback) => {
    const n = parseFloat(value);
    return Number.isFinite(n) ? n : fallback;
  };
  return {
    importDuty: num(import.meta.env.VITE_GOLD_IMPORT_DUTY_RATE, 0.15),
    gst: num(import.meta.env.VITE_GOLD_GST_RATE, 0.03),
    marketPremium: num(import.meta.env.VITE_GOLD_MARKET_PREMIUM, -0.045)
  };
}

/**
 * Computes the combined spot -> Indian retail multiplier.
 * @param {{ importDuty: number, gst: number, marketPremium: number }} [config]
 * @returns {number}
 */
export function retailFactorFrom(config = getRetailConfig()) {
  return (1 + config.importDuty) * (1 + config.gst) * (1 + config.marketPremium);
}

/**
 * Enriches a normalized live-rate payload with Indian RETAIL prices.
 * Purity scaling (22K / 18K) is applied on the retail 24K value so the
 * UI contract "22K = 24K x 22/24" holds exactly.
 *
 * @param {object|null} payload normalized payload from goldRateService
 * @returns {object|null} same payload + retail fields (null passthrough)
 */
export function applyIndianRetail(payload) {
  if (!payload) return null;
  const config = getRetailConfig();
  const factor = retailFactorFrom(config);

  const retailGold = Math.round(payload.gold * factor);
  const retailSilver = Math.round(payload.silver * factor);

  return {
    ...payload,
    // Spot values — kept and explicitly labelled.
    spotGold: payload.gold,
    spotGold22K: payload.gold22K,
    spotGold18K: payload.gold18K,
    spotSilver: payload.silver,
    // Indian retail values — the primary display values.
    retailGold,
    retailGold22K: Math.round(retailGold * 22 / 24),
    retailGold18K: Math.round(retailGold * 18 / 24),
    retailSilver,
    // Conversion metadata for UI transparency.
    retailFactor: factor,
    retailConfig: config,
    retailSource: 'gold-api.com spot → Indian retail (est.)'
  };
}
