import { jsPDF } from 'jspdf';

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

// Convert any legacy signature image to blue ink on white background dynamically
async function ensureBlueSignatureOnWhite(base64Str) {
  if (!base64Str) return '';
  return new Promise((resolve) => {
    const img = new Image();
    img.crossOrigin = 'anonymous';
    img.onload = () => {
      const canvas = document.createElement('canvas');
      canvas.width = img.width;
      canvas.height = img.height;
      const ctx = canvas.getContext('2d');
      ctx.drawImage(img, 0, 0);

      try {
        const imgData = ctx.getImageData(0, 0, canvas.width, canvas.height);
        const data = imgData.data;

        // Detect background luminance (using top-left corner pixel)
        const bgR = data[0];
        const bgG = data[1];
        const bgB = data[2];
        const bgLuminance = 0.299 * bgR + 0.587 * bgG + 0.114 * bgB;
        const isDarkBg = bgLuminance < 120;

        for (let i = 0; i < data.length; i += 4) {
          const r = data[i];
          const g = data[i + 1];
          const b = data[i + 2];
          const luminance = 0.299 * r + 0.587 * g + 0.114 * b;

          if (isDarkBg) {
            // Dark background signature (white strokes on black)
            if (luminance < 110) {
              // Background: change to solid white
              data[i] = 255;
              data[i + 1] = 255;
              data[i + 2] = 255;
            } else {
              // Stroke: change to Navy Blue (#0033cc)
              data[i] = 0;
              data[i + 1] = 51;
              data[i + 2] = 204;
            }
          } else {
            // Light background signature (black or dark strokes on white)
            // If the pixel is dark (the stroke), change it to Navy Blue
            if (luminance < 150) {
              data[i] = 0;
              data[i + 1] = 51;
              data[i + 2] = 204;
            } else {
              // Keep background white
              data[i] = 255;
              data[i + 1] = 255;
              data[i + 2] = 255;
            }
          }
        }

        ctx.putImageData(imgData, 0, 0);
        resolve(canvas.toDataURL('image/jpeg', 0.95));
      } catch (err) {
        console.warn('Canvas pixel processing blocked by CORS or error, using original signature:', err);
        resolve(base64Str);
      }
    };
    img.onerror = () => {
      resolve(base64Str);
    };
    img.src = base64Str;
  });
}

/**
 * Generates a Pledge Receipt PDF client-side using jsPDF.
 * Enforces multi-language labels passed from active translation parameters.
 */
