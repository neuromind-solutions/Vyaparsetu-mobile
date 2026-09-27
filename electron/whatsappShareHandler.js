/**
 * WhatsApp PDF Sharing IPC Handler for Electron
 *
 * Automates Windows Clipboard CF_HDROP insertion and SendKeys '^v' paste
 * into WhatsApp Desktop / Web window as specified in WHATSAPP_PDF_SHARING_GUIDE.md.
 */

const { ipcMain } = require('electron');
const { spawn } = require('child_process');
const fs = require('fs');
const path = require('path');
const os = require('os');

/**
 * Strips non-digits and ensures standard 91 country code prefix for 10-digit Indian numbers
 */
function sanitizeWhatsAppPhone(phone) {
  if (!phone) return '';
  let rawDigits = String(phone).replace(/\D/g, '');
  if (rawDigits.startsWith('0')) {
    rawDigits = rawDigits.replace(/^0+/, '');
  }
  if (rawDigits.length === 10) {
    return `91${rawDigits}`;
  }
  return rawDigits.length >= 10 ? rawDigits : '';
}

/**
 * Registers the 'share-whatsapp' IPC handler on the Electron main process
 */
function registerWhatsAppShareHandler() {
  ipcMain.handle('share-whatsapp', async (_, payload = {}) => {
    try {
      // Support either object arguments or positional args
      let invoiceId, invoiceNumber, customerPhone, message, pdfBase64, filename;
      if (typeof payload === 'object' && payload !== null) {
        invoiceId = payload.invoiceId || '';
        invoiceNumber = payload.invoiceNumber || String(invoiceId || 'bill');
        customerPhone = payload.customerPhone || payload.phone || '';
        message = payload.message || '';
        pdfBase64 = payload.pdfBase64 || null;
        filename = payload.filename || `Invoice-${invoiceNumber}.pdf`;
      } else {
        invoiceId = payload;
        invoiceNumber = String(invoiceId);
        customerPhone = arguments[2] || '';
        message = arguments[3] || '';
      }

      const cleanPhone = sanitizeWhatsAppPhone(customerPhone);

      // 1. Prepare temp directory
      const tmpDir = path.join(os.tmpdir(), 'vyapaarsetu_whatsapp_share');
      fs.mkdirSync(tmpDir, { recursive: true });

      // 2. Write PDF to temporary file
      const safeFilename = (filename || `Invoice-${invoiceNumber}.pdf`).replace(/[\\/:*?"<>|]/g, '_');
      const pdfPath = path.join(tmpDir, safeFilename);

      if (pdfBase64) {
        // Strip data URI prefix if present (e.g. data:application/pdf;base64,...)
        const cleanBase64 = pdfBase64.replace(/^data:application\/pdf;base64,/, '');
        const pdfBuffer = Buffer.from(cleanBase64, 'base64');
        fs.writeFileSync(pdfPath, pdfBuffer);
      } else if (!fs.existsSync(pdfPath)) {
        throw new Error('No PDF content provided for WhatsApp sharing');
      }

      // 3. Prepare URLs (whatsapp:// custom protocol and web fallback)
      const textMessage = encodeURIComponent(
        message || `Dear Customer, please find your invoice ${invoiceNumber} attached. Thank you!`
      );

      const waProtocolUrl = cleanPhone
        ? `whatsapp://send?phone=${cleanPhone}&text=${textMessage}`
        : `whatsapp://send?text=${textMessage}`;

      const waApiUrl = cleanPhone
        ? `https://api.whatsapp.com/send/?phone=${cleanPhone}&text=${textMessage}`
        : `https://api.whatsapp.com/send/?text=${textMessage}`;

      // 4. Generate self-contained PowerShell automation script
      const psScriptPath = path.join(tmpDir, `share_wa_${Date.now()}.ps1`);
      const safePdf = pdfPath.replace(/'/g, "''");
      const safeProto = waProtocolUrl.replace(/'/g, "''");
      const safeApi = waApiUrl.replace(/'/g, "''");
      const safeScriptPath = psScriptPath.replace(/'/g, "''");

      const psScriptContent = `
$ErrorActionPreference = 'SilentlyContinue'
$logFile = Join-Path $env:TEMP 'vyapaarsetu_whatsapp_share\\share_wa.log'
"$(Get-Date -Format 'yyyy-MM-dd HH:mm:ss') Starting WhatsApp share to ${cleanPhone}" | Out-File $logFile -Encoding utf8

# 1. Set native Windows clipboard with the PDF file (FileDropList format)
Set-Clipboard -Path '${safePdf}'
"Clipboard set: $((Get-Clipboard -Format FileDropList)[0].FullName)" | Out-File $logFile -Append

# 2. Declare Win32 API functions for window management
Add-Type @"
using System;
using System.Runtime.InteropServices;
public class Win32 {
    [DllImport("user32.dll", SetLastError = true)]
    public static extern bool SetForegroundWindow(IntPtr hWnd);
    [DllImport("user32.dll")]
    public static extern bool ShowWindow(IntPtr hWnd, int nCmdShow);
    [DllImport("user32.dll")]
    public static extern IntPtr GetForegroundWindow();
}
"@

# 3. Open WhatsApp chat with the customer
if ('${cleanPhone}') {
    try {
        Start-Process '${safeProto}'
        "Opened WhatsApp protocol: ${safeProto}" | Out-File $logFile -Append
    } catch {
        Start-Process '${safeApi}'
        "Opened WhatsApp API URL: ${safeApi}" | Out-File $logFile -Append
    }
} else {
    try {
        Start-Process '${safeProto}'
    } catch {
        Start-Process '${safeApi}'
    }
}

# 4. Poll for WhatsApp window and simulate Ctrl+V
$pasted = $false
for ($i = 0; $i -lt 35; $i++) {
    Start-Sleep -Milliseconds 300
    $waProc = Get-Process | Where-Object { $_.ProcessName -match 'WhatsApp' -and $_.MainWindowHandle -ne [IntPtr]::Zero } | Select-Object -First 1
    if ($waProc) {
        "Found WhatsApp: $($waProc.ProcessName) PID=$($waProc.Id) Handle=$($waProc.MainWindowHandle)" | Out-File $logFile -Append
        [Win32]::ShowWindow($waProc.MainWindowHandle, 9) | Out-Null # SW_RESTORE = 9
        [Win32]::SetForegroundWindow($waProc.MainWindowHandle) | Out-Null
        Start-Sleep -Milliseconds 900
        
        $wshell = New-Object -ComObject Wscript.Shell
        $wshell.SendKeys('^v')
        $pasted = $true
        "SendKeys ^v sent at iteration $i" | Out-File $logFile -Append
        break
    }
}

if (-not $pasted) {
    "WhatsApp process NOT found after 35 attempts" | Out-File $logFile -Append
}

Start-Sleep -Seconds 2
Remove-Item -Path '${safeScriptPath}' -ErrorAction SilentlyContinue
`;

      fs.writeFileSync(psScriptPath, psScriptContent, 'utf8');

      // 5. Execute PowerShell in background
      // CRITICAL: detached MUST be false so the process maintains access to the interactive desktop station
      const psProc = spawn('powershell.exe', [
        '-STA',                     // Single-Threaded Apartment (mandatory for clipboard)
        '-WindowStyle', 'Hidden',   // No flashing terminal window
        '-NoProfile',               // Faster startup
        '-ExecutionPolicy', 'Bypass',
        '-File', psScriptPath,
      ], {
        windowsHide: true,
        stdio: 'ignore',
        detached: false,
      });

      psProc.on('error', (err) => {
        console.error(`WhatsApp PowerShell spawn failed: ${err.message}`);
      });

      psProc.unref();

      return { success: true, pdfPath };
    } catch (err) {
      console.error(`WhatsApp share failed: ${err.message}`);
      return { success: false, error: err.message };
    }
  });
}

module.exports = {
  registerWhatsAppShareHandler,
  sanitizeWhatsAppPhone,
};
