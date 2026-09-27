/**
 * useLicense Hook
 * Fetches this machine's activation status on mount and exposes an activate()
 * mutation.
 *
 * On desktop (server running): delegates to the backend API.
 * On mobile / offline standalone: derives a stable device ID in-browser using
 *   mobileDeviceId.js and stores the license key in localStorage — no server needed.
 */

import { useState, useEffect, useCallback, useRef } from 'react';
import { licenseApi } from '../services/apiService';
import { isStandaloneMobile } from '../services/apiService';
import {
  getMobileDeviceId,
  saveMobileLicense,
  loadMobileLicense,
  loadMobileLicenseAsync,
  clearMobileLicense,
  initMobileDeviceAndLicense,
  ADMIN_MASTER_PIN,
} from '../utils/mobileDeviceId';

import nacl from 'tweetnacl';

// ─── Mobile-only license verification ─────────────────────────────────────────
// Supports both current and root public keys (raw 32-byte Ed25519)
const TRUSTED_PUBLIC_KEYS_B64 = [
  'EwwbPdmPVbHMFcziYTuo9L0e84gPmKhs6RdPi++LScI=', // Current generated keypair
  'TF0BYj9DDSlrpox9YWv3C4goSJcYuKsweTl2dO4MdmU=', // Original root keypair
];

function normalizeId(value) {
  return String(value || '').trim().toUpperCase();
}

function base64ToUint8(str) {
  let b64 = str.replace(/-/g, '+').replace(/_/g, '/');
  while (b64.length % 4) b64 += '=';
  const bin = atob(b64);
  const arr = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) arr[i] = bin.charCodeAt(i);
  return arr;
}

async function verifyMobileLicense(licenseKey, deviceId) {
  // 1. Sanitize: remove any whitespace, newlines, or zero-width spaces added by mobile keyboards/WhatsApp
  const cleanKey = (licenseKey || '').replace(/[\s\u200B-\u200D\uFEFF]+/g, '');
  if (!cleanKey) throw new Error('License key cannot be empty');

  const parts = cleanKey.split('.');
  if (parts.length !== 2 || !parts[0] || !parts[1]) {
    throw new Error('Invalid license key format');
  }

  const [payloadSeg, sigSeg] = parts;

  // 2. Decode & parse payload
  let payload;
  try {
    const payloadBytes = base64ToUint8(payloadSeg);
    const json = new TextDecoder().decode(payloadBytes);
    payload = JSON.parse(json);
  } catch {
    throw new Error('Invalid license key structure');
  }

  // 3. Cryptographic signature check via TweetNaCl (100% offline & compatible with all WebViews)
  let isSignatureValid = false;
  try {
    const sigBytes = base64ToUint8(sigSeg);
    const msgBytes = new TextEncoder().encode(payloadSeg);

    for (const pubB64 of TRUSTED_PUBLIC_KEYS_B64) {
      const pubKeyBytes = base64ToUint8(pubB64);
      if (nacl.sign.detached.verify(msgBytes, sigBytes, pubKeyBytes)) {
        isSignatureValid = true;
        break;
      }
    }
  } catch (err) {
    console.error('Signature verification error:', err);
  }

  if (!isSignatureValid) {
    throw new Error('This license key is not valid or has been tampered with');
  }

  // 4. Device Binding Check
  const keyMid = normalizeId(payload.mid || payload.machineId);
  const targetId = normalizeId(deviceId);
  if (keyMid && targetId && keyMid !== targetId) {
    throw new Error('This license key is bound to a different device');
  }

  // 5. Expiration Check
  if (payload.exp && Number(payload.exp) > 0) {
    const now = Math.floor(Date.now() / 1000);
    if (now > Number(payload.exp)) {
      throw new Error('This license key has expired');
    }
  } else if (payload.expiry) {
    const expDate = new Date(payload.expiry);
    if (!isNaN(expDate.getTime()) && expDate < new Date()) {
      throw new Error('This license key has expired');
    }
  }

  return {
    customerName: payload.name || payload.customerName || 'Mobile User',
    machineId: targetId,
    expiry: payload.exp
      ? new Date(Number(payload.exp) * 1000).toISOString()
      : payload.expiry || null,
    key: cleanKey,
  };
}

export function useLicense() {
  const [machineId, setMachineId] = useState('');
  const [activated, setActivated] = useState(false);
  const [customerName, setCustomerName] = useState(null);
  const [expiry, setExpiry] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  const [submitting, setSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState(null);

  const applyStatus = useCallback((data = {}) => {
    setMachineId(data.machineId || '');
    setActivated(!!data.activated);
    setCustomerName(data.customerName || null);
    setExpiry(data.expiry || null);
  }, []);

  const fetchStatus = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      if (isStandaloneMobile()) {
        // ── Mobile offline path ──────────────────────────────────────────────
        await initMobileDeviceAndLicense();
        const deviceId = await getMobileDeviceId();
        let saved = await loadMobileLicenseAsync();
        if (saved && saved.expiry) {
          const expDate = new Date(saved.expiry);
          if (!isNaN(expDate.getTime()) && expDate < new Date()) {
            // Expired: only clear if actually expired
            try { await clearMobileLicense(ADMIN_MASTER_PIN); } catch {}
            saved = null;
          }
        }
        applyStatus({
          machineId: deviceId,
          activated: !!saved,
          customerName: saved?.customerName || null,
          expiry: saved?.expiry || null,
        });
      } else {
        // ── Desktop/server path ──────────────────────────────────────────────
        const response = await licenseApi.getStatus();
        applyStatus(response?.data);
      }
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  }, [applyStatus]);

  const activate = useCallback(
    async (licenseKey) => {
      setSubmitting(true);
      setSubmitError(null);
      try {
        if (isStandaloneMobile()) {
          // ── Mobile offline path ──────────────────────────────────────────
          const deviceId = await getMobileDeviceId();
          const payload = await verifyMobileLicense(licenseKey, deviceId);
          saveMobileLicense(payload);
          applyStatus({
            machineId: deviceId,
            activated: true,
            customerName: payload.customerName || 'Mobile User',
            expiry: payload.expiry || null,
          });
        } else {
          // ── Desktop/server path ──────────────────────────────────────────
          const response = await licenseApi.activate(licenseKey);
          applyStatus(response?.data);
        }
        return true;
      } catch (err) {
        setSubmitError(err.message);
        return false;
      } finally {
        setSubmitting(false);
      }
    },
    [applyStatus]
  );

  // Guard against React 19 StrictMode's double effect invocation: the GET is
  // idempotent, but this avoids a duplicate in-flight request on mount.
  const fetchedRef = useRef(false);
  useEffect(() => {
    if (fetchedRef.current) return;
    fetchedRef.current = true;
    fetchStatus();
  }, [fetchStatus]);

  const deactivate = useCallback(
    async (adminPin) => {
      if (isStandaloneMobile()) {
        await clearMobileLicense(adminPin);
        await fetchStatus();
        return true;
      }
      return false;
    },
    [fetchStatus]
  );

  return {
    machineId,
    activated,
    customerName,
    expiry,
    loading,
    error,
    submitting,
    submitError,
    activate,
    deactivate,
    refetch: fetchStatus,
  };
}
