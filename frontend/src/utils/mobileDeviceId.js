/**
 * mobileDeviceId.js
 *
 * Generates and persists a stable, privacy-preserving device identifier for
 * mobile / offline environments where the Node.js backend is not running.
 *
 * Strategy:
 *   1. Check native storage (@capacitor/preferences / Android SharedPreferences)
 *      first, then fall back to localStorage.
 *   2. Native SharedPreferences survives webview cache clears, browsing data wipes,
 *      and browser updates.
 *   3. If neither exists, generate a new UUID via crypto.randomUUID() and write
 *      to BOTH native Preferences and localStorage.
 *   4. Hash it with SHA-256 + SALT to produce the same short XXXX-XXXX-XXXX-XXXX
 *      format that the desktop licenseService.js uses.
 *   5. License de-registration / reset is strictly locked with an Admin Master PIN
 *      so users cannot wipe their license without contacting support.
 */

import { Preferences } from '@capacitor/preferences';

const STORAGE_KEY = 'vyaparsetu_device_uuid';
const LICENSE_KEY_STORAGE = 'vyaparsetu_mobile_license';
const SALT = 'VyaparSetu-v1-salt-2025';

// Admin master unlock PIN required to deregister / wipe device license
export const ADMIN_MASTER_PIN = '998877';

let inMemoryUuid = null;
let inMemoryLicense = null;

/**
 * Initializes and synchronizes device ID and license between native Preferences
 * and browser localStorage. Call this on app startup.
 */
export async function initMobileDeviceAndLicense() {
  try {
    // 1. Synchronize Device UUID
    let prefUuid = null;
    try {
      const res = await Preferences.get({ key: STORAGE_KEY });
      prefUuid = res?.value;
    } catch (e) {
      console.warn('Could not read Preferences for device UUID:', e);
    }

    let localUuid = null;
    try {
      localUuid = localStorage.getItem(STORAGE_KEY);
    } catch {}

    if (prefUuid) {
      inMemoryUuid = prefUuid;
      if (localUuid !== prefUuid) {
        try { localStorage.setItem(STORAGE_KEY, prefUuid); } catch {}
      }
    } else if (localUuid) {
      inMemoryUuid = localUuid;
      try { await Preferences.set({ key: STORAGE_KEY, value: localUuid }); } catch {}
    } else {
      const newUuid = (typeof crypto !== 'undefined' && crypto.randomUUID && crypto.randomUUID()) || _fallbackUuid();
      inMemoryUuid = newUuid;
      try { localStorage.setItem(STORAGE_KEY, newUuid); } catch {}
      try { await Preferences.set({ key: STORAGE_KEY, value: newUuid }); } catch {}
    }

    // 2. Synchronize Mobile License
    let prefLicense = null;
    try {
      const res = await Preferences.get({ key: LICENSE_KEY_STORAGE });
      if (res?.value) {
        prefLicense = JSON.parse(res.value);
      }
    } catch (e) {
      console.warn('Could not read Preferences for mobile license:', e);
    }

    let localLicense = null;
    try {
      const raw = localStorage.getItem(LICENSE_KEY_STORAGE);
      if (raw) localLicense = JSON.parse(raw);
    } catch {}

    if (prefLicense) {
      inMemoryLicense = prefLicense;
      if (!localLicense) {
        try { localStorage.setItem(LICENSE_KEY_STORAGE, JSON.stringify(prefLicense)); } catch {}
      }
    } else if (localLicense) {
      inMemoryLicense = localLicense;
      try { await Preferences.set({ key: LICENSE_KEY_STORAGE, value: JSON.stringify(localLicense) }); } catch {}
    }
  } catch (err) {
    console.error('initMobileDeviceAndLicense error:', err);
  }

  return { uuid: inMemoryUuid, license: inMemoryLicense };
}

/**
 * Fallback UUID generator using crypto.getRandomValues for older environments.
 */
function _fallbackUuid() {
  const bytes = new Uint8Array(16);
  crypto.getRandomValues(bytes);
  bytes[6] = (bytes[6] & 0x0f) | 0x40; // version 4
  bytes[8] = (bytes[8] & 0x3f) | 0x80; // variant bits
  const hex = Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('');
  return [
    hex.slice(0, 8),
    hex.slice(8, 12),
    hex.slice(12, 16),
    hex.slice(16, 20),
    hex.slice(20),
  ].join('-');
}

