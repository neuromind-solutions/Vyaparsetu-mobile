/**
 * Local Offline Database Engine — VyaparSetu
 * Powered by IndexedDB with transactional consistency.
 * Enables 100% offline-first independent execution on Mobile and Desktop.
 */

const DB_NAME = 'vyaparsetu_local_db';
const DB_VERSION = 1;

let dbPromise = null;

export function getDb() {
  if (dbPromise) return dbPromise;

  dbPromise = new Promise((resolve, reject) => {
    if (typeof indexedDB === 'undefined') {
      return reject(new Error('IndexedDB is not supported in this environment'));
    }

    const request = indexedDB.open(DB_NAME, DB_VERSION);

    request.onupgradeneeded = (event) => {
      const db = event.target.result;

      // 1. Customers
      if (!db.objectStoreNames.contains('customers')) {
        const store = db.createObjectStore('customers', { keyPath: 'id', autoIncrement: true });
        store.createIndex('name', 'name', { unique: false });
        store.createIndex('mobile', 'mobile', { unique: false });
        store.createIndex('is_deleted', 'is_deleted', { unique: false });
      }

      // 2. Vegetables
      if (!db.objectStoreNames.contains('vegetables')) {
        const store = db.createObjectStore('vegetables', { keyPath: 'id', autoIncrement: true });
        store.createIndex('name', 'name', { unique: false });
        store.createIndex('is_deleted', 'is_deleted', { unique: false });
      }

      // 3. Transactions
      if (!db.objectStoreNames.contains('transactions')) {
        const store = db.createObjectStore('transactions', { keyPath: 'id', autoIncrement: true });
        store.createIndex('customer_id', 'customer_id', { unique: false });
        store.createIndex('transaction_date', 'transaction_date', { unique: false });
        store.createIndex('bill_id', 'bill_id', { unique: false });
      }

      // 4. Bills
      if (!db.objectStoreNames.contains('bills')) {
        const store = db.createObjectStore('bills', { keyPath: 'id', autoIncrement: true });
        store.createIndex('bill_number', 'bill_number', { unique: true });
        store.createIndex('customer_id', 'customer_id', { unique: false });
        store.createIndex('date', 'date', { unique: false });
      }

      // 5. Bill Items
      if (!db.objectStoreNames.contains('bill_items')) {
        const store = db.createObjectStore('bill_items', { keyPath: 'id', autoIncrement: true });
        store.createIndex('bill_id', 'bill_id', { unique: false });
      }

      // 6. Credit Transactions (Udhar Passbook)
      if (!db.objectStoreNames.contains('credit_transactions')) {
        const store = db.createObjectStore('credit_transactions', { keyPath: 'id', autoIncrement: true });
        store.createIndex('customer_id', 'customer_id', { unique: false });
        store.createIndex('date', 'date', { unique: false });
      }

      // 7. Application Settings
      if (!db.objectStoreNames.contains('settings')) {
        db.createObjectStore('settings', { keyPath: 'key' });
      }

      // 8. Outbox Mutations Queue (for Cloud Sync)
      if (!db.objectStoreNames.contains('outbox_mutations')) {
        const store = db.createObjectStore('outbox_mutations', { keyPath: 'mutation_id' });
        store.createIndex('status', 'status', { unique: false });
        store.createIndex('created_at', 'created_at', { unique: false });
      }

      // 9. Sync Configuration
      if (!db.objectStoreNames.contains('sync_config')) {
        db.createObjectStore('sync_config', { keyPath: 'key' });
      }
    };

    request.onsuccess = async (event) => {
      const db = event.target.result;
      try {
        await seedInitialData(db);
      } catch (e) {
        console.warn('Initial data seeding error:', e);
      }
      resolve(db);
    };

    request.onerror = (event) => {
      dbPromise = null;
      console.error('IndexedDB open error:', event.target.error);
      reject(event.target.error);
    };
  });

  return dbPromise;
}

/**
 * Pre-seed default shop settings if empty (vegetables start 100% clean)
 */
