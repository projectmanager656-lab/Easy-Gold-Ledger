import React, { useState, useEffect, useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import { motion } from 'framer-motion';
import { collection, getDocs } from 'firebase/firestore';
import { db } from '../services/firebase';
import { calculateLoanState, isActiveLoan } from '../utils/interestEngine';
import useLiveGoldRates from '../hooks/useLiveGoldRates';
import { jsPDF } from 'jspdf';
import {
  PageHeader,
  StatCard,
  SkeletonCard,
  GoldButton,
  useGreeting
} from '../components/PremiumUI';
import {
  Download,
  AlertTriangle,
  Wallet,
  Banknote,
  Coins,
  CalendarRange,
  Gem,
  RefreshCw,
  Sparkles,
  History,
  FileSpreadsheet,
  TrendingUp,
  Percent,
  Gauge as GaugeIcon
} from 'lucide-react';

export const REPORT_STATUS_LABEL = (status) => {
  if (status === 'open') return 'OPEN';
  if (status === 'partially_paid') return 'PARTIALLY PAID';
  if (status === 'paid') return 'PAID';
  if (status === 'defaulted') return 'DEFAULTED';
  if (status === 'closed') return 'CLOSED';
  if (status === 'forfeited') return 'FORFEITED';
  return (status || '').toUpperCase();
};

// Collection-oriented report types render the payment ledger dataset.
const PAYMENT_REPORT_TYPES = ['daily_collection', 'monthly_collection', 'payment_ledger'];

// Helper to fetch Montserrat font dynamically
async function loadMontserrat(doc) {
  try {
    const regularUrl = 'https://cdn.jsdelivr.net/gh/JulietaUla/Montserrat/fonts/ttf/Montserrat-Regular.ttf';
    const boldUrl = 'https://cdn.jsdelivr.net/gh/JulietaUla/Montserrat/fonts/ttf/Montserrat-Bold.ttf';

    const [regRes, boldRes] = await Promise.all([
      fetch(regularUrl).then(r => {
        if (!r.ok) throw new Error();
        return r.arrayBuffer();
      }),
      fetch(boldUrl).then(r => {
        if (!r.ok) throw new Error();
        return r.arrayBuffer();
      })
    ]);

    const regBase64 = arrayBufferToBase64(regRes);
    const boldBase64 = arrayBufferToBase64(boldRes);

    doc.addFileToVFS('Montserrat-Regular.ttf', regBase64);
    doc.addFont('Montserrat-Regular.ttf', 'Montserrat', 'normal');

    doc.addFileToVFS('Montserrat-Bold.ttf', boldBase64);
    doc.addFont('Montserrat-Bold.ttf', 'Montserrat', 'bold');

    doc.setFont('Montserrat', 'normal');
    return true;
  } catch (e) {
    console.warn('Montserrat font download failed, using Helvetica fallback:', e);
    doc.setFont('Helvetica', 'normal');
    return false;
  }
}

function arrayBufferToBase64(buffer) {
  let binary = '';
  const bytes = new Uint8Array(buffer);
  const len = bytes.byteLength;
  for (let i = 0; i < len; i++) {
    binary += String.fromCharCode(bytes[i]);
  }
  return btoa(binary);
}

export default function Reports() {
  const { t } = useTranslation();
  const greeting = useGreeting();

  // Live market feed (auto-refresh 60s) — reports show current metal values
  const { data: liveRates, status: marketStatus } = useLiveGoldRates();

  // Loading States
  const [loading, setLoading] = useState(true);

  // Raw database data
  const [loans, setLoans] = useState([]);

  // Date Filters
  // 'daily' | 'monthly' | 'yearly' | 'custom' (loan statement)
  // 'daily_collection' | 'monthly_collection' | 'payment_ledger' | 'outstanding' | 'recovery'
  const [reportType, setReportType] = useState('daily');
  const [startDate, setStartDate] = useState(new Date().toISOString().split('T')[0]);
  const [endDate, setEndDate] = useState(new Date().toISOString().split('T')[0]);

  // Aggregated Report Metrics
  const [metrics, setMetrics] = useState({
    totalDisbursed: 0,
    totalDuesRecovered: 0,
    interestEarned: 0,
    outstandingPrincipal: 0,
    loansIssuedCount: 0,
    loansClosedCount: 0,
    loansForfeitedCount: 0,
    activeLtvAlerts: 0,
    // payment-mode metrics
    paymentsCount: 0,
    principalCollected: 0,
    activeLoansCount: 0,
    atRiskLoans: 0,
    recoveredLoans: 0,
    maxLtv: 0
  });

  const [filteredReportData, setFilteredReportData] = useState([]);
  const [paymentRows, setPaymentRows] = useState([]);

  // Set default dates on report type change
  useEffect(() => {
    const today = new Date();
    const start = new Date();

    if (reportType === 'daily' || reportType === 'daily_collection') {
      const todayStr = today.toISOString().split('T')[0];
      setStartDate(todayStr);
      setEndDate(todayStr);
    } else if (reportType === 'monthly' || reportType === 'monthly_collection' || reportType === 'payment_ledger') {
      start.setDate(1); // First day of current month
      setStartDate(start.toISOString().split('T')[0]);
      setEndDate(today.toISOString().split('T')[0]);
    } else if (reportType === 'yearly') {
      start.setMonth(0, 1); // Jan 1st
      setStartDate(start.toISOString().split('T')[0]);
      setEndDate(today.toISOString().split('T')[0]);
    }
    // 'custom', 'outstanding', 'recovery' keep the current date inputs.
  }, [reportType]);

  // Fetch and Aggregate Reports Data
  const runReportQuery = async () => {
    setLoading(true);
    try {
      // Fetch all customers once, cache by UID
      const usersSnap = await getDocs(collection(db, 'users'));
      const customerMap = {};
      usersSnap.docs.forEach(d => {
        customerMap[d.id] = d.data();
      });

      const loansSnap = await getDocs(collection(db, 'loans'));
      const rawLoans = loansSnap.docs.map(d => ({ id: d.id, ...d.data() }));

      const start = new Date(startDate);
      start.setHours(0, 0, 0, 0);
      const end = new Date(endDate);
      end.setHours(23, 59, 59, 999);

      let totalDisbursedVal = 0;
      let totalRecoveredVal = 0;
      let interestCollectedVal = 0;
      let outstandingVal = 0;
      let issuedCount = 0;
      let closedCount = 0;
      let forfeitedCount = 0;
      let alertCount = 0;
      let principalCollectedVal = 0;
      let paymentsCount = 0;
      let activeLoansCount = 0;
      let atRiskLoans = 0;
      let recoveredLoans = 0;
      let maxLtv = 0;

      const reportRows = [];
      const paymentRowsAll = [];

      for (const loan of rawLoans) {
        const pledgeDate = new Date(loan.pledgeDate);

        // 1. Fetch payments sub-collection for this loan
        const paymentsSnap = await getDocs(collection(db, 'loans', loan.id, 'payments'));
        const payments = paymentsSnap.docs.map(d => d.data());

        // Calculate current state
        const state = calculateLoanState(
          loan.loanAmount,
          loan.interestRate,
          loan.pledgeDate,
          payments
        );

        // Track running outstanding totals if loan is active
        if (isActiveLoan(loan.status)) {
          outstandingVal += state.currentPrincipal;
          activeLoansCount++;
          // check alert status
          const ltvPercent = (state.outstandingBalance / loan.estimatedValue) * 100;
          if (ltvPercent >= 90) alertCount++;
          if (ltvPercent >= 75) atRiskLoans++;
          if (ltvPercent > maxLtv) maxLtv = ltvPercent;
        }
        if ((parseInt(loan.paymentCount, 10) || 0) > 0) recoveredLoans++;

        // Check if loan fits filter date range
        const fitsRange = pledgeDate >= start && pledgeDate <= end;
        if (fitsRange) {
          issuedCount++;
          totalDisbursedVal += loan.loanAmount;
          if (loan.status === 'closed') closedCount++;
          if (loan.status === 'forfeited') forfeitedCount++;
        }

        // Resolve customer name from cache
        const customer = customerMap[loan.customerId];
        const customerName = customer ? (customer.name || customer.displayName || 'Unknown') : 'Unknown';
        const customerPhone = customer ? (customer.phone || '') : '';

        // Aggregate payments received within the date range
        payments.forEach((pay) => {
          const payDate = new Date(pay.paymentDate || pay.createdAt);
          if (payDate >= start && payDate <= end) {
            totalRecoveredVal += pay.amount;
            if (pay.paymentType === 'interest_only') {
              interestCollectedVal += pay.amount;
            }
          }
          // Payment ledger rows (for collection / payment reports)
          const payInt = parseFloat(pay.interestPaid) || (pay.paymentType === 'interest_only' ? (parseFloat(pay.amount) || 0) : 0);
          paymentRowsAll.push({
            id: `${loan.id}_${pay.id || pay.createdAt || pay.paymentDate}`,
            paymentId: pay.id || '',
            loanId: loan.id,
            customerName,
            customerPhone,
            description: loan.itemDescription,
            metalType: loan.metalType || 'gold',
            amount: parseFloat(pay.amount) || 0,
            paymentDate: pay.paymentDate || pay.createdAt,
            paymentMethod: pay.paymentMethod || pay.paymentType || 'cash',
            referenceNumber: pay.referenceNumber || '',
            collectedBy: pay.collectedBy || '',
            interestPaid: payInt,
            principalPaid: parseFloat(pay.principalPaid) || 0,
            newOutstanding: parseFloat(pay.newOutstanding) || 0,
            remainingPrincipal: parseFloat(pay.remainingPrincipal) || 0
          });
          if (payDate >= start && payDate <= end) {
            paymentsCount++;
            principalCollectedVal += parseFloat(pay.principalPaid) || 0;
          }
        });

        // Add to report rows
        reportRows.push({
          id: loan.id,
          customerName,
          customerPhone,
          description: loan.itemDescription,
          metalType: loan.metalType || 'gold',
          amount: loan.loanAmount,
          status: loan.status,
          date: loan.pledgeDate,
          balance: state.outstandingBalance,
          totalPaid: (parseFloat(loan.totalPaid) || 0),
          ltv: state.outstandingBalance && loan.estimatedValue
            ? Math.round(((state.outstandingBalance / loan.estimatedValue) * 100) * 100) / 100
            : 0
        });
      }

      // Outstanding / Recovery reports ignore the date range for loan rows
      // (they snapshot the current book), but respect it for payment rows.
      let shownRows = reportRows;
      if (reportType === 'outstanding') {
        shownRows = reportRows.filter(r => isActiveLoan(r.status)).sort((a, b) => b.balance - a.balance);
      } else if (reportType === 'recovery') {
        shownRows = reportRows.filter(r => r.totalPaid > 0).sort((a, b) => b.totalPaid - a.totalPaid);
      } else {
        shownRows = reportRows.filter(r => {
          const d = new Date(r.date);
          return d >= start && d <= end;
        });
      }

      setPaymentRows(paymentRowsAll);

      const dateFilteredPayments = paymentRowsAll.filter((p) => {
        const d = new Date(p.paymentDate);
        return d >= start && d <= end;
      });

      setMetrics({
        totalDisbursed: Math.round(totalDisbursedVal),
        totalDuesRecovered: Math.round(PAYMENT_REPORT_TYPES.includes(reportType) ? dateFilteredPayments.reduce((s, p) => s + p.amount, 0) : totalRecoveredVal),
        interestEarned: Math.round(dateFilteredPayments.reduce((s, p) => s + p.interestPaid, 0)),
        outstandingPrincipal: Math.round(outstandingVal),
        loansIssuedCount: issuedCount,
        loansClosedCount: closedCount,
        loansForfeitedCount: forfeitedCount,
        activeLtvAlerts: alertCount,
        paymentsCount: dateFilteredPayments.length,
        principalCollected: Math.round(dateFilteredPayments.reduce((s, p) => s + p.principalPaid, 0)),
        activeLoansCount,
        atRiskLoans,
        recoveredLoans,
        maxLtv: Math.round(maxLtv * 100) / 100
      });

      setFilteredReportData(shownRows);
      setLoans(rawLoans);
    } catch (err) {
      console.error(err);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    runReportQuery();
  }, [startDate, endDate]);

  /**
   * Shared landscape table PDF builder for the collection / outstanding /
   * recovery report modes.
   */
  const buildTablePdf = async ({ subtitle, cols, rows, renderCell, filename }) => {
    const doc = new jsPDF({ orientation: 'landscape', unit: 'mm', format: 'a4' });
    await loadMontserrat(doc);

    const goldPrimary = [186, 140, 20];
    const darkBg = [30, 41, 59];
    const white = [255, 255, 255];
    const grayMuted = [100, 116, 139];
    const pageW = 297;
    const pageH = 210;

    doc.setDrawColor(226, 232, 240);
    doc.setLineWidth(0.3);
    doc.rect(4, 4, pageW - 8, pageH - 8);

    doc.setFillColor(darkBg[0], darkBg[1], darkBg[2]);
    doc.rect(5, 5, pageW - 10, 22, 'F');
    doc.setTextColor(goldPrimary[0], goldPrimary[1], goldPrimary[2]);
    doc.setFont('Montserrat', 'bold');
    doc.setFontSize(18);
    doc.text('EASY GOLD LEDGER', 12, 19);
    doc.setTextColor(white[0], white[1], white[2]);
    doc.setFont('Montserrat', 'normal');
    doc.setFontSize(9);
    doc.text(subtitle.toUpperCase(), pageW - 80, 16);
    doc.text(`Period: ${new Date(startDate).toLocaleDateString()} - ${new Date(endDate).toLocaleDateString()}`, pageW - 80, 22);

    // Column x positions are computed from widths
    let totalW = 0;
    cols.forEach(c => { totalW += c.w; });
    let xCursor = 10;
    const positioned = cols.map(c => {
      const x = xCursor;
      xCursor += c.w;
      return { ...c, x };
    });

    doc.setTextColor(darkBg[0], darkBg[1], darkBg[2]);
    doc.setFontSize(8.5);
    doc.setFont('Montserrat', 'bold');
    doc.text(`Records: ${rows.length}`, 12, 36);
    doc.setDrawColor(200, 200, 200);
    doc.line(10, 40, pageW - 10, 40);

    doc.setFillColor(darkBg[0], darkBg[1], darkBg[2]);
    doc.rect(10, 43, pageW - 20, 8, 'F');
    doc.setTextColor(goldPrimary[0], goldPrimary[1], goldPrimary[2]);
    doc.setFont('Montserrat', 'bold');
    doc.setFontSize(8);
    positioned.forEach(col => doc.text(col.label, col.x + 1, 49));

    doc.setFont('Montserrat', 'normal');
    doc.setTextColor(darkBg[0], darkBg[1], darkBg[2]);
    let currentY = 57;
    let rowNum = 1;

    rows.forEach((row, idx) => {
      if (currentY > pageH - 18) {
        doc.addPage();
        doc.rect(4, 4, pageW - 8, pageH - 8);
        doc.setFillColor(darkBg[0], darkBg[1], darkBg[2]);
        doc.rect(10, 8, pageW - 20, 8, 'F');
        doc.setTextColor(goldPrimary[0], goldPrimary[1], goldPrimary[2]);
        doc.setFont('Montserrat', 'bold');
        doc.setFontSize(8);
        positioned.forEach(col => doc.text(col.label, col.x + 1, 14));
        doc.setFont('Montserrat', 'normal');
        doc.setTextColor(darkBg[0], darkBg[1], darkBg[2]);
        currentY = 22;
      }
      if (idx % 2 === 0) {
        doc.setFillColor(245, 246, 248);
        doc.rect(10, currentY - 5, pageW - 20, 7, 'F');
      }
      doc.setFontSize(8);
      doc.setTextColor(darkBg[0], darkBg[1], darkBg[2]);
      doc.text(String(rowNum), positioned[0].x + 1, currentY);
      renderCell(doc, row, positioned, currentY);
      currentY += 8;
      rowNum++;
    });

    if (rows.length === 0) {
      doc.setTextColor(grayMuted[0], grayMuted[1], grayMuted[2]);
      doc.text('No records found for this range.', 12, 60);
    }

    doc.setFontSize(7);
    doc.setFont('Montserrat', 'normal');
    doc.setTextColor(grayMuted[0], grayMuted[1], grayMuted[2]);
    doc.text(`Generated: ${new Date().toLocaleString()} | Total Records: ${rows.length}`, 12, pageH - 8);

    doc.save(filename);
  };

  const generatePaymentsPdf = () => buildTablePdf({
    title: 'PAYMENT LEDGER',
    subtitle: 'PAYMENT LEDGER REPORT',
    cols: [
      { label: '#', w: 8 },
      { label: 'Date', w: 18 },
      { label: 'Customer', w: 36 },
      { label: 'Loan Ref', w: 24 },
      { label: 'Item', w: 36 },
      { label: 'Method', w: 18 },
      { label: 'Amount (INR)', w: 24 },
      { label: 'Interest', w: 20 },
      { label: 'Principal', w: 22 },
      { label: 'Outstanding', w: 24 },
      { label: 'Collected By', w: 22 }
    ],
    rows: tableRows,
    renderCell: (doc, row, cols, y) => {
      doc.text(new Date(row.paymentDate).toLocaleDateString(), cols[1].x + 1, y);
      doc.setFont('Montserrat', 'bold');
      doc.text((row.customerName || 'Unknown').substring(0, 18), cols[2].x + 1, y);
      doc.setFont('Montserrat', 'normal');
      doc.text(String(row.loanId).substring(0, 8), cols[3].x + 1, y);
      doc.text((row.description || '').substring(0, 20), cols[4].x + 1, y);
      doc.text(String(row.paymentMethod || 'cash').toUpperCase().substring(0, 10), cols[5].x + 1, y);
      doc.text(`${Number(row.amount || 0).toLocaleString('en-IN')}`, cols[6].x + 1, y);
      doc.text(`${Math.round(row.interestPaid || 0).toLocaleString('en-IN')}`, cols[7].x + 1, y);
      doc.text(`${Math.round(row.principalPaid || 0).toLocaleString('en-IN')}`, cols[8].x + 1, y);
      doc.text(`${Math.round(row.newOutstanding || 0).toLocaleString('en-IN')}`, cols[9].x + 1, y);
      doc.text((row.collectedBy || '').substring(0, 12), cols[10].x + 1, y);
    },
    filename: `Payment_Ledger_${startDate}_to_${endDate}.pdf`
  });

  const generateOutstandingPdf = () => buildTablePdf({
    title: 'OUTSTANDING LOAN BOOK',
    subtitle: 'OUTSTANDING REPORT',
    cols: [
      { label: '#', w: 8 },
      { label: 'Customer', w: 40 },
      { label: 'Loan Ref', w: 24 },
      { label: 'Item', w: 48 },
      { label: 'Disbursed (INR)', w: 28 },
      { label: 'Principal Out (INR)', w: 32 },
      { label: 'Balance Due (INR)', w: 32 },
      { label: 'LTV %', w: 18 },
      { label: 'Status', w: 24 }
    ],
    rows: tableRows,
    renderCell: (doc, row, cols, y) => {
      doc.setFont('Montserrat', 'bold');
      doc.text((row.customerName || 'Unknown').substring(0, 20), cols[1].x + 1, y);
      doc.setFont('Montserrat', 'normal');
      doc.text(String(row.id).substring(0, 8), cols[2].x + 1, y);
      doc.text((row.description || '').substring(0, 24), cols[3].x + 1, y);
      doc.text(`${Number(row.amount || 0).toLocaleString('en-IN')}`, cols[4].x + 1, y);
      doc.text(`${Math.round(row.balance || 0).toLocaleString('en-IN')}`, cols[5].x + 1, y);
      doc.text(`${Math.round(row.balance || 0).toLocaleString('en-IN')}`, cols[6].x + 1, y);
      doc.text(`${row.ltv}%`, cols[7].x + 1, y);
      doc.setFont('Montserrat', 'bold');
      doc.text(REPORT_STATUS_LABEL(row.status), cols[8].x + 1, y);
      doc.setFont('Montserrat', 'normal');
    },
    filename: `Outstanding_Report_${startDate}_to_${endDate}.pdf`
  });

  const generateRecoveryPdf = () => buildTablePdf({
    title: 'RECOVERY REGISTER',
    subtitle: 'RECOVERY REPORT',
    cols: [
      { label: '#', w: 8 },
      { label: 'Customer', w: 42 },
      { label: 'Loan Ref', w: 24 },
      { label: 'Item', w: 48 },
      { label: 'Disbursed (INR)', w: 28 },
      { label: 'Total Paid (INR)', w: 32 },
      { label: 'Balance Due (INR)', w: 32 },
      { label: 'Status', w: 24 }
    ],
    rows: tableRows,
    renderCell: (doc, row, cols, y) => {
      doc.setFont('Montserrat', 'bold');
      doc.text((row.customerName || 'Unknown').substring(0, 20), cols[1].x + 1, y);
      doc.setFont('Montserrat', 'normal');
      doc.text(String(row.id).substring(0, 8), cols[2].x + 1, y);
      doc.text((row.description || '').substring(0, 24), cols[3].x + 1, y);
      doc.text(`${Number(row.amount || 0).toLocaleString('en-IN')}`, cols[4].x + 1, y);
      doc.text(`${Math.round(row.totalPaid || 0).toLocaleString('en-IN')}`, cols[5].x + 1, y);
      doc.text(`${Math.round(row.balance || 0).toLocaleString('en-IN')}`, cols[6].x + 1, y);
      doc.setFont('Montserrat', 'bold');
      doc.text(REPORT_STATUS_LABEL(row.status), cols[7].x + 1, y);
      doc.setFont('Montserrat', 'normal');
    },
    filename: `Recovery_Report_${startDate}_to_${endDate}.pdf`
  });

  const generateReportPdf = async () => {
    if (reportMode === 'payments') return generatePaymentsPdf();
    if (reportMode === 'outstanding') return generateOutstandingPdf();
    if (reportMode === 'recovery') return generateRecoveryPdf();
    const doc = new jsPDF({
      orientation: 'landscape',
      unit: 'mm',
      format: 'a4'
    });

    await loadMontserrat(doc);

    const goldPrimary = [186, 140, 20];
    const darkBg = [30, 41, 59];
    const white = [255, 255, 255];
    const grayMuted = [100, 116, 139];
    const silverColor = [100, 116, 139];
    const goldColor = [186, 140, 20];
    const pageW = 297;
    const pageH = 210;

    // Border
    doc.setDrawColor(226, 232, 240);
    doc.setLineWidth(0.3);
    doc.rect(4, 4, pageW - 8, pageH - 8);

    // Header bar
    doc.setFillColor(darkBg[0], darkBg[1], darkBg[2]);
    doc.rect(5, 5, pageW - 10, 22, 'F');
    doc.setTextColor(goldPrimary[0], goldPrimary[1], goldPrimary[2]);
    doc.setFont('Montserrat', 'bold');
    doc.setFontSize(18);
    doc.text('EASY GOLD LEDGER', 12, 19);
    doc.setTextColor(white[0], white[1], white[2]);
    doc.setFont('Montserrat', 'normal');
    doc.setFontSize(9);
    doc.text('FINANCIAL STATEMENT REPORT', pageW - 80, 16);
    doc.text(`Period: ${new Date(startDate).toLocaleDateString()} - ${new Date(endDate).toLocaleDateString()}`, pageW - 80, 22);

    // Summary metrics row
    doc.setTextColor(darkBg[0], darkBg[1], darkBg[2]);
    doc.setFontSize(8.5);
    doc.setFont('Montserrat', 'bold');
    doc.text(`Disbursed: INR ${metrics.totalDisbursed.toLocaleString()}`, 12, 36);
    doc.text(`Collected: INR ${metrics.totalDuesRecovered.toLocaleString()}`, 75, 36);
    doc.text(`Outstanding: INR ${metrics.outstandingPrincipal.toLocaleString()}`, 145, 36);
    doc.text(`Issued: ${metrics.loansIssuedCount}  Closed: ${metrics.loansClosedCount}  Forfeited: ${metrics.loansForfeitedCount}`, 215, 36);
    doc.setDrawColor(200, 200, 200);
    doc.line(10, 40, pageW - 10, 40);

    // Column definitions (landscape A4: 297mm wide)
    const cols = [
      { label: '#', x: 12, w: 8 },
      { label: 'Customer', x: 22, w: 40 },
      { label: 'Metal', x: 64, w: 18 },
      { label: 'Item Description', x: 84, w: 65 },
      { label: 'Pledge Date', x: 151, w: 28 },
      { label: 'Loan Amt (INR)', x: 181, w: 30 },
      { label: 'Balance Due', x: 213, w: 30 },
      { label: 'Status', x: 245, w: 22 },
    ];

    // Table header row
    doc.setFillColor(darkBg[0], darkBg[1], darkBg[2]);
    doc.rect(10, 43, pageW - 20, 8, 'F');
    doc.setTextColor(goldPrimary[0], goldPrimary[1], goldPrimary[2]);
    doc.setFont('Montserrat', 'bold');
    doc.setFontSize(8);
    cols.forEach(col => doc.text(col.label, col.x, 49));

    doc.setFont('Montserrat', 'normal');
    doc.setTextColor(darkBg[0], darkBg[1], darkBg[2]);
    let currentY = 57;
    let rowNum = 1;

    filteredReportData.forEach((row, idx) => {
      if (currentY > pageH - 18) {
        doc.addPage();
        doc.rect(4, 4, pageW - 8, pageH - 8);
        // Repeat header on new page
        doc.setFillColor(darkBg[0], darkBg[1], darkBg[2]);
        doc.rect(10, 8, pageW - 20, 8, 'F');
        doc.setTextColor(goldPrimary[0], goldPrimary[1], goldPrimary[2]);
        doc.setFont('Montserrat', 'bold');
        doc.setFontSize(8);
        cols.forEach(col => doc.text(col.label, col.x, 14));
        doc.setFont('Montserrat', 'normal');
        doc.setTextColor(darkBg[0], darkBg[1], darkBg[2]);
        currentY = 22;
      }

      // Zebra striping
      if (idx % 2 === 0) {
        doc.setFillColor(245, 246, 248);
        doc.rect(10, currentY - 5, pageW - 20, 7, 'F');
      }

      doc.setFontSize(8);
      doc.setTextColor(darkBg[0], darkBg[1], darkBg[2]);
      doc.text(String(rowNum), cols[0].x, currentY);
      // Customer name + phone (two lines)
      doc.setFont('Montserrat', 'bold');
      doc.text((row.customerName || 'Unknown').substring(0, 18), cols[1].x, currentY);
      if (row.customerPhone) {
        doc.setFont('Montserrat', 'normal');
        doc.setFontSize(6.5);
        doc.setTextColor(grayMuted[0], grayMuted[1], grayMuted[2]);
        doc.text(row.customerPhone.substring(0, 14), cols[1].x, currentY + 3.5);
        doc.setFontSize(8);
        doc.setTextColor(darkBg[0], darkBg[1], darkBg[2]);
      } else {
        doc.setFont('Montserrat', 'normal');
      }

      // Metal type colored label
      const isSilver = (row.metalType || 'gold') === 'silver';
      if (isSilver) {
        doc.setTextColor(silverColor[0], silverColor[1], silverColor[2]);
      } else {
        doc.setTextColor(goldColor[0], goldColor[1], goldColor[2]);
      }
      doc.setFont('Montserrat', 'bold');
      doc.text(isSilver ? 'SILVER' : 'GOLD', cols[2].x, currentY);
      doc.setFont('Montserrat', 'normal');
      doc.setTextColor(darkBg[0], darkBg[1], darkBg[2]);

      doc.text((row.description || '').substring(0, 32), cols[3].x, currentY);
      doc.text(new Date(row.date).toLocaleDateString(), cols[4].x, currentY);
      doc.text(`${row.amount.toLocaleString()}`, cols[5].x, currentY);
      doc.text(row.status === 'open' ? `${Math.round(row.balance).toLocaleString()}` : '-', cols[6].x, currentY);

      // Status colored
      if (row.status === 'open') doc.setTextColor(59, 130, 246);
      else if (row.status === 'closed') doc.setTextColor(16, 185, 129);
      else doc.setTextColor(239, 68, 68);
      doc.setFont('Montserrat', 'bold');
      doc.text(row.status.toUpperCase(), cols[7].x, currentY);
      doc.setFont('Montserrat', 'normal');
      doc.setTextColor(darkBg[0], darkBg[1], darkBg[2]);

      currentY += 8;
      rowNum++;
    });

    if (filteredReportData.length === 0) {
      doc.setTextColor(grayMuted[0], grayMuted[1], grayMuted[2]);
      doc.text('No ledger pledges created during this statement range.', 12, 60);
    }

    // Footer
    doc.setFontSize(7);
    doc.setFont('Montserrat', 'normal');
    doc.setTextColor(grayMuted[0], grayMuted[1], grayMuted[2]);
    doc.text(`Generated: ${new Date().toLocaleString()} | Total Records: ${filteredReportData.length}`, 12, pageH - 8);

    doc.save(`Ledger_Report_${startDate}_to_${endDate}.pdf`);
  };

  // Derived report mode + rows
  const reportMode = PAYMENT_REPORT_TYPES.includes(reportType)
    ? 'payments'
    : reportType === 'outstanding'
      ? 'outstanding'
      : reportType === 'recovery'
        ? 'recovery'
        : 'loans';

  const badgeClass = (status) => {
    if (status === 'open') return 'badge-open';
    if (status === 'partially_paid') return 'badge-partial';
    if (status === 'paid') return 'badge-paid';
    if (status === 'defaulted') return 'badge-defaulted';
    if (status === 'closed') return 'badge-closed';
    return 'badge-forfeited';
  };

  const tableRows = useMemo(() => {
    if (reportMode !== 'payments') return filteredReportData;
    const start = new Date(startDate); start.setHours(0, 0, 0, 0);
    const end = new Date(endDate); end.setHours(23, 59, 59, 999);
    return paymentRows
      .filter((p) => {
        const d = new Date(p.paymentDate);
        return d >= start && d <= end;
      })
      .sort((a, b) => new Date(b.paymentDate) - new Date(a.paymentDate));
  }, [reportMode, filteredReportData, paymentRows, startDate, endDate]);

  return (
    <div className="app-container">
      <main className="main-content">

        {/* Header */}
        <PageHeader
          eyebrow={greeting}
          title={t('reports.title')}
          subtitle={t('reports.subtitle')}
          actions={
            <div className="flex-gap" style={{ gap: 8, flexWrap: 'wrap', alignItems: 'center' }}>
              <span className={`live-badge ${marketStatus === 'offline' ? 'offline' : marketStatus === 'cached' ? 'cached' : ''}`}>
                <span className={`live-pulse-dot ${marketStatus === 'offline' ? 'offline' : marketStatus === 'cached' ? 'cached' : ''}`} />
                {marketStatus === 'offline'
                  ? (t('dashboard.marketOffline') || 'Offline')
                  : marketStatus === 'cached'
                    ? (t('dashboard.marketCached') || 'Cached')
                    : (t('dashboard.marketLive') || 'LIVE')}
              </span>
              <span className="live-updated-chip">
                <Gem size={12} style={{ color: 'var(--gold)' }} />
                {t('dashboard.retailGoldRate') || 'Retail'}: {liveRates ? `₹${liveRates.retailGold}/g` : '—'}
                <span style={{ opacity: 0.5 }}>·</span>
                <Sparkles size={12} style={{ color: '#94a3b8' }} />
                {liveRates ? `₹${liveRates.retailSilver}/g` : '—'}
              </span>
              {liveRates?.spotGold > 0 && (
                <span className="live-updated-chip">
                  {t('goldRate.spot') || 'Spot'} ₹{liveRates.spotGold}/g · {t('goldRate.difference') || 'Diff'} +₹{liveRates.retailGold - liveRates.spotGold}/g
                </span>
              )}
              <GoldButton onClick={generateReportPdf}>
                <Download size={18} />
                <span>{t('reports.downloadPdf')}</span>
              </GoldButton>
            </div>
          }
        />

        {/* Filters Panel */}
        <motion.div
          className="glass-panel"
          style={{ padding: '24px', marginBottom: '24px' }}
          initial={{ opacity: 0, y: 16 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.5, ease: [0.22, 1, 0.36, 1] }}
        >
          <div className="reports-filter-bar" style={{ display: 'flex', gap: '16px', alignItems: 'center', flexWrap: 'wrap' }}>

            {/* Quick buttons */}
            <div className="tab-pills">
              <button
                onClick={() => setReportType('daily')}
                className={`pill ${reportType === 'daily' ? 'active' : ''}`}
              >
                {t('reports.daily')}
              </button>
              <button
                onClick={() => setReportType('monthly')}
                className={`pill ${reportType === 'monthly' ? 'active' : ''}`}
              >
                {t('reports.monthly')}
              </button>
              <button
                onClick={() => setReportType('yearly')}
                className={`pill ${reportType === 'yearly' ? 'active' : ''}`}
              >
                {t('reports.yearly')}
              </button>
              <button
                onClick={() => setReportType('custom')}
                className={`pill ${reportType === 'custom' ? 'active' : ''}`}
              >
                <CalendarRange size={13} />
                {t('reports.customRange')}
              </button>

              <span style={{ width: 1, height: 22, background: 'var(--border-soft)', display: 'inline-block' }} />

              <button
                onClick={() => setReportType('daily_collection')}
                className={`pill ${reportType === 'daily_collection' ? 'active' : ''}`}
              >
                <Banknote size={13} />
                {t('reports.dailyCollection') || 'Daily Collection'}
              </button>
              <button
                onClick={() => setReportType('monthly_collection')}
                className={`pill ${reportType === 'monthly_collection' ? 'active' : ''}`}
              >
                <History size={13} />
                {t('reports.monthlyCollection') || 'Monthly Collection'}
              </button>
              <button
                onClick={() => setReportType('payment_ledger')}
                className={`pill ${reportType === 'payment_ledger' ? 'active' : ''}`}
              >
                <FileSpreadsheet size={13} />
                {t('reports.paymentLedger') || 'Payment Ledger'}
              </button>
              <button
                onClick={() => setReportType('outstanding')}
                className={`pill ${reportType === 'outstanding' ? 'active' : ''}`}
              >
                <TrendingUp size={13} />
                {t('reports.outstandingReport') || 'Outstanding'}
              </button>
              <button
                onClick={() => setReportType('recovery')}
                className={`pill ${reportType === 'recovery' ? 'active' : ''}`}
              >
                <Percent size={13} />
                {t('reports.recoveryReport') || 'Recovery'}
              </button>
            </div>

            {/* Custom inputs */}
            {['custom', 'daily_collection', 'monthly_collection', 'payment_ledger'].includes(reportType) && (
              <div className="flex-gap" style={{ flexWrap: 'wrap', alignItems: 'center' }}>
                <div className="flex-gap" style={{ alignItems: 'center' }}>
                  <label style={{ fontSize: '0.75rem' }}>{t('reports.from')}</label>
                  <input
                    type="date"
                    value={startDate}
                    onChange={(e) => setStartDate(e.target.value)}
                    style={{ padding: '8px 12px', fontSize: '0.875rem', width: 'auto' }}
                  />
                </div>
                <div className="flex-gap" style={{ alignItems: 'center' }}>
                  <label style={{ fontSize: '0.75rem' }}>{t('reports.to')}</label>
                  <input
                    type="date"
                    value={endDate}
                    onChange={(e) => setEndDate(e.target.value)}
                    style={{ padding: '8px 12px', fontSize: '0.875rem', width: 'auto' }}
                  />
                </div>
              </div>
            )}

            <button onClick={runReportQuery} className="btn btn-secondary" style={{ padding: '8px 16px', fontSize: '0.875rem', marginLeft: 'auto' }}>
              <RefreshCw size={14} /> {t('reports.refresh')}
            </button>
          </div>
        </motion.div>

        {/* Aggregated KPI Metrics Grid */}
        <div className="kpi-container" style={{ marginBottom: '24px' }}>
          {loading ? (
            <>
              <SkeletonCard />
              <SkeletonCard />
              <SkeletonCard />
              <SkeletonCard />
            </>
          ) : PAYMENT_REPORT_TYPES.includes(reportType) ? (
            <>
              <StatCard
                icon={<Banknote size={22} />}
                iconClass="green"
                label={t('reports.paymentsCount') || 'Payments Collected'}
                value={metrics.paymentsCount}
                sub={reportType === 'daily_collection'
                  ? (t('reports.today') || 'Today')
                  : reportType === 'monthly_collection'
                    ? (t('reports.thisMonth') || 'This month')
                    : (t('reports.paymentLedger') || 'In range')}
                delay={0}
              />
              <StatCard
                icon={<Wallet size={22} />}
                iconClass="gold"
                label={t('reports.totalCollected') || 'Total Collected'}
                value={metrics.totalDuesRecovered}
                prefix="₹"
                sub={t('reports.repaymentsCollected')}
                delay={0.08}
              />
              <StatCard
                icon={<Coins size={22} />}
                iconClass="blue"
                label={t('reports.interestCollected') || 'Interest Collected'}
                value={metrics.interestEarned}
                prefix="₹"
                sub={t('reports.interestEarned')}
                delay={0.16}
              />
              <StatCard
                icon={<TrendingUp size={22} />}
                iconClass="green"
                label={t('reports.principalCollected') || 'Principal Collected'}
                value={metrics.principalCollected}
                prefix="₹"
                sub={t('reports.principalCollectedSub') || 'Principal portion repaid'}
                delay={0.24}
              />
            </>
          ) : reportType === 'outstanding' ? (
            <>
              <StatCard
                icon={<Coins size={22} />}
                iconClass="blue"
                label={t('reports.activeLoansCount') || 'Active Loans'}
                value={metrics.activeLoansCount}
                sub={t('reports.activePrincipalText')}
                delay={0}
              />
              <StatCard
                icon={<Wallet size={22} />}
                iconClass="gold"
                label={t('reports.outstandingValue')}
                value={metrics.outstandingPrincipal}
                prefix="₹"
                sub={t('reports.outstandingPrincipalSub') || 'Principal outstanding today'}
                delay={0.08}
              />
              <StatCard
                icon={<AlertTriangle size={22} />}
                iconClass="red"
                label={t('reports.atRiskLoans') || 'At-Risk Loans (≥75% LTV)'}
                value={metrics.atRiskLoans}
                sub={t('reports.ltvRiskText')}
                delay={0.16}
              />
              <StatCard
                icon={<GaugeIcon size={22} />}
                iconClass="red"
                label={t('reports.maxLtv') || 'Highest LTV'}
                value={metrics.maxLtv}
                suffix="%"
                sub={t('reports.maxLtvSub') || 'Maximum exposure level'}
                delay={0.24}
              />
            </>
          ) : reportType === 'recovery' ? (
            <>
              <StatCard
                icon={<History size={22} />}
                iconClass="green"
                label={t('reports.recoveredLoans') || 'Loans with Repayments'}
                value={metrics.recoveredLoans}
                sub={t('reports.recoveredLoansSub') || 'Any payment received'}
                delay={0}
              />
              <StatCard
                icon={<Banknote size={22} />}
                iconClass="gold"
                label={t('reports.totalRecoveries') || 'Total Recovered'}
                value={metrics.totalDuesRecovered}
                prefix="₹"
                sub={t('reports.duesRecoveredText')}
                delay={0.08}
              />
              <StatCard
                icon={<Wallet size={22} />}
                iconClass="blue"
                label={t('reports.outstandingValue')}
                value={metrics.outstandingPrincipal}
                prefix="₹"
                sub={t('reports.outstandingPrincipalSub') || 'Principal still outstanding'}
                delay={0.16}
              />
              <StatCard
                icon={<TrendingUp size={22} />}
                iconClass="green"
                label={t('reports.closedCount') || 'Loans Closed'}
                value={metrics.loansClosedCount}
                sub={t('reports.issuedCountText', { count: metrics.loansIssuedCount })}
                delay={0.24}
              />
            </>
          ) : (
            <>
              <StatCard
                icon={<Wallet size={22} />}
                iconClass="gold"
                label={t('reports.loansDisbursed')}
                value={metrics.totalDisbursed}
                prefix="₹"
                sub={t('reports.issuedCountText', { count: metrics.loansIssuedCount })}
                delay={0}
              />
              <StatCard
                icon={<Banknote size={22} />}
                iconClass="green"
                label={t('reports.repaymentsCollected')}
                value={metrics.totalDuesRecovered}
                prefix="₹"
                sub={t('reports.duesRecoveredText')}
                delay={0.08}
              />
              <StatCard
                icon={<Coins size={22} />}
                iconClass="blue"
                label={t('reports.outstandingValue')}
                value={metrics.outstandingPrincipal}
                prefix="₹"
                sub={t('reports.activePrincipalText')}
                delay={0.16}
              />
              <StatCard
                icon={<AlertTriangle size={22} />}
                iconClass="red"
                label={t('reports.criticalLtvAlerts')}
                value={metrics.activeLtvAlerts}
                sub={t('reports.ltvRiskText')}
                delay={0.24}
              />
            </>
          )}
        </div>

        {/* Filtered Ledger Records */}
        <motion.div
          className="glass-panel"
          style={{ padding: '24px' }}
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.55, delay: 0.1, ease: [0.22, 1, 0.36, 1] }}
        >
          <div className="flex-between" style={{ marginBottom: '16px' }}>
            <h3 className="serif-title" style={{ margin: 0, fontSize: '1.25rem', display: 'flex', alignItems: 'center', gap: 10 }}>
              <span className="metal-coin" style={{ width: 34, height: 34 }}>
                {reportMode === 'payments' ? <Banknote size={16} /> : reportMode === 'outstanding' ? <TrendingUp size={16} /> : reportMode === 'recovery' ? <History size={16} /> : <Gem size={16} />}
              </span>
              {reportMode === 'payments'
                ? (t('reports.paymentLedgerTitle') || 'Payment Ledger')
                : reportMode === 'outstanding'
                  ? (t('reports.outstandingTitle') || 'Outstanding Loan Book')
                  : reportMode === 'recovery'
                    ? (t('reports.recoveryTitle') || 'Recovery Register')
                    : t('reports.ledgerTitle')}
            </h3>
            <span className="customer-count-chip">
              {tableRows.length} {t('loans.payments') || 'RECORDS'}
            </span>
          </div>

          <div className="table-container responsive-table-card">
            <table>
              <thead>
                <tr>
                  <th>#</th>
                  {reportMode === 'payments' ? (
                    <>
                      <th>{t('payments.paymentDate') || 'Date'}</th>
                      <th>{t('customers.fullName')}</th>
                      <th>{t('payments.loanId') || 'Loan Ref'}</th>
                      <th>{t('loans.itemDesc')}</th>
                      <th>{t('payments.paymentMethod') || 'Method'}</th>
                      <th>{t('payments.amountPaid') || 'Amount'}</th>
                      <th>{t('payments.interestPaid') || 'Interest'}</th>
                      <th>{t('payments.principalPaid') || 'Principal'}</th>
                      <th>{t('payments.newOutstanding') || 'Outstanding'}</th>
                      <th>{t('payments.collectedBy') || 'Collected By'}</th>
                    </>
                  ) : reportMode === 'outstanding' ? (
                    <>
                      <th>{t('customers.fullName')}</th>
                      <th>{t('payments.loanId') || 'Loan Ref'}</th>
                      <th>{t('loans.itemDesc')}</th>
                      <th>{t('loans.loanAmount') || 'Disbursed'}</th>
                      <th>{t('dashboard.outstandingPrincipal') || 'Principal Outstanding'}</th>
                      <th>{t('loans.outstanding') || 'Balance Due'}</th>
                      <th>{t('loans.currentLtv') || 'LTV'}</th>
                      <th>{t('common.status')}</th>
                    </>
                  ) : reportMode === 'recovery' ? (
                    <>
                      <th>{t('customers.fullName')}</th>
                      <th>{t('payments.loanId') || 'Loan Ref'}</th>
                      <th>{t('loans.itemDesc')}</th>
                      <th>{t('loans.loanAmount') || 'Disbursed'}</th>
                      <th>{t('reports.totalPaid') || 'Total Paid'}</th>
                      <th>{t('loans.outstanding') || 'Balance Due'}</th>
                      <th>{t('common.status')}</th>
                    </>
                  ) : (
                    <>
                      <th>{t('customers.fullName')}</th>
                      <th>{t('loans.metalType')}</th>
                      <th>{t('loans.itemDesc')}</th>
                      <th>{t('loans.pledgeDate')}</th>
                      <th>{t('reports.disbursedValue')}</th>
                      <th>{t('common.status')}</th>
                      <th>{t('loans.outstanding')}</th>
                    </>
                  )}
                </tr>
              </thead>
              <tbody>
                {loading ? (
                  <tr>
                    <td colSpan="11" style={{ textAlign: 'center', color: 'var(--text-2)', padding: '32px' }}>
                      <span style={{ display: 'inline-block', width: 22, height: 22, border: '2px solid var(--border-soft)', borderTopColor: 'var(--gold)', borderRadius: '50%', animation: 'spin 0.8s linear infinite', verticalAlign: '-4px', marginRight: 10 }} />
                      {t('common.loading')}
                    </td>
                  </tr>
                ) : tableRows.length === 0 ? (
                  <tr>
                    <td colSpan="11" style={{ textAlign: 'center', color: 'var(--text-2)', padding: '32px' }}>
                      {t('common.noRecords')}
                    </td>
                  </tr>
                ) : reportMode === 'payments' ? (
                  tableRows.map((row, idx) => (
                    <tr key={row.id}>
                      <td data-label="#" style={{ color: 'var(--text-3)', fontSize: '0.875rem' }}>{idx + 1}</td>
                      <td data-label={t('payments.paymentDate') || 'Date'}>{new Date(row.paymentDate).toLocaleDateString()}</td>
                      <td data-label={t('customers.fullName')}>
                        <div style={{ fontWeight: 600 }}>{row.customerName || '—'}</div>
                        {row.customerPhone && (
                          <div style={{ fontSize: '0.75rem', color: 'var(--text-3)', marginTop: '2px', fontWeight: 400 }}>{row.customerPhone}</div>
                        )}
                      </td>
                      <td data-label={t('payments.loanId') || 'Loan Ref'} style={{ fontFamily: 'monospace', fontSize: '0.75rem' }}>{row.loanId}</td>
                      <td data-label={t('loans.itemDesc')} style={{ fontWeight: 500 }}>{row.description}</td>
                      <td data-label={t('payments.paymentMethod') || 'Method'}>
                        <span className="method-chip">{String(row.paymentMethod || 'cash').toUpperCase()}</span>
                      </td>
                      <td data-label={t('payments.amountPaid') || 'Amount'} style={{ fontWeight: 700, color: 'var(--success)' }}>₹{row.amount.toLocaleString('en-IN')}</td>
                      <td data-label={t('payments.interestPaid') || 'Interest'}>₹{Math.round(row.interestPaid).toLocaleString('en-IN')}</td>
                      <td data-label={t('payments.principalPaid') || 'Principal'}>₹{Math.round(row.principalPaid).toLocaleString('en-IN')}</td>
                      <td data-label={t('payments.newOutstanding') || 'Outstanding'} style={{ fontWeight: 600 }}>₹{Math.round(row.newOutstanding).toLocaleString('en-IN')}</td>
                      <td data-label={t('payments.collectedBy') || 'Collected By'}>{row.collectedBy || '—'}</td>
                    </tr>
                  ))
                ) : reportMode === 'outstanding' ? (
                  tableRows.map((row, idx) => (
                    <tr key={row.id}>
                      <td data-label="#" style={{ color: 'var(--text-3)', fontSize: '0.875rem' }}>{idx + 1}</td>
                      <td data-label={t('customers.fullName')}>
                        <div style={{ fontWeight: 600 }}>{row.customerName || '—'}</div>
                        {row.customerPhone && (
                          <div style={{ fontSize: '0.75rem', color: 'var(--text-3)', marginTop: '2px', fontWeight: 400 }}>{row.customerPhone}</div>
                        )}
                      </td>
                      <td data-label={t('payments.loanId') || 'Loan Ref'} style={{ fontFamily: 'monospace', fontSize: '0.75rem' }}>{row.id}</td>
                      <td data-label={t('loans.itemDesc')} style={{ fontWeight: 500 }}>{row.description}</td>
                      <td data-label={t('loans.loanAmount') || 'Disbursed'} style={{ fontWeight: 600 }}>₹{row.amount.toLocaleString('en-IN')}</td>
                      <td data-label={t('dashboard.outstandingPrincipal') || 'Principal Outstanding'} style={{ fontWeight: 700 }}>₹{Math.round(row.balance).toLocaleString('en-IN')}</td>
                      <td data-label={t('loans.outstanding') || 'Balance Due'}>₹{Math.round(row.balance).toLocaleString('en-IN')}</td>
                      <td data-label={t('loans.currentLtv') || 'LTV'} style={{ fontWeight: 600 }}>
                        <span className={`chip ${row.ltv >= 90 ? 'chip-red' : row.ltv >= 75 ? 'chip-amber' : 'chip-green'}`}>{row.ltv}%</span>
                      </td>
                      <td data-label={t('common.status')}>
                        <span className={`badge ${badgeClass(row.status)}`}>{REPORT_STATUS_LABEL(row.status)}</span>
                      </td>
                    </tr>
                  ))
                ) : reportMode === 'recovery' ? (
                  tableRows.map((row, idx) => (
                    <tr key={row.id}>
                      <td data-label="#" style={{ color: 'var(--text-3)', fontSize: '0.875rem' }}>{idx + 1}</td>
                      <td data-label={t('customers.fullName')}>
                        <div style={{ fontWeight: 600 }}>{row.customerName || '—'}</div>
                        {row.customerPhone && (
                          <div style={{ fontSize: '0.75rem', color: 'var(--text-3)', marginTop: '2px', fontWeight: 400 }}>{row.customerPhone}</div>
                        )}
                      </td>
                      <td data-label={t('payments.loanId') || 'Loan Ref'} style={{ fontFamily: 'monospace', fontSize: '0.75rem' }}>{row.id}</td>
                      <td data-label={t('loans.itemDesc')} style={{ fontWeight: 500 }}>{row.description}</td>
                      <td data-label={t('loans.loanAmount') || 'Disbursed'} style={{ fontWeight: 600 }}>₹{row.amount.toLocaleString('en-IN')}</td>
                      <td data-label={t('reports.totalPaid') || 'Total Paid'} style={{ fontWeight: 700, color: 'var(--success)' }}>₹{Math.round(row.totalPaid).toLocaleString('en-IN')}</td>
                      <td data-label={t('loans.outstanding') || 'Balance Due'} style={{ fontWeight: 600 }}>₹{Math.round(row.balance).toLocaleString('en-IN')}</td>
                      <td data-label={t('common.status')}>
                        <span className={`badge ${badgeClass(row.status)}`}>{REPORT_STATUS_LABEL(row.status)}</span>
                      </td>
                    </tr>
                  ))
                ) : (
                  tableRows.map((row, idx) => (
                    <tr key={row.id}>
                      <td data-label="#" style={{ color: 'var(--text-3)', fontSize: '0.875rem' }}>{idx + 1}</td>
                      <td data-label={t('customers.fullName')}>
                        <div style={{ fontWeight: 600 }}>{row.customerName || '—'}</div>
                        {row.customerPhone && (
                          <div style={{ fontSize: '0.75rem', color: 'var(--text-3)', marginTop: '2px', fontWeight: 400 }}>
                            {row.customerPhone}
                          </div>
                        )}
                      </td>
                      <td data-label={t('loans.metalType')}>
                        <span className={`metal-chip ${row.metalType === 'silver' ? 'silver' : ''}`}>
                          {row.metalType === 'silver' ? 'Silver' : 'Gold'}
                        </span>
                      </td>
                      <td data-label={t('loans.itemDesc')} style={{ fontWeight: 500 }}>{row.description}</td>
                      <td data-label={t('loans.pledgeDate')}>{new Date(row.date).toLocaleDateString()}</td>
                      <td data-label={t('reports.disbursedValue')} style={{ fontWeight: 600 }}>₹{row.amount.toLocaleString()}</td>
                      <td data-label={t('common.status')}>
                        <span className={`badge ${badgeClass(row.status)}`}>{REPORT_STATUS_LABEL(row.status)}</span>
                      </td>
                      <td data-label={t('loans.outstanding')} style={{ fontWeight: 600 }}>
                        {isActiveLoan(row.status) ? `₹${Math.round(row.balance).toLocaleString()}` : '-'}
                      </td>
                    </tr>
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
