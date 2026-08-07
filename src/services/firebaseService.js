import { initializeApp, deleteApp, getApps, getApp } from 'firebase/app';
import { getAuth, createUserWithEmailAndPassword, signOut, signInWithEmailAndPassword, updateEmail, updatePassword } from 'firebase/auth';
import { 
  collection, 
  doc, 
  setDoc, 
  addDoc, 
  updateDoc, 
  getDoc, 
  getDocs, 
  query, 
  where, 
  orderBy, 
  limit,
  serverTimestamp,
  deleteDoc,
  writeBatch,
  arrayUnion
} from 'firebase/firestore';
import { db, auth } from './firebase';
import { calculateLoanState, isActiveLoan } from '../utils/interestEngine';

// Helper to log changes to the database
export async function logAudit(action, entityType, entityId, oldValue = null, newValue = null) {
  try {
    const user = auth.currentUser;
    let userId = 'system';
    let userRole = 'system';

    if (user) {
      userId = user.uid;
      userRole = localStorage.getItem('user_role') || 'unknown';
    }

    await addDoc(collection(db, 'audit_logs'), {
      userId,
      role: userRole,
      action,
      entityType,
      entityId,
      oldValue: oldValue ? JSON.stringify(oldValue) : null,
      newValue: newValue ? JSON.stringify(newValue) : null,
      timestamp: serverTimestamp()
    });
  } catch (error) {
    console.error('Failed to write audit log:', error);
  }
}

/**
 * Fetch all staff member UIDs (Super Admins + Employees).
 */
export async function getStaffUids() {
  try {
    const q = query(collection(db, 'users'), where('role', 'in', ['employee', 'super_admin']));
    const snap = await getDocs(q);
    return snap.docs.map(doc => doc.id);
  } catch (error) {
    console.error('Failed to get staff UIDs:', error);
    return [];
  }
}

/**
 * Creates notification documents for multiple recipients using a batched write.
 */
export async function createNotificationsForRecipients(recipientUids, notificationData) {
  if (!recipientUids || recipientUids.length === 0) return;
  try {
    const batch = writeBatch(db);
    recipientUids.forEach(uid => {
      const docRef = doc(collection(db, 'notifications'));
      batch.set(docRef, {
        userId: uid,
        ...notificationData,
        isRead: false,
        createdAt: serverTimestamp()
      });
    });
    await batch.commit();
  } catch (error) {
    console.error('Failed to create batched notifications:', error);
  }
}

/**
 * Creates a secondary Auth instance to register a user (Employee/Customer) 
 * without signing out the currently logged-in Admin/Employee.
 */
export async function createNewUserAuth(email, password) {
  // Reconstruct config object to initialize secondary app
  const firebaseConfig = {
    apiKey: import.meta.env.VITE_FIREBASE_API_KEY,
    authDomain: import.meta.env.VITE_FIREBASE_AUTH_DOMAIN,
    projectId: import.meta.env.VITE_FIREBASE_PROJECT_ID,
    storageBucket: import.meta.env.VITE_FIREBASE_STORAGE_BUCKET,
    messagingSenderId: import.meta.env.VITE_FIREBASE_MESSAGING_SENDER_ID,
    appId: import.meta.env.VITE_FIREBASE_APP_ID
  };

  // Use a unique name each time so it never conflicts if previous call didn't clean up
  const appName = `SecondaryApp_${Date.now()}`;
  const secondaryApp = initializeApp(firebaseConfig, appName);
  const secondaryAuth = getAuth(secondaryApp);

  try {
    const userCredential = await createUserWithEmailAndPassword(secondaryAuth, email, password);
    const newUid = userCredential.user.uid;
    // Sign out secondary auth so it is clean
    await signOut(secondaryAuth);
    return newUid;
  } finally {
    // Terminate secondary app to free resources (Firebase v9+ modular API)
    await deleteApp(secondaryApp);
  }
}

/**
 * Register a user and customer profile.
 */
