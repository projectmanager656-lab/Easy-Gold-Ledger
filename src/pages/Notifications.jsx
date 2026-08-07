import React, { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { motion } from 'framer-motion';
import { collection, query, where, onSnapshot, doc, writeBatch, deleteDoc } from 'firebase/firestore';
import { auth, db } from '../services/firebase';
import { PageHeader, EmptyState, GoldButton, useGreeting } from '../components/PremiumUI';
import {
  Bell,
  Search,
  Check,
  Trash2,
  Info,
  AlertTriangle,
  AlertCircle,
  Filter,
  MailCheck,
  Hash
} from 'lucide-react';

export default function Notifications() {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const greeting = useGreeting();

  // Loading and State
  const [loading, setLoading] = useState(true);
  const [notifications, setNotifications] = useState([]);
  const [searchQuery, setSearchQuery] = useState('');
  
  // Filters state
  const [statusFilter, setStatusFilter] = useState('all'); // 'all' | 'unread' | 'read'
  const [severityFilter, setSeverityFilter] = useState('all'); // 'all' | 'info' | 'warning' | 'critical'
  const [typeFilter, setTypeFilter] = useState('all'); // 'all' | 'new_loan' | 'payment_received' | 'threshold_alert' | 'rate_updated' | 'account_status' | 'loan_closed' | 'loan_forfeited'

  // Fetch notifications for active user
  useEffect(() => {
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
            ...doc.data(),
            createdAtDate: doc.data().createdAt?.toDate() || new Date()
          })).sort((a, b) => {
            const timeA = a.createdAtDate ? a.createdAtDate.getTime() : 0;
            const timeB = b.createdAtDate ? b.createdAtDate.getTime() : 0;
            return timeB - timeA;
          });
          setNotifications(list);
          setLoading(false);
        }, (err) => {
          console.error("Error fetching notifications list:", err);
          setLoading(false);
        });
      } else {
        setNotifications([]);
        setLoading(false);
      }
    });

    return () => {
      unsubscribeAuth();
      if (unsubscribeSnap) unsubscribeSnap();
    };
  }, []);

  // Format relative time
  const formatTimeAgo = (date) => {
    if (!date) return '';
    const seconds = Math.floor((new Date() - date) / 1000);
    if (seconds < 60) return t('common.justNow') || 'just now';
    const minutes = Math.floor(seconds / 60);
    if (minutes < 60) return `${minutes}m ago`;
    const hours = Math.floor(minutes / 60);
    if (hours < 24) return `${hours}h ago`;
    const days = Math.floor(hours / 24);
    return `${days}d ago`;
  };

  // Get icons and colors based on severity
  const getSeverityStyle = (severity) => {
    switch (severity) {
      case 'critical':
        return {
          icon: AlertCircle,
          color: 'var(--danger)',
          bg: 'rgba(248, 113, 113, 0.12)',
          border: 'rgba(248, 113, 113, 0.3)'
        };
      case 'warning':
        return {
          icon: AlertTriangle,
          color: 'var(--warning)',
          bg: 'rgba(251, 191, 36, 0.12)',
          border: 'rgba(251, 191, 36, 0.3)'
        };
      default:
        return {
          icon: Info,
          color: 'var(--gold)',
          bg: 'rgba(247, 201, 72, 0.1)',
          border: 'rgba(247, 201, 72, 0.28)'
        };
    }
  };

  // Handle single notification mark as read
  const handleMarkAsRead = async (notifId) => {
    try {
      const ref = doc(db, 'notifications', notifId);
      const batch = writeBatch(db);
      batch.update(ref, { isRead: true });
      await batch.commit();
    } catch (error) {
      console.error("Error marking notification as read:", error);
    }
  };

  // Handle delete single notification
  const handleDeleteNotif = async (notifId, e) => {
    e.stopPropagation();
    try {
      await deleteDoc(doc(db, 'notifications', notifId));
    } catch (error) {
      console.error("Error deleting notification:", error);
    }
  };

  // Handle mark all read
  const handleMarkAllRead = async () => {
    try {
      const batch = writeBatch(db);
      notifications.forEach(n => {
        if (!n.isRead) {
          const ref = doc(db, 'notifications', n.id);
          batch.update(ref, { isRead: true });
        }
      });
      await batch.commit();
    } catch (error) {
      console.error("Error marking all read:", error);
    }
  };

  // Handle notification click (Mark read + navigate to loan if present)
  const handleNotifClick = async (notif) => {
    if (!notif.isRead) {
      await handleMarkAsRead(notif.id);
    }
    if (notif.loanId) {
      navigate(`/loans?id=${notif.loanId}`);
    }
  };

  // Filter Logic
  const filteredNotifications = notifications.filter(n => {
    // 1. Text Search Filter
    const q = searchQuery.toLowerCase();
    const titleText = t(n.titleKey, n.messageParams || {}).toLowerCase();
    const messageText = t(n.messageKey, n.messageParams || {}).toLowerCase();
    const matchesSearch = titleText.includes(q) || messageText.includes(q);

    // 2. Status Filter
    let matchesStatus = true;
    if (statusFilter === 'unread') matchesStatus = !n.isRead;
    if (statusFilter === 'read') matchesStatus = n.isRead;

    // 3. Severity Filter
    let matchesSeverity = true;
    if (severityFilter !== 'all') matchesSeverity = n.severity === severityFilter;

    // 4. Type Filter
    let matchesType = true;
    if (typeFilter !== 'all') {
      if (typeFilter === 'loans') {
        matchesType = n.type === 'new_loan' || n.type === 'loan_closed' || n.type === 'loan_forfeited';
      } else {
        matchesType = n.type === typeFilter;
      }
    }

    return matchesSearch && matchesStatus && matchesSeverity && matchesType;
  });

  const unreadCount = notifications.filter(n => !n.isRead).length;

  return (
    <div className="app-container customer-notifications-page">
      <main className="main-content">

        {/* Header */}
        <PageHeader
          eyebrow={greeting}
          title={t('common.notifications') || 'Notifications'}
          subtitle="Manage and view store alerts, gold rate shifts, and loan repayment receipts."
          actions={
            unreadCount > 0 && (
              <GoldButton onClick={handleMarkAllRead}>
                <MailCheck size={18} />
                <span>Mark All as Read</span>
              </GoldButton>
            )
          }
        />

        {/* Filter bar */}
        <motion.div
          className="glass-panel"
          style={{ padding: '24px', marginBottom: '24px' }}
          initial={{ opacity: 0, y: 16 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.5, ease: [0.22, 1, 0.36, 1] }}
        >
          <div style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>
            {/* Search Input */}
            <div className="search-field" style={{ width: '100%' }}>
              <Search size={18} />
              <input
                type="text"
                placeholder="Search alerts by details..."
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
              />
            </div>

            {/* Filter Pill Tabs */}
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: '12px' }}>
              <div className="tab-pills">
                <button
                  onClick={() => setStatusFilter('all')}
                  className={`pill ${statusFilter === 'all' ? 'active' : ''}`}
                >
                  All ({notifications.length})
                </button>
                <button
                  onClick={() => setStatusFilter('unread')}
                  className={`pill ${statusFilter === 'unread' ? 'active' : ''}`}
                >
                  Unread ({unreadCount})
                </button>
                <button
                  onClick={() => setStatusFilter('read')}
                  className={`pill ${statusFilter === 'read' ? 'active' : ''}`}
                >
                  Read ({notifications.length - unreadCount})
                </button>
              </div>

              {/* Advanced select filters */}
              <div style={{ display: 'flex', gap: '12px', flexWrap: 'wrap' }}>
                {/* Severity select */}
                <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                  <Filter size={14} style={{ color: 'var(--text-3)' }} />
                  <select
                    value={severityFilter}
                    onChange={(e) => setSeverityFilter(e.target.value)}
                    style={{ width: 'auto', padding: '8px 12px', fontSize: '0.875rem', cursor: 'pointer' }}
                  >
                    <option value="all">All Severities</option>
                    <option value="info">Info</option>
                    <option value="warning">Warning</option>
                    <option value="critical">Critical</option>
                  </select>
                </div>

                {/* Type select */}
                <select
                  value={typeFilter}
                  onChange={(e) => setTypeFilter(e.target.value)}
                  style={{ width: 'auto', padding: '8px 12px', fontSize: '0.875rem', cursor: 'pointer' }}
                >
                  <option value="all">All Event Types</option>
                  <option value="loans">Gold Loans (New/Closed/Forfeited)</option>
                  <option value="payment_received">Repayments</option>
                  <option value="threshold_alert">Interest Thresholds</option>
                  <option value="rate_updated">Metal Rate Updates</option>
                  <option value="account_status">Account Status Changes</option>
                </select>
              </div>
            </div>
          </div>
        </motion.div>

        {/* Notifications list */}
        <div style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
          {loading ? (
            <motion.div
              className="glass-panel"
              style={{ padding: '48px', textAlign: 'center', color: 'var(--text-2)' }}
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
            >
              <span style={{ display: 'inline-block', width: 26, height: 26, border: '2px solid var(--border-soft)', borderTopColor: 'var(--gold)', borderRadius: '50%', animation: 'spin 0.8s linear infinite', verticalAlign: '-4px', marginRight: 10 }} />
              <span>Loading notifications...</span>
            </motion.div>
          ) : filteredNotifications.length === 0 ? (
            <EmptyState
              icon={<Bell size={34} />}
              title={t('common.notifications') || 'Notifications'}
              message={notifications.length === 0
                ? 'You have no notifications yet. Alerts and receipts will appear here.'
                : 'No notifications matched selected filters.'}
            />
          ) : (
            filteredNotifications.map((notif, idx) => {
              const { icon: SeverityIcon, color: severityColor, bg: severityBg, border: severityBorder } = getSeverityStyle(notif.severity);
              const isUnread = !notif.isRead;

              return (
                <motion.div
                  key={notif.id}
                  onClick={() => handleNotifClick(notif)}
                  className="glass-panel notif-card"
                  style={{
                    padding: '18px 20px',
                    display: 'flex',
                    alignItems: 'flex-start',
                    gap: '16px',
                    cursor: 'pointer',
                    borderLeft: `4px solid ${isUnread ? severityColor : 'transparent'}`,
                    background: isUnread
                      ? 'linear-gradient(90deg, rgba(247,201,72,0.05), rgba(9,9,9,0.35))'
                      : 'var(--card)'
                  }}
                  initial={{ opacity: 0, y: 16 }}
                  animate={{ opacity: 1, y: 0 }}
                  transition={{ duration: 0.45, delay: idx * 0.05, ease: [0.22, 1, 0.36, 1] }}
                  whileHover={{ y: -3 }}
                >
                  {/* Icon */}
                  <div style={{
                    background: severityBg,
                    padding: '11px',
                    borderRadius: '50%',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    color: severityColor,
                    flexShrink: 0,
                    border: `1px solid ${severityBorder}`
                  }}>
                    <SeverityIcon size={20} />
                  </div>

                  {/* Body Content */}
                  <div style={{ flex: 1, display: 'flex', flexDirection: 'column', gap: '5px', textAlign: 'left' }}>
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 10 }}>
                      <span style={{ fontWeight: isUnread ? 700 : 600, fontSize: '1rem' }}>
                        {t(notif.titleKey, notif.messageParams || {})}
                      </span>
                      <span style={{ fontSize: '0.75rem', color: 'var(--text-3)', whiteSpace: 'nowrap' }}>
                        {formatTimeAgo(notif.createdAtDate)}
                      </span>
                    </div>
                    <p style={{ fontSize: '0.875rem', color: 'var(--text-2)', lineHeight: '1.5', margin: 0 }}>
                      {t(notif.messageKey, notif.messageParams || {})}
                    </p>

                    {/* Sub-tag badge */}
                    <div style={{ display: 'flex', gap: '8px', marginTop: '8px' }}>
                      <span className="notif-tag" style={{ color: severityColor, background: severityBg, border: `1px solid ${severityBorder}` }}>
                        {notif.severity}
                      </span>
                      {notif.loanId && (
                        <span className="notif-tag" style={{ color: 'var(--gold)', background: 'rgba(247,201,72,0.08)', border: '1px solid rgba(247,201,72,0.28)' }}>
                          <Hash size={11} style={{ verticalAlign: '-2px', marginRight: 3 }} />
                          Loan #{notif.loanId}
                        </span>
                      )}
                    </div>
                  </div>

                  {/* Actions */}
                  <div style={{ display: 'flex', gap: '8px', marginLeft: '12px' }} onClick={e => e.stopPropagation()}>
                    {isUnread && (
                      <button
                        onClick={() => handleMarkAsRead(notif.id)}
                        className="btn btn-secondary"
                        style={{ padding: '8px', minWidth: 'auto', borderRadius: '50%' }}
                        title="Mark as Read"
                      >
                        <Check size={14} style={{ color: '#10b981' }} />
                      </button>
                    )}
                    <button
                      onClick={(e) => handleDeleteNotif(notif.id, e)}
                      className="btn btn-danger"
                      style={{ padding: '8px', minWidth: 'auto', borderRadius: '50%', background: 'rgba(239, 68, 68, 0.1)', borderColor: 'rgba(239, 68, 68, 0.2)' }}
                      title="Delete Notification"
                    >
                      <Trash2 size={14} style={{ color: 'var(--danger)' }} />
                    </button>
                  </div>

                </motion.div>
              );
            })
          )}
        </div>

      </main>
    </div>
  );
}