export async function generatePledgeReceipt(loan, customer, itemImageBase64, t) {
  const doc = new jsPDF({
    orientation: 'portrait',
    unit: 'mm',
    format: 'a4'
  });

  // Load Montserrat font dynamically
  await loadMontserrat(doc);

  // Set colors
  const goldPrimary = [186, 140, 20]; // Sleek dark gold
  const textDark = [30, 41, 59]; // slate-800
  const textMuted = [100, 116, 139]; // slate-500
  const lightBg = [248, 250, 252]; // slate-50

  // Draw clean outer frame
  doc.setDrawColor(226, 232, 240); // slate-200
  doc.setLineWidth(0.3);
  doc.rect(8, 8, 194, 281);

  // Header Title Area
  doc.setTextColor(goldPrimary[0], goldPrimary[1], goldPrimary[2]);
  doc.setFont('Montserrat', 'bold');
  doc.setFontSize(16);
  doc.text('EASY GOLD LEDGER', 15, 20);

  doc.setTextColor(textMuted[0], textMuted[1], textMuted[2]);
  doc.setFont('Montserrat', 'normal');
  doc.setFontSize(8);
  doc.text('Premium Gold Valuation & Credit Ledger', 15, 24);

  doc.setTextColor(textDark[0], textDark[1], textDark[2]);
  doc.setFont('Montserrat', 'bold');
  doc.setFontSize(11);
  doc.text(t('loans.pledgeReceipt').toUpperCase(), 195, 20, { align: 'right' });

  doc.setTextColor(textMuted[0], textMuted[1], textMuted[2]);
  doc.setFont('Montserrat', 'normal');
  doc.setFontSize(8.5);
  doc.text(`Ref: ${loan.id || 'Draft'}`, 195, 24, { align: 'right' });

  // Thin gold line
  doc.setDrawColor(212, 175, 55);
  doc.setLineWidth(0.8);
  doc.line(15, 28, 195, 28);

  // 1. Customer Section (Y = 34 to 68)
  doc.setTextColor(textDark[0], textDark[1], textDark[2]);
  doc.setFont('Montserrat', 'bold');
  doc.setFontSize(9.5);
  doc.text(t('customers.title').toUpperCase(), 15, 36);

  doc.setDrawColor(226, 232, 240);
  doc.setLineWidth(0.4);
  doc.line(15, 38, 195, 38);

  doc.setFontSize(8.5);
  doc.setFont('Montserrat', 'bold');
  doc.text(`${t('customers.fullName')}:`, 15, 45);
  doc.setFont('Montserrat', 'normal');
  doc.setTextColor(textDark[0], textDark[1], textDark[2]);
  doc.text(customer.name || 'N/A', 48, 45);

  doc.setTextColor(textMuted[0], textMuted[1], textMuted[2]);
  doc.setFont('Montserrat', 'bold');
  doc.text(`${t('customers.phone')}:`, 15, 51);
  doc.setFont('Montserrat', 'normal');
  doc.setTextColor(textDark[0], textDark[1], textDark[2]);
  doc.text(customer.phone || 'N/A', 48, 51);

  doc.setTextColor(textMuted[0], textMuted[1], textMuted[2]);
  doc.setFont('Montserrat', 'bold');
  doc.text(`${t('customers.address')}:`, 15, 57);
  doc.setFont('Montserrat', 'normal');
  doc.setTextColor(textDark[0], textDark[1], textDark[2]);
  const addr = customer.address || 'N/A';
  const addressLines = doc.splitTextToSize(addr, 90);
  doc.text(addressLines, 48, 57);

  // Embed Customer Profile Photo on the right
  if (customer.photoBase64) {
    try {
      doc.addImage(customer.photoBase64, 'JPEG', 158, 42, 26, 26);
      doc.setDrawColor(226, 232, 240);
      doc.setLineWidth(0.3);
      doc.rect(158, 42, 26, 26);
      doc.setFontSize(7);
      doc.setTextColor(textMuted[0], textMuted[1], textMuted[2]);
      doc.text('CUSTOMER PHOTO', 158, 71);
    } catch (e) {
      console.warn('Could not add photo to PDF:', e);
    }
  }

  // 2. Pledge Section (Y = 76 to 120)
  doc.setFontSize(9.5);
  doc.setFont('Montserrat', 'bold');
  doc.setTextColor(textDark[0], textDark[1], textDark[2]);
  doc.text(t('loans.title').toUpperCase(), 15, 78);

  doc.setDrawColor(226, 232, 240);
  doc.line(15, 80, 195, 80);

  const isSilver = loan.metalType === 'silver';
  const loanGrid = [
    { label: t('loans.itemDesc'), value: loan.itemDescription },
    { label: t('loans.metalType'), value: isSilver ? t('loans.metalSilver') : t('loans.metalGold') },
    { label: t('loans.weight'), value: `${loan.weightGrams} g` },
    { label: t('loans.purity'), value: isSilver ? `${loan.purityKarat} Fineness` : `${loan.purityKarat} Karat` },
    { label: t('loans.rateAtPledge'), value: `INR ${loan.marketRateAtPledge} / g` },
    { label: t('loans.estimatedValue'), value: `INR ${loan.estimatedValue}` }
  ];

  let currentY = 87;
  loanGrid.forEach((row) => {
    doc.setFontSize(8.5);
    doc.setFont('Montserrat', 'bold');
    doc.setTextColor(textMuted[0], textMuted[1], textMuted[2]);
    doc.text(`${row.label}:`, 15, currentY);
    doc.setFont('Montserrat', 'normal');
    doc.setTextColor(textDark[0], textDark[1], textDark[2]);
    doc.text(row.value || 'N/A', 55, currentY);
    currentY += 6.5;
  });

  // Embed Pledged Gold Item Image on the right of Details
  if (itemImageBase64) {
    try {
      doc.addImage(itemImageBase64, 'JPEG', 148, 85, 36, 27);
      doc.setDrawColor(226, 232, 240);
      doc.setLineWidth(0.3);
      doc.rect(148, 85, 36, 27);
      doc.setFontSize(7);
      doc.setTextColor(textMuted[0], textMuted[1], textMuted[2]);
      doc.text('PLEDGED ITEM PHOTO', 148, 115);
    } catch (e) {
      console.warn('Could not add item image to PDF:', e);
    }
  }

  // 3. Financial Summary Box (Y = 132 to 158)
  doc.setFontSize(9.5);
  doc.setFont('Montserrat', 'bold');
  doc.setTextColor(textDark[0], textDark[1], textDark[2]);
  doc.text('FINANCIAL SUMMARY', 15, 133);
  doc.line(15, 135, 195, 135);

  // Background box for financials
  doc.setFillColor(lightBg[0], lightBg[1], lightBg[2]);
  doc.rect(15, 139, 180, 22, 'F');
  doc.setDrawColor(226, 232, 240);
  doc.rect(15, 139, 180, 22);

  // Inside box values
  doc.setFontSize(9);
  doc.setFont('Montserrat', 'bold');
  doc.setTextColor(textMuted[0], textMuted[1], textMuted[2]);
  doc.text('LOAN AMOUNT DISBURSED', 20, 147);
  doc.setFontSize(11);
  doc.setTextColor(186, 12, 12); // Red highlighted bold amount
  doc.text(`INR ${loan.loanAmount.toLocaleString()}`, 20, 155);

  doc.setFontSize(8.5);
  doc.setFont('Montserrat', 'bold');
  doc.setTextColor(textMuted[0], textMuted[1], textMuted[2]);
  doc.text('INTEREST RATE', 95, 147);
  doc.setFont('Montserrat', 'normal');
  doc.setTextColor(textDark[0], textDark[1], textDark[2]);
  doc.text(`${loan.interestRate}% / month`, 95, 155);

  doc.setFont('Montserrat', 'bold');
  doc.setTextColor(textMuted[0], textMuted[1], textMuted[2]);
  doc.text('PLEDGE DATE', 145, 147);
  doc.setFont('Montserrat', 'normal');
  doc.setTextColor(textDark[0], textDark[1], textDark[2]);
  doc.text(new Date(loan.pledgeDate).toLocaleDateString(), 145, 155);

  // 4. Terms and Declaration (Y = 173 to 205)
  doc.setFontSize(9.5);
  doc.setFont('Montserrat', 'bold');
  doc.setTextColor(textDark[0], textDark[1], textDark[2]);
  doc.text('DECLARATION & TERMS', 15, 174);
  doc.line(15, 176, 195, 176);

  doc.setFontSize(7.5);
  doc.setFont('Montserrat', 'normal');
  doc.setTextColor(textMuted[0], textMuted[1], textMuted[2]);
  const termsText = 
    "1. The borrower pledges the gold/silver items mentioned above in good faith as pure and owned legally. \n" +
    "2. Interest is charged simple at the agreed rate. Accrued interest is computed daily from date of pledge. \n" +
    "3. Rollovers are allowed by paying outstanding interest, resetting pledge dates. \n" +
    "4. Defaulting on interest payments exceeding critical LTV margins may trigger auction forfeiture.";
  doc.text(termsText, 15, 183);

  // 5. Signatures (Y = 220 to 260)
  // Embed signature if exists
  if (customer.signatureBase64) {
    try {
      const processedSig = await ensureBlueSignatureOnWhite(customer.signatureBase64);
      doc.addImage(processedSig, 'JPEG', 15, 218, 35, 15);
    } catch (e) {
      console.warn('Could not add signature to PDF:', e);
    }
  }
  doc.setDrawColor(200, 200, 200);
  doc.line(15, 235, 65, 235);
  doc.setFontSize(8);
  doc.setFont('Montserrat', 'bold');
  doc.setTextColor(textDark[0], textDark[1], textDark[2]);
  doc.text(t('customers.signature').toUpperCase(), 15, 240);

  // Shop stamp/signature
  doc.line(145, 235, 195, 235);
  doc.text('JEWELER SIGNATURE / STAMP', 145, 240);

  // Footer metadata (Y = 278)
  doc.setFontSize(7);
  doc.setFont('Montserrat', 'normal');
  doc.setTextColor(textMuted[0], textMuted[1], textMuted[2]);
  doc.text(`Generated on ${new Date().toLocaleString()} | Loan ID: ${loan.id || 'NEW'}`, 15, 274);

  doc.save(`Pledge_Receipt_${loan.id || 'Draft'}.pdf`);
}