export async function registerCustomer(customerData) {
  const { email, password, name, phone, address, photoBase64, faceEmbedding, facePhotoBase64, idProofBase64, signatureBase64, gpsLocation } = customerData;
  
  // 1. Create secondary auth account
  const newUid = await createNewUserAuth(email, password);

  // 2. Create users/{uid} document
  const userDocRef = doc(db, 'users', newUid);
  const userFields = {
    role: 'customer',
    name,
    phone,
    email,
    status: 'active',
    photoBase64: photoBase64 || '',
    faceEmbedding: faceEmbedding || null,
    facePhotoBase64: facePhotoBase64 || '',
    gpsLocation: gpsLocation || null,
    createdAt: new Date().toISOString()
  };
  await setDoc(userDocRef, userFields);

  // 3. Create customers/{uid} document
  const customerDocRef = doc(db, 'customers', newUid);
  const customerFields = {
    userId: newUid,
    address,
    idProofBase64: idProofBase64 || '',
    signatureBase64: signatureBase64 || '',
    gpsLocation: gpsLocation || null,
    kycVerified: true,
    createdAt: new Date().toISOString()
  };
  await setDoc(customerDocRef, customerFields);

  // 4. Audit Log
  await logAudit('create_customer', 'customers', newUid, null, { name, email, phone });

  return newUid;
}

/**
 * Register an Employee or Super Admin user.
 */
export async function registerStaffUser(staffData) {
  const { email, password, name, phone, role } = staffData;

  const newUid = await createNewUserAuth(email, password);

  const userDocRef = doc(db, 'users', newUid);
  const userFields = {
    role, // 'employee' | 'super_admin'
    name,
    phone,
    email,
    password,
    status: 'active',
    createdAt: new Date().toISOString()
  };
  await setDoc(userDocRef, userFields);

  await logAudit(`create_${role}`, 'users', newUid, null, { name, email, role });
  return newUid;
}

/**
 * Update an existing Employee or Super Admin user.
 */
export async function updateStaffUser(uid, staffData, oldEmail, oldPassword) {
  const { email, password, name, phone, role } = staffData;

  const emailChanged = email !== oldEmail;
  const passwordChanged = password !== oldPassword;

  // 1. If email or password changed, update Firebase Auth using secondary Auth instance
  if ((emailChanged || passwordChanged) && oldEmail && oldPassword) {
    const firebaseConfig = {
      apiKey: import.meta.env.VITE_FIREBASE_API_KEY,
      authDomain: import.meta.env.VITE_FIREBASE_AUTH_DOMAIN,
      projectId: import.meta.env.VITE_FIREBASE_PROJECT_ID,
      storageBucket: import.meta.env.VITE_FIREBASE_STORAGE_BUCKET,
      messagingSenderId: import.meta.env.VITE_FIREBASE_MESSAGING_SENDER_ID,
      appId: import.meta.env.VITE_FIREBASE_APP_ID
    };

    const appName = `SecondaryAppUpdate_${Date.now()}`;
    const secondaryApp = initializeApp(firebaseConfig, appName);
    const secondaryAuth = getAuth(secondaryApp);

    try {
      const userCred = await signInWithEmailAndPassword(secondaryAuth, oldEmail, oldPassword);
      const user = userCred.user;

      if (emailChanged) {
        await updateEmail(user, email);
      }
      if (passwordChanged) {
        await updatePassword(user, password);
      }
      
      await signOut(secondaryAuth);
    } finally {
      await deleteApp(secondaryApp);
    }
  }

  // 2. Update Firestore users collection
  const userDocRef = doc(db, 'users', uid);
  const userFields = {
    role,
    name,
    phone,
    email,
    password,
    status: 'active'
  };
  await updateDoc(userDocRef, userFields);

  await logAudit(`update_${role}`, 'users', uid, { name, email: oldEmail, role }, { name, email, role, phone });
}

/**
 * Updates a user's status (active/inactive).
 */
export async function updateUserStatus(uid, newStatus) {
  const userDocRef = doc(db, 'users', uid);
  const userSnap = await getDoc(userDocRef);
  const oldData = userSnap.data();

  await updateDoc(userDocRef, { status: newStatus });
  await logAudit('update_user_status', 'users', uid, { status: oldData.status }, { status: newStatus });

  // Send status change notification to customer
  try {
    const customerName = oldData.name || 'Customer';
    const severity = newStatus === 'active' ? 'info' : 'warning';
    const titleKey = newStatus === 'active' ? 'notif.accountActive.title' : 'notif.accountInactive.title';
    const messageKey = newStatus === 'active' ? 'notif.accountActive.message' : 'notif.accountInactive.message';

    await createNotificationsForRecipients([uid], {
      type: 'account_status',
      loanId: null,
      severity,
      titleKey,
      messageKey,
      messageParams: {
        customerName
      }
    });
  } catch (error) {
    console.error('Failed to dispatch status update notification:', error);
  }
}

