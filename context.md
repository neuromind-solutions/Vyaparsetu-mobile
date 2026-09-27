# VyaparSetu (व्यापारसेतू) — Complete System Context & Architecture Knowledge Base

> **Authoritative Reference Document**
> This file captures the complete end-to-end knowledge, architecture, data schemas, business rules, file-by-file code maps, runtime invariants, and platform integrations of the VyaparSetu codebase.
> Refer directly to this file for any future modifications, refactoring, feature additions, or mobile porting without needing to re-scan the entire codebase.

---

## Table of Contents
1. [Product Overview & Business Domain](#1-product-overview--business-domain)
2. [High-Level Architecture & Runtime Model](#2-high-level-architecture--runtime-model)
3. [Filesystem & Per-User Data Layout](#3-filesystem--per-user-data-layout)
4. [Database & Persistence Subsystem](#4-database--persistence-subsystem)
5. [Critical Invariants & Domain Seams](#5-critical-invariants--domain-seams)
   - [5.1 The Money Seam (Paise vs. Rupees)](#51-the-money-seam-paise-vs-rupees)
   - [5.2 The Date & Time Seam (UTC vs. Local Business Date)](#52-the-date--time-seam-utc-vs-local-business-date)
   - [5.3 The Credit / Udhar Ledger Seam](#53-the-credit--udhar-ledger-seam)
   - [5.4 Transaction Entry vs. Bill Consolidation Lifecycle](#54-transaction-entry-vs-bill-consolidation-lifecycle)
   - [5.5 Inventory / Stock Reality Check](#55-inventory--stock-reality-check)
6. [Backend Codebase Map (File-by-File)](#6-backend-codebase-map-file-by-file)
   - [6.1 Server & Entry Points](#61-server--entry-points)
   - [6.2 Database Layer](#62-database-layer)
   - [6.3 Models Layer](#63-models-layer)
   - [6.4 Services Layer](#64-services-layer)
   - [6.5 Controllers & Routes](#65-controllers--routes)
   - [6.6 Middleware & Utilities](#66-middleware--utilities)
7. [Frontend Codebase Map (File-by-File)](#7-frontend-codebase-map-file-by-file)
   - [7.1 Architecture & Setup](#71-architecture--setup)
   - [7.2 Layouts & Navigation](#72-layouts--navigation)
   - [7.3 Pages](#73-pages)
   - [7.4 Components](#74-components)
   - [7.5 Services, Contexts & Hooks](#75-services-contexts--hooks)
   - [7.6 Marathi Phonetic Transliteration Engine](#76-marathi-phonetic-transliteration-engine)
8. [Platform Integrations & Native Shell](#8-platform-integrations--native-shell)
   - [8.1 Electron Main Process & Preload](#81-electron-main-process--preload)
   - [8.2 WhatsApp PDF Automation](#82-whatsapp-pdf-automation)
   - [8.3 Thermal Receipt Printing](#83-thermal-receipt-printing)
   - [8.4 Google Drive Cloud Backup](#84-google-drive-cloud-backup)
   - [8.5 Machine-Bound Desktop Licensing](#85-machine-bound-desktop-licensing)
9. [Tools & Utility Scripts](#9-tools--utility-scripts)
10. [Mobile Architecture & Standalone Android Application (Capacitor)](#10-mobile-architecture--standalone-android-application-capacitor)
    - [10.1 Architecture & Runtime Modes](#101-architecture--runtime-modes)
    - [10.2 Android Native Shell & Bridge (MainActivity.java, PrintBridge, Permissions)](#102-android-native-shell--bridge-mainactivityjava-printbridge-permissions)
    - [10.3 Offline-First Data Subsystem (Dexie.js / IndexedDB & offlineRepository.js)](#103-offline-first-data-subsystem-dexiejs--indexeddb--offlinerepositoryjs)
    - [10.4 Persistent Device Identity & Mobile Licensing (@capacitor/preferences)](#104-persistent-device-identity--mobile-licensing-capacitorpreferences)
    - [10.5 Native WhatsApp PDF Sharing Engine (@capacitor/filesystem + @capacitor/share)](#105-native-whatsapp-pdf-sharing-engine-capacitorfilesystem--capacitorshare)
    - [10.6 Automated Local Continuous Backups (mobileBackupService.js)](#106-automated-local-continuous-backups-mobilebackupservicejs)
    - [10.7 Supabase Cloud Bidirectional Sync (cloudSyncService.js)](#107-supabase-cloud-bidirectional-sync-cloudsyncservicejs)
11. [Build, Compilation & Development Guide (Step-by-Step for AI & Developers)](#11-build-compilation--development-guide-step-by-step-for-ai--developers)
    - [11.1 Prerequisites & System Setup](#111-prerequisites--system-setup)
    - [11.2 Running Locally (Desktop & Web)](#112-running-locally-desktop--web)
    - [11.3 Compiling & Building the Android APK (CLI & Android Studio)](#113-compiling--building-the-android-apk-cli--android-studio)
    - [11.4 Environment Variables & Network Configuration](#114-environment-variables--network-configuration)
    - [11.5 Common Pitfalls & Troubleshooting](#115-common-pitfalls--troubleshooting)
12. [AI Agent Implementation Guardrails & Conventions](#12-ai-agent-implementation-guardrails--conventions)

---

## 1. Product Overview & Business Domain

**VyaparSetu** is an offline-first, bilingual (Marathi & English) desktop business management system designed specifically for **APMC (Agricultural Produce Market Committee) vegetable market commission agents (आडत्या / Dalal / Traders)** in Maharashtra, India.

### Business Realities in APMC Markets:
- **Early Morning Trading (04:00 AM onwards):** Farmers deliver fresh produce to the commission agent's stall (गाळा / Gala). Retail vendors and buyers purchase produce in high-speed, noisy morning auctions and direct sales.
- **Fast Transaction Entry:** Traders must enter dozens of sales within minutes (Customer + Vegetable + Weight in kg/crates + Rate + Payment mode).
- **APMC Commission Structure:** In Maharashtra APMC markets, the agent charges a percentage commission (default **8%**, or custom per customer, e.g. 7%). The commission is calculated on the base sale value (`weight * rate`).
- **Hamali & Transport:** Additional market levies like Hamali (porterage / unloading charges) and transport costs can be added to consolidated bills.
- **Udhar (Credit) Culture:** High volume of sales occur on credit (उधार). Customers pay days or weeks later via Cash, UPI, or Bank. A bulletproof credit passbook (खातेवही / Ledger) with real-time balance tracking is critical.
- **Consolidation (पक्के बिल):** Daily raw sales entries are recorded during morning rush hours without creating formal invoices immediately. At the end of the day (or end of the week/month), pending entries are consolidated into formal bills (bills / invoices).

---

## 2. High-Level Architecture & Runtime Model

### Single-Process Electron Model (Desktop):
```text
+-------------------------------------------------------------------------------+
| ELECTRON DESKTOP WRAPPER (electron/main.js)                                   |
|                                                                               |
|   +------------------------------------+   HTTP (127.0.0.1:5000)              |
|   | CHROMIUM BROWSER WINDOW            | <========================+           |
|   |  - React 18 SPA (frontend/dist)    |                          |           |
|   |  - Preload bridge (window.electron)|                          |           |
|   +------------------------------------+                          |           |
|                     | IPC (share-whatsapp, select-folder)         |           |
|                     v                                             v           |
|   +------------------------------------+        +---------------------------+ |
|   | MAIN PROCESS HANDLERS              |        | IN-PROCESS EXPRESS SERVER | |
|   |  - PowerShell WhatsApp Automation  |        |  (backend/server.js)      | |
|   |  - Native Folder Picker Dialog     |        |  - API Endpoints (/api)   | |
|   |  - Auto-Backup Poller (15s/60s)    |        |  - Static File Server     | |
|   +------------------------------------+        +---------------------------+ |
|                                                               |               |
|                                                               v               |
|                                                 +---------------------------+ |
|                                                 | better-sqlite3 (WAL Mode) | |
|                                                 | %APPDATA%/VyapaarSetu/    | |
|                                                 | data/vyapaarsetu.db       | |
|                                                 +---------------------------+ |
+-------------------------------------------------------------------------------+
```

- **Loopback Binding:** The Express server binds strictly to `127.0.0.1`.
- **Port Escalation Ladder:** Port candidate ladder: `[5000, 47821, 47822, 47823, 47824, 47825]`. If 5000 is occupied, it uses a high port and spawns a lightweight forwarder on 5000 for Google OAuth callback redirects (`/api/drive/callback`).
- **Single Instance Lock:** `app.requestSingleInstanceLock()` ensures a second launch focuses the running window rather than starting duplicate database processes.
- **Hardware Acceleration Disabled:** `app.disableHardwareAcceleration()` prevents blank white-screen issues on low-end shop PCs with budget GPUs.

---

## 3. Filesystem & Per-User Data Layout

Because Windows installs programs in read-only directories (`C:\Program Files`), all mutable data is directed to Windows User AppData (`app.getPath('userData')` -> `C:\Users\<User>\AppData\Roaming\VyapaarSetu`):

| Path / File | Purpose |
|---|---|
| `<userData>/data/vyapaarsetu.db` | Primary SQLite database file (WAL mode active). |
| `<userData>/data/vyapaarsetu.db-wal` | Write-Ahead Log journal file. |
| `<userData>/data/vyapaarsetu.db-shm` | Shared memory index for WAL. |
| `<userData>/backups/` | Automated and manual local `.db` backup snapshots. |
| `<userData>/license.json` | Active machine-bound license key & activation timestamp. Stored outside DB so DB restore never wipes license. |
| `<userData>/drive_tokens.json` | OAuth2 Google Drive tokens. Stored outside DB so DB restore never breaks cloud credentials. |
| `<userData>/logs/main.log` | Unified log file containing both Electron and backend logs. |

---

## 4. Database & Persistence Subsystem

### 4.1 Database Engine: `better-sqlite3`
- **Library:** `better-sqlite3` (v13.0.3).
- **Execution:** Completely synchronous, compiled C++ binding directly operating on disk.
- **Pragmas applied on connect (`backend/database/db.js`):**
  - `PRAGMA journal_mode = WAL;` (Concurrent readers without blocking writers; crash resilience).
  - `PRAGMA synchronous = NORMAL;` (Safe under WAL; avoids redundant disk flushes per transaction).
  - `PRAGMA foreign_keys = ON;` (Strict referential integrity).
  - `PRAGMA busy_timeout = 5000;` (Waits up to 5 seconds on file lock before raising busy error).
- **Transactions:** Nested transaction manager (`backend/database/db.js:transaction(fn)`) using depth tracking (`txDepth`). Inner calls join the outer transaction; rollback occurs on any thrown exception.
- **Note on `sql.js`:** `sql.js` was the legacy WASM in-memory engine. It was fully migrated away in production; it is retained in `package.json` ONLY for legacy fixture verification tests (`backend/tests/helpers/testDb.js`).

### 4.2 Database Schema Overview

```text
               +-------------------+
               |     settings      |
               +-------------------+
               | id (PK)           |
               | key (TEXT UNIQUE) |
               | value (TEXT)      |
               | updated_at        |
               +-------------------+

+-------------------------------------+         +------------------------------------+
|              customers              |         |             vegetables             |
+-------------------------------------+         +------------------------------------+
| id (PK AUTOINCREMENT)               |         | id (PK AUTOINCREMENT)              |
| name (TEXT)                         |         | name (TEXT UNIQUE)                 |
| mobile (TEXT UNIQUE if non-empty)   |         | rate (INTEGER paise)               |
| address (TEXT)                      |         | unit (TEXT 'kg','piece','crate')   |
| search_keywords (TEXT)              |         | category (TEXT)                    |
| notes (TEXT)                        |         | search_keywords (TEXT)             |
| credit_balance (INTEGER paise)      |         | is_deleted (0/1)                   |
| commission_rate (REAL, NULL=shop)   |         | created_at, updated_at             |
| is_deleted (0/1)                    |         +------------------------------------+
| created_at, updated_at              |                           |
+-------------------------------------+                           |
        |                      |                                  |
        |                      +----------------+                 |
        v                                       v                 v
+-------------------------------------+   +------------------------------------------+
|                bills                |   |               transactions               |
+-------------------------------------+   +------------------------------------------+
| id (PK AUTOINCREMENT)               |   | id (PK AUTOINCREMENT)                    |
| bill_number (TEXT UNIQUE)           |   | customer_id (FK -> customers.id)         |
| customer_id (FK -> customers.id)    |   | vegetable_id (FK -> vegetables.id)       |
| date (TEXT YYYY-MM-DD)              |   | vegetable_name_snapshot (TEXT)           |
| period_start, period_end (TEXT)     |   | weight (REAL)                            |
| subtotal (INTEGER paise)            |   | unit (TEXT)                              |
| discount_type ('fixed'/'percent')   |   | rate (INTEGER paise)                     |
| discount_value (REAL)               |   | base_amount (INTEGER paise)              |
| discount_amount (INTEGER paise)     |   | commission_rate (REAL percentage)        |
| commission_rate (REAL percentage)   |   | commission_amount (INTEGER paise)        |
| commission_amount (INTEGER paise)   |   | final_amount (INTEGER paise)             |
| hamali_amount (INTEGER paise)       |   | payment_type ('Credit','Paid','Partial') |
| transport_amount (INTEGER paise)    |   | payment_mode ('Cash','UPI','Credit')     |
| final_amount (INTEGER paise)        |   | paid_amount (INTEGER paise)              |
| paid_amount (INTEGER paise)         |   | remaining_amount (INTEGER paise)         |
| remaining_amount (INTEGER paise)    |   | transaction_date (TEXT YYYY-MM-DD)       |
| payment_type ('Credit','Cash')      |   | bill_id (FK -> bills.id, NULL if unbilled|
| payment_status ('Paid','Partial'..) |   | created_at, updated_at                   |
| created_at, updated_at              |   +------------------------------------------+
+-------------------------------------+                         |
        |                      |                                |
        v                      |                                |
+----------------------------+ |                                |
|         bill_items         | |                                |
+----------------------------+ |                                |
| id (PK AUTOINCREMENT)      | |                                |
| bill_id (FK -> bills.id)   | |                                |
| vegetable_id (FK)          | |                                |
| vegetable_name (TEXT)      | |                                |
| quantity (REAL kg/unit)    | |                                |
| rate (INTEGER paise)       | |                                |
| total (INTEGER paise)      | |                                |
| item_date (TEXT)           | |                                |
| created_at                 | |                                |
+----------------------------+ |                                |
                               v                                v
               +------------------------------------------------+
               |              credit_transactions               |
               +------------------------------------------------+
               | id (PK AUTOINCREMENT)                          |
               | customer_id (FK -> customers.id)               |
               | bill_id (FK -> bills.id, NULLABLE)             |
               | transaction_id (FK -> transactions.id, NULL)   |
               | transaction_type (CREDIT_ADDED,                |
               |   PAYMENT_RECEIVED, DISCOUNT,                  |
               |   CREDIT_ADJUSTMENT, OPENING_BALANCE)          |
               | amount (INTEGER paise)                         |
               | payment_mode (Cash, UPI, Cheque, Other)        |
               | note (TEXT)                                    |
               | balance_after_transaction (INTEGER paise)      |
               | created_at (DATETIME UTC)                      |
               +------------------------------------------------+
```

### 4.3 Full Migration History (v1 to v15)
Recorded in table `schema_version`:
1. `v1: baseline` — Initial table creation.
2. `v2: bills-add-missing-money-columns` — Added `subtotal`, `discount_*`, `commission_*`, `hamali`, `transport`, `paid_amount`, `remaining_amount`.
3. `v3: transactions-add-payment-columns` — Added payment tracking to individual daily sales rows.
4. `v4: add-soft-delete-flags` — Added `is_deleted` column to `customers` and `vegetables`.
5. `v5: transactions-commission-rate-as-percentage` — Fixed fraction vs percentage bug (normalized 0.08 to 8.0).
6. `v6: link-ledger-rows-to-transactions` — Added `transaction_id` to `credit_transactions` so deleting a transaction reverses exact credit booked.
7. `v7: mark-transactions-consolidated-into-a-bill` — Added `bill_id` to `transactions` table.
8. `v8: money-columns-as-integer-paise` — Core financial conversion: Rebuilt all financial tables converting REAL rupees to INTEGER paise (`rupees * 100`).
9. `v9: bills-over-a-date-range` — Added `period_start`, `period_end` to `bills` and `item_date` to `bill_items`.
10. `v10: vegetables-add-category-column` — Added `category` to `vegetables` table.
11. `v11: customers-optional-mobile-number` — Made customer mobile optional and added unique partial index on non-empty mobile numbers (`WHERE mobile IS NOT NULL AND mobile != '' AND is_deleted = 0`).
12. `v12: reconcile-and-sync-bill-transactions` — Healed orphan transactions and reconciled ledger vs customer credit balances.
13. `v13: customers-add-search-keywords` — Added `search_keywords` to `customers`.
14. `v14: reconcile-uncredited-bills-and-corrupted-ledger` — Fixed missing `CREDIT_ADDED` rows from edited bills; recomputed chronological `balance_after_transaction`.
15. `v15: customer_commission_rate_and_reconciliation` — Added `commission_rate` column to `customers` (allows per-customer commission discount, e.g. 7%).

---

## 5. Critical Invariants & Domain Seams

### 5.1 The Money Seam (Paise vs. Rupees)
- **Problem:** JavaScript IEEE-754 floating point floats drift over thousands of additions (e.g. `0.1 + 0.2 !== 0.3`).
- **Solution (`backend/utils/money.js`):**
  - **In SQLite Database:** Stored as `INTEGER` representing **whole paise** (₹1 = 100 paise).
  - **In Application / API / UI:** Represented as standard **decimal Rupees**.
  - `toPaise(rupees)` = `Math.round(Number(rupees) * 100)`
  - `toRupees(paise)` = `Number(paise) / 100`
  - `MONEY_FIELDS`: Explicit map of which columns in each table represent currency.
  - Conversions only happen at the perimeter (model queries reading from/writing to SQLite). Non-monetary numbers (`weight`, `commission_rate`, `discount_value`) are **never** multiplied by 100.

### 5.2 The Date & Time Seam (UTC vs. Local Business Date)
- **Problem:** APMC vegetable markets open at **04:00 AM IST**.
- SQLite `CURRENT_TIMESTAMP` stores timestamps in **UTC**.
- At 04:00 AM IST on August 27, UTC time is `2026-08-26 22:30`.
- If queries used `date(created_at)`, all transactions between 04:00 AM and 05:30 AM IST would fall on the *previous day's* ledger.
- **Solution (`backend/utils/businessDay.js`):**
  - `localDateSql(col)` yields `date(col, 'localtime')` which forces SQLite to convert UTC to the host machine's timezone before comparing dates.
  - `todayLocal()` returns `YYYY-MM-DD` based on local getters (`getFullYear()`, `getMonth()`, `getDate()`), never `toISOString().slice(0, 10)`.
  - Date-only fields (`bills.date`, `transactions.transaction_date`, `bills.period_start/end`, `bill_items.item_date`) are stored as plain local date strings (`YYYY-MM-DD`) and must **never** be passed through `localtime`.

### 5.3 The Credit / Udhar Ledger Seam
- **The Ledger Formula:** A customer's `credit_balance` must **identically equal** the replay sum of all their `credit_transactions`:
  $$\text{credit\_balance} = \sum (\text{signedAmount}(\text{transaction\_type}, \text{amount}))$$
- **Sign Rules (`backend/utils/creditLedger.js`):**
  - `CREDIT_ADDED`: $+1$ (Goods sold on credit; increases debt).
  - `PAYMENT_RECEIVED`: $-1$ (Customer paid cash/UPI; decreases debt).
  - `DISCOUNT`: $-1$ (Waived debt / concession; decreases debt).
  - `CREDIT_ADJUSTMENT`: $+1$ (Signed amount: positive = penalty/increase; negative = write-off/decrease).
  - `OPENING_BALANCE`: $+1$ (Initial legacy debt brought forward from paper notebook).
- Running balance (`balance_after_transaction`) is stored on each ledger row for printing passbooks, but `customers.credit_balance` can always be verified and recomputed from first principles.

### 5.4 Transaction Entry vs. Bill Consolidation Lifecycle
There are **two ways** sales exist in the system:
1. **Direct Bill Creation (`BillingPage`):** A vendor creates an immediate Bill with multiple line items. If unpaid, this books credit immediately in `credit_transactions` and updates `customers.credit_balance`.
2. **Fast Transaction Flow (`TransactionsPage` / `CustomerDailyPurchase`):**
   - Individual sales rows are entered in `transactions` with `bill_id = NULL`.
   - If unpaid/partial, credit is booked in `credit_transactions` with `transaction_id = transactions.id`.
   - **Consolidation (`generateBillFromTransactions`):**
     - Collects all unbilled transactions for a customer on a date or range (`WHERE bill_id IS NULL`).
     - Sums base amounts, commission, and payments.
     - Creates a master row in `bills` and child rows in `bill_items`.
     - Calls `transactionModel.markAsBilled(ids, bill.id)` to attach `bill_id`.
     - Updates existing `credit_transactions` to set `bill_id = bill.id` (does **not** add duplicate credit!).
     - *Verified repository finding:* `markAsBilled` in `transactionModel.js` does `UPDATE transactions SET bill_id = ? WHERE id IN (...)`. It currently lacks `AND bill_id IS NULL` in the SQL `WHERE` clause—a critical item documented for the multi-device/sync plan.

### 5.5 Inventory / Stock Reality Check
- **Crucial Finding:** VyaparSetu **DOES NOT** have an inventory tracking or stock ledger subsystem.
- The `vegetables` table is simply a **price and commodity catalog** (`name`, `rate`, `unit`, `category`).
- There are no stock quantity balances, no goods receiving/GRN, no purchase orders, no inventory movement logs, and no warehouse tracking.
- Commission agents do not own produce—farmers bring it in the morning, agents auction/sell it on commission, and it is cleared out the same morning.
- Therefore, in the mobile/cloud architecture, **inventory synchronization is NOT APPLICABLE** to the current domain model.

---

## 6. Backend Codebase Map (File-by-File)

### 6.1 Server & Entry Points
- `backend/server.js`: Express server setup, CORS restriction to loopbacks, body parsers, `/api/license` mounting ahead of `licenseGuard`, SPA static serving, port fallback binding, and startup auto-bill trigger.
- `backend/package.json`: Dependencies (`better-sqlite3`, `express`, `cors`, `dotenv`, `googleapis`, `sql.js`).

### 6.2 Database Layer (`backend/database/`)
- `db.js`: Initializes `better-sqlite3`, applies WAL and pragmas, manages statement cache, exports `execSelect`, `execGet`, `execRun`, `transaction()`, `reloadDb()`, `backupTo()`, `checkpoint()`.
- `init.js`: `createBaselineSchema()`, `seedSettings()` (default shop configurations, commission rate, categories, backup settings), `createChangeTrackingTriggers()` (sets `db_dirty = '1'` and `last_data_change` on any data write).
- `migrations.js`: Ordered migrations 1 to 15, `runMigrations()`, schema version tracker.

### 6.3 Models Layer (`backend/models/`)
- `customerModel.js`: CRUD for customers, phone search, duplicate checking, `getLedger()`, soft delete.
- `vegetableModel.js`: CRUD for vegetables, search with phonetic keywords, soft delete.
- `transactionModel.js`: CRUD for sales entries, `findUnbilledByCustomerAndDate`, `findPendingSettlements`, `markAsBilled`, `clearBillLink`.
- `billModel.js`: CRUD for bills, auto-number generation (`BILL-YYYYMMDD-XXXX`), line items insertion, payment allocation, recalculation.
- `billItemModel.js`: Inserts and reads line items for bills.
- `creditModel.js`: Records payments, adjustments, opening balances, ledger queries, customer balance recalculation.
- `reportModel.js`: Daily sales, date range sales, customer-wise and vegetable-wise reports, commission reports, all-in-one summary.
- `settingsModel.js`: Key-value configuration retrieval and updates.

### 6.4 Services Layer (`backend/services/`)
- `transactionService.js`: Business rules for creating/editing transactions, calculating commission, managing udhar on individual entries, `generateBillFromTransactions()`, `autoBillPastTransactions()`.
- `billService.js`: Creating bills, updating bills, deleting bills (reversing credit properly).
- `creditService.js`: Receiving payments, recording discounts, adding credit adjustments, recording opening balance.
- `customerService.js`: Validating and creating customers, bulk Excel import.
- `vegetableService.js`: Validating and managing vegetables, catalog import.
- `backupService.js`: Local SQLite file backups using `backupTo()`, listing backups, zip-based backup management, restore validation with integrity checks.
- `googleDriveBackupService.js`: OAuth 2.0 flow, token storage, change-driven automatic cloud sync, uploading `vyapaarsetu_backup.db` to `VyapaarSetu_Backups` folder on Google Drive, downloading and restoring cloud backups.
- `licenseService.js`: Ed25519 asymmetric signature verification, Windows `MachineGuid` registry query, `isActivated()`, machine activation.
- `reportService.js`: Aggregates business data for reports.
- `dashboardService.js`: Today's sales, pending udhar, top selling vegetables, transaction counts.
- `healthService.js`: System health and uptime diagnostics.
- `settingsService.js`: Manages shop profile, printer settings, backup configs.

### 6.5 Controllers & Routes
- Routes map:
  - `/api/health` -> `healthRoutes.js` -> `healthController.js`
  - `/api/license` -> `licenseRoutes.js` -> `licenseController.js` (unlocked)
  - `/api/customers` -> `customerRoutes.js` -> `customerController.js`
  - `/api/vegetables` -> `vegetableRoutes.js` -> `vegetableController.js`
  - `/api/transactions` -> `transactionRoutes.js` -> `transactionController.js`
  - `/api/bills` -> `billRoutes.js` -> `billController.js`
  - `/api/credit` -> `creditRoutes.js` -> `creditController.js`
  - `/api/reports` -> `reportRoutes.js` -> `reportController.js`
  - `/api/backup` -> `backupRoutes.js` -> `backupController.js`
  - `/api/drive` -> `googleDriveRoutes.js` -> `googleDriveController.js`
  - `/api/dashboard` -> `dashboardRoutes.js` -> `dashboardController.js`
  - `/api/settings` -> `settingsRoutes.js` -> `settingsController.js`
  - `/api/client-log` -> `clientLogRoutes.js` -> `clientLogController.js`

### 6.6 Middleware & Utilities
- `errorHandler.js`: Formats errors cleanly as `{ success: false, error: { message, code } }`.
- `requestLogger.js`: Logs API requests with method, path, status, and duration.
- `businessDay.js`: Date conversion utilities (`localDateSql`, `todayLocal`).
- `money.js`: Paise integer conversions (`toPaise`, `toRupees`, `rowToPaise`, `rowToRupees`).
- `creditLedger.js`: Ledger sign rules and SQL generator (`signedAmountSql`, `replay`).
- `calculation.js`: Commission and transaction total math.
- `billingCalc.js`: Bill total, commission, and discount calculations.
- `logger.js`: Writes formatted logs to console and `<userData>/logs/main.log`.

---

## 7. Frontend Codebase Map (File-by-File)

### 7.1 Architecture & Setup
- **Framework:** React 18 with Vite.
- **Routing:** `react-router-dom` v6 (`BrowserRouter`).
- **Styling:** Custom CSS design system in `frontend/src/styles/globals.css`.
- **Icons:** SVG icon set in `frontend/src/components/Icons.jsx`.
- **Error Handling:** `ErrorBoundary.jsx` and `ActivationGate.jsx` (blocks UI if license is not active).

### 7.2 Layouts & Navigation
- `MainLayout.jsx`: Master layout wrapper with header, sidebar, main view container, and global shortcuts handler.
- `Sidebar.jsx`: Navigation menu with routes: Dashboard, Billing, Transactions, Day Book, Udhar, Customers, Vegetables, Reports, Backup, Settings. Shows pending dirty backup badge.
- `Topbar.jsx`: Shows shop name, active business date, language switcher (मराठी / English), transliteration toggle, internet status, and license status.

### 7.3 Pages (`frontend/src/pages/`)
1. `DashboardPage.jsx`: Real-time morning summary (Today's Total Sales, Cash Collected, Today's Udhar, Total Outstanding Udhar, Quick Action buttons, Recent Transactions).
2. `BillingPage.jsx`: Direct bill creation screen with line item table, discount/commission adjustments, customer selection, print receipt modal, and WhatsApp share trigger.
3. `TransactionsPage.jsx`: High-speed transaction entry page with `TransactionEntry` widget, `PendingSettlements` widget (unbilled entries grouped by customer), date filtering, and one-click bill generation.
4. `DayBookPage.jsx`: Daily sales register showing all entries for a specific date, payment modes, and totals.
5. `UdharPage.jsx`: Customer credit management dashboard showing total market credit, searchable customer ledger list, payment collection modal, discount recording, and ledger statement export.
6. `CustomersPage.jsx`: Customer directory with phone numbers, credit balances, search, modal for add/edit, and bulk Excel import.
7. `VegetablesPage.jsx`: Vegetable catalog with current rates, units (kg, dozen, crate), category filters, and bulk catalog import.
8. `ReportsPage.jsx`: Comprehensive business reports (Daily Sales, Range Sales, Customer-wise Sales, Vegetable-wise Sales, Credit Report, Commission Report, All-in-one). Exports to Excel.
9. `BackupPage.jsx`: Local backups (Create Backup, List Backups, Restore) and Google Drive Cloud Sync management (Connect Google Account, Auto-Sync toggle, Sync Now, Cloud Restore).
10. `SettingsPage.jsx`: Shop profile (Vendor name, Gala number, APMC Market name, contact info), default commission rate (8%), printer receipt format settings, Google OAuth credentials configuration.

### 7.4 Key Components (`frontend/src/components/`)
- `CustomerAutocomplete.jsx` & `VegetableAutocomplete.jsx`: High-speed keyboard-navigable comboboxes with Marathi transliteration support and auto-dropdown.
- `TransactionEntry.jsx`: The workhorse entry form for fast market transactions (Customer, Vegetable, Weight, Rate, Commission, Cash/Credit).
- `PendingSettlements.jsx`: Displays customers with unbilled morning entries and provides the "बिलात रूपांतर करा" (Generate Bill) action.
- `ReceiptPrint.jsx`: Formatted 3-inch (80mm) thermal receipt component for printing invoices.
- `CustomerLedgerModal.jsx`: Full passbook modal for a customer showing all credit entries, payments, running balance, and payment collection form.
- `MarathiInput.jsx`: Input component with built-in real-time transliteration.

### 7.5 Services, Contexts & Hooks
- `frontend/src/services/apiService.js`: Unified Axios API service for all backend calls.
- `frontend/src/context/LanguageContext.jsx`: Manages UI language (`en` vs `mr`) and Marathi phonetic transliteration toggle state.
- `frontend/src/i18n/en.json` & `mr.json`: Complete dictionary of English and Marathi strings.
- Hooks: `useCustomers`, `useVegetables`, `useTransactions`, `useBills`, `useCredit`, `useDashboard`, `useReports`, `useBackup`, `useGoogleDrive`, `useSettings`, `useLicense`, `useKeyboardShortcuts`.

### 7.6 Marathi Phonetic Transliteration Engine
Located in `frontend/src/services/transliteration/`:
- **Fully Offline:** Does not call Google Translate or any external API. Runs 100% locally in browser memory.
- `romanToItrans.js`: Maps Roman keystrokes to ITRANS phonetic representations.
- `indicRuleProvider.js`: Implements Devanagari syllabic formation and conjunct consonant rules (जोडाक्षरे).
- `marathiOrthography.js`: Enforces Marathi-specific orthography (e.g. ळ, ऱ्ह, ऱ्य).
- `wordDictionary.js`: Built-in dictionary of common APMC vegetables and Marathi trade terms for instant matching.

---

## 8. Platform Integrations & Native Shell

### 8.1 Electron Main Process & Preload
- `electron/main.js`: Boots the background Express server, creates BrowserWindow, exposes IPC channels, handles single-instance locking, and runs background auto-cloud backup timers.
- `electron/preload.js`: Secure context bridge exposing `window.electronAPI`:
  - `shareWhatsApp(options)`: Automated WhatsApp file sharing.
  - `selectFolder()`: Native Windows folder picker dialog.
  - `openFolder(path)`: Opens Windows File Explorer at specified path.

### 8.2 WhatsApp PDF Automation
- **File:** `electron/whatsappShareHandler.js`.
- **Mechanism:** On Windows, browser WhatsApp sharing only allows text messages, not direct file attachments without user dragging.
- VyaparSetu automates this via a generated PowerShell script:
  1. Saves the invoice PDF to `%TEMP%/vyapaarsetu_whatsapp_share/`.
  2. Copies the PDF to the Windows Clipboard in `FileDropList` (`CF_HDROP`) format via `Set-Clipboard -Path`.
  3. Launches WhatsApp via `whatsapp://send?phone=91XXXXXXXXXX&text=...`.
  4. Polls for the WhatsApp desktop window handle via Win32 API (`SetForegroundWindow`, `ShowWindow`).
  5. Injects simulated keystroke `Ctrl+V` (`SendKeys('^v')`) via WScript.Shell COM object.
- *Note for Mobile:* This is Windows-specific desktop automation. On Android, this will be replaced by native Android Share Sheet (`Intent.ACTION_SEND` / Capacitor Share Plugin).

### 8.3 Thermal Receipt Printing
- Styled in `ReceiptPrint.jsx` using `@media print` CSS rules formatted for 80mm/58mm thermal receipt paper.
- In Electron, it invokes `window.print()`.

### 8.4 Google Drive Cloud Backup
- **Implementation:** `backend/services/googleDriveBackupService.js`.
- **OAuth 2.0:** Uses Google Drive API v3 with restricted scope `https://www.googleapis.com/auth/drive.file`.
- **Zero-Waste Change Detection:**
  - SQLite triggers set `settings.db_dirty = '1'` on any insert/update/delete in business tables.
  - Periodic runner (every 60s) checks `db_dirty`. If dirty, computes SHA-256 hash of `vyapaarsetu.db`.
  - Only uploads if hash differs from `last_synced_hash`.
- **Single Canonical File:** Maintains a single remote file `vyapaarsetu_backup.db` in folder `VyapaarSetu_Backups` (overwrites via `drive.files.update` with upload media).

### 8.5 Machine-Bound Desktop Licensing
- **File:** `backend/services/licenseService.js`.
- **Algorithm:** Ed25519 asymmetric cryptography.
- **Machine Binding:** Reads Windows `MachineGuid` from `HKLM\SOFTWARE\Microsoft\Cryptography\MachineGuid`.
- **Machine ID:** `SHA256('VyapaarSetu::machine::v1' + MachineGuid).slice(0, 16)` formatted as `XXXX-XXXX-XXXX-XXXX`.
- **License Key Format:** `base64url(payloadJSON) + "." + base64url(ed25519_signature)`.
- The public key is embedded in code; the private key stays offline with the software vendor.
- `licenseGuard` middleware blocks all `/api/*` routes (except `/health`, `/license/*`, and `/client-log`) if unlicensed.

---

## 9. Tools & Utility Scripts

Located in `tools/`:
- `generate-keypair.mjs`: Generates Ed25519 keypair for licensing.
- `generate-license.mjs`: CLI tool to mint signed licenses for a customer name and Machine ID.
- `server.mjs`: Standalone web UI portal (`tools/start-license-portal.bat` or `npm run license:ui`) for the vendor/admin to generate licenses without running command-line scripts.
- `cleanDuplicateCustomers.js`: Maintenance script to deduplicate customer records while merging credit ledger entries safely.
- `generateApmcVegetablesExcel.js`: Seeds the APMC vegetable catalog with Marathi names, rates, and English search keywords into `Maharashtra_APMC_Vegetables_Catalog.xlsx`.

---

## 10. Mobile Architecture & Standalone Android Application (Capacitor)

### 10.1 Architecture & Runtime Modes
VyaparSetu supports two operational deployment models:

```text
┌────────────────────────────────────────────────────────────────────────────────────────┐
│                              DEPLOYMENT ARCHITECTURE                                    │
├───────────────────────────────────────────┬────────────────────────────────────────────┤
│ 1. DESKTOP MODE (Windows Electron)        │ 2. STANDALONE MOBILE MODE (Android APK)    │
├───────────────────────────────────────────┼────────────────────────────────────────────┤
│ - Electron Shell + Chromium WebView       │ - Android Capacitor Native Shell           │
│ - Node.js Express server on loopback      │ - 100% Offline-First (No PC/backend needed)│
│ - SQLite database (better-sqlite3) in WAL │ - Embedded IndexedDB (Dexie.js) repository │
│ - Powershell WhatsApp automation          │ - Native Android PrintManager Thermal Spool│
│ - Google Drive Auto-Sync                  │ - Native Android Filesystem + Share Sheet  │
│ - Windows MachineGuid licensing           │ - SharedPreferences Persistent Device UUID │
└───────────────────────────────────────────┴────────────────────────────────────────────┘
                                            │ Optional Sync Bridge                       │
                                            ▼                                            │
                             ┌─────────────────────────────┐                             │
                             │ Supabase PostgreSQL Sync    │ <───────────────────────────┘
                             │ (Bidirectional Cloud Sync)  │
                             └─────────────────────────────┘
```

1. **Desktop Mode:** Runs React SPA inside Electron connected to local Express/SQLite at `http://127.0.0.1:5000`.
2. **Standalone Mobile Mode:** Runs the React application compiled into an Android APK via Capacitor 7. The app functions completely standalone without needing any PC or backend server. All storage is handled inside IndexedDB via `offlineRepository.js`.
3. **Optional Supabase Cloud Sync:** When enabled, mobile devices and desktop instances synchronize changes bi-directionally with a centralized Supabase database via `cloudSyncService.js`.

### 10.2 Android Native Shell & Bridge (`frontend/android/`)
- **Package ID:** `com.vyapaarsetu.app`
- **Capacitor Configuration:** `frontend/capacitor.config.json`
  ```json
  {
    "appId": "com.vyapaarsetu.app",
    "appName": "VyaparSetu",
    "webDir": "dist"
  }
  ```
- **Android Manifest & Permissions (`frontend/android/app/src/main/AndroidManifest.xml`):**
  - Configured with `android:usesCleartextTraffic="true"` to allow local LAN network connections to development backends or local printers.
  - Storage & Document access permissions for local backup generation and PDF exports.
- **Native Thermal Printing Bridge (`MainActivity.java`):**
  - Exposes an `@JavascriptInterface` object named `AndroidPrintBridge` to the WebView as `window.AndroidPrint`.
  - When the web application triggers receipt printing (`window.AndroidPrint.print(htmlContent)`), `MainActivity.java` initializes Android's native `PrintManager` and feeds the document into `PrintDocumentAdapter`.
  - This allows instant thermal receipt printing on all standard Wi-Fi, Bluetooth, USB, and Mopria-compatible mobile thermal receipt printers without needing Google Cloud Print.

### 10.3 Offline-First Data Subsystem (`Dexie.js` / IndexedDB)
- **Database Engine:** `frontend/src/db/localDb.js`
  - Defines the client-side IndexedDB database schema using Dexie.js:
    - `customers`: `id, name, phone, balance, created_at, updated_at`
    - `vegetables`: `id, name_en, name_mr, unit, default_rate, is_active`
    - `transactions`: `id, customer_id, vegetable_id, date, weight, rate, amount, commission_amount, total_amount, payment_type, is_billed`
    - `bills`: `id, customer_id, bill_number, bill_date, subtotal, commission, hamali, transport, total_amount, paid_amount, status`
    - `credit_ledger`: `id, customer_id, date, type, amount, balance_after, notes, reference_id`
    - `settings`: `key, value`
    - `sync_queue`: `id, table_name, operation, payload, created_at, status`
- **Abstraction Repository:** `frontend/src/db/offlineRepository.js`
  - All React custom hooks (`useCustomers`, `useVegetables`, `useTransactions`, `useBills`, `useCredit`, `useDashboard`) check connectivity or runtime environment:
    - If in standalone mobile mode or backend is unreachable, calls delegate directly to `offlineRepository.js`.
    - Implements optimistic updates, automatic credit calculation, and running balance ledger recalculation completely offline.

### 10.4 Persistent Device Identity & Mobile Licensing (`@capacitor/preferences`)
- **File:** `frontend/src/utils/mobileDeviceId.js` & `frontend/src/hooks/useLicense.js`
- **The Problem:** In mobile WebViews, clearing the browser cache or storage resets `localStorage`, which would wipe a shopkeeper's activation license.
- **The Solution:**
  - Device ID is generated as a secure UUID `MOB-XXXX-XXXX-XXXX`.
  - The Device UUID and the activated license key are saved to native Android `SharedPreferences` via `@capacitor/preferences`.
  - Even if the user clears the browser data or updates the app, `@capacitor/preferences` restores the device ID and active license instantly.
  - License bypass in development mode can be enabled via `LICENSE_DEV_BYPASS=true` or through the settings portal.

### 10.5 Native WhatsApp PDF Sharing Engine
- **File:** `frontend/src/utils/whatsappShare.js`
- **Workflow:**
  1. The bill / invoice template (`BillTemplate.jsx` / `ReceiptPrint.jsx`) is rendered offscreen or cloned.
  2. `html2canvas` captures the high-resolution DOM node.
  3. `jspdf` converts the canvas into a standard formatted PDF byte buffer.
  4. On Mobile (Capacitor):
     - The PDF is saved to native device storage using `@capacitor/filesystem` under `Directory.Cache` as `Bill_<number>.pdf`.
     - The native file URI (`file://...` or `content://...`) is passed to `@capacitor/share` (`Share.share({ files: [fileUri] })`).
     - Android opens the native system share sheet, directly attaching the real PDF file into WhatsApp or any selected messenger.
  5. On Web / Desktop Fallback:
     - Falls back to `whatsapp://send?phone=...&text=...` with a formatted text invoice breakdown.

### 10.6 Automated Local Continuous Backups
- **File:** `frontend/src/services/mobileBackupService.js`
- **Zero-Friction Shopkeeper Backup:**
  - Traditional vendors forget to manually click "Export Backup".
  - `mobileBackupService.js` hooks into all mutation events (transactions, bills, payments).
  - Uses a debounced runner (e.g. 5 seconds after the last transaction) to dump a timestamped JSON snapshot of all IndexedDB tables.
  - Writes the snapshot to `@capacitor/filesystem` in `Directory.Documents/VyaparSetu/backups/`.
  - Retains a rolling window of recent backups and provides 1-click restore functionality from the Settings screen.

### 10.7 Supabase Cloud Bidirectional Sync
- **File:** `frontend/src/services/cloudSyncService.js`
- **Database Migrations:** Located in `supabase/migrations/`:
  - `20260913_init_vyaparsetu_sync.sql`
  - `20260913_full_sync_enhancements.sql`
  - `20260913_add_legacy_id_transactions.sql`
- **Sync Architecture:**
  - Every record maintains `id`, `legacy_id`, `updated_at`, and `sync_status`.
  - When online, the sync engine pushes local dirty records to Supabase using upsert mutations.
  - Pulls updates where `updated_at > last_sync_time`.
  - Conflict resolution: Client timestamps with idempotent upsert constraints ensure no duplicate transactions or corrupt credit balances.

---

## 11. Build, Compilation & Development Guide (Step-by-Step for AI & Developers)

### 11.1 Prerequisites & System Setup
- **Node.js:** v18.x or v20.x+ (Recommended: LTS)
- **Java Development Kit (JDK):** JDK 17 or JDK 21 (Required for modern Android Gradle plugin)
- **Android SDK:**
  - Android Studio Hedgehog, Iguana, Ladybug, or newer.
  - Android SDK Platform 34 or 35.
  - Android SDK Build-Tools 34.0.0+.
  - Set environment variable `ANDROID_HOME` (e.g. `C:\Users\<User>\AppData\Local\Android\Sdk`).

### 11.2 Running Locally (Desktop & Web)

#### Option A: Running Full Desktop App (Backend + Electron + Frontend)
```bash
# 1. Install root dependencies
npm install

# 2. Install backend & frontend dependencies
cd backend && npm install
cd ../frontend && npm install
cd ..

# 3. Start development desktop instance
npm run dev:desktop
```

#### Option B: Running Backend & Web Frontend Separately
```bash
# Terminal 1: Backend Express Server
cd backend
npm run dev
# Server boots at http://127.0.0.1:5000

# Terminal 2: Frontend Vite Dev Server
cd frontend
npm run dev
# Web app runs at http://localhost:5173
```

#### Option C: Testing Mobile Web on Local WiFi Network
```bash
# Run the included tunnel script:
./start-mobile-tunnel.bat
# Or launch Vite with host exposed:
cd frontend
npm run dev -- --host 0.0.0.0
```

---

### 11.3 Compiling & Building the Android APK (CLI & Android Studio)

Follow this exact sequence whenever web assets or Capacitor plugins change:

#### Step 1: Build the Web Distribution
```bash
cd frontend
npm install
npm run build
```
*This compiles the React 18 application into `frontend/dist/`.*

#### Step 2: Synchronize with Capacitor Native Project
```bash
# Copies frontend/dist into Android assets and updates Capacitor plugins
npx cap sync android
```

#### Step 3: Compile the Android APK

##### Via Command Line (Fastest):
On Windows PowerShell:
```bash
cd frontend/android
.\gradlew.bat assembleDebug
```
On macOS / Linux:
```bash
cd frontend/android
./gradlew assembleDebug
```
*The compiled Debug APK will be generated at:*
```text
frontend/android/app/build/outputs/apk/debug/app-debug.apk
```
*You can install this directly onto an attached device via ADB:*
```bash
adb install -r frontend/android/app/build/outputs/apk/debug/app-debug.apk
```

##### Via Android Studio GUI:
```bash
cd frontend
npx cap open android
```
1. Wait for Gradle sync to complete in Android Studio.
2. In the menu, click **Build** -> **Build Bundle(s) / APK(s)** -> **Build APK(s)**.
3. Once completed, click the **"locate"** popup notification to open the folder containing `app-debug.apk`.
4. To run on a connected USB device or Android emulator, select your device from the toolbar and click the green **Play (Run)** button.

##### Building a Release APK:
```bash
cd frontend/android
.\gradlew.bat assembleRelease
```
*The release APK will be generated at `frontend/android/app/build/outputs/apk/release/app-release-unsigned.apk`.*

---

### 11.4 Environment Variables & Network Configuration

| File | Variable | Default | Purpose |
|---|---|---|---|
| `backend/.env` | `PORT` | `5000` | Express server port. |
| `backend/.env` | `HOST` | `0.0.0.0` | Bind address. |
| `backend/.env` | `LICENSE_DEV_BYPASS` | `true` | When `true`, allows unrestricted API access in development. |
| `frontend/.env` | `VITE_API_BASE_URL` | `http://127.0.0.1:5001` (dev) | Base URL for API calls during local web development. |
| `frontend/.env.production` | `VITE_API_BASE_URL` | `""` (empty) | In production, API calls are relative to origin (`/api/...`). |

---

### 11.5 Common Pitfalls & Troubleshooting

1. **Gradle Build Fails with `JAVA_HOME is not set`:**
   - Ensure JDK 17 or 21 is installed.
   - Set environment variable: `JAVA_HOME = "C:\Program Files\Android\Android Studio\jbr"` (Android Studio comes with a bundled OpenJDK).
2. **Capacitor Asset Sync Missing New Web Changes:**
   - Running `npx cap sync android` does **not** automatically build Vite.
   - Always run `npm run build` in `frontend/` **before** running `npx cap sync android`.
3. **Android HTTP Cleartext Errors (`ERR_CLEARTEXT_NOT_PERMITTED`):**
   - If connecting mobile to a local backend via IP (e.g. `http://192.168.1.X:5000`), Android blocks non-HTTPS traffic by default.
   - `AndroidManifest.xml` already includes `android:usesCleartextTraffic="true"` to prevent this issue.
4. **License Lockout in Development:**
   - In `backend/.env`, set `LICENSE_DEV_BYPASS=true` to skip license validation.
   - In Mobile Standalone mode, use the Admin PIN in `SettingsPage.jsx` or the settings toggle to manage license bypass.

---

## 12. AI Agent Implementation Guardrails & Conventions

When implementing code changes or collaborating via AI agents on this repository, strictly adhere to the following core invariants:

1. **The Money Rule (Crucial):**
   - **Database & Backend:** Monetary values are stored as **INTEGER paise** (`100 paise = 1 ₹`).
   - **Frontend UI:** Monetary values are displayed and inputted in **Rupees** (`₹`).
   - Never do raw floating-point math with currency. Always use `frontend/src/utils/money.js` and `backend/utils/money.js`.
2. **The Business Date Rule:**
   - All transactions, day books, and customer bills must record the business date in `YYYY-MM-DD` string format in local Indian Standard Time (IST / UTC+5:30).
   - Never use `new Date().toISOString()` directly for business date fields (as UTC rollover at midnight IST causes transactions after 05:30 AM to misalign with early morning APMC market shifts).
3. **Udhar Ledger Invariant:**
   - Total customer outstanding credit MUST always reconcile:
     $$\text{Outstanding Balance} = \sum \text{Unbilled Transactions} + \sum \text{Unpaid Bills} - \sum \text{Settlement Payments} - \sum \text{Discounts}$$
   - Any modification to transactions or bills must execute within a database transaction or atomic Dexie batch to keep credit ledgers perfectly synchronized.
4. **Offline Resilience First:**
   - Mobile features must NEVER crash or block the UI if the backend server, internet connection, or Supabase is unreachable.
   - Always verify that the UI falls back gracefully to `offlineRepository.js` and IndexedDB.
5. **Git Hygiene:**
   - Never commit `node_modules/`, `dist/`, `release/`, `.env`, `*.db`, `local.properties`, or `.gradle/`.
   - Maintain documentation integrity and preserve established file organization.
