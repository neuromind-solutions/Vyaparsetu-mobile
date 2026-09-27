# Udhar (Customer Credit & Ledger) Module Implementation Guide

This guide contains the complete, self-contained implementation specification and code for the **Udhar (Credit / Receivables) Module** extracted directly from **VyapaarSetu**. 

You can use this document in any other project (or share it with an AI assistant) to replicate the exact same functionality step-by-step.

---

## 1. Overview & Key Features

The **Udhar Module** provides a complete credit ledger management system for retail vendors and small business merchants:

1. **Dashboard KPI Metrics**:
   - **Total Outstanding Balance**: Sum of all pending credit across all customers.
   - **Today's Credit Added**: Credit extended to customers today.
   - **Today's Recovery**: Payments collected from customers today.
2. **Customer Ledger**:
   - List customers with active outstanding credit balance.
   - Real-time search/filtering (by name or mobile number).
   - Detailed ledger view per customer with running transaction history.
3. **Payment Collection (`Collect Payment`)**:
   - Collect partial or full payment via **Cash**, **UPI**, or **Other**.
   - Auto-deducts amount from the customer's `credit_balance`.
   - Records transaction type as `PAYMENT_RECEIVED`.
   - Prevents over-payment beyond current credit balance.
4. **Credit Balance Adjustment (`Adjust Credit`)**:
   - Increase or decrease customer credit balance manually with audit notes.
   - Records transaction type as `CREDIT_ADJUSTMENT`.

---

## 2. Database Schema (SQLite / PostgreSQL / MySQL)

### `customers` Table
Stores customer profile and their current outstanding `credit_balance`.

```sql
CREATE TABLE IF NOT EXISTS customers (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL,
  mobile TEXT,
  address TEXT,
  credit_balance REAL DEFAULT 0.00,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);
```

### `credit_transactions` Table
Maintains an immutable ledger log of every credit addition, payment collection, or adjustment, along with a `balance_after_transaction` snapshot.

```sql
CREATE TABLE IF NOT EXISTS credit_transactions (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  customer_id INTEGER NOT NULL,
  bill_id INTEGER DEFAULT NULL,
  transaction_type TEXT CHECK(transaction_type IN ('CREDIT_ADDED', 'PAYMENT_RECEIVED', 'CREDIT_ADJUSTMENT')) NOT NULL,
  amount REAL NOT NULL,
  payment_mode TEXT DEFAULT 'Other', -- Cash, UPI, Other
  note TEXT,
  balance_after_transaction REAL NOT NULL DEFAULT 0.00,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (customer_id) REFERENCES customers(id) ON DELETE CASCADE
);
```

---

## 3. Backend Implementation (Node.js / Express)

### A. Database Model (`models/creditModel.js`)

