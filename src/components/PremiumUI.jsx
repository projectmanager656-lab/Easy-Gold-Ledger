import React, { useMemo, useState, useRef, useEffect } from 'react';
import { motion } from 'framer-motion';

/* ============================================================
   SHARED PREMIUM UI KIT — Easy Gold Ledger
   Pure presentational components. No business logic.
   ============================================================ */

/* ---- Page transition wrapper (0.6s luxury fade + rise) ---- */
export function PageTransition({ children }) {
  return (
    <motion.div
      initial={{ opacity: 0, y: 18, scale: 0.995 }}
      animate={{ opacity: 1, y: 0, scale: 1 }}
      exit={{ opacity: 0, y: -10, scale: 0.995 }}
      transition={{ duration: 0.6, ease: [0.22, 1, 0.36, 1] }}
    >
      {children}
    </motion.div>
  );
}

/* ---- Staggered container for card grids ---- */
export function StaggerGroup({ children, className = '', delay = 0.08, style }) {
  return (
    <motion.div
      className={className}
      style={style}
      initial="hidden"
      animate="show"
      variants={{
        hidden: {},
        show: { transition: { staggerChildren: delay } }
      }}
    >
      {children}
    </motion.div>
  );
}

/* ---- Individual card fade + scale in ---- */
export function FadeScale({ children, delay = 0, className = '', style }) {
  return (
    <motion.div
      className={className}
      style={style}
      initial={{ opacity: 0, y: 26, scale: 0.96 }}
      animate={{ opacity: 1, y: 0, scale: 1 }}
      transition={{ duration: 0.6, delay, ease: [0.22, 1, 0.36, 1] }}
    >
      {children}
    </motion.div>
  );
}