/**
 * Updates a customer's email address.
 * Standard path for email updates if they lose their registration.
 */
export async function updateCustomerEmail(uid, newEmail) {
  const userDocRef = doc(db, 'users', uid);
  const userSnap = await getDoc(userDocRef);
  const oldData = userSnap.data();

  await updateDoc(userDocRef, { email: newEmail });
  await logAudit('update_customer_email', 'users', uid, { email: oldData.email }, { email: newEmail });
}

/**
 * Creates a new gold loan pledge.
 */
export async function createLoan(loanData, itemImageBase64) {
  const loansColRef = collection(db, 'loans');
  
  const creator = auth.currentUser ? auth.currentUser.uid : 'unknown';

  const newLoanDocRef = await addDoc(loansColRef, {
    ...loanData,
    status: 'open',
    notifiedThresholds: [],
    createdBy: creator,
    createdAt: new Date().toISOString()
  });

  // Save the pledge image in the subcollection to keep the loan document size small
  if (itemImageBase64) {
    const primaryImage = Array.isArray(itemImageBase64) ? itemImageBase64[0] : itemImageBase64;
    if (primaryImage) {
      const imagesColRef = collection(db, 'loans', newLoanDocRef.id, 'images');
      await addDoc(imagesColRef, {
        imageBase64: primaryImage,
        angle: 'primary',
        uploadedAt: new Date().toISOString()
      });
    }
  }

  // Create notifications
  try {
    const customerDoc = await getDoc(doc(db, 'users', loanData.customerId));
    const customerName = customerDoc.exists() ? customerDoc.data().name : 'Customer';
    const staffUids = await getStaffUids();
    const recipientUids = Array.from(new Set([...staffUids, loanData.customerId]));

    await createNotificationsForRecipients(recipientUids, {
      type: 'new_loan',
      loanId: newLoanDocRef.id,
      severity: 'info',
      titleKey: 'notif.newLoan.title',
      messageKey: 'notif.newLoan.message',
      messageParams: {
        customerName,
        amount: loanData.loanAmount,
        loanId: newLoanDocRef.id
      }
    });
  } catch (error) {
    console.error('Failed to dispatch new loan notifications:', error);
  }

  // Audit
  await logAudit('create_loan', 'loans', newLoanDocRef.id, null, loanData);

  return newLoanDocRef.id;
}

/**
 * Records a payment against an active loan.
 */
export async function recordPayment(loanId, paymentData) {
  const paymentsColRef = collection(db, 'loans', loanId, 'payments');
  const recorder = auth.currentUser ? auth.currentUser.uid : 'unknown';

  const newPayDocRef = await addDoc(paymentsColRef, {
    ...paymentData,
    recordedBy: recorder,
    paymentDate: new Date().toISOString()
  });

  // Create notifications
  try {
    const loanSnap = await getDoc(doc(db, 'loans', loanId));
    const loanData = loanSnap.data();

    if (loanData) {
      const customerDoc = await getDoc(doc(db, 'users', loanData.customerId));
      const customerName = customerDoc.exists() ? customerDoc.data().name : 'Customer';
      const staffUids = await getStaffUids();
      const recipientUids = Array.from(new Set([...staffUids, loanData.customerId]));

      await createNotificationsForRecipients(recipientUids, {
        type: 'payment_received',
        loanId,
        severity: 'info',
        titleKey: 'notif.paymentReceived.title',
        messageKey: 'notif.paymentReceived.message',
        messageParams: {
          customerName,
          amount: paymentData.amount,
          paymentType: paymentData.paymentType
        }
      });
    }
  } catch (error) {
    console.error('Failed to dispatch payment notifications:', error);
  }

  // Audit
  await logAudit('record_payment', 'payments', newPayDocRef.id, null, { loanId, ...paymentData });

  return newPayDocRef.id;
}

/**
 * Closes a loan (status changes to 'closed').
 * Triggers deactivation of customer if they have no other open loans.
 */