```javascript
// models/creditModel.js
const { getDb, saveDb } = require('../database/db'); // Replace with your DB connection executor

function rowToObj(columns, row) {
  const obj = {};
  columns.forEach((col, i) => { obj[col] = row[i]; });
  return obj;
}

function execSelect(sql, params = []) {
  const db = getDb();
  const result = db.exec(sql, params);
  if (!result.length) return [];
  const { columns, values } = result[0];
  return values.map(row => rowToObj(columns, row));
}

/** Get overall credit metrics */
function getSummary() {
  const outstandingRes = execSelect(`SELECT SUM(credit_balance) AS total_outstanding FROM customers`);
  const totalOutstanding = outstandingRes[0]?.total_outstanding || 0.0;

  const addedRes = execSelect(
    `SELECT SUM(amount) AS today_added 
     FROM credit_transactions 
     WHERE transaction_type = 'CREDIT_ADDED' 
       AND date(created_at) = date('now', 'localtime')`
  );
  const todayAdded = addedRes[0]?.today_added || 0.0;

  const recoveredRes = execSelect(
    `SELECT SUM(amount) AS today_recovered 
     FROM credit_transactions 
     WHERE transaction_type = 'PAYMENT_RECEIVED' 
       AND date(created_at) = date('now', 'localtime')`
  );
  const todayRecovered = recoveredRes[0]?.today_recovered || 0.0;

  return {
    total_outstanding: Number(totalOutstanding.toFixed(2)),
    today_added: Number(todayAdded.toFixed(2)),
    today_recovered: Number(todayRecovered.toFixed(2))
  };
}

/** Get list of customers with balance > 0 */
function getCustomersWithBalance() {
  return execSelect(
    `SELECT id, name, mobile, address, credit_balance, updated_at 
     FROM customers 
     WHERE credit_balance > 0 
     ORDER BY credit_balance DESC, name ASC`
  );
}

/** Get customer ledger history */
function getCustomerTransactions(customerId) {
  return execSelect(
    `SELECT ct.*, b.bill_number 
     FROM credit_transactions ct 
     LEFT JOIN bills b ON ct.bill_id = b.id 
     WHERE ct.customer_id = ? 
     ORDER BY ct.created_at DESC, ct.id DESC`,
    [customerId]
  );
}

/** Transactional payment collection */
function recordPayment({ customer_id, amount, payment_mode, note }) {
  const db = getDb();
  try {
    db.run("BEGIN TRANSACTION");

    // Deduct from customer credit balance
    db.run(
      `UPDATE customers SET credit_balance = credit_balance - ? WHERE id = ?`,
      [amount, customer_id]
    );

    // Retrieve updated balance
    const balanceRow = execSelect(`SELECT credit_balance FROM customers WHERE id = ?`, [customer_id]);
    const balanceAfter = balanceRow[0]?.credit_balance || 0;

    // Record transaction
    db.run(
      `INSERT INTO credit_transactions (customer_id, transaction_type, amount, payment_mode, note, balance_after_transaction)
       VALUES (?, 'PAYMENT_RECEIVED', ?, ?, ?, ?)`,
      [customer_id, amount, payment_mode, note || 'Payment received', balanceAfter]
    );

    db.run("COMMIT");
    saveDb && saveDb();

    return { customer_id, balance_after_transaction: balanceAfter };
  } catch (err) {
    try { db.run("ROLLBACK"); } catch (e) {}
    throw err;
  }
}

/** Transactional credit balance adjustment */
function recordAdjustment({ customer_id, amount, note }) {
  const db = getDb();
  try {
    db.run("BEGIN TRANSACTION");

    // Adjust balance (+ or -)
    db.run(
      `UPDATE customers SET credit_balance = credit_balance + ? WHERE id = ?`,
      [amount, customer_id]
    );

    const balanceRow = execSelect(`SELECT credit_balance FROM customers WHERE id = ?`, [customer_id]);
    const balanceAfter = balanceRow[0]?.credit_balance || 0;

    db.run(
      `INSERT INTO credit_transactions (customer_id, transaction_type, amount, payment_mode, note, balance_after_transaction)
       VALUES (?, 'CREDIT_ADJUSTMENT', ?, 'Other', ?, ?)`,
      [customer_id, Math.abs(amount), note || 'Balance adjustment', balanceAfter]
    );

    db.run("COMMIT");
    saveDb && saveDb();

    return { customer_id, balance_after_transaction: balanceAfter };
  } catch (err) {
    try { db.run("ROLLBACK"); } catch (e) {}
    throw err;
  }
}

module.exports = {
  getSummary,
  getCustomersWithBalance,
  getCustomerTransactions,
  recordPayment,
  recordAdjustment
};
```

---

### B. Business Logic Service (`services/creditService.js`)

```javascript
// services/creditService.js
const creditModel = require('../models/creditModel');
const customerModel = require('../models/customerModel');

async function getSummary() {
  try {
    const data = creditModel.getSummary();
    return { success: true, data };
  } catch (e) {
    return { success: false, error: e.message };
  }
}

async function getCustomersWithBalance() {
  try {
    const data = creditModel.getCustomersWithBalance();
    return { success: true, data };
  } catch (e) {
    return { success: false, error: e.message };
  }
}

async function getCustomerDetails(customerId) {
  try {
    const customer = customerModel.findById(customerId);
    if (!customer) return { success: false, error: 'Customer not found' };
    return { success: true, data: customer };
  } catch (e) {
    return { success: false, error: e.message };
  }
}

async function getCustomerTransactions(customerId) {
  try {
    const customer = customerModel.findById(customerId);
    if (!customer) return { success: false, error: 'Customer not found' };
    const history = creditModel.getCustomerTransactions(customerId);
    return { success: true, data: history };
  } catch (e) {
    return { success: false, error: e.message };
  }
}

async function collectPayment({ customer_id, amount, payment_mode, note }) {
  if (!customer_id) return { success: false, error: 'Customer required' };
  
  const amt = Number(amount);
  if (isNaN(amt) || amt <= 0) {
    return { success: false, error: 'Payment amount must be greater than 0' };
  }

  if (!payment_mode || !['Cash', 'UPI', 'Other'].includes(payment_mode)) {
    return { success: false, error: 'Valid payment mode (Cash, UPI, Other) required' };
  }

  try {
    const cust = customerModel.findById(customer_id);
    if (!cust) return { success: false, error: 'Customer not found' };

    const pending = Number(Number(cust.credit_balance).toFixed(2));
    const paid = Number(amt.toFixed(2));

    if (paid > pending) {
      return { 
        success: false, 
        error: `Payment amount (₹${paid}) cannot exceed customer's outstanding balance (₹${pending})` 
      };
    }

    const result = creditModel.recordPayment({
      customer_id,
      amount: paid,
      payment_mode,
      note: note ? note.trim() : `Payment collected via ${payment_mode}`
    });

    return { success: true, data: result };
  } catch (e) {
    return { success: false, error: e.message };
  }
}

