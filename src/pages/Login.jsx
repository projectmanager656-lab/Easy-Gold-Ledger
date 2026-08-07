import React, { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { motion } from 'framer-motion';
import { signInWithEmailAndPassword, sendPasswordResetEmail, signOut } from 'firebase/auth';
import { doc, getDoc, setDoc } from 'firebase/firestore';
import { auth, db } from '../services/firebase';
import { Coins, Lock, Mail, Languages, CheckCircle, AlertCircle, Eye, EyeOff, ShieldCheck, Sparkles } from 'lucide-react';
import { GoldParticles } from '../components/PremiumUI';

export default function Login() {
  const { t, i18n } = useTranslation();
  const navigate = useNavigate();

  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [loading, setLoading] = useState(false);
  const [errorMsg, setErrorMsg] = useState(() => {
    return sessionStorage.getItem('deactivated_user_msg') || '';
  });
  const [forgotPasswordMode, setForgotPasswordMode] = useState(false);
  const [resetSuccess, setResetSuccess] = useState(false);
  const [showPassword, setShowPassword] = useState(false);

  // Sync translation for deactivation message if present
  useEffect(() => {
    const deactMsg = sessionStorage.getItem('deactivated_user_msg');
    if (deactMsg) {
      setErrorMsg(t('login.inactiveError') || 'Your account is inactive. Please contact the shop owner.');
    }
  }, [t]);

  const handleLogin = async (e) => {
    e.preventDefault();
    if (!email || !password) {
      setErrorMsg(t('login.invalidEmail'));
      return;
    }

    setLoading(true);
    setErrorMsg('');

    try {
      // 1. Sign in
      const userCredential = await signInWithEmailAndPassword(auth, email, password);
      const user = userCredential.user;
      const uid = user.uid;

      // 2. Fetch role & status from users collection
      const userDocRef = doc(db, 'users', uid);
      let userSnap = await getDoc(userDocRef);
      let userData;

      if (!userSnap.exists()) {
        // Auto-provision Super Admin profile if missing in Firestore to prevent auto-logout
        console.warn('User profile missing in Firestore. Auto-provisioning admin role...');
        const newUserData = {
          role: 'super_admin',
          name: user.displayName || email.split('@')[0] || 'Super Admin',
          phone: '',
          email: user.email,
          status: 'active',
          createdAt: new Date().toISOString()
        };
        try {
          await setDoc(userDocRef, newUserData);
          userData = newUserData;
        } catch (dbErr) {
          console.error('Failed to auto-create user doc:', dbErr);
          // Fallback in-memory userData
          userData = newUserData;
        }
      } else {
        userData = userSnap.data();
      }

      // 3. Enforce account activation check (super_admin bypasses inactive check)
      if (userData.status === 'inactive' && userData.role !== 'super_admin') {
        const msg = t('login.inactiveError') || 'Your account is inactive. Please contact the shop owner.';
        sessionStorage.setItem('deactivated_user_msg', msg);
        await signOut(auth);
        setErrorMsg(msg);
        setLoading(false);
        return;
      }

      // Clear any past deactivation notice on successful login
      sessionStorage.removeItem('deactivated_user_msg');

      // 4. Save session information locally
      const effectiveRole = userData.role || 'super_admin';
      const effectiveName = userData.name || email.split('@')[0] || 'Admin';

      localStorage.setItem('user_role', effectiveRole);
      localStorage.setItem('user_name', effectiveName);

      // Redirect to dashboard
      navigate('/dashboard');
    } catch (error) {
      console.error(error);
      if (error.code === 'auth/user-not-found' || error.code === 'auth/wrong-password' || error.code === 'auth/invalid-credential') {
        setErrorMsg('Invalid email credentials or password.');
      } else {
        setErrorMsg(error.message || 'An error occurred during login.');
      }
    } finally {
      setLoading(false);
    }
  };

  const handleResetPassword = async (e) => {
    e.preventDefault();
    if (!email) {
      setErrorMsg(t('login.invalidEmail'));
      return;
    }

    setLoading(true);
    setErrorMsg('');
    setResetSuccess(false);

    try {
      await sendPasswordResetEmail(auth, email);
      setResetSuccess(true);
    } catch (error) {
      console.error(error);
      setErrorMsg(error.message || 'Failed to send password reset email.');
    } finally {
      setLoading(false);
    }
  };

  const changeLanguage = (lng) => {
    i18n.changeLanguage(lng);
    localStorage.setItem('lang', lng);
  };

  return (
    <div style={{
      display: 'flex',
      minHeight: '100vh',
      alignItems: 'center',
      justifyContent: 'center',
      padding: '24px',
      position: 'relative',
      overflow: 'hidden'
    }}>
      <GoldParticles count={16} />

      {/* Decorative glows */}
      <div style={{
        position: 'absolute', top: '-18%', left: '-12%', width: '520px', height: '520px',
        borderRadius: '50%', background: 'radial-gradient(circle, rgba(247,201,72,0.14), transparent 62%)',
        filter: 'blur(30px)', pointerEvents: 'none'
      }} />
      <div style={{
        position: 'absolute', bottom: '-20%', right: '-14%', width: '560px', height: '560px',
        borderRadius: '50%', background: 'radial-gradient(circle, rgba(255,193,7,0.1), transparent 62%)',
        filter: 'blur(30px)', pointerEvents: 'none'
      }} />

      <motion.div
        initial={{ opacity: 0, y: 30, scale: 0.96 }}
        animate={{ opacity: 1, y: 0, scale: 1 }}
        transition={{ duration: 0.7, ease: [0.22, 1, 0.36, 1] }}
        className="glow-card"
        style={{ width: '100%', maxWidth: 460, padding: '42px 36px', borderRadius: 28, position: 'relative', zIndex: 2 }}
      >
        {/* Language selector */}
        <div style={{ display: 'flex', justifyContent: 'flex-end', alignItems: 'center', gap: '8px', marginBottom: '24px' }}>
          <Languages size={15} style={{ color: 'var(--text-2)' }} />
          <select
            value={i18n.language}
            onChange={(e) => changeLanguage(e.target.value)}
            style={{
              background: 'rgba(9, 9, 9, 0.55)',
              color: 'var(--text-primary)',
              border: '1px solid var(--border-glass)',
              borderRadius: '10px',
              padding: '8px 12px',
              fontSize: '0.875rem',
              cursor: 'pointer',
              width: 'auto'
            }}
          >
            <option value="en">English</option>
            <option value="hi">हिन्दी</option>
            <option value="mr">मराठी</option>
          </select>
        </div>

        {/* Branding header */}
        <motion.div
          initial={{ opacity: 0, scale: 0.9 }}
          animate={{ opacity: 1, scale: 1 }}
          transition={{ duration: 0.7, delay: 0.15, ease: [0.22, 1, 0.36, 1] }}
          style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', textAlign: 'center', '': '32px', gap: '16px' }}
        >
          <motion.span
            className="float-slow"
            style={{
              width: 76, height: 76, borderRadius: '50%',
              display: 'flex', alignItems: 'center', justifyContent: 'center',
              background: 'radial-gradient(circle at 32% 28%, #fff6cf, #ffe08a 38%, #f7c948 58%, #b87e12 100%)',
              boxShadow: '0 18px 44px rgba(247,201,72,0.45), inset 0 2px 10px rgba(255,255,255,0.6), inset 0 -8px 18px rgba(140,90,8,0.4)',
              border: '3px solid rgba(255,224,138,0.8)',
              color: '#14100a'
            }}
          >
            <Coins size={38} />
          </motion.span>
          <div>
            <h2 className="serif-title" style={{ fontSize: '2rem', marginBottom: 6 }}>
              {t('login.title')}
            </h2>
            <p style={{ color: 'var(--text-2)', fontSize: '1rem' }}>
              {t('login.subtitle')}
            </p>
          </div>
          <span className="chip chip-gold" style={{ fontSize: '0.75rem', letterSpacing: '0.14em' }}>
            <Sparkles size={11} />
            PREMIUM GOLD LOAN PLATFORM
          </span>
        </motion.div>

        {/* Alerts */}
        <AnimatedAlert show={!!errorMsg} type="critical" icon={<AlertCircle size={18} />}>
          {errorMsg}
        </AnimatedAlert>

        <AnimatedAlert show={resetSuccess} type="info" icon={<CheckCircle size={18} />}>
          {t('login.resetSent')}
        </AnimatedAlert>

        {/* Form */}
        {!forgotPasswordMode ? (
          <form onSubmit={handleLogin} style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
            <div className="form-group">
              <label>{t('login.email')}</label>
              <div className="field">
                <Mail size={17} />
                <input
                  type="email"
                  placeholder="name@jeweler.com"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  required
                />
              </div>
            </div>

            <div className="form-group">
              <label>{t('login.password')}</label>
              <div className="field">
                <Lock size={17} />
                <input
                  type={showPassword ? 'text' : 'password'}
                  placeholder="••••••••"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  required
                  style={{ paddingRight: '46px' }}
                />
                <button
                  type="button"
                  onClick={() => setShowPassword(!showPassword)}
                  style={{
                    position: 'absolute', right: '14px', top: '50%', transform: 'translateY(-50%)',
                    background: 'transparent', border: 'none', cursor: 'pointer',
                    color: 'var(--text-muted)', display: 'flex', alignItems: 'center', padding: '4px',
                    zIndex: 2
                  }}
                  tabIndex={-1}
                  aria-label={showPassword ? 'Hide password' : 'Show password'}
                >
                  {showPassword ? <EyeOff size={17} /> : <Eye size={17} />}
                </button>
              </div>
            </div>

            <div style={{ display: 'flex', justifyContent: 'flex-end', marginBottom: '24px' }}>
              <button
                type="button"
                onClick={() => { setForgotPasswordMode(true); setErrorMsg(''); }}
                className="btn btn-ghost"
                style={{ padding: '4px 0', fontSize: '0.875rem', color: 'var(--gold-primary)', cursor: 'pointer' }}
              >
                {t('login.forgotPassword')}
              </button>
            </div>

            <motion.button
              type="submit"
              className="btn btn-primary"
              style={{ width: '100%', padding: '16px', fontSize: '1rem', borderRadius: 16 }}
              disabled={loading}
              whileHover={loading ? {} : { scale: 1.015 }}
              whileTap={loading ? {} : { scale: 0.985 }}
            >
              {loading ? (
                <>
                  <span className="animate-spin" style={{ width: 16, height: 16, border: '2px solid rgba(20,16,10,0.3)', borderTopColor: '#14100a', borderRadius: '50%', display: 'inline-block' }} />
                  {t('common.loading')}
                </>
              ) : t('login.signIn')}
            </motion.button>

            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8, marginTop: 24, color: 'var(--text-3)', fontSize: '0.75rem' }}>
              <ShieldCheck size={14} style={{ color: 'var(--gold)' }} />
              Secured by Firebase · 24K Gold Ledger
            </div>
          </form>
        ) : (
          <form onSubmit={handleResetPassword} style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
            <div className="form-group">
              <label>{t('login.email')}</label>
              <div className="field">
                <Mail size={17} />
                <input
                  type="email"
                  placeholder="name@jeweler.com"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  required
                />
              </div>
            </div>

            <motion.button
              type="submit"
              className="btn btn-primary"
              style={{ width: '100%', padding: '16px', fontSize: '1rem', borderRadius: 16, marginBottom: '12px' }}
              disabled={loading}
              whileHover={loading ? {} : { scale: 1.015 }}
              whileTap={loading ? {} : { scale: 0.985 }}
            >
              {loading ? t('common.loading') : t('login.sendReset')}
            </motion.button>

            <button
              type="button"
              onClick={() => { setForgotPasswordMode(false); setErrorMsg(''); setResetSuccess(false); }}
              className="btn btn-secondary"
              style={{ width: '100%', padding: '13px', borderRadius: 14 }}
            >
              {t('login.backToLogin')}
            </button>
          </form>
        )}
      </motion.div>
    </div>
  );
}

/* ---- Animated alert (motion-aware) ---- */
function AnimatedAlert({ show, type, icon, children }) {
  if (!show) return null;
  const cls = type === 'critical' ? 'alert-critical' : 'alert-info';
  return (
    <motion.div
      className={`alert-banner ${cls}`}
      style={{ marginBottom: 20 }}
      initial={{ opacity: 0, y: -10, height: 0, padding: '0 18px' }}
      animate={{ opacity: 1, y: 0, height: 'auto', padding: '16px 18px' }}
      transition={{ duration: 0.4, ease: [0.22, 1, 0.36, 1] }}
    >
      <span style={{ flexShrink: 0 }}>{icon}</span>
      <span>{children}</span>
    </motion.div>
  );
}
