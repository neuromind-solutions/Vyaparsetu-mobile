import http from 'http';
import fs from 'fs';
import path from 'path';
import crypto from 'crypto';
import os from 'os';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PRIVATE_KEY_PATH = path.join(__dirname, 'keys', 'private-key.pem');
const REGISTER_PATH = path.join(__dirname, 'licenses.json');
const PORT = process.env.PORT || 5001;
const ADMIN_PIN = process.env.ADMIN_PIN || '1234';

function getLocalIp() {
  const interfaces = os.networkInterfaces();
  for (const name of Object.keys(interfaces)) {
    for (const iface of interfaces[name]) {
      if (iface.family === 'IPv4' && !iface.internal) {
        return iface.address;
      }
    }
  }
  return 'localhost';
}

function getPrivateKeyPem() {
  if (process.env.PRIVATE_KEY_PEM) {
    return process.env.PRIVATE_KEY_PEM.replace(/\\n/g, '\n');
  }
  if (fs.existsSync(PRIVATE_KEY_PATH)) {
    return fs.readFileSync(PRIVATE_KEY_PATH, 'utf8');
  }
  throw new Error('Private key missing! Set PRIVATE_KEY_PEM environment variable or place key in tools/keys/private-key.pem');
}

function readRegister() {
  if (!fs.existsSync(REGISTER_PATH)) return [];
  try {
    const data = JSON.parse(fs.readFileSync(REGISTER_PATH, 'utf8'));
    return Array.isArray(data) ? data : [];
  } catch {
    return [];
  }
}

function writeRegister(data) {
  try {
    fs.writeFileSync(REGISTER_PATH, JSON.stringify(data, null, 2), 'utf8');
  } catch (err) {
    console.error('Failed to write register:', err.message);
  }
}

function mintLicense(name, mid, days = 0, customExpiry = null) {
  const cleanName = (name || '').trim();
  const cleanMid = (mid || '').trim().toUpperCase();

  if (!cleanName) throw new Error('Client / Shop Name is required');
  if (!cleanMid) throw new Error('Machine ID is required');

  const iat = Math.floor(Date.now() / 1000);
  let exp = 0;

  if (customExpiry) {
    const ms = Date.parse(`${customExpiry}T23:59:59`);
    if (isNaN(ms)) throw new Error('Invalid custom expiry date format');
    exp = Math.floor(ms / 1000);
    if (exp <= iat) throw new Error('Custom expiry date cannot be in the past');
  } else if (days > 0) {
    exp = iat + Math.round(days * 86400);
  }

  const privateKeyPem = getPrivateKeyPem();
  const privateKey = crypto.createPrivateKey(privateKeyPem);
  const payload = {
    v: 1,
    lid: crypto.randomUUID(),
    name: cleanName,
    mid: cleanMid,
    iat,
    exp,
  };

  const payloadSeg = Buffer.from(JSON.stringify(payload)).toString('base64url');
  const signature = crypto.sign(null, Buffer.from(payloadSeg), privateKey).toString('base64url');
  const licenseKey = `${payloadSeg}.${signature}`;

  const expiryHuman = exp === 0 ? 'perpetual' : new Date(exp * 1000).toISOString();
  const register = readRegister();

  const record = {
    lid: payload.lid,
    name: cleanName,
    mid: cleanMid,
    iat,
    exp,
    issuedAt: new Date(iat * 1000).toISOString(),
    expiry: expiryHuman,
    key: licenseKey,
  };

  register.unshift(record);
  writeRegister(register);

  return record;
}

