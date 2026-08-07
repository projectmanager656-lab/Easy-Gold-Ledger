import React from 'react';
import { createPortal } from 'react-dom';
import { useNavigate, Link, useLocation } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { motion, AnimatePresence } from 'framer-motion';
import { auth, db } from '../services/firebase';
import { signOut } from 'firebase/auth';
import {
  collection,
  query,
  where,
  onSnapshot,
  writeBatch,
  doc
} from 'firebase/firestore';
import {
  Coins,
  Users,
  FileText,
  KeyRound,
  TrendingUp,
  LogOut,
  User,
  ShieldCheck,
  Languages,
  Sun,
  Moon,
  Bell,
  Info,
  AlertTriangle,
  AlertCircle,
  Menu,
  X,
  ChevronDown,
  LayoutDashboard,
  BadgeCheck
} from 'lucide-react';

export default function Navbar({ userRole, userName }) {
  const { t, i18n } = useTranslation();
  const navigate = useNavigate();
  const location = useLocation();

  const [theme, setTheme] = React.useState(localStorage.getItem('theme') || 'dark');
  const [showDropdown, setShowDropdown] = React.useState(false);
  const [showAdminDropdown, setShowAdminDropdown] = React.useState(false);
  const [showNotifDropdown, setShowNotifDropdown] = React.useState(false);
  const [mobileMenuOpen, setMobileMenuOpen] = React.useState(false);
  const [confirmLogout, setConfirmLogout] = React.useState(false);
  const [notifications, setNotifications] = React.useState([]);

  const dropdownRef = React.useRef(null);
  const adminDropdownRef = React.useRef(null);
  const notifDropdownRef = React.useRef(null);

  const effectiveRole = userRole || localStorage.getItem('user_role') || 'super_admin';
  const isStaff = effectiveRole === 'super_admin' || effectiveRole === 'employee';
  const isAdmin = effectiveRole === 'super_admin';

  React.useEffect(() => {
    function handleClickOutside(event) {
      if (dropdownRef.current && !dropdownRef.current.contains(event.target)) {
        setShowDropdown(false);
        setConfirmLogout(false);
      }
      if (adminDropdownRef.current && !adminDropdownRef.current.contains(event.target)) {
        setShowAdminDropdown(false);
      }
      if (notifDropdownRef.current && !notifDropdownRef.current.contains(event.target)) {
        setShowNotifDropdown(false);
      }
    }
    document.addEventListener("mousedown", handleClickOutside);
    return () => {
      document.removeEventListener("mousedown", handleClickOutside);
    };
  }, []);

  React.useEffect(() => {
    let unsubscribeSnap = null;

    const unsubscribeAuth = auth.onAuthStateChanged((user) => {
      if (unsubscribeSnap) {
        unsubscribeSnap();
        unsubscribeSnap = null;
      }

      if (user) {
        const q = query(
          collection(db, 'notifications'),
          where('userId', '==', user.uid)
        );

        unsubscribeSnap = onSnapshot(q, (snap) => {
          const list = snap.docs.map(doc => ({
            id: doc.id,
            ...doc.data()
          })).sort((a, b) => {
            const timeA = a.createdAt?.toDate ? a.createdAt.toDate().getTime() : new Date(a.createdAt).getTime();
            const timeB = b.createdAt?.toDate ? b.createdAt.toDate().getTime() : new Date(b.createdAt).getTime();
            return (timeB || 0) - (timeA || 0);
          }).slice(0, 50);
          setNotifications(list);
        }, (err) => {
          console.error("Error loading notifications:", err);
        });
      } else {
        setNotifications([]);
      }
    });

    return () => {
      unsubscribeAuth();
      if (unsubscribeSnap) unsubscribeSnap();
    };
  }, []);

  const unreadCount = notifications.filter(n => !n.isRead).length;

  const getSeverityIcon = (severity) => {
    switch (severity) {
      case 'critical': return AlertCircle;
      case 'warning': return AlertTriangle;
      default: return Info;
    }
  };

  const getSeverityColor = (severity) => {
    switch (severity) {
      case 'critical': return 'var(--danger-primary)';
      case 'warning': return 'var(--warning-primary)';
      default: return 'var(--gold-primary)';
    }
  };

  const formatTimeAgo = (createdAt) => {
    if (!createdAt) return '';
    let date;
    if (typeof createdAt.toDate === 'function') {
      date = createdAt.toDate();
    } else if (createdAt instanceof Date) {
      date = createdAt;
    } else {
      date = new Date(createdAt);
    }
    const seconds = Math.floor((new Date() - date) / 1000);
    if (seconds < 60) return t('common.justNow') || 'just now';
    const minutes = Math.floor(seconds / 60);
    if (minutes < 60) return `${minutes}m ago`;
    const hours = Math.floor(minutes / 60);
    if (hours < 24) return `${hours}h ago`;
    const days = Math.floor(hours / 24);
    return `${days}d ago`;
  };

  const handleNotifClick = async (notif) => {
    setShowNotifDropdown(false);

    if (!notif.isRead) {
      try {
        const notifRef = doc(db, 'notifications', notif.id);
        const batch = writeBatch(db);
        batch.update(notifRef, { isRead: true });
        await batch.commit();
      } catch (err) {
        console.error("Error marking notification as read:", err);
      }
    }

    if (notif.loanId) {
      navigate(`/loans?id=${notif.loanId}`);
    } else {
      navigate('/notifications');
    }
  };

  const handleMarkAllRead = async () => {
    try {
      const batch = writeBatch(db);
      notifications.forEach(notif => {
        if (!notif.isRead) {
          const ref = doc(db, 'notifications', notif.id);
          batch.update(ref, { isRead: true });
        }
      });
      await batch.commit();
    } catch (err) {
      console.error("Error marking all read:", err);
    }
  };

  const toggleTheme = () => {
    const nextTheme = theme === 'dark' ? 'light' : 'dark';
    setTheme(nextTheme);
    if (nextTheme === 'light') {
      document.documentElement.classList.add('light-theme');
    } else {
      document.documentElement.classList.remove('light-theme');
    }
    localStorage.setItem('theme', nextTheme);
  };

  const handleLogout = async () => {
    try {
      await signOut(auth);
      localStorage.removeItem('user_role');
      localStorage.removeItem('user_name');
      navigate('/login');
    } catch (err) {
      console.error('Logout error:', err);
    }
  };

  const changeLanguage = (lng) => {
    i18n.changeLanguage(lng);
    localStorage.setItem('lang', lng);
  };

  const isActive = (path) => location.pathname === path;

  const NAV_ITEMS = isStaff
    ? [
        { to: '/dashboard', icon: LayoutDashboard, label: t('nav.dashboard'), exact: true },
        { to: '/customers', icon: Users, label: t('nav.customers') },
        { to: '/loans', icon: Coins, label: t('nav.loans') },
        { to: '/reports', icon: FileText, label: t('nav.reports') },
        { to: '/gold-rate', icon: TrendingUp, label: t('nav.goldRate') }
      ]
    : [
        { to: '/loans', icon: Coins, label: t('dashboard.myPledges'), exact: true },
        { to: '/profile', icon: User, label: t('nav.profile') },
        { to: '/gold-rate', icon: TrendingUp, label: t('nav.goldRate') }
      ];

  const renderDesktopNav = () => (
    <div className="navbar-links desktop-nav-links">
      {NAV_ITEMS.map((item) => {
        const active = item.exact ? isActive(item.to) : location.pathname.startsWith(item.to);
        const Icon = item.icon;
        return (
          <Link key={item.to} to={item.to} className={`nav-tab ${active ? 'active' : ''}`}>
            <Icon size={16} />
            <span>{item.label}</span>
          </Link>
        );
      })}

      {isAdmin && (
        <div style={{ position: 'relative' }} ref={adminDropdownRef}>
          <button
            onClick={() => setShowAdminDropdown(!showAdminDropdown)}
            className={`nav-tab ${isActive('/staff') || isActive('/audit-logs') ? 'active' : ''}`}
            style={{ background: 'none', border: 'none', cursor: 'pointer' }}
          >
            <ShieldCheck size={16} />
            <span>{t('nav.adminPanel')}</span>
            <motion.span animate={{ rotate: showAdminDropdown ? 180 : 0 }} transition={{ duration: 0.25 }} style={{ display: 'inline-flex' }}>
              <ChevronDown size={13} />
            </motion.span>
          </button>

          <AnimatePresence>
            {showAdminDropdown && (
              <motion.div
                initial={{ opacity: 0, y: -8, scale: 0.96 }}
                animate={{ opacity: 1, y: 0, scale: 1 }}
                exit={{ opacity: 0, y: -6, scale: 0.97 }}
                transition={{ duration: 0.25, ease: [0.22, 1, 0.36, 1] }}
                className="glass-panel"
                style={{
                  position: 'absolute',
                  left: 0,
                  top: '46px',
                  width: '210px',
                  padding: '8px',
                  zIndex: 1000,
                  display: 'flex',
                  flexDirection: 'column',
                  gap: '8px',
                  borderRadius: '16px',
                  background: 'rgba(16, 16, 20, 0.92)',
                  backdropFilter: 'blur(20px)'
                }}
              >
                <Link
                  to="/staff"
                  onClick={() => setShowAdminDropdown(false)}
                  className="dropdown-item"
                >
                  <Users size={15} />
                  <span>{t('nav.staff')}</span>
                </Link>
                <Link
                  to="/audit-logs"
                  onClick={() => setShowAdminDropdown(false)}
                  className="dropdown-item"
                >
                  <KeyRound size={15} />
                  <span>{t('nav.auditLogs')}</span>
                </Link>
              </motion.div>
            )}
          </AnimatePresence>
        </div>
      )}
    </div>
  );

  const getRoleBadgeClass = () => {
    switch (effectiveRole) {
      case 'super_admin': return 'chip-red';
      case 'employee': return 'chip-blue';
      default: return 'chip-green';
    }
  };

  const getRoleName = () => {
    return userRole === 'super_admin' ? 'Super Admin' : userRole === 'employee' ? 'Employee' : 'Customer';
  };

  const getInitials = () => {
    if (!userName) return 'A';
    return userName.split(' ').map(w => w[0]).slice(0, 2).join('').toUpperCase();
  };

  return (
    <nav className="navbar-container">
      {/* Brand */}
      <div style={{ display: 'flex', alignItems: 'center', gap: '12px', minWidth: 0 }}>
        <button
          className="mobile-hamburger-btn"
          onClick={() => setMobileMenuOpen(!mobileMenuOpen)}
          aria-label="Toggle navigation"
        >
          {mobileMenuOpen ? <X size={22} /> : <Menu size={22} />}
        </button>

        <Link to="/dashboard" style={{ display: 'flex', alignItems: 'center', gap: '12px', textDecoration: 'none', minWidth: 0 }}>
          <span className="brand-mark">
            <Coins size={22} />
          </span>
          <span className="serif-title" style={{ fontSize: '1.25rem', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
            Easy Gold Ledger
          </span>
        </Link>
      </div>

      {renderDesktopNav()}

      {/* Mobile drawer */}
      {mobileMenuOpen && createPortal(
        <motion.div
          className="mobile-drawer-overlay"
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          onClick={() => setMobileMenuOpen(false)}
        >
          <motion.div
            className="mobile-drawer-content"
            onClick={(e) => e.stopPropagation()}
            initial={{ y: -30, opacity: 0 }}
            animate={{ y: 0, opacity: 1 }}
            transition={{ duration: 0.4, ease: [0.22, 1, 0.36, 1] }}
          >
            <div className="flex-between" style={{ marginBottom: '8px', borderBottom: '1px solid var(--border-soft)', paddingBottom: '14px' }}>
              <div className="flex-gap" style={{ gap: 10 }}>
                <span className="brand-mark" style={{ width: 38, height: 38, borderRadius: 12 }}>
                  <Coins size={20} />
                </span>
                <span className="serif-title" style={{ fontSize: '1.25rem' }}>Easy Gold Ledger</span>
              </div>
              <button className="icon-btn" onClick={() => setMobileMenuOpen(false)} aria-label="Close menu">
                <X size={20} />
              </button>
            </div>

            {NAV_ITEMS.map((item) => {
              const active = item.exact ? isActive(item.to) : location.pathname.startsWith(item.to);
              const Icon = item.icon;
              return (
                <Link
                  key={item.to}
                  to={item.to}
                  onClick={() => setMobileMenuOpen(false)}
                  className={`mobile-nav-item ${active ? 'active' : ''}`}
                >
                  <Icon size={18} />
                  <span>{item.label}</span>
                </Link>
              );
            })}

            {isAdmin && (
              <>
                <Link
                  to="/staff"
                  onClick={() => setMobileMenuOpen(false)}
                  className={`mobile-nav-item ${isActive('/staff') ? 'active' : ''}`}
                >
                  <Users size={18} />
                  <span>{t('nav.staff')}</span>
                </Link>
                <Link
                  to="/audit-logs"
                  onClick={() => setMobileMenuOpen(false)}
                  className={`mobile-nav-item ${isActive('/audit-logs') ? 'active' : ''}`}
                >
                  <KeyRound size={18} />
                  <span>{t('nav.auditLogs')}</span>
                </Link>
              </>
            )}

            {!isStaff && (
              <Link
                to="/profile"
                onClick={() => setMobileMenuOpen(false)}
                className={`mobile-nav-item ${isActive('/profile') ? 'active' : ''}`}
              >
                <User size={18} />
                <span>{t('nav.profile')}</span>
              </Link>
            )}

            <div style={{ marginTop: 'auto', paddingTop: '14px', borderTop: '1px solid var(--border-soft)', display: 'flex', flexDirection: 'column', gap: '12px' }}>
              <div className="flex-between">
                <div className="flex-gap" style={{ gap: 8 }}>
                  <Languages size={15} style={{ color: 'var(--gold)' }} />
                  <select
                    value={i18n.language}
                    onChange={(e) => changeLanguage(e.target.value)}
                    className="nav-select"
                    aria-label="Language"
                  >
                    <option value="en">English</option>
                    <option value="hi">हिन्दी</option>
                    <option value="mr">मराठी</option>
                  </select>
                </div>
                <button
                  className="icon-btn"
                  onClick={() => { toggleTheme(); }}
                  aria-label="Toggle theme"
                >
                  {theme === 'dark' ? <Sun size={17} /> : <Moon size={17} />}
                </button>
              </div>
              <button
                onClick={() => { setMobileMenuOpen(false); handleLogout(); }}
                className="btn btn-danger"
                style={{ width: '100%', justifyContent: 'center', gap: '8px', padding: '12px' }}
              >
                <LogOut size={18} />
                <span>{t('nav.logout')}</span>
              </button>
            </div>
          </motion.div>
        </motion.div>,
        document.body
      )}

      {/* Actions */}
      <div className="navbar-actions">
        {/* Language selector */}
        <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
          <Languages size={15} style={{ color: 'var(--text-2)' }} />
          <select
            value={i18n.language}
            onChange={(e) => changeLanguage(e.target.value)}
            className="nav-select"
            aria-label="Language"
          >
            <option value="en">English</option>
            <option value="hi">हिन्दी</option>
            <option value="mr">मराठी</option>
          </select>
        </div>

        {/* Notifications */}
        {userName && (
          <div style={{ position: 'relative' }} ref={notifDropdownRef}>
            <button
              onClick={() => setShowNotifDropdown(!showNotifDropdown)}
              className="icon-btn"
              style={{ color: unreadCount > 0 ? 'var(--gold)' : undefined, borderColor: unreadCount > 0 ? 'rgba(247,201,72,0.35)' : undefined }}
              title="Notifications"
              aria-label="Notifications"
            >
              <Bell size={17} />
              {unreadCount > 0 && <span className="notif-dot">{unreadCount > 9 ? '9+' : unreadCount}</span>}
            </button>

            <AnimatePresence>
              {showNotifDropdown && createPortal(
                <div className="notif-dropdown-overlay" onClick={() => setShowNotifDropdown(false)}>
                  <motion.div
                    className="notif-dropdown-menu"
                    onClick={(e) => e.stopPropagation()}
                    initial={{ opacity: 0, y: -12, scale: 0.96 }}
                    animate={{ opacity: 1, y: 0, scale: 1 }}
                    exit={{ opacity: 0, y: -8, scale: 0.97 }}
                    transition={{ duration: 0.3, ease: [0.22, 1, 0.36, 1] }}
                  >
                    <div className="flex-between" style={{ borderBottom: '1px solid var(--border-soft)', paddingBottom: '10px' }}>
                      <span className="eyebrow" style={{ fontSize: '0.75rem' }}>
                        {t('common.notifications') || 'Notifications'}
                      </span>
                      <div className="flex-gap" style={{ gap: 10 }}>
                        {unreadCount > 0 && (
                          <button
                            onClick={handleMarkAllRead}
                            style={{ background: 'none', border: 'none', color: 'var(--gold-primary)', fontSize: '0.75rem', cursor: 'pointer', fontWeight: 700 }}
                          >
                            Mark all read
                          </button>
                        )}
                        <Link
                          to="/notifications"
                          onClick={() => setShowNotifDropdown(false)}
                          style={{ color: 'var(--gold-primary)', fontSize: '0.75rem', fontWeight: 600 }}
                        >
                          View All
                        </Link>
                      </div>
                    </div>

                    <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
                      {notifications.length === 0 ? (
                        <div className="empty-state" style={{ padding: '32px 12px' }}>
                          <div className="empty-state-icon" style={{ width: 60, height: 60, borderRadius: 20 }}>
                            <Bell size={26} />
                          </div>
                          <p style={{ margin: 0 }}>No notifications yet</p>
                        </div>
                      ) : (
                        notifications.map(notif => {
                          const Icon = getSeverityIcon(notif.severity);
                          const isUnread = !notif.isRead;
                          return (
                            <motion.div
                              key={notif.id}
                              className="notif-item-card"
                              onClick={() => handleNotifClick(notif)}
                              initial={{ opacity: 0, x: 14 }}
                              animate={{ opacity: 1, x: 0 }}
                              transition={{ duration: 0.3 }}
                              style={{ borderLeft: `3px solid ${isUnread ? getSeverityColor(notif.severity) : 'transparent'}` }}
                            >
                              <span style={{
                                width: 34, height: 34, borderRadius: 11, flexShrink: 0,
                                display: 'flex', alignItems: 'center', justifyContent: 'center',
                                background: 'var(--gold-dim)', color: getSeverityColor(notif.severity)
                              }}>
                                <Icon size={16} />
                              </span>
                              <div style={{ display: 'flex', flexDirection: 'column', gap: 2, flex: 1, minWidth: 0 }}>
                                <span style={{ fontSize: '0.75rem', fontWeight: isUnread ? 700 : 500, color: 'var(--text-primary)', lineHeight: 1.3 }}>
                                  {t(notif.titleKey, notif.messageParams)}
                                </span>
                                <span style={{ fontSize: '0.75rem', color: 'var(--text-secondary)', lineHeight: 1.3 }}>
                                  {t(notif.messageKey, notif.messageParams)}
                                </span>
                                <span style={{ fontSize: '0.75rem', color: 'var(--text-muted)', marginTop: 3 }}>
                                  {formatTimeAgo(notif.createdAt)}
                                </span>
                              </div>
                            </motion.div>
                          );
                        })
                      )}
                    </div>
                  </motion.div>
                </div>,
                document.body
              )}
            </AnimatePresence>
          </div>
        )}

        {/* Theme toggle */}
        <button
          onClick={toggleTheme}
          className="icon-btn"
          title={theme === 'dark' ? 'Switch to Light Mode' : 'Switch to Dark Mode'}
          aria-label="Toggle theme"
        >
          <motion.span
            key={theme}
            initial={{ rotate: -90, opacity: 0 }}
            animate={{ rotate: 0, opacity: 1 }}
            transition={{ duration: 0.35 }}
            style={{ display: 'inline-flex' }}
          >
            {theme === 'dark' ? <Sun size={17} style={{ color: 'var(--gold)' }} /> : <Moon size={17} style={{ color: 'var(--gold)' }} />}
          </motion.span>
        </button>

        {/* User */}
        {userName && (
          <div style={{ position: 'relative', display: 'flex', alignItems: 'center' }} ref={dropdownRef}>
            <button
              onClick={() => {
                setShowDropdown(!showDropdown);
                setConfirmLogout(false);
              }}
              className="icon-btn"
              style={{
                borderRadius: '50%',
                width: 42,
                height: 42,
                borderColor: showDropdown ? 'var(--gold-primary)' : 'rgba(247,201,72,0.3)',
                background: 'linear-gradient(135deg, rgba(247,201,72,0.22), rgba(255,255,255,0.06))',
                color: 'var(--gold-primary)',
                fontWeight: 800,
                fontSize: '0.875rem'
              }}
              title="Profile"
              aria-label="Profile"
            >
              {getInitials()}
            </button>

            <AnimatePresence>
              {showDropdown && createPortal(
                <div className="user-dropdown-overlay" onClick={() => { setShowDropdown(false); setConfirmLogout(false); }}>
                  <motion.div
                    className="user-dropdown-menu"
                    onClick={(e) => e.stopPropagation()}
                    initial={{ opacity: 0, y: -12, scale: 0.96 }}
                    animate={{ opacity: 1, y: 0, scale: 1 }}
                    exit={{ opacity: 0, y: -8, scale: 0.97 }}
                    transition={{ duration: 0.3, ease: [0.22, 1, 0.36, 1] }}
                  >
                    <div className="flex-between" style={{ borderBottom: '1px solid var(--border-soft)', paddingBottom: '12px' }}>
                      <div style={{ display: 'flex', alignItems: 'center', gap: 12, minWidth: 0 }}>
                        <span
                          style={{
                            width: 44, height: 44, borderRadius: '50%', flexShrink: 0,
                            display: 'flex', alignItems: 'center', justifyContent: 'center',
                            background: 'linear-gradient(135deg, rgba(247,201,72,0.3), rgba(255,255,255,0.08))',
                            border: '2px solid rgba(247,201,72,0.45)',
                            color: 'var(--gold-primary)', fontWeight: 800, fontSize: '1rem'
                          }}
                        >
                          {getInitials()}
                        </span>
                        <div style={{ minWidth: 0 }}>
                          <div style={{ fontSize: '1rem', fontWeight: 700, color: 'var(--text-primary)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{userName}</div>
                          <span className={`chip ${getRoleBadgeClass()}`} style={{ marginTop: 4, fontSize: '0.75rem', padding: '2px 8px' }}>
                            <BadgeCheck size={10} />
                            {getRoleName()}
                          </span>
                        </div>
                      </div>
                    </div>

                    {userRole === 'customer' && (
                      <button
                        onClick={() => { setShowDropdown(false); navigate('/profile'); }}
                        className="mobile-nav-item"
                        style={{ padding: '11px 14px' }}
                      >
                        <User size={16} />
                        <span style={{ fontSize: '0.875rem' }}>{t('nav.profile')}</span>
                      </button>
                    )}

                    {!confirmLogout ? (
                      <button
                        onClick={() => setConfirmLogout(true)}
                        className="btn btn-danger"
                        style={{ width: '100%', padding: '11px', fontSize: '0.875rem' }}
                      >
                        <LogOut size={15} />
                        <span>{t('nav.logout')}</span>
                      </button>
                    ) : (
                      <motion.div
                        initial={{ opacity: 0, y: 6 }}
                        animate={{ opacity: 1, y: 0 }}
                        style={{
                          display: 'flex', flexDirection: 'column', gap: 8,
                          background: 'var(--danger-bg)', padding: '12px',
                          borderRadius: '14px', border: '1px solid rgba(248,113,113,0.25)'
                        }}
                      >
                        <span style={{ fontSize: '0.75rem', color: 'var(--text-primary)', textAlign: 'center', fontWeight: 600 }}>
                          Are you sure you want to log out?
                        </span>
                        <div style={{ display: 'flex', gap: 8 }}>
                          <button onClick={handleLogout} className="btn btn-danger" style={{ flex: 1, padding: '8px', fontSize: '0.875rem' }}>
                            Yes, Logout
                          </button>
                          <button
                            onClick={() => setConfirmLogout(false)}
                            className="btn btn-secondary"
                            style={{ flex: 1, padding: '8px', fontSize: '0.875rem' }}
                          >
                            Cancel
                          </button>
                        </div>
                      </motion.div>
                    )}
                  </motion.div>
                </div>,
                document.body
              )}
            </AnimatePresence>
          </div>
        )}
      </div>
    </nav>
  );
}