async function adjustCredit({ customer_id, amount, note }) {
  if (!customer_id) return { success: false, error: 'Customer required' };

  const amt = Number(amount);
  if (isNaN(amt) || amt === 0) {
    return { success: false, error: 'Adjustment amount cannot be zero' };
  }

  try {
    const cust = customerModel.findById(customer_id);
    if (!cust) return { success: false, error: 'Customer not found' };

    const pending = Number(Number(cust.credit_balance).toFixed(2));
    const change = Number(amt.toFixed(2));

    if (pending + change < 0) {
      return { 
        success: false, 
        error: `Negative adjustment cannot exceed customer's balance (current: ₹${pending})` 
      };
    }

    const result = creditModel.recordAdjustment({
      customer_id,
      amount: change,
      note: note ? note.trim() : 'Manual credit balance adjustment'
    });

    return { success: true, data: result };
  } catch (e) {
    return { success: false, error: e.message };
  }
}

module.exports = {
  getSummary,
  getCustomersWithBalance,
  getCustomerDetails,
  getCustomerTransactions,
  collectPayment,
  adjustCredit
};
```

---

### C. Express Controller & Routes (`routes/creditRoutes.js`)

```javascript
// controllers/creditController.js
const creditService = require('../services/creditService');

module.exports = {
  getSummary: async (req, res) => {
    const r = await creditService.getSummary();
    res.status(r.success ? 200 : 500).json(r);
  },
  getCustomers: async (req, res) => {
    const r = await creditService.getCustomersWithBalance();
    res.status(r.success ? 200 : 500).json(r);
  },
  getCustomerById: async (req, res) => {
    const r = await creditService.getCustomerDetails(req.params.customerId);
    res.status(r.success ? 200 : 404).json(r);
  },
  getTransactions: async (req, res) => {
    const r = await creditService.getCustomerTransactions(req.params.customerId);
    res.status(r.success ? 200 : 500).json(r);
  },
  collectPayment: async (req, res) => {
    const r = await creditService.collectPayment(req.body);
    res.status(r.success ? 201 : 400).json(r);
  },
  adjustCredit: async (req, res) => {
    const r = await creditService.adjustCredit(req.body);
    res.status(r.success ? 201 : 400).json(r);
  }
};
```

```javascript
// routes/creditRoutes.js
const express = require('express');
const router = express.Router();
const ctrl = require('../controllers/creditController');

router.get('/summary', ctrl.getSummary);
router.get('/customers', ctrl.getCustomers);
router.get('/customer/:customerId', ctrl.getCustomerById);
router.get('/customer/:customerId/transactions', ctrl.getTransactions);
router.post('/payment', ctrl.collectPayment);
router.post('/adjustment', ctrl.adjustCredit);

module.exports = router;
```

---

## 4. Frontend Implementation (React)

### A. Custom State & Data Hook (`hooks/useCredit.js`)

```javascript
// src/hooks/useCredit.js
import { useState, useEffect, useCallback, useMemo } from 'react';
import axios from 'axios';

const API_BASE = '/api/credit';

