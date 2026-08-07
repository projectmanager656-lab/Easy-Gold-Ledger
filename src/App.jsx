import React, { useState, useEffect } from 'react';
import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom';
import { onAuthStateChanged, signOut } from 'firebase/auth';
import { doc, getDoc, setDoc, onSnapshot } from 'firebase/firestore';
import { useTranslation } from 'react-i18next';
import { auth, db } from './services/firebase';
import { loadFaceModels } from './utils/faceVerifier';
import './i18n'; // Import internationalization setup

// Pages
import Login from './pages/Login';
import Dashboard from './pages/Dashboard';
import CustomerManagement from './pages/CustomerManagement';
import CustomerDetail from './pages/CustomerDetail';
import CustomerProfile from './pages/CustomerProfile';
import LoanManagement from './pages/LoanManagement';
import Reports from './pages/Reports';
import GoldRate from './pages/GoldRate';
import AuditLogs from './pages/AuditLogs';
import StaffManagement from './pages/StaffManagement';
import Notifications from './pages/Notifications';

// Components
import Navbar from './components/Navbar';
import PremiumLoader from './components/PremiumLoader';
import InstallPrompt from './components/InstallPrompt';
import ToastViewport from './components/Toast';

export default function App() {
  const { i18n } = useTranslation();
  const [initializing, setInitializing] = useState(true);
  const [modelsLoading, setModelsLoading] = useState(true);
  const [user, setUser] = useState(null);
  const [userRole, setUserRole] = useState('');
  const [userName, setUserName] = useState('');

  // 1. Preload Face recognition models globally on app start
  useEffect(() => {
    loadFaceModels()
      .then(() => setModelsLoading(false))
      .catch((err) => {
        console.error('Failed to preload face recognition models:', err);
        setModelsLoading(false); // don't hard block UI, let page scanners fail gracefully
      });
  }, []);

  // Dynamic Font Switching based on Language
  useEffect(() => {
    if (i18n.language === 'en') {
      document.documentElement.style.setProperty('--font-sans', "'Inter', sans-serif");
      document.documentElement.style.setProperty('--font-serif', "'Playfair Display', serif");
    } else {
      document.documentElement.style.setProperty('--font-sans', "'Mukta', sans-serif");
      document.documentElement.style.setProperty('--font-serif', "'Mukta', sans-serif");
    }
  }, [i18n.language]);

  // Load saved theme on mount
  useEffect(() => {
    const savedTheme = localStorage.getItem('theme') || 'dark';
    if (savedTheme === 'light') {
      document.documentElement.classList.add('light-theme');
    } else {
      document.documentElement.classList.remove('light-theme');
    }
  }, []);

  // 2. Observe Auth changes & Real-Time Account Deactivation Status
  useEffect(() => {
    let unsubUserDoc = null;

    const unsubscribeAuth = onAuthStateChanged(auth, (currentUser) => {
      if (unsubUserDoc) {
        unsubUserDoc();
        unsubUserDoc = null;
      }

      if (currentUser) {
        setUser(currentUser);
        // Real-time listener for user profile document in Firestore
        const userDocRef = doc(db, 'users', currentUser.uid);
        unsubUserDoc = onSnapshot(userDocRef, async (userSnap) => {
          if (userSnap.exists()) {
            const data = userSnap.data();

            // INSTANT AUTO-LOGOUT IF ACCOUNT STATUS IS DEACTIVATED BY SUPER ADMIN
            if (data.status === 'inactive' && data.role !== 'super_admin') {
              console.warn('User account has been deactivated by Super Admin. Logging out instantly...');
              sessionStorage.setItem('deactivated_user_msg', 'Your account is inactive. Please contact the shop owner.');
              setUser(null);
              setUserRole('');
              setUserName('');
              localStorage.removeItem('user_role');
              localStorage.removeItem('user_name');
              await signOut(auth);
              setInitializing(false);
              return;
            }

            const role = data.role || 'super_admin';
            const name = data.name || currentUser.email?.split('@')[0] || 'Admin';
            setUserRole(role);
            setUserName(name);
            localStorage.setItem('user_role', role);
            localStorage.setItem('user_name', name);
          } else {
            // Document missing, provision super_admin user doc automatically
            const defaultName = currentUser.displayName || currentUser.email?.split('@')[0] || 'Super Admin';
            const defaultDoc = {
              role: 'super_admin',
              name: defaultName,
              email: currentUser.email || '',
              status: 'active',
              createdAt: new Date().toISOString()
            };
            try {
              await setDoc(userDocRef, defaultDoc);
            } catch (err) {
              console.error('Error auto-creating admin doc in App.jsx:', err);
            }
            setUserRole('super_admin');
            setUserName(defaultName);
            localStorage.setItem('user_role', 'super_admin');
            localStorage.setItem('user_name', defaultName);
          }
          setInitializing(false);
        }, (err) => {
          console.error('Error in user doc listener:', err);
          const cachedRole = localStorage.getItem('user_role') || 'super_admin';
          const cachedName = localStorage.getItem('user_name') || currentUser.email?.split('@')[0] || 'Admin';
          setUserRole(cachedRole);
          setUserName(cachedName);
          setInitializing(false);
        });
      } else {
        setUser(null);
        setUserRole('');
        setUserName('');
        localStorage.removeItem('user_role');
        localStorage.removeItem('user_name');
        setInitializing(false);
      }
    });

    return () => {
      unsubscribeAuth();
      if (unsubUserDoc) unsubUserDoc();
    };
  }, []);

  // Loading Screen
  if (initializing || modelsLoading) {
    return <PremiumLoader />;
  }

  // Wrapper for protected routes
  const ProtectedRoute = ({ children, allowedRoles = [] }) => {
    if (!user) {
      return <Navigate to="/login" replace />;
    }

    if (allowedRoles.length > 0 && !allowedRoles.includes(userRole)) {
      return <Navigate to="/dashboard" replace />;
    }

    return (
      <div style={{ display: 'flex', flexDirection: 'column', minHeight: '100vh' }}>
        <Navbar userRole={userRole} userName={userName} />
        {children}
      </div>
    );
  };

  return (
    <BrowserRouter>
      <Routes>
        {/* Public Routes */}
        <Route 
          path="/login" 
          element={user ? <Navigate to="/dashboard" replace /> : <Login />} 
        />

        {/* Private Routes */}
        <Route 
          path="/" 
          element={
            <ProtectedRoute>
              <Dashboard />
            </ProtectedRoute>
          } 
        />
        <Route 
          path="/dashboard" 
          element={
            <ProtectedRoute>
              <Dashboard />
            </ProtectedRoute>
          } 
        />
        <Route 
          path="/customers" 
          element={
            <ProtectedRoute allowedRoles={['super_admin', 'employee']}>
              <CustomerManagement />
            </ProtectedRoute>
          } 
        />
        <Route 
          path="/customers/:id"
          element={
            <ProtectedRoute allowedRoles={['super_admin', 'employee']}>
              <CustomerDetail />
            </ProtectedRoute>
          }
        />
        <Route 
          path="/loans" 
          element={
            <ProtectedRoute>
              <LoanManagement />
            </ProtectedRoute>
          } 
        />
        <Route 
          path="/reports" 
          element={
            <ProtectedRoute allowedRoles={['super_admin', 'employee']}>
              <Reports />
            </ProtectedRoute>
          } 
        />
        <Route 
          path="/gold-rate" 
          element={
            <ProtectedRoute>
              <GoldRate />
            </ProtectedRoute>
          } 
        />
        <Route 
          path="/audit-logs" 
          element={
            <ProtectedRoute allowedRoles={['super_admin']}>
              <AuditLogs />
            </ProtectedRoute>
          } 
        />
        <Route 
          path="/staff" 
          element={
            <ProtectedRoute allowedRoles={['super_admin']}>
              <StaffManagement />
            </ProtectedRoute>
          } 
        />
        <Route
          path="/profile"
          element={
            <ProtectedRoute>
              <CustomerProfile />
            </ProtectedRoute>
          }
        />
        <Route 
          path="/notifications" 
          element={
            <ProtectedRoute>
              <Notifications />
            </ProtectedRoute>
          } 
        />

        {/* Catch-all redirects */}
        <Route path="*" element={<Navigate to="/dashboard" replace />} />
      </Routes>
      <InstallPrompt />
      <ToastViewport />
    </BrowserRouter>
  );
}
