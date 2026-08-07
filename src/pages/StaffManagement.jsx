import React, { useState, useEffect } from 'react';
import { useTranslation } from 'react-i18next';
import { motion, AnimatePresence } from 'framer-motion';
import { collection, query, where, onSnapshot } from 'firebase/firestore';
import { db } from '../services/firebase';
import { registerStaffUser, updateUserStatus, updateStaffUser } from '../services/firebaseService';
import { PageHeader, FadeScale, GoldButton, useGreeting } from '../components/PremiumUI';
import {
  UserPlus, Search, Shield, ShieldAlert, CheckCircle, XCircle, RefreshCw,
  Eye, EyeOff, UserRound, KeyRound, Users, Pencil, Power
} from 'lucide-react';

export default function StaffManagement() {
  const { t } = useTranslation();
  const greeting = useGreeting();

  // Loading States
  const [loading, setLoading] = useState(true);
  const [actionLoading, setActionLoading] = useState(false);

  // Data State
  const [staffList, setStaffList] = useState([]);
  const [searchQuery, setSearchQuery] = useState('');

  // Add Form Modal/Panel State
  const [showAddForm, setShowAddForm] = useState(false);
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [phone, setPhone] = useState('');
  const [password, setPassword] = useState('');
  const [role, setRole] = useState('employee'); // 'employee' | 'super_admin'
  const [showPasswordInput, setShowPasswordInput] = useState(false);
  
  // Edit mode tracking
  const [editingStaffId, setEditingStaffId] = useState(null);
  const [oldEmail, setOldEmail] = useState('');
  const [oldPassword, setOldPassword] = useState('');

  // Table password visibility state
  const [visiblePasswords, setVisiblePasswords] = useState({});

  // Messages
  const [errorMsg, setErrorMsg] = useState('');
  const [successMsg, setSuccessMsg] = useState('');

  const togglePasswordVisibility = (id) => {
    setVisiblePasswords(prev => ({
      ...prev,
      [id]: !prev[id]
    }));
  };

  const handleEditClick = (staff) => {
    setName(staff.name || '');
    setEmail(staff.email || '');
    setPhone(staff.phone || '');
    setPassword(staff.password || '');
    setRole(staff.role || 'employee');
    setOldEmail(staff.email || '');
    setOldPassword(staff.password || '');
    setEditingStaffId(staff.id);
    setShowAddForm(true);
    // Scroll to the top of the window
    window.scrollTo({ top: 0, behavior: 'smooth' });
  };

  // Fetch employees and admins on mount
  useEffect(() => {
    // Fetch all users with roles 'employee' or 'super_admin'
    const q = query(
      collection(db, 'users'),
      where('role', 'in', ['employee', 'super_admin'])
    );

    const unsubscribe = onSnapshot(q, (snap) => {
      const list = snap.docs.map(doc => ({
        id: doc.id,
        ...doc.data()
      }));
      // Sort: super_admins first, then employees, then by name
      list.sort((a, b) => {
        if (a.role === b.role) {
          return (a.name || '').localeCompare(b.name || '');
        }
        return a.role === 'super_admin' ? -1 : 1;
      });
      setStaffList(list);
      setLoading(false);
    }, (err) => {
      console.error('Error fetching staff list:', err);
      setErrorMsg('Failed to load staff accounts.');
      setLoading(false);
    });

    return unsubscribe;
  }, []);

  // Form Submit Action
  const handleAddStaff = async (e) => {
    e.preventDefault();
    setErrorMsg('');
    setSuccessMsg('');

    if (!name || !email || !phone || !password || !role) {
      setErrorMsg('All fields are required.');
      return;
    }

    setActionLoading(true);

    try {
      if (editingStaffId) {
        // Edit Mode
        await updateStaffUser(editingStaffId, {
          name,
          email,
          phone,
          password,
          role
        }, oldEmail, oldPassword);
        setSuccessMsg('Staff details updated successfully!');
      } else {
        // Add Mode
        await registerStaffUser({
          name,
          email,
          phone,
          password,
          role
        });
        setSuccessMsg(t('staff.saveSuccess') || 'Staff registered successfully!');
      }
      
      // Reset fields
      setName('');
      setEmail('');
      setPhone('');
      setPassword('');
      setRole('employee');
      setEditingStaffId(null);
      setOldEmail('');
      setOldPassword('');

      // Close panel after 1.5s
      setTimeout(() => {
        setShowAddForm(false);
        setSuccessMsg('');
      }, 1500);
    } catch (err) {
      console.error('Error saving staff member:', err);
      setErrorMsg(err.message || 'Failed to save staff account.');
    } finally {
      setActionLoading(false);
    }
  };

  // Toggle status (Active / Inactive)
  const handleToggleStatus = async (uid, currentStatus) => {
    setErrorMsg('');
    const newStatus = currentStatus === 'active' ? 'inactive' : 'active';
    
    // Confirm deactivating super admin
    const targetUser = staffList.find(u => u.id === uid);
    if (targetUser && targetUser.role === 'super_admin' && newStatus === 'inactive') {
      const confirmed = window.confirm('Warning: Deactivating a Super Admin account might lock them out. Do you want to proceed?');
      if (!confirmed) return;
    }

    try {
      await updateUserStatus(uid, newStatus);
    } catch (err) {
      console.error('Error updating status:', err);
      setErrorMsg('Failed to update account status.');
    }
  };

  // Filter staff by search query
  const filteredStaff = staffList.filter((s) => {
    const term = searchQuery.toLowerCase();
    return (
      (s.name || '').toLowerCase().includes(term) ||
      (s.email || '').toLowerCase().includes(term) ||
      (s.phone || '').includes(term)
    );
  });

  const adminCount = staffList.filter(s => s.role === 'super_admin').length;
  const activeCount = staffList.filter(s => s.status === 'active').length;

  return (
    <div className="app-container">
      <main className="main-content">

        {/* Header section */}
        <PageHeader
          eyebrow={greeting}
          title={t('staff.title') || 'Shop Staff Management'}
          subtitle="Create and manage login accounts for shop employees and administrator roles."
          actions={
            <GoldButton
              onClick={() => {
                if (showAddForm) {
                  // Reset form fields
                  setName('');
                  setEmail('');
                  setPhone('');
                  setPassword('');
                  setRole('employee');
                  setEditingStaffId(null);
                  setOldEmail('');
                  setOldPassword('');
                }
                setShowAddForm(!showAddForm);
                setErrorMsg('');
                setSuccessMsg('');
              }}
            >
              <UserPlus size={18} />
              <span>{showAddForm ? t('common.close') : t('staff.addNew') || 'Add New Staff'}</span>
            </GoldButton>
          }
        />

        {/* Global Notifications */}
        <AnimatePresence>
          {errorMsg && (
            <FadeScale>
              <div className="alert-banner alert-critical" style={{ marginBottom: '24px' }}>
                <XCircle size={18} />
                <span>{errorMsg}</span>
              </div>
            </FadeScale>
          )}
          {successMsg && (
            <FadeScale>
              <div className="alert-banner alert-info" style={{ marginBottom: '24px' }}>
                <CheckCircle size={18} />
                <span>{successMsg}</span>
              </div>
            </FadeScale>
          )}
        </AnimatePresence>

        {/* Add Staff form */}
        <AnimatePresence>
          {showAddForm && (
            <motion.div
              key="add-form"
              initial={{ opacity: 0, y: 22, scale: 0.99 }}
              animate={{ opacity: 1, y: 0, scale: 1 }}
              exit={{ opacity: 0, y: -10, scale: 0.99 }}
              transition={{ duration: 0.45, ease: [0.22, 1, 0.36, 1] }}
            >
              <div className="glass-panel" style={{ padding: '32px', marginBottom: '28px' }}>
                <div className="flex-between" style={{ marginBottom: '24px' }}>
                  <h3 className="serif-title" style={{ margin: 0, fontSize: '1.25rem', display: 'flex', alignItems: 'center', gap: 10 }}>
                    <span className="metal-coin" style={{ width: 34, height: 34 }}>
                      {editingStaffId ? <Pencil size={16} /> : <UserPlus size={16} />}
                    </span>
                    {editingStaffId ? 'Edit Staff User Details' : (t('staff.addNew') || 'Add New Staff User')}
                  </h3>
                  {editingStaffId && (
                    <span className="customer-count-chip">
                      <KeyRound size={13} />
                      EDIT MODE
                    </span>
                  )}
                </div>

                <form onSubmit={handleAddStaff} style={{ display: 'flex', flexDirection: 'column', gap: '18px' }}>
                  <div className="grid-cols-2">
                    <div className="form-group">
                      <label>{t('staff.fullName') || 'Full Name'}</label>
                      <input
                        type="text"
                        placeholder="e.g. Rahul Sharma"
                        value={name}
                        onChange={(e) => setName(e.target.value)}
                        required
                      />
                    </div>
                    <div className="form-group">
                      <label>{t('staff.phone') || 'Phone Number'}</label>
                      <input
                        type="tel"
                        placeholder="e.g. +919876543210"
                        value={phone}
                        onChange={(e) => setPhone(e.target.value)}
                        required
                      />
                    </div>
                  </div>

                  <div className="grid-cols-2">
                    <div className="form-group">
                      <label>{t('staff.email') || 'Email Address'}</label>
                      <input
                        type="email"
                        placeholder="e.g. rahul@example.com"
                        value={email}
                        onChange={(e) => setEmail(e.target.value)}
                        required
                      />
                    </div>
                    <div className="form-group">
                      <label>{t('staff.password') || 'Password'}</label>
                      <div style={{ position: 'relative', display: 'flex', alignItems: 'center' }}>
                        <input
                          type={showPasswordInput ? "text" : "password"}
                          placeholder="Set login password (min 6 characters)"
                          value={password}
                          onChange={(e) => setPassword(e.target.value)}
                          required
                          minLength={6}
                          style={{ paddingRight: '48px', width: '100%' }}
                        />
                        <button
                          type="button"
                          onClick={() => setShowPasswordInput(!showPasswordInput)}
                          style={{
                            position: 'absolute',
                            right: '14px',
                            background: 'none',
                            border: 'none',
                            cursor: 'pointer',
                            color: 'var(--text-3)',
                            display: 'flex',
                            alignItems: 'center',
                            justifyContent: 'center',
                            padding: '4px'
                          }}
                        >
                          {showPasswordInput ? <EyeOff size={18} /> : <Eye size={18} />}
                        </button>
                      </div>
                    </div>
                  </div>

                  <div className="grid-cols-2" style={{ alignItems: 'flex-end' }}>
                    <div className="form-group">
                      <label>{t('staff.role') || 'User Role'}</label>
                      <select value={role} onChange={(e) => setRole(e.target.value)}>
                        <option value="employee">{t('staff.roleEmployee') || 'Shop Employee'}</option>
                        <option value="super_admin">{t('staff.roleAdmin') || 'Super Admin'}</option>
                      </select>
                      <p style={{ fontSize: '0.75rem', color: 'var(--text-3)', marginTop: 8, display: 'flex', alignItems: 'center', gap: 6 }}>
                        {role === 'super_admin'
                          ? <><ShieldAlert size={12} /> Full system access including rates, staff & audit logs.</>
                          : <><Shield size={12} /> Limited access to customer & loan operations.</>}
                      </p>
                    </div>
                    <div className="form-group" style={{ marginBottom: 0 }}>
                      <GoldButton
                        type="submit"
                        style={{ width: '100%', padding: '13px' }}
                        disabled={actionLoading}
                      >
                        {actionLoading ? (
                          <RefreshCw className="animate-spin" size={18} />
                        ) : editingStaffId ? (
                          <><Pencil size={16} /> Save Changes</>
                        ) : (
                          <><UserPlus size={16} /> Complete Registration</>
                        )}
                      </GoldButton>
                    </div>
                  </div>
                </form>
              </div>
            </motion.div>
          )}
        </AnimatePresence>

        {/* Staff Table registry */}
        <motion.div
          className="glass-panel"
          style={{ padding: '24px' }}
          initial={{ opacity: 0, y: 18 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.55, delay: 0.06, ease: [0.22, 1, 0.36, 1] }}
        >

          {/* Search bar */}
          <div className="flex-between" style={{ marginBottom: '16px', gap: 16, flexWrap: 'wrap' }}>
            <div className="search-field" style={{ flex: 1, minWidth: 240, maxWidth: 420 }}>
              <Search size={18} />
              <input
                type="text"
                placeholder={t('staff.searchPlaceholder') || 'Search by name or email...'}
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
              />
            </div>
            <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
              <span className="customer-count-chip">
                <Users size={13} />
                {staffList.length} TOTAL
              </span>
              <span className="customer-count-chip">
                <Shield size={13} />
                {adminCount} ADMIN
              </span>
              <span className="customer-count-chip">
                <CheckCircle size={13} />
                {activeCount} ACTIVE
              </span>
            </div>
          </div>

          <div className="table-container responsive-table-card">
            <table>
              <thead>
                <tr>
                  <th>{t('staff.fullName') || 'Full Name'}</th>
                  <th>{t('staff.email') || 'Email'}</th>
                  <th>{t('staff.phone') || 'Phone'}</th>
                  <th>{t('staff.password') || 'Password'}</th>
                  <th>{t('staff.role') || 'Role'}</th>
                  <th>{t('common.status') || 'Status'}</th>
                  <th style={{ textAlign: 'right' }}>{t('common.actions') || 'Actions'}</th>
                </tr>
              </thead>
              <tbody>
                {loading ? (
                  <tr>
                    <td colSpan="7" style={{ textAlign: 'center', color: 'var(--text-2)', padding: '32px' }}>
                      <span style={{ display: 'inline-block', width: 22, height: 22, border: '2px solid var(--border-soft)', borderTopColor: 'var(--gold)', borderRadius: '50%', animation: 'spin 0.8s linear infinite', verticalAlign: '-4px', marginRight: 10 }} />
                      <span>{t('common.loading')}</span>
                    </td>
                  </tr>
                ) : filteredStaff.length === 0 ? (
                  <tr>
                    <td colSpan="7" style={{ textAlign: 'center', color: 'var(--text-2)', padding: '32px' }}>
                      {t('common.noRecords')}
                    </td>
                  </tr>
                ) : (
                  filteredStaff.map((staff, idx) => (
                    <motion.tr
                      key={staff.id}
                      className="table-row-glow"
                      initial={{ opacity: 0, x: -12 }}
                      animate={{ opacity: 1, x: 0 }}
                      transition={{ duration: 0.35, delay: idx * 0.03, ease: [0.22, 1, 0.36, 1] }}
                    >
                      <td data-label={t('staff.fullName') || 'Full Name'} style={{ fontWeight: 600 }}>
                        <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                          <span className="avatar avatar-sm avatar-fallback" style={{ width: 30, height: 30 }}>
                            <UserRound size={14} />
                          </span>
                          {staff.name}
                        </div>
                      </td>
                      <td data-label={t('staff.email') || 'Email'} style={{ color: 'var(--text-2)' }}>{staff.email}</td>
                      <td data-label={t('staff.phone') || 'Phone'} style={{ color: 'var(--text-2)' }}>{staff.phone}</td>
                      <td data-label={t('staff.password') || 'Password'}>
                        <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                          <span style={{ fontFamily: 'monospace', letterSpacing: '0.05em', fontSize: '0.875rem' }}>
                            {visiblePasswords[staff.id] ? (staff.password || '—') : '••••••'}
                          </span>
                          {staff.password && (
                            <button
                              type="button"
                              onClick={() => togglePasswordVisibility(staff.id)}
                              style={{
                                background: 'none',
                                border: 'none',
                                padding: '4px',
                                cursor: 'pointer',
                                display: 'inline-flex',
                                alignItems: 'center',
                                color: 'var(--text-3)',
                                transition: 'color 0.2s'
                              }}
                              onMouseEnter={(e) => (e.currentTarget.style.color = 'var(--gold)')}
                              onMouseLeave={(e) => (e.currentTarget.style.color = 'var(--text-3)')}
                            >
                              {visiblePasswords[staff.id] ? <EyeOff size={14} /> : <Eye size={14} />}
                            </button>
                          )}
                        </div>
                      </td>
                      <td data-label={t('staff.role') || 'Role'}>
                        <span className={`metal-chip ${staff.role === 'super_admin' ? 'admin' : ''}`}>
                          <Shield size={11} style={{ verticalAlign: '-2px', marginRight: 4 }} />
                          {staff.role === 'super_admin' ? (t('staff.roleAdmin') || 'Admin') : (t('staff.roleEmployee') || 'Employee')}
                        </span>
                      </td>
                      <td data-label={t('common.status') || 'Status'}>
                        <span className={`badge ${staff.status === 'active' ? 'badge-closed' : 'badge-forfeited'}`}>
                          {staff.status === 'active'
                            ? t('staff.statusActive') || 'Active'
                            : t('staff.statusInactive') || 'Inactive'
                          }
                        </span>
                      </td>
                      <td className="staff-actions-cell" data-label={t('common.actions') || 'Actions'} style={{ textAlign: 'right' }}>
                        <div style={{ display: 'inline-flex', gap: '8px', alignItems: 'center', flexWrap: 'wrap' }}>
                          <button
                            onClick={() => handleEditClick(staff)}
                            className="btn btn-secondary"
                            style={{ padding: '8px 12px', fontSize: '0.75rem', minWidth: '60px' }}
                          >
                            <Pencil size={12} /> Edit
                          </button>
                          <button
                            onClick={() => handleToggleStatus(staff.id, staff.status)}
                            className={`btn ${staff.status === 'active' ? 'btn-danger' : 'btn-primary'}`}
                            style={{ padding: '8px 12px', fontSize: '0.75rem', minWidth: '92px' }}
                          >
                            <Power size={12} />
                            {staff.status === 'active'
                              ? t('customers.deactivate') || 'Deactivate'
                              : t('customers.activate') || 'Activate'
                            }
                          </button>
                        </div>
                      </td>
                    </motion.tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
        </motion.div>

      </main>
    </div>
  );
}
