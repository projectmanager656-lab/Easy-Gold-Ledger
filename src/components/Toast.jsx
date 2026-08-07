import React, { useState, useEffect } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { CheckCircle2, XCircle, AlertTriangle, X } from 'lucide-react';

let listeners = [];

function emit(type, message) {
  if (!message) return;
  listeners.forEach((l) => l({ type, message }));
}

export function toastSuccess(message) {
  emit('success', message);
}

export function toastError(message) {
  emit('error', message);
}

export function toastInfo(message) {
  emit('info', message);
}

/**
 * ToastViewport — mounts once (in App.jsx) and renders premium
 * toast notifications fired via toastSuccess / toastError / toastInfo.
 */
export default function ToastViewport() {
  const [toasts, setToasts] = useState([]);

  useEffect(() => {
    const addToast = (t) => {
      const id = `${Date.now()}-${Math.random()}`;
      setToasts((prev) => [...prev, { ...t, id }]);
      setTimeout(() => {
        setToasts((prev) => prev.filter((x) => x.id !== id));
      }, 3800);
    };
    listeners.push(addToast);
    return () => {
      listeners = listeners.filter((l) => l !== addToast);
    };
  }, []);

  const dismiss = (id) => setToasts((prev) => prev.filter((x) => x.id !== id));

  const icons = {
    success: <CheckCircle2 size={18} style={{ color: '#10b981' }} />,
    error: <XCircle size={18} style={{ color: '#ef4444' }} />,
    info: <AlertTriangle size={18} style={{ color: '#f59e0b' }} />
  };

  return (
    <div className="toast-viewport">
      <AnimatePresence>
        {toasts.map((toast) => (
          <motion.div
            key={toast.id}
            className="toast-card"
            initial={{ opacity: 0, x: 60, scale: 0.92 }}
            animate={{ opacity: 1, x: 0, scale: 1 }}
            exit={{ opacity: 0, x: 60, scale: 0.92 }}
            transition={{ duration: 0.35, ease: [0.22, 1, 0.36, 1] }}
          >
            {icons[toast.type] || icons.info}
            <span>{toast.message}</span>
            <button
              className="toast-close"
              onClick={() => dismiss(toast.id)}
              aria-label="Dismiss notification"
            >
              <X size={14} />
            </button>
          </motion.div>
        ))}
      </AnimatePresence>
    </div>
  );
}
