/**
 * Interest calculation engine for Gold Loan Management Software.
 * Performs daily/monthly simple interest ledger tracking on running balances.
 */

// Purity factors based on Karat for Gold
export const PURITY_FACTORS = {
  24: 1.0,
  22: 22 / 24, // ~0.9167
  20: 20 / 24, // ~0.8333
  18: 18 / 24  // ~0.75
};

// Loan lifecycle statuses
export const LOAN_STATUSES = ['open', 'partially_paid', 'paid', 'closed', 'defaulted', 'forfeited'];

// Statuses that represent a live (still running) loan
export const ACTIVE_LOAN_STATUSES = ['open', 'partially_paid'];

/** True when the loan is still accruing interest (open or partially paid). */
export function isActiveLoan(status) {
  return ACTIVE_LOAN_STATUSES.includes(status);
}

// Purity factors based on fineness/percentage for Silver
export const SILVER_PURITY_FACTORS = {
  999: 0.999, // 99.9% Pure
  925: 0.925, // 92.5% Sterling
  900: 0.900, // 90.0% Standard
  800: 0.800  // 80.0%
};

/**
 * Calculates estimated gold/silver item market value.
 * @param {number} weightGrams - Weight in grams
 * @param {number|string} purity - Purity Karat (Gold) or Fineness (Silver)
 * @param {number} ratePerGram - Metal rate at time of pledge
 * @param {string} metalType - 'gold' or 'silver'
 * @returns {number} Estimated value
 */
export function calculateEstimatedValue(weightGrams, purity, ratePerGram, metalType = 'gold') {
  let factor = 1.0;
  if (metalType === 'silver') {
    const purityVal = parseInt(purity, 10) || 999;
    factor = SILVER_PURITY_FACTORS[purityVal] || (purityVal / 1000);
  } else {
    const purityVal = parseInt(purity, 10) || 22;
    factor = PURITY_FACTORS[purityVal] || (purityVal / 24);
  }
  return weightGrams * factor * ratePerGram;
}

/**
 * Calculates number of days between two dates.
 * Ensures a minimum of 1 day if dates are different, or 0 days if same date/time.
 */
export function getDaysElapsed(startDate, endDate) {
  const start = new Date(startDate);
  const end = new Date(endDate);
  // Strip hours/minutes/seconds to calculate full days
  start.setHours(0, 0, 0, 0);
  end.setHours(0, 0, 0, 0);
  const diffTime = Math.max(0, end.getTime() - start.getTime());
  return Math.ceil(diffTime / (1000 * 60 * 60 * 24));
}

/**
 * Computes running interest ledger.
 * Walks through payment history chronologically to compute interest accrued on principal.
 * 
 * @param {number} principal - Original loan amount
 * @param {number} monthlyRatePercent - Default/custom monthly interest rate (e.g. 1.5)
 * @param {string|Date} pledgeDate - Starting date of loan
 * @param {Array} payments - Sub-collection of payments: [{amount, paymentType: 'partial'|'full'|'interest_only', paymentDate}]
 * @param {string|Date} [targetDate] - End date of calculation (defaults to now)
 * @returns {Object} { originalPrincipal, currentPrincipal, accruedInterest, outstandingBalance, daysElapsed }
 */
export function calculateLoanState(principal, monthlyRatePercent, pledgeDate, payments = [], targetDate = new Date()) {
  const rate = parseFloat(monthlyRatePercent) || 0;
  let currentPrincipal = parseFloat(principal) || 0;
  let accruedInterest = 0;
  let lastCheckpointDate = new Date(pledgeDate);
  const endCalcDate = new Date(targetDate);

  // Sort payments chronologically
  const sortedPayments = [...payments].sort((a, b) => new Date(a.paymentDate) - new Date(b.paymentDate));

  for (const pay of sortedPayments) {
    const payDate = new Date(pay.paymentDate);
    
    // Ignore payments made before the pledge date or after the target calculation date
    if (payDate < lastCheckpointDate || payDate > endCalcDate) continue;

    // Calculate elapsed days since last checkpoint
    const days = getDaysElapsed(lastCheckpointDate, payDate);
    // Simple Interest for this segment: P * R * T
    // Rate is monthly, so Time is days / 30
    const segmentInterest = currentPrincipal * (rate / 100) * (days / 30);
    accruedInterest += segmentInterest;

    const paymentAmount = parseFloat(pay.amount) || 0;

    if (pay.paymentType === 'interest_only') {
      // Direct deduction from accrued interest
      accruedInterest = Math.max(0, accruedInterest - paymentAmount);
    } else {
      // Regular payment (partial/full): pays interest first, then principal
      if (paymentAmount >= accruedInterest) {
        const remainingPayment = paymentAmount - accruedInterest;
        accruedInterest = 0;
        currentPrincipal = Math.max(0, currentPrincipal - remainingPayment);
      } else {
        accruedInterest -= paymentAmount;
      }
    }

    lastCheckpointDate = payDate;
  }

  // Calculate accrued interest from last checkpoint to target date
  const finalDays = getDaysElapsed(lastCheckpointDate, endCalcDate);
  const finalSegmentInterest = currentPrincipal * (rate / 100) * (finalDays / 30);
  accruedInterest += finalSegmentInterest;

  const outstandingBalance = currentPrincipal + accruedInterest;
  const totalDays = getDaysElapsed(new Date(pledgeDate), endCalcDate);

  return {
    originalPrincipal: parseFloat(principal),
    currentPrincipal: Math.round(currentPrincipal * 100) / 100,
    accruedInterest: Math.round(accruedInterest * 100) / 100,
    outstandingBalance: Math.round(outstandingBalance * 100) / 100,
    daysElapsed: totalDays
  };
}

/**
 * Determines running LTV percentage and returns threshold alert status
 * @param {number} outstandingBalance - Current total dues (principal + interest)
 * @param {number} estimatedValue - Estimated market value of gold item
 * @returns {Object} { ltvPercent, alertType: 'none'|'info'|'warning'|'critical', alertLabel }
 */
export function getLtvAlertState(outstandingBalance, estimatedValue) {
  if (!estimatedValue || estimatedValue <= 0) {
    return { ltvPercent: 0, alertType: 'none', alertLabel: 'No Valuation' };
  }

  const ltvPercent = (outstandingBalance / estimatedValue) * 100;

  let alertType = 'none';
  let alertLabel = 'Safe';

  if (ltvPercent >= 90) {
    alertType = 'critical';
    alertLabel = 'Critical (>=90% Value)';
  } else if (ltvPercent >= 75) {
    alertType = 'warning';
    alertLabel = 'Warning (>=75% Value)';
  } else if (ltvPercent >= 50) {
    alertType = 'info';
    alertLabel = 'Notice (>=50% Value)';
  }

  return {
    ltvPercent: Math.round(ltvPercent * 100) / 100,
    alertType,
    alertLabel
  };
}
