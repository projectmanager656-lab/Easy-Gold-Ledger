import React, { useState, useEffect, useRef } from 'react';
import { useTranslation } from 'react-i18next';
import { useNavigate } from 'react-router-dom';
import { motion, AnimatePresence } from 'framer-motion';
import { collection, onSnapshot, query, where, doc, getDoc, updateDoc } from 'firebase/firestore';
import { db } from '../services/firebase';
import { registerCustomer, updateUserStatus, updateCustomerEmail, logAudit } from '../services/firebaseService';
import { compressImage, drawGpsWatermark } from '../utils/imageCompressor';
import SignaturePad from '../components/SignaturePad';
import FaceScanner from '../components/FaceScanner';
import {
  PageHeader,
  StaggerGroup,
  FadeScale,
  EmptyState,
  GoldButton,
  StatCard,
  GoldDivider,
  useGreeting
} from '../components/PremiumUI';
import {
  UserPlus,
  Search,
  Users,
  User,
  UserX,
  ShieldCheck,
  MapPin,
  CheckCircle,
  XCircle,
  AlertTriangle,
  Key,
  Camera,
  Eye,
  EyeOff,
  ArrowRight,
  ScanLine
} from 'lucide-react';

// Session-level GPS cache: lets back-to-back photo captures (face scan,
// webcam, file uploads) reuse the last resolved position instantly.
let lastKnownCoords = null;
// GPS is probed at most once per session; after a failure the fallback
// chain (IP geolocation) is used directly for all subsequent photos.
let gpsAttempted = false;

