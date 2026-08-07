import React, { useState, useEffect, useMemo } from 'react';
import { useNavigate, Link } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { motion } from 'framer-motion';
import { collection, query, where, getDocs, orderBy, limit, onSnapshot, doc, getDoc } from 'firebase/firestore';
import { db, auth } from '../services/firebase';
import { calculateLoanState, getLtvAlertState } from '../utils/interestEngine';
import { updateGoldRate, checkAndNotifyThresholds } from '../services/firebaseService';
import useLiveGoldRates from '../hooks/useLiveGoldRates';
import { getCachedLiveRates } from '../services/goldRateService';
import { toastError, toastInfo } from '../components/Toast';
import {
  Users,
  Coins,
  TrendingUp,
  AlertTriangle,
  Bell,
  ClipboardList,
  ArrowRight,
  ShieldAlert,
  Clock,
  User,
  Sparkles,
  Wallet,
  Gem,
  Activity,
  Gauge,
  BadgeCheck,
  RefreshCw,
  Banknote,
  History
} from 'lucide-react';
import {
  PieChart,
  Pie,
  Cell,
  BarChart,
  Bar,
  XAxis,
  YAxis,
  Tooltip,
  ResponsiveContainer,
  CartesianGrid
} from 'recharts';
import { PageHeader, StatCard, FadeScale, StaggerGroup, EmptyState, useGreeting, AnimatedNumber, GoldDivider } from '../components/PremiumUI';

const GOLD = '#f7c948';
const GOLD_2 = '#ffc107';
const GREEN = '#34d399';
const RED = '#f87171';
const SILVER = '#c9ccd6';