/**
 * Generates a Closure Invoice PDF client-side.
 */
export async function generateClosureInvoice(loan, customer, state, payments, t) {
  const doc = new jsPDF({
    orientation: 'portrait',
    unit: 'mm',
    format: 'a4'
  });

  // Load Montserrat font dynamically
  await loadMontserrat(doc);

  const goldPrimary = [186, 140, 20];
  const textDark = [30, 41, 59];
  const textMuted = [100, 116, 139];
  const lightBg = [248, 250, 252];

  // Draw clean outer frame
  doc.setDrawColor(226, 232, 240);
  doc.setLineWidth(0.3);
  doc.rect(8, 8, 194, 281);

  // Header Title
  doc.setTextColor(goldPrimary[0], goldPrimary[1], goldPrimary[2]);
  doc.setFont('Montserrat', 'bold');
  doc.setFontSize(16);
  doc.text('EASY GOLD LEDGER', 15, 20);

  doc.setTextColor(textMuted[0], textMuted[1], textMuted[2]);
  doc.setFont('Montserrat', 'normal');
  doc.setFontSize(8);
  doc.text('Premium Gold Valuation & Credit Ledger', 15, 24);

  doc.setTextColor(textDark[0], textDark[1], textDark[2]);
  doc.setFont('Montserrat', 'bold');
  doc.setFontSize(11);
  doc.text(t('loans.closureInvoice').toUpperCase(), 195, 20, { align: 'right' });

  doc.setTextColor(textMuted[0], textMuted[1], textMuted[2]);
  doc.setFont('Montserrat', 'normal');
  doc.setFontSize(8.5);
  doc.text(`Loan Ref: ${loan.id}`, 195, 24, { align: 'right' });

  // Thin gold line
  doc.setDrawColor(212, 175, 55);
  doc.setLineWidth(0.8);
  doc.line(15, 28, 195, 28);

  // Customer Summary
  doc.setTextColor(textDark[0], textDark[1], textDark[2]);
  doc.setFontSize(9.5);
  doc.setFont('Montserrat', 'bold');
  doc.text(t('customers.title').toUpperCase(), 15, 36);

  doc.setDrawColor(226, 232, 240);
  doc.line(15, 38, 195, 38);

  doc.setFontSize(8.5);
  doc.setFont('Montserrat', 'bold');
  doc.text(`${t('customers.fullName')}:`, 15, 45);
  doc.setFont('Montserrat', 'normal');
  doc.text(customer.name || 'N/A', 48, 45);

  doc.setFont('Montserrat', 'bold');
  doc.text(`${t('customers.phone')}:`, 15, 51);
  doc.setFont('Montserrat', 'normal');
  doc.text(customer.phone || 'N/A', 48, 51);

  // Loan Closure Financial Breakdown
  doc.setTextColor(textDark[0], textDark[1], textDark[2]);
  doc.setFontSize(9.5);
  doc.setFont('Montserrat', 'bold');
  doc.text('FINAL SETTLEMENT BREAKDOWN', 15, 65);
  doc.line(15, 67, 195, 67);

  const statsGrid = [
    { label: t('loans.itemDesc'), val: loan.itemDescription },
    { label: `${t('loans.loanAmount')} (${t('loans.currentPrincipal')})`, val: `INR ${loan.loanAmount.toLocaleString()}` },
    { label: t('loans.accruedInterest'), val: `INR ${state.accruedInterest.toLocaleString()}` },
    { label: t('loans.daysElapsed'), val: `${state.daysElapsed} days` }
  ];

  let currentY = 74;
  statsGrid.forEach((row) => {
    doc.setFontSize(8.5);
    doc.setFont('Montserrat', 'bold');
    doc.setTextColor(textMuted[0], textMuted[1], textMuted[2]);
    doc.text(`${row.label}:`, 15, currentY);
    doc.setFont('Montserrat', 'normal');
    doc.setTextColor(textDark[0], textDark[1], textDark[2]);
    doc.text(row.val || 'N/A', 85, currentY);
    currentY += 6.5;
  });

  // Background Box for Total Outstanding Due
  doc.setFillColor(lightBg[0], lightBg[1], lightBg[2]);
  doc.rect(15, 102, 180, 14, 'F');
  doc.setDrawColor(226, 232, 240);
  doc.rect(15, 102, 180, 14);

  doc.setFontSize(9);
  doc.setFont('Montserrat', 'bold');
  doc.setTextColor(textMuted[0], textMuted[1], textMuted[2]);
  doc.text('TOTAL OUTSTANDING BALANCE PAID', 20, 111);

  doc.setFontSize(10.5);
  doc.setTextColor(16, 120, 80); // Green for closure
  doc.text(`INR ${state.outstandingBalance.toLocaleString()}`, 130, 111);

  // Section: Payment Ledger history (Y = 126 to 210)
  doc.setTextColor(textDark[0], textDark[1], textDark[2]);
  doc.setFontSize(9.5);
  doc.setFont('Montserrat', 'bold');
  doc.text(t('loans.payments').toUpperCase(), 15, 128);
  doc.line(15, 130, 195, 130);

  // Draw simple table headers
  doc.setFontSize(8);
  doc.setFont('Montserrat', 'bold');
  doc.text('Date', 15, 136);
  doc.text('Amount Paid', 55, 136);
  doc.text('Payment Type', 95, 136);
  doc.text('Recorded By', 145, 136);
  doc.setLineWidth(0.4);
  doc.line(15, 138, 195, 138);

  doc.setFont('Montserrat', 'normal');
  doc.setTextColor(textDark[0], textDark[1], textDark[2]);
  let tableY = 144;

  payments.forEach((pay, idx) => {
    if (tableY > 210) return;
    
    // Zebra background
    if (idx % 2 === 0) {
      doc.setFillColor(250, 250, 250);
      doc.rect(15, tableY - 4, 180, 6, 'F');
    }

    doc.setFontSize(8);
    doc.text(new Date(pay.paymentDate).toLocaleDateString(), 15, tableY);
    doc.text(`INR ${pay.amount.toLocaleString()}`, 55, tableY);
    doc.text((pay.paymentType || '').toUpperCase(), 95, tableY);
    doc.text((pay.recordedBy || 'Admin').substring(0, 14), 145, tableY);
    tableY += 6.5;
  });

  if (payments.length === 0) {
    doc.text('No ledger payment records found.', 15, 144);
  }

  // Shop Signature stamp placeholder (Y = 225 to 255)
  doc.setDrawColor(200, 200, 200);
  doc.line(135, 245, 185, 245);
  doc.setFontSize(8.5);
  doc.setFont('Montserrat', 'bold');
  doc.setTextColor(textDark[0], textDark[1], textDark[2]);
  doc.text('JEWELER SIGNATURE / STAMP', 135, 250);

  // Audit text
  doc.setFontSize(7.5);
  doc.setFont('Montserrat', 'normal');
  doc.setTextColor(textMuted[0], textMuted[1], textMuted[2]);
  doc.text(`Asset Returned & Loan Marked CLOSED on ${new Date().toLocaleString()} | Ref: ${loan.id}`, 15, 274);

  doc.save(`Closure_Invoice_${loan.id}.pdf`);
}