export default function CustomerManagement() {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const [role] = useState(localStorage.getItem('user_role') || 'employee');
  const greeting = useGreeting();

  // Search & List State
  const [customers, setCustomers] = useState([]);
  const [searchQuery, setSearchQuery] = useState('');
  const [selectedCustomer, setSelectedCustomer] = useState(null);

  // Form State
  const [showAddForm, setShowAddForm] = useState(false);
  const [name, setName] = useState('');
  const [phone, setPhone] = useState('');
  const [address, setAddress] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [photo, setPhoto] = useState('');
  const [idProof, setIdProof] = useState('');
  const [signature, setSignature] = useState('');
  const [faceEmbedding, setFaceEmbedding] = useState(null);
  const [facePhoto, setFacePhoto] = useState('');

  // Form Operations State
  const [loading, setLoading] = useState(false);
  const [formError, setFormError] = useState('');
  const [formSuccess, setFormSuccess] = useState(false);
  const [showCustPassword, setShowCustPassword] = useState(false);

  // Live webcam capture and GPS coordinates state
  const photoVideoRef = useRef(null);
  const [photoStream, setPhotoStream] = useState(null);
  const [useLiveCam, setUseLiveCam] = useState(false);
  const [liveCamActive, setLiveCamActive] = useState(false);
  const [gpsCoords, setGpsCoords] = useState(null);
  const [gpsError, setGpsError] = useState('');

  // Editing States
  const [showEmailModal, setShowEmailModal] = useState(false);
  const [newEmailInput, setNewEmailInput] = useState('');

  // Edit Profile Modal State
  const [showEditModal, setShowEditModal] = useState(false);
  const [editName, setEditName] = useState('');
  const [editPhone, setEditPhone] = useState('');
  const [editAddress, setEditAddress] = useState('');
  const [editPhoto, setEditPhoto] = useState('');
  const [editLoading, setEditLoading] = useState(false);
  const [editError, setEditError] = useState('');

  // Live Verification state
  const [showVerifyModal, setShowVerifyModal] = useState(false);
  const [verifyResult, setVerifyResult] = useState(null);

  // Lightbox view state
  const [modalImageSrc, setModalImageSrc] = useState(null);

  // Fetch Customers real-time
  useEffect(() => {
    const q = query(collection(db, 'users'), where('role', '==', 'customer'));
    const unsubscribe = onSnapshot(q, (snap) => {
      const list = snap.docs.map(doc => ({ id: doc.id, ...doc.data() }));
      setCustomers(list);
    });
    return unsubscribe;
  }, []);

  // Fetch Extended Customer Details on selection
  const selectCustomerDetails = async (cust) => {
    try {
      const custDocSnap = await getDoc(doc(db, 'customers', cust.id));
      if (custDocSnap.exists()) {
        setSelectedCustomer({ ...cust, ...custDocSnap.data() });
      } else {
        setSelectedCustomer(cust);
      }
    } catch (e) {
      console.error(e);
      setSelectedCustomer(cust);
    }
  };

  // Update full customer profile (name, phone, address, photo)
  const handleUpdateProfile = async (e) => {
    e.preventDefault();
    if (!selectedCustomer) return;
    setEditLoading(true);
    setEditError('');
    try {
      const userRef = doc(db, 'users', selectedCustomer.id);
      const custRef = doc(db, 'customers', selectedCustomer.id);

      const userUpdates = {};
      const custUpdates = {};

      if (editName.trim()) userUpdates.name = editName.trim();
      if (editPhone.trim()) userUpdates.phone = editPhone.trim();
      if (editPhoto) userUpdates.photoBase64 = editPhoto;
      if (editAddress.trim()) custUpdates.address = editAddress.trim();

      if (Object.keys(userUpdates).length > 0) await updateDoc(userRef, userUpdates);
      if (Object.keys(custUpdates).length > 0) await updateDoc(custRef, custUpdates);

      await logAudit('update_customer_profile', 'customers', selectedCustomer.id, null, { ...userUpdates, ...custUpdates });

      // Refresh the selected customer details
      await selectCustomerDetails({ ...selectedCustomer, ...userUpdates });
      setShowEditModal(false);
    } catch (err) {
      console.error(err);
      setEditError('Failed to update profile: ' + err.message);
    } finally {
      setEditLoading(false);
    }
  };

  // Open edit modal prefilled with current values
  const openEditModal = () => {
    if (!selectedCustomer) return;
    setEditName(selectedCustomer.name || '');
    setEditPhone(selectedCustomer.phone || '');
    setEditAddress(selectedCustomer.address || '');
    setEditPhoto('');
    setEditError('');
    setShowEditModal(true);
  };

  // Fetch IP Geolocation fallback when HTML5 GPS is blocked
  const fetchIpGeolocation = async () => {
    try {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), 2500);
      const response = await fetch('https://ipapi.co/json/', { signal: controller.signal });
      clearTimeout(timer);
      if (response.ok) {
        const data = await response.json();
        if (data && data.latitude && data.longitude) {
          const address = `${data.city ? data.city + ', ' : ''}${data.region ? data.region + ', ' : ''}${data.country_name || ''}`;
          return {
            latitude: data.latitude,
            longitude: data.longitude,
            address: address || 'IP Geolocation'
          };
        }
      }
    } catch (e) {
      console.debug('Error fetching IP Geolocation:', e);
    }
    return null;
  };

  // Reverse geocode details from OpenStreetMap
  const getAddressFromCoords = async (lat, lon) => {
    if (lat === 0 && lon === 0) return '';
    try {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), 3000);
      const response = await fetch(`https://nominatim.openstreetmap.org/reverse?format=json&lat=${lat}&lon=${lon}`, {
        headers: {
          'Accept-Language': 'en'
        },
        signal: controller.signal
      });
      clearTimeout(timer);
      if (response.ok) {
        const data = await response.json();
        return data.display_name || '';
      }
    } catch (e) {
      console.error('Error reverse geocoding:', e);
    }
    return 'Precise Location Address';
  };

  // Watermark applier helper
  const applyWatermarkToImage = async (base64Img, coords) => {
    const activeCoords = coords || gpsCoords;
    let lat = 0;
    let lon = 0;
    let addressName = '';
    
    if (activeCoords) {
      lat = activeCoords.latitude;
      lon = activeCoords.longitude;
      addressName = await getAddressFromCoords(lat, lon);
    }
    
    const watermarked = await drawGpsWatermark(
      base64Img, 
      lat, 
      lon, 
      addressName || (activeCoords ? 'Precise Location Address' : 'GPS Location Unavailable (Permission Blocked)')
    );
    return watermarked;
  };

  // GPS retrieval helper
  const fetchGpsLocation = () => {
    if (gpsAttempted) return;
    if (navigator.geolocation) {
      gpsAttempted = true;
      navigator.geolocation.getCurrentPosition(
        (position) => {
          const coords = {
            latitude: position.coords.latitude,
            longitude: position.coords.longitude,
            accuracy: position.coords.accuracy
          };
          lastKnownCoords = coords;
          setGpsCoords(coords);
          setGpsError('');
        },
        async (error) => {
          console.debug('HTML5 GPS failed, trying IP fallback:', error);
          const ipLoc = await fetchIpGeolocation();
          if (ipLoc) {
            lastKnownCoords = ipLoc;
            setGpsCoords(ipLoc);
            setGpsError('');
          } else {
            setGpsError('GPS permission denied or unavailable.');
          }
        },
        { enableHighAccuracy: false, timeout: 3000 }
      );
    } else {
      fetchIpGeolocation().then(ipLoc => {
        if (ipLoc) {
          lastKnownCoords = ipLoc;
          setGpsCoords(ipLoc);
        } else {
          setGpsError('Geolocation is not supported by this browser.');
        }
      });
    }
  };

  // Fast coords resolution for photo watermarking: reuse the last known
  // position from this session, otherwise GPS (3s cap), otherwise IP fallback.
  const acquireCoords = async () => {
    if (lastKnownCoords) return lastKnownCoords;

    if (navigator.geolocation && !gpsAttempted) {
      gpsAttempted = true;
      try {
        const position = await new Promise((resolve, reject) => {
          navigator.geolocation.getCurrentPosition(resolve, reject, {
            enableHighAccuracy: false,
            timeout: 3000,
            maximumAge: 60000
          });
        });
        const coords = {
          latitude: position.coords.latitude,
          longitude: position.coords.longitude,
          accuracy: position.coords.accuracy
        };
        lastKnownCoords = coords;
        setGpsCoords(coords);
        setGpsError('');
        return coords;
      } catch (err) {
        console.debug('HTML5 GPS failed, trying IP fallback:', err);
      }
    }

    const ipLoc = await fetchIpGeolocation();
    if (ipLoc) {
      lastKnownCoords = ipLoc;
      setGpsCoords(ipLoc);
      setGpsError('');
      return ipLoc;
    }

    setGpsError('GPS permission denied or unavailable.');
    return null;
  };

  // Bind webcam stream to Customer photo video element when it mounts
  useEffect(() => {
    if (photoVideoRef.current && photoStream) {
      photoVideoRef.current.srcObject = photoStream;
    }
  }, [photoStream, liveCamActive]);

  // Webcam helpers for customer profile photo
  const startPhotoCamera = async () => {
    try {
      const mediaStream = await navigator.mediaDevices.getUserMedia({
        video: { width: 320, height: 320, facingMode: 'user' }
      });
      setPhotoStream(mediaStream);
      setLiveCamActive(true);
      fetchGpsLocation(); // Fetch GPS location on camera init
    } catch (err) {
      console.error('Error starting photo camera:', err);
      setFormError('Could not access camera for photo capture.');
    }
  };

  const capturePhotoFromStream = async () => {
    if (!photoVideoRef.current || !photoStream) return;
    
    const canvas = document.createElement('canvas');
    canvas.width = 640;
    canvas.height = 480;
    const ctx = canvas.getContext('2d');
    
    ctx.drawImage(photoVideoRef.current, 0, 0, 640, 480);
    const rawBase64 = canvas.toDataURL('image/jpeg', 0.85);
    stopPhotoCamera();

    const coords = await acquireCoords();
    const watermarked = await applyWatermarkToImage(rawBase64, coords);
    setPhoto(watermarked);
  };

  const stopPhotoCamera = () => {
    if (photoStream) {
      photoStream.getTracks().forEach(t => t.stop());
      setPhotoStream(null);
    }
    setLiveCamActive(false);
  };

  // Upload/Compression helper for photos
  const handleImageUpload = async (e, type) => {
    const file = e.target.files[0];
    if (!file) return;

    try {
      const compressed = await compressImage(file, 800, 0.6);
      if (type === 'photo') {
        const coords = await acquireCoords();
        const watermarked = await applyWatermarkToImage(compressed, coords);
        setPhoto(watermarked);
      }
      if (type === 'id') setIdProof(compressed);
    } catch (err) {
      console.error(err);
      setFormError('Failed to process image. Make sure it is an image file.');
    }
  };

  // Face Scan KYC photo result handler
  const handleFaceScanResult = async (descriptor, rawFacePhoto) => {
    setFaceEmbedding(descriptor);
    if (rawFacePhoto) {
      const coords = await acquireCoords();
      const watermarked = await applyWatermarkToImage(rawFacePhoto, coords);
      setFacePhoto(watermarked);
    }
  };

  const handleRegister = async (e) => {
    e.preventDefault();
    setFormError('');
    setFormSuccess(false);

    if (!name || !phone || !email || !password) {
      setFormError(t('customers.errorRequiredFields'));
      return;
    }

    if (!faceEmbedding) {
      setFormError(t('customers.errorFaceScanRequired'));
      return;
    }

    if (!signature) {
      setFormError(t('customers.errorSignatureRequired'));
      return;
    }

    setLoading(true);

    try {
      await registerCustomer({
        email,
        password,
        name,
        phone,
        address,
        photoBase64: photo,
        faceEmbedding,
        facePhotoBase64: facePhoto,
        idProofBase64: idProof,
        signatureBase64: signature,
        gpsLocation: gpsCoords
      });

      setFormSuccess(true);
      // Reset Form fields
      setName('');
      setPhone('');
      setAddress('');
      setEmail('');
      setPassword('');
      setPhoto('');
      setFacePhoto('');
      setIdProof('');
      setSignature('');
      setFaceEmbedding(null);
      setGpsCoords(null);
      setUseLiveCam(false);
      setTimeout(() => {
        setShowAddForm(false);
        setFormSuccess(false);
      }, 2000);
    } catch (err) {
      console.error(err);
      setFormError(err.message || 'Registration failed.');
    } finally {
      setLoading(false);
    }
  };

  const handleToggleStatus = async (uid, currentStatus) => {
    try {
      const nextStatus = currentStatus === 'active' ? 'inactive' : 'active';
      await updateUserStatus(uid, nextStatus);
      if (selectedCustomer && selectedCustomer.id === uid) {
        setSelectedCustomer(prev => ({ ...prev, status: nextStatus }));
      }
    } catch (err) {
      console.error(err);
    }
  };

  const handleEmailUpdate = async (e) => {
    e.preventDefault();
    if (!newEmailInput || !selectedCustomer) return;

    try {
      await updateCustomerEmail(selectedCustomer.id, newEmailInput);
      setSelectedCustomer(prev => ({ ...prev, email: newEmailInput }));
      setShowEmailModal(false);
      setNewEmailInput('');
    } catch (err) {
      console.error(err);
      alert('Failed to update email address.');
    }
  };

  const handleVerifyFace = (result) => {
    setVerifyResult(result);
  };

  // Filter customers list client-side
  const filteredCustomers = customers.filter(c => {
    const query = searchQuery.toLowerCase();
    return (
      c.name?.toLowerCase().includes(query) ||
      c.phone?.includes(query) ||
      c.id?.toLowerCase().includes(query)
    );
  });

  const activeCount = customers.filter(c => c.status === 'active').length;
  const inactiveCount = customers.length - activeCount;

  return (
    <div className="app-container">
      <main className="main-content">

        {/* Page Header */}
        <PageHeader
          eyebrow={greeting}
          title={t('customers.title')}
          subtitle={t('customers.subtitle')}
          actions={
            <GoldButton onClick={() => setShowAddForm(!showAddForm)}>
              <UserPlus size={18} />
              <span>{showAddForm ? t('customers.viewRegistry') : t('customers.addNew')}</span>
            </GoldButton>
          }
        />

        <AnimatePresence mode="wait">
          {showAddForm ? (
            /* ============ ADD CUSTOMER FORM ============ */
            <motion.div
              key="add-form"
              initial={{ opacity: 0, y: 24, scale: 0.985 }}
              animate={{ opacity: 1, y: 0, scale: 1 }}
              exit={{ opacity: 0, y: -12, scale: 0.99 }}
              transition={{ duration: 0.5, ease: [0.22, 1, 0.36, 1] }}
            >
              <div className="glass-panel add-customer-panel" style={{ padding: '32px', maxWidth: '820px', margin: '0 auto' }}>
                <div className="flex-between" style={{ marginBottom: '24px' }}>
                  <div>
                    <h3 className="serif-title" style={{ fontSize: '1.5rem' }}>{t('customers.addNew')}</h3>
                    <p style={{ color: 'var(--text-2)', fontSize: '0.875rem', marginTop: 4 }}>
                      {t('customers.subtitle')}
                    </p>
                  </div>
                  <span className="customer-count-chip">
                    <ScanLine size={14} />
                    KYC ONBOARDING
                  </span>
                </div>

                {formError && (
                  <FadeScale>
                    <div className="alert-banner alert-critical" style={{ marginBottom: 20 }}>
                      <XCircle size={20} />
                      <span>{formError}</span>
                    </div>
                  </FadeScale>
                )}

                {formSuccess && (
                  <FadeScale>
                    <div className="alert-banner alert-info" style={{ marginBottom: 20 }}>
                      <CheckCircle size={20} />
                      <span>{t('customers.registeredSuccess')}</span>
                    </div>
                  </FadeScale>
                )}

                <form onSubmit={handleRegister} style={{ display: 'flex', flexDirection: 'column', gap: '22px' }}>

                  <div className="grid-cols-2">
                    <div className="form-group">
                      <label>{t('customers.fullName')}</label>
                      <input
                        type="text"
                        placeholder={t('customers.fullName')}
                        value={name}
                        onChange={(e) => setName(e.target.value)}
                        required
                      />
                    </div>
                    <div className="form-group">
                      <label>{t('customers.phone')}</label>
                      <input
                        type="tel"
                        placeholder="e.g. +91 98765 43210"
                        value={phone}
                        onChange={(e) => setPhone(e.target.value)}
                        required
                      />
                    </div>
                  </div>

                  <div className="form-group">
                    <label>{t('customers.address')}</label>
                    <textarea
                      rows="2"
                      placeholder={t('customers.addressPlaceholder')}
                      value={address}
                      onChange={(e) => setAddress(e.target.value)}
                    />
                  </div>

                  <div className="form-section">
                    <h4 className="gold-gradient-text">
                      <Key size={16} style={{ verticalAlign: '-3px', marginRight: 8 }} />
                      {t('customers.loginCredentials')}
                    </h4>
                    <div className="form-section-line" />
                  </div>

                  <div className="grid-cols-2">
                    <div className="form-group">
                      <label>{t('login.email')}</label>
                      <input
                        type="email"
                        placeholder="customer@email.com"
                        value={email}
                        onChange={(e) => setEmail(e.target.value)}
                        required
                      />
                    </div>
                    <div className="form-group">
                      <label>{t('login.password')}</label>
                      <div style={{ position: 'relative' }}>
                        <input
                          type={showCustPassword ? 'text' : 'password'}
                          placeholder={t('customers.tempPasswordPlaceholder')}
                          value={password}
                          onChange={(e) => setPassword(e.target.value)}
                          required
                          style={{ paddingRight: '48px' }}
                        />
                        <button
                          type="button"
                          onClick={() => setShowCustPassword(!showCustPassword)}
                          style={{
                            position: 'absolute', right: '14px', top: '50%', transform: 'translateY(-50%)',
                            background: 'transparent', border: 'none', cursor: 'pointer',
                            color: 'var(--text-muted)', display: 'flex', alignItems: 'center', padding: '4px'
                          }}
                          tabIndex={-1}
                          aria-label={showCustPassword ? 'Hide password' : 'Show password'}
                        >
                          {showCustPassword ? <EyeOff size={18} /> : <Eye size={18} />}
                        </button>
                      </div>
                    </div>
                  </div>

                  <div className="form-section">
                    <h4 className="gold-gradient-text">
                      <ShieldCheck size={16} style={{ verticalAlign: '-3px', marginRight: 8 }} />
                      {t('customers.faceVerificationAndIdentity')}
                    </h4>
                    <div className="form-section-line" />
                  </div>

                  {/* Face Scanner */}
                  <FaceScanner
                    mode="register"
                    onResult={handleFaceScanResult}
                  />
                  {faceEmbedding && facePhoto && (
                    <div style={{ display: 'flex', flexDirection: 'column', gap: '12px', '': '12px' }}>
                      <label>{t('customers.photo')} — Scanned Face (Click to zoom)</label>
                      <img
                        src={facePhoto}
                        alt="Scanned Face"
                        onClick={() => setModalImageSrc(facePhoto)}
                        className="upload-preview"
                      />
                    </div>
                  )}
                  {faceEmbedding && (
                    <div className="check-pop">
                      <CheckCircle size={18} />
                      <span>{t('customers.faceEmbeddingReady')}</span>
                    </div>
                  )}

                  {/* Upload fields */}
                  <div className="grid-cols-2">
                    <div className="glass-card" style={{ display: 'flex', flexDirection: 'column', gap: '16px', padding: 20 }}>
                      <label>{t('customers.photo')}</label>

                      {/* Mode Selector */}
                      <div className="mode-tabs" style={{ alignSelf: 'flex-start' }}>
                        <button
                          type="button"
                          onClick={() => { setUseLiveCam(false); stopPhotoCamera(); }}
                          className={`tab-btn ${!useLiveCam ? 'active' : ''}`}
                        >
                          <ScanLine size={13} />
                          {t('customers.uploadFile')}
                        </button>
                        <button
                          type="button"
                          onClick={() => { setUseLiveCam(true); startPhotoCamera(); }}
                          className={`tab-btn ${useLiveCam ? 'active' : ''}`}
                        >
                          <Camera size={13} />
                          {t('customers.useCamera')}
                        </button>
                      </div>

                      {!useLiveCam ? (
                        <input
                          type="file"
                          accept="image/*"
                          onChange={(e) => handleImageUpload(e, 'photo')}
                        />
                      ) : (
                        <div style={{ display: 'flex', flexDirection: 'column', gap: '16px', alignItems: 'center' }}>
                          {liveCamActive ? (
                            <div className="cam-frame">
                              <video
                                ref={photoVideoRef}
                                autoPlay
                                playsInline
                                muted
                              />
                            </div>
                          ) : (
                            <p style={{ fontSize: '0.875rem', color: 'var(--text-2)' }}>
                              {t('common.loading')}...
                            </p>
                          )}

                          {liveCamActive && (
                            <button
                              type="button"
                              onClick={capturePhotoFromStream}
                              className="capture-ring"
                              aria-label={t('customers.takeSnapshot')}
                            >
                              <Camera size={22} />
                            </button>
                          )}
                        </div>
                      )}

                      {photo && (
                        <img
                          src={photo}
                          alt="Customer Profile"
                          onClick={() => setModalImageSrc(photo)}
                          className="upload-preview"
                        />
                      )}

                      {gpsCoords && (
                        <div className="gps-chip">
                          <MapPin size={14} />
                          <span>{t('customers.gpsTracked')}: {gpsCoords.latitude.toFixed(6)}, {gpsCoords.longitude.toFixed(6)}</span>
                        </div>
                      )}
                      {gpsError && (
                        <div className="gps-chip warn">
                          <div style={{ display: 'flex', alignItems: 'center', gap: '8px', fontWeight: '600' }}>
                            <AlertTriangle size={14} style={{ color: 'var(--warning)', flexShrink: 0 }} />
                            <span>GPS Permission Blocked / inaccurate</span>
                          </div>
                          <p style={{ color: 'var(--text-2)', fontSize: '0.75rem', lineHeight: '1.5', margin: 0 }}>
                            To get 100% accurate location details: Click the lock icon (🔒) or settings icon in your browser's address bar, set <strong>Location</strong> to <strong>Allow</strong>, and then click "Try Again" below.
                          </p>
                          <button
                            type="button"
                            onClick={fetchGpsLocation}
                            className="btn btn-secondary retry-btn"
                          >
                            Try Again
                          </button>
                        </div>
                      )}
                    </div>
                    <div className="glass-card" style={{ display: 'flex', flexDirection: 'column', gap: '12px', padding: 20 }}>
                      <label>{t('customers.kycDoc')}</label>
                      <input
                        type="file"
                        accept="image/*"
                        onChange={(e) => handleImageUpload(e, 'id')}
                      />
                      {idProof && (
                        <img
                          src={idProof}
                          alt="KYC ID Proof"
                          className="upload-preview id"
                          onClick={() => setModalImageSrc(idProof)}
                        />
                      )}
                    </div>
                  </div>

                  {/* Signature Canvas Pad */}
                  <SignaturePad onSave={(sig) => setSignature(sig)} />
                  {signature && (
                    <div className="check-pop">
                      <CheckCircle size={18} />
                      <span>{t('customers.signatureCaptured')}</span>
                    </div>
                  )}

                  <GoldButton
                    type="submit"
                    style={{ padding: '16px', '': '8px', fontSize: '1rem' }}
                    disabled={loading}
                  >
                    {loading ? t('common.loading') : t('customers.register')}
                  </GoldButton>
                </form>
              </div>
            </motion.div>
          ) : (
            /* ============ SEARCH & REGISTRY ============ */
            <motion.div
              key="registry"
              initial={{ opacity: 0, y: 24 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -12 }}
              transition={{ duration: 0.5, ease: [0.22, 1, 0.36, 1] }}
            >
              <div style={{ width: '100%' }}>

                {/* Stats row */}
                <StaggerGroup className="kpi-container" style={{ marginBottom: '24px' }}>
                  <StatCard
                    icon={<Users size={22} />}
                    iconClass="gold"
                    label={t('customers.title')}
                    value={customers.length}
                    delay={0}
                  />
                  <StatCard
                    icon={<ShieldCheck size={22} />}
                    iconClass="green"
                    label={t('customers.active')}
                    value={activeCount}
                    delay={0.08}
                  />
                  <StatCard
                    icon={<UserX size={22} />}
                    iconClass="red"
                    label={t('customers.inactive')}
                    value={inactiveCount}
                    delay={0.16}
                  />
                </StaggerGroup>

                {/* Customer List Panel */}
                <div className="glass-panel" style={{ padding: '24px', width: '100%' }}>

                  {/* Search Bar */}
                  <div className="flex-between" style={{ marginBottom: '16px', gap: 16, flexWrap: 'wrap' }}>
                    <div className="search-field" style={{ flex: 1, minWidth: 240, maxWidth: 420 }}>
                      <Search size={18} />
                      <input
                        type="text"
                        placeholder={t('customers.search')}
                        value={searchQuery}
                        onChange={(e) => setSearchQuery(e.target.value)}
                      />
                    </div>
                    <span className="customer-count-chip">
                      <Users size={14} />
                      {customers.length} REGISTERED
                    </span>
                  </div>

                  <GoldDivider />

                  {/* Customer table */}
                  {filteredCustomers.length === 0 ? (
                    <EmptyState
                      icon={<Users size={34} />}
                      title={t('customers.title')}
                      message={t('common.noRecords')}
                      action={
                        <GoldButton onClick={() => setShowAddForm(true)}>
                          <UserPlus size={18} />
                          <span>{t('customers.addNew')}</span>
                        </GoldButton>
                      }
                    />
                  ) : (
                    <div className="table-container responsive-table-card" style={{ marginTop: 18 }}>
                      <table>
                        <thead>
                          <tr>
                            <th>{t('customers.fullName')}</th>
                            <th>{t('customers.phone')}</th>
                            <th>{t('login.email')}</th>
                            <th>{t('common.status')}</th>
                            <th style={{ textAlign: 'right' }}>{t('common.actions')}</th>
                          </tr>
                        </thead>
                        <tbody>
                          {filteredCustomers.map((cust, idx) => (
                            <motion.tr
                              key={cust.id}
                              className="table-row-glow"
                              style={{ cursor: 'pointer' }}
                              onClick={() => navigate(`/customers/${cust.id}`)}
                              initial={{ opacity: 0, x: -14 }}
                              animate={{ opacity: 1, x: 0 }}
                              transition={{ duration: 0.4, delay: idx * 0.045, ease: [0.22, 1, 0.36, 1] }}
                            >
                              <td data-label={t('customers.fullName')}>
                                <div className="flex-gap">
                                  {cust.photoBase64 ? (
                                    <div className="avatar-ring">
                                      <img src={cust.photoBase64} alt={cust.name} className="avatar avatar-sm" />
                                    </div>
                                  ) : (
                                    <div className="avatar avatar-sm avatar-fallback" style={{ flexShrink: 0 }}>
                                      <User size={16} />
                                    </div>
                                  )}
                                  <span style={{ fontWeight: 600 }}>{cust.name}</span>
                                </div>
                              </td>
                              <td data-label={t('customers.phone')} style={{ color: 'var(--text-2)' }}>{cust.phone}</td>
                              <td data-label={t('login.email')} style={{ color: 'var(--text-2)' }}>{cust.email}</td>
                              <td data-label={t('common.status')}>
                                <span className={`badge ${cust.status === 'active' ? 'badge-closed' : 'badge-forfeited'}`}>
                                  {cust.status === 'active' ? t('customers.active') : t('customers.inactive')}
                                </span>
                              </td>
                              <td data-label={t('common.actions')} style={{ textAlign: 'right' }}>
                                <button
                                  className="btn btn-secondary"
                                  style={{ padding: '8px 12px', fontSize: '0.875rem' }}
                                  onClick={(e) => { e.stopPropagation(); navigate(`/customers/${cust.id}`); }}
                                >
                                  {t('customers.viewDetails')}
                                  <ArrowRight size={14} />
                                </button>
                              </td>
                            </motion.tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  )}
                </div>
              </div>
            </motion.div>
          )}
        </AnimatePresence>

      </main>

      {/* Lightbox Image Preview Modal */}
      {modalImageSrc && (
        <div className="modal-overlay" onClick={() => setModalImageSrc(null)}>
          <div className="glass-panel modal-content" style={{ maxWidth: '85vw', maxHeight: '85vh', padding: '16px', position: 'relative', display: 'flex', alignItems: 'center', justifyContent: 'center' }} onClick={(e) => e.stopPropagation()}>
            <button
              type="button"
              className="btn btn-secondary"
              onClick={() => setModalImageSrc(null)}
              style={{ position: 'absolute', top: '10px', right: '10px', padding: '8px 12px', minWidth: 'auto', zIndex: 100 }}
            >
              ✕
            </button>
            <img
              src={modalImageSrc}
              alt="Preview"
              style={{ maxWidth: '100%', maxHeight: '80vh', objectFit: 'contain', borderRadius: '8px' }}
            />
          </div>
        </div>
      )}

    </div>
  );
}
