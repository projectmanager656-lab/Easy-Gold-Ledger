import React, { useState, useEffect } from "react";
import { useSearchParams } from "react-router-dom";
import { useTranslation } from "react-i18next";
import { motion, AnimatePresence } from "framer-motion";
import { getLiveGoldRate, getCachedLiveRates } from "../services/goldRateService";
import useLiveGoldRates from "../hooks/useLiveGoldRates";
import { toastError } from "../components/Toast";

import {
  collection,
  onSnapshot,
  query,
  where,
  doc,
  getDoc,
  getDocs,
} from "firebase/firestore";

import { db, auth } from "../services/firebase";
import { 
  createLoan, 
  addPayment, 
  updatePayment, 
  deletePayment,
  forfeitLoan,
  checkAndNotifyThresholds
} from '../services/firebaseService';
import { 
  calculateLoanState, 
  getLtvAlertState, 
  calculateEstimatedValue,
  isActiveLoan
} from '../utils/interestEngine';
import { compressImage } from '../utils/imageCompressor';
import LoanCard from '../components/LoanCard';
import { 
  generatePledgeReceipt, 
  generateClosureCertificate, 
  generatePaymentReceipt,
  generateCustomerStatement 
} from '../utils/pdfGenerator';
import {
  PageHeader,
  StaggerGroup,
  FadeScale,
  TiltCard,
  EmptyState,
  GoldButton,
  AnimatedNumber,
  useGreeting
} from '../components/PremiumUI';
import { 
  Search, 
  Plus, 
  Coins, 
  PlusCircle, 
  FileText, 
  DollarSign, 
  AlertTriangle, 
  Trash2,
  Calendar,
  Layers,
  TrendingDown,
  CheckCircle2,
  XCircle,
  FileCheck,
  Gem,
  Scale,
  ArrowLeft,
  Landmark,
  Percent,
  Wallet,
  Receipt,
  BadgeIndianRupee,
  ImageIcon,
  User,
  Phone,
  TrendingUp,
  Gauge,
  ShieldAlert,
  Clock,
  Pencil,
  Banknote,
  History,
  Download
} from 'lucide-react';
import confetti from 'canvas-confetti';

