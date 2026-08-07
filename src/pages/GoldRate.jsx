import React, { useState, useEffect } from 'react';
import { useTranslation } from 'react-i18next';
import { motion } from 'framer-motion';
import { collection, onSnapshot, query, orderBy } from 'firebase/firestore';
import { db } from '../services/firebase';
import { updateGoldRate } from '../services/firebaseService';
import useLiveGoldRates from '../hooks/useLiveGoldRates';
import { toastSuccess, toastError, toastInfo } from '../components/Toast';
import { PageHeader, GoldButton, GoldCoin, AnimatedNumber, useGreeting } from '../components/PremiumUI';
import { TrendingUp, Calendar, Clock, User, Coins, Gem, CheckCircle2, XCircle, History, RefreshCw, Globe, Save } from 'lucide-react';

export default function GoldRate() {
  const { t } = useTranslation();
  const [role] = useState(localStorage.getItem('user_role') || 'employee');
  const greeting = useGreeting();

  // List of historical (ledger) rates
  const [history, setHistory] = useState([]);
  const [currentRate, setCurrentRate] = useState(0);
  const [currentSilverRate, setCurrentSilverRate] = useState(0);

  // Form State (super_admin ledger update)
  const [newRate, setNewRate] = useState('');
  const [newSilverRate, setNewSilverRate] = useState('');
  const [loading, setLoading] = useState(false);
  const [success, setSuccess] = useState(false);

  // Live market feed (auto-refresh every 60s, cached, retried, LIVE/Offline)
  const { data: liveRates, status: marketStatus, lastUpdated, refresh } = useLiveGoldRates({
    onError: (err) => toastError(`Live market: ${err.message}`)
  });

  useEffect(() => {
    const q = query(collection(db, 'gold_rate_history'), orderBy('effectiveDate', 'desc'));
    const unsubscribe = onSnapshot(q, (snap) => {
      const list = snap.docs.map(doc => ({ id: doc.id, ...doc.data() }));
      setHistory(list);
      if (list.length > 0) {
        setCurrentRate(list[0].ratePerGram);
        setCurrentSilverRate(list[0].silverRatePerGram || 0);
      }
    });
    return unsubscribe;
  }, []);

  // Super admin: persist the live Indian RETAIL values into the ledger
  const handleSaveLiveToLedger = async () => {
    if (!liveRates) return;
    setLoading(true);
    try {
      await updateGoldRate(liveRates.retailGold, liveRates.retailSilver);
      setSuccess(true);
      toastSuccess(t('goldRate.savedToLedger') || 'Retail rates saved to the ledger.');
      setTimeout(() => setSuccess(false), 3000);
    } catch (err) {
      console.error(err);
      toastError(t('goldRate.saveFailed') || 'Failed to save live rates to the ledger.');
    } finally {
      setLoading(false);
    }
  };

  const handleUpdate = async (e) => {
    e.preventDefault();
    const goldVal = parseFloat(newRate) || currentRate;
    const silverVal = parseFloat(newSilverRate) || currentSilverRate;

    if (goldVal <= 0 && silverVal <= 0) return;

    setLoading(true);
    setSuccess(false);

    try {
      await updateGoldRate(goldVal, silverVal);
      setNewRate('');
      setNewSilverRate('');
      setSuccess(true);
      toastSuccess(t('dashboard.rateUpdateSuccess'));
      setTimeout(() => setSuccess(false), 3000);
    } catch (err) {
      console.error(err);
      toastError(t('goldRate.updateFailed') || 'Failed to update metal rates.');
    } finally {
      setLoading(false);
    }
  };

  const marketStatusClass = marketStatus === 'offline' ? 'offline' : marketStatus === 'cached' ? 'cached' : '';
  const marketStatusText = marketStatus === 'offline'
    ? (t('dashboard.marketOffline') || 'Offline')
    : marketStatus === 'cached'
      ? (t('dashboard.marketCached') || 'Cached')
      : (t('dashboard.marketLive') || 'LIVE');

  return (
    <div className="app-container">
      <main className="main-content" style={{ maxWidth: '920px' }}>

        {/* Header */}
        <PageHeader
          eyebrow={greeting}
          title={t('goldRate.title')}
          subtitle={t('goldRate.subtitle')}
          actions={
            <span className="customer-count-chip" style={{ alignSelf: 'center' }}>
              <TrendingUp size={14} />
              {marketStatusText}
            </span>
          }
        />

        {/* ============ LIVE MARKET PANEL (API powered) ============ */}
        <motion.div
          className="glass-panel"
          style={{ padding: '24px', marginBottom: 20 }}
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.55, ease: [0.22, 1, 0.36, 1] }}
        >
          <div className="flex-between" style={{ marginBottom: 16, gap: 12, flexWrap: 'wrap' }}>
            <h3 className="serif-title" style={{ margin: 0, fontSize: '1.25rem', display: 'flex', alignItems: 'center', gap: 10 }}>
              <span className="metal-coin" style={{ width: 34, height: 34 }}><Globe size={16} /></span>
              {t('goldRate.liveMarket') || 'Live Market Feed'}
              <span className="live-updated-chip" style={{ fontSize: '0.75rem' }}>
                {t('dashboard.retailGoldRate') || 'Retail Gold Rate (India)'}
              </span>
            </h3>

            <div className="flex-gap" style={{ gap: 8, flexWrap: 'wrap' }}>
              <span className={`live-badge ${marketStatusClass}`}>
                <span className={`live-pulse-dot ${marketStatusClass}`} />
                {marketStatusText}
              </span>
              <span className="live-updated-chip">
                <Clock size={12} />
                {lastUpdated
                  ? `${t('dashboard.lastUpdated') || 'Updated'} ${lastUpdated.toLocaleTimeString()}`
                  : '—'}
              </span>
              {liveRates?.marketTimestamp && (
                <span className="live-updated-chip">
                  <TrendingUp size={12} />
                  {t('goldRate.marketTime') || 'Market'} {new Date(liveRates.marketTimestamp).toLocaleTimeString()}
                </span>
              )}
              <GoldButton type="button" onClick={() => { refresh(); toastInfo(t('goldRate.syncing') || 'Refreshing live rates...'); }} style={{ padding: '8px 14px', fontSize: '0.875rem' }}>
                <RefreshCw size={14} className={marketStatus === 'loading' ? 'animate-spin' : ''} />
                {t('goldRate.refreshBtn') || 'Refresh'}
              </GoldButton>
            </div>
          </div>

          {/* Animated loading state */}
          {marketStatus === 'loading' ? (
            <div className="flex-gap" style={{ padding: '24px', justifyContent: 'center' }}>
              <div className="gold-spinner"></div>
              <span style={{ color: 'var(--text-3)', fontSize: '0.875rem' }}>{t('goldRate.fetching') || 'Fetching live market prices...'}</span>
            </div>
          ) : (
            <>
              <div className="grid-cols-2" style={{ gap: 14 }}>
                {/* Gold 24K */}
                <div className="karat-chip" style={{ justifyContent: 'space-between' }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 9 }}>
                    <GoldCoin size={30} />
                    <div>
                      <div className="karat-label">{t('goldRate.gold')} 24K</div>
                      <div style={{ fontSize: '0.875rem', color: 'var(--text-3)' }}>{t('goldRate.pureGold') || 'Pure gold'}</div>
                    </div>
                  </div>
                  <div style={{ textAlign: 'right' }}>
                    <div className="gold-gradient-text" style={{ fontWeight: 800, fontSize: '1.25rem' }}>
                      ₹<AnimatedNumber value={liveRates?.retailGold ?? 0} duration={0.8} />/g
                    </div>
                    {liveRates?.spotGold > 0 && (
                      <div style={{ fontSize: '0.75rem', color: 'var(--text-3)', marginTop: 3 }}>
                        {t('goldRate.spot') || 'Spot'} ₹{liveRates.spotGold}/g
                      </div>
                    )}
                    {liveRates && typeof liveRates.change === 'number' && (
                      <div className={`market-change-chip ${liveRates.change > 0 ? 'up' : liveRates.change < 0 ? 'down' : 'flat'}`} style={{ marginTop: 3 }}>
                        {liveRates.change > 0 ? '▲' : liveRates.change < 0 ? '▼' : '•'} ₹{Math.abs(liveRates.change)} ({liveRates.changePercent >= 0 ? '+' : ''}{liveRates.changePercent?.toFixed(2)}%)
                      </div>
                    )}
                  </div>
                </div>

                {/* Gold 22K */}
                <div className="karat-chip" style={{ justifyContent: 'space-between' }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 9 }}>
                    <span className="metal-coin" style={{ width: 30, height: 30 }}><Gem size={14} /></span>
                    <div>
                      <div className="karat-label">{t('goldRate.gold')} 22K</div>
                      <div style={{ fontSize: '0.875rem', color: 'var(--text-3)' }}>{t('goldRate.jewelleryGold') || 'Jewellery standard'}</div>
                    </div>
                  </div>
                  <div style={{ textAlign: 'right' }}>
                    <div className="gold-gradient-text" style={{ fontWeight: 800, fontSize: '1.25rem' }}>
                      ₹<AnimatedNumber value={liveRates?.retailGold22K ?? 0} duration={0.8} />/g
                    </div>
                    {liveRates?.spotGold22K > 0 && (
                      <div style={{ fontSize: '0.75rem', color: 'var(--text-3)', marginTop: 3 }}>
                        {t('goldRate.spot') || 'Spot'} ₹{liveRates.spotGold22K}/g
                      </div>
                    )}
                  </div>
                </div>

                {/* Gold 18K */}
                <div className="karat-chip" style={{ justifyContent: 'space-between' }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 9 }}>
                    <span className="metal-coin" style={{ width: 30, height: 30 }}><Gem size={14} /></span>
                    <div>
                      <div className="karat-label">{t('goldRate.gold')} 18K</div>
                      <div style={{ fontSize: '0.875rem', color: 'var(--text-3)' }}>{t('goldRate.lowKaratGold') || 'Light jewellery'}</div>
                    </div>
                  </div>
                  <div style={{ textAlign: 'right' }}>
                    <div className="gold-gradient-text" style={{ fontWeight: 800, fontSize: '1.25rem' }}>
                      ₹<AnimatedNumber value={liveRates?.retailGold18K ?? 0} duration={0.8} />/g
                    </div>
                    {liveRates?.spotGold18K > 0 && (
                      <div style={{ fontSize: '0.75rem', color: 'var(--text-3)', marginTop: 3 }}>
                        {t('goldRate.spot') || 'Spot'} ₹{liveRates.spotGold18K}/g
                      </div>
                    )}
                  </div>
                </div>

                {/* Silver */}
                <div className="karat-chip" style={{ justifyContent: 'space-between' }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 9 }}>
                    <span
                      style={{
                        width: 30, height: 30, borderRadius: '50%', display: 'inline-flex',
                        alignItems: 'center', justifyContent: 'center', flexShrink: 0,
                        background: 'radial-gradient(circle at 32% 28%, #f8fafc, #e2e8f0 38%, #94a3b8 62%, #475569 100%)',
                        boxShadow: 'inset 0 2px 8px rgba(255,255,255,0.7), inset 0 -6px 14px rgba(51,65,85,0.4)',
                        border: '2px solid rgba(226,232,240,0.8)'
                      }}
                    />
                    <div>
                      <div className="karat-label">{t('goldRate.silver')} 99.9%</div>
                      <div style={{ fontSize: '0.875rem', color: 'var(--text-3)' }}>{t('goldRate.pureSilver') || 'Pure silver'}</div>
                    </div>
                  </div>
                  <div style={{ textAlign: 'right' }}>
                    <div style={{ fontWeight: 800, fontSize: '1.25rem', background: 'linear-gradient(135deg, #e2e8f0 0%, #cbd5e1 50%, #94a3b8 100%)', WebkitBackgroundClip: 'text', WebkitTextFillColor: 'transparent' }}>
                      ₹<AnimatedNumber value={liveRates?.retailSilver ?? 0} duration={0.8} />/g
                    </div>
                    {liveRates?.spotSilver > 0 && (
                      <div style={{ fontSize: '0.75rem', color: 'var(--text-3)', marginTop: 3 }}>
                        {t('goldRate.spot') || 'Spot'} ₹{liveRates.spotSilver}/g
                      </div>
                    )}
                    {liveRates && typeof liveRates.silverChange === 'number' && (
                      <div className={`market-change-chip ${liveRates.silverChange > 0 ? 'up' : liveRates.silverChange < 0 ? 'down' : 'flat'}`} style={{ marginTop: 3 }}>
                        {liveRates.silverChange > 0 ? '▲' : liveRates.silverChange < 0 ? '▼' : '•'} ₹{Math.abs(liveRates.silverChange)} ({liveRates.silverChangePercent >= 0 ? '+' : ''}{liveRates.silverChangePercent?.toFixed(2)}%)
                      </div>
                    )}
                  </div>
                </div>
              </div>

              {liveRates ? (
                <div style={{ display: 'flex', alignItems: 'center', gap: 16, fontSize: '0.75rem', color: 'var(--text-3)', marginTop: 16, flexWrap: 'wrap' }}>
                  <span className="live-updated-chip">
                    {t('goldRate.currency') || 'Currency'}: {liveRates.currency} (₹{liveRates.usd}/$)
                  </span>
                  <span className="live-updated-chip">
                    {t('goldRate.marketStatus') || 'Market Status'}: {marketStatusText}
                  </span>
                  <span className="live-updated-chip">
                    {t('goldRate.source') || 'Source'}: {liveRates.source} → {t('goldRate.retailSource') || 'Indian Retail (est.)'}
                  </span>
                  {liveRates?.spotGold > 0 && (
                    <span className="live-updated-chip">
                      {t('goldRate.difference') || 'Diff'}: +₹{liveRates.retailGold - liveRates.spotGold}/g (+{(((liveRates.retailGold / liveRates.spotGold) - 1) * 100).toFixed(1)}%)
                    </span>
                  )}
                  {liveRates?.retailFactor && (
                    <span className="live-updated-chip">
                      {t('goldRate.retailFactor') || 'Retail factor'}: ×{liveRates.retailFactor.toFixed(4)}
                      ({t('goldRate.retailBreakdown') || 'duty'} {Math.round(liveRates.retailConfig.importDuty * 100)}% + {t('goldRate.gst') || 'GST'} {Math.round(liveRates.retailConfig.gst * 100)}% + {t('goldRate.premium') || 'spread'} {(liveRates.retailConfig.marketPremium * 100).toFixed(1)}%)
                    </span>
                  )}
                  {liveRates.cached && (
                    <span className="live-updated-chip" style={{ borderColor: 'rgba(245,158,11,0.4)', color: '#f59e0b' }}>
                      {t('goldRate.cachedNote') || 'Showing cached values (API unreachable)'}
                    </span>
                  )}
                </div>
              ) : (
                <div className="alert-banner alert-critical" style={{ margin: '16px 0 0' }}>
                  <XCircle size={17} />
                  <span>{t('goldRate.unavailable') || 'Live price unavailable'}</span>
                </div>
              )}

              {/* Super admin: push live values into the ledger */}
              {role === 'super_admin' && liveRates && (
                <GoldButton type="button" onClick={handleSaveLiveToLedger} disabled={loading} style={{ marginTop: 16, padding: '10px 18px', fontSize: '0.875rem' }}>
                  <Save size={15} />
                  {loading ? t('common.loading') : (t('goldRate.saveToLedger') || 'Save Live Rates to Ledger')}
                </GoldButton>
              )}
            </>
          )}
        </motion.div>

        <div className="grid-cols-2" style={{ alignItems: 'flex-start' }}>

          {/* Ledger Rate & Admin Update Form */}
          <div style={{ display: 'flex', flexDirection: 'column', gap: '24px' }}>

            {/* Active Ledger Display */}
            <motion.div
              className="glass-panel"
              style={{ padding: '24px', display: 'flex', flexDirection: 'column', gap: '18px' }}
              initial={{ opacity: 0, y: 20 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.55, ease: [0.22, 1, 0.36, 1] }}
            >
              <h3 className="serif-title" style={{ margin: 0, fontSize: '1.25rem', display: 'flex', alignItems: 'center', gap: 10 }}>
                <span className="metal-coin" style={{ width: 34, height: 34 }}><Gem size={16} /></span>
                {t('goldRate.current')}
              </h3>

              <div className="flex-between metal-rate-active-row" style={{ gap: 12, flexWrap: 'wrap' }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 14 }}>
                  <GoldCoin size={46} />
                  <div>
                    <label>{t('goldRate.gold')} (24K)</label>
                    <div className="kpi-value gold-gradient-text" style={{ fontSize: '2rem', marginTop: '4px' }}>
                      ₹<AnimatedNumber value={currentRate} duration={1} />/g
                    </div>
                  </div>
                </div>
                <div style={{ display: 'flex', alignItems: 'center', gap: 14 }}>
                  <span
                    className="float-slow"
                    style={{
                      width: 46, height: 46, borderRadius: '50%', display: 'inline-flex',
                      alignItems: 'center', justifyContent: 'center', flexShrink: 0,
                      background: 'radial-gradient(circle at 32% 28%, #f8fafc, #e2e8f0 38%, #94a3b8 62%, #475569 100%)',
                      boxShadow: '0 10px 26px rgba(148,163,184,0.35), inset 0 2px 8px rgba(255,255,255,0.7), inset 0 -6px 14px rgba(51,65,85,0.4)',
                      border: '2px solid rgba(226,232,240,0.8)'
                    }}
                  />
                  <div>
                    <label>{t('goldRate.silver')} (99.9%)</label>
                    <div className="kpi-value" style={{ fontSize: '2rem', marginTop: '4px', background: 'linear-gradient(135deg, #e2e8f0 0%, #cbd5e1 50%, #94a3b8 100%)', WebkitBackgroundClip: 'text', WebkitTextFillColor: 'transparent' }}>
                      ₹<AnimatedNumber value={currentSilverRate} duration={1} />/g
                    </div>
                  </div>
                </div>
              </div>

              <div style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: '0.75rem', color: 'var(--text-3)' }}>
                <Clock size={13} />
                <span>
                  {t('goldRate.effectiveDate') || 'Effective'}: {history.length > 0 ? new Date(history[0].effectiveDate).toLocaleString() : '—'}
                </span>
              </div>
            </motion.div>

            {/* Admin Update Form */}
            {role === 'super_admin' ? (
              <motion.div
                className="glass-panel"
                style={{ padding: '24px' }}
                initial={{ opacity: 0, y: 20 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ duration: 0.55, delay: 0.1, ease: [0.22, 1, 0.36, 1] }}
              >
                <h3 className="serif-title" style={{ margin: '0 0 16px', fontSize: '1.25rem', display: 'flex', alignItems: 'center', gap: 10 }}>
                  <span className="metal-coin" style={{ width: 34, height: 34 }}><Coins size={16} /></span>
                  {t('dashboard.updateRate')}
                </h3>

                <form onSubmit={handleUpdate} style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>
                  <div className="form-group" style={{ marginBottom: 0 }}>
                    <label>{t('goldRate.ratePerGram')} (INR)</label>
                    <input
                      type="number"
                      placeholder={liveRates ? `Live: ₹${liveRates.gold}/g` : "e.g. 5850"}
                      value={newRate}
                      onChange={(e) => setNewRate(e.target.value)}
                    />
                  </div>

                  <div className="form-group" style={{ marginBottom: 0 }}>
                    <label>{t('goldRate.ratePerGramSilver')} (INR)</label>
                    <input
                      type="number"
                      placeholder={liveRates ? `Live: ₹${liveRates.silver}/g` : "e.g. 75"}
                      value={newSilverRate}
                      onChange={(e) => setNewSilverRate(e.target.value)}
                    />
                  </div>

                  {success && (
                    <motion.div
                      className="check-pop"
                      style={{ justifyContent: 'center' }}
                      initial={{ opacity: 0, scale: 0.9 }}
                      animate={{ opacity: 1, scale: 1 }}
                    >
                      <CheckCircle2 size={17} style={{ color: 'var(--success)' }} />
                      <span style={{ color: 'var(--success)', fontSize: '0.875rem' }}>{t('dashboard.rateUpdateSuccess')}</span>
                    </motion.div>
                  )}

                  <GoldButton type="submit" style={{ width: '100%' }} disabled={loading}>
                    {loading ? t('common.loading') : t('goldRate.updateBtn')}
                  </GoldButton>
                </form>
              </motion.div>
            ) : (
              <motion.div
                className="alert-banner alert-info"
                style={{ margin: '0' }}
                initial={{ opacity: 0, y: 20 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ duration: 0.55, delay: 0.1 }}
              >
                <XCircle size={18} />
                <span>{t('goldRate.restricted')}</span>
              </motion.div>
            )}
          </div>

          {/* Rate History */}
          <motion.div
            className="glass-panel"
            style={{ padding: '24px' }}
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.55, delay: 0.14, ease: [0.22, 1, 0.36, 1] }}
          >
            <h3 className="serif-title" style={{ margin: '0 0 18px', fontSize: '1.25rem', display: 'flex', alignItems: 'center', gap: 10 }}>
              <span className="metal-coin" style={{ width: 34, height: 34 }}><History size={16} /></span>
              {t('goldRate.history')}
            </h3>

            {history.length === 0 ? (
              <p style={{ color: 'var(--text-2)', fontStyle: 'italic' }}>{t('goldRate.noHistory')}</p>
            ) : (
              <div style={{ display: 'flex', flexDirection: 'column', gap: '12px', maxHeight: '480px', overflowY: 'auto', paddingRight: 4 }}>
                {history.map((h, index) => (
                  <motion.div
                    key={h.id}
                    className="glass-card"
                    style={{
                      padding: '16px 16px',
                      background: index === 0 ? 'rgba(212,175,55,0.06)' : 'rgba(255,255,255,0.01)',
                      border: index === 0 ? '1px solid rgba(247,201,72,0.35)' : '1px solid var(--border-soft)',
                      boxShadow: index === 0 ? '0 6px 20px rgba(247,201,72,0.08)' : 'none'
                    }}
                    initial={{ opacity: 0, x: -14 }}
                    animate={{ opacity: 1, x: 0 }}
                    transition={{ duration: 0.4, delay: index * 0.04, ease: [0.22, 1, 0.36, 1] }}
                  >
                    <div className="gold-rate-history-header" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 10 }}>
                      <div style={{ display: 'flex', gap: '16px', alignItems: 'center' }}>
                        <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}>
                          <Gem size={13} style={{ color: 'var(--gold)' }} />
                          <span className="gold-gradient-text" style={{ fontSize: '1.25rem', fontWeight: 700 }}>₹{h.ratePerGram}</span>
                        </span>
                        <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}>
                          <Coins size={13} style={{ color: '#94a3b8' }} />
                          <span style={{ fontSize: '1.25rem', fontWeight: 700, background: 'linear-gradient(135deg, #e2e8f0 0%, #cbd5e1 50%, #94a3b8 100%)', WebkitBackgroundClip: 'text', WebkitTextFillColor: 'transparent' }}>
                            ₹{h.silverRatePerGram || 0}
                          </span>
                        </span>
                      </div>
                      {index === 0 && <span className="badge badge-closed">{t('common.active')}</span>}
                    </div>

                    <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '0.75rem', color: 'var(--text-2)', '': '12px', flexWrap: 'wrap', gap: 6 }}>
                      <div style={{ display: 'flex', alignItems: 'center', gap: '5px' }}>
                        <Calendar size={12} />
                        <span>{new Date(h.effectiveDate).toLocaleDateString()}</span>
                        <span style={{ opacity: 0.6 }}>{new Date(h.effectiveDate).toLocaleTimeString()}</span>
                      </div>
                      <div style={{ display: 'flex', alignItems: 'center', gap: '5px' }}>
                        <User size={12} />
                        <span>{t('loans.recordedBy')}: {h.updatedBy?.substring(0, 6) || 'System'}</span>
                      </div>
                    </div>
                  </motion.div>
                ))}
              </div>
            )}
          </motion.div>

        </div>

      </main>
    </div>
  );
}
