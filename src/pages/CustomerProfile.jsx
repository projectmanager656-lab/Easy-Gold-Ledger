import React, { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { motion, AnimatePresence } from 'framer-motion';
import { doc, getDoc } from 'firebase/firestore';
import { db, auth } from '../services/firebase';
import { PageTransition, FadeScale, GoldDivider } from '../components/PremiumUI';
import {
  User, Phone, MapPin, Mail, MapPinned, ShieldCheck,
  ArrowLeft, CheckCircle, XCircle, ExternalLink, Fingerprint,
  Info, UserCircle2, FileImage, PenLine, BadgeCheck
} from 'lucide-react';

export default function CustomerProfile() {
  const navigate = useNavigate();
  const [customer, setCustomer] = useState(null);
  const [customerExt, setCustomerExt] = useState({});
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [modalImageSrc, setModalImageSrc] = useState(null);

  useEffect(() => {
    const load = async () => {
      setLoading(true);
      try {
        const uid = auth.currentUser?.uid;
        if (!uid) { setError('Not logged in.'); setLoading(false); return; }

        const [uSnap, cSnap] = await Promise.all([
          getDoc(doc(db, 'users', uid)),
          getDoc(doc(db, 'customers', uid)),
        ]);

        if (!uSnap.exists()) { setError('Profile not found.'); setLoading(false); return; }
        setCustomer({ id: uid, ...uSnap.data() });
        setCustomerExt(cSnap.exists() ? cSnap.data() : {});
      } catch (e) {
        console.error(e);
        setError('Failed to load profile.');
      } finally {
        setLoading(false);
      }
    };
    load();
  }, []);

  if (loading) return (
    <main style={{ padding: '60px 24px', textAlign: 'center', minHeight: '100vh' }}>
      <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} transition={{ duration: 0.4 }}>
        <div style={{
          width: 46, height: 46, margin: '0 auto',
          border: '3px solid var(--border-soft)',
          borderTopColor: 'var(--gold)',
          borderRadius: '50%',
          animation: 'spin 0.8s linear infinite',
          boxShadow: '0 0 24px rgba(247,201,72,0.25)'
        }} />
        <p style={{ color: 'var(--text-2)', marginTop: 16, letterSpacing: '0.06em', textTransform: 'uppercase', fontSize: '0.75rem' }}>
          Loading your profile...
        </p>
      </motion.div>
    </main>
  );

  if (error) return (
    <main style={{ padding: '60px 24px', textAlign: 'center', minHeight: '100vh' }}>
      <motion.div initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.5 }}>
        <XCircle size={44} style={{ color: 'var(--danger)', marginBottom: 14 }} />
        <p style={{ color: 'var(--text-2)' }}>{error}</p>
        <button className="btn btn-secondary" onClick={() => navigate('/dashboard')} style={{ marginTop: 16 }}>
          <ArrowLeft size={15} /> Back to Dashboard
        </button>
      </motion.div>
    </main>
  );

  const gps = customer?.gpsLocation;
  const address = customerExt?.address || customer?.address || '';

  return (
    <div className="customer-profile-page" style={{ minHeight: '100vh' }}>
      <main style={{ maxWidth: '780px', margin: '0 auto', padding: '32px 20px' }}>
        <PageTransition>

          {/* Header */}
          <div className="flex-between" style={{ marginBottom: '24px', gap: 16, flexWrap: 'wrap' }}>
            <button className="btn btn-secondary" onClick={() => navigate('/dashboard')} style={{ padding: '8px 14px', display: 'inline-flex', alignItems: 'center', gap: '8px' }}>
              <ArrowLeft size={16} /> Back to Dashboard
            </button>
            <div style={{ textAlign: 'right' }}>
              <h2 className="serif-title gold-gradient-text" style={{ margin: 0, fontSize: '1.5rem' }}>My Profile</h2>
              <p style={{ color: 'var(--text-3)', fontSize: '0.75rem', margin: '4px 0 0 0' }}>
                View-only — Contact admin to make changes
              </p>
            </div>
          </div>

          <div style={{ display: 'flex', flexDirection: 'column', gap: '24px' }}>

            {/* ======== BASIC INFO ======== */}
            <motion.div
              className="glass-panel"
              style={{ padding: '32px' }}
              initial={{ opacity: 0, y: 22 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.55, ease: [0.22, 1, 0.36, 1] }}
            >
              <h3 className="serif-title" style={{ margin: '0 0 20px', fontSize: '1.25rem', display: 'flex', alignItems: 'center', gap: 10 }}>
                <span className="metal-coin" style={{ width: 34, height: 34 }}><UserCircle2 size={16} /></span>
                Basic Information
              </h3>

              {/* Avatar + Info Row */}
              <div style={{ display: 'flex', gap: '26px', alignItems: 'flex-start', flexWrap: 'wrap', marginBottom: '24px' }}>
                {/* Avatar */}
                <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '8px' }}>
                  {customer?.photoBase64 ? (
                    <div className="avatar-ring" style={{ padding: 4 }}>
                      <img
                        src={customer.photoBase64}
                        alt="Profile"
                        onClick={() => setModalImageSrc(customer.photoBase64)}
                        style={{ width: 120, height: 120, borderRadius: '50%', objectFit: 'cover', cursor: 'pointer' }}
                      />
                    </div>
                  ) : (
                    <div style={{ width: 124, height: 124, borderRadius: '50%', background: 'rgba(255,255,255,0.04)', display: 'flex', alignItems: 'center', justifyContent: 'center', border: '2px dashed var(--border-soft)' }}>
                      <User size={48} style={{ color: 'var(--text-3)' }} />
                    </div>
                  )}
                  {customer?.photoBase64 && <span style={{ fontSize: '0.75rem', color: 'var(--text-3)' }}>Click to zoom</span>}
                  <span className="badge badge-closed" style={{ fontSize: '0.75rem', padding: '3px 12px', letterSpacing: '0.08em' }}>CUSTOMER</span>
                </div>

                {/* Details */}
                <div style={{ flex: 1, minWidth: '220px', display: 'flex', flexDirection: 'column', gap: '16px' }}>
                  {/* Name */}
                  <div>
                    <label style={{ fontSize: '0.75rem', textTransform: 'uppercase', letterSpacing: '0.09em', display: 'block', marginBottom: '2px' }}>Full Name</label>
                    <p className="serif-title" style={{ margin: 0, fontSize: '1.5rem', fontWeight: 700 }}>{customer?.name || '-'}</p>
                  </div>
                  {/* Phone */}
                  <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
                    <span className="detail-icon"><Phone size={15} /></span>
                    <span>{customer?.phone || '-'}</span>
                  </div>
                  {/* Email */}
                  <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
                    <span className="detail-icon"><Mail size={15} /></span>
                    <span>{customer?.email || '-'}</span>
                  </div>
                  {/* Address */}
                  {address && (
                    <div style={{ display: 'flex', alignItems: 'flex-start', gap: '12px' }}>
                      <span className="detail-icon"><MapPin size={15} /></span>
                      <span style={{ lineHeight: '1.5' }}>{address}</span>
                    </div>
                  )}
                </div>
              </div>

              <GoldDivider />

              {/* GPS */}
              {gps && (
                <div className="gps-chip" style={{ margin: '16px 0 14px', flexWrap: 'wrap' }}>
                  <MapPinned size={14} />
                  <span>GPS Registered: {gps.latitude?.toFixed(6)}, {gps.longitude?.toFixed(6)}</span>
                  <a
                    href={`https://www.google.com/maps?q=${gps.latitude},${gps.longitude}`}
                    target="_blank"
                    rel="noopener noreferrer"
                    style={{ color: 'var(--gold)', marginLeft: 'auto', fontSize: '0.75rem', display: 'inline-flex', alignItems: 'center', gap: 4 }}
                  >
                    Open Map <ExternalLink size={12} />
                  </a>
                </div>
              )}

              {/* KYC Status */}
              <div className="check-pop" style={{ fontSize: '0.875rem' }}>
                {customerExt?.kycVerified ? (
                  <>
                    <CheckCircle size={17} style={{ color: 'var(--success)' }} />
                    <span style={{ color: 'var(--success)', fontWeight: 600 }}>KYC Verified</span>
                    <BadgeCheck size={15} style={{ color: 'var(--gold)' }} />
                  </>
                ) : (
                  <>
                    <XCircle size={17} style={{ color: 'var(--warning)' }} />
                    <span style={{ color: 'var(--warning)' }}>KYC Not Verified</span>
                  </>
                )}
              </div>
            </motion.div>

            {/* ======== KYC DOCUMENTS ======== */}
            <motion.div
              className="glass-panel"
              style={{ padding: '32px' }}
              initial={{ opacity: 0, y: 22 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.55, delay: 0.08, ease: [0.22, 1, 0.36, 1] }}
            >
              <h3 className="serif-title" style={{ margin: '0 0 20px', fontSize: '1.25rem', display: 'flex', alignItems: 'center', gap: 10 }}>
                <span className="metal-coin" style={{ width: 34, height: 34 }}><ShieldCheck size={16} /></span>
                KYC Documents
              </h3>

              <div style={{ display: 'flex', gap: '22px', flexWrap: 'wrap', alignItems: 'flex-start' }}>

                {/* Face KYC Photo */}
                {customer?.facePhotoBase64 ? (
                  <FadeScale className="kyc-card">
                    <label style={{ fontSize: '0.75rem', textTransform: 'uppercase', letterSpacing: '0.08em' }}>Face KYC Photo</label>
                    <div className="avatar-ring" style={{ alignSelf: 'center' }}>
                      <img
                        src={customer.facePhotoBase64}
                        alt="Face KYC"
                        onClick={() => setModalImageSrc(customer.facePhotoBase64)}
                        style={{ width: 110, height: 110, objectFit: 'cover', borderRadius: '50%', cursor: 'pointer' }}
                      />
                    </div>
                    <span style={{ fontSize: '0.75rem', color: 'var(--text-3)' }}>Click to zoom</span>
                  </FadeScale>
                ) : (
                  <div className="kyc-card">
                    <label style={{ fontSize: '0.75rem', textTransform: 'uppercase', letterSpacing: '0.08em' }}>Face KYC Photo</label>
                    <div className="kyc-empty">
                      <Fingerprint size={22} />
                      <span>Not captured</span>
                    </div>
                  </div>
                )}

                {/* KYC ID Document */}
                {customerExt?.idProofBase64 ? (
                  <FadeScale className="kyc-card" delay={0.06}>
                    <label style={{ fontSize: '0.75rem', textTransform: 'uppercase', letterSpacing: '0.08em' }}>KYC ID Document</label>
                    <img
                      src={customerExt.idProofBase64}
                      alt="KYC ID"
                      onClick={() => setModalImageSrc(customerExt.idProofBase64)}
                      className="upload-preview id"
                      style={{ alignSelf: 'center' }}
                    />
                    <span style={{ fontSize: '0.75rem', color: 'var(--text-3)' }}>Click to zoom</span>
                  </FadeScale>
                ) : (
                  <div className="kyc-card">
                    <label style={{ fontSize: '0.75rem', textTransform: 'uppercase', letterSpacing: '0.08em' }}>KYC ID Document</label>
                    <div className="kyc-empty" style={{ width: 170, height: 100 }}>
                      <FileImage size={22} />
                      <span>Not uploaded</span>
                    </div>
                  </div>
                )}

                {/* Signature */}
                {customerExt?.signatureBase64 ? (
                  <FadeScale className="kyc-card" delay={0.12}>
                    <label style={{ fontSize: '0.75rem', textTransform: 'uppercase', letterSpacing: '0.08em' }}>Signature</label>
                    <div
                      onClick={() => setModalImageSrc(customerExt.signatureBase64)}
                      style={{ background: '#0a0e17', borderRadius: '12px', padding: '12px 16px', border: '1px solid var(--border-soft)', cursor: 'pointer', minWidth: '130px', display: 'flex', alignItems: 'center', justifyContent: 'center' }}
                    >
                      <img
                        src={customerExt.signatureBase64}
                        alt="Signature"
                        style={{ maxHeight: '55px', filter: 'brightness(1.5)' }}
                      />
                    </div>
                    <span style={{ fontSize: '0.75rem', color: 'var(--text-3)' }}>Click to zoom</span>
                  </FadeScale>
                ) : (
                  <div className="kyc-card">
                    <label style={{ fontSize: '0.75rem', textTransform: 'uppercase', letterSpacing: '0.08em' }}>Signature</label>
                    <div className="kyc-empty" style={{ width: 150, height: 60 }}>
                      <PenLine size={18} />
                      <span>Not signed</span>
                    </div>
                  </div>
                )}

              </div>

              {/* Face Embedding Status */}
              <GoldDivider />

              <div className="check-pop" style={{ marginTop: 16 }}>
                {customer?.faceEmbedding ? (
                  <>
                    <ShieldCheck size={17} style={{ color: 'var(--success)' }} />
                    <span style={{ color: 'var(--success)', fontSize: '0.875rem' }}>Face Biometric Registered</span>
                  </>
                ) : (
                  <>
                    <XCircle size={17} style={{ color: 'var(--warning)' }} />
                    <span style={{ color: 'var(--warning)', fontSize: '0.875rem' }}>Face Biometric Not Registered</span>
                  </>
                )}
              </div>
            </motion.div>

            {/* ======== INFO NOTE ======== */}
            <motion.div
              style={{
                background: 'rgba(212,175,55,0.05)',
                border: '1px solid rgba(212,175,55,0.16)',
                borderRadius: '14px',
                padding: '16px 20px',
                display: 'flex',
                alignItems: 'flex-start',
                gap: '12px'
              }}
              initial={{ opacity: 0, y: 16 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.5, delay: 0.14, ease: [0.22, 1, 0.36, 1] }}
            >
              <Info size={18} style={{ color: 'var(--gold)', flexShrink: 0, marginTop: 2 }} />
              <p style={{ margin: 0, fontSize: '0.875rem', color: 'var(--text-2)', lineHeight: '1.6' }}>
                This is a read-only view of your profile. To update your details, face scan, or KYC documents, please contact your branch admin.
              </p>
            </motion.div>

          </div>
        </PageTransition>
      </main>

      {/* Lightbox */}
      <AnimatePresence>
        {modalImageSrc && (
          <motion.div
            className="modal-overlay"
            onClick={() => setModalImageSrc(null)}
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.25 }}
          >
            <div
              className="glass-panel modal-content"
              style={{ maxWidth: '85vw', maxHeight: '85vh', padding: '16px', position: 'relative', display: 'flex', alignItems: 'center', justifyContent: 'center' }}
              onClick={(e) => e.stopPropagation()}
            >
              <button
                type="button"
                className="btn btn-secondary"
                onClick={() => setModalImageSrc(null)}
                style={{ position: 'absolute', top: '10px', right: '10px', padding: '8px 12px', minWidth: 'auto' }}
              >
                ✕
              </button>
              <img src={modalImageSrc} alt="Preview" style={{ maxWidth: '100%', maxHeight: '80vh', objectFit: 'contain', borderRadius: '8px' }} />
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