async function seedInitialData(db) {
  const tx = db.transaction(['settings'], 'readwrite');
  const settingsStore = tx.objectStore('settings');
  const shopNameReq = settingsStore.get('shop_name');
  shopNameReq.onsuccess = () => {
    if (!shopNameReq.result) {
      settingsStore.put({ key: 'shop_name', value: 'Baliraja Vegetables' });
      settingsStore.put({ key: 'shop_name_marathi', value: 'बळीराजा व्हेजिटेबल' });
      settingsStore.put({ key: 'proprietor_name', value: 'Sachin Patil' });
      settingsStore.put({ key: 'city', value: 'Phaltan' });
      settingsStore.put({ key: 'market_name', value: 'कृषी उत्पन्न बाजार समिती' });
      settingsStore.put({ key: 'default_commission_rate', value: '8.0' });
      settingsStore.put({ key: 'commission_rate', value: '8.0' });
      settingsStore.put({ key: 'devotion_text', value: '॥ हरि ॐ ॥  ॥ श्रीराम ॥  ॥ अंबा ॥' });
      settingsStore.put({ key: 'bill_footer_note', value: 'Thank you for your business!' });
    }
  };
}

// ─── Generic DB Operations ───────────────────────────────────────────────────

export async function dbGetAll(storeName) {
  const db = await getDb();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(storeName, 'readonly');
    const store = tx.objectStore(storeName);
    const req = store.getAll();
    req.onsuccess = () => resolve(req.result || []);
    req.onerror = () => reject(req.error);
  });
}

export async function dbGet(storeName, key) {
  const db = await getDb();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(storeName, 'readonly');
    const store = tx.objectStore(storeName);
    const req = store.get(key);
    req.onsuccess = () => resolve(req.result || null);
    req.onerror = () => reject(req.error);
  });
}

const mutationListeners = [];

export function onLocalDbMutation(callback) {
  mutationListeners.push(callback);
  return () => {
    const idx = mutationListeners.indexOf(callback);
    if (idx !== -1) mutationListeners.splice(idx, 1);
  };
}

function notifyMutation(storeName, op, data) {
  const DATA_STORES = [
    'customers',
    'vegetables',
    'transactions',
    'bills',
    'bill_items',
    'credit_transactions',
    'settings',
  ];
  if (DATA_STORES.includes(storeName)) {
    for (const listener of mutationListeners) {
      try {
        listener({ storeName, op, data });
      } catch (e) {
        console.warn('Mutation listener error:', e);
      }
    }
  }
}

export async function dbPut(storeName, value) {
  const db = await getDb();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(storeName, 'readwrite');
    const store = tx.objectStore(storeName);
    const req = store.put(value);
    req.onsuccess = () => {
      notifyMutation(storeName, 'put', value);
      resolve(req.result);
    };
    req.onerror = () => reject(req.error);
  });
}

export async function dbAdd(storeName, value) {
  const db = await getDb();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(storeName, 'readwrite');
    const store = tx.objectStore(storeName);
    const req = store.add(value);
    req.onsuccess = () => {
      notifyMutation(storeName, 'add', value);
      resolve(req.result);
    };
    req.onerror = () => reject(req.error);
  });
}

export async function dbDelete(storeName, key) {
  const db = await getDb();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(storeName, 'readwrite');
    const store = tx.objectStore(storeName);
    const req = store.delete(key);
    req.onsuccess = () => {
      notifyMutation(storeName, 'delete', { key });
      resolve(true);
    };
    req.onerror = () => reject(req.error);
  });
}

export async function dbClear(storeName) {
  const db = await getDb();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(storeName, 'readwrite');
    const store = tx.objectStore(storeName);
    const req = store.clear();
    req.onsuccess = () => resolve(true);
    req.onerror = () => reject(req.error);
  });
}

export async function dbGetByIndex(storeName, indexName, value) {
  const db = await getDb();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(storeName, 'readonly');
    const store = tx.objectStore(storeName);
    const index = store.index(indexName);
    const req = index.getAll(value);
    req.onsuccess = () => resolve(req.result || []);
    req.onerror = () => reject(req.error);
  });
}
