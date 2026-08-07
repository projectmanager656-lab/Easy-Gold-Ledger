import React, { useRef, useState, useEffect } from 'react';
import { useTranslation } from 'react-i18next';
import { loadFaceModels, getFaceDescriptor, verifyFaceMatch } from '../utils/faceVerifier';
import { Camera, RefreshCw, CheckCircle, AlertTriangle, ScanFace } from 'lucide-react';
import { GoldButton } from './PremiumUI';

export default function FaceScanner({ mode = 'register', referenceDescriptor = null, onResult }) {
  const { t } = useTranslation();
  const videoRef = useRef(null);
  const [stream, setStream] = useState(null);
  const [loadingModels, setLoadingModels] = useState(true);
  const [cameraActive, setCameraActive] = useState(false);
  const [scanning, setScanning] = useState(false);
  const [feedback, setFeedback] = useState('');
  const [matchState, setMatchState] = useState({ isMatch: false, distance: null, checked: false });

  // Load models on mount
  useEffect(() => {
    loadFaceModels()
      .then(() => setLoadingModels(false))
      .catch((err) => {
        console.error(err);
        setFeedback('Error loading face recognition models.');
      });

    return () => {
      stopCamera();
    };
  }, []);

  // Bind webcam stream to video element when it mounts
  useEffect(() => {
    if (videoRef.current && stream) {
      videoRef.current.srcObject = stream;
    }
  }, [stream, cameraActive]);

  const startCamera = async () => {
    setMatchState({ isMatch: false, distance: null, checked: false });
    setFeedback('');
    try {
      const mediaStream = await navigator.mediaDevices.getUserMedia({
        video: { width: 640, height: 480, facingMode: 'user' }
      });
      setStream(mediaStream);
      setCameraActive(true);
    } catch (err) {
      console.error('Error accessing camera:', err);
      setFeedback('Camera access denied or unavailable.');
    }
  };

  const stopCamera = () => {
    if (stream) {
      stream.getTracks().forEach((track) => track.stop());
      setStream(null);
    }
    setCameraActive(false);
    setScanning(false);
  };

  const captureFace = async () => {
    if (!videoRef.current || !cameraActive || scanning) return;

    setScanning(true);
    setFeedback('Analyzing face... Keep still.');

    try {
      const descriptor = await getFaceDescriptor(videoRef.current);
      
      if (!descriptor) {
        setFeedback('No face detected. Please adjust lighting and align face inside the guide.');
        setScanning(false);
        return;
      }

      if (mode === 'register') {
        let facePhoto = '';
        if (videoRef.current) {
          const canvas = document.createElement('canvas');
          canvas.width = videoRef.current.videoWidth || 640;
          canvas.height = videoRef.current.videoHeight || 480;
          const ctx = canvas.getContext('2d');
          ctx.drawImage(videoRef.current, 0, 0, canvas.width, canvas.height);
          facePhoto = canvas.toDataURL('image/jpeg', 0.85);
        }

        setFeedback('Face scanner KYC successful!');
        onResult(descriptor, facePhoto);
        stopCamera();
      } else if (mode === 'verify' && referenceDescriptor) {
        const { isMatch, distance } = verifyFaceMatch(descriptor, referenceDescriptor);
        setMatchState({ isMatch, distance, checked: true });
        
        if (isMatch) {
          setFeedback(t('customers.matchSuccess'));
        } else {
          setFeedback(t('customers.matchFailed'));
        }
        onResult({ isMatch, descriptor, distance });
        stopCamera();
      }
    } catch (err) {
      console.error('Error during face scan:', err);
      setFeedback('An error occurred during scanning. Please try again.');
    } finally {
      setScanning(false);
    }
  };

  return (
    <div className="glass-card" style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '15px' }}>
      <label style={{ alignSelf: 'flex-start', display: 'flex', alignItems: 'center', gap: 8 }}>
        <ScanFace size={15} style={{ color: 'var(--gold)' }} />
        {t('customers.faceScan')}
      </label>

      {loadingModels ? (
        <div className="flex-gap" style={{ padding: '24px', fontSize: '1rem' }}>
          <div className="gold-spinner"></div>
          <span style={{ color: 'var(--text-3)' }}>Loading Face Detection AI Models...</span>
        </div>
      ) : (
        <div style={{ width: '100%', display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '15px' }}>
          
          {cameraActive ? (
            <div className={`camera-box ${scanning ? 'scanning' : ''}`} style={{ position: 'relative' }}>
              <video
                ref={videoRef}
                autoPlay
                playsInline
                muted
                style={{ width: '100%', height: '100%', objectFit: 'cover' }}
              />
              <div className="camera-overlay">
                <div className="scanner-guide">
                  <div className="scanner-line"></div>
                </div>
              </div>
            </div>
          ) : (
            <div
              className="cam-frame"
              style={{ width: '100%', maxWidth: '480px', aspectRatio: '4 / 3' }}
              onClick={startCamera}
            >
              <div className="cam-frame-inner">
                <ScanFace size={44} style={{ color: 'var(--gold)' }} />
                <span>Click to start Camera scanner</span>
                <span style={{ fontSize: '0.75rem', color: 'var(--text-3)' }}>
                  Face KYC {mode === 'register' ? 'registration' : 'verification'}
                </span>
              </div>
            </div>
          )}

          {feedback && (
            <div 
              className={`alert-banner ${
                matchState.checked 
                  ? matchState.isMatch ? 'alert-info' : 'alert-critical'
                  : 'alert-warning'
              }`}
              style={{ width: '100%', maxWidth: '480px', margin: '0' }}
            >
              <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
                {matchState.checked ? (
                  matchState.isMatch ? <CheckCircle size={20} /> : <AlertTriangle size={20} />
                ) : (
                  <RefreshCw size={20} className={scanning ? 'animate-spin' : ''} />
                )}
                <span>{feedback}</span>
              </div>
              {matchState.checked && (
                <div style={{ fontSize: '0.875rem', marginTop: '4px', opacity: 0.8 }}>
                  Similarity Distance: {matchState.distance} (Match limit: &lt;= 0.6)
                </div>
              )}
            </div>
          )}

          <div className="flex-gap">
            {cameraActive ? (
              <>
                <GoldButton type="button" onClick={captureFace} disabled={scanning}>
                  {scanning ? 'Scanning...' : mode === 'register' ? t('customers.faceScanRegister') : t('customers.faceScanMatch')}
                </GoldButton>
                <button type="button" onClick={stopCamera} className="btn btn-secondary">
                  {t('common.cancel')}
                </button>
              </>
            ) : (
              <GoldButton type="button" onClick={startCamera}>
                <Camera size={18} />
                <span>Open Scanner Camera</span>
              </GoldButton>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
