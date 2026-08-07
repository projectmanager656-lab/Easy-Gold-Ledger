import React, { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { motion } from 'framer-motion';
import { collection, onSnapshot, query, orderBy, limit } from 'firebase/firestore';
import { db } from '../services/firebase';
import { PageHeader, useGreeting } from '../components/PremiumUI';
import { ShieldCheck, Search, Clock, UserRound, Activity, Fingerprint } from 'lucide-react';

export default function AuditLogs() {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const greeting = useGreeting();
  const [role] = useState(localStorage.getItem('user_role') || 'employee');

  const [logs, setLogs] = useState([]);
  const [searchQuery, setSearchQuery] = useState('');
  
  // Mapping collections for ID resolution
  const [userMap, setUserMap] = useState({});
  const [loanMap, setLoanMap] = useState({});

  // Bounce unauthorized roles back to dashboard
  useEffect(() => {
    if (role !== 'super_admin') {
      navigate('/dashboard');
    }
  }, [role, navigate]);

  useEffect(() => {
    if (role !== 'super_admin') return;

    // 1. Fetch users mapping (UID -> { name, email, phone })
    // NOTE: Every customer is also saved in users, so we can resolve both customers and staff here!
    const unsubUsers = onSnapshot(collection(db, 'users'), (snap) => {
      const mapping = {};
      snap.docs.forEach(doc => {
        const data = doc.data();
        mapping[doc.id] = {
          name: data.name || data.email || doc.id,
          email: data.email || '',
          phone: data.phone || ''
        };
      });
      setUserMap(mapping);
    });

    // 2. Fetch loans mapping (ID -> CustomerID)
    const unsubLoans = onSnapshot(collection(db, 'loans'), (snap) => {
      const mapping = {};
      snap.docs.forEach(doc => {
        const data = doc.data();
        mapping[doc.id] = data.customerId;
      });
      setLoanMap(mapping);
    });

    // 3. Fetch 100 recent audit logs
    const q = query(collection(db, 'audit_logs'), orderBy('timestamp', 'desc'), limit(100));
    const unsubLogs = onSnapshot(q, (snap) => {
      const list = snap.docs.map(doc => ({
        id: doc.id,
        ...doc.data(),
        timestamp: doc.data().timestamp?.toDate() || new Date()
      }));
      setLogs(list);
    });

    return () => {
      unsubUsers();
      unsubLoans();
      unsubLogs();
    };
  }, [role]);

  const getCustomerInfo = (log) => {
    // If the entity itself is a customer or user (staff)
    if ((log.entityType === 'customers' || log.entityType === 'users') && userMap[log.entityId]) {
      const u = userMap[log.entityId];
      return `${u.name} (${u.phone || 'N/A'})`;
    }
    // If the entity is a loan, resolve customerId from loanMap
    if (log.entityType === 'loans' && loanMap[log.entityId]) {
      const custId = loanMap[log.entityId];
      const u = userMap[custId];
      if (u) {
        return `${u.name} (${u.phone || 'N/A'})`;
      }
    }
    // If the entity is a payment, resolve loanId -> customerId
    if (log.entityType === 'payments') {
      let loanId = '';
      try {
        if (log.newValue) {
          const parsed = JSON.parse(log.newValue);
          loanId = parsed.loanId || '';
        }
      } catch (e) {}
      if (loanId && loanMap[loanId]) {
        const custId = loanMap[loanId];
        const u = userMap[custId];
        if (u) {
          return `${u.name} (${u.phone || 'N/A'})`;
        }
      }
    }
    return '';
  };

  const filteredLogs = logs.filter(log => {
    const q = searchQuery.toLowerCase();
    const employeeName = log.userId === 'system' ? 'system' : (userMap[log.userId]?.name || '').toLowerCase();
    const customerNameAndPhone = getCustomerInfo(log).toLowerCase();
    
    return (
      log.action?.toLowerCase().includes(q) ||
      log.userId?.toLowerCase().includes(q) ||
      employeeName.includes(q) ||
      customerNameAndPhone.includes(q) ||
      log.entityId?.toLowerCase().includes(q) ||
      log.entityType?.toLowerCase().includes(q)
    );
  });

  const roleBadgeClass = (roleName) => {
    if (roleName === 'super_admin') return 'badge-closed';
    if (roleName === 'admin') return 'badge-open';
    if (roleName === 'employee') return 'badge-forfeited';
    if (roleName === 'customer') return 'badge-inactive';
    return 'badge-open';
  };

  return (
    <div className="app-container">
      <main className="main-content">

        {/* Header */}
        <PageHeader
          eyebrow={greeting}
          title={t('audit.title')}
          subtitle={t('audit.subtitle')}
          actions={
            <span className="customer-count-chip" style={{ alignSelf: 'center' }}>
              <ShieldCheck size={14} />
              SECURITY TRAIL
            </span>
          }
        />

        {/* Filter */}
        <motion.div
          className="glass-panel"
          style={{ padding: '18px', marginBottom: '24px' }}
          initial={{ opacity: 0, y: 16 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.5, ease: [0.22, 1, 0.36, 1] }}
        >
          <div className="flex-between" style={{ gap: 16, flexWrap: 'wrap' }}>
            <div className="search-field" style={{ flex: 1, minWidth: 240, maxWidth: 440 }}>
              <Search size={18} />
              <input
                type="text"
                placeholder={t('audit.search')}
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
              />
            </div>
            <span className="customer-count-chip">
              <Activity size={14} />
              {filteredLogs.length} {t('audit.title')}
            </span>
          </div>
        </motion.div>

        {/* Table of logs */}
        <motion.div
          className="glass-panel"
          style={{ padding: '24px' }}
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.55, delay: 0.08, ease: [0.22, 1, 0.36, 1] }}
        >
          <div className="table-container responsive-table-card">
            <table>
              <thead>
                <tr>
                  <th>{t('audit.timestamp')}</th>
                  <th>{t('audit.who')}</th>
                  <th>{t('audit.role')}</th>
                  <th>{t('audit.action')}</th>
                  <th>{t('audit.entityId')}</th>
                </tr>
              </thead>
              <tbody>
                {filteredLogs.length === 0 ? (
                  <tr>
                    <td colSpan="5" style={{ textAlign: 'center', color: 'var(--text-2)', padding: '32px' }}>
                      {t('common.noRecords')}
                    </td>
                  </tr>
                ) : (
                  filteredLogs.map((log, idx) => {
                    const custDetails = getCustomerInfo(log);
                    return (
                      <motion.tr
                        key={log.id}
                        className="table-row-glow"
                        initial={{ opacity: 0, x: -12 }}
                        animate={{ opacity: 1, x: 0 }}
                        transition={{ duration: 0.35, delay: idx * 0.03, ease: [0.22, 1, 0.36, 1] }}
                      >
                        <td data-label={t('audit.timestamp')} style={{ fontSize: '0.875rem' }}>
                          <div style={{ display: 'flex', alignItems: 'center', gap: '8px', color: 'var(--text-2)' }}>
                            <Clock size={12} />
                            <span>{log.timestamp.toLocaleString()}</span>
                          </div>
                        </td>
                        <td data-label={t('audit.who')} style={{ fontSize: '0.875rem', fontWeight: 500 }}>
                          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                            <span className="avatar avatar-sm avatar-fallback" style={{ width: 26, height: 26, fontSize: '0.75rem' }}>
                              {log.userId === 'system' ? <Fingerprint size={13} /> : <UserRound size={13} />}
                            </span>
                            {log.userId === 'system' ? 'System' : (userMap[log.userId]?.name || log.userId)}
                          </div>
                        </td>
                        <td data-label={t('audit.role')}>
                          <span className={`badge ${roleBadgeClass(log.role)}`} style={{ fontSize: '0.75rem' }}>
                            {log.role}
                          </span>
                        </td>
                        <td data-label={t('audit.action')} style={{ fontWeight: 600, color: 'var(--gold)' }}>
                          {log.action.replace(/_/g, ' ').toUpperCase()}
                        </td>
                        <td className="audit-entity-cell" data-label={t('audit.entityId')} style={{ fontSize: '0.875rem' }}>
                          <div style={{ display: 'flex', flexDirection: 'column' }}>
                            <span style={{ fontWeight: 600, textTransform: 'uppercase', fontSize: '0.75rem', letterSpacing: '0.05em' }}>
                              {log.entityType}
                            </span>
                            {custDetails && (
                              <span style={{ color: 'var(--gold)', fontWeight: 500, fontSize: '0.75rem', marginTop: '2px' }}>
                                {custDetails}
                              </span>
                            )}
                            <span style={{ color: 'var(--text-3)', fontSize: '0.75rem', marginTop: '1px' }}>
                              Ref: {log.entityId}
                            </span>
                          </div>
                        </td>
                      </motion.tr>
                    );
                  })
                )}
              </tbody>
            </table>
          </div>
        </motion.div>

      </main>
    </div>
  );
}