export function useCredit() {
  const [summary, setSummary] = useState({ total_outstanding: 0, today_added: 0, today_recovered: 0 });
  const [allCustomers, setAllCustomers] = useState([]);
  const [loading, setLoading] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');
  
  const [activeCustomerId, setActiveCustomerId] = useState(null);
  const [activeCustomer, setActiveCustomer] = useState(null);
  const [transactions, setTransactions] = useState([]);
  const [transactionsLoading, setTransactionsLoading] = useState(false);

  const fetchSummary = useCallback(async () => {
    try {
      const { data } = await axios.get(`${API_BASE}/summary`);
      if (data.success) setSummary(data.data);
    } catch (e) {
      console.error(e);
    }
  }, []);

  const fetchCustomers = useCallback(async () => {
    setLoading(true);
    try {
      const { data } = await axios.get(`${API_BASE}/customers`);
      if (data.success) setAllCustomers(data.data || []);
    } catch (e) {
      console.error(e);
    } finally {
      setLoading(false);
    }
  }, []);

  const fetchTransactions = useCallback(async (customerId) => {
    if (!customerId) return;
    setTransactionsLoading(true);
    try {
      const [resTrans, resCust] = await Promise.all([
        axios.get(`${API_BASE}/customer/${customerId}/transactions`),
        axios.get(`${API_BASE}/customer/${customerId}`)
      ]);
      if (resTrans.data.success) setTransactions(resTrans.data.data || []);
      if (resCust.data.success) setActiveCustomer(resCust.data.data);
    } catch (e) {
      console.error(e);
    } finally {
      setTransactionsLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchSummary();
    fetchCustomers();
  }, [fetchSummary, fetchCustomers]);

  useEffect(() => {
    if (activeCustomerId) {
      fetchTransactions(activeCustomerId);
    } else {
      setActiveCustomer(null);
      setTransactions([]);
    }
  }, [activeCustomerId, fetchTransactions]);

  // Search filter
  const customers = useMemo(() => {
    if (!searchQuery.trim()) return allCustomers;
    const q = searchQuery.toLowerCase();
    return allCustomers.filter(c => 
      c.name?.toLowerCase().includes(q) || c.mobile?.includes(q)
    );
  }, [allCustomers, searchQuery]);

  // Collect Payment Action
  async function collectPayment({ customer_id, amount, payment_mode, note }) {
    try {
      const { data } = await axios.post(`${API_BASE}/payment`, { customer_id, amount, payment_mode, note });
      if (data.success) {
        await Promise.all([fetchSummary(), fetchCustomers()]);
        if (activeCustomerId === customer_id) await fetchTransactions(customer_id);
        return { success: true };
      }
      return { success: false, error: data.error };
    } catch (err) {
      return { success: false, error: err.response?.data?.error || err.message };
    }
  }

  // Adjust Credit Action
  async function adjustCredit({ customer_id, amount, note }) {
    try {
      const { data } = await axios.post(`${API_BASE}/adjustment`, { customer_id, amount, note });
      if (data.success) {
        await Promise.all([fetchSummary(), fetchCustomers()]);
        if (activeCustomerId === customer_id) await fetchTransactions(customer_id);
        return { success: true };
      }
      return { success: false, error: data.error };
    } catch (err) {
      return { success: false, error: err.response?.data?.error || err.message };
    }
  }

  return {
    summary,
    customers,
    loading,
    searchQuery,
    setSearchQuery,
    activeCustomerId,
    setActiveCustomerId,
    activeCustomer,
    transactions,
    transactionsLoading,
    collectPayment,
    adjustCredit
  };
}
```

---

### B. UI Component (`pages/UdharPage.jsx`)
The complete page layout includes top metric cards, customer list on the left panel, detailed ledger history on the right panel, and interactive modals for payment collection & credit adjustment.

> 📁 Reference file in this codebase: [`frontend/src/pages/UdharPage.jsx`](file:///d:/VyapaarSetu/frontend/src/pages/UdharPage.jsx)

---

## 5. API Endpoints Summary

| Method | Endpoint | Description | Sample Payload |
|---|---|---|---|
| `GET` | `/api/credit/summary` | Fetch summary metrics | N/A |
| `GET` | `/api/credit/customers` | Get customers with `credit_balance > 0` | N/A |
| `GET` | `/api/credit/customer/:id` | Get customer details by ID | N/A |
| `GET` | `/api/credit/customer/:id/transactions` | Get ledger transaction history | N/A |
| `POST` | `/api/credit/payment` | Collect payment against pending credit balance | `{ "customer_id": 1, "amount": 500, "payment_mode": "UPI", "note": "GPay" }` |
| `POST` | `/api/credit/adjustment` | Manually adjust credit balance (+ or -) | `{ "customer_id": 1, "amount": -100, "note": "Discount applied" }` |

---

## 6. How to Integrate in a New Project

1. **Database Migration**: Run the SQL schema DDLs from **Section 2** in your target database.
2. **Backend**: 
   - Add `creditModel.js`, `creditService.js`, and `creditController.js`.
   - Register the router in your Express `app.js` / `server.js`:
     ```javascript
     const creditRoutes = require('./routes/creditRoutes');
     app.use('/api/credit', creditRoutes);
     ```
3. **Frontend**:
   - Copy `useCredit.js` hook to `src/hooks/useCredit.js`.
   - Copy `UdharPage.jsx` to `src/pages/UdharPage.jsx`.
   - Register `/udhar` route in your React router.