export async function closeLoan(loanId, finalPaymentAmount) {
  const loanDocRef = doc(db, 'loans', loanId);
  const loanSnap = await getDoc(loanDocRef);
  const loanData = loanSnap.data();

  if (!loanData) throw new Error('Loan not found');

  // Record closure payment
  if (finalPaymentAmount > 0) {
    await recordPayment(loanId, {
      amount: finalPaymentAmount,
      paymentType: 'full',
      notes: 'Final outstanding balance paid at closure.'
    });
  }

  // Update loan status to 'closed'
  await updateDoc(loanDocRef, { status: 'closed' });

  // Create notifications
  try {
    const customerDoc = await getDoc(doc(db, 'users', loanData.customerId));
    const customerName = customerDoc.exists() ? customerDoc.data().name : 'Customer';
    const staffUids = await getStaffUids();
    const recipientUids = Array.from(new Set([...staffUids, loanData.customerId]));

    await createNotificationsForRecipients(recipientUids, {
      type: 'loan_closed',
      loanId,
      severity: 'info',
      titleKey: 'notif.loanClosed.title',
      messageKey: 'notif.loanClosed.message',
      messageParams: {
        customerName,
        loanId
      }
    });
  } catch (error) {
    console.error('Failed to dispatch closure notifications:', error);
  }

  // Audit
  await logAudit('close_loan', 'loans', loanId, { status: 'open' }, { status: 'closed' });

  // Auto-deactivation logic: check if customer has any other active open loans
  const loansQuery = query(
    collection(db, 'loans'), 
    where('customerId', '==', loanData.customerId), 
    where('status', 'in', ['open', 'partially_paid'])
  );
  const openLoansSnap = await getDocs(loansQuery);

  if (openLoansSnap.empty) {
    // Deactivate customer account
    await updateUserStatus(loanData.customerId, 'inactive');
  }

  return true;
}

/**
 * Registers default/forfeiture/auction of a loan.
 */
export async function forfeitLoan(loanId, auctionData) {
  const loanDocRef = doc(db, 'loans', loanId);
  const loanSnap = await getDoc(loanDocRef);
  const loanData = loanSnap.data();

  if (!loanData) throw new Error('Loan not found');

  const approver = auth.currentUser ? auth.currentUser.uid : 'unknown';

  // Save forfeiture record subcollection
  const forfeitColRef = collection(db, 'loans', loanId, 'forfeiture');
  await addDoc(forfeitColRef, {
    ...auctionData,
    approvedBy: approver,
    createdAt: new Date().toISOString()
  });

  // Update status to forfeited
  await updateDoc(loanDocRef, { status: 'forfeited' });

  // Create notifications
  try {
    const customerDoc = await getDoc(doc(db, 'users', loanData.customerId));
    const customerName = customerDoc.exists() ? customerDoc.data().name : 'Customer';
    const staffUids = await getStaffUids();
    const recipientUids = Array.from(new Set([...staffUids, loanData.customerId]));

    await createNotificationsForRecipients(recipientUids, {
      type: 'loan_forfeited',
      loanId,
      severity: 'critical',
      titleKey: 'notif.loanForfeited.title',
      messageKey: 'notif.loanForfeited.message',
      messageParams: {
        customerName,
        loanId
      }
    });
  } catch (error) {
    console.error('Failed to dispatch forfeit notifications:', error);
  }

  // Audit
  await logAudit('forfeit_loan', 'loans', loanId, { status: 'open' }, { status: 'forfeited', auctionData });

  // Auto-deactivation logic check (since this loan is no longer open)
  const loansQuery = query(
    collection(db, 'loans'), 
    where('customerId', '==', loanData.customerId), 
    where('status', 'in', ['open', 'partially_paid'])
  );
  const openLoansSnap = await getDocs(loansQuery);

  if (openLoansSnap.empty) {
    await updateUserStatus(loanData.customerId, 'inactive');
  }

  return true;
}

/**
 * Updates the current gold and silver rates.
 */