const HTML_CONTENT = `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0, maximum-scale=1.0, user-scalable=no, viewport-fit=cover">
  <meta name="theme-color" content="#090d16">
  <meta name="apple-mobile-web-app-capable" content="yes">
  <meta name="apple-mobile-web-app-status-bar-style" content="black-translucent">
  <title>VyapaarSetu — License Hub Mobile</title>
  <link rel="preconnect" href="https://fonts.googleapis.com">
  <link href="https://fonts.googleapis.com/css2?family=Plus+Jakarta+Sans:wght@400;500;600;700;800&family=JetBrains+Mono:wght@400;500;600&display=swap" rel="stylesheet">
  <style>
    :root {
      --bg: #090d16;
      --card-bg: #111827;
      --card-border: #1f293d;
      --primary: #2563eb;
      --primary-hover: #1d4ed8;
      --accent: #10b981;
      --text: #f9fafb;
      --text-muted: #94a3b8;
      --whatsapp: #22c55e;
      --whatsapp-hover: #16a34a;
      --danger: #ef4444;
      --radius: 16px;
    }
    * { box-sizing: border-box; margin: 0; padding: 0; font-family: 'Plus Jakarta Sans', sans-serif; -webkit-tap-highlight-color: transparent; }
    body { background: var(--bg); color: var(--text); padding: 16px; min-height: 100vh; padding-bottom: 40px; }
    .container { max-width: 600px; margin: 0 auto; }
    
    /* Header */
    header {
      display: flex;
      justify-content: space-between;
      align-items: center;
      padding: 12px 0 20px 0;
      border-bottom: 1px solid var(--card-border);
      margin-bottom: 20px;
    }
    .brand { display: flex; align-items: center; gap: 12px; }
    .brand-icon {
      width: 42px;
      height: 42px;
      background: linear-gradient(135deg, #10b981, #2563eb);
      border-radius: 12px;
      display: flex;
      align-items: center;
      justify-content: center;
      font-size: 1.3rem;
      box-shadow: 0 4px 12px rgba(37,99,235,0.3);
    }
    .brand-text h1 { font-size: 1.2rem; font-weight: 800; color: #fff; letter-spacing: -0.3px; }
    .brand-text p { font-size: 0.75rem; color: var(--accent); font-weight: 600; }
    .lock-status {
      background: #1e293b;
      padding: 6px 12px;
      border-radius: 20px;
      font-size: 0.75rem;
      color: var(--text-muted);
      border: 1px solid var(--card-border);
    }

    /* Cards */
    .card {
      background: var(--card-bg);
      border: 1px solid var(--card-border);
      border-radius: var(--radius);
      padding: 20px;
      margin-bottom: 20px;
      box-shadow: 0 8px 24px rgba(0,0,0,0.2);
    }
    .card-title {
      font-size: 1rem;
      font-weight: 700;
      margin-bottom: 16px;
      display: flex;
      align-items: center;
      gap: 8px;
    }

    /* Form Inputs */
    .form-group { margin-bottom: 16px; }
    label { display: block; font-size: 0.8rem; font-weight: 600; color: var(--text-muted); margin-bottom: 6px; }
    input, select {
      width: 100%;
      padding: 14px 16px;
      background: #0f172a;
      border: 1px solid #334155;
      border-radius: 12px;
      color: #fff;
      font-size: 0.95rem;
      outline: none;
      transition: border-color 0.2s;
    }
    input:focus, select:focus { border-color: var(--accent); }
    input::placeholder { color: #475569; }
    .mono { font-family: 'JetBrains Mono', monospace; letter-spacing: 1px; }

    /* Duration Presets (Pills) */
    .pill-grid {
      display: grid;
      grid-template-columns: repeat(2, 1fr);
      gap: 8px;
      margin-bottom: 16px;
    }
    .pill-btn {
      padding: 12px;
      background: #0f172a;
      border: 1px solid #334155;
      border-radius: 10px;
      color: var(--text-muted);
      font-size: 0.85rem;
      font-weight: 600;
      cursor: pointer;
      text-align: center;
      transition: all 0.2s;
    }
    .pill-btn.active {
      background: rgba(16,185,129,0.15);
      border-color: var(--accent);
      color: var(--accent);
    }

    /* Action Buttons */
    .btn-primary {
      width: 100%;
      padding: 16px;
      background: linear-gradient(135deg, #10b981, #059669);
      border: none;
      border-radius: 14px;
      color: #fff;
      font-size: 1rem;
      font-weight: 700;
      cursor: pointer;
      display: flex;
      align-items: center;
      justify-content: center;
      gap: 8px;
      box-shadow: 0 4px 16px rgba(16,185,129,0.4);
      transition: transform 0.1s, opacity 0.2s;
    }
    .btn-primary:active { transform: scale(0.98); }
    .btn-primary:disabled { opacity: 0.6; cursor: not-allowed; }

    /* Result Box */
    .result-card {
      background: linear-gradient(180deg, #13271e, #111827);
      border: 1px solid #059669;
      border-radius: var(--radius);
      padding: 20px;
      margin-bottom: 20px;
      display: none;
      animation: slideDown 0.3s ease;
    }
    @keyframes slideDown { from { opacity: 0; transform: translateY(-10px); } to { opacity: 1; transform: translateY(0); } }
    
    .key-display {
      background: #090d16;
      border: 1px solid #334155;
      border-radius: 12px;
      padding: 12px;
      font-family: 'JetBrains Mono', monospace;
      font-size: 0.75rem;
      color: #34d399;
      word-break: break-all;
      margin: 12px 0;
      max-height: 90px;
      overflow-y: auto;
    }
    .action-row { display: grid; grid-template-columns: 1fr 1fr; gap: 10px; margin-top: 14px; }
    .btn-copy {
      padding: 14px;
      background: #1e293b;
      border: 1px solid #334155;
      border-radius: 12px;
      color: #fff;
      font-weight: 700;
      font-size: 0.9rem;
      cursor: pointer;
      display: flex;
      align-items: center;
      justify-content: center;
      gap: 6px;
    }
    .btn-wa {
      padding: 14px;
      background: var(--whatsapp);
      border: none;
      border-radius: 12px;
      color: #fff;
      font-weight: 700;
      font-size: 0.9rem;
      cursor: pointer;
      display: flex;
      align-items: center;
      justify-content: center;
      gap: 6px;
      box-shadow: 0 4px 12px rgba(34,197,94,0.3);
    }

    /* History List */
    .history-header {
      display: flex;
      justify-content: space-between;
      align-items: center;
      margin-bottom: 12px;
    }
    .history-item {
      background: #0f172a;
      border: 1px solid var(--card-border);
      border-radius: 12px;
      padding: 14px;
      margin-bottom: 10px;
      display: flex;
      flex-direction: column;
      gap: 8px;
    }
    .history-top { display: flex; justify-content: space-between; align-items: flex-start; }
    .client-name { font-weight: 700; font-size: 0.95rem; color: #fff; }
    .tag {
      font-size: 0.7rem;
      padding: 3px 8px;
      border-radius: 6px;
      font-weight: 700;
    }
    .tag-perpetual { background: rgba(16,185,129,0.2); color: #34d399; }
    .tag-expiring { background: rgba(59,130,246,0.2); color: #60a5fa; }
    .history-mid { font-family: 'JetBrains Mono', monospace; font-size: 0.75rem; color: var(--text-muted); }
    .history-actions { display: flex; gap: 8px; margin-top: 4px; }
    .btn-sm {
      flex: 1;
      padding: 8px;
      border-radius: 8px;
      font-size: 0.75rem;
      font-weight: 600;
      cursor: pointer;
      border: 1px solid #334155;
      background: #1e293b;
      color: #fff;
      display: flex;
      align-items: center;
      justify-content: center;
      gap: 4px;
    }
    .btn-sm-wa { background: #15803d; border-color: #16a34a; }

    /* Security PIN Modal */
    #pinModal {
      position: fixed;
      top: 0; left: 0; right: 0; bottom: 0;
      background: rgba(9,13,22,0.95);
      backdrop-filter: blur(8px);
      display: flex;
      align-items: center;
      justify-content: center;
      padding: 20px;
      z-index: 9999;
    }
    .pin-box {
      background: var(--card-bg);
      border: 1px solid var(--card-border);
      border-radius: 20px;
      padding: 28px;
      width: 100%;
      max-width: 360px;
      text-align: center;
      box-shadow: 0 12px 36px rgba(0,0,0,0.5);
    }
    .pin-input {
      font-size: 1.8rem;
      text-align: center;
      letter-spacing: 8px;
      margin: 20px 0;
      padding: 12px;
    }

    /* Toast */
    #toast {
      position: fixed;
      bottom: 24px;
      left: 50%;
      transform: translateX(-50%);
      background: #10b981;
      color: #fff;
      padding: 12px 24px;
      border-radius: 30px;
      font-size: 0.85rem;
      font-weight: 700;
      display: none;
      box-shadow: 0 8px 24px rgba(0,0,0,0.4);
      z-index: 10000;
    }
  </style>
</head>
<body>

<!-- Security PIN Screen -->
<div id="pinModal">
  <div class="pin-box">
    <div style="font-size: 2.5rem; margin-bottom: 12px;">🛡️</div>
    <h2 style="font-size: 1.25rem; font-weight: 800; margin-bottom: 6px;">Admin Access</h2>
    <p style="font-size: 0.8rem; color: var(--text-muted);">Enter Master PIN to generate keys</p>
    <input type="password" id="pinCode" class="pin-input" maxlength="6" inputmode="numeric" placeholder="••••" autofocus>
    <button class="btn-primary" onclick="verifyPin()">Unlock Hub</button>
  </div>
</div>

<div class="container">
  <!-- Header -->
  <header>
    <div class="brand">
      <div class="brand-icon">🌱</div>
      <div class="brand-text">
        <h1>VyapaarSetu</h1>
        <p>MOBILE LICENSE GENERATOR</p>
      </div>
    </div>
    <div class="lock-status" id="deviceStatus">● Online</div>
  </header>

  <!-- Generated Key Result Box -->
  <div id="resultBox" class="result-card">
    <div style="display: flex; justify-content: space-between; align-items: center;">
      <span style="font-size: 0.8rem; font-weight: 700; color: #34d399;">✓ KEY GENERATED SUCCESSFULLY</span>
      <span id="resExpiry" style="font-size: 0.75rem; color: var(--text-muted);"></span>
    </div>
    <div id="resDetails" style="font-weight: 700; font-size: 1rem; margin-top: 4px; color: #fff;"></div>
    <div class="key-display" id="keyOutput"></div>
    <div class="action-row">
      <button class="btn-copy" onclick="copyKey()">📋 Copy Key</button>
      <button class="btn-wa" onclick="shareWhatsApp()">💬 WhatsApp</button>
    </div>
  </div>

  <!-- Generator Form Card -->
  <div class="card">
    <div class="card-title">⚡ Mint New License</div>
    
    <div class="form-group">
      <label>CLIENT / SHOP NAME</label>
      <input type="text" id="clientName" placeholder="e.g. Ramesh Vegetable Traders">
    </div>

    <div class="form-group">
      <label>MACHINE ID (FROM CLIENT APP)</label>
      <input type="text" id="machineId" class="mono" placeholder="XXXX-XXXX-XXXX-XXXX" oninput="formatMachineId(this)">
    </div>

    <div class="form-group">
      <label>VALIDITY PERIOD</label>
      <div class="pill-grid">
        <div class="pill-btn active" onclick="setValidity('365', this)">📅 1 Year (365d)</div>
        <div class="pill-btn" onclick="setValidity('0', this)">♾️ Lifetime</div>
        <div class="pill-btn" onclick="setValidity('30', this)">🌙 1 Month (30d)</div>
        <div class="pill-btn" onclick="setValidity('7', this)">🧪 Trial (7d)</div>
      </div>
      <input type="date" id="customDateInput" style="display: none; margin-top: 8px;">
    </div>

    <button id="mintBtn" class="btn-primary" onclick="generateLicense()">
      <span>✨ Mint & Sign License Key</span>
    </button>
  </div>

  <!-- Issued Licenses History -->
  <div class="card">
    <div class="history-header">
      <div class="card-title" style="margin-bottom: 0;">📜 Issued Licenses (<span id="totalCount">0</span>)</div>
      <input type="text" id="searchBox" placeholder="Search..." style="width: 130px; padding: 6px 10px; font-size: 0.8rem;" oninput="filterHistory()">
    </div>
    <div id="historyList" style="margin-top: 14px;">
      <p style="text-align: center; color: var(--text-muted); font-size: 0.85rem; padding: 20px;">Loading records...</p>
    </div>
  </div>
</div>

<div id="toast"></div>

<script>
  let selectedDays = '365';
  let latestKey = '';
  let latestName = '';
  let allLicenses = [];
  const SERVER_PIN = '${ADMIN_PIN}';

  // Check Local Auth
  if (sessionStorage.getItem('license_hub_auth') === '1') {
    document.getElementById('pinModal').style.display = 'none';
  }

  function verifyPin() {
    const input = document.getElementById('pinCode').value.trim();
    if (input === SERVER_PIN || SERVER_PIN === '') {
      sessionStorage.setItem('license_hub_auth', '1');
      document.getElementById('pinModal').style.display = 'none';
      loadLicenses();
    } else {
      alert('Incorrect PIN!');
      document.getElementById('pinCode').value = '';
    }
  }

  document.getElementById('pinCode').addEventListener('keyup', (e) => {
    if (e.key === 'Enter') verifyPin();
  });

  function formatMachineId(el) {
    let val = el.value.replace(/[^A-Fa-f0-9]/g, '').toUpperCase();
    let parts = val.match(/.{1,4}/g);
    el.value = parts ? parts.slice(0, 4).join('-') : val;
  }

  function setValidity(days, btn) {
    selectedDays = days;
    document.querySelectorAll('.pill-btn').forEach(b => b.classList.remove('active'));
    btn.classList.add('active');
  }

  async function loadLicenses() {
    try {
      const res = await fetch('/api/licenses');
      if (!res.ok) throw new Error('Failed to load licenses');
      allLicenses = await res.json();
      document.getElementById('totalCount').innerText = allLicenses.length;
      renderHistory(allLicenses);
    } catch (err) {
      document.getElementById('historyList').innerHTML = '<p style="color:var(--danger);font-size:0.85rem;">Error loading licenses: ' + err.message + '</p>';
    }
  }

  function renderHistory(list) {
    const container = document.getElementById('historyList');
    if (!list.length) {
      container.innerHTML = '<p style="text-align:center;color:var(--text-muted);font-size:0.85rem;padding:16px;">No licenses issued yet.</p>';
      return;
    }

    container.innerHTML = list.map(item => {
      const isPerpetual = item.exp === 0;
      const tagClass = isPerpetual ? 'tag-perpetual' : 'tag-expiring';
      const tagText = isPerpetual ? 'PERPETUAL' : new Date(item.exp * 1000).toLocaleDateString();

      return \`
        <div class="history-item">
          <div class="history-top">
            <span class="client-name">\${escapeHtml(item.name)}</span>
            <span class="tag \${tagClass}">\${tagText}</span>
          </div>
          <div class="history-mid">\${escapeHtml(item.mid)}</div>
          <div class="history-actions">
            <button class="btn-sm" onclick="copyText('\${escapeHtml(item.key)}')">📋 Copy</button>
            <button class="btn-sm btn-sm-wa" onclick="shareWhatsAppDirect('\${encodeURIComponent(item.name)}', '\${encodeURIComponent(item.key)}')">💬 WhatsApp</button>
          </div>
        </div>
      \`;
    }).join('');
  }

  function filterHistory() {
    const q = document.getElementById('searchBox').value.toLowerCase().trim();
    if (!q) return renderHistory(allLicenses);
    const filtered = allLicenses.filter(l => l.name.toLowerCase().includes(q) || l.mid.toLowerCase().includes(q));
    renderHistory(filtered);
  }

  async function generateLicense() {
    const name = document.getElementById('clientName').value.trim();
    const mid = document.getElementById('machineId').value.trim();
    const btn = document.getElementById('mintBtn');

    if (!name) return alert('Please enter Client / Shop Name');
    if (!mid) return alert('Please enter Machine ID');

    btn.disabled = true;
    btn.innerText = 'Signing & Minting...';

    try {
      const res = await fetch('/api/licenses', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name,
          mid,
          days: parseInt(selectedDays, 10)
        })
      });

      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Failed to mint key');

      latestKey = data.key;
      latestName = data.name;

      document.getElementById('resDetails').innerText = data.name + ' (' + data.mid + ')';
      document.getElementById('resExpiry').innerText = data.exp === 0 ? 'Perpetual' : 'Valid until ' + new Date(data.exp * 1000).toLocaleDateString();
      document.getElementById('keyOutput').innerText = data.key;
      document.getElementById('resultBox').style.display = 'block';

      showToast('✓ License Key Created & Saved!');
      window.scrollTo({ top: 0, behavior: 'smooth' });
      loadLicenses();
    } catch (err) {
      alert('Error: ' + err.message);
    } finally {
      btn.disabled = false;
      btn.innerText = '✨ Mint & Sign License Key';
    }
  }

  function copyKey() {
    copyText(latestKey);
  }

  function copyText(text) {
    if (navigator.clipboard) {
      navigator.clipboard.writeText(text).then(() => showToast('✓ Copied to clipboard!'));
    } else {
      const ta = document.createElement('textarea');
      ta.value = text;
      document.body.appendChild(ta);
      ta.select();
      document.execCommand('copy');
      document.body.removeChild(ta);
      showToast('✓ Copied to clipboard!');
    }
  }

  function shareWhatsApp() {
    shareWhatsAppDirect(latestName, latestKey);
  }

  function shareWhatsAppDirect(name, key) {
    const decodedName = decodeURIComponent(name);
    const decodedKey = decodeURIComponent(key);
    const text = "Namaste *" + decodedName + "* ji 🙏\\n\\nHere is your official activation license key for *VyapaarSetu*:\\n\\n" + decodedKey + "\\n\\n*Steps to activate:*\\n1. Copy the key above\\n2. Paste it on the VyapaarSetu activation screen\\n3. Click Activate\\n\\nNeed help? Contact us anytime.";
    window.open('https://api.whatsapp.com/send?text=' + encodeURIComponent(text), '_blank');
  }

  function showToast(msg) {
    const toast = document.getElementById('toast');
    toast.innerText = msg;
    toast.style.display = 'block';
    setTimeout(() => { toast.style.display = 'none'; }, 2500);
  }

  function escapeHtml(str) {
    return (str || '').replace(/[&<>"']/g, m => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[m]));
  }

  loadLicenses();
</script>

</body>
</html>`;

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, `http://${req.headers.host}`);

  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, DELETE, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') {
    res.writeHead(204);
    return res.end();
  }

  // UI endpoint
  if (url.pathname === '/' || url.pathname === '/index.html') {
    res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
    return res.end(HTML_CONTENT);
  }

  // API: Get all licenses
  if (url.pathname === '/api/licenses' && req.method === 'GET') {
    const data = readRegister();
    res.writeHead(200, { 'Content-Type': 'application/json' });
    return res.end(JSON.stringify(data));
  }

  // API: Mint new license
  if (url.pathname === '/api/licenses' && req.method === 'POST') {
    let body = '';
    req.on('data', chunk => { body += chunk; });
    req.on('end', () => {
      try {
        const payload = JSON.parse(body || '{}');
        const record = mintLicense(payload.name, payload.mid, payload.days, payload.customExpiry);
        res.writeHead(201, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify(record));
      } catch (err) {
        res.writeHead(400, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: err.message }));
      }
    });
    return;
  }

  // API: Delete license
  if (url.pathname.startsWith('/api/licenses/') && req.method === 'DELETE') {
    const lid = url.pathname.replace('/api/licenses/', '');
    let register = readRegister();
    register = register.filter(l => l.lid !== lid);
    writeRegister(register);
    res.writeHead(200, { 'Content-Type': 'application/json' });
    return res.end(JSON.stringify({ success: true }));
  }

  res.writeHead(404, { 'Content-Type': 'text/plain' });
  res.end('Not Found');
});

server.listen(PORT, '0.0.0.0', () => {
  const localIp = getLocalIp();
  console.log('\n════════════════════════════════════════════════════════════════════');
  console.log('         🛡️  VYAPAARSETU MOBILE LICENSE GENERATOR HUB                ');
  console.log('════════════════════════════════════════════════════════════════════');
  console.log(`  💻 PC Link             : http://localhost:${PORT}`);
  console.log(`  📱 Mobile Phone Link   : http://${localIp}:${PORT}  (Same Wi-Fi)`);
  console.log(`  🔒 Master Security PIN : ${ADMIN_PIN}`);
  console.log('════════════════════════════════════════════════════════════════════\n');
});
