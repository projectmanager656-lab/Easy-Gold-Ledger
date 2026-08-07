import React, { useRef, useState, useEffect } from 'react';
import { useTranslation } from 'react-i18next';
import { compressImage } from '../utils/imageCompressor';
import { GoldButton } from './PremiumUI';
import { PenLine, Eraser, Save, CheckCircle2 } from 'lucide-react';

export default function SignaturePad({ onSave, initialData = null }) {
  const { t } = useTranslation();
  const canvasRef = useRef(null);
  const [isDrawing, setIsDrawing] = useState(false);
  const [hasSigned, setHasSigned] = useState(false);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    // Set canvas dimensions based on display size
    const rect = canvas.getBoundingClientRect();
    canvas.width = rect.width;
    canvas.height = 200; // Fixed visual height

    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    // Fill solid white background (so exports have white bg instead of black)
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(0, 0, canvas.width, canvas.height);

    ctx.strokeStyle = '#0033cc'; // Blue ink signature
    ctx.lineWidth = 3;
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';

    // Draw initial signature if provided
    if (initialData) {
      const img = new Image();
      img.onload = () => ctx.drawImage(img, 0, 0);
      img.src = initialData;
      setHasSigned(true);
    }
  }, [initialData]);

  const getCoordinates = (e) => {
    const canvas = canvasRef.current;
    if (!canvas) return { x: 0, y: 0 };
    const rect = canvas.getBoundingClientRect();
    
    // Check if touch event or mouse event
    if (e.touches && e.touches[0]) {
      return {
        x: e.touches[0].clientX - rect.left,
        y: e.touches[0].clientY - rect.top
      };
    } else {
      return {
        x: e.clientX - rect.left,
        y: e.clientY - rect.top
      };
    }
  };

  const startDrawing = (e) => {
    e.preventDefault();
    const { x, y } = getCoordinates(e);
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    ctx.beginPath();
    ctx.moveTo(x, y);
    setIsDrawing(true);
  };

  const draw = (e) => {
    if (!isDrawing) return;
    e.preventDefault();
    const { x, y } = getCoordinates(e);
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    ctx.lineTo(x, y);
    ctx.stroke();
    setHasSigned(true);
  };

  const stopDrawing = () => {
    setIsDrawing(false);
  };

  const clearCanvas = () => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    ctx.fillStyle = '#ffffff';
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    setHasSigned(false);
    onSave(''); // Reset
  };

  const saveSignature = async () => {
    const canvas = canvasRef.current;
    if (!canvas || !hasSigned) return;

    try {
      const rawBase64 = canvas.toDataURL('image/jpeg', 0.8);
      // Run through our standard compressor to resize and scale down
      const compressedBase64 = await compressImage(rawBase64, 400, 0.5);
      onSave(compressedBase64);
    } catch (err) {
      console.error('Error compressing signature:', err);
    }
  };

  return (
    <div className="glass-card" style={{ padding: '24px', display: 'flex', flexDirection: 'column', gap: '12px' }}>
      <label style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
        <PenLine size={14} style={{ color: 'var(--gold)' }} />
        {t('customers.signature')}
      </label>

      <div className="signature-wrap">
        <canvas
          ref={canvasRef}
          onMouseDown={startDrawing}
          onMouseMove={draw}
          onMouseUp={stopDrawing}
          onMouseLeave={stopDrawing}
          onTouchStart={startDrawing}
          onTouchMove={draw}
          onTouchEnd={stopDrawing}
          style={{
            width: '100%',
            height: '200px',
            background: '#ffffff',
            border: 'none',
            borderRadius: '10px',
            cursor: 'crosshair',
            touchAction: 'none',
            display: 'block'
          }}
        />
      </div>

      <div className="flex-between" style={{ alignItems: 'center' }}>
        <p style={{ fontSize: '0.75rem', color: 'var(--text-3)', margin: 0 }}>
          {t('customers.signHere')}
        </p>
        {hasSigned && (
          <span className="check-pop" style={{ fontSize: '0.75rem' }}>
            <CheckCircle2 size={14} />
            {t('customers.signatureCaptured')}
          </span>
        )}
      </div>

      <div className="flex-gap" style={{ justifyContent: 'flex-end' }}>
        <button type="button" onClick={clearCanvas} className="btn btn-secondary" style={{ padding: '9px 18px', fontSize: '0.875rem' }}>
          <Eraser size={15} /> {t('customers.clear')}
        </button>
        <GoldButton
          type="button"
          onClick={saveSignature}
          style={{ padding: '9px 18px', fontSize: '0.875rem' }}
          disabled={!hasSigned}
        >
          <Save size={15} /> {t('customers.saveSignature')}
        </GoldButton>
      </div>
    </div>
  );
}