/* ============================================================
   PARTIAL REPAYMENT PDFs — Payment Receipt, Closure Certificate,
   Customer Statement
   ============================================================ */

const PDF_COLORS = {
  gold: [186, 140, 20],
  dark: [30, 41, 59],
  muted: [100, 116, 139],
  lightBg: [248, 250, 252],
  success: [16, 120, 80],
  red: [186, 12, 12]
};

/**
 * Generates a Payment Receipt PDF for a single recorded repayment.
 */
export async function generatePaymentReceipt(payment, loan, customer, t) {
  const doc = new jsPDF({ orientation: 'portrait', unit: 'mm', format: 'a4' });
  await loadMontserrat(doc);

  const { gold, dark, muted, lightBg, success } = PDF_COLORS;

  doc.setDrawColor(226, 232, 240);
  doc.setLineWidth(0.3);
  doc.rect(8, 8, 194, 281);

  doc.setTextColor(gold[0], gold[1], gold[2]);
  doc.setFont('Montserrat', 'bold');
  doc.setFontSize(16);
  doc.text('EASY GOLD LEDGER', 15, 20);

  doc.setTextColor(muted[0], muted[1], muted[2]);
  doc.setFont('Montserrat', 'normal');
  doc.setFontSize(8);
  doc.text('Premium Gold Valuation & Credit Ledger', 15, 24);

  doc.setTextColor(dark[0], dark[1], dark[2]);
  doc.setFont('Montserrat', 'bold');
  doc.setFontSize(11);
  doc.text((t('payments.receipt') || 'PAYMENT RECEIPT').toUpperCase(), 195, 20, { align: 'right' });

  doc.setTextColor(muted[0], muted[1], muted[2]);
  doc.setFont('Montserrat', 'normal');
  doc.setFontSize(8.5);
  doc.text(`Ref: ${payment.id || ''}`, 195, 24, { align: 'right' });

  doc.setDrawColor(212, 175, 55);
  doc.setLineWidth(0.8);
  doc.line(15, 28, 195, 28);

  // Customer + Loan
  doc.setTextColor(dark[0], dark[1], dark[2]);
  doc.setFontSize(9.5);
  doc.setFont('Montserrat', 'bold');
  doc.text((t('customers.title') || 'CUSTOMER').toUpperCase(), 15, 36);
  doc.setDrawColor(226, 232, 240);
  doc.line(15, 38, 195, 38);

  doc.setFontSize(8.5);
  doc.text(`${t('customers.fullName') || 'Name'}:`, 15, 45);
  doc.setFont('Montserrat', 'normal');
  doc.text(customer.name || 'N/A', 48, 45);

  doc.setFont('Montserrat', 'bold');
  doc.text(`${t('customers.phone') || 'Phone'}:`, 15, 51);
  doc.setFont('Montserrat', 'normal');
  doc.text(customer.phone || 'N/A', 48, 51);

  doc.setFont('Montserrat', 'bold');
  doc.text(`${t('loans.refId') || 'Loan Ref'}:`, 15, 57);
  doc.setFont('Montserrat', 'normal');
  doc.text(loan.id || 'N/A', 48, 57);
  doc.text(loan.itemDescription || '', 130, 57, { align: 'right' });

  // Payment details
  doc.setFont('Montserrat', 'bold');
  doc.setFontSize(9.5);
  doc.setTextColor(dark[0], dark[1], dark[2]);
  doc.text((t('payments.title') || 'PAYMENT DETAILS').toUpperCase(), 15, 70);
  doc.line(15, 72, 195, 72);

  const methodLabel = (payment.paymentMethod || 'cash').toUpperCase();
  const payRows = [
    { label: t('payments.paymentDate') || 'Payment Date', val: payment.paymentDate ? new Date(payment.paymentDate).toLocaleString() : 'N/A' },
    { label: t('payments.paymentMethod') || 'Payment Method', val: methodLabel },
    { label: t('payments.referenceNumber') || 'Reference Number', val: payment.referenceNumber || '—' },
    { label: t('payments.collectedBy') || 'Collected By', val: payment.collectedBy || '—' }
  ];

  let y = 79;
  payRows.forEach((row) => {
    doc.setFontSize(8.5);
    doc.setFont('Montserrat', 'bold');
    doc.setTextColor(muted[0], muted[1], muted[2]);
    doc.text(`${row.label}:`, 15, y);
    doc.setFont('Montserrat', 'normal');
    doc.setTextColor(dark[0], dark[1], dark[2]);
    doc.text(String(row.val), 70, y);
    y += 6.5;
  });

  // Financial breakdown box
  doc.setFillColor(lightBg[0], lightBg[1], lightBg[2]);
  doc.rect(15, 108, 180, 46, 'F');
  doc.setDrawColor(226, 232, 240);
  doc.rect(15, 108, 180, 46);

  doc.setFontSize(9);
  doc.setFont('Montserrat', 'bold');
  doc.setTextColor(muted[0], muted[1], muted[2]);
  doc.text('AMOUNT PAID', 20, 117);
  doc.setFontSize(13);
  doc.setTextColor(success[0], success[1], success[2]);
  doc.text(`INR ${Number(payment.amount || 0).toLocaleString('en-IN')}`, 20, 126);

  doc.setFontSize(8.5);
  doc.setFont('Montserrat', 'bold');
  doc.setTextColor(muted[0], muted[1], muted[2]);
  doc.text(`${t('payments.interestPaid') || 'INTEREST PAID'}`, 95, 117);
  doc.setFont('Montserrat', 'normal');
  doc.setTextColor(dark[0], dark[1], dark[2]);
  doc.text(`INR ${Number(payment.interestPaid || 0).toLocaleString('en-IN')}`, 95, 124);

  doc.setFont('Montserrat', 'bold');
  doc.setTextColor(muted[0], muted[1], muted[2]);
  doc.text(`${t('payments.principalPaid') || 'PRINCIPAL PAID'}`, 145, 117);
  doc.setFont('Montserrat', 'normal');
  doc.setTextColor(dark[0], dark[1], dark[2]);
  doc.text(`INR ${Number(payment.principalPaid || 0).toLocaleString('en-IN')}`, 145, 124);

  doc.setFont('Montserrat', 'bold');
  doc.setTextColor(muted[0], muted[1], muted[2]);
  doc.text(`${t('payments.previousOutstanding') || 'PREVIOUS OUTSTANDING'}`, 20, 139);
  doc.setFont('Montserrat', 'normal');
  doc.setTextColor(dark[0], dark[1], dark[2]);
  doc.text(`INR ${Number(payment.previousOutstanding || 0).toLocaleString('en-IN')}`, 20, 146);

  doc.setFont('Montserrat', 'bold');
  doc.setTextColor(muted[0], muted[1], muted[2]);
  doc.text(`${t('payments.newOutstanding') || 'NEW OUTSTANDING'}`, 95, 139);
  doc.setFont('Montserrat', 'normal');
  doc.setTextColor(dark[0], dark[1], dark[2]);
  doc.text(`INR ${Number(payment.newOutstanding || 0).toLocaleString('en-IN')}`, 95, 146);

  doc.setFont('Montserrat', 'bold');
  doc.setTextColor(muted[0], muted[1], muted[2]);
  doc.text(`${t('payments.remainingPrincipal') || 'REMAINING PRINCIPAL'}`, 145, 139);
  doc.setFont('Montserrat', 'normal');
  doc.setTextColor(dark[0], dark[1], dark[2]);
  doc.text(`INR ${Number(payment.remainingPrincipal || 0).toLocaleString('en-IN')}`, 145, 146);

  // Remarks
  if (payment.remarks) {
    doc.setFontSize(8.5);
    doc.setFont('Montserrat', 'bold');
    doc.setTextColor(muted[0], muted[1], muted[2]);
    doc.text(`${t('payments.remarks') || 'REMARKS'}:`, 15, 168);
    doc.setFont('Montserrat', 'normal');
    doc.setTextColor(dark[0], dark[1], dark[2]);
    const remarkLines = doc.splitTextToSize(payment.remarks, 175);
    doc.text(remarkLines, 15, 175);
  }

  // Signatures
  doc.setDrawColor(200, 200, 200);
  doc.line(15, 235, 65, 235);
  doc.setFontSize(8);
  doc.setFont('Montserrat', 'bold');
  doc.setTextColor(dark[0], dark[1], dark[2]);
  doc.text('COLLECTOR SIGNATURE', 15, 240);

  doc.line(145, 235, 195, 235);
  doc.text('JEWELER SIGNATURE / STAMP', 145, 240);

  doc.setFontSize(7);
  doc.setFont('Montserrat', 'normal');
  doc.setTextColor(muted[0], muted[1], muted[2]);
  doc.text(`Generated on ${new Date().toLocaleString()} | Payment Ref: ${payment.id || ''} | Loan: ${loan.id || ''}`, 15, 274);

  doc.save(`Payment_Receipt_${payment.id || loan.id}.pdf`);
}

