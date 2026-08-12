# Easy Gold Ledger — Premium Gold Loan Management System

A modern **Gold Loan Management System** built with **React + Vite + Firebase** for managing customers, gold pledges, repayments, live gold rates, reports, staff accounts, and security audit logs.

---

## Features

### Dashboard

* Live **24K / 22K / 18K Gold Rates**
* Live **Silver Rate**
* Active loan statistics
* Outstanding principal overview
* Daily activity timeline
* Risk threshold alerts
* Quick action shortcuts

### Customer Management

* Add / edit customers
* Face verification & KYC support
* Profile photo upload
* Address & contact management
* Customer loan history
* Activity timeline

### Gold Loan Management

* Create new gold loans
* Support for **Gold & Silver pledges**
* Weight & purity tracking
* Automatic LTV calculations
* Outstanding balance tracking
* Loan status management:

  * Open
  * Partially Paid
  * Returned / Closed
  * Sold / Forfeited

### Partial Repayment System

* Record partial payments
* Remaining principal auto-calculation
* Repayment history ledger
* Interest & principal split tracking
* Automatic loan closure when fully paid

### Live Market Integration

* Auto-refreshing gold & silver prices
* Retail price conversion support
* Cached API responses
* Offline fallback handling
* Background synchronization

### Reports & Analytics

* Daily ledger
* Monthly statement
* Yearly accounts
* Custom date range reports
* PDF export support
* Outstanding & recovery reports

### Staff & Admin

* Role-based staff accounts
* Super Admin / Employee roles
* Account activation & deactivation
* Staff activity management

### Security Audit Trail

* Tamper-proof activity logging
* Loan creation logs
* Payment recording logs
* Status change tracking
* User management audit records

---

## Tech Stack

| Technology                  | Purpose              |
| --------------------------- | -------------------- |
| **React 18**                | Frontend framework   |
| **Vite**                    | Build tool           |
| **Tailwind CSS**            | Styling              |
| **Framer Motion**           | Animations           |
| **Firebase Authentication** | User authentication  |
| **Cloud Firestore**         | Database             |
| **Firebase Storage**        | File & image storage |
| **Recharts**                | Charts & analytics   |
| **Lucide React**            | Icons                |
| **jsPDF / html2canvas**     | PDF generation       |

---

## Project Structure

```text
easy-gold-ledger/
├── public/
├── src/
│   ├── assets/
│   ├── components/
│   │   ├── ui/
│   │   ├── layout/
│   │   └── common/
│   ├── hooks/
│   │   └── useLiveGoldRates.js
│   ├── locales/
│   ├── pages/
│   │   ├── Dashboard.jsx
│   │   ├── CustomerManagement.jsx
│   │   ├── CustomerDetail.jsx
│   │   ├── CustomerProfile.jsx
│   │   ├── LoanManagement.jsx
│   │   ├── LoanDetails.jsx
│   │   ├── GoldRate.jsx
│   │   ├── Reports.jsx
│   │   ├── StaffManagement.jsx
│   │   ├── AuditLogs.jsx
│   │   ├── Notifications.jsx
│   │   └── Login.jsx
│   ├── services/
│   │   ├── firebase.js
│   │   ├── goldRateService.js
│   │   └── paymentService.js
│   ├── utils/
│   ├── App.jsx
│   └── main.jsx
├── .env
├── package.json
├── vite.config.js
└── README.md
```
---

## Installation

### 1. Clone the repository

```bash
git clone https://github.com/your-username/easy-gold-ledger.git
cd easy-gold-ledger
```

### 2. Install dependencies

```bash
npm install
```

### 3. Configure environment variables

Add your Firebase and Gold API credentials to `.env`.

### 4. Start development server

```bash
npm run dev
```

The app will run at:

```text
http://localhost:5173
```

---

## Available Scripts

```bash
npm run dev       # Start development server
npm run build     # Build for production
npm run preview   # Preview production build
npm run lint      # Run ESLint
```

---

## Live Gold Price Flow

```text
Gold API
    ↓
goldRateService.js
    ↓
useLiveGoldRates()
    ↓
Dashboard / Loans / Reports / GoldRate Page
```

### Auto Refresh

* Refreshes every **60 seconds**
* Refreshes when browser tab becomes active
* Refreshes after internet reconnects
* Uses **localStorage cache** for faster loading

---

## Loan Lifecycle

```text
Customer Registered
        ↓
Gold Pledged
        ↓
Loan Issued
        ↓
Payments Recorded
        ↓
Outstanding Updated
        ↓
Loan Fully Repaid
        ↓
Returned / Closed
```

---

## UI Design System

### Theme

* **Background:** `#090909`
* **Card:** `rgba(20,20,25,.75)`
* **Primary Gold:** `#F7C948`
* **Accent:** `#FFC107`

### Typography

* **Headings:** Playfair Display
* **Body:** Inter

### Components

* Glassmorphism cards
* Soft 3D shadows
* Animated status badges
* Responsive data tables
* Floating action buttons
* Skeleton loading states

---

## Responsive Support

| Device  | Supported |
| ------- | --------- |
| Desktop | ✓         |
| Laptop  | ✓         |
| Tablet  | ✓         |
| Mobile  | ✓         |

---

## Security Features

* Firebase Authentication
* Role-based access control
* Audit logging
* Input validation
* Protected admin routes
* Secure environment variables
* Cached API fallback
* Duplicate payment prevention

---

## Sample Screens

### Dashboard

* Live market rates
* Portfolio overview
* Risk alerts
* Activity summary

### Loans

* Loan cards
* Status tracking
* Repayment progress
* Outstanding balance

### Customer Profile

* KYC details
* Face verification
* Loan history
* Contact information

### Reports

* Financial analytics
* Exportable PDF statements
* Recovery reports
* Outstanding summaries

---

## Deployment

### Build

```bash
npm run build
```

### Deploy to Firebase Hosting

```bash
npm install -g firebase-tools
firebase login
firebase init hosting
firebase deploy
```

### Deploy to Vercel

```bash
npm install -g vercel
vercel
```

### Deploy to Netlify

```bash
npm run build
# Upload the dist/ folder
```

---

## Recommended Production Setup

For public deployment:

```text
Frontend (React)
        ↓
Firebase Cloud Function
        ↓
Gold Price API
```

This keeps your **Gold API key secure** and prevents client-side exposure.

---

## Future Enhancements

* SMS / WhatsApp notifications
* EMI schedule generation
* Loan renewal & extension
* QR-based payment receipts
* Multi-branch support
* GST invoice generation
* Backup & restore
* Advanced analytics dashboard
* Biometric customer verification
* Cloud Function scheduled reports


## License

This project is licensed under the **MIT License**.

---

## Acknowledgements

Special thanks to:

* **React**
* **Vite**
* **Firebase**
* **Tailwind CSS**
* **Framer Motion**
* **Recharts**
* **Lucide React**

---

## Project Status

**Current Version:** `v1.0.0`

### Completed

* Customer Management
* Loan Management
* Partial Repayment System
* Live Gold Rate Integration
* Reports & Analytics
* Staff Management
* Security Audit Trail
* PDF Export
* Responsive Premium UI

### In Progress

* SMS Notifications
* Loan Renewal Workflow
* Advanced Analytics



**Easy Gold Ledger — Secure, modern and production-ready Gold Loan Management for NBFCs, banks and jewellery finance businesses.**
