#!/usr/bin/env node
/**
 * VyapaarSetu — license key generator (developer-side, offline).
 *
 * For each sale: read the PC's Machine ID off the activation screen, then run this
 * to mint a key bound to that machine and hand it to the customer.
 *
 *   node tools/generate-license.mjs --name "Sharma Traders" --machine "3F9A-1C2B-77D0-AE41"
 *   node tools/generate-license.mjs --name "Trial Shop"     --machine "…" --days 30
 *   node tools/generate-license.mjs --name "Yearly Shop"    --machine "…" --expiry 2027-03-31
 *
 * Options:
 *   --name     <string>       Customer / shop name (recorded in the register). Required.
 *   --machine  <XXXX-…>       The Machine ID shown on that PC's activation screen. Required.
 *   --days     <N>            Key expires N days from now. Optional.
 *   --expiry   <YYYY-MM-DD>   Key expires at the end of this day. Optional.
 *                             Omit both --days and --expiry for a PERPETUAL key.
 *
 * The signature covers the bytes of the base64url payload segment — identical to
 * how the app verifies (backend/services/licenseService.js verifyKey). Every issued
 * key is appended to tools/licenses.json, the developer's private register of who is
 * licensed. That register and the private key are gitignored and must never be shared.
 */

import crypto from 'crypto';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PRIVATE_KEY_PATH = path.join(__dirname, 'keys', 'private-key.pem');
const REGISTER_PATH = path.join(__dirname, 'licenses.json');

const MID_RE = /^[0-9A-F]{4}(-[0-9A-F]{4}){3}$/;

function die(message) {
  console.error(`\n✖ ${message}\n`);
  process.exit(1);
}

/** Minimal `--flag value` parser. Unknown flags are an error, not silently ignored. */
function parseArgs(argv) {
  const known = new Set(['--name', '--machine', '--days', '--expiry']);
  const out = {};
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === '--help' || arg === '-h') out.help = true;
    else if (known.has(arg)) {
      const value = argv[++i];
      if (value === undefined) die(`Missing value for ${arg}.`);
      out[arg.slice(2)] = value;
    } else {
      die(`Unknown argument "${arg}". Run with --help for usage.`);
    }
  }
  return out;
}

const args = parseArgs(process.argv.slice(2));

if (args.help) {
  console.log(fs.readFileSync(fileURLToPath(import.meta.url), 'utf8').split('\n').slice(1, 24).join('\n').replace(/^ \*\/?/gm, '').trim());
  process.exit(0);
}

// ── Validate inputs ──────────────────────────────────────────────────────────
if (!fs.existsSync(PRIVATE_KEY_PATH)) {
  die(`No private key at ${PRIVATE_KEY_PATH}. Run "node tools/generate-keypair.mjs" first.`);
}

const name = (args.name || '').trim();
if (!name) die('--name is required (the customer / shop name).');

// Normalize exactly as the app does: trim + uppercase. The app compares the bound
// mid to its own Machine ID after the same normalization, so anything the developer
// types (any case, stray spaces) binds correctly as long as the characters match.
const mid = (args.machine || '').trim().toUpperCase();
if (!mid) die('--machine is required (the Machine ID shown on the activation screen).');
if (!MID_RE.test(mid)) {
  console.warn(
    `\n⚠ Machine ID "${mid}" is not in the usual XXXX-XXXX-XXXX-XXXX hex form.\n` +
      '  Double-check you copied it exactly, or the key will not activate that PC.\n'
  );
}

if (args.days !== undefined && args.expiry !== undefined) {
  die('Use only one of --days or --expiry, not both.');
}

const iat = Math.floor(Date.now() / 1000);
let exp = 0; // 0 ⇒ perpetual

if (args.days !== undefined) {
  const days = Number(args.days);
  if (!Number.isFinite(days) || days <= 0) die('--days must be a positive number.');
  exp = iat + Math.round(days * 86400);
} else if (args.expiry !== undefined) {
  // End of the given day, local time, so a key issued for "2027-03-31" is valid
  // through all of that date.
  const ms = Date.parse(`${args.expiry}T23:59:59`);
  if (Number.isNaN(ms)) die('--expiry must be a valid date, e.g. 2027-03-31.');
  exp = Math.floor(ms / 1000);
  if (exp <= iat) die('--expiry is in the past.');
}

// ── Mint the key ───────────────────────────────────────────────────────────────
const privateKey = crypto.createPrivateKey(fs.readFileSync(PRIVATE_KEY_PATH));

const payload = { v: 1, lid: crypto.randomUUID(), name, mid, iat, exp };
const payloadSeg = Buffer.from(JSON.stringify(payload)).toString('base64url');
const signature = crypto.sign(null, Buffer.from(payloadSeg), privateKey).toString('base64url');
const licenseKey = `${payloadSeg}.${signature}`;

// ── Append to the register (never clobber a corrupt one) ────────────────────────
let register = [];
if (fs.existsSync(REGISTER_PATH)) {
  try {
    register = JSON.parse(fs.readFileSync(REGISTER_PATH, 'utf8'));
    if (!Array.isArray(register)) throw new Error('not an array');
  } catch (err) {
    die(
      `Register at ${REGISTER_PATH} is unreadable (${err.message}).\n` +
        '  Fix or move it by hand before issuing more keys — refusing to overwrite it.'
    );
  }
}

const expiryHuman = exp === 0 ? 'perpetual' : new Date(exp * 1000).toISOString();
register.push({
  lid: payload.lid,
  name,
  mid,
  iat,
  exp,
  issuedAt: new Date(iat * 1000).toISOString(),
  expiry: expiryHuman,
  key: licenseKey,
});
fs.writeFileSync(REGISTER_PATH, JSON.stringify(register, null, 2), 'utf8');

// ── Output ───────────────────────────────────────────────────────────────────
console.log('\n✅ License generated.\n');
console.log(`  Customer : ${name}`);
console.log(`  Machine  : ${mid}`);
console.log(`  Expiry   : ${expiryHuman}`);
console.log(`  Recorded : ${REGISTER_PATH}\n`);
console.log('═'.repeat(72));
console.log('LICENSE KEY — send this to the customer to paste into the app:');
console.log('═'.repeat(72));
console.log(licenseKey);
console.log('═'.repeat(72) + '\n');