export async function updateGoldRate(ratePerGram, silverRatePerGram) {
  const updater = auth.currentUser ? auth.currentUser.uid : 'unknown';
  const newRateDoc = {
    ratePerGram: parseFloat(ratePerGram),
    silverRatePerGram: parseFloat(silverRatePerGram) || 0,
    effectiveDate: new Date().toISOString(),
    updatedBy: updater
  };

  const rateColRef = collection(db, 'gold_rate_history');
  const docRef = await addDoc(rateColRef, newRateDoc);

  // Note: the ledger rate is NOT written into localStorage — the live
  // market cache (live_metal_rates_cache_v1) is the only price cache,
  // so admin-saved ledger values can never masquerade as live prices.

  // Create notifications for all customers with open loans
  try {
    const openLoansQuery = query(collection(db, 'loans'), where('status', 'in', ['open', 'partially_paid']));
    const openLoansSnap = await getDocs(openLoansQuery);
    const customerIds = new Set(openLoansSnap.docs.map(doc => doc.data().customerId));
    const recipientUids = Array.from(customerIds);

    await createNotificationsForRecipients(recipientUids, {
      type: 'rate_updated',
      loanId: null,
      severity: 'info',
      titleKey: 'notif.rateUpdated.title',
      messageKey: 'notif.rateUpdated.message',
      messageParams: {
        goldRate: ratePerGram,
        silverRate: silverRatePerGram
      }
    });
  } catch (error) {
    console.error('Failed to dispatch rate update notifications:', error);
  }

  // Audit
  await logAudit('update_gold_rate', 'gold_rate_history', docRef.id, null, newRateDoc);

  return docRef.id;
}

/**
 * Deletes a loan or customer record (Only Super Admin can invoke - verified via Security Rules).
 */
export async function deleteRecord(collectionName, docId) {
  const docRef = doc(db, collectionName, docId);
  const snap = await getDoc(docRef);
  const data = snap.data();

  await deleteDoc(docRef);
  await logAudit(`delete_${collectionName.slice(0, -1)}`, collectionName, docId, data, null);
}

/**
 * Lazy evaluation of interest thresholds. Checks if a loan has crossed 50%, 75%, or 90%
 * of its estimated metal value, and creates notifications if so.
 */
export async function checkAndNotifyThresholds(loan) {
  if (!loan || !isActiveLoan(loan.status)) return;

  try {
    // 1. Fetch payments for this loan
    const paymentsSnap = await getDocs(collection(db, 'loans', loan.id, 'payments'));
    const payments = paymentsSnap.docs.map(doc => doc.data());

    // 2. Calculate current state
    const state = calculateLoanState(loan.loanAmount, loan.interestRate, loan.pledgeDate, payments);
    const currentValue = state.outstandingBalance;
    const percentOfMarketValue = (currentValue / parseFloat(loan.estimatedValue)) * 100;

    let threshold = null;
    let severity = 'info';
    let titleKey = '';
    let messageKey = '';

    if (percentOfMarketValue >= 90) {
      threshold = 90;
      severity = 'critical';
      titleKey = 'notif.threshold90.title';
      messageKey = 'notif.threshold90.message';
    } else if (percentOfMarketValue >= 75) {
      threshold = 75;
      severity = 'warning';
      titleKey = 'notif.threshold75.title';
      messageKey = 'notif.threshold75.message';
    } else if (percentOfMarketValue >= 50) {
      threshold = 50;
      severity = 'info';
      titleKey = 'notif.threshold50.title';
      messageKey = 'notif.threshold50.message';
    }

    if (!threshold) return;

    // Check if already notified
    const notified = loan.notifiedThresholds || [];
    if (notified.includes(threshold)) return;

    // Resolve customer name
    const customerDoc = await getDoc(doc(db, 'users', loan.customerId));
    const customerName = customerDoc.exists() ? customerDoc.data().name : 'Customer';

    // Get all staff uids
    const staffUids = await getStaffUids();
    const recipientUids = Array.from(new Set([...staffUids, loan.customerId]));

    // Batch notification write + loan notifiedThresholds update
    const batch = writeBatch(db);
    
    recipientUids.forEach(uid => {
      const notifRef = doc(collection(db, 'notifications'));
      batch.set(notifRef, {
        userId: uid,
        type: 'threshold_alert',
        loanId: loan.id,
        severity,
        titleKey,
        messageKey,
        messageParams: {
          customerName,
          amount: Math.round(currentValue),
          loanId: loan.id
        },
        isRead: false,
        createdAt: serverTimestamp()
      });
    });

    const loanRef = doc(db, 'loans', loan.id);
    batch.update(loanRef, {
      notifiedThresholds: arrayUnion(threshold)
    });

    await batch.commit();
  } catch (error) {
    console.error('Error checking loan threshold:', error);
  }
}

