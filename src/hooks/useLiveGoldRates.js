import { useState, useEffect, useRef, useCallback } from 'react';
import {
  fetchLiveMetalRates,
  getCachedLiveRates,
  getLastMarketError
} from '../services/goldRateService';

const AUTO_REFRESH_MS = 60 * 1000; // every 60 seconds
const MANUAL_REFRESH_DEBOUNCE_MS = 3000; // throttle rapid refreshes

/**
 * useLiveGoldRates
 * ------------------------------------------------------------------
 * Canonical live Gold & Silver hook for the whole app.
 *
 * Automatic updates — no user interaction required:
 *  - On mount      : serves the 60s localStorage cache instantly, then
 *                    verifies against the API in the background.
 *  - Every 60s     : force-refreshes (skipped while the tab is hidden).
 *  - Visibility    : refreshes when the tab becomes visible again.
 *  - Online        : refreshes when the network reconnects.
 *  - Manual        : refresh() stays as a backup (debounced 3s).
 *
 * Reliability:
 *  - 3 attempts with backoff + 10s timeout + stale-request abort.
 *  - On total API failure the stale cache is served marked 'cached'
 *    ("Using cached prices") — never a static value.
 *  - Single in-flight request per hook; duplicate calls prevented.
 *
 * Returns:
 *  - gold24 / gold22 / gold18 / silver : Indian RETAIL ₹/g (the values
 *    the UI displays; spot values live in `data.spotGold*`).
 *  - data          : full enriched payload (spot + retail + metadata).
 *  - marketStatus  : 'loading' | 'live' | 'cached' | 'offline'
 *  - timestamp     : last successful fetch time (ISO) or null
 *  - loading       : true until first data arrives (skeleton state)
 *  - error         : classified market error or null
 *  - lastUpdated / refresh / status   : backwards-compatible surface.
 * ------------------------------------------------------------------
 */
export default function useLiveGoldRates({ onError } = {}) {
  const [data, setData] = useState(() => getCachedLiveRates());
  const [status, setStatus] = useState('loading');
  const [lastUpdated, setLastUpdated] = useState(null);

  const mountedRef = useRef(true);
  const refreshingRef = useRef(false);
  const lastManualRefreshRef = useRef(0);
  const wasLiveRef = useRef(false);
  const onErrorRef = useRef(onError);
  onErrorRef.current = onError;

  const applyResult = useCallback((result) => {
    if (!mountedRef.current) return;
    if (result) {
      setData(result);
      setLastUpdated(new Date(result.timestamp || Date.now()));
      setStatus(result.status === 'cached' ? 'cached' : 'live');
      wasLiveRef.current = result.status !== 'cached';
    } else {
      setStatus('offline');
      // Notify only on a live -> offline transition (no toast spam).
      if (wasLiveRef.current) {
        const err = getLastMarketError();
        if (onErrorRef.current && err) onErrorRef.current(err);
      }
      wasLiveRef.current = false;
    }
    refreshingRef.current = false;
  }, []);

  const refresh = useCallback(({ force = true } = {}) => {
    // Throttle: ignore refresh triggers within the debounce window.
    const now = Date.now();
    if (force && now - lastManualRefreshRef.current < MANUAL_REFRESH_DEBOUNCE_MS) return;
    lastManualRefreshRef.current = now;

    // Prevent duplicate concurrent requests.
    if (refreshingRef.current) return;
    refreshingRef.current = true;

    fetchLiveMetalRates({ force })
      .then((result) => applyResult(result))
      .catch(() => applyResult(null));
  }, [applyResult]);

  // Initial load + 60s auto-refresh + reconnect + tab-visibility refresh.
  useEffect(() => {
    mountedRef.current = true;

    // On mount: serve fresh cache instantly, then verify against the API.
    fetchLiveMetalRates()
      .then((result) => {
        applyResult(result);
        // If the mount response came from cache, force a real API check.
        if (result && result.cached) refresh({ force: true });
      })
      .catch(() => applyResult(null));

    const interval = setInterval(() => {
      // Skip while hidden — the visibility listener refreshes on return.
      if (document.visibilityState === 'visible') refresh({ force: true });
    }, AUTO_REFRESH_MS);

    const onOnline = () => refresh({ force: true });
    const onVisibility = () => {
      if (document.visibilityState === 'visible') refresh({ force: true });
    };
    window.addEventListener('online', onOnline);
    document.addEventListener('visibilitychange', onVisibility);

    return () => {
      mountedRef.current = false;
      clearInterval(interval);
      window.removeEventListener('online', onOnline);
      document.removeEventListener('visibilitychange', onVisibility);
    };
  }, [applyResult, refresh]);

  const error = status === 'offline' ? getLastMarketError() : null;

  return {
    // Backwards-compatible surface (existing pages).
    data,
    status,
    lastUpdated,
    refresh,
    // Canonical contract.
    gold24: data?.retailGold ?? 0,
    gold22: data?.retailGold22K ?? 0,
    gold18: data?.retailGold18K ?? 0,
    silver: data?.retailSilver ?? 0,
    marketStatus: status,
    timestamp: data?.timestamp ?? null,
    loading: status === 'loading' && !data,
    error
  };
}