/* ---- Animated counter (self-contained rAF, no deps) ---- */
export function AnimatedNumber({ value, prefix = '', suffix = '', decimals = 0, duration = 1.2, className = '' }) {
  const numeric = typeof value === 'number' && !Number.isNaN(value) ? value : 0;
  const [display, setDisplay] = useState(0);
  const prevRef = useRef(0);

  useEffect(() => {
    const from = prevRef.current;
    const to = numeric;
    if (from === to) return;
    const startTime = performance.now();
    let raf;
    const tick = (now) => {
      const t = Math.min(1, (now - startTime) / (duration * 1000));
      const eased = 1 - Math.pow(1 - t, 3);
      setDisplay(from + (to - from) * eased);
      if (t < 1) {
        raf = requestAnimationFrame(tick);
      } else {
        prevRef.current = to;
      }
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [numeric, duration]);

  const formatted = display.toLocaleString('en-IN', {
    minimumFractionDigits: decimals,
    maximumFractionDigits: decimals
  });

  return (
    <span className={className}>
      {prefix}{formatted}{suffix}
    </span>
  );
}

/* ---- Page header with eyebrow + serif title ---- */
export function PageHeader({ eyebrow, title, subtitle, actions, className = '' }) {
  return (
    <motion.div
      className={`page-header ${className}`}
      initial={{ opacity: 0, y: 16 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.55, ease: [0.22, 1, 0.36, 1] }}
    >
      <div>
        {eyebrow && <span className="eyebrow">{eyebrow}</span>}
        <h1 className="serif-title">{title}</h1>
        {subtitle && <p>{subtitle}</p>}
      </div>
      {actions && <div style={{ display: 'flex', gap: '12px', flexWrap: 'wrap' }}>{actions}</div>}
    </motion.div>
  );
}

/* ---- Premium stat card with animated counter + icon ---- */
export function StatCard({ icon, iconClass = '', label, value, prefix = '', suffix = '', decimals = 0, sub, className = '', delay = 0, style }) {
  return (
    <FadeScale delay={delay} className={`stat-card ${className}`} style={style}>
      <div className={`stat-icon ${iconClass}`}>{icon}</div>
      <div className="stat-label">{label}</div>
      <div className="stat-value gold-gradient-text">
        <AnimatedNumber value={value} prefix={prefix} suffix={suffix} decimals={decimals} />
      </div>
      {sub && <div className="stat-sub">{sub}</div>}
    </FadeScale>
  );
}

/* ---- Glass card with hover lift ---- */
export function GlassCard({ children, className = '', style, onClick, interactive = true }) {
  return (
    <div
      className={`glass-panel ${className}`}
      style={style}
      onClick={onClick}
      role={onClick ? 'button' : undefined}
      tabIndex={onClick ? 0 : undefined}
      onKeyDown={onClick ? (e) => { if (e.key === 'Enter') onClick(); } : undefined}
    >
      {children}
    </div>
  );
}

/* ---- 3D tilt-on-hover card ---- */
export function TiltCard({ children, className = '', style, onClick, maxTilt = 7 }) {
  const ref = useRef(null);
  const [transform, setTransform] = useState('');

  const handleMove = (e) => {
    const el = ref.current;
    if (!el) return;
    const rect = el.getBoundingClientRect();
    const x = (e.clientX - rect.left) / rect.width - 0.5;
    const y = (e.clientY - rect.top) / rect.height - 0.5;
    setTransform(`perspective(900px) rotateX(${(-y * maxTilt).toFixed(2)}deg) rotateY(${(x * maxTilt).toFixed(2)}deg) translateY(-4px)`);
  };

  const reset = () => setTransform('');

  return (
    <div
      ref={ref}
      className={`tilt-card ${className}`}
      style={{ ...style, transform, transition: 'transform 0.35s cubic-bezier(0.22,1,0.36,1)' }}
      onMouseMove={handleMove}
      onMouseLeave={reset}
      onClick={onClick}
    >
      {children}
    </div>
  );
}

/* ---- Premium empty state ---- */
export function EmptyState({ icon, title, message, action }) {
  return (
    <div className="glass-panel" style={{ padding: 0, overflow: 'hidden' }}>
      <motion.div
        className="empty-state"
        initial={{ opacity: 0, scale: 0.94 }}
        animate={{ opacity: 1, scale: 1 }}
        transition={{ duration: 0.5, ease: [0.22, 1, 0.36, 1] }}
      >
        <div className="empty-state-icon">{icon}</div>
        <h3>{title}</h3>
        <p>{message}</p>
        {action}
      </motion.div>
    </div>
  );
}

/* ---- Gold coin (floating) decorative ---- */
export function GoldCoin({ size = 44 }) {
  return (
    <span
      className="float-slow"
      style={{
        width: size,
        height: size,
        borderRadius: '50%',
        display: 'inline-flex',
        alignItems: 'center',
        justifyContent: 'center',
        background: 'radial-gradient(circle at 32% 28%, #fff6cf, #ffe08a 38%, #f7c948 58%, #b87e12 100%)',
        boxShadow: '0 10px 26px rgba(247,201,72,0.4), inset 0 2px 8px rgba(255,255,255,0.6), inset 0 -6px 14px rgba(140,90,8,0.4)',
        border: '2px solid rgba(255,224,138,0.8)',
        flexShrink: 0
      }}
    />
  );
}

/* ---- Gold sparkle divider ---- */
export function GoldDivider() {
  return <hr className="divider" />;
}

/* ---- Status badge mapper ---- */
export function StatusBadge({ status }) {
  const cls = status === 'open'
    ? 'badge-open'
    : status === 'closed'
      ? 'badge-closed'
      : status === 'active'
        ? 'badge-closed'
        : status === 'inactive'
          ? 'badge-inactive'
          : 'badge-forfeited';
  return <span className={`badge ${cls}`}>{status?.toUpperCase()}</span>;
}

/* ---- Skeleton shimmer block ---- */
export function SkeletonBlock({ width = '100%', height = 18, radius = 10, style }) {
  return <div className="skeleton" style={{ width, height, borderRadius: radius, ...style }} />;
}

export function SkeletonCard() {
  return (
    <div className="skeleton-card">
      <SkeletonBlock height={14} width="40%" style={{ marginBottom: 16 }} />
      <SkeletonBlock height={34} style={{ marginBottom: 12 }} />
      <SkeletonBlock height={12} width="70%" />
    </div>
  );
}

/* ---- Ripple button (gold gradient) ---- */
export function GoldButton({ children, className = '', style, ...rest }) {
  const btnRef = useRef(null);
  const onClick = (e) => {
    const el = btnRef.current;
    if (el) {
      const rect = el.getBoundingClientRect();
      el.style.setProperty('--mx', `${((e.clientX - rect.left) / rect.width) * 100}%`);
      el.style.setProperty('--my', `${((e.clientY - rect.top) / rect.height) * 100}%`);
    }
    rest.onClick?.(e);
  };
  return (
    <button ref={btnRef} className={`btn btn-primary ${className}`} style={style} {...rest} onClick={onClick}>
      {children}
    </button>
  );
}

/* ---- useMemo'd helper: greeting by hour ---- */
export function useGreeting() {
  return useMemo(() => {
    const h = new Date().getHours();
    if (h < 12) return 'Good Morning';
    if (h < 17) return 'Good Afternoon';
    return 'Good Evening';
  }, []);
}

/* ---- Floating gold particles background (decorative) ---- */
export function GoldParticles({ count = 14 }) {
  const particles = useMemo(() =>
    Array.from({ length: count }, (_, i) => ({
      id: i,
      left: `${(i * 7.3 + 4) % 96}%`,
      top: `${(i * 13.7 + 6) % 90}%`,
      size: 3 + ((i * 5) % 6),
      delay: `${(i % 7) * 0.7}s`,
      duration: `${5 + (i % 5) * 1.4}s`
    })), [count]);

  return (
    <div style={{ position: 'fixed', inset: 0, pointerEvents: 'none', zIndex: 0, overflow: 'hidden' }} aria-hidden>
      {particles.map(p => (
        <span
          key={p.id}
          style={{
            position: 'absolute',
            left: p.left,
            top: p.top,
            width: p.size,
            height: p.size,
            borderRadius: '50%',
            background: 'radial-gradient(circle, #ffe08a, #f7c948 60%, transparent)',
            opacity: 0,
            boxShadow: '0 0 12px rgba(247,201,72,0.7)',
            animation: `float ${p.duration} ease-in-out infinite, loader-pulse 4s ease-in-out infinite`,
            animationDelay: p.delay
          }}
        />
      ))}
    </div>
  );
}

/* ---- Currency formatter ---- */
export function formatINR(value) {
  if (value === null || value === undefined || Number.isNaN(Number(value))) return '₹0';
  return `₹${Number(value).toLocaleString('en-IN')}`;
}