/**
 * Returns the synchronous or cached UUID.
 */
function getOrCreateDeviceUuid() {
  if (inMemoryUuid) return inMemoryUuid;
  let uuid = null;
  try { uuid = localStorage.getItem(STORAGE_KEY); } catch {}
  if (!uuid) {
    uuid = (typeof crypto !== 'undefined' && crypto.randomUUID && crypto.randomUUID()) || _fallbackUuid();
    try { localStorage.setItem(STORAGE_KEY, uuid); } catch {}
    Preferences.set({ key: STORAGE_KEY, value: uuid }).catch(() => {});
  }
  inMemoryUuid = uuid;
  return uuid;
}

/**
 * Returns the formatted device ID string (XXXX-XXXX-XXXX-XXXX).
 * Uses the Web Crypto API (SubtleCrypto) for SHA-256 hashing.
 */
export async function getMobileDeviceId() {
  if (!inMemoryUuid) {
    await initMobileDeviceAndLicense();
  }
  const uuid = inMemoryUuid || getOrCreateDeviceUuid();
  const raw = `${SALT}${uuid}`;
  const encoder = new TextEncoder();
  const data = encoder.encode(raw);

  let hashHex;
  try {
    const hashBuffer = await crypto.subtle.digest('SHA-256', data);
    const hashArray = Array.from(new Uint8Array(hashBuffer));
    hashHex = hashArray.map((b) => b.toString(16).padStart(2, '0')).join('');
  } catch {
    hashHex = uuid.replace(/-/g, '').padEnd(16, '0');
  }

  return hashHex.slice(0, 16).toUpperCase().match(/.{1,4}/g).join('-');
}

// ─── Mobile License Storage ────────────────────────────────────────────────────

/**
 * Saves a verified license key to both native Preferences and localStorage.
 * @param {object} payload  The decoded license payload
 */
export async function saveMobileLicense(payload) {
  inMemoryLicense = payload;
  const jsonStr = JSON.stringify(payload);
  try {
    localStorage.setItem(LICENSE_KEY_STORAGE, jsonStr);
  } catch {}
  try {
    await Preferences.set({ key: LICENSE_KEY_STORAGE, value: jsonStr });
  } catch (err) {
    console.warn('Preferences.set for license failed:', err);
  }
}

/**
 * Reads the saved mobile license (synchronous fallback, prefers in-memory or localStorage).
 * @returns {object|null}
 */
export function loadMobileLicense() {
  if (inMemoryLicense) return inMemoryLicense;
  try {
    const raw = localStorage.getItem(LICENSE_KEY_STORAGE);
    if (raw) {
      inMemoryLicense = JSON.parse(raw);
      return inMemoryLicense;
    }
  } catch {}
  return null;
}

/**
 * Loads the mobile license asynchronously checking native Preferences.
 * @returns {Promise<object|null>}
 */
export async function loadMobileLicenseAsync() {
  if (inMemoryLicense) return inMemoryLicense;
  try {
    const res = await Preferences.get({ key: LICENSE_KEY_STORAGE });
    if (res?.value) {
      inMemoryLicense = JSON.parse(res.value);
      try { localStorage.setItem(LICENSE_KEY_STORAGE, res.value); } catch {}
      return inMemoryLicense;
    }
  } catch {}
  return loadMobileLicense();
}

/**
 * Protected license de-registration.
 * Must supply the Admin Master PIN or correct shop secret to prevent accidental removal.
 * @param {string} adminPin
 * @returns {boolean} True if successfully cleared
 */
export async function clearMobileLicense(adminPin) {
  if (adminPin !== ADMIN_MASTER_PIN) {
    throw new Error('Unauthorized: Admin PIN required to deregister this device. Please contact support.');
  }
  inMemoryLicense = null;
  try { localStorage.removeItem(LICENSE_KEY_STORAGE); } catch {}
  try { await Preferences.remove({ key: LICENSE_KEY_STORAGE }); } catch {}
  return true;
}
