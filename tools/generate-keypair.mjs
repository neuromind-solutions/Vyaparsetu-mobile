#!/usr/bin/env node
/**
 * VyapaarSetu — Ed25519 license keypair generator. RUN ONCE, EVER.
 *
 * Licensing is offline and asymmetric: this machine (the developer's) holds the
 * PRIVATE key and is the only thing that can MINT a license; the shipped app
 * embeds only the PUBLIC key and can only VERIFY one. A leaked public key lets
 * nobody forge a license; a leaked private key lets anyone forge every license,
 * so the private key never leaves this folder and is gitignored.
 *
 *   node tools/generate-keypair.mjs
 *
 * It writes tools/keys/private-key.pem (secret) and prints the public key PEM to
 * paste into backend/services/licenseService.js (EMBEDDED_PUBLIC_KEY_PEM).
 *
 * Regenerating invalidates every license already issued — so it refuses to run if
 * a private key already exists.
 */

import { generateKeyPairSync } from 'crypto';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const KEYS_DIR = path.join(__dirname, 'keys');
const PRIVATE_KEY_PATH = path.join(KEYS_DIR, 'private-key.pem');

if (fs.existsSync(PRIVATE_KEY_PATH)) {
  console.error(
    `\nRefusing to overwrite the existing private key at:\n  ${PRIVATE_KEY_PATH}\n\n` +
      'Regenerating would invalidate every license already issued. Delete it by\n' +
      'hand only if you are absolutely certain.\n'
  );
  process.exit(1);
}

const { publicKey, privateKey } = generateKeyPairSync('ed25519');
const privPem = privateKey.export({ type: 'pkcs8', format: 'pem' });
const pubPem = publicKey.export({ type: 'spki', format: 'pem' });

fs.mkdirSync(KEYS_DIR, { recursive: true });
fs.writeFileSync(PRIVATE_KEY_PATH, privPem, { mode: 0o600 });

console.log('\n✅ Ed25519 keypair generated.\n');
console.log('Private key written to (KEEP SECRET — never commit, never share):');
console.log(`  ${PRIVATE_KEY_PATH}\n`);
console.log('═'.repeat(72));
console.log('PUBLIC KEY — paste the whole block below into');
console.log('backend/services/licenseService.js as EMBEDDED_PUBLIC_KEY_PEM:');
console.log('═'.repeat(72));
console.log(pubPem.trim());
console.log('═'.repeat(72) + '\n');
