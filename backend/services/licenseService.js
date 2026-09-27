/**
 * License Service — offline, signed, machine-bound activation.
 *
 * VyapaarSetu is sold per-PC. This module lets the app decide, fully offline,
 * whether *this* machine is licensed:
 *
 *   - The developer signs a small payload (customer name + this PC's Machine ID +
 *     optional expiry) with an Ed25519 PRIVATE key that never ships.
 *   - The app embeds only the matching PUBLIC key and can only VERIFY, never mint.
 *   - A license is valid only if its signature checks out AND its bound Machine ID
 *     equals this PC's Machine ID AND it hasn't expired. So copying the installed
 *     app — or the whole %APPDATA% folder — to another PC fails: the Machine ID
 *     won't match.
 *
 * This stops casual copying by non-technical shopkeepers, which is the real threat
 * for a localhost single-PC product. It is deliberately not proof against a
 * determined cracker with machine access — an on-device check never can be.
 */

const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');
const os = require('os');
const logger = require('../utils/logger');

// The license file lives OUTSIDE the SQLite database, beside drive_tokens.json,
// for the same reason (googleDriveBackupService.js:18-20): backup/restore calls
// db.reloadDb(), which swaps the entire .db file. A license kept in the settings
// table would be wiped by restoring a pre-activation backup — or, worse, swapped
// for another machine's license by restoring their backup, defeating the binding.
// The packaged app points this at %APPDATA%/VyapaarSetu/license.json.
const LICENSE_PATH = process.env.LICENSE_PATH
  ? path.resolve(process.env.LICENSE_PATH)
  : path.resolve(__dirname, '../database/license.json');

// Public verify-only key. Generated once by tools/generate-keypair.mjs; the
// matching private key stays with the developer and is gitignored. Replacing this
// value invalidates every license already issued.
const EMBEDDED_PUBLIC_KEY_PEM = `-----BEGIN PUBLIC KEY-----
MCowBQYDK2VwAyEAEwwbPdmPVbHMFcziYTuo9L0e84gPmKhs6RdPi++LScI=
-----END PUBLIC KEY-----`;

// Namespaces the Machine ID hash to this product. Not a secret — just makes the
// derived ID meaningless outside VyapaarSetu. Changing it re-labels every PC.
const SALT = 'VyapaarSetu::machine::v1';

/**
 * Which public key to verify against. Production ALWAYS uses the embedded key.
 * Only outside production (tests, local experiments) may an env-supplied key
 * stand in — so a shipped app can never be pointed at an attacker's key by
 * setting an environment variable.
 */
function getPublicKeyPem() {
  if (process.env.NODE_ENV !== 'production' && process.env.LICENSE_PUBLIC_KEY_PEM) {
    return process.env.LICENSE_PUBLIC_KEY_PEM;
  }
  return EMBEDDED_PUBLIC_KEY_PEM;
}

/** Uppercase, group into XXXX-XXXX-…, so IDs compare regardless of source casing. */
function normalizeMid(value) {
  return String(value || '').trim().toUpperCase();
}

/** Reads the stable Windows MachineGuid from the registry. Throws off-Windows. */
function readWindowsMachineGuid() {
  const out = execSync(
    'reg query "HKLM\\SOFTWARE\\Microsoft\\Cryptography" /v MachineGuid',
    { encoding: 'utf8', windowsHide: true, stdio: ['ignore', 'pipe', 'ignore'] }
  );
  // Line looks like:  "    MachineGuid    REG_SZ    <guid>"
  const match = out.match(/MachineGuid\s+REG_SZ\s+(\S+)/i);
  if (match) return match[1];
  throw new Error('MachineGuid not present in registry output');
}

/**
 * Best-effort stable fingerprint for a non-Windows dev box (the shipped product is
 * Windows-only). Hostname + first real MAC + CPU model — stable across reboots.
 */
function readFallbackFingerprint() {
  const nets = os.networkInterfaces();
  let mac = '';
  for (const name of Object.keys(nets)) {
    for (const ni of nets[name] || []) {
      if (!ni.internal && ni.mac && ni.mac !== '00:00:00:00:00:00') {
        mac = ni.mac;
        break;
      }
    }
    if (mac) break;
  }
  const cpu = (os.cpus()[0] && os.cpus()[0].model) || 'unknown-cpu';
  return `${os.hostname()}|${mac}|${cpu}`;
}

let _machineId = null;

/**
 * A stable, privacy-preserving identifier for this PC, shown on the activation
 * screen and bound into the license. It is the first 64 bits of
 * sha256(SALT + MachineGuid), formatted XXXX-XXXX-XXXX-XXXX — short enough to read
 * over the phone, wide enough to never collide at this scale. The raw MachineGuid
 * is never exposed.
 *
 * MACHINE_ID overrides the derivation for tests/dev, but ONLY outside production —
 * otherwise the whole machine binding would come undone via one environment
 * variable: anyone handed a copied .exe plus someone else's key could launch with
 * MACHINE_ID set to that key's bound ID and pass the check. A shipped app therefore
 * always derives its own ID, exactly like it always uses the embedded public key.
 *
 * @returns {string} e.g. "3F9A-1C2B-77D0-AE41"
 */
function getMachineId() {
  if (process.env.NODE_ENV !== 'production' && process.env.MACHINE_ID) {
    return normalizeMid(process.env.MACHINE_ID);
  }
  if (_machineId) return _machineId;

  let raw;
  try {
    raw = readWindowsMachineGuid();
  } catch {
    raw = readFallbackFingerprint();
  }

  const hex = crypto.createHash('sha256').update(`${SALT}${raw}`).digest('hex');
  _machineId = hex.slice(0, 16).toUpperCase().match(/.{1,4}/g).join('-');
  return _machineId;
}