/* ============================================================
   PARTIAL LOAN REPAYMENT SYSTEM
   ------------------------------------------------------------
   Every payment is persisted TWICE in one atomic batch:
     1. payments/{paymentId}  — top-level ledger (search, reports,
        dashboard collections, customer statements).
     2. loans/{loanId}/payments/{paymentId} — sub-collection mirror
        consumed by the interest engine (calculateLoanState) and
        the inspector's ledger UI.
   The loan document carries running totals: outstandingPrincipal,
   totalPaid, lastPaymentDate, paymentCount, loanStatus (+ status
   kept in sync for existing queries).
   ============================================================ */

function assertPermission(action) {
  const role = localStorage.getItem('user_role') || 'employee';
  if (role !== 'super_admin') {
    throw new Error(`Only Super Admins can ${action} payments.`);
  }
  return role;
}

/** All payments of a loan, sorted by payment date ascending. */
export async function getLoanPayments(loanId) {
  const snap = await getDocs(collection(db, 'loans', loanId, 'payments'));
  return snap.docs
    .map(d => ({ id: d.id, ...d.data() }))
    .sort((a, b) => new Date(a.paymentDate) - new Date(b.paymentDate));
}

/** Recent payments from the top-level ledger (newest first). */
export async function getRecentPayments(max = 1000) {
  const snap = await getDocs(query(collection(db, 'payments'), orderBy('paymentDate', 'desc'), limit(max)));
  return snap.docs.map(d => ({ id: d.id, ...d.data() }));
}

/** All payments for a loan from the top-level ledger (newest first). */
export async function getPaymentsByLoan(loanId) {
  const snap = await getDocs(query(collection(db, 'payments'), where('loanId', '==', loanId)));
  return snap.docs
    .map(d => ({ id: d.id, ...d.data() }))
    .sort((a, b) => new Date(b.paymentDate) - new Date(a.paymentDate));
}

/** All payments of a customer from the top-level ledger (newest first). */
export async function getPaymentsByCustomer(customerId) {
  const snap = await getDocs(query(collection(db, 'payments'), where('customerId', '==', customerId)));
  return snap.docs
    .map(d => ({ id: d.id, ...d.data() }))
    .sort((a, b) => new Date(b.paymentDate) - new Date(a.paymentDate));
}

/** Deactivates a customer account when they have no active loans left. */
async function deactivateCustomerIfNoOpenLoans(customerId) {
  try {
    const loansQuery = query(
      collection(db, 'loans'),
      where('customerId', '==', customerId),
      where('status', 'in', ['open', 'partially_paid'])
    );
    const openLoansSnap = await getDocs(loansQuery);
    if (openLoansSnap.empty) await updateUserStatus(customerId, 'inactive');
  } catch (error) {
    console.error('Failed to check deactivation:', error);
  }
}

/**
 * Records a partial or full repayment against an active loan.
 * - Validates amount > 0 and amount <= outstanding balance (no negative balances).
 * - Splits the payment into interestPaid (accrued interest first) and principalPaid.
 * - Full repayment auto-closes the loan (status -> 'closed') and logs loan_closed.
 * - Recomputes loan totals, writes audit logs, dispatches notifications.
 *
 * @param {string} loanId
 * @param {object} paymentData { amount, paymentDate, paymentMethod, referenceNumber, remarks, collectedBy }
 * @returns {Promise<string>} payment id
 */
