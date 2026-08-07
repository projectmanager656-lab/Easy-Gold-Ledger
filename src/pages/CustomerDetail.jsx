import React, { useState, useEffect, useRef } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { motion, AnimatePresence } from 'framer-motion';
import { doc, getDoc, updateDoc, collection, query, where, getDocs } from 'firebase/firestore';
import { db } from '../services/firebase';
import { logAudit, updateCustomerEmail, getPaymentsByCustomer, getLoanPayments } from '../services/firebaseService';
import { generateCustomerStatement } from '../utils/pdfGenerator';
import { compressImage, drawGpsWatermark } from '../utils/imageCompressor';
import FaceScanner from '../components/FaceScanner';
import SignaturePad from '../components/SignaturePad';
import { PageTransition, FadeScale, GoldButton, GoldDivider } from '../components/PremiumUI';
import {
  ArrowLeft, User, ShieldCheck, CheckCircle,
  XCircle, Camera, Save, AlertTriangle, MapPinned,
  ScanLine, Mail, Phone, Home, KeyRound, Fingerprint,
  BadgeCheck, Lock, ExternalLink, UserCog, History,
  Wallet, IndianRupee, Download, ReceiptText
} from 'lucide-react';

export default function CustomerDetail() {
  const { id } = useParams();
  const navigate = useNavigate();
  const { t } = useTranslation();

  const [customer, setCustomer] = useState(null);
  const [customerExt, setCustomerExt] = useState({});
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState('');
  const [saveSuccess, setSaveSuccess] = useState('');
  const [modalImageSrc, setModalImageSrc] = useState(null);
  const [showVerifyModal, setShowVerifyModal] = useState(false);
  const [verifyResult, setVerifyResult] = useState(null);

  // Edit form state
  const [editName, setEditName] = useState('');
  const [editPhone, setEditPhone] = useState('');
  const [editAddress, setEditAddress] = useState('');
  const [editEmail, setEditEmail] = useState('');
  const [editPhoto, setEditPhoto] = useState('');
  const [editIdProof, setEditIdProof] = useState('');
  const [editSignature, setEditSignature] = useState('');
  const [editFaceEmbedding, setEditFaceEmbedding] = useState(null);
  const [editFacePhoto, setEditFacePhoto] = useState('');

  // Camera state
  const [useLiveCam, setUseLiveCam] = useState(false);
  const [liveCamActive, setLiveCamActive] = useState(false);
  const [photoStream, setPhotoStream] = useState(null);
  const photoVideoRef = useRef(null);

  // GPS state
  const [gpsCoords, setGpsCoords] = useState(null);
  const [gpsError, setGpsError] = useState('');

  // Loan & repayment summary state
  const [loanSummary, setLoanSummary] = useState(null);
  const [summaryLoading, setSummaryLoading] = useState(false);
  const [statementBusy, setStatementBusy] = useState(false);

  // -------- Load loan & repayment summary --------
  useEffect(() => {
    const load = async () => {
      setSummaryLoading(true);
      try {
        const loansSnap = await getDocs(query(collection(db, 'loans'), where('customerId', '==', id)));
        const loans = loansSnap.docs.map((d) => ({ id: d.id, ...d.data() }));
        const paymentsByLoan = {};
        await Promise.all(loans.map(async (loan) => {
          paymentsByLoan[loan.id] = await getLoanPayments(loan.id);
        }));
        const ledgerPayments = await getPaymentsByCustomer(id);
        const seen = new Set();
        const merged = [];
        [...ledgerPayments, ...Object.values(paymentsByLoan).flat()].forEach((p) => {
          const key = p.id || `${p.paymentDate}_${p.amount}_${p.createdAt}`;
          if (seen.has(key)) return;
          seen.add(key);
          merged.push(p);
        });
        merged.sort((a, b) => new Date(b.paymentDate || b.createdAt) - new Date(a.paymentDate || a.createdAt));
        setLoanSummary({ loans, payments: merged, paymentsByLoan });
      } catch (e) { console.error('Failed to load loan summary:', e); }
      finally { setSummaryLoading(false); }
    };
    load();
  }, [id]);

  const isActive = (status) => status == null || status === 'open' || status === 'partially_paid';

  const activeLoans = (loanSummary?.loans || []).filter((l) => isActive(l.status));
  const outstandingTotal = activeLoans.reduce((s, l) => s + (parseFloat(l.outstandingPrincipal ?? l.loanAmount) || 0), 0);
  const totalRepaid = (loanSummary?.payments || []).reduce((s, p) => s + (Number(p.amount) || 0), 0);

  const statusLabel = (status) => {
    if (status === 'open') return t('payments.statusOpen') || 'OPEN';
    if (status === 'partially_paid') return t('payments.statusPartial') || 'PARTIALLY PAID';
    if (status === 'paid') return t('payments.statusPaid') || 'PAID';
    if (status === 'closed') return t('payments.statusClosed') || 'CLOSED';
    if (status === 'forfeited') return t('payments.statusForfeited') || 'FORFEITED';
    return (status || 'open').toUpperCase();
  };

  const badgeClass = (status) => {
    if (status === 'partially_paid') return 'badge-partial';
    if (status === 'paid') return 'badge-paid';
    if (status === 'defaulted') return 'badge-defaulted';
    if (status === 'closed') return 'badge-closed';
    if (status === 'forfeited') return 'badge-forfeited';
    return 'badge-open';
  };

  const handleDownloadStatement = async () => {
    if (!loanSummary) return;
    setStatementBusy(true);
    try {
      await generateCustomerStatement(merged, loanSummary.loans, loanSummary.paymentsByLoan, t);
    } catch (e) { console.error('Statement failed:', e); }
    finally { setStatementBusy(false); }
  };

  // -------- Load customer --------
  useEffect(() => {
    const load = async () => {
      setLoading(true);
      try {
        const [uSnap, cSnap] = await Promise.all([
          getDoc(doc(db, 'users', id)),
          getDoc(doc(db, 'customers', id)),
        ]);
        if (!uSnap.exists()) { setSaveError('Customer not found.'); setLoading(false); return; }
        const u = { id: uSnap.id, ...uSnap.data() };
        const c = cSnap.exists() ? cSnap.data() : {};
        setCustomer(u);
        setCustomerExt(c);
        setEditName(u.name || '');
        setEditPhone(u.phone || '');
        setEditEmail(u.email || '');
        setEditAddress(c.address || '');
        setEditPhoto(u.photoBase64 || '');
        setEditIdProof(c.idProofBase64 || '');
        setEditSignature(c.signatureBase64 || '');
        setEditFaceEmbedding(u.faceEmbedding || null);
        setEditFacePhoto(u.facePhotoBase64 || '');
        if (u.gpsLocation) setGpsCoords(u.gpsLocation);
      } catch (e) { console.error(e); setSaveError('Failed to load.'); }
      finally { setLoading(false); }
    };
    load();
  }, [id]);

  // -------- GPS helpers --------
  const fetchIpGeolocation = async () => {
    try {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), 2500);
      const res = await fetch('https://ipapi.co/json/', { signal: controller.signal });
      clearTimeout(timer);
      if (res.ok) {
        const d = await res.json();
        if (d?.latitude && d?.longitude)
          return { latitude: d.latitude, longitude: d.longitude, accuracy: 1000 };
      }
    } catch (e) { console.error(e); }
    return null;
  };

  const getAddressFromCoords = async (lat, lon) => {
    try {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), 3000);
      const res = await fetch(
        `https://nominatim.openstreetmap.org/reverse?format=json&lat=${lat}&lon=${lon}`,
        { headers: { 'Accept-Language': 'en' }, signal: controller.signal }
      );
      clearTimeout(timer);
      if (res.ok) { const d = await res.json(); return d.display_name || ''; }
    } catch { /* silent */ }
    return '';
  };

  const applyWatermark = async (base64Img, coords) => {
    try {
      const active = coords || gpsCoords;
      let lat = 0, lon = 0, addr = '';
      if (active) {
        lat = active.latitude; lon = active.longitude;
        addr = await getAddressFromCoords(lat, lon);
      } else {
        const ip = await fetchIpGeolocation();
        if (ip) { lat = ip.latitude; lon = ip.longitude; setGpsCoords(ip); addr = await getAddressFromCoords(lat, lon); }
      }
      return await drawGpsWatermark(base64Img, lat, lon, addr || (active ? 'Precise Location' : 'GPS Unavailable'));
    } catch (e) {
      console.error('Failed to draw watermark:', e);
      return base64Img; // Fallback to raw base64 image if drawing watermark fails
    }
  };

  const fetchGps = () => {
    if (!navigator.geolocation) return;
    navigator.geolocation.getCurrentPosition(
      (pos) => { setGpsCoords({ latitude: pos.coords.latitude, longitude: pos.coords.longitude, accuracy: pos.coords.accuracy }); setGpsError(''); },
      async () => {
        const ip = await fetchIpGeolocation();
        if (ip) { setGpsCoords(ip); setGpsError(''); }
        else setGpsError('GPS unavailable.');
      },
      { enableHighAccuracy: false, timeout: 3000 }
    );
  };

  // -------- Camera --------
  const startPhotoCamera = async () => {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: 'user', width: 640, height: 480 } });
      setPhotoStream(stream); setLiveCamActive(true); fetchGps();
      setTimeout(() => { if (photoVideoRef.current) photoVideoRef.current.srcObject = stream; }, 100);
    } catch { setGpsError('Camera access denied.'); }
  };

  const stopPhotoCamera = () => {
    photoStream?.getTracks().forEach(t => t.stop());
    setPhotoStream(null); setLiveCamActive(false);
  };

  const capturePhotoFromStream = async () => {
    if (!photoVideoRef.current) return;
    const canvas = document.createElement('canvas');
    canvas.width = photoVideoRef.current.videoWidth;
    canvas.height = photoVideoRef.current.videoHeight;
    canvas.getContext('2d').drawImage(photoVideoRef.current, 0, 0);
    const base64 = canvas.toDataURL('image/jpeg', 0.8);
    const w = await applyWatermark(base64, gpsCoords);
    setEditPhoto(w); stopPhotoCamera();
  };

  // -------- File Upload --------
  const handleImageUpload = async (e, type) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const compressed = await compressImage(file);
    if (type === 'photo') {
      if (navigator.geolocation) {
        navigator.geolocation.getCurrentPosition(
          async (pos) => {
            const coords = { latitude: pos.coords.latitude, longitude: pos.coords.longitude, accuracy: pos.coords.accuracy };
            setGpsCoords(coords);
            setEditPhoto(await applyWatermark(compressed, coords));
          },
          async () => setEditPhoto(await applyWatermark(compressed, null)),
          { enableHighAccuracy: false, timeout: 3000 }
        );
      } else {
        setEditPhoto(await applyWatermark(compressed, null));
      }
    }
    if (type === 'id') setEditIdProof(compressed);
  };

  // -------- Face Scan --------
  const handleFaceScanResult = async (descriptor, rawFacePhoto) => {
    setEditFaceEmbedding(descriptor);
    if (rawFacePhoto) setEditFacePhoto(await applyWatermark(rawFacePhoto, gpsCoords));
  };

  // -------- Save --------
  const handleSave = async (e) => {
    e.preventDefault();
    setSaving(true); setSaveError(''); setSaveSuccess('');
    try {
      const userUpdates = {
        name: editName.trim(),
        phone: editPhone.trim(),
        ...(editPhoto ? { photoBase64: editPhoto } : {}),
        ...(editFaceEmbedding ? { faceEmbedding: editFaceEmbedding } : {}),
        ...(editFacePhoto ? { facePhotoBase64: editFacePhoto } : {}),
        ...(gpsCoords ? { gpsLocation: gpsCoords } : {}),
      };
      const custUpdates = {
        address: editAddress.trim(),
        ...(editIdProof ? { idProofBase64: editIdProof } : {}),
        ...(editSignature ? { signatureBase64: editSignature } : {}),
        ...(gpsCoords ? { gpsLocation: gpsCoords } : {}),
      };

      await updateDoc(doc(db, 'users', id), userUpdates);
      await updateDoc(doc(db, 'customers', id), custUpdates);

      if (editEmail.trim() && editEmail.trim() !== customer.email) {
        await updateCustomerEmail(id, editEmail.trim());
      }

      await logAudit('update_customer_profile', 'customers', id, null, { ...userUpdates, ...custUpdates });

      // Refresh local state
      const [uSnap, cSnap] = await Promise.all([
        getDoc(doc(db, 'users', id)), getDoc(doc(db, 'customers', id))
      ]);
      setCustomer({ id, ...uSnap.data() });
      setCustomerExt(cSnap.data() || {});
      setSaveSuccess('Profile updated successfully!');
      setTimeout(() => setSaveSuccess(''), 3000);
    } catch (err) {
      console.error(err);
      setSaveError('Save failed: ' + err.message);
    } finally { setSaving(false); }
  };

  const merged = { ...customer, ...customerExt };

  // ============ RENDER ============
  if (loading) return (
    <main style={{ padding: '60px 24px', textAlign: 'center' }}>
      <motion.div
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        transition={{ duration: 0.4 }}
      >
        <div className="loader-ring" style={{
          width: 46, height: 46, margin: '0 auto',
          border: '3px solid var(--border-soft)',
          borderTopColor: 'var(--gold)',
          borderRadius: '50%',
          animation: 'spin 0.8s linear infinite',
          boxShadow: '0 0 24px rgba(247,201,72,0.25)'
        }} />
        <p style={{ color: 'var(--text-2)', marginTop: 16, letterSpacing: '0.06em', textTransform: 'uppercase', fontSize: '0.75rem' }}>
          Loading profile...
        </p>
      </motion.div>
    </main>
  );

  return (
    <div className="app-container customer-detail-container" style={{ minHeight: '100vh' }}>
      <main className="main-content" style={{ maxWidth: '900px', margin: '0 auto', padding: '32px 20px' }}>
        <PageTransition>

          {/* Top Header / Nav */}
          <div className="flex-between" style={{ marginBottom: '24px', gap: 16, flexWrap: 'wrap' }}>
            <button
              onClick={() => navigate('/customers')}
              className="btn btn-secondary"
              style={{ padding: '8px 14px', display: 'inline-flex', alignItems: 'center', gap: '8px' }}
            >
              <ArrowLeft size={16} /> Back to Registry
            </button>
            <div style={{ textAlign: 'right' }}>
              <h2 className="serif-title" style={{ margin: 0, fontSize: '1.5rem', wordBreak: 'break-word' }}>
                <span className="gold-gradient-text">{editName || 'Loading...'}</span>
              </h2>
              <p style={{ color: 'var(--text-3)', fontSize: '0.75rem', margin: '4px 0 0 0', letterSpacing: '0.05em' }}>
                CUSTOMER ID: {id}
              </p>
            </div>
          </div>

          {/* Alerts */}
          {saveError && (
            <FadeScale>
              <div className="alert-banner alert-critical" style={{ marginBottom: 16 }}>
                <XCircle size={18} /><span>{saveError}</span>
              </div>
            </FadeScale>
          )}
          {saveSuccess && (
            <FadeScale>
              <div className="alert-banner alert-info" style={{ marginBottom: 16 }}>
                <CheckCircle size={18} /><span>{saveSuccess}</span>
              </div>
            </FadeScale>
          )}

          <form onSubmit={handleSave} style={{ display: 'flex', flexDirection: 'column', gap: '24px' }}>

            {/* ======== BASIC INFO ======== */}
            <motion.div
              className="glass-panel"
              style={{ padding: '32px' }}
              initial={{ opacity: 0, y: 22 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.55, ease: [0.22, 1, 0.36, 1] }}
            >
              <h3 className="serif-title" style={{ margin: '0 0 20px', fontSize: '1.25rem', display: 'flex', alignItems: 'center', gap: 10 }}>
                <span className="metal-coin" style={{ width: 34, height: 34 }}><UserCog size={16} /></span>
                Basic Information
              </h3>

              {/* Avatar + Camera */}
              <div style={{ display: 'flex', gap: '26px', alignItems: 'flex-start', flexWrap: 'wrap', marginBottom: '24px' }}>
                {/* Avatar */}
                <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '8px' }}>
                  {editPhoto ? (
                    <div className="avatar-ring" style={{ padding: 4 }}>
                      <img src={editPhoto} alt="Profile" onClick={() => setModalImageSrc(editPhoto)}
                        style={{ width: 110, height: 110, borderRadius: '50%', objectFit: 'cover', cursor: 'pointer' }} />
                    </div>
                  ) : (
                    <div style={{ width: 112, height: 112, borderRadius: '50%', background: 'rgba(255,255,255,0.04)', display: 'flex', alignItems: 'center', justifyContent: 'center', border: '2px dashed var(--border-soft)' }}>
                      <User size={44} style={{ color: 'var(--text-3)' }} />
                    </div>
                  )}
                  <span style={{ fontSize: '0.75rem', color: 'var(--text-3)' }}>Click to zoom</span>
                </div>

                {/* Photo controls */}
                <div style={{ flex: 1, minWidth: '220px' }}>
                  <label style={{ display: 'block', '': '12px' }}>Profile Photo</label>
                  <div className="mode-tabs" style={{ marginBottom: '12px' }}>
                    <button type="button" onClick={() => { setUseLiveCam(false); stopPhotoCamera(); }}
                      className={`tab-btn ${!useLiveCam ? 'active' : ''}`}>
                      <ScanLine size={13} /> Upload File
                    </button>
                    <button type="button" onClick={() => { setUseLiveCam(true); startPhotoCamera(); }}
                      className={`tab-btn ${useLiveCam ? 'active' : ''}`}>
                      <Camera size={13} /> Camera
                    </button>
                  </div>
                  {!useLiveCam ? (
                    <input type="file" accept="image/*" onChange={(e) => handleImageUpload(e, 'photo')} />
                  ) : (
                    <div style={{ display: 'flex', flexDirection: 'column', gap: '12px', alignItems: 'flex-start' }}>
                      {liveCamActive ? (
                        <div className="cam-frame" style={{ maxWidth: 180 }}>
                          <video ref={photoVideoRef} autoPlay playsInline muted />
                        </div>
                      ) : (
                        <p style={{ fontSize: '0.875rem', color: 'var(--text-2)' }}>Camera starting...</p>
                      )}
                      {liveCamActive && (
                        <button type="button" onClick={capturePhotoFromStream} className="capture-ring" style={{ width: 46, height: 46 }} aria-label="Take Snapshot">
                          <Camera size={19} />
                        </button>
                      )}
                    </div>
                  )}
                  {editPhoto && (
                    <div style={{ marginTop: '12px', display: 'flex', flexDirection: 'column', gap: '8px' }}>
                      <span className="check-pop" style={{ color: editPhoto === customer?.photoBase64 ? 'var(--text-2)' : 'var(--success)' }}>
                        {editPhoto === customer?.photoBase64 ? 'Current Profile Photo:' : <><BadgeCheck size={15} /> New Profile Photo ready to save:</>}
                      </span>
                      <img src={editPhoto} alt="Customer Profile Preview" onClick={() => setModalImageSrc(editPhoto)}
                        className="upload-preview" style={{ alignSelf: 'flex-start' }} />
                    </div>
                  )}
                </div>
              </div>

              {/* GPS Badge */}
              {gpsCoords ? (
                <div className="gps-chip" style={{ marginBottom: '16px', flexWrap: 'wrap' }}>
                  <MapPinned size={14} />
                  <span>GPS: {gpsCoords.latitude?.toFixed(6)}, {gpsCoords.longitude?.toFixed(6)}</span>
                  <a href={`https://www.google.com/maps?q=${gpsCoords.latitude},${gpsCoords.longitude}`} target="_blank" rel="noopener noreferrer"
                    style={{ color: 'var(--gold)', marginLeft: 'auto', fontSize: '0.75rem', display: 'inline-flex', alignItems: 'center', gap: 4 }}>
                    Open Map <ExternalLink size={12} />
                  </a>
                </div>
              ) : gpsError ? (
                <div className="gps-chip warn" style={{ marginBottom: '16px' }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: '8px', fontWeight: 600, fontSize: '0.875rem' }}>
                    <AlertTriangle size={13} /> GPS Blocked
                  </div>
                  <button type="button" onClick={fetchGps} className="btn btn-secondary retry-btn">
                    Try Again
                  </button>
                </div>
              ) : null}

              <GoldDivider />

              {/* Fields */}
              <div className="grid-cols-2" style={{ marginTop: 18 }}>
                <div className="form-group">
                  <label><User size={13} style={{ verticalAlign: '-2px', marginRight: 6 }} /> Full Name *</label>
                  <input type="text" value={editName} onChange={(e) => setEditName(e.target.value)} placeholder="Full Name" required />
                </div>
                <div className="form-group">
                  <label><Phone size={13} style={{ verticalAlign: '-2px', marginRight: 6 }} /> Phone Number *</label>
                  <input type="tel" value={editPhone} onChange={(e) => setEditPhone(e.target.value)} placeholder="+91XXXXXXXXXX" required />
                </div>
              </div>
              <div className="form-group">
                <label><Home size={13} style={{ verticalAlign: '-2px', marginRight: 6 }} /> Home Address</label>
                <input type="text" value={editAddress} onChange={(e) => setEditAddress(e.target.value)} placeholder="Street, City, State, PIN Code" />
              </div>
              <div className="form-group">
                <label><Mail size={13} style={{ verticalAlign: '-2px', marginRight: 6 }} /> Email Address</label>
                <input type="email" value={editEmail} onChange={(e) => setEditEmail(e.target.value)} placeholder="customer@email.com" />
                <p style={{ fontSize: '0.75rem', color: 'var(--text-3)', marginTop: 8, display: 'flex', alignItems: 'center', gap: 6 }}>
                  <Lock size={12} /> Changing email updates Firebase Auth + Firestore record.
                </p>
              </div>
            </motion.div>

            {/* ======== FACE KYC ======== */}
            <motion.div
              className="glass-panel"
              style={{ padding: '32px', display: 'flex', flexDirection: 'column', gap: '24px' }}
              initial={{ opacity: 0, y: 22 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.55, delay: 0.08, ease: [0.22, 1, 0.36, 1] }}
            >
              <h3 className="serif-title" style={{ margin: 0, fontSize: '1.25rem', display: 'flex', alignItems: 'center', gap: 10 }}>
                <span className="metal-coin" style={{ width: 34, height: 34 }}><ShieldCheck size={16} /></span>
                Face Verification & Identity KYC
              </h3>

              {/* ---- SAVED DATA READ-ONLY PREVIEW ---- */}
              {(customer?.facePhotoBase64 || customerExt?.idProofBase64 || customerExt?.signatureBase64) && (
                <div style={{
                  background: 'rgba(212,175,55,0.04)',
                  border: '1px solid rgba(212,175,55,0.16)',
                  borderRadius: '14px',
                  padding: '18px',
                  display: 'flex',
                  flexDirection: 'column',
                  gap: '16px'
                }}>
                  <p style={{ fontSize: '0.75rem', color: 'var(--gold)', fontWeight: 600, margin: 0, display: 'flex', alignItems: 'center', gap: 8 }}>
                    <Fingerprint size={15} /> Currently Saved KYC Data
                  </p>

                  <div className="kyc-saved-gallery" style={{ display: 'flex', gap: '18px', flexWrap: 'wrap', alignItems: 'flex-start' }}>
                    {/* Saved Face KYC Photo */}
                    {customer?.facePhotoBase64 && (
                      <div style={{ display: 'flex', flexDirection: 'column', gap: '8px', alignItems: 'center' }}>
                        <label style={{ fontSize: '0.75rem' }}>Face KYC Photo</label>
                        <img
                          src={customer.facePhotoBase64}
                          alt="Saved Face KYC"
                          onClick={() => setModalImageSrc(customer.facePhotoBase64)}
                          className="upload-preview"
                        />
                        <span style={{ fontSize: '0.75rem', color: 'var(--text-3)' }}>Click to zoom</span>
                      </div>
                    )}

                    {/* Saved KYC ID */}
                    {customerExt?.idProofBase64 && (
                      <div style={{ display: 'flex', flexDirection: 'column', gap: '8px', alignItems: 'center' }}>
                        <label style={{ fontSize: '0.75rem' }}>KYC ID Document</label>
                        <img
                          src={customerExt.idProofBase64}
                          alt="Saved KYC ID"
                          onClick={() => setModalImageSrc(customerExt.idProofBase64)}
                          className="upload-preview id"
                        />
                        <span style={{ fontSize: '0.75rem', color: 'var(--text-3)' }}>Click to zoom</span>
                      </div>
                    )}

                    {/* Saved Signature */}
                    {customerExt?.signatureBase64 && (
                      <div style={{ display: 'flex', flexDirection: 'column', gap: '8px', alignItems: 'center' }}>
                        <label style={{ fontSize: '0.75rem' }}>Signature</label>
                        <div style={{ background: '#0a0e17', borderRadius: '12px', padding: '10px 14px', border: '1px solid var(--border-soft)' }}>
                          <img
                            src={customerExt.signatureBase64}
                            alt="Saved Signature"
                            onClick={() => setModalImageSrc(customerExt.signatureBase64)}
                            style={{ maxHeight: '50px', filter: 'brightness(1.5)', cursor: 'pointer' }}
                          />
                        </div>
                        <span style={{ fontSize: '0.75rem', color: 'var(--text-3)' }}>Click to zoom</span>
                      </div>
                    )}
                  </div>
                </div>
              )}

              {/* ---- NEW SCAN / UPDATE ---- */}
              <p style={{ fontSize: '0.875rem', color: 'var(--text-2)', margin: 0 }}>
                Scan a new face below to update the KYC embedding:
              </p>
              <FaceScanner mode="register" onResult={handleFaceScanResult} />

              {editFacePhoto && (
                <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
                  <span className="check-pop" style={{ color: editFacePhoto === customer?.facePhotoBase64 ? 'var(--text-2)' : 'var(--success)' }}>
                    {editFacePhoto === customer?.facePhotoBase64 ? 'Current Face KYC Photo:' : <><BadgeCheck size={15} /> New Face KYC Photo ready to save:</>}
                  </span>
                  <img src={editFacePhoto} alt="Face KYC Preview" onClick={() => setModalImageSrc(editFacePhoto)}
                    className="upload-preview" style={{ alignSelf: 'flex-start' }} />
                </div>
              )}
              {editFaceEmbedding && editFaceEmbedding !== customer?.faceEmbedding && (
                <div className="check-pop">
                  <CheckCircle size={18} /> New Face Embedding Captured — will be saved
                </div>
              )}

              {/* KYC ID Document */}
              <div className="glass-card" style={{ display: 'flex', flexDirection: 'column', gap: '12px', padding: 18 }}>
                <label>Replace KYC ID Document (upload new)</label>
                <input type="file" accept="image/*" onChange={(e) => handleImageUpload(e, 'id')} />
                {editIdProof && (
                  <div style={{ display: 'flex', flexDirection: 'column', gap: '8px', marginTop: '8px' }}>
                    <span className="check-pop" style={{ color: editIdProof === customerExt?.idProofBase64 ? 'var(--text-2)' : 'var(--success)' }}>
                      {editIdProof === customerExt?.idProofBase64 ? 'Current ID Document:' : <><BadgeCheck size={15} /> New ID ready to save:</>}
                    </span>
                    <img src={editIdProof} alt="KYC ID" onClick={() => setModalImageSrc(editIdProof)}
                      style={{ maxWidth: '100%', maxHeight: '160px', objectFit: 'contain', borderRadius: '12px', border: '1px solid var(--border-soft)', cursor: 'zoom-in' }} />
                  </div>
                )}
              </div>

              {/* Signature */}
              <div>
                <p style={{ fontSize: '0.875rem', color: 'var(--text-2)', '': '12px' }}>
                  Draw new signature to replace existing:
                </p>
                <SignaturePad onSave={(sig) => setEditSignature(sig)} />
                {editSignature && (
                  <div style={{ display: 'flex', flexDirection: 'column', gap: '8px', marginTop: '12px' }}>
                    <span className="check-pop" style={{ color: editSignature === customerExt?.signatureBase64 ? 'var(--text-2)' : 'var(--success)' }}>
                      {editSignature === customerExt?.signatureBase64 ? 'Current Signature:' : <><BadgeCheck size={15} /> New Signature ready to save:</>}
                    </span>
                    <div style={{ background: '#0a0e17', borderRadius: '12px', padding: '12px', display: 'flex', justifyContent: 'center', border: '1px solid var(--border-soft)' }}>
                      <img src={editSignature} alt="Signature Preview" onClick={() => setModalImageSrc(editSignature)}
                        style={{ maxHeight: '60px', filter: 'brightness(1.5)', cursor: 'pointer' }} />
                    </div>
                  </div>
                )}
              </div>
            </motion.div>

            {/* ======== FACE VERIFICATION ======== */}
            {merged.faceEmbedding && (
              <motion.div
                className="glass-panel"
                style={{ padding: '24px' }}
                initial={{ opacity: 0, y: 22 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ duration: 0.55, delay: 0.16, ease: [0.22, 1, 0.36, 1] }}
              >
                <GoldButton
                  type="button"
                  onClick={() => { setVerifyResult(null); setShowVerifyModal(true); }}
                  style={{ width: '100%' }}
                >
                  <ShieldCheck size={18} /> Perform Live Face Verification
                </GoldButton>
                {verifyResult === true && (
                  <FadeScale>
                    <div className="alert-banner alert-info" style={{ marginTop: '12px' }}>
                      <CheckCircle size={18} /> Face matched — Identity Verified
                    </div>
                  </FadeScale>
                )}
                {verifyResult === false && (
                  <FadeScale>
                    <div className="alert-banner alert-critical" style={{ marginTop: '12px' }}>
                      <XCircle size={18} /> Face did not match
                    </div>
                  </FadeScale>
                )}
              </motion.div>
            )}

            {/* ======== LOAN & REPAYMENT SUMMARY ======== */}
            <motion.div
              className="glass-panel"
              style={{ padding: '32px', display: 'flex', flexDirection: 'column', gap: '24px' }}
              initial={{ opacity: 0, y: 22 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.55, delay: 0.2, ease: [0.22, 1, 0.36, 1] }}
            >
              <div className="flex-between" style={{ gap: 12, flexWrap: 'wrap' }}>
                <h3 className="serif-title" style={{ margin: 0, fontSize: '1.25rem', display: 'flex', alignItems: 'center', gap: 10 }}>
                  <span className="metal-coin" style={{ width: 34, height: 34 }}><History size={16} /></span>
                  {t('payments.summary') || 'Loan & Repayment Summary'}
                </h3>
                <GoldButton
                  type="button"
                  onClick={handleDownloadStatement}
                  disabled={statementBusy || summaryLoading || (loanSummary?.payments || []).length === 0}
                  style={{ padding: '8px 14px', fontSize: '0.875rem' }}
                >
                  <Download size={15} /> {statementBusy ? 'Generating...' : (t('payments.downloadStatement') || 'Download Statement')}
                </GoldButton>
              </div>

              {summaryLoading ? (
                <div style={{ display: 'flex', justifyContent: 'center', padding: '32px 0' }}>
                  <div className="loader-ring" style={{
                    width: 32, height: 32,
                    border: '3px solid var(--border-soft)',
                    borderTopColor: 'var(--gold)',
                    borderRadius: '50%',
                    animation: 'spin 0.8s linear infinite'
                  }} />
                </div>
              ) : (
                <>
                  {/* KPI chips */}
                  <div className="grid-cols-2" style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(150px, 1fr))', gap: 12 }}>
                    <div className="glass-card kpi-cell" style={{ padding: '16px 16px' }}>
                      <span style={{ fontSize: '0.75rem', color: 'var(--text-3)', display: 'flex', alignItems: 'center', gap: 8, textTransform: 'uppercase', letterSpacing: '0.04em' }}>
                        <Wallet size={13} /> {t('payments.activeLoans') || 'Active Loans'}
                      </span>
                      <p className="gold-gradient-text" style={{ fontSize: '1.5rem', fontWeight: 700, margin: '8px 0 0' }}>{activeLoans.length}</p>
                    </div>
                    <div className="glass-card kpi-cell" style={{ padding: '16px 16px' }}>
                      <span style={{ fontSize: '0.75rem', color: 'var(--text-3)', display: 'flex', alignItems: 'center', gap: 8, textTransform: 'uppercase', letterSpacing: '0.04em' }}>
                        <IndianRupee size={13} /> {t('payments.totalOutstanding') || 'Total Outstanding'}
                      </span>
                      <p className="gold-gradient-text" style={{ fontSize: '1.5rem', fontWeight: 700, margin: '8px 0 0' }}>
                        ₹{outstandingTotal.toLocaleString('en-IN')}
                      </p>
                    </div>
                    <div className="glass-card kpi-cell" style={{ padding: '16px 16px' }}>
                      <span style={{ fontSize: '0.75rem', color: 'var(--text-3)', display: 'flex', alignItems: 'center', gap: 8, textTransform: 'uppercase', letterSpacing: '0.04em' }}>
                        <CheckCircle size={13} /> {t('payments.totalRepaid') || 'Total Repaid'}
                      </span>
                      <p className="gold-gradient-text" style={{ fontSize: '1.5rem', fontWeight: 700, margin: '8px 0 0' }}>
                        ₹{totalRepaid.toLocaleString('en-IN')}
                      </p>
                    </div>
                    <div className="glass-card kpi-cell" style={{ padding: '16px 16px' }}>
                      <span style={{ fontSize: '0.75rem', color: 'var(--text-3)', display: 'flex', alignItems: 'center', gap: 8, textTransform: 'uppercase', letterSpacing: '0.04em' }}>
                        <ReceiptText size={13} /> {t('payments.paymentsCount') || 'Payments'}
                      </span>
                      <p className="gold-gradient-text" style={{ fontSize: '1.5rem', fontWeight: 700, margin: '8px 0 0' }}>
                        {(loanSummary?.payments || []).length}
                      </p>
                    </div>
                  </div>

                  <GoldDivider />

                  {/* Outstanding balance per loan */}
                  <div>
                    <p style={{ fontSize: '0.75rem', color: 'var(--text-2)', fontWeight: 600, margin: '0 0 12px', display: 'flex', alignItems: 'center', gap: 8 }}>
                      <IndianRupee size={14} style={{ color: 'var(--gold)' }} /> {t('payments.outstandingBalance') || 'Outstanding Balance by Loan'}
                    </p>
                    {activeLoans.length === 0 ? (
                      <p style={{ fontSize: '0.875rem', color: 'var(--text-3)', margin: 0 }}>
                        {t('payments.noActiveLoans') || 'No active loans.'}
                      </p>
                    ) : (
                      <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
                        {activeLoans.map((loan) => {
                          const due = parseFloat(loan.outstandingPrincipal ?? loan.loanAmount) || 0;
                          const disbursed = parseFloat(loan.loanAmount) || 0;
                          const paidPct = disbursed > 0 ? Math.min(100, Math.round(((disbursed - due) / disbursed) * 100)) : 0;
                          return (
                            <div key={loan.id} className="glass-card" style={{ padding: '16px 16px' }}>
                              <div className="flex-between" style={{ gap: 12, flexWrap: 'wrap' }}>
                                <div style={{ minWidth: 0 }}>
                                  <p style={{ margin: 0, fontSize: '0.875rem', fontWeight: 600, display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
                                    <span style={{ color: 'var(--text-2)', fontSize: '0.75rem', fontFamily: 'monospace' }}>{loan.id}</span>
                                    <span className={badgeClass(loan.status)}>{statusLabel(loan.status)}</span>
                                  </p>
                                  <p style={{ margin: '4px 0 0', fontSize: '0.75rem', color: 'var(--text-3)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', maxWidth: 420 }}>
                                    {loan.itemDescription || t('payments.item') || 'Item'}
                                  </p>
                                </div>
                                <p style={{ margin: 0, fontSize: '1rem', fontWeight: 700, color: 'var(--text-1)' }}>
                                  ₹{due.toLocaleString('en-IN')}
                                  <span style={{ fontSize: '0.75rem', fontWeight: 400, color: 'var(--text-3)' }}> {t('payments.principalOutstanding') || 'outstanding'}</span>
                                </p>
                              </div>
                              <div style={{ height: 6, background: 'var(--border-soft)', borderRadius: 99, marginTop: 12, overflow: 'hidden' }}>
                                <div style={{ width: `${paidPct}%`, height: '100%', background: 'linear-gradient(90deg, var(--gold), #f7c948)', borderRadius: 99, transition: 'width 0.5s ease' }} />
                              </div>
                              <p style={{ margin: '8px 0 0', fontSize: '0.75rem', color: 'var(--text-3)' }}>
                                {paidPct}% {t('payments.repaidShare') || 'repaid'}
                              </p>
                            </div>
                          );
                        })}
                      </div>
                    )}
                  </div>

                  <GoldDivider />

                  {/* Repayment timeline */}
                  <div>
                    <p style={{ fontSize: '0.75rem', color: 'var(--text-2)', fontWeight: 600, margin: '0 0 12px', display: 'flex', alignItems: 'center', gap: 8 }}>
                      <History size={14} style={{ color: 'var(--gold)' }} /> {t('payments.repaymentTimeline') || 'Repayment Timeline'}
                    </p>
                    {(loanSummary?.payments || []).length === 0 ? (
                      <p style={{ fontSize: '0.875rem', color: 'var(--text-3)', margin: 0 }}>
                        {t('payments.noPayments') || 'No payments recorded yet.'}
                      </p>
                    ) : (
                      <div style={{ display: 'flex', flexDirection: 'column' }}>
                        {(loanSummary.payments || []).slice(0, 30).map((p, idx) => (
                          <div key={p.id || idx} style={{
                            display: 'flex', gap: 16, alignItems: 'center', padding: '11px 4px',
                            borderBottom: idx === Math.min(29, (loanSummary.payments || []).length - 1) ? 'none' : '1px solid var(--border-soft)'
                          }}>
                            <div style={{ minWidth: 52, textAlign: 'center' }}>
                              <p style={{ margin: 0, fontSize: '0.75rem', fontWeight: 600, color: 'var(--text-1)' }}>
                                {new Date(p.paymentDate || p.createdAt || Date.now()).toLocaleDateString(undefined, { day: '2-digit', month: 'short' })}
                              </p>
                              <p style={{ margin: 0, fontSize: '0.75rem', color: 'var(--text-3)' }}>
                                {new Date(p.paymentDate || p.createdAt || Date.now()).toLocaleDateString(undefined, { year: 'numeric' })}
                              </p>
                            </div>
                            <span className="timeline-dot" style={{
                              width: 8, height: 8, borderRadius: '50%', background: 'var(--gold)',
                              boxShadow: '0 0 10px rgba(247,201,72,0.5)', flexShrink: 0
                            }} />
                            <div style={{ flex: 1, minWidth: 0 }}>
                              <p style={{ margin: 0, fontSize: '0.875rem', fontWeight: 600, color: 'var(--text-1)' }}>
                                ₹{(Number(p.amount) || 0).toLocaleString('en-IN')}
                                <span className="method-chip">{String(p.paymentMethod || p.paymentType || 'cash').toUpperCase()}</span>
                              </p>
                              <p style={{ margin: '2px 0 0', fontSize: '0.75rem', color: 'var(--text-3)', display: 'flex', gap: 12, flexWrap: 'wrap' }}>
                                {p.interestPaid > 0 && <span>{(t('payments.interestPortion') || 'Interest') + ': '}₹{Math.round(Number(p.interestPaid)).toLocaleString('en-IN')}</span>}
                                {p.principalPaid > 0 && <span>{(t('payments.principalPortion') || 'Principal') + ': '}₹{Math.round(Number(p.principalPaid)).toLocaleString('en-IN')}</span>}
                                {p.newOutstanding != null && <span>{(t('payments.remainingAfter') || 'Outstanding After') + ': '}₹{Math.round(Number(p.newOutstanding)).toLocaleString('en-IN')}</span>}
                                {p.collectedBy && <span>{(t('payments.collectedBy') || 'By') + ': '}{p.collectedBy}</span>}
                              </p>
                            </div>
                          </div>
                        ))}
                      </div>
                    )}
                  </div>
                </>
              )}
            </motion.div>

            {/* ======== SAVE ======== */}
            <GoldButton
              type="submit"
              style={{ padding: '16px', fontSize: '1rem', '': '32px' }}
              disabled={saving}
            >
              <Save size={18} /> {saving ? 'Saving...' : 'Save All Changes'}
            </GoldButton>

          </form>
        </PageTransition>
      </main>

      {/* Face Verification Modal */}
      <AnimatePresence>
        {showVerifyModal && merged.faceEmbedding && (
          <motion.div
            className="modal-overlay"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.25 }}
          >
            <motion.div
              className="glass-panel modal-content"
              style={{ padding: '32px' }}
              initial={{ opacity: 0, y: 26, scale: 0.95 }}
              animate={{ opacity: 1, y: 0, scale: 1 }}
              exit={{ opacity: 0, y: 16, scale: 0.96 }}
              transition={{ duration: 0.35, ease: [0.22, 1, 0.36, 1] }}
            >
              <h3 className="serif-title" style={{ margin: '0 0 20px', fontSize: '1.25rem', display: 'flex', alignItems: 'center', gap: 10 }}>
                <KeyRound size={18} style={{ color: 'var(--gold)' }} />
                Face Verification — {merged.name}
              </h3>
              <FaceScanner mode="verify" referenceDescriptor={merged.faceEmbedding} onResult={(r) => setVerifyResult(r)} />
              <div style={{ '': '24px', display: 'flex', justifyContent: 'flex-end' }}>
                <button onClick={() => { setShowVerifyModal(false); setVerifyResult(null); }} className="btn btn-secondary">
                  Close
                </button>
              </div>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>

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
            <div className="glass-panel modal-content"
              style={{ maxWidth: '85vw', maxHeight: '85vh', padding: '16px', position: 'relative', display: 'flex', alignItems: 'center', justifyContent: 'center' }}
              onClick={(e) => e.stopPropagation()}>
              <button type="button" className="btn btn-secondary" onClick={() => setModalImageSrc(null)}
                style={{ position: 'absolute', top: '10px', right: '10px', padding: '8px 12px', minWidth: 'auto' }}>
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
