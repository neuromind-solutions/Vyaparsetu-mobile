/**
 * Cloud Synchronization & Supabase Service — VyaparSetu
 *
 * Full two-way automatic and manual sync:
 *  - Desktop: Reads SQLite via backend API, pushes customers, vegetables, transactions,
 *             bills, bill_items, and credit_transactions to Supabase. Also pulls any
 *             new mobile entries down to SQLite.
 *  - Mobile:  Pulls all business data from Supabase directly into IndexedDB, and pushes
 *             any local mutations / un-synced entries to Supabase.
 *
 * Money scale:
 *  - All money in Supabase and IndexedDB is consistently stored in whole PAISE.
 *  - No double division.
 *
 * Auto-sync:
 *  - Periodic auto-sync runs in background every 5 seconds if credentials are configured.
 *  - Dispatches 'vyaparsetu:data-synced' event on window on change so views update dynamically.
 */

import { dbGetAll, dbPut, dbGet, dbClear } from '../db/localDb';
import { settingsApi, isStandaloneMobile } from './apiService';

const SHOP_ID_KEY  = 'vyaparsetu_supabase_shop_id';
const CUST_MAP_KEY = 'vyaparsetu_supabase_cust_map';
const VEG_MAP_KEY  = 'vyaparsetu_supabase_veg_map';
const BILL_MAP_KEY = 'vyaparsetu_supabase_bill_map';

function toTimestampMs(ts) {
  if (!ts) return 0;
  if (typeof ts === 'number') return ts;
  const normalized = String(ts).trim().replace(' ', 'T');
  const d = new Date(normalized);
  const time = d.getTime();
  return isNaN(time) ? 0 : time;
}

class CloudSyncService {
  constructor() {
    this.listeners = new Set();
    this.status = 'idle';
    this.lastSyncTime = null;
    this.lastError = null;
    this.syncInterval = null;
    this.isSyncing = false;
    this._watchdog = null;
    this.lastUserInteractionTime = 0;
    this._immediateDebounceTimer = null; // push-on-write debounce
    this._realtimeChannel = null;        // Supabase Realtime subscription
    this._fastPollTimer = null;
    this._initInteractionListeners();
  }

  _initInteractionListeners() {
    if (typeof window === 'undefined') return;
    const markInteraction = () => {
      this.lastUserInteractionTime = Date.now();
    };
    window.addEventListener('touchstart', markInteraction, { passive: true });
    window.addEventListener('scroll', markInteraction, { passive: true });
    window.addEventListener('keydown', markInteraction, { passive: true });
    window.addEventListener('wheel', markInteraction, { passive: true });
  }

  isUserInteracting() {
    if (typeof document === 'undefined') return false;
    const active = document.activeElement;
    const isInputActive = Boolean(
      active && (
        active.tagName === 'INPUT' ||
        active.tagName === 'TEXTAREA' ||
        active.tagName === 'SELECT' ||
        active.isContentEditable
      )
    );
    const isModalOpen = Boolean(document.querySelector('.modal-backdrop, .modal, [role="dialog"], .swal2-container'));
    const isRecentlyActive = Date.now() - (this.lastUserInteractionTime || 0) < 10000; // 10s cooldown
    return Boolean(isInputActive || isModalOpen || isRecentlyActive);
  }

