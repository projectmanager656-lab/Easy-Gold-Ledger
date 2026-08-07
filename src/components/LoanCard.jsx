import React from 'react';
import { useTranslation } from 'react-i18next';
import { Coins, Gem, ArrowRight } from 'lucide-react';

/* ============================================================
   LOAN CARD KIT — reusable presentational components
   Pure layout. No business logic, no Firebase, no routing.
   ============================================================ */

/* ---- Status badge (36px pill; never wraps/overlaps) ---- */
export function LoanStatusBadge({ status }) {
  const { t } = useTranslation();
  const cls = status === 'open'
    ? 'badge-open'
    : status === 'partially_paid'
      ? 'badge-partial'
      : status === 'paid'
        ? 'badge-paid'
        : status === 'defaulted'
          ? 'badge-defaulted'
          : status === 'closed'
            ? 'badge-closed'
            : 'badge-forfeited';
  const label = status === 'open'
    ? (t('loans.statusOpen') || 'OPEN')
    : status === 'partially_paid'
      ? (t('loans.statusPartiallyPaid') || 'PARTIALLY PAID')
      : status === 'paid'
        ? (t('loans.statusPaid') || 'PAID')
        : status === 'defaulted'
          ? (t('loans.statusDefaulted') || 'DEFAULTED')
          : status === 'closed'
            ? (t('loans.statusClosed') || 'CLOSED')
            : (t('loans.statusForfeited') || 'FORFEITED');
  return <span className={`badge loan-status-badge ${cls}`}>{label}</span>;
}

/* ---- Header: metal icon (48px) | date + ref (one line) | badge top-right ---- */
export function LoanCardHeader({ metalType, date, refId, status }) {
  const isSilver = metalType === 'silver';
  return (
    <div className="loan-card-header">
      <span className={`metal-coin ${isSilver ? 'silver' : ''}`}>
        {isSilver ? <Coins size={22} /> : <Gem size={22} />}
      </span>
      <div className="loan-id-meta">
        <div className="loan-pledge-date">{date}</div>
        <div className="loan-ref">{refId}</div>
      </div>
      <LoanStatusBadge status={status} />
    </div>
  );
}

/* ---- Info grid cell: uppercase 14px label + 24px bold value ---- */
export function LoanInfoRow({ label, value, unit = '', highlight = false }) {
  return (
    <div className="meta-cell">
      <div className="meta-label">{label}</div>
      <div className={`meta-value ${highlight ? 'outstanding' : ''}`}>
        {value}
        {unit ? <span className="meta-unit">{unit}</span> : null}
      </div>
    </div>
  );
}

/* ---- Footer: Row 1 outstanding (label + amount), Row 2 action buttons ---- */
export function LoanCardFooter({
  onView,
  onRecordPayment,
  viewLabel,
  recordPaymentLabel,
  outstandingLabel,
  outstandingValue,
}) {
  return (
    <div className="loan-footer">
      <div className="loan-outstanding">
        <span className="loan-outstanding-label">{outstandingLabel}</span>
        <span className="loan-outstanding-value">{outstandingValue}</span>
      </div>
      <div className="loan-footer-actions">
        <button type="button" className="loan-view-btn" onClick={onView}>
          {viewLabel} <ArrowRight size={14} />
        </button>
        <button type="button" className="loan-pay-btn" onClick={onRecordPayment}>
          {recordPaymentLabel}
        </button>
      </div>
    </div>
  );
}

/* ---- Progress: full-width track + right-aligned percentage ---- */
export function LoanProgressBar({ value, label }) {
  return (
    <div className="loan-progress">
      <div className="loan-progress-track">
        <div className="loan-progress-fill" style={{ width: `${value}%` }} />
      </div>
      <span className="loan-progress-label">{label}</span>
    </div>
  );
}

/* ---- Loan card (420px fixed height, flex column) ---- */
export default function LoanCard({ loan, customerName, outstanding, paidPct, onView, t }) {
  const fmt = (n) => Number(n || 0).toLocaleString('en-IN');
  return (
    <>
      <LoanCardHeader
        metalType={loan.metalType}
        date={loan.pledgeDate}
        refId={loan.id}
        status={loan.status}
      />

      <div className="loan-card-divider" />

      <div className="loan-customer">
        <h4 className="loan-item-name">{loan.itemDescription}</h4>
        <p className="loan-customer-name">
          {t('loans.selectCustomer') || 'Borrower'}: <span>{customerName}</span>
        </p>
      </div>

      <div className="loan-card-divider" />

      <div className="loan-meta">
        <LoanInfoRow
          label={t('loans.weightPurity') || 'Weight & Purity'}
          value={`${loan.weightGrams}g · ${loan.purityKarat}K`}
        />
        <LoanInfoRow
          label={t('loans.loanAmount') || 'Loan Amount'}
          value={loan.loanAmount ? `₹${fmt(loan.loanAmount)}` : '—'}
        />
        <LoanInfoRow
          label={t('loans.outstanding') || 'Outstanding'}
          value={`₹${fmt(outstanding)}`}
          highlight
        />
        <LoanInfoRow
          label={t('loans.interestRate') || 'Interest'}
          value={loan.interestRate != null ? `${loan.interestRate}%` : '—'}
          unit={loan.interestRate != null ? '/mo' : ''}
        />
      </div>

      <div className="loan-card-divider" />

      <LoanCardFooter
        viewLabel={t('loans.viewDetails') || 'View Details'}
        onView={(e) => { e.stopPropagation(); onView(); }}
        recordPaymentLabel={t('loans.addPayment') || 'Record Payment'}
        onRecordPayment={(e) => { e.stopPropagation(); onView(); }}
        outstandingLabel={t('loans.outstanding') || 'Outstanding'}
        outstandingValue={`₹${fmt(outstanding)}`}
      />

      <LoanProgressBar
        value={paidPct}
        label={`${paidPct}% ${t('loans.repaid') || 'repaid'}`}
      />
    </>
  );
}
