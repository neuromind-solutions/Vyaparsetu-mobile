/**
 * WhatsApp Share Utility
 * Handles mobile number formatting, multilingual template formatting,
 * wa.me link generation, and multi-tier PDF auto-sharing (Electron, Mobile Web Share, Desktop Web).
 */

import {
  grossItems,
  grossSubtotal,
  groupItemsByDate,
  formatBillDate,
  formatBillPeriod,
} from './billDisplay';
import { Capacitor } from '@capacitor/core';
import { Share } from '@capacitor/share';
import { Filesystem, Directory } from '@capacitor/filesystem';

/**
 * Strips non-digits and ensures proper country code format (91 prefix for 10-digit Indian numbers)
 * @param {string|null|undefined} phone
 * @returns {string} Clean digits with country code or empty string
 */
export function sanitizeWhatsAppPhone(phone) {
  if (!phone) return '';
  let digits = String(phone).replace(/\D/g, '');
  if (digits.startsWith('0')) digits = digits.replace(/^0+/, '');
  if (digits.length === 10) return `91${digits}`;
  return digits.length >= 10 ? digits : '';
}

/**
 * Format mobile number to India standard (91 prefix)
 * @param {string} mobile
 * @returns {string|null} Formatted mobile or null if invalid
 */
export function formatIndianMobileNumber(mobile) {
  const clean = sanitizeWhatsAppPhone(mobile);
  return clean || null;
}

/**
 * Convert Blob or File to Base64 string
 * @param {Blob|File} blob
 * @returns {Promise<string>}
 */
export function blobToBase64(blob) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onloadend = () => {
      const dataUrl = reader.result;
      if (typeof dataUrl === 'string') {
        const base64 = dataUrl.split(',')[1] || '';
        resolve(base64);
      } else {
        reject(new Error('Failed to read blob as Base64'));
      }
    };
    reader.onerror = reject;
    reader.readAsDataURL(blob);
  });
}

/**
 * Generate invoice message text in English or Marathi
 *
 * Commission is folded into the item rates and never listed — the same transform the
 * printed bill applies, so a customer who compares the two sees the same figures.
 *
 * @param {object} bill
 * @param {string} language ('en' or 'mr')
 * @param {function} t translation function
 * @returns {string} Fully formatted text
 */
export function generateBillWhatsAppMessage(bill, language, t) {
  if (!bill) return '';
  const customerName = bill.customer_name ? `नमस्कार ${bill.customer_name},` : 'नमस्कार,';
  const billNumber = bill.bill_number ? `बिल क्र: ${bill.bill_number}` : '';
  const billDate = bill.date ? `दिनांक: ${bill.date}` : '';

  // Gross items so each item rate & total matches the printed receipt exactly
  const items = grossItems(bill.items, bill);
  let itemLines = '';
  if (items.length > 0) {
    itemLines = items
      .map((it) => {
        const qty = `${it.quantity} ${it.vegetable_unit || 'किलो'}`;
        return `• ${it.vegetable_name}: ${qty} @ ₹${Number(it.rate).toFixed(2)} = ₹${Number(it.total).toFixed(2)}`;
      })
      .join('\n');
  }

  const finalAmt = Number(bill.final_amount || 0).toFixed(2);
  let rawPrev = Number(bill.previous_balance || 0);
  const custBal = Number(bill.customer_credit_balance || 0);
  if (rawPrev > 0 && custBal > 0 && Math.abs(rawPrev - custBal * 100) < 1) {
    rawPrev = rawPrev / 100;
  }
  if (custBal > 0 && Math.abs(rawPrev - custBal) < 0.05 && Number(finalAmt) > 0) {
    rawPrev = Math.max(0, custBal - Number(finalAmt));
  }
  const prevBal = rawPrev.toFixed(2);
  const paidAmt = Number(bill.paid_amount || bill.payments_received || 0).toFixed(2);
  const totalPayable = (Number(finalAmt) + Number(prevBal)).toFixed(2);
  const remaining = Math.max(0, Number(totalPayable) - Number(paidAmt)).toFixed(2);

  let summaryLines = `आजचे बिल: ₹${finalAmt}`;
  if (Number(prevBal) > 0) {
    summaryLines += `\nमागील बाकी: ₹${prevBal}\nएकूण देय: ₹${totalPayable}`;
  }
  if (Number(paidAmt) > 0) {
    summaryLines += `\nजमा रक्कम: ₹${paidAmt}\nशिल्लक बाकी: ₹${remaining}`;
  } else if (Number(prevBal) > 0) {
    summaryLines += `\nशिल्लक बाकी: ₹${remaining}`;
  }

  return `${customerName}

*बळीराजा व्हेजिटेबल*
${billNumber}${billDate ? ' | ' + billDate : ''}
--------------------------------
${itemLines || 'माल खरेदी तपशील'}
--------------------------------
${summaryLines}
--------------------------------
आपल्या बिलाची PDF प्रत सोबत जोडली आहे.
धन्यवाद!`;
}

/**
 * Generate URL to share via wa.me browser link
 * @param {string} mobile 
 * @param {string} message 
 * @returns {string|null} Encoded URL or null if mobile is invalid
 */
export function createWhatsAppShareUrl(mobile, message) {
  const formattedMobile = formatIndianMobileNumber(mobile);
  if (!formattedMobile) return null;
  const encodedText = encodeURIComponent(message);
  return `https://wa.me/${formattedMobile}?text=${encodedText}`;
}