/**
 * Generates a Closure Certificate + Final Receipt PDF.
 */
export async function generateClosureCertificate(loan, customer, state, payments, t) {
  const doc = new jsPDF({ orientation: 'portrait', unit: 'mm', format: 'a4' });
  await loadMontserrat(doc);

  const { gold, dark, muted, lightBg, success } = PDF_COLORS;

  doc.setDrawColor(226, 232, 240);
  doc.setLineWidth(0.3);
  doc.rect(8, 8, 194, 281);

  doc.setTextColor(gold[0], gold[1], gold[2]);
  doc.setFont('Montserrat', 'bold');
  doc.setFontSize(16);
  doc.text('EASY GOLD LEDGER', 15, 20);

  doc.setTextColor(muted[0], muted[1], muted[2]);
  doc.setFont('Montserrat', 'normal');
  doc.setFontSize(8);
  doc.text('Premium Gold Valuation & Credit Ledger', 15, 24);

  doc.setTextColor(dark[0], dark[1], dark[2]);
  doc.setFont('Montserrat', 'bold');
  doc.setFontSize(11);
  doc.text((t('loans.closureCertificate') || 'CLOSURE CERTIFICATE').toUpperCase(), 195, 20, { align: 'right' });

  doc.setTextColor(muted[0], muted[1], muted[2]);
  doc.setFont('Montserrat', 'normal');
  doc.setFontSize(8.5);
  doc.text(`Loan Ref: ${loan.id || ''}`, 195, 24, { align: 'right' });

  doc.setDrawColor(212, 175, 55);
  doc.setLineWidth(0.8);
  doc.line(15, 28, 195, 28);

  doc.setFontSize(9.5);
  doc.setFont('Montserrat', 'bold');
  doc.setTextColor(dark[0], dark[1], dark[2]);
  doc.text((t('customers.title') || 'CUSTOMER').toUpperCase(), 15, 36);
  doc.line(15, 38, 195, 38);

  doc.setFontSize(8.5);
  doc.text(`${t('customers.fullName') || 'Name'}:`, 15, 45);
  doc.setFont('Montserrat', 'normal');
  doc.text(customer.name || 'N/A', 48, 45);

  doc.setFont('Montserrat', 'bold');
  doc.text(`${t('customers.phone') || 'Phone'}:`, 15, 51);
  doc.setFont('Montserrat', 'normal');
  doc.text(customer.phone || 'N/A', 48, 51);

  doc.setFont('Montserrat', 'bold');
  doc.text(`${t('loans.itemDesc') || 'Item'}:`, 15, 57);
  doc.setFont('Montserrat', 'normal');
  doc.text(loan.itemDescription || 'N/A', 48, 57);

  // Final settlement
  doc.setFontSize(9.5);
  doc.setFont('Montserrat', 'bold');
  doc.setTextColor(dark[0], dark[1], dark[2]);
  doc.text('FINAL SETTLEMENT BREAKDOWN', 15, 70);
  doc.line(15, 72, 195, 72);

  const grid = [
    { label: t('loans.loanAmount') || 'Original Principal', val: `INR ${Number(loan.loanAmount || 0).toLocaleString('en-IN')}` },
    { label: t('loans.currentPrincipal') || 'Principal Repaid', val: `INR ${Number(loan.loanAmount || 0).toLocaleString('en-IN')}` },
    { label: t('loans.accruedInterest') || 'Interest Settled', val: `INR ${Number(state.accruedInterest || 0).toLocaleString('en-IN')}` },
    { label: t('loans.daysElapsed') || 'Tenure', val: `${state.daysElapsed || 0} days` },
    { label: t('loans.payments') || 'Total Payments', val: `${payments.length || 0}` }
  ];

  let y = 79;
  grid.forEach((row) => {
    doc.setFontSize(8.5);
    doc.setFont('Montserrat', 'bold');
    doc.setTextColor(muted[0], muted[1], muted[2]);
    doc.text(`${row.label}:`, 15, y);
    doc.setFont('Montserrat', 'normal');
    doc.setTextColor(dark[0], dark[1], dark[2]);
    doc.text(row.val, 85, y);
    y += 6.5;
  });

  doc.setFillColor(lightBg[0], lightBg[1], lightBg[2]);
  doc.rect(15, 108, 180, 14, 'F');
  doc.setDrawColor(226, 232, 240);
  doc.rect(15, 108, 180, 14);

  doc.setFontSize(9);
  doc.setFont('Montserrat', 'bold');
  doc.setTextColor(muted[0], muted[1], muted[2]);
  doc.text('TOTAL OUTSTANDING BALANCE PAID', 20, 117);
  doc.setFontSize(10.5);
  doc.setTextColor(success[0], success[1], success[2]);
  doc.text(`INR ${Number(state.outstandingBalance || 0).toLocaleString('en-IN')}`, 130, 117);

  // Repayment history table
  doc.setFontSize(9.5);
  doc.setFont('Montserrat', 'bold');
  doc.setTextColor(dark[0], dark[1], dark[2]);
  doc.text((t('payments.title') || 'REPAYMENT HISTORY').toUpperCase(), 15, 136);
  doc.line(15, 138, 195, 138);

  doc.setFontSize(8);
  doc.setFont('Montserrat', 'bold');
  doc.text('Date', 15, 144);
  doc.text('Amount', 50, 144);
  doc.text('Method', 90, 144);
  doc.text('Principal', 125, 144);
  doc.text('Interest', 155, 144);
  doc.text('Balance', 180, 144);
  doc.line(15, 146, 195, 146);

  doc.setFont('Montserrat', 'normal');
  doc.setTextColor(dark[0], dark[1], dark[2]);
  let tableY = 151;
  const sorted = [...payments].sort((a, b) => new Date(a.paymentDate) - new Date(b.paymentDate));

  sorted.forEach((p, idx) => {
    if (tableY > 210) return;
    if (idx % 2 === 0) {
      doc.setFillColor(250, 250, 250);
      doc.rect(15, tableY - 4, 180, 6, 'F');
    }
    doc.setFontSize(8);
    doc.text(p.paymentDate ? new Date(p.paymentDate).toLocaleDateString() : 'N/A', 15, tableY);
    doc.text(`₹${Number(p.amount || 0).toLocaleString('en-IN')}`, 50, tableY);
    doc.text((p.paymentMethod || p.paymentType || 'cash').toUpperCase().substring(0, 12), 90, tableY);
    doc.text(`₹${Number(p.principalPaid || 0).toLocaleString('en-IN')}`, 125, tableY);
    doc.text(`₹${Number(p.interestPaid || 0).toLocaleString('en-IN')}`, 155, tableY);
    doc.text(`₹${Number(p.newOutstanding || 0).toLocaleString('en-IN')}`, 180, tableY);
    tableY += 6.5;
  });

  if (sorted.length === 0) {
    doc.text('No payment records found.', 15, tableY);
  }

  doc.setDrawColor(200, 200, 200);
  doc.line(135, 245, 185, 245);
  doc.setFontSize(8.5);
  doc.setFont('Montserrat', 'bold');
  doc.setTextColor(dark[0], dark[1], dark[2]);
  doc.text('JEWELER SIGNATURE / STAMP', 135, 250);

  doc.setFontSize(7.5);
  doc.setFont('Montserrat', 'normal');
  doc.setTextColor(muted[0], muted[1], muted[2]);
  doc.text(`Loan settled in full & marked CLOSED on ${new Date().toLocaleString()} | Ref: ${loan.id || ''}`, 15, 274);

  doc.save(`Closure_Certificate_${loan.id || 'Draft'}.pdf`);
}

