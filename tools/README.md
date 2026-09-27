# VyapaarSetu — developer licensing tools

Offline, machine-bound license issuing. These scripts run on **your** machine only.
Nothing here ships to customers, and nothing here may be committed (see `.gitignore`).

## The model in one paragraph

The app is sold per-PC. Each install shows a **Machine ID** on its activation screen.
You sign a tiny payload (customer name + that Machine ID + optional expiry) with an
**Ed25519 private key that only you hold**. The shipped app embeds only the matching
**public key**, so it can *verify* a key but never *mint* one. A license activates a PC
only if the signature checks out **and** the bound Machine ID equals that PC's Machine ID
**and** it hasn't expired — so copying the `.exe`, or even the whole `%APPDATA%\VyapaarSetu`
folder, to another PC does nothing: the Machine ID won't match.

## One-time setup (already done — do NOT repeat)

```bash
node tools/generate-keypair.mjs
```

Writes `tools/keys/private-key.pem` (secret) and prints the public key. The public key is
already pasted into `backend/services/licenseService.js` as `EMBEDDED_PUBLIC_KEY_PEM`.

**Re-running this invalidates every license already issued** — the script refuses to
overwrite an existing key for exactly that reason. Back up `tools/keys/private-key.pem`
somewhere safe and offline; if you lose it you can never issue a key for the current app
build again.

## Issuing a license (per sale)

1. On the customer's PC, open the app. It shows the **activation screen** with a Machine ID
   like `3F9A-1C2B-77D0-AE41`. Read it (phone, WhatsApp, in person).
2. On your machine, mint a key bound to that Machine ID:

   ```bash
   # Perpetual license (most sales):
   node tools/generate-license.mjs --name "Sharma Traders" --machine "3F9A-1C2B-77D0-AE41"

   # 30-day trial:
   node tools/generate-license.mjs --name "Trial Shop" --machine "3F9A-1C2B-77D0-AE41" --days 30

   # Fixed expiry date:
   node tools/generate-license.mjs --name "Yearly Shop" --machine "3F9A-1C2B-77D0-AE41" --expiry 2027-03-31
   ```

3. Send the printed **LICENSE KEY** to the customer. They paste it into the activation
   screen and press Activate — the app unlocks and stays unlocked on that PC.

Every issued key is appended to `tools/licenses.json`, your private register of who is
licensed (name, Machine ID, issue/expiry dates, the key itself).

## Re-issuing / renewals / new PC

- **Renewal or replacement:** issue a new key for the same Machine ID and have the customer
  paste it. Entering a new key overwrites the old one — no uninstall needed.
- **OS reinstall / new PC:** the Machine ID changes. Issue a fresh key for the new Machine ID.
  The register keeps the old row so you can see the history for that customer.

## What must never leak

- `tools/keys/private-key.pem` — anyone with this can forge licenses for every install.
- `tools/licenses.json` — your customer register.

Both are gitignored. Keep an **offline backup** of the private key; treat it like a signing
certificate.

## Notes / limits

- Time-limited keys trust the PC clock; a user who sets their clock back can defeat an
  expiry. Perpetual keys are unaffected. Fine for this product's threat model (stop casual
  copying), not designed to defeat a determined cracker.
- The check is on-device, so a technical user could in principle patch it. Shipping with
  `asar` enabled (packaging config) puts it out of reach of any non-technical shopkeeper,
  which is the actual threat.