/**
 * Universal WhatsApp share function with multi-tier fallbacks as defined in WHATSAPP_PDF_SHARING_GUIDE.md:
 * 1. Electron Desktop: Automated Windows Clipboard CF_HDROP insertion + WhatsApp Auto-Focus + Ctrl+V Paste
 * 2. Mobile Browser: Web Share API Level 2 with attached PDF file
 * 3. Desktop Web Browser: PDF download + WhatsApp Web Chat link
 *
 * @param {Object} opts
 * @param {Blob} [opts.pdfBlob] PDF Blob instance
 * @param {string} [opts.pdfBase64] PDF base64 string
 * @param {string} [opts.filename] File name (e.g. Invoice-101.pdf)
 * @param {string|number} [opts.invoiceId]
 * @param {string} [opts.invoiceNumber]
 * @param {string} [opts.phone] Recipient phone number
 * @param {string} [opts.message] Accompanying text message
 * @param {function} [opts.onLoading] Callback when loading starts
 * @param {function} [opts.onSuccess] Callback when completed successfully
 * @param {function} [opts.onError] Callback when an error occurs
 */
export async function shareWhatsAppDocument(opts = {}) {
  const {
    pdfBlob,
    filename = 'Invoice.pdf',
    invoiceId = '',
    invoiceNumber = '',
    phone,
    message = '',
    onLoading,
    onSuccess,
    onError,
  } = opts;

  let { pdfBase64 } = opts;
  const cleanPhone = sanitizeWhatsAppPhone(phone);

  // ═══════════════════════════════════════════════════════════════════════════
  // 1. ELECTRON DESKTOP APP PATH (Auto-Attach with Windows Clipboard & Ctrl+V)
  // ═══════════════════════════════════════════════════════════════════════════
  if (typeof window !== 'undefined' && window.electronAPI?.shareWhatsApp) {
    onLoading?.('Preparing WhatsApp share...');
    try {
      if (!pdfBase64 && pdfBlob) {
        pdfBase64 = await blobToBase64(pdfBlob);
      }

      const result = await window.electronAPI.shareWhatsApp({
        invoiceId,
        invoiceNumber,
        customerPhone: cleanPhone,
        message,
        pdfBase64,
        filename,
      });

      if (result && result.success) {
        onSuccess?.('PDF attached! WhatsApp chat opened.');
        return;
      }
      throw new Error(result?.error || 'Electron WhatsApp share failed');
    } catch (e) {
      console.warn('Electron share failed, falling back to browser flow:', e);
    }
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // 1b. CAPACITOR NATIVE ANDROID SHARE (System Share Sheet with Attached PDF)
  // ═══════════════════════════════════════════════════════════════════════════
  if (typeof Capacitor !== 'undefined' && Capacitor.isNativePlatform()) {
    try {
      onLoading?.('Attaching PDF for WhatsApp...');
      let shareFiles = [];
      if (pdfBlob || pdfBase64) {
        if (!pdfBase64 && pdfBlob) {
          pdfBase64 = await blobToBase64(pdfBlob);
        }
        if (pdfBase64) {
          const cleanFilename = filename.endsWith('.pdf') ? filename : `${filename}.pdf`;
          const writeRes = await Filesystem.writeFile({
            path: cleanFilename,
            data: pdfBase64,
            directory: Directory.Cache,
          });
          if (writeRes?.uri) {
            shareFiles.push(writeRes.uri);
          }
        }
      }

      await Share.share({
        title: filename,
        text: message,
        files: shareFiles.length > 0 ? shareFiles : undefined,
        dialogTitle: 'Share Invoice PDF to WhatsApp',
      });
      onSuccess?.('PDF ready & shared successfully!');
      return;
    } catch (e) {
      if (e?.name === 'AbortError') return;
      console.warn('Capacitor native share failed, falling back to Web Share:', e);
    }
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // 2. MOBILE WEB BROWSER PATH (Web Share API with real PDF file)
  // ═══════════════════════════════════════════════════════════════════════════
  if (typeof navigator !== 'undefined' && typeof navigator.share === 'function' && pdfBlob) {
    try {
      onLoading?.('Preparing document for sharing...');
      const file = new File([pdfBlob], filename, { type: 'application/pdf' });

      if (typeof navigator.canShare === 'function' && navigator.canShare({ files: [file] })) {
        await navigator.share({
          title: filename,
          text: message,
          files: [file],
        });
        onSuccess?.('Shared successfully!');
        return;
      }
    } catch (e) {
      if (e?.name === 'AbortError') return; // User cancelled share sheet
      console.warn('Mobile Web Share failed, falling back to desktop browser flow:', e);
    }
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // 3. DESKTOP WEB BROWSER PATH (Download PDF + Open WhatsApp Web)
  // ═══════════════════════════════════════════════════════════════════════════
  try {
    if (pdfBlob) {
      onLoading?.('Downloading PDF...');
      const blobUrl = URL.createObjectURL(pdfBlob);
      const a = document.createElement('a');
      a.href = blobUrl;
      a.download = filename;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      setTimeout(() => URL.revokeObjectURL(blobUrl), 15000);
    }

    const encoded = encodeURIComponent(message);
    const waUrl = cleanPhone
      ? `https://api.whatsapp.com/send/?phone=${cleanPhone}&text=${encoded}`
      : `https://api.whatsapp.com/send/?text=${encoded}`;

    window.open(waUrl, '_blank', 'noopener,noreferrer');
    onSuccess?.('Invoice PDF downloaded! Attach it in WhatsApp Web.');
  } catch (err) {
    onError?.(`Failed to share: ${err.message}`);
  }
}
