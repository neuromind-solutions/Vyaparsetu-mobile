# 🌿 VyapaarSetu

> **Offline-first, bilingual (Marathi + English) vegetable-market vendor management for APMC commission agents, traders, and wholesalers.**

VyapaarSetu is a **Windows desktop app**. It runs entirely on one shop PC — no cloud
account, no internet required for daily use. It packages a local web app (React + an
embedded SQLite database) inside a single installable program: its own window, its own
icon, a Start-Menu entry. No terminal, no browser tab.

---

## 📥 Install (for shopkeepers)

1. Get the installer — **`VyapaarSetu Setup <version>.exe`**.
2. Double-click it and follow the prompts. You can choose the install folder; shortcuts are
   added to the Desktop and Start Menu.
3. Launch **VyapaarSetu** from the Start Menu.
4. On first launch the app asks for a **license key** — see [Activation](#-activation) below.

> **First launch & Windows SmartScreen:** the app isn't code-signed yet, so Windows may show
> a blue *"Windows protected your PC"* dialog. Click **More info → Run anyway**. This is
> expected for now (see [Known limitations](#-known-limitations)).

### 🔑 Activation

VyapaarSetu is licensed **per computer**. The first time you open it you'll see an activation
screen showing a **Machine ID** (like `3F9A-1C2B-77D0-AE41`).

1. Send that Machine ID to whoever sold you the app.
2. They send back a **license key**.
3. Paste the key into the box and press **Activate**. That's it — the app unlocks and stays
   unlocked on that PC. You never need to do this again, and it works with no internet.

A few things worth knowing:

- A key works on **one computer only**. Copying the installer or the data folder to another
  PC won't work there — that PC needs its own key.
- If you reinstall Windows or move to a new PC, the Machine ID changes. Ask your seller for a
  replacement key.
- Restoring a backup never deactivates the app; your license is stored separately from your data.

### Where your data lives

Everything you enter is stored in one per-user folder — safe to copy for a manual backup:

```
%APPDATA%\VyapaarSetu\
├─ data\vyapaarsetu.db      ← your customers, bills, ledger (SQLite)
├─ backups\                 ← local timestamped snapshots
├─ license.json             ← your activation (tied to this PC)
├─ logs\main.log            ← startup log, useful if the app won't open
└─ drive_tokens.json        ← Google Drive login (only if you connect Drive)
```

Paste `%APPDATA%\VyapaarSetu` into the Windows Explorer address bar to open it. Uninstalling
the app leaves this folder in place, so your ledger survives a reinstall or upgrade.

---

## ✨ What it does

- **Dashboard** — today's sales, commission, active customers, database health, and a
  live ledger-reconciliation check that flags any customer whose balance drifts from their
  passbook.
- **Customers** — profiles with unique mobile numbers, credit (udhar) ledgers, phonetic
  Marathi name entry.
- **Vegetables** — rate master with units (kg, piece, bundle, dozen) and phonetic search.
- **Billing** — invoices with discounts, commission, cash/UPI/credit, amount-in-words.
- **Udhar / Credit ledger** — additions, manual adjustments, payments, per-customer history.
- **Reports** — daily / date-range sales, customer sheets, vegetable weight logs, commission.
- **WhatsApp sharing** — send a bill straight to a customer via WhatsApp.
- **Backup & restore** — local snapshots with fail-safe transactional restore, plus optional
  Google Drive sync.

All money is stored on disk as whole **paise** (integers), so balances and their ledgers
reconcile exactly — no floating-point drift.

---

## 🛠️ For developers

### Prerequisites

| Tool    | Version            |
|---------|--------------------|
| Node.js | ≥ 18 (20 / 22 recommended) |
| npm     | ≥ 9                |
| OS for building the installer | Windows |

### Repository layout

```
VyapaarSetu/
├─ electron/       Electron main process (wraps the backend + opens the window)
├─ backend/        Express API + SQLite (better-sqlite3), business logic, tests
├─ frontend/       React 19 + Vite SPA
├─ tools/          Developer licensing CLIs (keypair + license issuing) — see tools/README.md
├─ build/          App icon + icon generator
└─ package.json    The Electron app + electron-builder config
```

### Run in development

The backend and frontend run as two dev servers (hot reload), the same as any web app:

```bash
cd backend
npm install
npm run dev          # Express on http://localhost:5000
```

```bash
cd frontend
npm install
npm run dev          # Vite on http://localhost:5173
```

Open http://localhost:5173. In dev, `frontend/.env` points the SPA at `http://localhost:5000`.

Dev hits the same activation wall as a shipped app. To skip it, set `LICENSE_DEV_BYPASS=1` in
`backend/.env` — it is ignored whenever `NODE_ENV=production`, so it can never unlock a
shipped build. To exercise the real flow instead, leave it unset and issue yourself a key
(see [Licensing](#-licensing-developer-side)).

### Run the desktop shell in development

To run the packaged experience (Electron window serving the built SPA) without building an
installer:

```bash
npm install              # at the repo root — installs Electron + prod deps
npm run build:frontend   # produces frontend/dist (same-origin build)
npm start                # opens the VyapaarSetu window
```

### Tests

```bash
cd backend
npm test                 # vitest — schema, migrations, money, reconciliation
```

### Build the Windows installer

```bash
npm install              # at the repo root
npm run dist             # → release\VyapaarSetu Setup <version>.exe
```

`npm run dist` builds the frontend and runs electron-builder (NSIS). The bundled
`better-sqlite3` ships as a portable **N-API prebuild**, so no native rebuild or C++
toolchain is needed on the build machine (`npmRebuild: false`).

The app icon (`build/icon.png`) is committed. Regenerate it from the SVG favicon only if the
art changes:

```bash
npm run make-icon        # favicon.svg → build/icon.png (needs the sharp devDependency)
```

---

## 🔐 Licensing (developer side)

VyapaarSetu is sold per-PC and enforces that **offline**, with signed machine-bound licenses.
The full runbook lives in **[`tools/README.md`](tools/README.md)**; the short version:

- An **Ed25519 private key** (`tools/keys/private-key.pem`, gitignored) is the only thing that
  can mint a license. The app embeds only the matching **public key** and can only *verify*.
- Each install shows a **Machine ID** derived from that PC's Windows `MachineGuid`. You mint a
  key bound to it and the customer pastes it in:

  ```bash
  node tools/generate-license.mjs --name "Sharma Traders" --machine "3F9A-1C2B-77D0-AE41"
  ```

  Add `--days 30` or `--expiry 2027-03-31` for a time-limited key; omit both for perpetual.
- Every issued key is appended to `tools/licenses.json` — your private register of who is
  licensed. Both that file and the private key are gitignored and **must never be committed or
  shared**. Keep an offline backup of the private key: losing it means you can no longer issue
  keys for the current build.
- Enforcement is server-side: `backend/services/licenseService.js` verifies signature + Machine
  ID + expiry, and an Express guard in `server.js` rejects every `/api` route with
  `403 LICENSE_REQUIRED` until activated (`/api/health` and `/api/license/*` stay open so the
  app can still boot and activate). The license is stored at `%APPDATA%\VyapaarSetu\license.json`,
  deliberately outside the SQLite file so a backup/restore can neither wipe an activation nor
  import another machine's license.

This stops casual copying — the actual threat for a localhost single-PC product. It is not
designed to defeat a determined cracker; an on-device check never can be.

---

## ☁️ Google Drive backup (optional)

Drive sync is inert unless OAuth credentials are provided via environment variables
(`GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`, `GOOGLE_REDIRECT_URI`). To enable it, create an
OAuth Client in the [Google Cloud Console](https://console.cloud.google.com):

1. Create a project, enable the **Google Drive API**.
2. On the **OAuth consent screen**, add the scope `https://www.googleapis.com/auth/drive.file`
   and add your Google account as a test user.
3. Create an **OAuth client ID** (Web application) with redirect URI
   `http://localhost:5000/api/drive/oauth-callback`.
4. Supply the Client ID/Secret to the app via the environment. Local backups work without any
   of this.

---

## 🚧 Known limitations

- **Not code-signed** — Windows SmartScreen warns on first run (*More info → Run anyway*).
- **Google Drive** needs OAuth env vars to activate; otherwise only local backups run.
- **Fonts** are loaded from Google Fonts; offline, the app falls back to system fonts.
- **Single-PC, localhost only** — designed for one shop machine, not multi-device sync.
- **No auto-update** — install a newer build over the old one; your data folder is preserved.
- **Licensing is machine-bound, not crack-proof.** An OS reinstall changes the Machine ID and
  needs a replacement key. Time-limited keys trust the PC clock, so setting the clock back can
  outlast an expiry (perpetual keys are unaffected). Keys are issued by hand — there's no
  online activation server or dashboard.

---

## 🩺 Troubleshooting

**"This license key is for a different computer."**
Keys are bound to one PC. Read the Machine ID off the activation screen of *this* machine and
ask your seller for a key issued for it — a key from another PC (or a copied data folder)
won't activate.

**The app asks for a license key again after a restore.**
It shouldn't — the license lives in `%APPDATA%\VyapaarSetu\license.json`, outside the database.
If that file was deleted, paste your key again; it stays valid for the same PC.

**The app won't start / "failed to start its local server."**
Your data folder may not be writable, or another VyapaarSetu instance is running. It stores
data in `%APPDATA%\VyapaarSetu`; ensure that path is writable.

**Deleted customers/vegetables still appear on old bills.**
By design — VyapaarSetu soft-deletes, hiding records from pickers while keeping them so
historical invoices still render. Customers with an outstanding balance can't be deleted.

**Dashboard shows a ledger mismatch.**
The reconciliation check found a customer whose stored balance differs from the sum of their
passbook. Open that customer to review their entries.

---

*Built with ❤️ for the local vegetable-market community.*
