/**
 * ReceiptPrint Component
 * Displays a clean invoice details page overlay using the reusable BillTemplate.
 * Provides controls to trigger browser-native printing, crisp PDF export,
 * and 1-click automated WhatsApp PDF sharing with Windows Clipboard CF_HDROP & SendKeys Ctrl+V paste.
 */

import { useState } from 'react';
import jsPDF from 'jspdf';
import html2canvas from 'html2canvas';
import { Capacitor } from '@capacitor/core';
import { useTranslation } from '../hooks/useTranslation';
import BillTemplate from './BillTemplate';
import {
  sanitizeWhatsAppPhone,
  generateBillWhatsAppMessage,
  shareWhatsAppDocument,
} from '../utils/whatsappShare';
import { downloadFile } from '../utils/fileDownloader';
import { SendIcon, FileIcon, PrintIcon, EditIcon } from './Icons';

export default function ReceiptPrint({ isOpen, onClose, bill, onEdit }) {
  const { t, language } = useTranslation();
  const [pdfLoading, setPdfLoading] = useState(false);
  const [loadingText, setLoadingText] = useState('');

  if (!isOpen || !bill) return null;

  const handlePrint = async () => {
    if (typeof window !== 'undefined' && window.AndroidNativePrint?.printReceipt) {
      window.AndroidNativePrint.printReceipt();
      return;
    }

    // In native Android APK WebView, window.print() or iframe.contentWindow.print()
    // are blocked/blank. Generate crisp PDF and invoke Android system print/share sheet.
    if (typeof Capacitor !== 'undefined' && Capacitor.isNativePlatform()) {
      setPdfLoading(true);
      setLoadingText('Preparing print...');
      try {
        const blob = await generatePdfBlob();
        const filename = `receipt-${bill.bill_number || bill.id || 'bill'}.pdf`;
        await downloadFile({
          data: blob,
          filename,
          mimeType: 'application/pdf',
          title: `Print Receipt ${bill.bill_number || ''}`,
        });
      } catch (err) {
        console.error('Mobile print failed:', err);
        alert('Print failed: ' + err.message);
      } finally {
        setPdfLoading(false);
        setLoadingText('');
      }
      return;
    }

    const printArea = document.getElementById('receipt-print-area');
    if (!printArea) {
      window.print();
      return;
    }

    // Isolate into iframe so print dialog is never blank due to modal / viewport clipping
    const iframe = document.createElement('iframe');
    iframe.style.position = 'fixed';
    iframe.style.right = '0';
    iframe.style.bottom = '0';
    iframe.style.width = '0';
    iframe.style.height = '0';
    iframe.style.border = '0';
    document.body.appendChild(iframe);

    const doc = iframe.contentWindow.document;
    doc.open();
    doc.write(`
      <!DOCTYPE html>
      <html>
        <head>
          <title>Receipt ${bill.bill_number || ''}</title>
          <style>
            @page { size: A4 portrait; margin: 8mm 10mm; }
            * { box-sizing: border-box; }
            body { font-family: "Noto Sans Devanagari", "Inter", sans-serif; margin: 0; padding: 12px; background: #fff; color: #000; }
            table { width: 100%; border-collapse: collapse; }
            @media print {
              body { -webkit-print-color-adjust: exact; print-color-adjust: exact; }
            }
          </style>
        </head>
        <body>
          ${printArea.innerHTML}
        </body>
      </html>
    `);
    doc.close();

    iframe.contentWindow.focus();
    setTimeout(() => {
      try {
        iframe.contentWindow.print();
      } catch (_) {
        window.print();
      }
      setTimeout(() => {
        try { document.body.removeChild(iframe); } catch (_) {}
      }, 3000);
    }, 300);
  };

  const generatePdfBlob = async () => {
    const printArea = document.getElementById('receipt-print-area');
    if (!printArea) throw new Error('Receipt print element not found');

    // Create a temporary off-screen container with standard A4 receipt width (750px)
    // to guarantee identical layout, typography proportions, and page fitting on both mobile and desktop screens.
    const offscreenContainer = document.createElement('div');
    offscreenContainer.style.position = 'fixed';
    offscreenContainer.style.top = '-9999px';
    offscreenContainer.style.left = '-9999px';
    offscreenContainer.style.width = '750px';
    offscreenContainer.style.background = '#ffffff';
    offscreenContainer.style.zIndex = '-9999';

    const clone = printArea.cloneNode(true);
    clone.style.width = '750px';
    clone.style.maxWidth = '750px';
    offscreenContainer.appendChild(clone);
    document.body.appendChild(offscreenContainer);

    let canvas;
    const candidateBreakPoints = [];

    try {
      // Allow browser to compute fonts and full off-screen layout
      await new Promise((resolve) => setTimeout(resolve, 60));

      canvas = await html2canvas(clone, {
        scale: 2,
        useCORS: true,
        logging: false,
        backgroundColor: '#ffffff',
        width: 750,
      });

      const cloneRect = clone.getBoundingClientRect();
      const scaleFactor = canvas.height / (cloneRect.height || clone.offsetHeight || 1);
      const breakElements = clone.querySelectorAll('tr, .bill-summary-wrap, .bill-footer-section');
      breakElements.forEach((el) => {
        const r = el.getBoundingClientRect();
        const bottomCanvasPx = Math.round((r.bottom - cloneRect.top) * scaleFactor);
        if (bottomCanvasPx > 0 && bottomCanvasPx < canvas.height) {
          candidateBreakPoints.push(bottomCanvasPx);
        }
      });
    } finally {
      try {
        document.body.removeChild(offscreenContainer);
      } catch (_) {}
    }

    const pdf = new jsPDF({
      orientation: 'p',
      unit: 'mm',
      format: 'a4',
      compress: true,
    });

    const pdfWidth = pdf.internal.pageSize.getWidth(); // 210mm
    const pdfHeight = pdf.internal.pageSize.getHeight(); // 297mm
    const marginX = 8; // 8mm left/right margin
    const marginY = 8; // 8mm top/bottom margin
    const usableWidthMm = pdfWidth - (marginX * 2); // 194mm
    const usableHeightMm = pdfHeight - (marginY * 2); // 281mm

    const pxPerMm = canvas.width / usableWidthMm;
    const maxPageHeightPx = Math.floor(usableHeightMm * pxPerMm);
    const naturalHeightMm = (canvas.height * usableWidthMm) / canvas.width;

    // 1. Natural Single Page Fit
    if (naturalHeightMm <= usableHeightMm) {
      const imgData = canvas.toDataURL('image/jpeg', 0.92);
      pdf.addImage(imgData, 'JPEG', marginX, marginY, usableWidthMm, naturalHeightMm, undefined, 'FAST');
      return pdf.output('blob');
    }

    // 2. Single-page auto-scaling: if content is slightly taller (up to 15% over), scale down slightly
    // to fit cleanly on one single A4 sheet instead of leaving an empty 2nd page with only a signature
    if (naturalHeightMm <= usableHeightMm * 1.15) {
      const imgData = canvas.toDataURL('image/jpeg', 0.92);
      const scale = usableHeightMm / naturalHeightMm;
      const scaledWidthMm = usableWidthMm * scale;
      const offsetX = marginX + (usableWidthMm - scaledWidthMm) / 2;
      pdf.addImage(imgData, 'JPEG', offsetX, marginY, scaledWidthMm, usableHeightMm, undefined, 'FAST');
      return pdf.output('blob');
    }

    // 3. Genuine Multi-page bill: cleanly split along row boundaries
    const sortedBreaks = Array.from(new Set(candidateBreakPoints)).sort((a, b) => a - b);

    let currentY = 0;
    let pageNum = 0;

    while (currentY < canvas.height) {
      if (pageNum > 0) {
        pdf.addPage();
      }

      const remainingHeight = canvas.height - currentY;
      let sliceHeight = Math.min(maxPageHeightPx, remainingHeight);

      if (currentY + sliceHeight < canvas.height) {
        const minCut = currentY + Math.floor(maxPageHeightPx * 0.70);
        const maxCut = currentY + maxPageHeightPx;
        const validCut = sortedBreaks
          .filter((b) => b >= minCut && b <= maxCut)
          .pop();

        if (validCut) {
          sliceHeight = validCut - currentY;
        }
      }

      const pageCanvas = document.createElement('canvas');
      pageCanvas.width = canvas.width;
      pageCanvas.height = sliceHeight;

      const ctx = pageCanvas.getContext('2d');
      ctx.fillStyle = '#ffffff';
      ctx.fillRect(0, 0, pageCanvas.width, pageCanvas.height);

      ctx.drawImage(
        canvas,
        0, currentY, canvas.width, sliceHeight,
        0, 0, canvas.width, sliceHeight
      );

      const pageImgData = pageCanvas.toDataURL('image/jpeg', 0.90);
      const sliceHeightMm = (sliceHeight * usableWidthMm) / canvas.width;

      pdf.addImage(pageImgData, 'JPEG', marginX, marginY, usableWidthMm, sliceHeightMm, undefined, 'FAST');

      currentY += sliceHeight;
      pageNum++;
    }

    return pdf.output('blob');
  };

  const handleDownloadPDF = async () => {
    setPdfLoading(true);
    setLoadingText(t('billing.downloading') || 'Downloading...');
    try {
      const blob = await generatePdfBlob();
      const filename = `bill-${bill.bill_number || bill.id || 'receipt'}.pdf`;
      await downloadFile({
        data: blob,
        filename,
        mimeType: 'application/pdf',
        title: `Bill ${bill.bill_number || bill.id || ''}`,
      });
    } catch (err) {
      console.error('Failed to generate PDF:', err);
      alert('Error exporting PDF: ' + err.message);
    } finally {
      setPdfLoading(false);
      setLoadingText('');
    }
  };

  const handleWhatsAppShare = async () => {
    const mobile = bill.customer_mobile;
    const formattedMobile = sanitizeWhatsAppPhone(mobile);

    if (!formattedMobile) {
      alert(t('billing.invalidMobile'));
      return;
    }

    setPdfLoading(true);
    setLoadingText('Preparing WhatsApp PDF...');
    try {
      const pdfBlob = await generatePdfBlob();
      const message = generateBillWhatsAppMessage(bill, language, t);
      const filename = `Invoice-${bill.bill_number || bill.id || 'bill'}.pdf`;

      await shareWhatsAppDocument({
        pdfBlob,
        filename,
        invoiceId: bill.id || bill.bill_number,
        invoiceNumber: String(bill.bill_number || bill.id || ''),
        phone: formattedMobile,
        message,
        onLoading: (msg) => setLoadingText(msg),
        onSuccess: (msg) => {
          console.log('WhatsApp share successful:', msg);
        },
        onError: (err) => {
          alert('Error sharing to WhatsApp: ' + err);
        },
      });
    } catch (err) {
      console.error('Failed to share PDF to WhatsApp:', err);
      alert('Error sharing to WhatsApp: ' + err.message);
    } finally {
      setPdfLoading(false);
      setLoadingText('');
    }
  };

  const isProcessing = pdfLoading;

  return (
    <>
      <div className="modal-backdrop" onClick={onClose} />
      <div
        className="modal modal-lg"
        id="receipt-modal"
        style={{
          width: '100%',
          maxWidth: '850px',
          padding: '24px',
          display: 'flex',
          flexDirection: 'column',
          maxHeight: '95vh',
        }}
      >
        {/* Modal Scrollable Container */}
        <div id="receipt-print-modal-scroll" style={{ overflowY: 'auto', flex: 1, paddingRight: '4px' }}>
          {/* Printable Invoice Container */}
          <div id="receipt-print-area">
            <BillTemplate bill={bill} />
          </div>
        </div>

        {/* Modal Action Controls (Hidden when browser print triggers) */}
        <div
          className="modal-actions"
          style={{
            marginTop: 20,
            borderTop: '1px solid var(--color-border)',
            paddingTop: 16,
            display: 'flex',
            justifyContent: 'flex-end',
            gap: '10px',
            flexWrap: 'wrap',
          }}
        >
          <button
            type="button"
            className="btn btn-ghost"
            onClick={onClose}
            disabled={isProcessing}
            style={{
              background: '#f1f5f9',
              color: '#334155',
              padding: '9px 16px',
            }}
          >
            {t('common.close')}
          </button>

          {/* WhatsApp sharing */}
          <button
            type="button"
            id="modal-share-whatsapp-btn"
            title={t('billing.shareWhatsApp') || 'WhatsApp वर पाठवा'}
            className="btn"
            onClick={handleWhatsAppShare}
            disabled={isProcessing}
            style={{
              background: '#25D366',
              color: '#fff',
              border: 'none',
              display: 'flex',
              alignItems: 'center',
              gap: '6px',
              padding: '9px 16px',
            }}
          >
            {isProcessing && loadingText.includes('WhatsApp') ? (
              <>
                <span className="spinner" style={{ width: 14, height: 14, borderColor: '#fff', borderTopColor: 'transparent' }} />
                {loadingText}
              </>
            ) : (
              <>
                <SendIcon /> {t('billing.shareWhatsApp') || 'WhatsApp'}
              </>
            )}
          </button>

          {/* PDF export */}
          <button
            type="button"
            id="modal-download-pdf-btn"
            title={t('billing.downloadPDF') || 'PDF डाऊनलोड करा'}
            className="btn"
            onClick={handleDownloadPDF}
            disabled={isProcessing}
            style={{
              background: '#ef4444',
              color: '#fff',
              border: 'none',
              display: 'flex',
              alignItems: 'center',
              gap: '6px',
              padding: '9px 16px',
            }}
          >
            {isProcessing && !loadingText.includes('WhatsApp') ? (
              <>
                <span className="spinner" style={{ width: 14, height: 14, borderColor: '#fff', borderTopColor: 'transparent' }} />
                {loadingText || t('billing.downloading')}
              </>
            ) : (
              <>
                <FileIcon /> {t('billing.downloadPDF') || 'PDF'}
              </>
            )}
          </button>

          {/* Browser printing */}
          <button
            type="button"
            id="modal-print-btn"
            title={t('billing.print') || 'प्रिंट करा'}
            className="btn btn-primary"
            onClick={handlePrint}
            disabled={isProcessing}
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: '6px',
              padding: '9px 20px',
            }}
          >
            <PrintIcon /> {t('billing.print')}
          </button>

          {/* Edit Bill button */}
          {onEdit && (
            <button
              type="button"
              id="modal-edit-bill-btn"
              title={t('common.edit') || 'बिल बदला'}
              className="btn btn-outline"
              onClick={() => {
                onClose();
                onEdit(bill);
              }}
              disabled={isProcessing}
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: '6px',
                padding: '9px 16px',
                borderColor: '#0284c7',
                color: '#0284c7',
                fontWeight: 600,
              }}
            >
              <EditIcon /> {t('common.edit') || 'बदला'}
            </button>
          )}
        </div>
      </div>
    </>
  );
}