export async function addPayment(loanId, paymentData) {
  const {
    amount,
    paymentDate,
    paymentMethod = 'cash',
    referenceNumber = '',
    remarks = '',
    collectedBy = ''
  } = paymentData || {};

  const payAmount = parseFloat(amount);
  if (!payAmount || payAmount <= 0) {
    throw new Error('Payment amount must be greater than zero.');
  }
  if (!paymentDate) throw new Error('Payment date is required.');

  const loanDocRef = doc(db, 'loans', loanId);
  const loanSnap = await getDoc(loanDocRef);
  const loan = loanSnap.data();
  if (!loan) throw new Error('Loan not found.');
  if (!isActiveLoan(loan.status)) throw new Error('Loan is not active (already closed or forfeited).');

  const payDate = new Date(`${paymentDate}T23:59:59`);
  const pledgeDate = new Date(loan.pledgeDate);
  pledgeDate.setHours(0, 0, 0, 0);
  if (payDate < pledgeDate) {
    throw new Error('Payment date cannot be before the pledge date.');
  }
  const payDateISO = payDate.toISOString();

  const payments = await getLoanPayments(loanId);

  // Prevent duplicate submission: same reference + amount + date already exists.
  if (referenceNumber) {
    const duplicate = payments.find(p =>
      (p.referenceNumber || '') === referenceNumber &&
      Math.abs((parseFloat(p.amount) || 0) - payAmount) < 0.01 &&
      (p.paymentDate || '').slice(0, 10) === payDateISO.slice(0, 10)
    );
    if (duplicate) {
      throw new Error('A payment with this reference number, amount, and date already exists.');
    }
  }

  // State right before this payment (interest accrued up to end of payment date).
  const before = calculateLoanState(loan.loanAmount, loan.interestRate, loan.pledgeDate, payments, payDate);
  if (payAmount > before.outstandingBalance + 0.01) {
    throw new Error(
      `Payment amount exceeds the outstanding balance (₹${Math.round(before.outstandingBalance).toLocaleString('en-IN')}).`
    );
  }

  const recorder = auth.currentUser ? auth.currentUser.uid : 'unknown';
  const nowISO = new Date().toISOString();

  const newPayment = {
    loanId,
    customerId: loan.customerId,
    amount: Math.round(payAmount * 100) / 100,
    paymentDate: payDateISO,
    paymentType: 'partial', // interest-first split, engine-compatible
    paymentMethod,
    referenceNumber,
    remarks,
    collectedBy,
    previousOutstanding: Math.round(before.outstandingBalance * 100) / 100,
    principalBefore: Math.round(before.currentPrincipal * 100) / 100,
    interestBefore: Math.round(before.accruedInterest * 100) / 100
  };

  // State right after this payment (engine settles payment at its date).
  const after = calculateLoanState(loan.loanAmount, loan.interestRate, loan.pledgeDate, [...payments, newPayment], payDate);

  const interestPaid = Math.max(0, Math.round((before.accruedInterest - after.accruedInterest) * 100) / 100);
  const principalPaid = Math.max(0, Math.round((payAmount - interestPaid) * 100) / 100);
  const newOutstanding = Math.round(after.outstandingBalance * 100) / 100;

  const fullyRepaid = after.currentPrincipal <= 0.005 && after.accruedInterest <= 0.005;
  const nextStatus = fullyRepaid ? 'closed' : 'partially_paid';

  const paymentId = doc(collection(db, 'payments')).id;
  const payDoc = {
    ...newPayment,
    interestPaid,
    principalPaid,
    newOutstanding,
    remainingPrincipal: Math.round(after.currentPrincipal * 100) / 100,
    recordedBy: recorder,
    createdAt: nowISO,
    updatedAt: nowISO
  };

  // Atomic: top-level ledger + sub-collection mirror + loan totals.
  const batch = writeBatch(db);
  batch.set(doc(db, 'payments', paymentId), payDoc);
  batch.set(doc(db, 'loans', loanId, 'payments', paymentId), { ...payDoc, id: paymentId });
  batch.update(loanDocRef, {
    outstandingPrincipal: Math.round(after.currentPrincipal * 100) / 100,
    totalPaid: Math.round(((parseFloat(loan.totalPaid) || 0) + payAmount) * 100) / 100,
    lastPaymentDate: payDateISO,
    paymentCount: (parseInt(loan.paymentCount, 10) || 0) + 1,
    loanStatus: nextStatus,
    status: nextStatus,
    updatedAt: nowISO
  });
  await batch.commit();

  // Audit
  await logAudit('payment_added', 'payments', paymentId, null, {
    loanId,
    amount: payAmount,
    paymentMethod,
    referenceNumber,
    interestPaid,
    principalPaid,
    newOutstanding,
    loanStatus: nextStatus
  });
  if (nextStatus === 'closed') {
    await logAudit('loan_closed', 'loans', loanId, { status: loan.status }, { status: 'closed', reason: 'fully_repaid' });
  }

  // Notifications
  try {
    const customerDoc = await getDoc(doc(db, 'users', loan.customerId));
    const customerName = customerDoc.exists() ? customerDoc.data().name : 'Customer';
    const staffUids = await getStaffUids();
    const recipientUids = Array.from(new Set([...staffUids, loan.customerId]));

    await createNotificationsForRecipients(recipientUids, {
      type: 'payment_received',
      loanId,
      severity: 'info',
      titleKey: 'notif.paymentReceived.title',
      messageKey: 'notif.paymentReceived.message',
      messageParams: {
        customerName,
        amount: payAmount,
        paymentType: paymentMethod
      }
    });

    if (nextStatus === 'closed') {
      await createNotificationsForRecipients(recipientUids, {
        type: 'loan_closed',
        loanId,
        severity: 'info',
        titleKey: 'notif.loanClosed.title',
        messageKey: 'notif.loanClosed.message',
        messageParams: { customerName, loanId }
      });
    }
  } catch (error) {
    console.error('Failed to dispatch payment notifications:', error);
  }

  // Full repayment: auto-close lifecycle (deactivate customer if no other loans).
  if (nextStatus === 'closed') {
    await deactivateCustomerIfNoOpenLoans(loan.customerId);
  }

  return paymentId;
}