export default function Dashboard() {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const greeting = useGreeting();

  // User States
  const [role, setRole] = useState(localStorage.getItem('user_role') || 'customer');
  const [name, setName] = useState(localStorage.getItem('user_name') || '');

  // Live KPI States
  const [stats, setStats] = useState({
    totalCustomers: 0,
    activeLoans: 0,
    vaultGoldWeight: 0,
    vaultSilverWeight: 0,
    totalDisbursed: 0,
    todayCollections: 0,
    totalRecoveries: 0,
    outstandingPrincipal: 0,
    partiallyPaidLoans: 0,
    pendingLoans: 0
  });

  // Loan analysis (client-side, for charts)
  const [loanAnalysis, setLoanAnalysis] = useState([]);

  // Rates & Alerts — Indian RETAIL rates, seeded ONLY from the live market
  // cache (60s TTL), never from the admin ledger.
  const [goldRate, setGoldRate] = useState(() => getCachedLiveRates()?.retailGold ?? 0);
  const [silverRate, setSilverRate] = useState(() => getCachedLiveRates()?.retailSilver ?? 0);
  const [newRateInput, setNewRateInput] = useState('');
  const [newSilverRateInput, setNewSilverRateInput] = useState('');
  const [loadingRate, setLoadingRate] = useState(false);
  const [rateSuccess, setRateSuccess] = useState(false);
  const [criticalLoans, setCriticalLoans] = useState([]);

  // Live gold & silver market feed (auto-refresh every 60s, cached, retried)
  const { data: liveRates, status: marketStatus, lastUpdated, refresh: refreshRates } = useLiveGoldRates({
    onError: (err) => toastError(`Live market: ${err.message}`)
  });

  // Mirror live rates into local state (charts, admin form prefill) —
  // retail values are the primary display values.
  useEffect(() => {
    if (!liveRates) return;
    setGoldRate(liveRates.retailGold);
    setSilverRate(liveRates.retailSilver);
  }, [liveRates]);

  // Real-time Notifications & Audits
  const [notifications, setNotifications] = useState([]);
  const [recentAudits, setRecentAudits] = useState([]);
  const [loadingStats, setLoadingStats] = useState(true);

  useEffect(() => {
    const user = auth.currentUser;
    if (!user) {
      navigate('/login');
      return;
    }

    // Double check local storage session
    if (!localStorage.getItem('user_role')) {
      const fetchRole = async () => {
        const snap = await getDoc(doc(db, 'users', user.uid));
        if (snap.exists()) {
          setRole(snap.data().role);
          setName(snap.data().name);
          localStorage.setItem('user_role', snap.data().role);
          localStorage.setItem('user_name', snap.data().name);
        }
      };
      fetchRole();
    }
  }, [navigate]);

  // Fetch Gold & Silver Rates
  // Fetch KPIs & LTV Threshold Alerts
  useEffect(() => {
    if (role === 'customer') return;

    setLoadingStats(true);

    // Listen to customers count
    const qCustomers = query(collection(db, 'users'), where('role', '==', 'customer'));
    const unsubCustomers = onSnapshot(qCustomers, (snap) => {
      const customerCount = snap.size;
      setStats(prev => ({ ...prev, totalCustomers: customerCount }));
    });

    // Listen to open loans to compute stats & alerts live
    // (open + partially_paid are both active, interest-bearing loans)
    const qLoans = query(collection(db, 'loans'), where('status', 'in', ['open', 'partially_paid']));
    const unsubLoans = onSnapshot(qLoans, async (loansSnap) => {
      let activeCount = 0;
      let totalWeight = 0;
      let totalSilverWeight = 0;
      let totalDisbursedVal = 0;
      let outstandingPrincipalVal = 0;
      let partiallyPaidCount = 0;
      let criticalList = [];

      activeCount = loansSnap.size;

      // Extract details for each loan in parallel
      const loanPromises = loansSnap.docs.map(async (loanDoc) => {
        const loanData = loanDoc.data();
        if (loanData.metalType === 'silver') {
          totalSilverWeight += parseFloat(loanData.weightGrams) || 0;
        } else {
          totalWeight += parseFloat(loanData.weightGrams) || 0;
        }
        totalDisbursedVal += parseFloat(loanData.loanAmount) || 0;

        // Fetch payments for this loan to compute running balance
        const paymentsCol = collection(db, 'loans', loanDoc.id, 'payments');
        const paymentsSnap = await getDocs(paymentsCol);
        const paymentsList = paymentsSnap.docs.map(p => p.data());

        const state = calculateLoanState(
          loanData.loanAmount,
          loanData.interestRate,
          loanData.pledgeDate,
          paymentsList
        );

        outstandingPrincipalVal += state.currentPrincipal;
        if ((parseInt(loanData.paymentCount, 10) || 0) > 0) partiallyPaidCount++;

        const alertState = getLtvAlertState(state.outstandingBalance, loanData.estimatedValue);

        // Retrieve customer details
        const customerSnap = await getDoc(doc(db, 'users', loanData.customerId));
        const customerName = customerSnap.exists() ? customerSnap.data().name : 'Unknown';

        return {
          id: loanDoc.id,
          customerName,
          loanAmount: loanData.loanAmount,
          outstandingBalance: state.outstandingBalance,
          estimatedValue: loanData.estimatedValue,
          metalType: loanData.metalType,
          ltvPercent: alertState.ltvPercent,
          alertType: alertState.alertType,
          alertLabel: alertState.alertLabel
        };
      });

      const analyzedLoans = await Promise.all(loanPromises);
      setLoanAnalysis(analyzedLoans);

      // Trigger LTV threshold lazy evaluation alerts
      loansSnap.docs.forEach(doc => {
        const data = doc.data();
        checkAndNotifyThresholds({ id: doc.id, ...data });
      });

      // Filter critical alerts (LTV >= 75%)
      criticalList = analyzedLoans.filter(l => l.alertType === 'critical' || l.alertType === 'warning');

      setStats(prev => ({
        ...prev,
        activeLoans: activeCount,
        vaultGoldWeight: Math.round(totalWeight * 100) / 100,
        vaultSilverWeight: Math.round(totalSilverWeight * 100) / 100,
        totalDisbursed: Math.round(totalDisbursedVal * 100) / 100,
        outstandingPrincipal: Math.round(outstandingPrincipalVal * 100) / 100,
        partiallyPaidLoans: partiallyPaidCount,
        pendingLoans: activeCount
      }));

      setCriticalLoans(criticalList);
      setLoadingStats(false);
    });

    // Live repayment ledger — today's collections & total recoveries
    const qPayments = query(collection(db, 'payments'), orderBy('paymentDate', 'desc'), limit(1000));
    const unsubPayments = onSnapshot(qPayments, (paySnap) => {
      const startToday = new Date();
      startToday.setHours(0, 0, 0, 0);
      let todayCollections = 0;
      let totalRecoveries = 0;
      paySnap.docs.forEach((pDoc) => {
        const p = pDoc.data();
        const amt = parseFloat(p.amount) || 0;
        totalRecoveries += amt;
        const ts = new Date(p.paymentDate || p.createdAt).getTime();
        if (!Number.isNaN(ts) && ts >= startToday.getTime()) todayCollections += amt;
      });
      setStats(prev => ({
        ...prev,
        todayCollections: Math.round(todayCollections * 100) / 100,
        totalRecoveries: Math.round(totalRecoveries * 100) / 100
      }));
    });

    return () => {
      unsubCustomers();
      unsubLoans();
      unsubPayments();
    };
  }, [role]);

  // Real-time notifications listener
  useEffect(() => {
    const user = auth.currentUser;
    if (!user) return;

    let q;
    if (role === 'customer') {
      q = query(
        collection(db, 'notifications'),
        where('userId', '==', user.uid)
      );
    } else {
      q = query(
        collection(db, 'notifications'),
        orderBy('createdAt', 'desc'),
        limit(5)
      );
    }

    const unsubscribe = onSnapshot(q, (snap) => {
      const list = snap.docs
        .map(d => ({ id: d.id, ...d.data() }))
        .sort((a, b) => {
          const timeA = a.createdAt?.toDate ? a.createdAt.toDate().getTime() : new Date(a.createdAt || 0).getTime();
          const timeB = b.createdAt?.toDate ? b.createdAt.toDate().getTime() : new Date(b.createdAt || 0).getTime();
          return (timeB || 0) - (timeA || 0);
        })
        .slice(0, 5);
      setNotifications(list);
    });

    return unsubscribe;
  }, [role]);

  // Audit Log Listener (Super Admin only)
  useEffect(() => {
    if (role !== 'super_admin') return;

    const q = query(
      collection(db, 'audit_logs'),
      orderBy('timestamp', 'desc'),
      limit(5)
    );

    const unsubscribe = onSnapshot(q, (snap) => {
      const list = snap.docs.map(d => ({
        id: d.id,
        ...d.data(),
        timestamp: d.data().timestamp?.toDate() || new Date()
      }));
      setRecentAudits(list);
    });

    return unsubscribe;
  }, [role]);

  const handleUpdateRate = async (e) => {
    e.preventDefault();
    const goldVal = parseFloat(newRateInput) || goldRate;
    const silverVal = parseFloat(newSilverRateInput) || silverRate;

    if (goldVal <= 0 && silverVal <= 0) return;

    setLoadingRate(true);
    setRateSuccess(false);

    try {
      await updateGoldRate(goldVal, silverVal);
      setRateSuccess(true);
      setNewRateInput('');
      setNewSilverRateInput('');
      setTimeout(() => setRateSuccess(false), 3000);
    } catch (err) {
      console.error('Rate update error:', err);
    } finally {
      setLoadingRate(false);
    }
  };

  /* ---------- Chart data (derived client-side only) ---------- */
  const riskChartData = useMemo(() => {
    const critical = criticalLoans.filter(l => l.alertType === 'critical').length;
    const warning = criticalLoans.filter(l => l.alertType === 'warning').length;
    const safe = Math.max(0, stats.activeLoans - critical - warning);
    return [
      { name: 'Safe', value: safe, color: GREEN },
      { name: 'Warning', value: warning, color: GOLD_2 },
      { name: 'Critical', value: critical, color: RED }
    ].filter(d => d.value > 0);
  }, [criticalLoans, stats.activeLoans]);

  const metalChartData = useMemo(() => [
    { name: 'Gold', value: stats.vaultGoldWeight, color: GOLD },
    { name: 'Silver', value: stats.vaultSilverWeight, color: SILVER }
  ].filter(d => d.value > 0), [stats.vaultGoldWeight, stats.vaultSilverWeight]);

  const portfolioChartData = useMemo(() => {
    return [...loanAnalysis]
      .sort((a, b) => b.loanAmount - a.loanAmount)
      .slice(0, 8)
      .map(l => ({
        name: (l.customerName || 'Customer').split(' ')[0],
        amount: l.loanAmount
      }));
  }, [loanAnalysis]);

  const avgLtv = useMemo(() => {
    if (loanAnalysis.length === 0) return 0;
    return Math.round(loanAnalysis.reduce((sum, l) => sum + (l.ltvPercent || 0), 0) / loanAnalysis.length);
  }, [loanAnalysis]);

  const chartTooltipStyle = {
    background: 'rgba(16,16,20,0.95)',
    border: '1px solid rgba(247,201,72,0.3)',
    borderRadius: '12px',
    fontSize: '0.75rem',
    color: '#fff',
    backdropFilter: 'blur(8px)'
  };

  /* ============================================================
     CUSTOMER VIEW
     ============================================================ */
  if (role === 'customer') {
    return (
      <div className="app-container customer-dashboard">
        <main className="main-content" style={{ maxWidth: '860px' }}>
          <PageHeader
            eyebrow={<><Sparkles size={12} /> {greeting}</>}
            title={t('dashboard.welcome', { name })}
            subtitle={t('dashboard.checkPledges')}
          />

          <StaggerGroup className="grid-cols-3" style={{ marginBottom: 28 }}>
            <FadeScale className="stat-card">
              <div className="stat-icon"><Gem size={20} /></div>
              <div className="stat-label">{t('dashboard.retailGoldRate') || 'Retail Gold Rate (India)'}</div>
              <div className="stat-value gold-gradient-text">
                {marketStatus === 'loading' && !liveRates ? (
                  <span className="rate-skeleton"><span className="gold-spinner" style={{ width: 16, height: 16 }} />{t('dashboard.loadingRate') || 'Fetching latest…'}</span>
                ) : (
                  <>₹<AnimatedNumber value={goldRate} suffix="/g" /></>
                )}
              </div>
              <div style={{ fontSize: '0.75rem', color: 'var(--text-2)', marginTop: 6 }}>{t('dashboard.gold24K')}</div>
              {liveRates?.spotGold > 0 && (
                <div style={{ fontSize: '0.75rem', color: 'var(--text-3)', marginTop: 4 }}>
                  Spot ₹{liveRates.spotGold}/g · +₹{liveRates.retailGold - liveRates.spotGold}/g
                </div>
              )}
            </FadeScale>

            <FadeScale delay={0.08} className="stat-card">
              <div className="stat-icon silver"><Sparkles size={20} /></div>
              <div className="stat-label">{t('dashboard.retailSilverRate') || 'Retail Silver Rate (India)'}</div>
              <div className="stat-value" style={{ background: 'linear-gradient(135deg, #e5e7eb, #9ca3af 55%, #6b7280)', WebkitBackgroundClip: 'text', WebkitTextFillColor: 'transparent' }}>
                {marketStatus === 'loading' && !liveRates ? (
                  <span className="rate-skeleton"><span className="gold-spinner" style={{ width: 16, height: 16 }} />{t('dashboard.loadingRate') || 'Fetching latest…'}</span>
                ) : (
                  <>₹<AnimatedNumber value={silverRate} suffix="/g" /></>
                )}
              </div>
              <div style={{ fontSize: '0.75rem', color: 'var(--text-2)', marginTop: 6 }}>{t('dashboard.silverPure')}</div>
              {liveRates?.spotSilver > 0 && (
                <div style={{ fontSize: '0.75rem', color: 'var(--text-3)', marginTop: 4 }}>
                  Spot ₹{liveRates.spotSilver}/g · +₹{liveRates.retailSilver - liveRates.spotSilver}/g
                </div>
              )}
            </FadeScale>

            <FadeScale delay={0.16} className="glass-panel" style={{ display: 'flex', flexDirection: 'column', justifyContent: 'center', gap: 12, padding: 22 }}>
              <Link to="/loans" className="btn btn-primary" style={{ width: '100%', justifyContent: 'space-between' }}>
                <span>{t('dashboard.myPledges')}</span>
                <ArrowRight size={16} />
              </Link>
              <Link to="/profile" className="btn btn-secondary" style={{ width: '100%', justifyContent: 'space-between' }}>
                <span style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                  <User size={16} style={{ color: 'var(--gold-primary)' }} />
                  {t('nav.profile')}
                </span>
                <ArrowRight size={16} />
              </Link>
            </FadeScale>
          </StaggerGroup>

          {/* Real-time Notifications list */}
          <FadeScale delay={0.2} className="glass-panel" style={{ padding: 24 }}>
            <div className="flex-gap" style={{ marginBottom: 16, color: 'var(--gold-primary)' }}>
              <Bell size={19} />
              <h3 style={{ margin: 0, fontSize: '1.25rem' }}>{t('dashboard.notifications')}</h3>
            </div>
            {notifications.length === 0 ? (
              <EmptyState
                icon={<Bell size={30} />}
                title="All quiet for now"
                message={t('dashboard.noNotifications')}
              />
            ) : (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
                {notifications.map((notif, i) => (
                  <FadeScale key={notif.id} delay={i * 0.06} className="glass-card" style={{ padding: '16px 18px' }}>
                    <div className="flex-between" style={{ fontSize: '0.75rem', color: 'var(--text-2)' }}>
                      <span className="chip chip-gold" style={{ fontSize: '0.75rem' }}>{notif.type.replace('_', ' ').toUpperCase()}</span>
                      <span>{new Date(notif.createdAt).toLocaleDateString()}</span>
                    </div>
                    <p style={{ marginTop: 8, fontSize: '1rem', color: 'var(--text)' }}>{notif.message}</p>
                  </FadeScale>
                ))}
              </div>
            )}
          </FadeScale>
        </main>
      </div>
    );
  }

  /* ============================================================
     STAFF / ADMIN VIEW
     ============================================================ */
  return (
    <div className="app-container">
      <main className="main-content">

        {/* ============ HERO ============ */}
        <motion.div
          className="hero-panel"
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.65, ease: [0.22, 1, 0.36, 1] }}
          style={{ marginBottom: 26 }}
        >
          <div style={{ display: 'flex', justifyContent: 'space-between', gap: 24, flexWrap: 'wrap' }}>
            <div style={{ flex: 1, minWidth: 260 }}>
              <span className="eyebrow">
                <Sparkles size={13} />
                {greeting}, {name}
              </span>
              <h1 className="serif-title" style={{ fontSize: 'clamp(1.6rem, 3vw, 2.3rem)', '': '12px 0 8px' }}>
                {t('dashboard.title') || 'Welcome to your Gold Vault'}
              </h1>
              <p style={{ color: 'var(--text-2)', maxWidth: 460 }}>
                Live portfolio intelligence, risk signals and metal rates — all in one premium workspace.
              </p>
              <div className="flex-gap" style={{ gap: 12, marginTop: 16, flexWrap: 'wrap' }}>
                <Link to="/customers" className="btn btn-primary">
                  <Users size={16} />
                  {t('dashboard.newCustomer')}
                </Link>
                <Link to="/loans" className="btn btn-secondary">
                  <Coins size={16} />
                  {t('dashboard.issueLoan')}
                </Link>
              </div>
            </div>

            <div style={{ display: 'flex', flexDirection: 'column', gap: 12, minWidth: 240 }}>
              <div className="flex-between" style={{ gap: 12, flexWrap: 'wrap' }}>
                <span className={`live-badge ${marketStatus === 'offline' ? 'offline' : marketStatus === 'cached' ? 'cached' : ''}`}>
                  <span className={`live-pulse-dot ${marketStatus === 'offline' ? 'offline' : marketStatus === 'cached' ? 'cached' : ''}`} />
                  {marketStatus === 'offline'
                    ? (t('dashboard.marketOffline') || 'Offline')
                    : marketStatus === 'cached'
                      ? (t('dashboard.marketCached') || 'Cached')
                      : (t('dashboard.marketLive') || 'LIVE')}
                </span>
                <div className="flex-gap" style={{ gap: 8 }}>
                  <span className="live-updated-chip">
                    <Clock size={12} />
                    {lastUpdated
                      ? `${t('dashboard.lastUpdated') || 'Updated'} ${lastUpdated.toLocaleTimeString()}`
                      : '—'}
                  </span>
                  <button
                    type="button"
                    className="btn btn-secondary"
                    onClick={() => { refreshRates(); toastInfo(t('dashboard.refreshingRates') || 'Refreshing live rates...'); }}
                    style={{ padding: '8px 12px', fontSize: '0.75rem' }}
                    aria-label="Refresh live market rates"
                  >
                    <RefreshCw size={13} className={marketStatus === 'loading' ? 'animate-spin' : ''} />
                  </button>
                </div>
              </div>

              <motion.div
                className="glass-panel"
                style={{ padding: '16px 18px', borderRadius: 18 }}
                whileHover={{ y: -3 }}
              >
                <div className="flex-between">
                  <div className="flex-gap" style={{ gap: 8 }}>
                    <span className="stat-icon" style={{ width: 38, height: 38, borderRadius: 12, margin: 0 }}>
                      <Gem size={17} />
                    </span>
                    <span className="stat-label">{t('dashboard.retailGoldRate') || 'Retail Gold Rate (India)'} · 24K</span>
                  </div>
                  {liveRates && typeof liveRates.change === 'number' && (
                    <span className={`market-change-chip ${liveRates.change > 0 ? 'up' : liveRates.change < 0 ? 'down' : 'flat'}`}>
                      {liveRates.change > 0 ? '▲' : liveRates.change < 0 ? '▼' : '•'} ₹{Math.abs(liveRates.change)} ({liveRates.changePercent >= 0 ? '+' : ''}{liveRates.changePercent?.toFixed(2)}%)
                    </span>
                  )}
                </div>
                <div className="kpi-value gold-gradient-text" style={{ fontSize: '2rem', marginTop: 10 }}>
                  {marketStatus === 'loading' && !liveRates ? (
                    <span className="rate-skeleton"><span className="gold-spinner" style={{ width: 16, height: 16 }} />{t('dashboard.loadingRate') || 'Fetching latest…'}</span>
                  ) : (
                    <>₹<AnimatedNumber value={goldRate} suffix="/g" /></>
                  )}
                </div>
                {liveRates?.spotGold > 0 && (
                  <div style={{ fontSize: '0.75rem', color: 'var(--text-3)', marginTop: 6 }}>
                    {t('goldRate.spot') || 'Spot'} ₹{liveRates.spotGold}/g · {t('goldRate.difference') || 'Diff'} +₹{liveRates.retailGold - liveRates.spotGold}/g (+{(((liveRates.retailGold / liveRates.spotGold) - 1) * 100).toFixed(1)}%)
                  </div>
                )}
              </motion.div>

              <motion.div
                className="glass-panel"
                style={{ padding: '16px 18px', borderRadius: 18 }}
                whileHover={{ y: -3 }}
              >
                <div className="flex-between">
                  <div className="flex-gap" style={{ gap: 8 }}>
                    <span className="stat-icon silver" style={{ width: 38, height: 38, borderRadius: 12, margin: 0 }}>
                      <Sparkles size={17} />
                    </span>
                    <span className="stat-label">{t('dashboard.retailSilverRate') || 'Retail Silver Rate (India)'} · 99.9%</span>
                  </div>
                  {liveRates && typeof liveRates.silverChange === 'number' && (
                    <span className={`market-change-chip ${liveRates.silverChange > 0 ? 'up' : liveRates.silverChange < 0 ? 'down' : 'flat'}`}>
                      {liveRates.silverChange > 0 ? '▲' : liveRates.silverChange < 0 ? '▼' : '•'} ₹{Math.abs(liveRates.silverChange)} ({liveRates.silverChangePercent >= 0 ? '+' : ''}{liveRates.silverChangePercent?.toFixed(2)}%)
                    </span>
                  )}
                </div>
                <div className="kpi-value" style={{ fontSize: '2rem', marginTop: 12, background: 'linear-gradient(135deg, #e5e7eb, #9ca3af 55%, #6b7280)', WebkitBackgroundClip: 'text', WebkitTextFillColor: 'transparent' }}>
                  {marketStatus === 'loading' && !liveRates ? (
                    <span className="rate-skeleton"><span className="gold-spinner" style={{ width: 16, height: 16 }} />{t('dashboard.loadingRate') || 'Fetching latest…'}</span>
                  ) : (
                    <>₹<AnimatedNumber value={silverRate} suffix="/g" /></>
                  )}
                </div>
                {liveRates?.spotSilver > 0 && (
                  <div style={{ fontSize: '0.75rem', color: 'var(--text-3)', marginTop: 6 }}>
                    {t('goldRate.spot') || 'Spot'} ₹{liveRates.spotSilver}/g · {t('goldRate.difference') || 'Diff'} +₹{liveRates.retailSilver - liveRates.spotSilver}/g
                  </div>
                )}
              </motion.div>
            </div>
          </div>
        </motion.div>

        {/* ============ ANIMATED STATS ============ */}
        <StaggerGroup className="kpi-container" style={{ marginBottom: 26 }}>
          <StatCard
            icon={<Wallet size={20} />}
            label={t('dashboard.activeDisbursed')}
            value={loadingStats ? 0 : stats.totalDisbursed}
            prefix="₹"
            sub={t('dashboard.activeLoans') ? 'Active portfolio exposure' : ''}
          />
          <StatCard
            icon={<Gem size={20} />}
            label={t('dashboard.vaultGold')}
            value={loadingStats ? 0 : stats.vaultGoldWeight}
            suffix=" g"
            sub="Pledged gold in vault"
          />
          <StatCard
            iconClass="silver"
            icon={<Sparkles size={20} />}
            label={t('dashboard.vaultSilver')}
            value={loadingStats ? 0 : stats.vaultSilverWeight}
            suffix=" g"
            sub="Pledged silver in vault"
          />
          <StatCard
            iconClass="blue"
            icon={<Coins size={20} />}
            label={t('dashboard.activeLoans')}
            value={loadingStats ? 0 : stats.activeLoans}
            sub="Open loan contracts"
          />
          <StatCard
            iconClass="green"
            icon={<Users size={20} />}
            label={t('dashboard.totalCustomers')}
            value={loadingStats ? 0 : stats.totalCustomers}
            sub="Registered borrowers"
          />
        </StaggerGroup>

        {/* ============ REPAYMENT & RECOVERY KPIs ============ */}
        <StaggerGroup className="kpi-container" style={{ marginBottom: 26 }}>
          <StatCard
            iconClass="green"
            icon={<Banknote size={20} />}
            label={t('dashboard.todayCollections') || "Today's Collections"}
            value={loadingStats ? 0 : stats.todayCollections}
            prefix="₹"
            sub={t('dashboard.todayCollectionsSub') || 'Payments received today'}
          />
          <StatCard
            iconClass="blue"
            icon={<History size={20} />}
            label={t('dashboard.totalRecoveries') || 'Total Recoveries'}
            value={loadingStats ? 0 : stats.totalRecoveries}
            prefix="₹"
            sub={t('dashboard.totalRecoveriesSub') || 'All-time payments collected'}
          />
          <StatCard
            icon={<Wallet size={20} />}
            label={t('dashboard.outstandingPrincipal') || 'Outstanding Principal'}
            value={loadingStats ? 0 : stats.outstandingPrincipal}
            prefix="₹"
            sub={t('dashboard.outstandingPrincipalSub') || 'Principal yet to repay'}
          />
          <StatCard
            iconClass="silver"
            icon={<Coins size={20} />}
            label={t('dashboard.partiallyPaidLoans') || 'Partially Paid Loans'}
            value={loadingStats ? 0 : stats.partiallyPaidLoans}
            sub={t('dashboard.partiallyPaidLoansSub') || 'Loans with partial repayments'}
          />
          <StatCard
            iconClass="red"
            icon={<AlertTriangle size={20} />}
            label={t('dashboard.pendingLoans') || 'Pending Loans'}
            value={loadingStats ? 0 : stats.pendingLoans}
            sub={t('dashboard.pendingLoansSub') || 'Open loans awaiting repayment'}
          />
        </StaggerGroup>

        {/* ============ CHARTS ROW ============ */}
        <div className="grid-cols-3" style={{ marginBottom: 26 }}>

          {/* Risk donut + meter */}
          <FadeScale className="glass-panel" style={{ padding: 22 }}>
            <div className="section-head">
              <div>
                <span className="eyebrow"><Gauge size={12} /> RISK</span>
                <h3 style={{ marginTop: 4 }}>Portfolio Health</h3>
              </div>
              <span className={`chip ${avgLtv >= 75 ? 'chip-red' : avgLtv >= 50 ? 'chip-amber' : 'chip-green'}`}>
                Avg LTV {avgLtv}%
              </span>
            </div>

            {riskChartData.length === 0 ? (
              <EmptyState icon={<ShieldAlert size={28} />} title="All pledges safe" message={t('dashboard.allPledgesSafe')} />
            ) : (
              <>
                <div style={{ height: 200 }}>
                  <ResponsiveContainer width="100%" height="100%">
                    <PieChart>
                      <Pie
                        data={riskChartData}
                        dataKey="value"
                        nameKey="name"
                        innerRadius={58}
                        outerRadius={84}
                        paddingAngle={4}
                        cornerRadius={8}
                        isAnimationActive
                        animationDuration={1200}
                        animationEasing="ease-out"
                      >
                        {riskChartData.map((entry) => (
                          <Cell key={entry.name} fill={entry.color} stroke="rgba(9,9,9,0.6)" />
                        ))}
                      </Pie>
                      <Tooltip contentStyle={chartTooltipStyle} />
                    </PieChart>
                  </ResponsiveContainer>
                </div>
                <div className="flex-gap" style={{ justifyContent: 'center', gap: 16, marginTop: 8 }}>
                  {riskChartData.map(d => (
                    <span key={d.name} className="flex-gap" style={{ gap: 8, fontSize: '0.75rem', color: 'var(--text-2)' }}>
                      <span style={{ width: 9, height: 9, borderRadius: '50%', background: d.color, boxShadow: `0 0 8px ${d.color}` }} />
                      {d.name} · {d.value}
                    </span>
                  ))}
                </div>
              </>
            )}
          </FadeScale>

          {/* Metal vault split */}
          <FadeScale delay={0.08} className="glass-panel" style={{ padding: 22 }}>
            <div className="section-head">
              <div>
                <span className="eyebrow"><Gem size={12} /> VAULT</span>
                <h3 style={{ marginTop: 4 }}>Metal Holdings</h3>
              </div>
            </div>
            {metalChartData.length === 0 ? (
              <EmptyState icon={<Gem size={28} />} title="Vault is empty" message="No pledged metal yet." />
            ) : (
              <>
                <div style={{ height: 200 }}>
                  <ResponsiveContainer width="100%" height="100%">
                    <PieChart>
                      <Pie
                        data={metalChartData}
                        dataKey="value"
                        nameKey="name"
                        innerRadius={58}
                        outerRadius={84}
                        paddingAngle={4}
                        cornerRadius={8}
                        animationDuration={1200}
                        animationEasing="ease-out"
                      >
                        {metalChartData.map((entry) => (
                          <Cell key={entry.name} fill={entry.color} stroke="rgba(9,9,9,0.6)" />
                        ))}
                      </Pie>
                      <Tooltip contentStyle={chartTooltipStyle} />
                    </PieChart>
                  </ResponsiveContainer>
                </div>
                <div className="flex-gap" style={{ justifyContent: 'center', gap: 16, marginTop: 8 }}>
                  {metalChartData.map(d => (
                    <span key={d.name} className="flex-gap" style={{ gap: 8, fontSize: '0.75rem', color: 'var(--text-2)' }}>
                      <span style={{ width: 9, height: 9, borderRadius: '50%', background: d.color, boxShadow: `0 0 8px ${d.color}` }} />
                      {d.name} · {d.value}g
                    </span>
                  ))}
                </div>
              </>
            )}
          </FadeScale>

          {/* Top loans bar chart */}
          <FadeScale delay={0.16} className="glass-panel" style={{ padding: 22 }}>
            <div className="section-head">
              <div>
                <span className="eyebrow"><Activity size={12} /> PORTFOLIO</span>
                <h3 style={{ marginTop: 4 }}>Largest Exposures</h3>
              </div>
            </div>
            {portfolioChartData.length === 0 ? (
              <EmptyState icon={<Coins size={28} />} title="No open loans" message="Issue a pledge to see exposure analytics." />
            ) : (
              <div style={{ height: 200 }}>
                <ResponsiveContainer width="100%" height="100%">
                  <BarChart data={portfolioChartData} layout="vertical" margin={{ left: 4, right: 8, top: 4 }}>
                    <CartesianGrid stroke="rgba(255,255,255,0.05)" horizontal={false} />
                    <XAxis type="number" tick={{ fill: '#6f6f78', fontSize: 10 }} axisLine={false} tickLine={false} />
                    <YAxis type="category" dataKey="name" width={72} tick={{ fill: '#b5b5b5', fontSize: 10 }} axisLine={false} tickLine={false} />
                    <Tooltip contentStyle={chartTooltipStyle} formatter={(v) => [`₹${Number(v).toLocaleString()}`, 'Principal']} />
                    <Bar dataKey="amount" radius={[0, 8, 8, 0]} animationDuration={1200} animationEasing="ease-out">
                      {portfolioChartData.map((_, i) => (
                        <Cell key={i} fill={GOLD} fillOpacity={0.55 + (i * 0.06)} />
                      ))}
                    </Bar>
                  </BarChart>
                </ResponsiveContainer>
              </div>
            )}
          </FadeScale>
        </div>

        {/* ============ ALERTS + ACTIVITY ROW ============ */}
        <div className="grid-cols-3" style={{ marginBottom: 26 }}>

          {/* Critical LTV Alerts */}
          <FadeScale className="glass-panel" style={{ padding: 24, display: 'flex', flexDirection: 'column' }}>
            <div className="section-head">
              <div className="flex-gap" style={{ color: 'var(--danger-primary)' }}>
                <AlertTriangle size={19} />
                <h3 style={{ margin: 0 }}>{t('dashboard.riskAlerts')}</h3>
              </div>
              {criticalLoans.length > 0 && <span className="chip chip-red">{criticalLoans.length}</span>}
            </div>

            {criticalLoans.length === 0 ? (
              <div style={{ flex: 1, display: 'flex', alignItems: 'center' }}>
                <EmptyState
                  icon={<BadgeCheck size={28} />}
                  title={t('dashboard.allPledgesSafe')}
                  message="No loan has crossed its safe LTV threshold."
                />
              </div>
            ) : (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 12, maxHeight: 320, overflowY: 'auto' }}>
                {criticalLoans.map((l, i) => (
                  <motion.div
                    key={l.id}
                    initial={{ opacity: 0, x: -14 }}
                    animate={{ opacity: 1, x: 0 }}
                    transition={{ delay: i * 0.07, duration: 0.4 }}
                    className={`glass-card ${l.alertType === 'critical' ? 'alert-critical' : 'alert-warning'}`}
                    style={{ padding: '13px 15px', margin: 0, cursor: 'pointer', animation: l.alertType === 'critical' ? 'pulse-danger 2.2s infinite alternate' : 'none' }}
                    onClick={() => navigate(`/loans?id=${l.id}`)}
                  >
                    <div className="flex-between" style={{ fontWeight: 700, fontSize: '0.875rem' }}>
                      <span>{l.customerName}</span>
                      <span className="chip" style={{ fontSize: '0.75rem' }}>LTV {l.ltvPercent}%</span>
                    </div>
                    <div className="flex-between" style={{ fontSize: '0.75rem', marginTop: 8, opacity: 0.9, color: 'var(--text-2)' }}>
                      <span>Principal ₹{Number(l.loanAmount).toLocaleString()}</span>
                      <span>Due ₹{Math.round(l.outstandingBalance).toLocaleString()}</span>
                    </div>
                    <div className="progress" style={{ marginTop: 12, height: 5 }}>
                      <div className="progress-bar" style={{ width: `${Math.min(100, l.ltvPercent)}%` }} />
                    </div>
                  </motion.div>
                ))}
              </div>
            )}
          </FadeScale>

          {/* Notification Logs */}
          <FadeScale delay={0.08} className="glass-panel" style={{ padding: 22 }}>
            <div className="section-head">
              <div className="flex-gap" style={{ color: 'var(--gold-primary)' }}>
                <Bell size={19} />
                <h3 style={{ margin: 0 }}>{t('dashboard.latestStoreMessages')}</h3>
              </div>
            </div>
            {notifications.length === 0 ? (
              <EmptyState icon={<Bell size={28} />} title="No store messages" message="New notifications will appear here." />
            ) : (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                {notifications.map((n, i) => (
                  <motion.div
                    key={n.id}
                    initial={{ opacity: 0, y: 10 }}
                    animate={{ opacity: 1, y: 0 }}
                    transition={{ delay: i * 0.06 }}
                    className="glass-card"
                    style={{ padding: '12px 15px', background: 'rgba(255,255,255,0.025)' }}
                  >
                    <p style={{ fontSize: '0.875rem', color: 'var(--text)', margin: 0 }}>{n.message}</p>
                    <div className="flex-gap" style={{ gap: 8, marginTop: 6 }}>
                      <Clock size={11} style={{ color: 'var(--text-3)' }} />
                      <span style={{ fontSize: '0.75rem', color: 'var(--text-3)' }}>
                        {new Date(n.createdAt).toLocaleString()}
                      </span>
                    </div>
                  </motion.div>
                ))}
              </div>
            )}
          </FadeScale>

          {/* Activity Logs for Admins */}
          <FadeScale delay={0.16} className="glass-panel" style={{ padding: 24, display: 'flex', flexDirection: 'column' }}>
            <div className="section-head">
              <div className="flex-gap" style={{ color: 'var(--info-primary)' }}>
                <ClipboardList size={19} />
                <h3 style={{ margin: 0 }}>{t('dashboard.dailyLogs')}</h3>
              </div>
            </div>

            {role !== 'super_admin' ? (
              <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', flex: 1, color: 'var(--text-3)', textAlign: 'center', padding: '24px', gap: 10 }}>
                <ShieldAlert size={40} style={{ color: 'var(--text-3)', opacity: 0.5 }} />
                <p style={{ fontSize: '0.875rem' }}>{t('dashboard.auditRestricted')}</p>
              </div>
            ) : recentAudits.length === 0 ? (
              <EmptyState icon={<Activity size={28} />} title={t('dashboard.noRecentActivities')} message="System activities will be logged here." />
            ) : (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 12, flex: 1, overflowY: 'auto', maxHeight: 340 }}>
                {recentAudits.map((a, i) => (
                  <motion.div
                    key={a.id}
                    initial={{ opacity: 0, x: 14 }}
                    animate={{ opacity: 1, x: 0 }}
                    transition={{ delay: i * 0.07 }}
                    className="glass-card"
                    style={{ padding: '12px 15px', background: 'rgba(255,255,255,0.025)' }}
                  >
                    <div className="flex-between" style={{ fontSize: '0.75rem', color: 'var(--text-2)' }}>
                      <span className="chip chip-gold" style={{ fontSize: '0.75rem', padding: '2px 8px' }}>
                        {a.action.replace('_', ' ').toUpperCase()}
                      </span>
                      <div className="flex-gap" style={{ gap: 4 }}>
                        <Clock size={10} />
                        <span>{a.timestamp.toLocaleTimeString()}</span>
                      </div>
                    </div>
                    <p style={{ fontSize: '0.875rem', marginTop: 8, wordBreak: 'break-word', color: 'var(--text-2)' }}>
                      ID: {a.entityId}
                      {a.newValue ? ` → ${a.newValue.substring(0, 50)}...` : ''}
                    </p>
                  </motion.div>
                ))}
              </div>
            )}
          </FadeScale>
        </div>

        {/* ============ RATE UPDATE (ADMIN) ============ */}
        {role === 'super_admin' && (
          <FadeScale className="glow-card" style={{ padding: 24 }}>
            <div className="flex-between" style={{ gap: 24, flexWrap: 'wrap' }}>
              <div style={{ flex: 1, minWidth: 240 }}>
                <span className="eyebrow"><TrendingUp size={12} /> MARKETS</span>
                <h3 style={{ marginTop: 4 }}>{t('dashboard.updateRate')}</h3>
                <p style={{ color: 'var(--text-2)', fontSize: '0.875rem', marginTop: 4 }}>
                  Update the official 24K gold and 99.9% silver rates. Customers are notified instantly.
                </p>
              </div>
              <form onSubmit={handleUpdateRate} style={{ display: 'flex', gap: 12, flexWrap: 'wrap', alignItems: 'flex-end', flex: 1.4 }}>
                <div className="form-group" style={{ margin: 0, flex: 1, minWidth: 160 }}>
                  <label style={{ fontSize: '0.75rem' }}>{t('dashboard.newGoldRate')}</label>
                  <input
                    type="number"
                    placeholder={`Current: ₹${goldRate}`}
                    value={newRateInput}
                    onChange={(e) => setNewRateInput(e.target.value)}
                    style={{ borderRadius: 13 }}
                  />
                </div>
                <div className="form-group" style={{ margin: 0, flex: 1, minWidth: 160 }}>
                  <label style={{ fontSize: '0.75rem' }}>{t('dashboard.newSilverRate')}</label>
                  <input
                    type="number"
                    placeholder={`Current: ₹${silverRate}`}
                    value={newSilverRateInput}
                    onChange={(e) => setNewSilverRateInput(e.target.value)}
                    style={{ borderRadius: 13 }}
                  />
                </div>
                <motion.button
                  type="submit"
                  className="btn btn-primary"
                  style={{ padding: '13px 22px', borderRadius: 13 }}
                  disabled={loadingRate}
                  whileTap={{ scale: 0.97 }}
                >
                  {loadingRate ? (
                    <>
                      <span className="animate-spin" style={{ width: 14, height: 14, border: '2px solid rgba(20,16,10,0.3)', borderTopColor: '#14100a', borderRadius: '50%', display: 'inline-block' }} />
                      {t('common.loading')}
                    </>
                  ) : t('dashboard.updateRate')}
                </motion.button>
              </form>
            </div>
            {rateSuccess && (
              <motion.div
                initial={{ opacity: 0, y: 8 }}
                animate={{ opacity: 1, y: 0 }}
                className="alert-banner alert-info"
                style={{ margin: '16px 0 0' }}
              >
                <BadgeCheck size={18} />
                <span>{t('dashboard.rateUpdateSuccess')}</span>
              </motion.div>
            )}
          </FadeScale>
        )}

        <GoldDivider style={{ marginTop: 26 }} />
      </main>
    </div>
  );
}