/**
 * Verifies a license key string against the embedded public key and this machine.
 * Never throws — a bad key is a normal result, not an error.
 *
 * A key is `base64url(payloadJSON) + "." + base64url(signature)`. The signature
 * covers the *bytes of the payload segment string*, and we verify over exactly
 * those bytes — we only base64url-decode + JSON.parse the payload to *read* its
 * fields, never re-serialize it. That sidesteps the canonicalization trap where a
 * re-`JSON.stringify` with different key order or spacing produces different bytes
 * and a spurious signature mismatch.
 *
 * @param {string} licenseKey
 * @returns {{ ok: true, payload: object } | { ok: false, reason: string }}
 */
function verifyKey(licenseKey) {
  try {
    if (!licenseKey || typeof licenseKey !== 'string') {
      return { ok: false, reason: 'No license key provided.' };
    }
    const parts = licenseKey.trim().split('.');
    if (parts.length !== 2 || !parts[0] || !parts[1]) {
      return { ok: false, reason: 'License key is malformed.' };
    }
    const [payloadSeg, sigSeg] = parts;
    const signature = Buffer.from(sigSeg, 'base64url');

    const publicKey = crypto.createPublicKey(getPublicKeyPem());
    const verified = crypto.verify(null, Buffer.from(payloadSeg), publicKey, signature);
    if (!verified) return { ok: false, reason: 'This license key is not valid.' };

    let payload;
    try {
      payload = JSON.parse(Buffer.from(payloadSeg, 'base64url').toString('utf8'));
    } catch {
      return { ok: false, reason: 'This license key is not valid.' };
    }

    if (normalizeMid(payload.mid) !== normalizeMid(getMachineId())) {
      return { ok: false, reason: 'This license key is for a different computer.' };
    }

    if (payload.exp && Number(payload.exp) > 0) {
      const now = Math.floor(Date.now() / 1000);
      if (now > Number(payload.exp)) {
        return { ok: false, reason: 'This license key has expired.' };
      }
    }

    return { ok: true, payload };
  } catch (err) {
    logger.error(`License verification error: ${err.message}`);
    return { ok: false, reason: 'This license key could not be verified.' };
  }
}

/**
 * Dev-only escape hatch: skip activation when running unpackaged with
 * LICENSE_DEV_BYPASS set. Production (NODE_ENV=production, set by the Electron main
 * process) ignores it entirely, so it can never unlock a shipped app.
 */
function devBypassActive() {
  return process.env.NODE_ENV !== 'production' && !!process.env.LICENSE_DEV_BYPASS;
}

/**
 * Whether this machine is currently licensed. Reads the license file fresh on every
 * call (no caching), so activating unlocks the app on the very next request without
 * a restart. Any missing/corrupt file or failed check ⇒ not activated, never a throw.
 *
 * @returns {boolean}
 */
function isActivated() {
  if (devBypassActive()) return true;
  try {
    if (!fs.existsSync(LICENSE_PATH)) return false;
    const stored = JSON.parse(fs.readFileSync(LICENSE_PATH, 'utf8'));
    if (!stored || !stored.key) return false;
    return verifyKey(stored.key).ok;
  } catch {
    return false;
  }
}

/**
 * Status for the activation UI: always exposes this PC's Machine ID (needed to
 * request a key even when locked), plus who/what the active license is for.
 *
 * @returns {{ activated: boolean, machineId: string, customerName?: string, expiry?: string|null }}
 */
function getStatus() {
  const machineId = getMachineId();

  if (devBypassActive()) {
    return { activated: true, machineId, customerName: 'Developer (bypass)', expiry: null };
  }

  const status = { activated: false, machineId };
  try {
    if (fs.existsSync(LICENSE_PATH)) {
      const stored = JSON.parse(fs.readFileSync(LICENSE_PATH, 'utf8'));
      const result = verifyKey(stored && stored.key);
      if (result.ok) {
        status.activated = true;
        status.customerName = result.payload.name || null;
        status.expiry = result.payload.exp
          ? new Date(Number(result.payload.exp) * 1000).toISOString()
          : null;
      }
    }
  } catch {
    /* leave status.activated = false */
  }
  return status;
}

/**
 * Validates a pasted key and, if good, persists it to LICENSE_PATH. Overwriting an
 * existing license is allowed — that is also how a renewal or replacement key is
 * entered later. On a bad key, throws an Error carrying statusCode 400 so the global
 * error handler answers with a 400, not a 500.
 *
 * @param {string} licenseKey
 * @returns {{ activated: boolean, machineId: string, customerName?: string, expiry?: string|null }}
 */
function activate(licenseKey) {
  const result = verifyKey(licenseKey);
  if (!result.ok) {
    const err = new Error(result.reason || 'This license key is not valid.');
    err.statusCode = 400;
    throw err;
  }

  const dir = path.dirname(LICENSE_PATH);
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });

  const record = { key: licenseKey.trim(), activatedAt: new Date().toISOString() };
  fs.writeFileSync(LICENSE_PATH, JSON.stringify(record, null, 2), 'utf8');
  logger.info(`License activated for "${result.payload.name}" on machine ${getMachineId()}`);

  return getStatus();
}

module.exports = {
  getMachineId,
  verifyKey,
  isActivated,
  getStatus,
  activate,
  LICENSE_PATH,
};