export default function LoanManagement() {
  const { t } = useTranslation();
  const [searchParams, setSearchParams] = useSearchParams();
  const [role] = useState(localStorage.getItem('user_role') || 'employee');
  const greeting = useGreeting();

  // Directory List States
  const [loans, setLoans] = useState([]);
  const [customers, setCustomers] = useState([]);
  const [searchQuery, setSearchQuery] = useState('');
  const [filterTab, setFilterTab] = useState('all'); // 'all' | 'open' | 'closed' | 'forfeited'
  
  // Inspector States
  const [selectedLoan, setSelectedLoan] = useState(null);
  const [selectedLoanPayments, setSelectedLoanPayments] = useState([]);
  const [selectedLoanImages, setSelectedLoanImages] = useState([]);
  const [loanState, setLoanState] = useState(null);
  const [ltvState, setLtvState] = useState(null);

  // New Loan Form States
  const [showAddForm, setShowAddForm] = useState(false);
  const [selectedCustomerId, setSelectedCustomerId] = useState('');
  const [metalType, setMetalType] = useState('gold'); // 'gold' | 'silver'
  const [itemDescription, setItemDescription] = useState('');
  const [weightGrams, setWeightGrams] = useState('');
  const [purityKarat, setPurityKarat] = useState('22');
  const [marketRateAtPledge, setMarketRateAtPledge] = useState('');
  const [loanAmount, setLoanAmount] = useState('');
  const [interestRate, setInterestRate] = useState('1.5'); // default 1.5% monthly
  const [maxLtvPercent, setMaxLtvPercent] = useState('75'); // default 75% max LTV
  const [pledgeDate, setPledgeDate] = useState(new Date().toISOString().split('T')[0]);
  const [itemImages, setItemImages] = useState([]);

  // Modals & Action Forms States
  const [showPaymentModal, setShowPaymentModal] = useState(false);
  const [paymentAmount, setPaymentAmount] = useState('');
  const [paymentDate, setPaymentDate] = useState(new Date().toISOString().split('T')[0]);
  const [paymentMethod, setPaymentMethod] = useState('cash'); // cash | upi | bank_transfer | cheque
  const [referenceNumber, setReferenceNumber] = useState('');
  const [paymentRemarks, setPaymentRemarks] = useState('');
  const [collectedBy, setCollectedBy] = useState(localStorage.getItem('user_name') || '');
  const [editingPaymentId, setEditingPaymentId] = useState(null);
  const [paymentError, setPaymentError] = useState('');
  const [paymentBreakdown, setPaymentBreakdown] = useState(null);
  const [paymentSuccess, setPaymentSuccess] = useState(false);
  const submittingRef = React.useRef(false);

  // Repayment History search & filters
  const [paySearch, setPaySearch] = useState('');
  const [payFilter, setPayFilter] = useState('all'); // all | today | week | month | custom
  const [payFrom, setPayFrom] = useState('');
  const [payTo, setPayTo] = useState('');
  const [pendingDeleteId, setPendingDeleteId] = useState(null);

  const [showForfeitModal, setShowForfeitModal] = useState(false);
  const [auctionAmount, setAuctionAmount] = useState('');
  const [auctionDate, setAuctionDate] = useState(new Date().toISOString().split('T')[0]);
  const [settlementType, setSettlementType] = useState('refund'); // 'refund' | 'write_off'
  const [auctionNotes, setAuctionNotes] = useState('');
  
  const [loading, setLoading] = useState(false);
  const [errorMsg, setErrorMsg] = useState('');
  const [successMsg, setSuccessMsg] = useState('');

  // 1. Fetch Customers and Loans List real-time
  useEffect(() => {
    let unsubCustomers = () => {};
    if (role !== 'customer') {
      unsubCustomers = onSnapshot(
        query(collection(db, 'users'), where('role', '==', 'customer')),
        (snap) => {
          setCustomers(snap.docs.map(doc => ({ id: doc.id, ...doc.data() })));
        }
      );
    }

    let qLoans = collection(db, 'loans');
    if (role === 'customer' && auth.currentUser) {
      qLoans = query(collection(db, 'loans'), where('customerId', '==', auth.currentUser.uid));
    }

    const unsubLoans = onSnapshot(qLoans, (snap) => {
      const list = snap.docs.map(doc => ({ id: doc.id, ...doc.data() }));
      setLoans(list);
      list.forEach(loan => {
        if (isActiveLoan(loan.status)) {
          checkAndNotifyThresholds(loan);
        }
      });
    });

    return () => {
      unsubCustomers();
      unsubLoans();
    };
  }, [role]);

  // Live market feed (auto-refresh 60s, cached, retried) — powers loan
  // pricing at issue time and the inspector's Market Watch.
  const { data: liveRates, status: marketStatus } = useLiveGoldRates({
    onError: (err) => toastError(`Live market: ${err.message}`)
  });

  // Fetch today's rate based on metal type (Indian RETAIL values)
  useEffect(() => {
    async function loadRate() {
      if (metalType === "gold") {
        const rate = await getLiveGoldRate();
        if (rate) {
          // 22K = 24K x 22/24, rounded — gold jewellery purity (retail)
          setMarketRateAtPledge(rate.retailGold22K.toFixed(2));
        } else {
          // Live feed unreachable: serve the 60s market cache (still retail 22K)
          const cached = getCachedLiveRates();
          setMarketRateAtPledge(cached ? cached.retailGold22K.toFixed(2) : "");
        }
        setPurityKarat("22");
      } else {
        // Silver: live retail from cache only — never a static fallback
        const rate = await getLiveGoldRate();
        const cached = rate || getCachedLiveRates();
        setMarketRateAtPledge(cached ? cached.retailSilver.toFixed(2) : "");
        setPurityKarat("999");
      }
    }
    loadRate();
  }, [metalType, showAddForm]);

  // Handle URL deep link queries
  useEffect(() => {
    const loanId = searchParams.get('id');
    if (loanId && loans.length > 0) {
      const foundLoan = loans.find(l => l.id === loanId);
      if (foundLoan) {
        handleSelectLoan(foundLoan);
      }
    }
  }, [loans, searchParams]);

  const estimatedValue = calculateEstimatedValue(
    parseFloat(weightGrams) || 0,
    purityKarat,
    parseFloat(marketRateAtPledge) || 0,
    metalType
  );

  const formLtv = estimatedValue ? ((parseFloat(loanAmount) || 0) / estimatedValue) * 100 : 0;

  const handleSelectLoan = async (loan) => {
    const paymentsCol = collection(db, 'loans', loan.id, 'payments');
    onSnapshot(paymentsCol, (snap) => {
      const paymentsList = snap.docs.map(d => ({ id: d.id, ...d.data() }));
      setSelectedLoanPayments(paymentsList);
      
      const state = calculateLoanState(
        loan.loanAmount,
        loan.interestRate,
        loan.pledgeDate,
        paymentsList
      );
      setLoanState(state);

      const alertState = getLtvAlertState(state.outstandingBalance, loan.estimatedValue);
      setLtvState(alertState);
    });

    const imagesCol = collection(db, 'loans', loan.id, 'images');
    const imgSnap = await getDocs(imagesCol);
    if (!imgSnap.empty) {
      setSelectedLoanImages(
        imgSnap.docs
          .map(d => {
            const v = d.data().imageBase64;
            return Array.isArray(v) ? v[0] : v;
          })
          .filter(Boolean)
      );
    } else {
      setSelectedLoanImages([]);
    }

    const customerDoc = await getDoc(doc(db, 'users', loan.customerId));
    const customerData = customerDoc.exists() ? customerDoc.data() : { name: 'Unknown' };

    setSelectedLoan({
      ...loan,
      customerName: customerData.name,
      customerPhone: customerData.phone,
      customerEmail: customerData.email
    });

    setSearchParams({ id: loan.id });
  };

  const handleImageUpload = async (e) => {
    const files = Array.from(e.target.files);
    if (!files.length) return;

    const MAX_IMAGES = 6;
    const remaining = MAX_IMAGES - itemImages.length;
    const toProcess = files.slice(0, remaining);

    try {
      const compressed = await Promise.all(
        toProcess.map(file => compressImage(file, 800, 0.6))
      );
      setItemImages(prev => [...prev, ...compressed]);
    } catch (err) {
      console.error(err);
      setErrorMsg('Failed to process item image(s).');
    }
    e.target.value = '';
  };

  const handleRemoveImage = (index) => {
    setItemImages(prev => prev.filter((_, i) => i !== index));
  };

  const handleIssueLoan = async (e) => {
    e.preventDefault();
    setErrorMsg('');
    setSuccessMsg('');

    if (!selectedCustomerId || !itemDescription || !weightGrams || !loanAmount) {
      setErrorMsg('All pledge fields are required.');
      return;
    }

    if (formLtv > parseFloat(maxLtvPercent)) {
      setErrorMsg(t('loans.ltvError') || 'LTV exceeds maximum threshold.');
      return;
    }

    setLoading(true);

    try {
      // Price the pledge against the freshest live Indian retail value (never static).
      // { force: true } skips the 60s cache so the loan is priced at issue time.
      let live = null;
      try {
        live = await getLiveGoldRate({ force: true });
      } catch (e) {
        console.warn('Live rate unavailable at issue time:', e);
      }
      // Gold loans are priced at the retail 22K rate (form purity = 22K),
      // silver at the retail 99.9% rate — the same basis shown in the form.
      const livePrice = live
        ? (metalType === 'silver' ? live.retailSilver : live.retailGold22K)
        : null;
      const effectiveRate = livePrice || (parseFloat(marketRateAtPledge) || 0);

      const liveEstimatedValue = calculateEstimatedValue(
        parseFloat(weightGrams) || 0,
        purityKarat,
        effectiveRate,
        metalType
      );
      const liveLtv = liveEstimatedValue ? ((parseFloat(loanAmount) || 0) / liveEstimatedValue) * 100 : 0;

      const loanData = {
        customerId: selectedCustomerId,
        metalType,
        itemDescription,
        weightGrams: parseFloat(weightGrams),
        purityKarat: parseInt(purityKarat, 10),
        marketRateAtPledge: effectiveRate,
        estimatedValue: Math.round(liveEstimatedValue),
        loanAmount: parseFloat(loanAmount),
        interestRate: parseFloat(interestRate),
        ltvPercent: Math.round(liveLtv * 100) / 100,
        pledgeDate,
        // Live market snapshot persisted with the loan (used by reports & inspectors)
        // — both spot and Indian retail prices, as the UI contract requires.
        spotPrice: live ? live.gold : null,          // 24K spot, INR/g
        retailPrice: live ? live.retailGold : null,  // 24K retail (India), INR/g
        spotSilverPrice: live ? live.silver : null,  // 99.9% spot, INR/g
        retailSilverPrice: live ? live.retailSilver : null, // 99.9% retail, INR/g
        goldPrice: live ? live.gold : null,
        silverPrice: live ? live.silver : null,
        retailFactor: live ? live.retailFactor : null,
        rateCurrency: live ? live.currency : 'INR',
        marketSource: live ? live.source : null,
        rateTimestamp: live ? live.timestamp : null
      };

      await createLoan(loanData, itemImages);
      setSuccessMsg('Gold Loan Pledge issued successfully!');
      
      setSelectedCustomerId('');
      setItemDescription('');
      setWeightGrams('');
      setLoanAmount('');
      setItemImages([]);
      
      setTimeout(() => {
        setShowAddForm(false);
        setSuccessMsg('');
      }, 2000);
    } catch (err) {
      console.error(err);
      setErrorMsg(err.message || 'Failed to issue loan.');
    } finally {
      setLoading(false);
    }
  };

  // Live breakdown preview while the staff types the payment amount:
  // interest settles first, remainder reduces principal (mirrors the service).
  useEffect(() => {
    if (!selectedLoan || !paymentAmount || editingPaymentId) {
      setPaymentBreakdown(null);
      return;
    }
    const amt = parseFloat(paymentAmount);
    if (!amt || amt <= 0) {
      setPaymentBreakdown(null);
      return;
    }
    const payDate = new Date(`${paymentDate || new Date().toISOString().split('T')[0]}T23:59:59`);
    const before = calculateLoanState(
      selectedLoan.loanAmount,
      selectedLoan.interestRate,
      selectedLoan.pledgeDate,
      selectedLoanPayments,
      payDate
    );
    const after = calculateLoanState(
      selectedLoan.loanAmount,
      selectedLoan.interestRate,
      selectedLoan.pledgeDate,
      [
        ...selectedLoanPayments,
        { amount: amt, paymentType: 'partial', paymentDate: payDate.toISOString() }
      ],
      payDate
    );
    setPaymentBreakdown({
      interestPaid: Math.max(0, before.accruedInterest - after.accruedInterest),
      principalPaid: Math.max(0, amt - Math.max(0, before.accruedInterest - after.accruedInterest)),
      newOutstanding: Math.max(0, after.outstandingBalance),
      maxAllowed: before.outstandingBalance,
      fullyRepaid: after.currentPrincipal <= 0.005 && after.accruedInterest <= 0.005
    });
  }, [paymentAmount, paymentDate, selectedLoanPayments, selectedLoan, editingPaymentId]);

  const handleAddPayment = async (e) => {
    e.preventDefault();
    setPaymentError('');
    if (!selectedLoan || submittingRef.current) return; // prevent duplicate submission

    const amt = parseFloat(paymentAmount);
    if (!amt || amt <= 0) {
      setPaymentError('Payment amount must be greater than zero.');
      return;
    }
    if (paymentBreakdown && amt > paymentBreakdown.maxAllowed + 0.01) {
      setPaymentError(`Payment amount exceeds the outstanding balance (₹${Math.round(paymentBreakdown.maxAllowed).toLocaleString('en-IN')}).`);
      return;
    }

    submittingRef.current = true;
    setLoading(true);
    try {
      if (editingPaymentId) {
        // Edit mode: metadata only — amount/date changes go through delete + re-add
        // so the interest/principal split stays mathematically consistent.
        await updatePayment(selectedLoan.id, editingPaymentId, {
          paymentMethod,
          referenceNumber: referenceNumber.trim(),
          remarks: paymentRemarks.trim(),
          collectedBy: collectedBy.trim()
        });
      } else {
        await addPayment(selectedLoan.id, {
          amount: amt,
          paymentDate,
          paymentMethod,
          referenceNumber: referenceNumber.trim(),
          remarks: paymentRemarks.trim(),
          collectedBy: collectedBy.trim()
        });
      }

      const wasClosed = !editingPaymentId && paymentBreakdown?.fullyRepaid;

      setPaymentSuccess(true);
      await new Promise((r) => setTimeout(r, 1400)); // success animation
      setShowPaymentModal(false);
      setPaymentSuccess(false);
      setPaymentAmount('');
      setPaymentDate(new Date().toISOString().split('T')[0]);
      setPaymentMethod('cash');
      setReferenceNumber('');
      setPaymentRemarks('');
      setCollectedBy(localStorage.getItem('user_name') || '');
      setEditingPaymentId(null);

      const refreshed = await getDoc(doc(db, 'loans', selectedLoan.id));
      handleSelectLoan({ id: refreshed.id, ...refreshed.data() });

      if (wasClosed) {
        confetti({
          particleCount: 150,
          spread: 80,
          origin: { y: 0.6 },
          colors: ['#d4af37', '#ffffff', '#e5c158']
        });
      }
    } catch (err) {
      console.error(err);
      setPaymentError(err.message || 'Failed to record payment.');
    } finally {
      submittingRef.current = false;
      setLoading(false);
    }
  };

  const openEditPayment = (payment) => {
    setEditingPaymentId(payment.id);
    setPaymentAmount('');
    setPaymentDate((payment.paymentDate || '').slice(0, 10) || new Date().toISOString().split('T')[0]);
    setPaymentMethod(payment.paymentMethod || 'cash');
    setReferenceNumber(payment.referenceNumber || '');
    setPaymentRemarks(payment.remarks || '');
    setCollectedBy(payment.collectedBy || localStorage.getItem('user_name') || '');
    setPaymentError('');
    setShowPaymentModal(true);
  };

  const handleDeletePayment = async (paymentId) => {
    if (!selectedLoan || pendingDeleteId !== paymentId) return;
    setPendingDeleteId(null);
    try {
      await deletePayment(selectedLoan.id, paymentId);
      const refreshed = await getDoc(doc(db, 'loans', selectedLoan.id));
      handleSelectLoan({ id: refreshed.id, ...refreshed.data() });
    } catch (err) {
      console.error(err);
      setPaymentError(err.message || 'Failed to delete payment.');
    }
  };

  const downloadPaymentReceipt = async (payment) => {
    if (!selectedLoan) return;
    try {
      await generatePaymentReceipt(
        payment,
        selectedLoan,
        { name: selectedLoan.customerName, phone: selectedLoan.customerPhone },
        t
      );
    } catch (e) {
      console.error(e);
      alert('PDF generation error.');
    }
  };

  const downloadCustomerStatement = async () => {
    if (!selectedLoan) return;
    try {
      const loansSnap = await getDocs(query(collection(db, 'loans'), where('customerId', '==', selectedLoan.customerId)));
      const customerLoans = loansSnap.docs.map(d => ({ id: d.id, ...d.data() }));
      const paymentsByLoan = {};
      await Promise.all(customerLoans.map(async (loan) => {
        const snap = await getDocs(collection(db, 'loans', loan.id, 'payments'));
        paymentsByLoan[loan.id] = snap.docs.map(d => d.data());
      }));
      await generateCustomerStatement(
        { name: selectedLoan.customerName, phone: selectedLoan.customerPhone },
        customerLoans,
        paymentsByLoan,
        t
      );
    } catch (e) {
      console.error(e);
      alert('PDF generation error.');
    }
  };

  const handleCloseAndRedeem = async () => {
    if (!selectedLoan || !loanState || submittingRef.current) return;

    submittingRef.current = true;
    setLoading(true);
    setErrorMsg('');

    try {
      // Full repayment goes through the same payment pipeline (auto-closes the
      // loan, updates outstanding/totalPaid/paymentCount, writes audit logs).
      await addPayment(selectedLoan.id, {
        amount: Math.round(loanState.outstandingBalance * 100) / 100,
        paymentDate: new Date().toISOString().split('T')[0],
        paymentMethod,
        remarks: 'Final outstanding balance paid at closure.',
        collectedBy: localStorage.getItem('user_name') || ''
      });

      confetti({
        particleCount: 150,
        spread: 80,
        origin: { y: 0.6 },
        colors: ['#d4af37', '#ffffff', '#e5c158']
      });

      setSuccessMsg('Loan fully paid off. Gold returned to customer!');
      const closedDoc = await getDoc(doc(db, 'loans', selectedLoan.id));
      handleSelectLoan({ id: closedDoc.id, ...closedDoc.data() });
      setTimeout(() => setSuccessMsg(''), 4000);
    } catch (err) {
      console.error(err);
      setErrorMsg(err.message || 'Failed to close loan.');
    } finally {
      submittingRef.current = false;
      setLoading(false);
    }
  };

  const handleForfeitAndAuction = async (e) => {
    e.preventDefault();
    if (!auctionAmount || !selectedLoan) return;

    setLoading(true);

    try {
      const forfeitData = {
        saleDate: auctionDate,
        saleAmount: parseFloat(auctionAmount),
        settlementType,
        notes: auctionNotes
      };

      await forfeitLoan(selectedLoan.id, forfeitData);

      const updatedDoc = await getDoc(doc(db, 'loans', selectedLoan.id));
      handleSelectLoan({ id: updatedDoc.id, ...updatedDoc.data() });
      setShowForfeitModal(false);
      setAuctionAmount('');
      setAuctionNotes('');
    } catch (err) {
      console.error(err);
      alert('Forfeiture registration failed.');
    } finally {
      setLoading(false);
    }
  };

  const downloadPledgePdf = async () => {
    if (!selectedLoan) return;
    try {
      const custDoc = await getDoc(doc(db, 'customers', selectedLoan.customerId));
      const customerProfile = custDoc.exists() ? custDoc.data() : {};
      
      await generatePledgeReceipt(
        selectedLoan, 
        { 
          name: selectedLoan.customerName, 
          phone: selectedLoan.customerPhone, 
          address: customerProfile.address, 
          signatureBase64: customerProfile.signatureBase64, 
          photoBase64: selectedLoan.photoBase64 
        },
        selectedLoanImages[0] || null,
        t
      );
    } catch (e) {
      console.error(e);
      alert('PDF generation error.');
    }
  };

  const downloadClosurePdf = async () => {
    if (!selectedLoan || !loanState) return;
    try {
      await generateClosureCertificate(
        selectedLoan,
        { name: selectedLoan.customerName, phone: selectedLoan.customerPhone },
        loanState,
        selectedLoanPayments,
        t
      );
    } catch (e) {
      console.error(e);
      alert('PDF generation error.');
    }
  };

  const filteredLoans = loans.filter((loan) => {
    if (filterTab === 'open' && !isActiveLoan(loan.status)) return false;
    if (filterTab === 'partially_paid' && loan.status !== 'partially_paid') return false;
    if (filterTab === 'closed' && loan.status !== 'closed') return false;
    if (filterTab === 'forfeited' && loan.status !== 'forfeited') return false;

    const query = searchQuery.toLowerCase();
    const customer = customers.find(c => c.id === loan.customerId);
    const customerName = customer ? customer.name.toLowerCase() : '';

    return (
      loan.itemDescription?.toLowerCase().includes(query) ||
      loan.id?.toLowerCase().includes(query) ||
      customerName.includes(query)
    );
  });

  const getCustomerName = (customerId) => {
    if (role === 'customer') {
      return localStorage.getItem('user_name') || 'Customer';
    }
    const c = customers.find(cust => cust.id === customerId);
    return c ? c.name : 'Loading...';
  };

  const getCustomerPhone = (customerId) => {
    if (role === 'customer') return '';
    const c = customers.find(cust => cust.id === customerId);
    return c ? c.phone : '';
  };

  const statusBadgeClass = (status) => {
    if (status === 'open') return 'badge-open';
    if (status === 'partially_paid') return 'badge-partial';
    if (status === 'paid') return 'badge-paid';
    if (status === 'defaulted') return 'badge-defaulted';
    if (status === 'closed') return 'badge-closed';
    return 'badge-forfeited';
  };

  const statusLabel = (status) => {
    if (status === 'open') return t('loans.statusOpen') || 'OPEN';
    if (status === 'partially_paid') return t('loans.statusPartiallyPaid') || 'PARTIALLY PAID';
    if (status === 'paid') return t('loans.statusPaid') || 'PAID';
    if (status === 'defaulted') return t('loans.statusDefaulted') || 'DEFAULTED';
    if (status === 'closed') return t('loans.statusClosed') || 'CLOSED';
    return t('loans.statusForfeited') || 'FORFEITED';
  };

  const isSuperAdmin = role === 'super_admin';

  const methodLabel = (m) => {
    if (m === 'bank_transfer') return t('payments.bankTransfer') || 'Bank Transfer';
    if (m === 'upi') return t('payments.upi') || 'UPI';
    if (m === 'cheque') return t('payments.cheque') || 'Cheque';
    if (m === 'cash') return t('payments.cash') || 'Cash';
    return m || (t('payments.cash') || 'Cash');
  };

  // Repayment History: search + date-range filtering (newest first)
  const filteredPayments = selectedLoanPayments
    .filter((p) => {
      const d = new Date(p.paymentDate || p.date || p.createdAt);
      if (Number.isNaN(d.getTime())) return true;
      const now = new Date();
      const startOfToday = new Date(now.getFullYear(), now.getMonth(), now.getDate());
      if (payFilter === 'today' && d < startOfToday) return false;
      if (payFilter === 'week') {
        const startOfWeek = new Date(startOfToday);
        startOfWeek.setDate(startOfToday.getDate() - startOfToday.getDay());
        if (d < startOfWeek) return false;
      }
      if (payFilter === 'month') {
        const startOfMonth = new Date(now.getFullYear(), now.getMonth(), 1);
        if (d < startOfMonth) return false;
      }
      if (payFilter === 'custom') {
        if (payFrom) {
          const from = new Date(`${payFrom}T00:00:00`);
          if (d < from) return false;
        }
        if (payTo) {
          const to = new Date(`${payTo}T23:59:59`);
          if (d > to) return false;
        }
      }
      if (paySearch.trim()) {
        const q = paySearch.trim().toLowerCase();
        const hay = [
          p.paymentMethod,
          p.referenceNumber,
          p.remarks,
          p.collectedBy,
          p.amount,
          p.paymentDate || p.date,
          p.id
        ].filter(Boolean).join(' ').toLowerCase();
        if (!hay.includes(q)) return false;
      }
      return true;
    })
    .sort((a, b) => new Date(b.paymentDate || b.date || b.createdAt) - new Date(a.paymentDate || a.date || a.createdAt));

  const ltvCssClass = (pct) => {
    if (pct > 90) return 'red';
    if (pct > 75) return 'blue';
    return 'green';
  };

  return (
    <div className={`app-container ${role === 'customer' ? 'customer-loans' : ''}`}>
      <main className="main-content">

        {/* Page Header */}
        <PageHeader
          eyebrow={greeting}
          title={t('loans.title') || 'Loan Management'}
          subtitle={t('loans.subtitle') || 'Issue, track, and manage gold & silver pledges.'}
          actions={
            role !== 'customer' && (
              <GoldButton
                onClick={() => {
                  setShowAddForm(!showAddForm);
                  setSelectedLoan(null);
                }}
              >
                <Plus size={18} />
                <span>{showAddForm ? (t('loans.allLoans') || 'View Active Loans') : (t('loans.issueNew') || 'Issue New Pledge')}</span>
              </GoldButton>
            )
          }
        />

        <AnimatePresence mode="wait">
          {showAddForm ? (
            /* ============ FORM: ISSUE NEW LOAN ============ */
            <motion.div
              key="add-form"
              initial={{ opacity: 0, y: 24, scale: 0.985 }}
              animate={{ opacity: 1, y: 0, scale: 1 }}
              exit={{ opacity: 0, y: -12, scale: 0.99 }}
              transition={{ duration: 0.5, ease: [0.22, 1, 0.36, 1] }}
            >
              <div className="glass-panel" style={{ padding: '32px', maxWidth: '820px', margin: '0 auto' }}>
                <div className="flex-between" style={{ marginBottom: '24px' }}>
                  <div>
                    <h3 className="serif-title" style={{ fontSize: '1.5rem' }}>
                      {t('loans.issueNew') || 'Issue New Gold Loan Pledge'}
                    </h3>
                    <p style={{ color: 'var(--text-2)', fontSize: '0.875rem', marginTop: 4 }}>
                      {t('loans.metalGold') || 'Pledge collateral'} — {t('loans.metalSilver') || 'Silver'} accepted
                    </p>
                  </div>
                  <span className={`metal-coin ${metalType === 'silver' ? 'silver' : ''}`}>
                    {metalType === 'silver' ? <Coins size={20} /> : <Gem size={20} />}
                  </span>
                </div>

                {errorMsg && (
                  <FadeScale>
                    <div className="alert-banner alert-critical" style={{ marginBottom: 18 }}>
                      <XCircle size={20} />
                      <span>{errorMsg}</span>
                    </div>
                  </FadeScale>
                )}

                {successMsg && (
                  <FadeScale>
                    <div className="alert-banner alert-info" style={{ marginBottom: 18 }}>
                      <CheckCircle2 size={20} />
                      <span>{successMsg}</span>
                    </div>
                  </FadeScale>
                )}

                <form onSubmit={handleIssueLoan} style={{ display: 'flex', flexDirection: 'column', gap: '24px' }}>

                  {/* Metal Type Toggle */}
                  <div className="mode-tabs" style={{ alignSelf: 'flex-start' }}>
                    <button
                      type="button"
                      onClick={() => setMetalType('gold')}
                      className={`tab-btn ${metalType === 'gold' ? 'active' : ''}`}
                    >
                      <Gem size={14} />
                      {t('loans.metalGold') || 'Gold'}
                    </button>
                    <button
                      type="button"
                      onClick={() => setMetalType('silver')}
                      className={`tab-btn ${metalType === 'silver' ? 'active' : ''}`}
                    >
                      <Coins size={14} />
                      {t('loans.metalSilver') || 'Silver'}
                    </button>
                  </div>

                  <div className="grid-cols-2">
                    <div className="form-group">
                      <label>{t('loans.selectCustomer') || 'Select Borrower'}</label>
                      <select
                        value={selectedCustomerId}
                        onChange={(e) => setSelectedCustomerId(e.target.value)}
                        required
                      >
                        <option value="">-- {t('loans.selectCustomer') || 'Choose Customer'} --</option>
                        {customers.map((c) => (
                          <option key={c.id} value={c.id}>
                            {c.name} ({c.phone})
                          </option>
                        ))}
                      </select>
                    </div>
                    <div className="form-group">
                      <label>{t('loans.pledgeDate') || 'Pledge Date'}</label>
                      <input
                        type="date"
                        value={pledgeDate}
                        onChange={(e) => setPledgeDate(e.target.value)}
                        required
                      />
                    </div>
                  </div>

                  <div className="form-group">
                    <label>{t('loans.itemDesc') || 'Item Description'}</label>
                    <input
                      type="text"
                      placeholder={metalType === 'silver' ? "e.g. 1 Silver Anklet (Payal)" : "e.g. 1 Gold Necklace with Ruby stone"}
                      value={itemDescription}
                      onChange={(e) => setItemDescription(e.target.value)}
                      required
                    />
                  </div>

                  <div className="grid-cols-3">
                    <div className="form-group">
                      <label>{t('loans.weight') || 'Weight (Grams)'}</label>
                      <input
                        type="number"
                        step="0.01"
                        placeholder="Grams (e.g. 11.66)"
                        value={weightGrams}
                        onChange={(e) => setWeightGrams(e.target.value)}
                        required
                      />
                    </div>
                    <div className="form-group">
                      <label>{t('loans.purity') || 'Purity Grade'}</label>
                      <select
                        value={purityKarat}
                        onChange={(e) => setPurityKarat(e.target.value)}
                      >
                        {metalType === 'silver' ? (
                          <>
                            <option value="999">99.9% Pure (999)</option>
                            <option value="925">92.5% Sterling (925)</option>
                            <option value="900">90.0% Standard (900)</option>
                            <option value="800">80.0% Standard (800)</option>
                          </>
                        ) : (
                          <>
                            <option value="24">24 Karat (99.9%)</option>
                            <option value="22">22 Karat (91.6%)</option>
                            <option value="20">20 Karat (83.3%)</option>
                            <option value="18">18 Karat (75.0%)</option>
                          </>
                        )}
                      </select>
                    </div>
                    <div className="form-group">
                      <label>{t('loans.rateAtPledge') || 'Market Rate (₹/g)'}</label>
                      <input
                        type="number"
                        placeholder="Rate per gram"
                        value={marketRateAtPledge}
                        onChange={(e) => setMarketRateAtPledge(e.target.value)}
                        required
                      />
                    </div>
                  </div>

                  {/* Live Valuation Panel */}
                  <div className="loan-hero" style={{ padding: '16px 24px' }}>
                    <div>
                      <div style={{ fontSize: '0.75rem', color: 'var(--text-2)', textTransform: 'uppercase', letterSpacing: '0.08em' }}>
                        {t('loans.estimatedValue') || 'Estimated Valuation'}
                      </div>
                      <div className="hero-value gold-gradient-text" style={{ marginTop: 6 }}>
                        ₹{Math.round(estimatedValue).toLocaleString()}
                      </div>
                    </div>
                    <div style={{ minWidth: 200, flex: 1, maxWidth: 340 }}>
                      <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 8 }}>
                        <span style={{ fontSize: '0.75rem', color: 'var(--text-2)', textTransform: 'uppercase', letterSpacing: '0.08em' }}>
                          {t('loans.loanAmount') || 'LTV'} %
                        </span>
                        <span
                          style={{
                            fontWeight: 700,
                            color: formLtv > parseFloat(maxLtvPercent) ? 'var(--danger)' : 'var(--success)'
                          }}
                        >
                          {Math.round(formLtv * 100) / 100} %
                        </span>
                      </div>
                      <div className="progress" style={{ height: 10 }}>
                        <div
                          className={`progress-bar ${ltvCssClass(formLtv)}`}
                          style={{ width: `${Math.min(formLtv, 100)}%` }}
                        />
                      </div>
                      <div style={{ fontSize: '0.75rem', color: 'var(--text-3)', marginTop: 6 }}>
                        {t('loans.ltvLimit') || 'Max LTV Cap'}: {maxLtvPercent}%
                        {formLtv > parseFloat(maxLtvPercent) && ' — ' + (t('loans.ltvError') || 'Exceeds threshold')}
                      </div>
                    </div>
                  </div>

                  <div className="grid-cols-3">
                    <div className="form-group">
                      <label>{t('loans.loanAmount') || 'Disbursed Principal (₹)'}</label>
                      <input
                        type="number"
                        placeholder="Principal amount"
                        value={loanAmount}
                        onChange={(e) => setLoanAmount(e.target.value)}
                        required
                      />
                    </div>
                    <div className="form-group">
                      <label>{t('loans.interestRate') || 'Monthly Interest %'}</label>
                      <input
                        type="number"
                        step="0.01"
                        placeholder="Rate % per month"
                        value={interestRate}
                        onChange={(e) => setInterestRate(e.target.value)}
                        required
                      />
                    </div>
                    <div className="form-group">
                      <label>{t('loans.ltvLimit') || 'Max LTV Cap (%)'}</label>
                      <input
                        type="number"
                        placeholder="Max LTV cap"
                        value={maxLtvPercent}
                        onChange={(e) => setMaxLtvPercent(e.target.value)}
                        required
                      />
                    </div>
                  </div>

                  <div className="form-group">
                    <label>
                      {t('loans.pledgeReceipt') || 'Item Photos'} ({itemImages.length}/6)
                    </label>
                    <input
                      type="file"
                      accept="image/*"
                      multiple
                      onChange={handleImageUpload}
                      disabled={itemImages.length >= 6}
                    />
                  </div>

                  {itemImages.length > 0 && (
                    <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(100px, 1fr))', gap: '12px' }}>
                      {itemImages.map((img, idx) => (
                        <div key={idx} style={{ position: 'relative', aspectRatio: '1', borderRadius: '12px', overflow: 'hidden', border: '1px solid var(--border-soft)' }}>
                          <img src={img} alt={`Uploaded preview ${idx + 1}`} style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
                          <button
                            type="button"
                            onClick={() => handleRemoveImage(idx)}
                            style={{
                              position: 'absolute', top: '6px', right: '6px',
                              background: 'rgba(239,68,68,0.9)', border: 'none', color: '#fff',
                              borderRadius: '50%', width: '22px', height: '22px', cursor: 'pointer',
                              display: 'flex', alignItems: 'center', justifyContent: 'center'
                            }}
                          >
                            <Trash2 size={12} />
                          </button>
                        </div>
                      ))}
                    </div>
                  )}

                  <GoldButton
                    type="submit"
                    style={{ padding: '16px', '': '8px', fontSize: '1rem' }}
                    disabled={loading}
                  >
                    <PlusCircle size={18} />
                    {loading ? (t('common.loading') || 'Processing...') : (t('loans.issueLoanBtn') || 'Issue Pledge Loan')}
                  </GoldButton>
                </form>
              </div>
            </motion.div>

          ) : selectedLoan ? (
            /* ============ FULL-PAGE INSPECTOR ============ */
            <motion.div
              key="inspector"
              initial={{ opacity: 0, y: 20 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -12 }}
              transition={{ duration: 0.5, ease: [0.22, 1, 0.36, 1] }}
            >
              <div className="glass-panel loan-inspector-panel">
                <div className="loan-detail-layout">
                  {/* ============ LEFT SIDEBAR ============ */}
                  <aside className="loan-detail-sidebar">
                    {/* Market Watch */}
                    <FadeScale className="glass-card loan-detail-card">
                      <div className="loan-detail-card-title">
                        <TrendingUp size={17} />
                        <h4 className="serif-title">{t('loans.marketWatch') || 'Market Watch'}</h4>
                        <span className={`live-badge ${marketStatus === 'offline' ? 'offline' : marketStatus === 'cached' ? 'cached' : ''}`} style={{ marginLeft: 'auto' }}>
                          <span className={`live-pulse-dot ${marketStatus === 'offline' ? 'offline' : marketStatus === 'cached' ? 'cached' : ''}`} />
                          {marketStatus === 'offline'
                            ? (t('dashboard.marketOffline') || 'Offline')
                            : marketStatus === 'cached'
                              ? (t('dashboard.marketCached') || 'Cached')
                              : (t('dashboard.marketLive') || 'LIVE')}
                        </span>
                      </div>

                      {(() => {
                        const pledgeRate = parseFloat(selectedLoan.marketRateAtPledge) || 0;
                        const isSilver = selectedLoan.metalType === 'silver';
                        const purity = parseFloat(selectedLoan.purityKarat) || (isSilver ? 999 : 22);
                        // Compare like-for-like: Indian retail rate scaled to the loan's purity
                        const liveBase = liveRates ? (isSilver ? liveRates.retailSilver : liveRates.retailGold) : 0;
                        const currentAtPurity = isSilver ? liveBase : liveBase ? liveBase * (purity / 24) : 0;
                        const diff = currentAtPurity - pledgeRate;
                        const diffPct = pledgeRate ? (diff / pledgeRate) * 100 : 0;
                        const riskClass = ltvState
                          ? (ltvState.alertType === 'critical' ? 'chip-red' : ltvState.alertType === 'warning' ? 'chip-amber' : 'chip-green')
                          : 'chip-green';

                        return (
                          <>
                            <div className="detail-row">
                              <span className="d-label"><TrendingUp size={14} /> {t('loans.currentGoldPrice') || 'Current Retail Gold Rate (India)'}:</span>
                              <span className="d-value" style={{ fontWeight: 700 }}>
                                {liveBase ? `₹${Math.round(currentAtPurity)} / g (${purity}K)` : '—'}
                              </span>
                            </div>
                            <div className="detail-row">
                              <span className="d-label"><TrendingDown size={14} /> {t('loans.rateAtPledge') || 'Gold Price at Pledge'}:</span>
                              <span className="d-value">₹{pledgeRate} / g</span>
                            </div>
                            <div className="detail-row">
                              <span className="d-label"><Scale size={14} /> {t('loans.priceDifference') || 'Difference'}:</span>
                              <span className="d-value">
                                {liveBase ? (
                                  <span className={`market-change-chip ${diff > 0 ? 'up' : diff < 0 ? 'down' : 'flat'}`}>
                                    {diff > 0 ? '▲' : diff < 0 ? '▼' : '•'} ₹{Math.abs(Math.round(diff))} ({diffPct >= 0 ? '+' : ''}{diffPct.toFixed(2)}%)
                                  </span>
                                ) : '—'}
                              </span>
                            </div>
                            <div className="detail-row">
                              <span className="d-label"><TrendingUp size={14} /> {diff >= 0 ? (t('loans.priceGain') || 'Price Gain') : (t('loans.priceLoss') || 'Price Loss')}:</span>
                              <span className="d-value" style={{ color: diff >= 0 ? '#10b981' : '#ef4444', fontWeight: 700 }}>
                                {liveBase ? `₹${Math.abs(Math.round(diff))} / g` : '—'}
                              </span>
                            </div>
                            <div className="detail-row">
                              <span className="d-label"><Gauge size={14} /> {t('loans.currentLtv') || 'Current LTV'}:</span>
                              <span className="d-value">{ltvState ? `${ltvState.ltvPercent}%` : '—'}</span>
                            </div>
                            <div className="detail-row">
                              <span className="d-label"><ShieldAlert size={14} /> {t('loans.riskIndicator') || 'Risk Indicator'}:</span>
                              <span className="d-value">
                                {ltvState ? (
                                  <span className={`chip ${riskClass}`}>{ltvState.alertLabel}</span>
                                ) : '—'}
                              </span>
                            </div>
                            {selectedLoan.marketSource && (
                              <div style={{ fontSize: '0.75rem', color: 'var(--text-3)', marginTop: 8, display: 'flex', alignItems: 'center', gap: 6 }}>
                                <Clock size={11} />
                                {t('goldRate.source') || 'Source'}: {selectedLoan.marketSource}
                                {selectedLoan.rateTimestamp ? ` · ${new Date(selectedLoan.rateTimestamp).toLocaleString()}` : ''}
                              </div>
                            )}
                          </>
                        );
                      })()}
                    </FadeScale>

                    {/* Loan Summary */}
                    <FadeScale delay={0.04} className="glass-card loan-detail-card">
                      <div className="loan-detail-card-title">
                        <Layers size={17} />
                        <h4 className="serif-title">{t('loans.loanSummary') || 'Loan Summary'}</h4>
                      </div>
                      <div className="detail-row">
                        <span className="d-label"><Wallet size={14} /> {t('loans.loanAmount') || 'Principal Disbursed'}:</span>
                        <span className="d-value" style={{ color: 'var(--gold)', fontWeight: 700 }}>
                          ₹{selectedLoan.loanAmount?.toLocaleString()}
                        </span>
                      </div>
                      <div className="detail-row">
                        <span className="d-label"><Percent size={14} /> {t('loans.interestRate') || 'Monthly Interest'}:</span>
                        <span className="d-value">{selectedLoan.interestRate}%</span>
                      </div>
                      <div className="detail-row">
                        <span className="d-label"><TrendingDown size={14} /> {t('loans.rateAtPledge') || 'Rate at Pledge'}:</span>
                        <span className="d-value">₹{selectedLoan.marketRateAtPledge} / g</span>
                      </div>
                      <div className="detail-row">
                        <span className="d-label"><Gem size={14} /> {t('loans.estimatedValue') || 'Estimated Value'}:</span>
                        <span className="d-value">₹{selectedLoan.estimatedValue?.toLocaleString()}</span>
                      </div>
                      <div className="detail-row">
                        <span className="d-label"><Calendar size={14} /> {t('loans.pledgeDate') || 'Pledge Date'}:</span>
                        <span className="d-value">{selectedLoan.pledgeDate}</span>
                      </div>
                    </FadeScale>

                    {/* Pledged Item */}
                    <FadeScale delay={0.08} className="glass-card loan-detail-card">
                      <div className="loan-detail-card-title">
                        <Gem size={17} />
                        <h4 className="serif-title">{t('loans.pledgedItem') || 'Pledged Item'}</h4>
                      </div>
                      <div className="detail-row">
                        <span className="d-label"><Gem size={14} /> {t('loans.purity') || 'Metal / Purity'}:</span>
                        <span className="d-value" style={{ textTransform: 'capitalize' }}>
                          {selectedLoan.metalType} ({selectedLoan.purityKarat}K)
                        </span>
                      </div>
                      <div className="detail-row">
                        <span className="d-label"><Scale size={14} /> {t('loans.weight') || 'Weight'}:</span>
                        <span className="d-value">{selectedLoan.weightGrams}g</span>
                      </div>
                      {selectedLoanImages.length > 0 && (
                        <>
                          <div className="loan-detail-divider" />
                          <div className="loan-detail-section-title">
                            <ImageIcon size={16} />
                            <span className="serif-title">{t('loans.pledgeReceipt') || 'Pledged Items Photos'}</span>
                          </div>
                          <div className="photo-grid">
                            {selectedLoanImages.map((img, i) => (
                              <img key={i} src={img} alt="Pledged Item" />
                            ))}
                          </div>
                        </>
                      )}
                    </FadeScale>

                    {/* Customer Profile */}
                    <FadeScale delay={0.12} className="glass-card loan-detail-card">
                      <div className="loan-detail-card-title">
                        <User size={17} />
                        <h4 className="serif-title">{t('loans.customerProfile') || 'Customer Profile'}</h4>
                      </div>
                      <div className="detail-row">
                        <span className="d-label"><User size={14} /> {t('loans.selectCustomer') || 'Borrower Name'}:</span>
                        <span className="d-value">{selectedLoan.customerName}</span>
                      </div>
                      <div className="detail-row">
                        <span className="d-label"><Phone size={14} /> {t('customers.phone')}:</span>
                        <span className="d-value">{selectedLoan.customerPhone || '—'}</span>
                      </div>
                    </FadeScale>

                    {/* Risk Meter */}
                    {loanState && (
                      <FadeScale delay={0.16} className="glass-card loan-detail-card">
                        <div className="loan-detail-card-title">
                          <Gauge size={17} />
                          <h4 className="serif-title">{t('loans.riskMeter') || 'Risk Meter'}</h4>
                        </div>
                        <div className="detail-row">
                          <span className="d-label">{t('loans.daysElapsed') || 'Elapsed Time'}:</span>
                          <span className="d-value">{loanState.daysElapsed} {t('loans.daysElapsed') || 'Days'}</span>
                        </div>
                        <div className="detail-row">
                          <span className="d-label">{t('loans.accruedInterest') || 'Accumulated Interest'}:</span>
                          <span className="d-value" style={{ color: 'var(--warning)' }}>
                            +₹{Math.round(loanState.accumulatedInterest || 0).toLocaleString()}
                          </span>
                        </div>
                        <div className="detail-row">
                          <span className="d-label">{t('loans.payments') || 'Total Payments Received'}:</span>
                          <span className="d-value" style={{ color: 'var(--success)' }}>
                            -₹{Math.round(loanState.totalPaid || 0).toLocaleString()}
                          </span>
                        </div>
                        <div className="detail-row" style={{ borderTop: '1px solid var(--border-soft)', paddingTop: '12px', marginTop: '4px' }}>
                          <span className="d-label" style={{ fontWeight: 700 }}>{t('loans.outstanding') || 'Outstanding Balance'}:</span>
                          <span className="d-value" style={{ fontSize: '1.5rem', fontWeight: 800, color: 'var(--gold)' }}>
                            ₹{Math.round(loanState.outstandingBalance || 0).toLocaleString()}
                          </span>
                        </div>
                      </FadeScale>
                    )}

                  </aside>

                  {/* ============ RIGHT CONTENT ============ */}
                  <main className="loan-detail-main">
                    {/* Loan Header */}
                    <div className="loan-detail-header">
                      <button
                        className="btn btn-secondary"
                        onClick={() => { setSelectedLoan(null); setSearchParams({}); }}
                      >
                        <ArrowLeft size={16} />
                        {t('common.back') || 'Back to Directory'}
                      </button>
                      <div className="loan-detail-title">
                        <h2 className="serif-title">{selectedLoan.itemDescription}</h2>
                        <span className="loan-detail-ref">
                          {t('loans.refId') || 'Ref ID'}: {selectedLoan.id}
                        </span>
                      </div>
                      <span className={`badge ${statusBadgeClass(selectedLoan.status)}`}>
                        {statusLabel(selectedLoan.status)}
                      </span>
                    </div>

                    {isActiveLoan(selectedLoan.status) && ltvState && (
                      <FadeScale>
                        <div className={`alert-banner ${ltvState.alertType === 'critical' ? 'alert-critical' : ltvState.alertType === 'warning' ? 'alert-warning' : 'alert-info'}`}>
                          <AlertTriangle size={20} />
                          <span>Security Alert: {ltvState.alertLabel} ({ltvState.ltvPercent}%)</span>
                        </div>
                      </FadeScale>
                    )}

                    {successMsg && (
                      <FadeScale>
                        <div className="alert-banner alert-info">
                          <CheckCircle2 size={20} />
                          <span>{successMsg}</span>
                        </div>
                      </FadeScale>
                    )}

                    {/* Outstanding Balance Hero */}
                    {loanState && isActiveLoan(selectedLoan.status) && (
                      <FadeScale delay={0.05}>
                        <div className="loan-hero">
                          <div style={{ display: 'flex', alignItems: 'center', gap: 16 }}>
                            <span className="metal-coin"><BadgeIndianRupee size={22} /></span>
                            <div>
                              <div style={{ fontSize: '0.75rem', color: 'var(--text-2)', textTransform: 'uppercase', letterSpacing: '0.08em' }}>
                                {t('loans.outstanding') || 'Outstanding Balance'}
                              </div>
                              <div className="hero-value gold-gradient-text" style={{ marginTop: 4 }}>
                                ₹<AnimatedNumber value={Math.round(loanState.outstandingBalance || 0)} duration={1} />
                              </div>
                            </div>
                          </div>
                          <div style={{ flex: 1, minWidth: 0 }}>
                            <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 8 }}>
                              <span style={{ fontSize: '0.75rem', color: 'var(--text-2)' }}>{t('loans.accruedInterest') || 'Interest Accrued'}</span>
                              <span style={{ fontSize: '0.75rem', color: 'var(--text-2)' }}>{loanState.daysElapsed} {t('loans.daysElapsed') || 'days'}</span>
                            </div>
                            <div className="progress" style={{ height: 10 }}>
                              <div
                                className={`progress-bar ${ltvCssClass(ltvState ? ltvState.ltvPercent : 0)}`}
                                style={{ width: `${Math.min(ltvState ? ltvState.ltvPercent : 0, 100)}%` }}
                              />
                            </div>
                            <div style={{ fontSize: '0.75rem', color: 'var(--text-3)', marginTop: 6 }}>
                              LTV: {ltvState ? ltvState.ltvPercent : 0}% {ltvState && ltvState.alertLabel ? `• ${ltvState.alertLabel}` : ''}
                            </div>
                          </div>
                        </div>
                      </FadeScale>
                    )}
                    {/* Documents */}
                    <FadeScale delay={0.06} className="glass-card loan-detail-card">
                      <div className="loan-detail-card-title">
                        <Receipt size={17} />
                        <h4 className="serif-title">{t('loans.documents') || 'Documents'}</h4>
                      </div>
                      <div className="loan-doc-actions">
                        <button onClick={downloadPledgePdf} className="btn btn-secondary">
                          <FileText size={18} /> {t('loans.pledgeReceipt') || 'Download Pledge Receipt (PDF)'}
                        </button>

                        {selectedLoan.status === 'closed' && (
                          <button onClick={downloadClosurePdf} className="btn btn-secondary">
                            <FileCheck size={18} /> {t('loans.closureInvoice') || 'Download Closure Certificate (PDF)'}
                          </button>
                        )}

                        <button onClick={downloadCustomerStatement} className="btn btn-secondary">
                          <History size={18} /> {t('payments.customerStatement') || 'Download Customer Statement (PDF)'}
                        </button>

                        {role !== 'customer' && isActiveLoan(selectedLoan.status) && (
                          <>
                            <GoldButton onClick={() => { setEditingPaymentId(null); setShowPaymentModal(true); }}>
                              <DollarSign size={18} /> {t('loans.addPayment') || 'Record Repayment'}
                            </GoldButton>
                            <button onClick={handleCloseAndRedeem} className="btn btn-success" style={{ background: '#10b981', color: '#fff' }}>
                              <CheckCircle2 size={18} /> {t('loans.closeLoan') || 'Pay Off & Close Loan'}
                            </button>
                            <button onClick={() => setShowForfeitModal(true)} className="btn btn-danger" style={{ background: '#ef4444', color: '#fff' }}>
                              <AlertTriangle size={18} /> {t('loans.forfeitLoan') || 'Forfeit & Auction Item'}
                            </button>
                          </>
                        )}
                      </div>
                    </FadeScale>

                    {/* Repayment History */}
                    <FadeScale delay={0.1} className="glass-card loan-detail-card">
                      <div className="loan-detail-card-title">
                        <Landmark size={17} />
                        <h4 className="serif-title">{t('payments.history') || 'Repayment History'}</h4>
                      </div>

                      {/* Search + date filters */}
                      <div className="search-field loan-detail-search">
                        <Search size={16} />
                        <input
                          type="text"
                          placeholder={t('payments.searchPlaceholder') || 'Search by ref no, method, collector, remarks...'}
                          value={paySearch}
                          onChange={(e) => setPaySearch(e.target.value)}
                        />
                      </div>
                      <div className="loan-filter-chips">
                        {['all', 'today', 'week', 'month', 'custom'].map((f) => (
                          <button
                            key={f}
                            onClick={() => setPayFilter(f)}
                            className={`pill ${payFilter === f ? 'active' : ''}`}
                          >
                            {f === 'all' ? (t('common.all') || 'All')
                              : f === 'today' ? (t('reports.today') || 'Today')
                                : f === 'week' ? (t('reports.thisWeek') || 'This Week')
                                  : f === 'month' ? (t('reports.thisMonth') || 'This Month')
                                    : (t('reports.customRange') || 'Custom')}
                          </button>
                        ))}
                        {payFilter === 'custom' && (
                          <div className="flex-gap" style={{ gap: 8, alignItems: 'center' }}>
                            <input type="date" value={payFrom} onChange={(e) => setPayFrom(e.target.value)} style={{ padding: '8px 8px', fontSize: '0.75rem', width: 'auto' }} />
                            <span style={{ color: 'var(--text-3)', fontSize: '0.75rem' }}>→</span>
                            <input type="date" value={payTo} onChange={(e) => setPayTo(e.target.value)} style={{ padding: '8px 8px', fontSize: '0.75rem', width: 'auto' }} />
                          </div>
                        )}
                        <span className="loan-payments-count">
                          {filteredPayments.length} {t('payments.count') || 'payments'}
                        </span>
                      </div>

                      {filteredPayments.length === 0 ? (
                        <p style={{ color: 'var(--text-2)', fontSize: '0.875rem', margin: 0 }}>
                          {t('common.noRecords') || 'No payment records found for this pledge.'}
                        </p>
                      ) : (
                        <div className="table-container responsive-table-card loan-payments-table">
                          <table>
                            <thead>
                              <tr>
                                <th>{t('payments.paymentDate') || 'Date'}</th>
                                <th style={{ textAlign: 'right' }}>{t('payments.amountPaid') || 'Amount Paid'}</th>
                                <th>{t('payments.paymentMethod') || 'Method'}</th>
                                <th style={{ textAlign: 'right' }}>{t('payments.interestPaid') || 'Interest'}</th>
                                <th style={{ textAlign: 'right' }}>{t('payments.principalPaid') || 'Principal'}</th>
                                <th style={{ textAlign: 'right' }}>{t('payments.remainingPrincipal') || 'Rem. Principal'}</th>
                                <th style={{ textAlign: 'right' }}>{t('payments.newOutstanding') || 'Total Outstanding'}</th>
                                <th>{t('payments.collectedBy') || 'Collected By'}</th>
                                <th>{t('payments.referenceNumber') || 'Txn ID'}</th>
                                <th>{t('payments.remarks') || 'Remarks'}</th>
                                <th style={{ textAlign: 'right' }}>{t('common.actions') || 'Actions'}</th>
                              </tr>
                            </thead>
                            <tbody>
                              {filteredPayments.map((p) => (
                                <tr key={p.id}>
                                  <td data-label={t('payments.paymentDate') || 'Date'}>
                                    {new Date(p.paymentDate || p.date || p.createdAt).toLocaleDateString()}
                                  </td>
                                  <td data-label={t('payments.amountPaid') || 'Amount'} style={{ fontWeight: 700, color: 'var(--success)', textAlign: 'right' }}>
                                    ₹{Number(p.amount || 0).toLocaleString('en-IN')}
                                  </td>
                                  <td data-label={t('payments.paymentMethod') || 'Method'}>
                                    <span className="method-chip">{methodLabel(p.paymentMethod)}</span>
                                  </td>
                                  <td data-label={t('payments.interestPaid') || 'Interest'} style={{ textAlign: 'right' }}>
                                    ₹{Number(p.interestPaid || 0).toLocaleString('en-IN')}
                                  </td>
                                  <td data-label={t('payments.principalPaid') || 'Principal'} style={{ textAlign: 'right' }}>
                                    ₹{Number(p.principalPaid || 0).toLocaleString('en-IN')}
                                  </td>
                                  <td data-label={t('payments.remainingPrincipal') || 'Rem. Principal'} style={{ textAlign: 'right' }}>
                                    ₹{Number(p.remainingPrincipal ?? p.newOutstanding ?? 0).toLocaleString('en-IN')}
                                  </td>
                                  <td data-label={t('payments.newOutstanding') || 'Total Outstanding'} style={{ fontWeight: 600, textAlign: 'right' }}>
                                    ₹{Number(p.newOutstanding || 0).toLocaleString('en-IN')}
                                  </td>
                                  <td data-label={t('payments.collectedBy') || 'Collected By'}>{p.collectedBy || (p.recordedBy || '—').substring(0, 8)}</td>
                                  <td data-label={t('payments.referenceNumber') || 'Txn ID'}>
                                    <span style={{ fontFamily: 'monospace', fontSize: '0.75rem' }}>{p.referenceNumber || '—'}</span>
                                  </td>
                                  <td data-label={t('payments.remarks') || 'Remarks'}>
                                    <span style={{ fontSize: '0.75rem', color: 'var(--text-2)' }}>{p.remarks || '—'}</span>
                                  </td>
                                  <td data-label={t('common.actions') || 'Actions'} style={{ textAlign: 'right', whiteSpace: 'nowrap' }}>
                                    <div className="flex-gap" style={{ gap: 4, justifyContent: 'flex-end' }}>
                                      <button
                                        className="icon-btn"
                                        title={t('payments.receipt') || 'Download Payment Receipt'}
                                        onClick={() => downloadPaymentReceipt(p)}
                                      >
                                        <Download size={14} />
                                      </button>
                                      {isSuperAdmin && (
                                        <>
                                          <button className="icon-btn" title="Edit payment" onClick={() => openEditPayment(p)}>
                                            <Pencil size={14} />
                                          </button>
                                          {pendingDeleteId === p.id ? (
                                            <button
                                              className="icon-btn danger"
                                              style={{ color: '#ef4444', fontWeight: 700, fontSize: '0.75rem' }}
                                              onClick={() => handleDeletePayment(p.id)}
                                              onBlur={() => setPendingDeleteId(null)}
                                            >
                                              {t('common.confirm') || 'Confirm?'}
                                            </button>
                                          ) : (
                                            <button className="icon-btn danger" title="Delete payment" onClick={() => setPendingDeleteId(p.id)}>
                                              <Trash2 size={14} />
                                            </button>
                                          )}
                                        </>
                                      )}
                                    </div>
                                  </td>
                                </tr>
                              ))}
                            </tbody>
                          </table>
                        </div>
                      )}
                    </FadeScale>
                  </main>
                </div>
              </div>
            </motion.div>

          ) : (
            /* ============ MAIN DIRECTORY LISTING ============ */
            <motion.div
              key="directory"
              initial={{ opacity: 0, y: 20 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -12 }}
              transition={{ duration: 0.5, ease: [0.22, 1, 0.36, 1] }}
            >
              {/* Filter Tabs & Search */}
              <div className="loan-filter-bar">
                <div className="tab-pills">
                  {['all', 'open', 'partially_paid', 'closed', 'forfeited'].map((tab) => (
                    <button
                      key={tab}
                      onClick={() => setFilterTab(tab)}
                      className={`pill ${filterTab === tab ? 'active' : ''}`}
                    >
                      {tab === 'all'
                        ? (t('loans.allLoans') || 'All')
                        : (t(`loans.status${tab.charAt(0).toUpperCase() + tab.slice(1)}`) || tab)}
                    </button>
                  ))}
                </div>

                <div className="search-field">
                  <Search size={18} />
                  <input
                    type="text"
                    placeholder={t('loans.searchPlaceholder') || 'Search pledge or borrower...'}
                    value={searchQuery}
                    onChange={(e) => setSearchQuery(e.target.value)}
                  />
                </div>
              </div>

              {/* Loans Grid */}
              {filteredLoans.length === 0 ? (
                <EmptyState
                  icon={<Coins size={34} />}
                  title={t('loans.title') || 'Pledges'}
                  message={t('common.noRecords') || 'No pledge loans matching your criteria.'}
                  action={
                    role !== 'customer' && (
                      <GoldButton onClick={() => setShowAddForm(true)}>
                        <Plus size={18} />
                        <span>{t('loans.issueNew') || 'Issue New Pledge'}</span>
                      </GoldButton>
                    )
                  }
                />
              ) : (
                <StaggerGroup className="loan-card-grid">
                  {filteredLoans.map((loan, idx) => {
                    const isActiveCard = loan.status == null || loan.status === 'open' || loan.status === 'partially_paid';
                    const disbursed = parseFloat(loan.loanAmount) || 0;
                    const outstanding = isActiveCard ? (parseFloat(loan.outstandingPrincipal ?? loan.loanAmount) || 0) : 0;
                    const paidPct = (loan.status === 'closed' || loan.status === 'paid')
                      ? 100
                      : (disbursed > 0 ? Math.min(100, Math.max(0, Math.round(((disbursed - outstanding) / disbursed) * 100))) : 0);
                    return (
                      <motion.div
                        key={loan.id}
                        className="loan-card-anim"
                        initial={{ opacity: 0, y: 26 }}
                        animate={{ opacity: 1, y: 0 }}
                        whileHover={{ scale: 1.02 }}
                        transition={{ duration: 0.6, delay: idx * 0.08, ease: [0.22, 1, 0.36, 1] }}
                      >
                        <TiltCard
                          className="glass-card loan-card"
                          onClick={() => handleSelectLoan(loan)}
                        >
                          <LoanCard
                            loan={loan}
                            customerName={getCustomerName(loan.customerId)}
                            outstanding={outstanding}
                            paidPct={paidPct}
                            onView={() => handleSelectLoan(loan)}
                            t={t}
                          />
                        </TiltCard>
                      </motion.div>
                    );
                  })}
                </StaggerGroup>
              )}
            </motion.div>
          )}
        </AnimatePresence>

        {/* Modal: Record Repayment */}
        <AnimatePresence>
          {showPaymentModal && (
            <motion.div
              className="modal-backdrop"
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              transition={{ duration: 0.25 }}
              onClick={() => { if (!loading) setShowPaymentModal(false); }}
            >
              <motion.div
                className="glass-panel modal-content"
                style={{ padding: '32px', maxWidth: '520px', width: '100%', maxHeight: '88vh', overflowY: 'auto' }}
                initial={{ opacity: 0, y: 26, scale: 0.95 }}
                animate={{ opacity: 1, y: 0, scale: 1 }}
                exit={{ opacity: 0, y: 16, scale: 0.96 }}
                transition={{ duration: 0.35, ease: [0.22, 1, 0.36, 1] }}
                onClick={(e) => e.stopPropagation()}
              >
                {paymentSuccess ? (
                  /* Success animation */
                  <div style={{ textAlign: 'center', padding: '34px 10px' }}>
                    <motion.div
                      initial={{ scale: 0, rotate: -30 }}
                      animate={{ scale: 1, rotate: 0 }}
                      transition={{ type: 'spring', stiffness: 260, damping: 16 }}
                      style={{
                        width: 72, height: 72, margin: '0 auto 18px', borderRadius: '50%',
                        background: 'linear-gradient(135deg, #34d399, #10b981)',
                        display: 'flex', alignItems: 'center', justifyContent: 'center',
                        boxShadow: '0 14px 34px rgba(16,185,129,0.4)'
                      }}
                    >
                      <CheckCircle2 size={38} color="#fff" />
                    </motion.div>
                    <h3 className="serif-title" style={{ margin: '0 0 6px', fontSize: '1.25rem' }}>
                      {editingPaymentId ? 'Payment Updated!' : 'Payment Recorded!'}
                    </h3>
                    <p style={{ color: 'var(--text-2)', fontSize: '0.875rem', margin: 0 }}>
                      {editingPaymentId
                        ? (t('payments.updatedMessage') || 'Repayment record updated successfully.')
                        : paymentBreakdown?.fullyRepaid
                          ? (t('payments.closedMessage') || 'Loan fully repaid — closing loan...')
                          : (t('payments.recordedMessage') || 'Outstanding balance updated automatically.')}
                    </p>
                  </div>
                ) : (
                  <>
                    <div className="flex-between" style={{ marginBottom: '16px' }}>
                      <h3 className="serif-title" style={{ fontSize: '1.25rem', margin: 0 }}>
                        {editingPaymentId ? (t('payments.editTitle') || 'Edit Payment') : (t('loans.addPayment') || 'Record Loan Payment')}
                      </h3>
                      <span className="metal-coin" style={{ width: 36, height: 36 }}><Banknote size={17} /></span>
                    </div>

                    {paymentError && (
                      <div className="alert-banner alert-critical" style={{ '': '16px' }}>
                        <XCircle size={18} />
                        <span>{paymentError}</span>
                      </div>
                    )}

                    <form onSubmit={handleAddPayment} style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>
                      <div className="form-group" style={{ marginBottom: 0 }}>
                        <label>{t('loans.paymentAmount') || 'Payment Amount (₹)'}</label>
                        <input
                          type="number"
                          min="1"
                          step="0.01"
                          value={paymentAmount}
                          onChange={(e) => setPaymentAmount(e.target.value)}
                          placeholder={editingPaymentId ? 'Amount cannot be changed here' : 'e.g. 5000'}
                          required
                          autoFocus
                          disabled={!!editingPaymentId}
                        />
                        {editingPaymentId && (
                          <p style={{ fontSize: '0.75rem', color: 'var(--text-3)', marginTop: 5 }}>
                            {t('payments.editHint') || 'To change the amount or date, delete and re-record the payment.'}
                          </p>
                        )}
                      </div>

                      <div className="grid-cols-2" style={{ gap: '16px' }}>
                        <div className="form-group" style={{ marginBottom: 0 }}>
                          <label>{t('payments.paymentDate') || 'Payment Date'}</label>
                          <input
                            type="date"
                            value={paymentDate}
                            onChange={(e) => setPaymentDate(e.target.value)}
                            required
                            disabled={!!editingPaymentId}
                          />
                        </div>
                        <div className="form-group" style={{ marginBottom: 0 }}>
                          <label>{t('payments.paymentMethod') || 'Payment Method'}</label>
                          <select value={paymentMethod} onChange={(e) => setPaymentMethod(e.target.value)}>
                            <option value="cash">{t('payments.cash') || 'Cash'}</option>
                            <option value="upi">{t('payments.upi') || 'UPI'}</option>
                            <option value="bank_transfer">{t('payments.bankTransfer') || 'Bank Transfer'}</option>
                            <option value="cheque">{t('payments.cheque') || 'Cheque'}</option>
                          </select>
                        </div>
                      </div>

                      <div className="grid-cols-2" style={{ gap: '16px' }}>
                        <div className="form-group" style={{ marginBottom: 0 }}>
                          <label>{t('payments.referenceNumber') || 'Reference Number'}</label>
                          <input
                            type="text"
                            value={referenceNumber}
                            onChange={(e) => setReferenceNumber(e.target.value)}
                            placeholder="UPI txn / cheque no."
                          />
                        </div>
                        <div className="form-group" style={{ marginBottom: 0 }}>
                          <label>{t('payments.collectedBy') || 'Collected By'}</label>
                          <input
                            type="text"
                            value={collectedBy}
                            onChange={(e) => setCollectedBy(e.target.value)}
                            placeholder={t('payments.collectedByPlaceholder') || 'Staff name'}
                          />
                        </div>
                      </div>

                      <div className="form-group" style={{ marginBottom: 0 }}>
                        <label>{t('payments.remarks') || 'Remarks'}</label>
                        <textarea
                          value={paymentRemarks}
                          onChange={(e) => setPaymentRemarks(e.target.value)}
                          placeholder={t('payments.remarksPlaceholder') || 'Optional notes about this payment'}
                          rows={2}
                        />
                      </div>

                      {!editingPaymentId && paymentBreakdown && parseFloat(paymentAmount) > 0 && (
                        <div
                          style={{
                            border: '1px solid ' + (paymentBreakdown.fullyRepaid ? 'rgba(16,185,129,0.4)' : 'rgba(212,175,55,0.35)'),
                            borderRadius: 12,
                            background: paymentBreakdown.fullyRepaid ? 'rgba(16,185,129,0.07)' : 'rgba(212,175,55,0.05)',
                            padding: '12px 14px',
                            display: 'flex',
                            flexDirection: 'column',
                            gap: 6
                          }}
                        >
                          <div className="flex-between" style={{ fontSize: '0.875rem' }}>
                            <span style={{ color: 'var(--text-2)' }}>{t('payments.interestPaid') || 'Interest settled'}:</span>
                            <span style={{ fontWeight: 700 }}>₹{Math.round(paymentBreakdown.interestPaid).toLocaleString('en-IN')}</span>
                          </div>
                          <div className="flex-between" style={{ fontSize: '0.875rem' }}>
                            <span style={{ color: 'var(--text-2)' }}>{t('payments.principalPaid') || 'Principal reduced'}:</span>
                            <span style={{ fontWeight: 700 }}>₹{Math.round(paymentBreakdown.principalPaid).toLocaleString('en-IN')}</span>
                          </div>
                          <div className="flex-between" style={{ fontSize: '0.875rem' }}>
                            <span style={{ color: 'var(--text-2)' }}>{t('payments.newOutstanding') || 'New outstanding'}:</span>
                            <span style={{ fontWeight: 800, color: paymentBreakdown.fullyRepaid ? 'var(--success)' : 'var(--gold)' }}>
                              {paymentBreakdown.fullyRepaid
                                ? (t('payments.zeroOutstanding') || '₹0 — Loan will close')
                                : `₹${Math.round(paymentBreakdown.newOutstanding).toLocaleString('en-IN')}`}
                            </span>
                          </div>
                        </div>
                      )}

                      <div style={{ display: 'flex', gap: '12px', marginTop: '12px' }}>
                        <GoldButton type="submit" style={{ flex: 1 }} disabled={loading}>
                          {loading ? (
                            <span style={{ display: 'inline-flex', alignItems: 'center', gap: 8 }}>
                              <span className="gold-spinner" style={{ width: 14, height: 14 }} />
                              {t('common.loading') || 'Saving...'}
                            </span>
                          ) : editingPaymentId ? (t('common.save') || 'Save Changes') : (t('loans.addPayment') || 'Record Payment')}
                        </GoldButton>
                        <button type="button" className="btn btn-secondary" onClick={() => { if (!loading) setShowPaymentModal(false); }}>
                          {t('common.cancel') || 'Cancel'}
                        </button>
                      </div>
                    </form>
                  </>
                )}
              </motion.div>
            </motion.div>
          )}
        </AnimatePresence>

        {/* Modal: Forfeit & Auction */}
        <AnimatePresence>
          {showForfeitModal && (
            <motion.div
              className="modal-backdrop"
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              transition={{ duration: 0.25 }}
              onClick={() => setShowForfeitModal(false)}
            >
              <motion.div
                className="glass-panel modal-content"
                style={{ padding: '32px', maxWidth: '440px', width: '100%' }}
                initial={{ opacity: 0, y: 26, scale: 0.95 }}
                animate={{ opacity: 1, y: 0, scale: 1 }}
                exit={{ opacity: 0, y: 16, scale: 0.96 }}
                transition={{ duration: 0.35, ease: [0.22, 1, 0.36, 1] }}
                onClick={(e) => e.stopPropagation()}
              >
                <div className="flex-between" style={{ marginBottom: '16px' }}>
                  <h3 className="serif-title" style={{ fontSize: '1.25rem', margin: 0 }}>
                    {t('loans.auctionTitle') || 'Register Item Auction / Forfeiture'}
                  </h3>
                  <span className="metal-coin" style={{ width: 36, height: 36 }}><AlertTriangle size={17} /></span>
                </div>
                <form onSubmit={handleForfeitAndAuction} style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>
                  <div className="form-group" style={{ marginBottom: 0 }}>
                    <label>{t('loans.auctionAmount') || 'Auction Sale Price (₹)'}</label>
                    <input
                      type="number"
                      value={auctionAmount}
                      onChange={(e) => setAuctionAmount(e.target.value)}
                      placeholder={t('loans.auctionRecoveryPlaceholder') || 'Final realized sale value'}
                      required
                      autoFocus
                    />
                  </div>
                  <div className="form-group" style={{ marginBottom: 0 }}>
                    <label>{t('loans.auctionSaleDate') || 'Auction Date'}</label>
                    <input
                      type="date"
                      value={auctionDate}
                      onChange={(e) => setAuctionDate(e.target.value)}
                      required
                    />
                  </div>
                  <div className="form-group" style={{ marginBottom: 0 }}>
                    <label>{t('loans.settlementOutcome') || 'Settlement Type'}</label>
                    <select value={settlementType} onChange={(e) => setSettlementType(e.target.value)}>
                      <option value="refund">{t('loans.auctionRefund') || 'Refund Surplus to Borrower'}</option>
                      <option value="write_off">{t('loans.auctionWriteoff') || 'Write-off Loss Balance'}</option>
                    </select>
                  </div>
                  <div className="form-group" style={{ marginBottom: 0 }}>
                    <label>{t('loans.auctionNotes') || 'Auction Notes'}</label>
                    <textarea
                      value={auctionNotes}
                      onChange={(e) => setAuctionNotes(e.target.value)}
                      placeholder={t('loans.auctionNotesPlaceholder') || 'Details about bidder/buyer or auction process...'}
                      rows={3}
                    />
                  </div>
                  <div style={{ display: 'flex', gap: '12px', marginTop: '12px' }}>
                    <button type="submit" className="btn btn-danger" style={{ flex: 1, background: '#ef4444', color: '#fff' }} disabled={loading}>
                      {loading ? (t('common.loading') || 'Processing...') : (t('loans.forfeitLoan') || 'Confirm Forfeiture')}
                    </button>
                    <button type="button" className="btn btn-secondary" onClick={() => setShowForfeitModal(false)}>
                      {t('common.cancel') || 'Cancel'}
                    </button>
                  </div>
                </form>
              </motion.div>
            </motion.div>
          )}
        </AnimatePresence>

      </main>
    </div>
  );
}