  subscribe(listener) {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  // ── Push-on-write: trigger a sync immediately after any mutation ─────────────
  // Dispatches local event immediately so all open pages update reactively,
  // then debounces the cloud push to Supabase.
  triggerImmediateSync() {
    if (typeof window !== 'undefined') {
      window.dispatchEvent(new CustomEvent('vyaparsetu:data-synced', { detail: { local: true } }));
    }
    if (this._immediateDebounceTimer) clearTimeout(this._immediateDebounceTimer);
    this._immediateDebounceTimer = setTimeout(() => {
      this._immediateDebounceTimer = null;
      if (navigator.onLine && !this.isSyncing) {
        this.getSyncStats().then((stats) => {
          if (stats.isConfigured) {
            this.syncNow().catch((e) => console.warn('[CloudSync] immediate sync error:', e));
          }
        });
      }
    }, 800);
  }

  // ── Push-on-delete: immediately mark deleted or remove on Supabase ──────────
  async deleteFromSupabase(table, localId) {
    try {
      const stats = await this.getSyncStats();
      if (!stats.isConfigured) return;
      const url = stats.supabaseUrl.trim().replace(/\/+$/, '');
      const key = stats.supabaseAnonKey.trim();
      const shopId = localStorage.getItem(SHOP_ID_KEY);
      if (!shopId) return;

      if (table === 'customers' || table === 'vegetables') {
        const filter = `shop_id=eq.${shopId}&legacy_id=eq.${localId}`;
        await this._patch(url, key, table, filter, { is_deleted: true }).catch(() => {});
      } else if (table === 'transactions') {
        const filter = `shop_id=eq.${shopId}&or=(legacy_id.eq.desktop-tx-${localId},legacy_id.eq.mobile-tx-${localId},legacy_id.eq.tx-${localId})`;
        await this._delete(url, key, table, filter).catch(() => {});
      } else if (table === 'credit_transactions') {
        const filter = `shop_id=eq.${shopId}&or=(notes.like.*[Desktop:ctx-${localId}]*,notes.like.*[Mobile:ctx-${localId}]*,notes.like.*ctx-${localId}]*)`;
        await this._delete(url, key, table, filter).catch(() => {});
      } else if (table === 'bills') {
        const filter = `shop_id=eq.${shopId}&or=(bill_number.eq.B-${localId},bill_number.eq.${localId})`;
        await this._delete(url, key, table, filter).catch(() => {});
      }
    } catch (e) {
      console.warn(`[CloudSync] deleteFromSupabase ${table} error:`, e);
    }
  }

  // ── Supabase Realtime: subscribe to changes from the other device ────────────
  // Starts fast polling every 5s across all major tables, plus SSE listener if supported.
  async startRealtimeSubscription() {
    try {
      const stats = await this.getSyncStats();
      if (!stats.isConfigured) return;

      const url = stats.supabaseUrl.trim().replace(/\/+$/, '');
      const key = stats.supabaseAnonKey.trim();
      const shopId = localStorage.getItem('vyaparsetu_supabase_shop_id');
      if (!shopId) return;

      // Always start resilient fast-polling (5s interval across customers, vegs, txs, credits)
      this._startFastPoll(url, key, shopId);

      // Try SSE-based realtime channel as secondary instant push if available
      if (typeof EventSource !== 'undefined' && !this._realtimeChannel) {
        const channelUrl = `${url}/realtime/v1/listen?topic=realtime%3Apublic%3Ashops%3Aid%3D${shopId}&apikey=${key}`;
        const es = new EventSource(channelUrl);
        es.onmessage = (event) => {
          try {
            const msg = JSON.parse(event.data);
            if (msg?.type === 'postgres_changes' || msg?.event === 'UPDATE' || msg?.event === 'INSERT' || msg?.event === 'DELETE') {
              console.log('[CloudSync] Realtime change received from other device — pulling now');
              if (!this.isSyncing) {
                this.syncNow().catch(() => {});
              }
            }
          } catch (_) {}
        };
        es.onerror = () => {
          try { es.close(); } catch (_) {}
          this._realtimeChannel = null;
        };
        this._realtimeChannel = es;
      }
    } catch (e) {
      console.warn('[CloudSync] Could not start realtime subscription:', e.message);
    }
  }

  // Fast-poll: check Supabase for changes every 5s across customers, vegetables, transactions, and credit_transactions.
  // Uses a composite signature of latest timestamps — zero cost if no changes.
  _startFastPoll(url, key, shopId) {
    if (this._fastPollTimer) return;
    let lastKnownSig = null;
    this._fastPollTimer = setInterval(async () => {
      if (this.isSyncing || !navigator.onLine) return;
      try {
        const [cRows, vRows, tRows, crRows] = await Promise.all([
          this._get(url, key, 'customers', `shop_id=eq.${shopId}&order=updated_at.desc&limit=1&select=updated_at`).catch(() => []),
          this._get(url, key, 'vegetables', `shop_id=eq.${shopId}&order=updated_at.desc&limit=1&select=updated_at`).catch(() => []),
          this._get(url, key, 'transactions', `shop_id=eq.${shopId}&order=created_at.desc&limit=1&select=created_at`).catch(() => []),
          this._get(url, key, 'credit_transactions', `shop_id=eq.${shopId}&order=created_at.desc&limit=1&select=created_at`).catch(() => []),
        ]);
        const sig = [
          cRows?.[0]?.updated_at || '',
          vRows?.[0]?.updated_at || '',
          tRows?.[0]?.created_at || '',
          crRows?.[0]?.created_at || '',
        ].join('|');

        if (sig && sig !== '|||') {
          if (lastKnownSig !== null && sig !== lastKnownSig) {
            console.log('[CloudSync] Cloud state changed on other device — syncing immediately');
            this.syncNow().catch(() => {});
          }
          lastKnownSig = sig;
        }
      } catch (_) {}
    }, 5000); // 5s fast-poll
  }

  notify() {
    for (const listener of this.listeners) {
      try {
        listener({
          status: this.status,
          lastSyncTime: this.lastSyncTime,
          lastError: this.lastError,
          isSyncing: this.isSyncing,
        });
      } catch (e) {
        console.warn('Sync listener error:', e);
      }
    }
  }

  _startWatchdog(timeoutMs = 15000) {
    this._clearWatchdog();
    this._watchdog = setTimeout(() => {
      if (this.isSyncing) {
        console.warn(`[CloudSync] Sync watchdog timed out after ${timeoutMs}ms. Resetting sync state.`);
        this.isSyncing = false;
        this.status = this.lastError ? 'error' : 'idle';
        this.notify();
        // Dispatch data-synced so views refresh even after a stuck sync
        if (typeof window !== 'undefined') {
          window.dispatchEvent(new CustomEvent('vyaparsetu:data-synced', { detail: { count: 0, source: 'watchdog-reset' } }));
        }
      }
    }, timeoutMs);
  }

  _clearWatchdog() {
    if (this._watchdog) {
      clearTimeout(this._watchdog);
      this._watchdog = null;
    }
  }

  // ── Supabase REST helpers ──────────────────────────────────────────────────

  _h(key, extra = {}) {
    return {
      'Content-Type': 'application/json',
      apikey: key,
      Authorization: `Bearer ${key}`,
      ...extra,
    };
  }

  async _get(url, key, table, filter = '') {
    const endpoint = filter ? `${url}/rest/v1/${table}?${filter}` : `${url}/rest/v1/${table}`;
    const res = await fetch(endpoint, { headers: this._h(key) });
    if (!res.ok) {
      const txt = await res.text().catch(() => res.status);
      throw new Error(`GET ${table} failed (${res.status}): ${txt}`);
    }
    return res.json();
  }

  async _post(url, key, table, body) {
    if (!body || (Array.isArray(body) && body.length === 0)) return [];
    const res = await fetch(`${url}/rest/v1/${table}`, {
      method: 'POST',
      headers: this._h(key, { Prefer: 'return=representation' }),
      body: JSON.stringify(body),
    });
    if (!res.ok) {
      const txt = await res.text().catch(() => res.status);
      throw new Error(`POST ${table} failed (${res.status}): ${txt}`);
    }
    return res.json();
  }

  async _patch(url, key, table, filter, body) {
    const res = await fetch(`${url}/rest/v1/${table}?${filter}`, {
      method: 'PATCH',
      headers: this._h(key, { Prefer: 'return=representation' }),
      body: JSON.stringify(body),
    });
    if (!res.ok) {
      const txt = await res.text().catch(() => res.status);
      throw new Error(`PATCH ${table} failed (${res.status}): ${txt}`);
    }
    return res.json();
  }

  async _delete(url, key, table, filter) {
    const res = await fetch(`${url}/rest/v1/${table}?${filter}`, {
      method: 'DELETE',
      headers: this._h(key),
    });
    return res.ok;
  }

  // ── Credentials & shop ────────────────────────────────────────────────────

  async _creds() {
    const stats = await this.getSyncStats();
    if (!stats.isConfigured) {
      throw new Error('Supabase credentials not configured. Please enter them in Settings → Cloud Data Sync first.');
    }
    return {
      url: stats.supabaseUrl.trim().replace(/\/+$/, ''),
      key: stats.supabaseAnonKey.trim(),
    };
  }

  async _ensureShop(url, key) {
    let shopId = localStorage.getItem(SHOP_ID_KEY);
    if (shopId) return shopId;

    try {
      const existing = await this._get(url, key, 'shops', 'limit=1');
      if (existing && existing.length > 0) {
        shopId = existing[0].id;
        localStorage.setItem(SHOP_ID_KEY, shopId);
        return shopId;
      }
    } catch (_) {}

    let name = 'My Shop', city = 'Phaltan', mobile = '';
    try {
      const settRes = await settingsApi.getAll();
      const s = settRes?.data || {};
      name   = s.shop_name   || name;
      city   = s.city        || city;
      mobile = s.mobile_number || '';
    } catch (_) {}

    const created = await this._post(url, key, 'shops', [{
      name, city, primary_mobile: mobile,
    }]);
    shopId = created?.[0]?.id;
    if (!shopId) throw new Error('Failed to create shop record in Supabase');
    localStorage.setItem(SHOP_ID_KEY, shopId);
    return shopId;
  }

  // ── testConnection ─────────────────────────────────────────────────────────

  async testConnection(supabaseUrl, supabaseAnonKey) {
    if (!supabaseUrl || !supabaseAnonKey) {
      return { success: false, message: 'Please provide both Supabase Project URL and Public Anon Key.' };
    }

    const cleanUrl = supabaseUrl.trim().replace(/\/+$/, '');
    const cleanKey = supabaseAnonKey.trim();

    if (!cleanUrl.includes('.supabase.co') && !cleanUrl.includes('localhost')) {
      return { success: false, message: 'Invalid URL. It should look like: https://yourproject.supabase.co' };
    }

    try {
      const [healthRes, restRes] = await Promise.all([
        fetch(`${cleanUrl}/auth/v1/health`, {
          method: 'GET', headers: { apikey: cleanKey },
        }).catch(() => null),
        fetch(`${cleanUrl}/rest/v1/shops?limit=1`, {
          method: 'GET',
          headers: { apikey: cleanKey, Authorization: `Bearer ${cleanKey}` },
        }).catch(() => null),
      ]);

      if (restRes && (restRes.status === 401 || restRes.status === 403)) {
        return { success: false, message: `Authentication failed: Invalid Anon Key (${restRes.status}). Please check API settings.` };
      }

      const isHealthOk = healthRes && (healthRes.ok || healthRes.status === 200);
      const isRestOk   = restRes   && (restRes.status < 500);

      if (isHealthOk || isRestOk) {
        this.status = 'connected';
        this.lastError = null;
        this.notify();
        return { success: true, message: '✅ Successfully connected to Supabase Cloud!' };
      }

      return { success: false, message: 'Could not reach Supabase. Check your Project URL.' };
    } catch (err) {
      this.status = 'error';
      this.lastError = err.message;
      this.notify();
      return { success: false, message: `Connection failed: ${err.message}` };
    }
  }

  // ── getSyncStats ───────────────────────────────────────────────────────────

  async getSyncStats() {
    try {
      const mutations   = await dbGetAll('outbox_mutations');
      const pending     = mutations.filter((m) => m.status === 'pending');
      const synced      = mutations.filter((m) => m.status === 'synced');
      let settings = {};
      try {
        const settingsRes = await settingsApi.getAll();
        settings = settingsRes?.data || {};
      } catch (_) {}

      // If mobile standalone, fallback to local settings
      if (!settings.supabase_url && isStandaloneMobile()) {
        try {
          const localSettings = await dbGetAll('settings');
          for (const item of localSettings) {
            if (item.key) settings[item.key] = item.value;
          }
        } catch (_) {}
      }

      const isConfigured = Boolean(settings.supabase_url && settings.supabase_anon_key);
      return {
        total: mutations.length,
        pendingCount: pending.length,
        syncedCount: synced.length,
        isConfigured,
        supabaseUrl: settings.supabase_url || '',
        supabaseAnonKey: settings.supabase_anon_key || '',
        lastSyncTime: this.lastSyncTime || settings.last_cloud_sync || null,
        status: this.status,
      };
    } catch (_) {
      return { total: 0, pendingCount: 0, syncedCount: 0, isConfigured: false, status: 'error' };
    }
  }

  // ── DESKTOP: Push all local SQLite data → Supabase ─────────────────────────

  async pushToSupabase() {
    if (this.isSyncing) return { success: true, message: 'Sync already in progress' };
    this.isSyncing = true;
    this.status = 'syncing';
    this.notify();
    this._startWatchdog(25000);

    try {
      const { url, key } = await this._creds();
      const shopId = await this._ensureShop(url, key);

      const { customersApi, vegetablesApi, transactionApi, billsApi, creditApi } = await import('./apiService');

      let totalSynced = 0;
      const custMap = {};   // legacy_id (int) → Supabase UUID
      const vegMap  = {};   // legacy_id (int) → Supabase UUID
      const billMap = {};   // legacy_id (int) → Supabase UUID
      const txMap   = {};   // legacy_id (int) → Supabase UUID

      // ── 1. Customers ──────────────────────────────────────────────────────
      const custRes = await customersApi.getAll();
      const customers = Array.isArray(custRes?.data)
        ? custRes.data
        : (custRes?.data?.customers || []);

      const sbCusts = await this._get(url, key, 'customers', `shop_id=eq.${shopId}&limit=5000`).catch(() => []);

      for (const c of customers) {
        const legacyId = typeof c.id === 'number' ? c.id : null;
        const rowData = {
          shop_id:         shopId,
          legacy_id:       legacyId,
          name:            (c.name || '').trim(),
          mobile:          (c.mobile || '').trim(),
          address:         c.address || '',
          search_keywords: c.search_keywords || '',
          notes:           c.notes || '',
          credit_balance:  Math.round((parseFloat(c.credit_balance) || 0) * 100),
          commission_rate: c.commission_rate != null ? parseFloat(c.commission_rate) : null,
          is_deleted:      c.is_deleted || false,
        };

        const match = sbCusts.find((sc) =>
          (legacyId !== null && sc.legacy_id === legacyId) ||
          (sc.name && sc.name.trim().toLowerCase() === (c.name || '').trim().toLowerCase())
        );

        if (match) {
          custMap[c.id] = match.id;
          const sbTime = toTimestampMs(match.updated_at || match.created_at);
          const localTime = toTimestampMs(c.updated_at || c.created_at);

          // Conflict resolution: only overwrite Supabase if local desktop record is newer or equal
          if (localTime >= sbTime) {
            await this._patch(url, key, 'customers', `id=eq.${match.id}`, { ...rowData, legacy_id: legacyId });
            totalSynced++;
          }
        } else {
          const created = await this._post(url, key, 'customers', [rowData]);
          if (created?.[0]?.id) {
            custMap[c.id] = created[0].id;
            totalSynced++;
          }
        }
      }
      localStorage.setItem(CUST_MAP_KEY, JSON.stringify(custMap));

      // ── 2. Vegetables ─────────────────────────────────────────────────────
      const vegRes = await vegetablesApi.getAll();
      const vegetables = Array.isArray(vegRes?.data)
        ? vegRes.data
        : (vegRes?.data?.vegetables || []);

      const sbVegs = await this._get(url, key, 'vegetables', `shop_id=eq.${shopId}&limit=5000`).catch(() => []);

      for (const v of vegetables) {
        const legacyId = typeof v.id === 'number' ? v.id : null;
        const rowData = {
          shop_id:         shopId,
          legacy_id:       legacyId,
          name:            (v.name || '').trim(),
          rate:            Math.round((parseFloat(v.rate) || 0) * 100),
          unit:            v.unit || 'kg',
          search_keywords: v.search_keywords || '',
          notes:           v.notes || '',
          is_deleted:      v.is_deleted || false,
        };

        const match = sbVegs.find((sv) =>
          (legacyId !== null && sv.legacy_id === legacyId) ||
          (sv.name && sv.name.trim().toLowerCase() === (v.name || '').trim().toLowerCase())
        );

        if (match) {
          vegMap[v.id] = match.id;
          const sbTime = toTimestampMs(match.updated_at || match.created_at);
          const localTime = toTimestampMs(v.updated_at || v.created_at);

          // Conflict resolution: only overwrite Supabase if local desktop record is newer or equal
          if (localTime >= sbTime) {
            await this._patch(url, key, 'vegetables', `id=eq.${match.id}`, { ...rowData, legacy_id: legacyId });
            totalSynced++;
          }
        } else {
          const created = await this._post(url, key, 'vegetables', [rowData]);
          if (created?.[0]?.id) {
            vegMap[v.id] = created[0].id;
            totalSynced++;
          }
        }
      }
      localStorage.setItem(VEG_MAP_KEY, JSON.stringify(vegMap));

      // ── 3. Transactions ───────────────────────────────────────────────────
      const txRes = await transactionApi.getAll({ limit: 5000 });
      const transactions = Array.isArray(txRes?.data)
        ? txRes.data
        : (txRes?.data?.transactions || txRes?.data?.data || []);

      const sbTxs = await this._get(url, key, 'transactions', `shop_id=eq.${shopId}&limit=5000`).catch(() => []);

      const validTxs = transactions.filter((tx) => custMap[tx.customer_id] && vegMap[tx.vegetable_id]);
      for (const tx of validTxs) {
        const legacyIdStr = `desktop-tx-${tx.id}`;
        const rowData = {
          shop_id:                 shopId,
          legacy_id:               legacyIdStr,
          customer_id:             custMap[tx.customer_id],
          vegetable_id:            vegMap[tx.vegetable_id],
          vegetable_name_snapshot: tx.vegetable_name_snapshot || tx.vegetable_name || '',
          weight:                  parseFloat(tx.weight) || 0,
          unit:                    tx.unit || 'kg',
          rate:                    Math.round((parseFloat(tx.rate) || 0) * 100),
          base_amount:             Math.round((parseFloat(tx.base_amount) || 0) * 100),
          commission_rate:         parseFloat(tx.commission_rate) || 8.0,
          commission_amount:       Math.round((parseFloat(tx.commission_amount) || 0) * 100),
          final_amount:            Math.round((parseFloat(tx.final_amount) || 0) * 100),
          payment_type:            tx.payment_type || 'Credit',
          payment_mode:            tx.payment_mode || tx.payment_type || 'Credit',
          paid_amount:             Math.round((parseFloat(tx.paid_amount) || 0) * 100),
          remaining_amount:        Math.round((parseFloat(tx.remaining_amount) || 0) * 100),
          transaction_date:        tx.transaction_date || tx.date || new Date().toISOString().split('T')[0],
        };

        const match = sbTxs.find((st) => st.legacy_id === legacyIdStr);
        if (match) {
          txMap[tx.id] = match.id;
          const sbTime = toTimestampMs(match.updated_at || match.created_at);
          const localTime = toTimestampMs(tx.updated_at || tx.created_at);
          if (localTime >= sbTime) {
            await this._patch(url, key, 'transactions', `id=eq.${match.id}`, rowData);
            totalSynced++;
          }
        } else {
          const created = await this._post(url, key, 'transactions', [rowData]);
          if (created?.[0]?.id) {
            txMap[tx.id] = created[0].id;
            totalSynced++;
          }
        }
      }

      // ── 4. Bills ──────────────────────────────────────────────────────────
      const billsRes = await billsApi.getAll();
      const bills = Array.isArray(billsRes?.data) ? billsRes.data : [];
      const sbBills = await this._get(url, key, 'bills', `shop_id=eq.${shopId}&limit=5000`).catch(() => []);

      const validBills = bills.filter((b) => custMap[b.customer_id]);
      for (const b of validBills) {
        const billNum = b.bill_number || `B-${b.id}`;
        const rowData = {
          shop_id:           shopId,
          bill_number:       billNum,
          customer_id:       custMap[b.customer_id],
          date:              b.date || new Date().toISOString().split('T')[0],
          period_start:      b.period_start || b.date,
          period_end:        b.period_end || b.date,
          subtotal:          Math.round((parseFloat(b.subtotal) || 0) * 100),
          discount_amount:   Math.round((parseFloat(b.discount_amount) || 0) * 100),
          commission_rate:   parseFloat(b.commission_rate) || 8.0,
          commission_amount: Math.round((parseFloat(b.commission_amount) || 0) * 100),
          hamali_amount:     Math.round((parseFloat(b.hamali_amount) || 0) * 100),
          transport_amount:  Math.round((parseFloat(b.transport_amount) || 0) * 100),
          final_amount:      Math.round((parseFloat(b.final_amount) || 0) * 100),
          paid_amount:       Math.round((parseFloat(b.paid_amount) || 0) * 100),
          remaining_amount:  Math.round((parseFloat(b.remaining_amount) || 0) * 100),
          payment_type:      b.payment_type || 'Credit',
          payment_status:    b.payment_status || 'Partial',
        };

        let sbBillId = null;
        const match = sbBills.find((sb) => sb.bill_number === billNum);
        if (match) {
          await this._patch(url, key, 'bills', `id=eq.${match.id}`, rowData);
          sbBillId = match.id;
        } else {
          const created = await this._post(url, key, 'bills', [rowData]);
          if (created?.[0]?.id) sbBillId = created[0].id;
        }

        if (sbBillId) {
          billMap[b.id] = sbBillId;
          totalSynced++;

          // ── 5. Bill Items ─────────────────────────────────────────────────
          await this._delete(url, key, 'bill_items', `bill_id=eq.${sbBillId}`).catch(() => {});

          let items = Array.isArray(b.items) ? b.items : [];
          if (items.length === 0) {
            try {
              const detailRes = await billsApi.getById(b.id);
              items = detailRes?.data?.items || [];
            } catch (_) {}
          }

          const currentBillItems = items.map((item) => ({
            bill_id:        sbBillId,
            vegetable_id:   item.vegetable_id ? vegMap[item.vegetable_id] || null : null,
            vegetable_name: item.vegetable_name || 'Produce',
            quantity:       parseFloat(item.quantity) || 0,
            rate:           Math.round((parseFloat(item.rate) || 0) * 100),
            total:          Math.round((parseFloat(item.total) || 0) * 100),
            item_date:      item.item_date || b.date,
          }));

          if (currentBillItems.length > 0) {
            await this._post(url, key, 'bill_items', currentBillItems);
            totalSynced += currentBillItems.length;
          }
        }
      }
      localStorage.setItem(BILL_MAP_KEY, JSON.stringify(billMap));

      // ── 6. Credit Transactions (Udhar Passbook) ───────────────────────────
      let creditTxList = [];
      try {
        const crRes = await creditApi.getAllTransactions();
        creditTxList = Array.isArray(crRes?.data) ? crRes.data : [];
      } catch (_) {}

      if (creditTxList.length > 0) {
        // Fetch existing Supabase credit transactions to avoid blind deletion of mobile-recorded entries
        const existingCredits = await this._get(url, key, 'credit_transactions', `shop_id=eq.${shopId}&limit=5000`).catch(() => []);

        for (const ct of creditTxList) {
          const custSbId = custMap[ct.customer_id];
          if (!custSbId) continue;

          const ctAmountPaise = Math.round((parseFloat(ct.amount) || 0) * 100);
          const ctDate = ct.date || (ct.created_at ? ct.created_at.slice(0, 10) : new Date().toISOString().slice(0, 10));

          const cleanMode = ct.payment_mode && ct.payment_mode !== 'Credit' ? `[${ct.payment_mode}] ` : '';
          const rawNote = (ct.note || ct.notes || '').replace(/\[(Desktop|Mobile|Supabase):[^\]]*\]/g, '').replace(/\[(Cash|UPI|Other)\]/g, '').trim();
          const noteText = `[Desktop:ctx-${ct.id}] ${cleanMode}${rawNote}`.trim();

          const rowData = {
            shop_id:          shopId,
            customer_id:      custSbId,
            bill_id:          ct.bill_id ? billMap[ct.bill_id] || null : null,
            transaction_id:   ct.transaction_id ? txMap[ct.transaction_id] || null : null,
            transaction_type: ct.transaction_type || 'CREDIT_ADDED',
            amount:           ctAmountPaise,
            notes:            noteText,
            date:             ctDate,
          };

          // Check if already in Supabase by desktop tag or exact match
          const exists = existingCredits.find((ec) =>
            (ec.notes && ec.notes.includes(`[Desktop:ctx-${ct.id}]`)) ||
            (ec.customer_id === custSbId &&
             ec.transaction_type === rowData.transaction_type &&
             Number(ec.amount) === ctAmountPaise &&
             ec.date === ctDate)
          );

          if (exists) {
            // If exists but lacks desktop tag, patch it
            if (exists.notes && !exists.notes.includes(`[Desktop:ctx-${ct.id}]`)) {
              await this._patch(url, key, 'credit_transactions', `id=eq.${exists.id}`, { notes: noteText }).catch(() => {});
            }
          } else {
            await this._post(url, key, 'credit_transactions', [rowData]);
            totalSynced++;
          }
        }
      }

      this.status = 'connected';
      this.lastSyncTime = new Date().toISOString();
      try { await settingsApi.updateBulk({ last_cloud_sync: this.lastSyncTime }); } catch (_) {}
      this.notify();

      if (typeof window !== 'undefined') {
        window.dispatchEvent(new CustomEvent('vyaparsetu:data-synced', { detail: { count: totalSynced } }));
      }

      return {
        success: true,
        syncedCount: totalSynced,
        message: `✅ Pushed to Supabase: ${customers.length} customers, ${vegetables.length} vegetables, ${validTxs.length} transactions, ${validBills.length} bills, ${creditTxList.length} credit entries.`,
      };
    } catch (err) {
      this.status = 'error';
      this.lastError = err.message;
      this.notify();
      return { success: false, message: `Push failed: ${err.message}` };
    } finally {
      this._clearWatchdog();
      this.isSyncing = false;
    }
  }