/**
 * Generates a Customer Statement PDF — all loans + repayment timeline.
 * @param {object} customer { name, phone, address }
 * @param {Array} loans loans of the customer
 * @param {object} paymentsByLoan { [loanId]: [payments...] }
 */
export async function generateCustomerStatement(customer, loans, paymentsByLoan, t) {
  const doc = new jsPDF({ orientation: 'portrait', unit: 'mm', format: 'a4' });
  await loadMontserrat(doc);

  const { gold, dark, muted, lightBg } = PDF_COLORS;

  doc.setDrawColor(226, 232, 240);
  doc.setLineWidth(0.3);
  doc.rect(8, 8, 194, 281);

  doc.setTextColor(gold[0], gold[1], gold[2]);
  doc.setFont('Montserrat', 'bold');
  doc.setFontSize(16);
  doc.text('EASY GOLD LEDGER', 15, 20);

  doc.setTextColor(muted[0], muted[1], muted[2]);
  doc.setFont('Montserrat', 'normal');
  doc.setFontSize(8);
  doc.text('Premium Gold Valuation & Credit Ledger', 15, 24);

  doc.setTextColor(dark[0], dark[1], dark[2]);
  doc.setFont('Montserrat', 'bold');
  doc.setFontSize(11);
  doc.text((t('payments.customerStatement') || 'CUSTOMER STATEMENT').toUpperCase(), 195, 20, { align: 'right' });

  doc.setDrawColor(212, 175, 55);
  doc.setLineWidth(0.8);
  doc.line(15, 28, 195, 28);

  doc.setFontSize(9.5);
  doc.setFont('Montserrat', 'bold');
  doc.setTextColor(dark[0], dark[1], dark[2]);
  doc.text((t('customers.title') || 'CUSTOMER').toUpperCase(), 15, 36);
  doc.line(15, 38, 195, 38);

  doc.setFontSize(8.5);
  doc.text(`${t('customers.fullName') || 'Name'}:`, 15, 45);
  doc.setFont('Montserrat', 'normal');
  doc.text(customer.name || 'N/A', 48, 45);

  doc.setFont('Montserrat', 'bold');
  doc.text(`${t('customers.phone') || 'Phone'}:`, 15, 51);
  doc.setFont('Montserrat', 'normal');
  doc.text(customer.phone || 'N/A', 48, 51);

  if (customer.address) {
    doc.setFont('Montserrat', 'bold');
    doc.text(`${t('customers.address') || 'Address'}:`, 15, 57);
    doc.setFont('Montserrat', 'normal');
    const addrLines = doc.splitTextToSize(customer.address, 130);
    doc.text(addrLines, 48, 57);
  }

  let y = 74;
  const sortedLoans = [...loans].sort((a, b) => new Date(a.pledgeDate) - new Date(b.pledgeDate));

  sortedLoans.forEach((loan, li) => {
    const payments = (paymentsByLoan[loan.id] || []).sort((a, b) => new Date(a.paymentDate) - new Date(b.paymentDate));
    const totalPaid = payments.reduce((s, p) => s + (Number(p.amount) || 0), 0);

    if (y > 200) {
      doc.addPage();
      doc.rect(8, 8, 194, 281);
      y = 20;
    }

    // Loan header block
    doc.setFillColor(lightBg[0], lightBg[1], lightBg[2]);
    doc.rect(15, y - 4, 180, 12, 'F');
    doc.setDrawColor(226, 232, 240);
    doc.rect(15, y - 4, 180, 12);

    doc.setFontSize(8.5);
    doc.setFont('Montserrat', 'bold');
    doc.setTextColor(dark[0], dark[1], dark[2]);
    doc.text(`${li + 1}. ${loan.itemDescription || 'Loan'} (${loan.id || ''})`, 18, y);
    doc.setTextColor(muted[0], muted[1], muted[2]);
    doc.text(`Loan ${Number(loan.loanAmount || 0).toLocaleString('en-IN')}  ·  Paid ${totalPaid.toLocaleString('en-IN')}  ·  ${(loan.status || 'open').toUpperCase()}`, 18, y + 4);
    y += 12;

    // Payments table header
    doc.setFontSize(7.5);
    doc.setFont('Montserrat', 'bold');
    doc.setTextColor(muted[0], muted[1], muted[2]);
    doc.text('Date', 18, y);
    doc.text('Amount', 52, y);
    doc.text('Method', 92, y);
    doc.text('Principal', 128, y);
    doc.text('Interest', 158, y);
    doc.text('Outstanding', 185, y);
    doc.line(15, y + 1.5, 195, y + 1.5);
    y += 5;

    doc.setFont('Montserrat', 'normal');
    doc.setTextColor(dark[0], dark[1], dark[2]);
    if (payments.length === 0) {
      doc.setFontSize(8);
      doc.text('No repayments recorded.', 18, y);
      y += 6;
    } else {
      payments.forEach((p) => {
        if (y > 200) {
          doc.addPage();
          doc.rect(8, 8, 194, 281);
          y = 20;
        }
        doc.setFontSize(7.5);
        doc.text(p.paymentDate ? new Date(p.paymentDate).toLocaleDateString() : 'N/A', 18, y);
        doc.text(`₹${Number(p.amount || 0).toLocaleString('en-IN')}`, 52, y);
        doc.text((p.paymentMethod || p.paymentType || 'cash').toUpperCase().substring(0, 11), 92, y);
        doc.text(`₹${Number(p.principalPaid || 0).toLocaleString('en-IN')}`, 128, y);
        doc.text(`₹${Number(p.interestPaid || 0).toLocaleString('en-IN')}`, 158, y);
        doc.text(`₹${Number(p.newOutstanding || 0).toLocaleString('en-IN')}`, 185, y);
        y += 5.5;
      });
    }
    y += 5;
  });

  if (sortedLoans.length === 0) {
    doc.setFontSize(8.5);
    doc.setTextColor(muted[0], muted[1], muted[2]);
    doc.text('No loan records found for this customer.', 15, 80);
  }

  doc.setFontSize(7);
  doc.setFont('Montserrat', 'normal');
  doc.setTextColor(muted[0], muted[1], muted[2]);
  doc.text(`Generated on ${new Date().toLocaleString()}`, 15, 274);

  doc.save(`Customer_Statement_${(customer.name || 'Customer').replace(/\s+/g, '_')}.pdf`);
}