/**
 * Recomputes the loan's running totals + status from its payment history.
 * Used after payment edits/deletions to keep the loan document truthful.
 */
export async function recomputeLoanTotals(loanId) {
  const loanDocRef = doc(db, 'loans', loanId);
  const loanSnap = await getDoc(loanDocRef);
  const loan = loanSnap.data();
  if (!loan) return null;

  const payments = await getLoanPayments(loanId);
  const state = calculateLoanState(loan.loanAmount, loan.interestRate, loan.pledgeDate, payments);
  const totalPaid = payments.reduce((sum, p) => sum + (parseFloat(p.amount) || 0), 0);
  const lastPay = payments.length
    ? [...payments].sort((a, b) => new Date(b.paymentDate) - new Date(a.paymentDate))[0]
    : null;

  let nextStatus;
  if (loan.status === 'forfeited') {
    nextStatus = 'forfeited';
  } else if (state.currentPrincipal <= 0.005 && state.accruedInterest <= 0.005) {
    nextStatus = 'closed';
  } else if (payments.length > 0) {
    nextStatus = 'partially_paid';
  } else {
    nextStatus = 'open';
  }

  const totals = {
    outstandingPrincipal: Math.round(state.currentPrincipal * 100) / 100,
    totalPaid: Math.round(totalPaid * 100) / 100,
    lastPaymentDate: lastPay ? lastPay.paymentDate : null,
    paymentCount: payments.length,
    loanStatus: nextStatus,
    status: nextStatus,
    updatedAt: new Date().toISOString()
  };
  await updateDoc(loanDocRef, totals);
  return { id: loanId, ...loan, ...totals };
}

/**
 * Edits a payment (Super Admin only).
 * Updates both copies, then recomputes loan totals from history.
 */
export async function updatePayment(loanId, paymentId, changes) {
  assertPermission('edit');

  const payDocRef = doc(db, 'payments', paymentId);
  const paySnap = await getDoc(payDocRef);
  if (!paySnap.exists()) throw new Error('Payment not found.');
  const oldData = paySnap.data();

  const updater = auth.currentUser ? auth.currentUser.uid : 'unknown';
  const updates = {
    ...changes,
    updatedAt: new Date().toISOString(),
    updatedBy: updater
  };

  const batch = writeBatch(db);
  batch.update(payDocRef, updates);
  const mirrorRef = doc(db, 'loans', loanId, 'payments', paymentId);
  const mirrorSnap = await getDoc(mirrorRef);
  if (mirrorSnap.exists()) batch.update(mirrorRef, updates);
  await batch.commit();

  await recomputeLoanTotals(loanId);
  await logAudit('payment_edited', 'payments', paymentId, oldData, updates);
  return true;
}

/**
 * Deletes a payment (Super Admin only).
 * Removes both copies, then recomputes loan totals from history.
 */
export async function deletePayment(loanId, paymentId) {
  assertPermission('delete');

  const payDocRef = doc(db, 'payments', paymentId);
  const paySnap = await getDoc(payDocRef);
  if (!paySnap.exists()) throw new Error('Payment not found.');
  const oldData = paySnap.data();

  const batch = writeBatch(db);
  batch.delete(payDocRef);
  batch.delete(doc(db, 'loans', loanId, 'payments', paymentId));
  await batch.commit();

  await recomputeLoanTotals(loanId);
  await logAudit('payment_deleted', 'payments', paymentId, oldData, null);
  return true;
}