  // ── DESKTOP: Pull new cloud entries from Supabase → Desktop SQLite ─────────

  async pullToDesktopSQLite(url, key, shopId) {
    try {
      const { customersApi, vegetablesApi, transactionApi, billsApi, creditApi } = await import('./apiService');

      // 1. Ingest mobile-created customers from Supabase into SQLite
      const sbCusts = await this._get(url, key, 'customers', `shop_id=eq.${shopId}&limit=5000`).catch(() => []);
      const custRes = await customersApi.getAll();
      const localCusts = Array.isArray(custRes?.data) ? custRes.data : (custRes?.data?.customers || []);

      for (const sc of sbCusts) {
        const normName = sc.name ? sc.name.trim().toLowerCase() : '';
        const match = localCusts.find((lc) =>
          (sc.legacy_id != null && lc.id === Number(sc.legacy_id)) ||
          (lc.name && lc.name.trim().toLowerCase() === normName)
        );

        // If customer was marked deleted on Supabase, remove from local SQLite
        if (sc.is_deleted) {
          if (match) {
            await customersApi.remove(match.id).catch(() => {});
            const idx = localCusts.findIndex((lc) => lc.id === match.id);
            if (idx !== -1) localCusts.splice(idx, 1);
          }
          continue;
        }

        if (match) {
          const sbTime = toTimestampMs(sc.updated_at || sc.created_at);
          const localTime = toTimestampMs(match.updated_at || match.created_at);

          // If Supabase has fresher updates from mobile, update local SQLite
          if (sbTime > localTime + 1000) {
            await customersApi.update(match.id, {
              name: sc.name.trim(),
              mobile: sc.mobile || '',
              address: sc.address || '',
              notes: sc.notes || '',
              commission_rate: sc.commission_rate != null ? parseFloat(sc.commission_rate) : undefined,
            }).catch(() => {});
          }

          if (sc.legacy_id !== match.id) {
            await this._patch(url, key, 'customers', `id=eq.${sc.id}`, { legacy_id: match.id }).catch(() => {});
          }
        } else if (sc.name) {
          const createdRes = await customersApi.create({
            name: sc.name.trim(),
            mobile: sc.mobile || '',
            address: sc.address || '',
            notes: sc.notes || '',
            credit_balance: (sc.credit_balance || 0) / 100, // API expects rupees
            commission_rate: sc.commission_rate != null ? parseFloat(sc.commission_rate) : null,
          });
          const newId = createdRes?.data?.id;
          if (newId) {
            await this._patch(url, key, 'customers', `id=eq.${sc.id}`, { legacy_id: newId }).catch(() => {});
            localCusts.push({ id: newId, name: sc.name.trim(), updated_at: sc.updated_at });
          }
        }
      }

      // 2. Ingest mobile-created vegetables from Supabase into SQLite
      const sbVegs = await this._get(url, key, 'vegetables', `shop_id=eq.${shopId}&limit=5000`).catch(() => []);
      const vegRes = await vegetablesApi.getAll();
      const localVegs = Array.isArray(vegRes?.data) ? vegRes.data : (vegRes?.data?.vegetables || []);

      for (const sv of sbVegs) {
        const normName = sv.name ? sv.name.trim().toLowerCase() : '';
        const match = localVegs.find((lv) =>
          (sv.legacy_id != null && lv.id === Number(sv.legacy_id)) ||
          (lv.name && lv.name.trim().toLowerCase() === normName)
        );

        // If vegetable was marked deleted on Supabase, remove from local SQLite
        if (sv.is_deleted) {
          if (match) {
            await vegetablesApi.remove(match.id).catch(() => {});
            const idx = localVegs.findIndex((lv) => lv.id === match.id);
            if (idx !== -1) localVegs.splice(idx, 1);
          }
          continue;
        }

        const sbRateRupees = (sv.rate || 0) / 100;

        if (match) {
          const sbTime = toTimestampMs(sv.updated_at || sv.created_at);
          const localTime = toTimestampMs(match.updated_at || match.created_at);

          // If Supabase has fresher updates from mobile, update local SQLite
          if (sbTime > localTime + 1000) {
            await vegetablesApi.update(match.id, {
              name: sv.name.trim(),
              rate: sbRateRupees,
              unit: sv.unit || 'kg',
              notes: sv.notes || '',
            }).catch(() => {});
          }

          if (sv.legacy_id !== match.id) {
            await this._patch(url, key, 'vegetables', `id=eq.${sv.id}`, { legacy_id: match.id }).catch(() => {});
          }
        } else if (sv.name) {
          const createdRes = await vegetablesApi.create({
            name: sv.name.trim(),
            rate: sbRateRupees,
            unit: sv.unit || 'kg',
            notes: sv.notes || '',
          });
          const newId = createdRes?.data?.id;
          if (newId) {
            await this._patch(url, key, 'vegetables', `id=eq.${sv.id}`, { legacy_id: newId }).catch(() => {});
            localVegs.push({ id: newId, name: sv.name.trim(), rate: sbRateRupees, updated_at: sv.updated_at });
          }
        }
      }

      // Refresh local lookups after potential additions
      const updatedCustRes = await customersApi.getAll();
      const updatedCusts = Array.isArray(updatedCustRes?.data) ? updatedCustRes.data : (updatedCustRes?.data?.customers || []);
      const updatedVegRes = await vegetablesApi.getAll();
      const updatedVegs = Array.isArray(updatedVegRes?.data) ? updatedVegRes.data : (updatedVegRes?.data?.vegetables || []);

      // 3. Ingest mobile-created transactions from Supabase into SQLite
      const sbTxs = await this._get(url, key, 'transactions', `shop_id=eq.${shopId}&limit=5000&order=transaction_date.asc`).catch(() => []);
      const txRes = await transactionApi.getAll({ limit: 5000 });
      const localTxs = Array.isArray(txRes?.data) ? txRes.data : (txRes?.data?.transactions || []);

      for (const st of sbTxs) {
        if (st.legacy_id && String(st.legacy_id).startsWith('desktop-tx-')) {
          const desktopId = Number(st.legacy_id.replace('desktop-tx-', ''));
          const localTx = localTxs.find((lt) => lt.id === desktopId);
          if (localTx) {
            const sbTime = toTimestampMs(st.updated_at || st.created_at);
            const localTime = toTimestampMs(localTx.updated_at || localTx.created_at);
            if (sbTime > localTime + 1000) {
              const txRateRupees = (st.rate || 0) / 100;
              await transactionApi.update(localTx.id, {
                weight: st.weight,
                unit: st.unit || 'kg',
                rate: txRateRupees,
                commission_rate: st.commission_rate || 8,
                payment_type: st.payment_type || 'Credit',
                payment_mode: st.payment_mode || st.payment_type || 'Credit',
                transaction_date: st.transaction_date,
              }).catch(() => {});
            }
            continue;
          }
        }

        const targetCust = updatedCusts.find((c) =>
          sbCusts.some((sc) => sc.id === st.customer_id && (
            sc.legacy_id === c.id ||
            (sc.name && c.name && sc.name.trim().toLowerCase() === c.name.trim().toLowerCase())
          ))
        ) || updatedCusts[0];

        const targetVeg = updatedVegs.find((v) =>
          sbVegs.some((sv) => sv.id === st.vegetable_id && (
            sv.legacy_id === v.id ||
            (sv.name && v.name && sv.name.trim().toLowerCase() === v.name.trim().toLowerCase())
          ))
        ) || updatedVegs[0];

        if (targetCust && targetVeg) {
          // Supabase always stores rate in whole paise — always divide by 100
          const txRateRupees = (st.rate || 0) / 100;

          const alreadyInLocal = localTxs.find((lt) =>
            lt.customer_id === targetCust.id &&
            lt.vegetable_id === targetVeg.id &&
            Math.abs(Number(lt.weight) - Number(st.weight)) < 0.001 &&
            Math.abs(Number(lt.rate) - txRateRupees) < 0.01 &&
            (lt.transaction_date === st.transaction_date || lt.date === st.transaction_date)
          );

          if (alreadyInLocal) {
            await this._patch(url, key, 'transactions', `id=eq.${st.id}`, { legacy_id: `desktop-tx-${alreadyInLocal.id}` }).catch(() => {});
          } else {
            const createdTxRes = await transactionApi.create({
              customer_id: targetCust.id,
              vegetable_id: targetVeg.id,
              vegetable_name_snapshot: st.vegetable_name_snapshot || targetVeg.name,
              weight: st.weight,
              unit: st.unit || 'kg',
              rate: txRateRupees,
              commission_rate: st.commission_rate || 8,
              payment_type: st.payment_type || 'Credit',
              payment_mode: st.payment_mode || st.payment_type || 'Credit',
              transaction_date: st.transaction_date,
            });
            const newTxId = createdTxRes?.data?.id;
            if (newTxId) {
              await this._patch(url, key, 'transactions', `id=eq.${st.id}`, { legacy_id: `desktop-tx-${newTxId}` }).catch(() => {});
              localTxs.push({
                id: newTxId,
                customer_id: targetCust.id,
                vegetable_id: targetVeg.id,
                weight: st.weight,
                rate: txRateRupees,
                transaction_date: st.transaction_date,
              });
            }
          }
        }
      }

      // 4. Ingest mobile-recorded payments into SQLite
      const sbCredits = await this._get(url, key, 'credit_transactions', `shop_id=eq.${shopId}&limit=5000`).catch(() => []);
      const crRes = await creditApi.getAllTransactions();
      const localCredits = Array.isArray(crRes?.data) ? crRes.data : [];

      for (const sc of sbCredits) {
        if (sc.transaction_type === 'PAYMENT_RECEIVED') {
          // If this payment originated on Desktop, DO NOT re-ingest it!
          if (sc.notes && sc.notes.includes('[Desktop:')) {
            continue;
          }

          const targetCust = updatedCusts.find((c) =>
            sbCusts.find((scust) => scust.id === sc.customer_id && (scust.legacy_id === c.id || scust.name?.trim().toLowerCase() === c.name?.trim().toLowerCase()))
          );
          if (targetCust) {
            const scAmtRupees = (sc.amount || 0) / 100;
            // Check if SQLite already ingested this specific Supabase record by UUID or exact match
            const alreadyIngested = localCredits.some((lc) =>
              (lc.note && lc.note.includes(sc.id)) ||
              (lc.customer_id === targetCust.id &&
               lc.transaction_type === 'PAYMENT_RECEIVED' &&
               Math.abs(Number(lc.amount) - scAmtRupees) < 0.01 &&
               (lc.date === sc.date || lc.created_at?.slice(0, 10) === sc.date))
            );

            if (!alreadyIngested) {
              let paymentMode = 'Cash';
              let rawNote = sc.notes || '';
              const m = rawNote.match(/\[(Cash|UPI|Other)\]/i);
              if (m) {
                paymentMode = m[1].charAt(0).toUpperCase() + m[1].slice(1).toLowerCase();
                if (!['Cash', 'UPI', 'Other'].includes(paymentMode)) paymentMode = 'Cash';
              }
              const cleanNote = rawNote.replace(/\[Desktop:[^\]]*\]/g, '').replace(/\[Mobile:[^\]]*\]/g, '').replace(/\[(Cash|UPI|Other)\]/g, '').trim();
              const noteWithOrigin = `[Supabase:${sc.id}] ${cleanNote}`.trim();

              const createdPayRes = await creditApi.collectPayment({
                customer_id: targetCust.id,
                amount: scAmtRupees,
                payment_mode: paymentMode,
                notes: noteWithOrigin,
                note: noteWithOrigin,
                date: sc.date,
                created_at: sc.created_at ? sc.created_at.replace('T', ' ').slice(0, 19) : `${sc.date} 12:00:00`,
              });

              if (createdPayRes?.success) {
                localCredits.push({
                  customer_id: targetCust.id,
                  transaction_type: 'PAYMENT_RECEIVED',
                  amount: scAmtRupees,
                  date: sc.date,
                  note: noteWithOrigin,
                });
              }
            }
          }
        }
      }
    } catch (err) {
      console.warn('Desktop pull error (continuing with push):', err);
    }
  }

  // ── MOBILE: Pull all data Supabase → IndexedDB ─────────────────────────────

  async pullFromSupabase() {
    if (this.isSyncing) return { success: true, message: 'Sync already in progress' };
    this.isSyncing = true;
    this.status = 'syncing';
    this.notify();
    this._startWatchdog(25000);

    try {
      const { url, key } = await this._creds();

      let shopId = localStorage.getItem(SHOP_ID_KEY);
      if (!shopId) {
        const shops = await this._get(url, key, 'shops', 'limit=1');
        if (shops && shops.length > 0) {
          shopId = shops[0].id;
          localStorage.setItem(SHOP_ID_KEY, shopId);
        }
      }
      if (!shopId) {
        return {
          success: false,
          message: 'No shop found in Supabase. Please sync from desktop first (Settings → Cloud Data Sync → Sync Now on desktop), then retry here.',
        };
      }

      let totalPulled = 0;
      const uuidToCustLegacy = {};
      const nameToCustLegacy = {};
      const uuidToVegLegacy  = {};
      const nameToVegLegacy  = {};
      const uuidToBillLegacy = {};
      const uuidToTxLegacy   = {};

      // ── 1. Customers ──────────────────────────────────────────────────────
      const sbCustomers = await this._get(
        url, key, 'customers',
        `shop_id=eq.${shopId}&is_deleted=eq.false&limit=5000&order=created_at.asc`
      );

      // Map ALL historical and canonical UUIDs for customers
      for (const c of sbCustomers) {
        const normName = c.name ? c.name.trim().toLowerCase() : '';
        const existingByName = normName ? nameToCustLegacy[normName] : null;
        const localId = c.legacy_id != null ? Number(c.legacy_id) : (existingByName != null ? existingByName : c.id);
        uuidToCustLegacy[c.id] = localId;
        if (normName) {
          nameToCustLegacy[normName] = localId;
        }
      }

      // Deduplicate for writing into IndexedDB
      const dedupedCusts = new Map();
      for (const c of sbCustomers) {
        const key = c.legacy_id != null ? `id-${c.legacy_id}` : `name-${(c.name || '').trim().toLowerCase()}`;
        dedupedCusts.set(key, c);
      }

      const localCusts = await dbGetAll('customers');
      for (const c of dedupedCusts.values()) {
        const normName = c.name ? c.name.trim().toLowerCase() : '';
        let localCust = localCusts.find((lc) =>
          (lc._supabase_id && lc._supabase_id === c.id) ||
          (lc.name && lc.name.trim().toLowerCase() === normName)
        );
        let localId;
        if (localCust) {
          localId = localCust.id;
        } else if (c.legacy_id != null) {
          localId = Number(c.legacy_id);
        } else {
          localId = localCusts.length > 0 ? Math.max(...localCusts.map((cu) => Number(cu.id) || 0)) + 1 : 1;
        }
        const updatedCustObj = {
          id:              localId,
          name:            c.name || '',
          mobile:          c.mobile || '',
          address:         c.address || '',
          search_keywords: c.search_keywords || '',
          notes:           c.notes || '',
          credit_balance:  Number(c.credit_balance || 0), // STORE IN WHOLE PAISE
          commission_rate: c.commission_rate != null ? parseFloat(c.commission_rate) : null,
          is_deleted:      c.is_deleted || false,
          _supabase_id:    c.id,
        };
        await dbPut('customers', updatedCustObj);
        localCusts.push(updatedCustObj);
        uuidToCustLegacy[c.id] = localId;
        if (normName) nameToCustLegacy[normName] = localId;
      }
      totalPulled += dedupedCusts.size;

      // ── 2. Vegetables ─────────────────────────────────────────────────────
      const sbVegetables = await this._get(
        url, key, 'vegetables',
        `shop_id=eq.${shopId}&is_deleted=eq.false&limit=5000&order=created_at.asc`
      );

      for (const v of sbVegetables) {
        const normName = v.name ? v.name.trim().toLowerCase() : '';
        const existingByName = normName ? nameToVegLegacy[normName] : null;
        const localId = v.legacy_id != null ? Number(v.legacy_id) : (existingByName != null ? existingByName : v.id);
        uuidToVegLegacy[v.id] = localId;
        if (normName) {
          nameToVegLegacy[normName] = localId;
        }
      }

      const dedupedVegs = new Map();
      for (const v of sbVegetables) {
        const key = v.legacy_id != null ? `id-${v.legacy_id}` : `name-${(v.name || '').trim().toLowerCase()}`;
        dedupedVegs.set(key, v);
      }

      const localVegs = await dbGetAll('vegetables');
      for (const v of dedupedVegs.values()) {
        const normName = v.name ? v.name.trim().toLowerCase() : '';
        let localVeg = localVegs.find((lv) =>
          (lv._supabase_id && lv._supabase_id === v.id) ||
          (lv.name && lv.name.trim().toLowerCase() === normName)
        );
        let localId;
        if (localVeg) {
          localId = localVeg.id;
        } else if (v.legacy_id != null) {
          localId = Number(v.legacy_id);
        } else {
          localId = localVegs.length > 0 ? Math.max(...localVegs.map((ve) => Number(ve.id) || 0)) + 1 : 1;
        }
        const updatedVegObj = {
          id:              localId,
          name:            v.name || '',
          rate:            Number(v.rate || 0), // STORE IN WHOLE PAISE
          unit:            v.unit || 'kg',
          search_keywords: v.search_keywords || '',
          notes:           v.notes || '',
          is_deleted:      v.is_deleted || false,
          _supabase_id:    v.id,
        };
        await dbPut('vegetables', updatedVegObj);
        localVegs.push(updatedVegObj);
        uuidToVegLegacy[v.id] = localId;
        if (normName) nameToVegLegacy[normName] = localId;
      }
      totalPulled += dedupedVegs.size;

      // ── 3. Transactions ───────────────────────────────────────────────────
      const sbTransactions = await this._get(
        url, key, 'transactions',
        `shop_id=eq.${shopId}&limit=5000&order=transaction_date.desc`
      );

      const dedupedTxs = new Map();
      for (const tx of sbTransactions) {
        const key = tx.legacy_id ? tx.legacy_id : tx.id;
        dedupedTxs.set(key, tx);
      }

      const localTxs = await dbGetAll('transactions');
      for (const tx of dedupedTxs.values()) {
        let custLocalId = uuidToCustLegacy[tx.customer_id];
        if (custLocalId == null && tx.customer_name) {
          custLocalId = nameToCustLegacy[tx.customer_name.trim().toLowerCase()];
        }
        if (custLocalId == null) {
          custLocalId = tx.customer_id;
        }

        let vegLocalId = uuidToVegLegacy[tx.vegetable_id];
        if (vegLocalId == null && tx.vegetable_name_snapshot) {
          vegLocalId = nameToVegLegacy[tx.vegetable_name_snapshot.trim().toLowerCase()];
        }
        if (vegLocalId == null) {
          vegLocalId = tx.vegetable_id;
        }

        let localTx = localTxs.find((lt) =>
          (lt._supabase_id && lt._supabase_id === tx.id) ||
          (tx.legacy_id && String(tx.legacy_id) === `mobile-tx-${lt.id}`)
        );

        let localId;
        if (localTx) {
          localId = localTx.id;
        } else if (tx.legacy_id && String(tx.legacy_id).startsWith('mobile-tx-')) {
          localId = Number(tx.legacy_id.replace('mobile-tx-', ''));
        } else {
          localId = localTxs.length > 0 ? Math.max(...localTxs.map((t) => Number(t.id) || 0)) + 1 : 1;
        }

        uuidToTxLegacy[tx.id] = localId;

        const updatedTxObj = {
          id:                     localId,
          customer_id:            custLocalId,
          vegetable_id:           vegLocalId,
          vegetable_name:         tx.vegetable_name_snapshot || '',
          vegetable_name_snapshot: tx.vegetable_name_snapshot || '',
          weight:                 parseFloat(tx.weight) || 0,
          unit:                   tx.unit || 'kg',
          rate:                   Number(tx.rate || 0), // STORE IN WHOLE PAISE
          base_amount:            Number(tx.base_amount || 0), // STORE IN WHOLE PAISE
          commission_rate:        parseFloat(tx.commission_rate) || 8.0,
          commission_amount:      Number(tx.commission_amount || 0), // STORE IN WHOLE PAISE
          final_amount:           Number(tx.final_amount || 0), // STORE IN WHOLE PAISE
          payment_type:           tx.payment_type || 'Credit',
          payment_mode:           tx.payment_mode || tx.payment_type || 'Credit',
          paid_amount:            Number(tx.paid_amount || 0), // STORE IN WHOLE PAISE
          remaining_amount:       Number(tx.remaining_amount || 0), // STORE IN WHOLE PAISE
          transaction_date:       tx.transaction_date,
          date:                   tx.transaction_date,
          bill_id:                tx.bill_id ? uuidToBillLegacy[tx.bill_id] || null : null,
          _supabase_id:           tx.id,
        };
        await dbPut('transactions', updatedTxObj);
        localTxs.push(updatedTxObj);
      }
      totalPulled += dedupedTxs.size;

      // ── 4. Bills ──────────────────────────────────────────────────────────
      const sbBills = await this._get(
        url, key, 'bills',
        `shop_id=eq.${shopId}&limit=5000&order=date.desc`
      );

      const dedupedBills = new Map();
      for (const b of sbBills) {
        dedupedBills.set(b.bill_number, b);
      }

      for (const b of dedupedBills.values()) {
        const localId     = b.bill_number ? Number(String(b.bill_number).replace(/^[^\d]*/, '')) || b.id : b.id;
        const custLocalId = uuidToCustLegacy[b.customer_id] ?? b.customer_id;
        uuidToBillLegacy[b.id] = localId;

        await dbPut('bills', {
          id:                localId,
          bill_number:       b.bill_number,
          customer_id:       custLocalId,
          date:              b.date,
          period_start:      b.period_start || b.date,
          period_end:        b.period_end || b.date,
          subtotal:          Number(b.subtotal || 0), // WHOLE PAISE
          discount_type:     'fixed',
          discount_value:    0,
          discount_amount:   Number(b.discount_amount || 0), // WHOLE PAISE
          commission_rate:   parseFloat(b.commission_rate) || 8.0,
          commission_amount: Number(b.commission_amount || 0), // WHOLE PAISE
          hamali_amount:     Number(b.hamali_amount || 0), // WHOLE PAISE
          transport_amount:  Number(b.transport_amount || 0), // WHOLE PAISE
          final_amount:      Number(b.final_amount || 0), // WHOLE PAISE
          paid_amount:       Number(b.paid_amount || 0), // WHOLE PAISE
          remaining_amount:  Number(b.remaining_amount || 0), // WHOLE PAISE
          payment_type:      b.payment_type || 'Credit',
          payment_status:    b.payment_status || 'Partial',
          _supabase_id:      b.id,
        });
      }
      totalPulled += dedupedBills.size;

      // ── 5. Bill Items ─────────────────────────────────────────────────────
      if (dedupedBills.size > 0) {
        for (const b of dedupedBills.values()) {
          const items = await this._get(url, key, 'bill_items', `bill_id=eq.${b.id}&limit=500`).catch(() => []);
          const localBillId = uuidToBillLegacy[b.id];
          for (const item of items) {
            await dbPut('bill_items', {
              id:             item.id,
              bill_id:        localBillId,
              vegetable_id:   uuidToVegLegacy[item.vegetable_id] || item.vegetable_id,
              vegetable_name: item.vegetable_name,
              quantity:       parseFloat(item.quantity) || 0,
              rate:           Number(item.rate || 0), // WHOLE PAISE
              total:          Number(item.total || 0), // WHOLE PAISE
              item_date:      item.item_date,
              _supabase_id:   item.id,
            });
          }
        }
      }

      // ── 6. Credit Transactions ────────────────────────────────────────────
      const sbCredits = await this._get(
        url, key, 'credit_transactions',
        `shop_id=eq.${shopId}&limit=5000&order=created_at.asc`
      );

      const existingLocalCredits = await dbGetAll('credit_transactions');
      const maxLocalId = existingLocalCredits.reduce((max, c) => Math.max(max, Number(c.id) || 0), 0);
      let nextId = maxLocalId + 1;

      for (let idx = 0; idx < sbCredits.length; idx++) {
        const ct = sbCredits[idx];
        const custLocalId = uuidToCustLegacy[ct.customer_id] ?? ct.customer_id;
        const billLocalId = ct.bill_id ? uuidToBillLegacy[ct.bill_id] || null : null;
        const txLocalId   = ct.transaction_id ? uuidToTxLegacy[ct.transaction_id] || null : null;

        let paymentMode = ct.payment_mode || 'Cash';
        let rawNote = ct.notes || '';
        const mMode = rawNote.match(/\[(Cash|UPI|Other)\]/i);
        if (mMode) {
          paymentMode = mMode[1].charAt(0).toUpperCase() + mMode[1].slice(1).toLowerCase();
        }

        const displayNote = rawNote
          .replace(/\[Desktop:[^\]]*\]/g, '')
          .replace(/\[Mobile:[^\]]*\]/g, '')
          .replace(/\[Supabase:[^\]]*\]/g, '')
          .replace(/\[(Cash|UPI|Other)\]/g, '')
          .trim();

        const ctDate = ct.date || (ct.created_at ? ct.created_at.slice(0, 10) : new Date().toISOString().slice(0, 10));

        // Find existing local row by Supabase UUID or exact transaction match
        const existing = existingLocalCredits.find((lc) =>
          lc._supabase_id === ct.id ||
          (rawNote && lc.notes && lc.notes.includes(rawNote)) ||
          (lc.customer_id === custLocalId &&
           lc.transaction_type === ct.transaction_type &&
           Number(lc.amount) === Number(ct.amount) &&
           lc.date === ctDate)
        );

        const assignedId = existing ? existing.id : nextId++;

        await dbPut('credit_transactions', {
          id:               assignedId,
          customer_id:      custLocalId,
          bill_id:          billLocalId,
          transaction_id:   txLocalId,
          transaction_type: ct.transaction_type,
          amount:           Number(ct.amount || 0), // WHOLE PAISE
          payment_mode:     paymentMode,
          note:             displayNote,
          notes:            displayNote,
          date:             ctDate,
          created_at:       ct.created_at,
          _supabase_id:     ct.id,
        });
      }
      totalPulled += sbCredits.length;

      this.status = 'connected';
      this.lastSyncTime = new Date().toISOString();
      try { await settingsApi.updateBulk({ last_cloud_sync: this.lastSyncTime }); } catch (_) {}
      this.notify();

      if (typeof window !== 'undefined') {
        window.dispatchEvent(new CustomEvent('vyaparsetu:data-synced', { detail: { count: totalPulled } }));
      }

      return {
        success: true,
        syncedCount: totalPulled,
        message: `✅ Pulled from Supabase: ${dedupedCusts.size} customers, ${dedupedVegs.size} vegetables, ${dedupedTxs.size} transactions, ${dedupedBills.size} bills, ${sbCredits.length} credit entries.`,
      };
    } catch (err) {
      this.status = 'error';
      this.lastError = err.message;
      this.notify();
      return { success: false, message: `Pull failed: ${err.message}` };
    } finally {
      this._clearWatchdog();
      this.isSyncing = false;
    }
  }

  // ── Mobile outbox mutations push ──────────────────────────────────────────

  async pushOutboxMutations(url, key, shopId) {
    try {
      const mutations = await dbGetAll('outbox_mutations');
      const pending = mutations.filter((m) => m.status === 'pending');
      if (pending.length === 0) return 0;

      let pushed = 0;
      for (const m of pending) {
        let payload = null;
        try { payload = JSON.parse(m.payload); } catch (_) { continue; }
        let success = false;

        if (m.command_type === 'CreateCustomer') {
          const res = await this._post(url, key, 'customers', [{
            shop_id: shopId,
            name: (payload.name || '').trim(),
            mobile: (payload.mobile || '').trim(),
            address: payload.address || '',
            notes: payload.notes || '',
            credit_balance: Math.round((parseFloat(payload.credit_balance || payload.opening_balance) || 0) * 100),
            commission_rate: payload.commission_rate != null ? parseFloat(payload.commission_rate) : null,
            is_deleted: false,
          }]);
          if (res?.[0]?.id) {
            await dbPut('customers', { ...payload, _supabase_id: res[0].id }).catch(() => {});
            success = true;
          } else if (res) {
            success = true;
          }
        } else if (m.command_type === 'UpdateCustomer') {
          const filter = payload._supabase_id
            ? `shop_id=eq.${shopId}&id=eq.${payload._supabase_id}`
            : `shop_id=eq.${shopId}&name=eq.${encodeURIComponent(payload.name || '')}`;
          const res = await this._patch(url, key, 'customers', filter, {
            name: payload.name ? payload.name.trim() : undefined,
            mobile: payload.mobile ? payload.mobile.trim() : undefined,
            address: payload.address,
            notes: payload.notes,
            commission_rate: payload.commission_rate != null ? parseFloat(payload.commission_rate) : undefined,
          });
          if (res) success = true;
        } else if (m.command_type === 'DeleteCustomer') {
          const filter = payload._supabase_id
            ? `shop_id=eq.${shopId}&id=eq.${payload._supabase_id}`
            : (payload.id != null
                ? `shop_id=eq.${shopId}&or=(legacy_id.eq.${payload.id},name.eq.${encodeURIComponent(payload.name || '')})`
                : `shop_id=eq.${shopId}&name=eq.${encodeURIComponent(payload.name || '')}`);
          const res = await this._patch(url, key, 'customers', filter, {
            is_deleted: true,
          });
          if (res) success = true;
        } else if (m.command_type === 'CreateVegetable') {
          const res = await this._post(url, key, 'vegetables', [{
            shop_id: shopId,
            name: (payload.name || '').trim(),
            rate: Math.round((parseFloat(payload.rate) || 0) * 100),
            unit: payload.unit || 'kg',
            notes: payload.notes || '',
            is_deleted: false,
          }]);
          if (res?.[0]?.id) {
            await dbPut('vegetables', { ...payload, _supabase_id: res[0].id }).catch(() => {});
            success = true;
          } else if (res) {
            success = true;
          }
        } else if (m.command_type === 'UpdateVegetable') {
          const filter = payload._supabase_id
            ? `shop_id=eq.${shopId}&id=eq.${payload._supabase_id}`
            : `shop_id=eq.${shopId}&name=eq.${encodeURIComponent(payload.name || '')}`;
          const res = await this._patch(url, key, 'vegetables', filter, {
            name: payload.name ? payload.name.trim() : undefined,
            rate: payload.rate != null ? Math.round(parseFloat(payload.rate) * 100) : undefined,
            unit: payload.unit,
            notes: payload.notes,
          });
          if (res) success = true;
        } else if (m.command_type === 'DeleteVegetable') {
          const filter = payload._supabase_id
            ? `shop_id=eq.${shopId}&id=eq.${payload._supabase_id}`
            : (payload.id != null
                ? `shop_id=eq.${shopId}&or=(legacy_id.eq.${payload.id},name.eq.${encodeURIComponent(payload.name || '')})`
                : `shop_id=eq.${shopId}&name=eq.${encodeURIComponent(payload.name || '')}`);
          const res = await this._patch(url, key, 'vegetables', filter, {
            is_deleted: true,
          });
          if (res) success = true;
        } else if (m.command_type === 'CreateTransaction') {
          const sbCusts = await this._get(url, key, 'customers', `shop_id=eq.${shopId}&limit=1000`).catch(() => []);
          const sbVegs  = await this._get(url, key, 'vegetables', `shop_id=eq.${shopId}&limit=1000`).catch(() => []);
          const localCust = await dbGet('customers', payload.customer_id);
          const localVeg  = await dbGet('vegetables', payload.vegetable_id);

          let matchedCust = sbCusts.find((c) =>
            (localCust?._supabase_id && c.id === localCust._supabase_id) ||
            (localCust?.name && c.name && c.name.trim().toLowerCase() === localCust.name.trim().toLowerCase()) ||
            (c.legacy_id != null && (c.legacy_id === payload.customer_id || (localCust && c.legacy_id === localCust.id)))
          );

          if (!matchedCust && localCust) {
            const created = await this._post(url, key, 'customers', [{
              shop_id: shopId,
              name: (localCust.name || '').trim(),
              mobile: (localCust.mobile || '').trim(),
              address: localCust.address || '',
              credit_balance: Number(localCust.credit_balance || 0),
              commission_rate: localCust.commission_rate != null ? parseFloat(localCust.commission_rate) : null,
              is_deleted: false,
            }]);
            if (created?.[0]?.id) {
              matchedCust = created[0];
              await dbPut('customers', { ...localCust, _supabase_id: matchedCust.id }).catch(() => {});
            }
          }

          let matchedVeg = sbVegs.find((v) =>
            (localVeg?._supabase_id && v.id === localVeg._supabase_id) ||
            (localVeg?.name && v.name && v.name.trim().toLowerCase() === localVeg.name.trim().toLowerCase()) ||
            (v.legacy_id != null && (v.legacy_id === payload.vegetable_id || (localVeg && v.legacy_id === localVeg.id)))
          );

          if (!matchedVeg && localVeg) {
            const created = await this._post(url, key, 'vegetables', [{
              shop_id: shopId,
              name: (localVeg.name || '').trim(),
              rate: Number(localVeg.rate || 0),
              unit: localVeg.unit || 'kg',
              is_deleted: false,
            }]);
            if (created?.[0]?.id) {
              matchedVeg = created[0];
              await dbPut('vegetables', { ...localVeg, _supabase_id: matchedVeg.id }).catch(() => {});
            }
          }

          if (matchedCust && matchedVeg) {
            // payload.rate is always in RUPEES (fixed in offlineRepository.js queueMutation call)
            const ratePaise = Math.round((parseFloat(payload.rate) || 0) * 100);
            const basePaise = Math.round((parseFloat(payload.weight) || 0) * ratePaise);
            const commRate = parseFloat(payload.commission_rate) || 8.0;
            const commPaise = Math.round((basePaise * commRate) / 100);
            const finalPaise = basePaise + commPaise;
            const isPaid = payload.payment_type === 'Cash' || payload.payment_type === 'UPI';
            const paidPaise = isPaid ? finalPaise : 0;
            const remainingPaise = finalPaise - paidPaise;

            const txRows = await this._post(url, key, 'transactions', [{
              shop_id: shopId,
              legacy_id: `mobile-tx-${payload.id || m.mutation_id}`,
              customer_id: matchedCust.id,
              vegetable_id: matchedVeg.id,
              vegetable_name_snapshot: payload.vegetable_name_snapshot || localVeg?.name || '',
              weight: parseFloat(payload.weight) || 0,
              unit: payload.unit || 'kg',
              rate: ratePaise,
              base_amount: basePaise,
              commission_rate: commRate,
              commission_amount: commPaise,
              final_amount: finalPaise,
              payment_type: payload.payment_type || 'Credit',
              payment_mode: payload.payment_mode || payload.payment_type || 'Credit',
              paid_amount: paidPaise,
              remaining_amount: remainingPaise,
              transaction_date: payload.transaction_date || new Date().toISOString().slice(0, 10),
            }]);

            if (txRows?.[0]?.id) {
              const createdTxId = txRows[0].id;
              if (remainingPaise > 0) {
                await this._post(url, key, 'credit_transactions', [{
                  shop_id: shopId,
                  customer_id: matchedCust.id,
                  transaction_id: createdTxId,
                  transaction_type: 'CREDIT_ADDED',
                  amount: remainingPaise,
                  notes: `[Mobile:tx-${payload.id || m.mutation_id}] Daily Sale: ${payload.vegetable_name_snapshot || localVeg?.name || ''} (${payload.weight} ${payload.unit || 'kg'})`,
                  date: payload.transaction_date || new Date().toISOString().slice(0, 10),
                }]).catch(() => {});
              }
              success = true;
            }
          }
        } else if (m.command_type === 'UpdateTransaction') {
          const filter = payload._supabase_id
            ? `shop_id=eq.${shopId}&id=eq.${payload._supabase_id}`
            : `shop_id=eq.${shopId}&or=(legacy_id.eq.mobile-tx-${payload.id},legacy_id.eq.desktop-tx-${payload.id},legacy_id.eq.tx-${payload.id})`;
          const patchData = {};
          if (payload.weight != null) patchData.weight = parseFloat(payload.weight) || 0;
          if (payload.unit != null) patchData.unit = payload.unit;
          if (payload.rate != null) {
            patchData.rate = Math.round(parseFloat(payload.rate) * 100);
          }
          if (payload.commission_rate != null) {
            patchData.commission_rate = parseFloat(payload.commission_rate) || 8.0;
          }
          if (patchData.weight != null && patchData.rate != null) {
            const basePaise = Math.round(patchData.weight * patchData.rate);
            const commRate = patchData.commission_rate || 8.0;
            const commPaise = Math.round((basePaise * commRate) / 100);
            patchData.base_amount = basePaise;
            patchData.commission_amount = commPaise;
            patchData.final_amount = basePaise + commPaise;
          }
          if (payload.payment_type != null) patchData.payment_type = payload.payment_type;
          if (payload.payment_mode != null) patchData.payment_mode = payload.payment_mode;
          if (payload.transaction_date != null) patchData.transaction_date = payload.transaction_date;

          const res = await this._patch(url, key, 'transactions', filter, patchData);
          if (res) success = true;
        } else if (m.command_type === 'DeleteTransaction') {
          const res = await this._delete(url, key, 'transactions', `shop_id=eq.${shopId}&or=(legacy_id.eq.mobile-tx-${payload.id},legacy_id.eq.desktop-tx-${payload.id},legacy_id.eq.tx-${payload.id})`);
          if (res) success = true;
        } else if (m.command_type === 'GenerateBill') {
          const sbCusts = await this._get(url, key, 'customers', `shop_id=eq.${shopId}&limit=1000`).catch(() => []);
          const localCust = await dbGet('customers', payload.customer_id);
          const matchedCust = sbCusts.find((c) =>
            (localCust?._supabase_id && c.id === localCust._supabase_id) ||
            (localCust?.name && c.name && c.name.trim().toLowerCase() === localCust.name.trim().toLowerCase()) ||
            (c.legacy_id != null && (c.legacy_id === payload.customer_id || (localCust && c.legacy_id === localCust.id)))
          );
          if (matchedCust) {
            const billRows = await this._post(url, key, 'bills', [{
              shop_id: shopId,
              bill_number: payload.bill_number || `B-${payload.id || payload.bill_id}`,
              customer_id: matchedCust.id,
              date: payload.date || new Date().toISOString().slice(0, 10),
              period_start: payload.period_start || payload.date,
              period_end: payload.period_end || payload.date,
              subtotal: Math.round((parseFloat(payload.subtotal) || 0) * 100),
              discount_amount: Math.round((parseFloat(payload.discount_amount) || 0) * 100),
              commission_rate: parseFloat(payload.commission_rate) || 8.0,
              commission_amount: Math.round((parseFloat(payload.commission_amount) || 0) * 100),
              hamali_amount: Math.round((parseFloat(payload.hamali_amount) || 0) * 100),
              transport_amount: Math.round((parseFloat(payload.transport_amount) || 0) * 100),
              final_amount: Math.round((parseFloat(payload.final_amount) || 0) * 100),
              paid_amount: Math.round((parseFloat(payload.paid_amount) || 0) * 100),
              remaining_amount: Math.round((parseFloat(payload.remaining_amount) || 0) * 100),
              payment_type: payload.payment_type || 'Credit',
              payment_status: payload.payment_status || 'Partial',
            }]);
            if (billRows?.[0]?.id) success = true;
          }
        } else if (m.command_type === 'RecordPayment') {
          const sbCusts = await this._get(url, key, 'customers', `shop_id=eq.${shopId}&limit=1000`).catch(() => []);
          const localCust = await dbGet('customers', payload.customer_id);
          const matchedCust = sbCusts.find((c) =>
            (localCust?._supabase_id && c.id === localCust._supabase_id) ||
            (localCust?.name && c.name && c.name.trim().toLowerCase() === localCust.name.trim().toLowerCase()) ||
            (c.legacy_id != null && (c.legacy_id == payload.customer_id || (localCust && c.legacy_id == localCust.id))) ||
            (c.legacy_id && (c.legacy_id === `mobile-cust-${payload.customer_id}` || c.legacy_id === `desktop-cust-${payload.customer_id}`))
          );

          if (matchedCust) {
            const rawAmt = Number(payload.amount) || 0;
            const amtPaise = rawAmt > 50000 || (Number.isInteger(rawAmt) && rawAmt >= 100)
              ? Math.round(rawAmt)
              : Math.round(rawAmt * 100);

            const cleanMode = payload.payment_mode && payload.payment_mode !== 'Credit' ? `[${payload.payment_mode}] ` : '';
            const rawNote = (payload.notes || payload.note || '').replace(/\[(Desktop|Mobile|Supabase):[^\]]*\]/g, '').replace(/\[(Cash|UPI|Other)\]/g, '').trim();
            const noteText = `[Mobile:ctx-${payload.id || m.mutation_id}] ${cleanMode}${rawNote || 'Payment collected'}`.trim();

            const res = await this._post(url, key, 'credit_transactions', [{
              shop_id: shopId,
              customer_id: matchedCust.id,
              transaction_type: 'PAYMENT_RECEIVED',
              amount: amtPaise,
              notes: noteText,
              date: payload.date || new Date().toISOString().slice(0, 10),
            }]);
            if (res) success = true;
          }
        } else if (m.command_type === 'GiveDiscount') {
          const sbCusts = await this._get(url, key, 'customers', `shop_id=eq.${shopId}&limit=1000`).catch(() => []);
          const localCust = await dbGet('customers', payload.customer_id);
          const matchedCust = sbCusts.find((c) =>
            (localCust?._supabase_id && c.id === localCust._supabase_id) ||
            (localCust?.name && c.name && c.name.trim().toLowerCase() === localCust.name.trim().toLowerCase()) ||
            (c.legacy_id != null && (c.legacy_id == payload.customer_id || (localCust && c.legacy_id == localCust.id))) ||
            (c.legacy_id && (c.legacy_id === `mobile-cust-${payload.customer_id}` || c.legacy_id === `desktop-cust-${payload.customer_id}`))
          );

          if (matchedCust) {
            const rawAmt = Number(payload.amount) || 0;
            const amtPaise = rawAmt > 50000 || (Number.isInteger(rawAmt) && rawAmt >= 100)
              ? Math.round(rawAmt)
              : Math.round(rawAmt * 100);

            const rawNote = (payload.notes || 'Discount Given').replace(/\[(Desktop|Mobile|Supabase):[^\]]*\]/g, '').trim();
            const noteText = `[Mobile:ctx-${payload.id || m.mutation_id}] ${rawNote}`.trim();

            const res = await this._post(url, key, 'credit_transactions', [{
              shop_id: shopId,
              customer_id: matchedCust.id,
              transaction_type: 'DISCOUNT',
              amount: amtPaise,
              notes: noteText,
              date: payload.date || new Date().toISOString().slice(0, 10),
            }]);
            if (res) success = true;
          }
        } else if (m.command_type === 'UndoPayment') {
          const filter = payload._supabase_id
            ? `shop_id=eq.${shopId}&id=eq.${payload._supabase_id}`
            : `shop_id=eq.${shopId}&notes=like.*[Mobile:ctx-${payload.id}]*`;
          const res = await this._delete(url, key, 'credit_transactions', filter).catch(() => {});
          if (res) success = true;
        } else {
          // Unhandled or non-cloud mutation: mark as processed to prevent clogging
          success = true;
        }

        if (success) {
          await dbPut('outbox_mutations', { ...m, status: 'synced', synced_at: new Date().toISOString() });
          pushed++;
        }
      }
      return pushed;
    } catch (err) {
      console.warn('pushOutboxMutations error:', err);
      return 0;
    }
  }

  // ── syncNow & pushPendingMutations ────────────────────────────────────────

  async syncNow() {
    if (isStandaloneMobile()) {
      try {
        const { url, key } = await this._creds();
        const shopId = await this._ensureShop(url, key);
        await this.pushOutboxMutations(url, key, shopId);
      } catch (e) {
        console.warn('Mobile outbox push note:', e);
      }
      return this.pullFromSupabase();
    } else {
      // DESKTOP: Two-way sync: first pull any mobile entries down to SQLite, then push SQLite additions to Supabase
      let pulledOk = false;
      try {
        const { url, key } = await this._creds();
        const shopId = await this._ensureShop(url, key);
        await this.pullToDesktopSQLite(url, key, shopId);
        pulledOk = true;
      } catch (e) {
        console.warn('Desktop pull to SQLite note:', e);
      }
      const result = await this.pushToSupabase();
      // If push was skipped (isSyncing guard) but pull succeeded, still fire the refresh event
      if (pulledOk && result?.message?.includes('already in progress') && typeof window !== 'undefined') {
        window.dispatchEvent(new CustomEvent('vyaparsetu:data-synced', { detail: { count: 0, source: 'pull-only' } }));
      }
      return result;
    }
  }

  async pushPendingMutations() {
    return this.syncNow();
  }

  // ── Auto-sync ─────────────────────────────────────────────────────────────

  startAutoSync(intervalMs = 30000) {
    if (this.syncInterval) clearInterval(this.syncInterval);

    // Initial delayed run
    setTimeout(() => {
      if (navigator.onLine && !this.isSyncing && !this.isUserInteracting()) {
        this.getSyncStats().then((stats) => {
          if (stats.isConfigured) {
            this.syncNow({ isAuto: true }).catch((e) => console.warn('Initial sync error:', e));
          }
        });
      }
    }, 2500);

    // Start Realtime subscription for instant cross-device updates (5s delay to let initial sync complete)
    setTimeout(() => {
      this.startRealtimeSubscription().catch(() => {});
    }, 5000);

    // Periodic interval (every 30s)
    this.syncInterval = setInterval(() => {
      // Pause sync if user is actively typing, scrolling, or editing in a modal
      if (this.isUserInteracting()) {
        return;
      }

      if (navigator.onLine && !this.isSyncing) {
        this.getSyncStats().then((stats) => {
          if (stats.isConfigured) {
            this.syncNow({ isAuto: true }).catch((e) => console.warn('Auto sync error:', e));
          }
        });
      }
    }, intervalMs);
  }

  stopAutoSync() {
    if (this.syncInterval) {
      clearInterval(this.syncInterval);
      this.syncInterval = null;
    }
    // Stop fast-poll fallback
    if (this._fastPollTimer) {
      clearInterval(this._fastPollTimer);
      this._fastPollTimer = null;
    }
    // Close realtime subscription
    if (this._realtimeChannel) {
      try { this._realtimeChannel.close(); } catch (_) {}
      this._realtimeChannel = null;
    }
  }
}

export const cloudSyncService = new CloudSyncService();
export default cloudSyncService;

