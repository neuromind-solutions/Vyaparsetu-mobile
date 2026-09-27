/**
 * ReportsPage — Vyapar Reports-style
 * Pill tabs for report type + KPI icon cards per type + clean data table
 * Includes All-in-One Master Business Record with multi-tab Excel export & dossier layout
 */

import { useReports } from '../hooks/useReports';
import { useTranslation } from '../hooks/useTranslation';
import React, { useState, Fragment } from 'react';
import { jsPDF } from 'jspdf';
import html2canvas from 'html2canvas';
import { Capacitor } from '@capacitor/core';
import { downloadFile } from '../utils/fileDownloader';
import { reportsApi } from '../services/apiService';
import { exportAllInOneReportToExcel, exportDailyReportToExcel } from '../utils/excelUtils';
import {
  PhoneIcon,
  AlertIcon,
  ChartIcon,
  ReceiptIcon,
  UsersIcon,
  LeafIcon,
  CheckIcon,
  SaveIcon,
  FolderIcon,
  PrintIcon,
  BuildingIcon,
} from '../components/Icons';
import { formatDDMMYYYY, formatStoredTime } from '../utils/dates';

function getDayName(dateStr, isMr) {
  if (!dateStr) return '';
  const d = new Date(dateStr);
  if (isNaN(d.getTime())) return '';
  const daysMr = ['रविवार', 'सोमवार', 'मंगळवार', 'बुधवार', 'गुरुवार', 'शुक्रवार', 'शनिवार'];
  const daysEn = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
  return isMr ? daysMr[d.getDay()] : daysEn[d.getDay()];
}

function getDaysAgoLabel(dateStr, baseDateStr, isMr) {
  if (!dateStr) return '';
  const txDate = new Date(dateStr);
  if (isNaN(txDate.getTime())) return '';
  const baseDate = baseDateStr ? new Date(baseDateStr) : new Date();
  const txDay = new Date(txDate.getFullYear(), txDate.getMonth(), txDate.getDate());
  const baseDay = new Date(baseDate.getFullYear(), baseDate.getMonth(), baseDate.getDate());
  const diffDays = Math.round((baseDay - txDay) / (1000 * 60 * 60 * 24));

  if (diffDays <= 0) {
    return isMr ? 'आज' : 'Today';
  } else if (diffDays === 1) {
    return isMr ? 'काल' : 'Yesterday';
  } else {
    return isMr ? `${diffDays} दिवसांपूर्वी` : `${diffDays} days ago`;
  }
}

export default function ReportsPage() {
  const { t, language } = useTranslation();
  const {
    reportType,
    setReportType,
    date,
    setDate,
    startDate,
    setStartDate,
    endDate,
    setEndDate,
    data,
    loading,
    error,
    fetchReport,
  } = useReports();

  const [isGeneratingPdf, setIsGeneratingPdf] = useState(false);
  const [pdfProgressText, setPdfProgressText] = useState('');
  const [isExportingExcel, setIsExportingExcel] = useState(false);

  const handleDownloadMasterExcel = async () => {
    try {
      setIsExportingExcel(true);
      if (reportType === 'daily' || reportType === 'range') {
        const targetDate = reportType === 'daily' ? date : `${startDate}_to_${endDate}`;
        exportDailyReportToExcel(data, targetDate);
        return;
      }

      let reportDataToExport = data;
      if (reportType !== 'all_in_one' || !data || !data.summary) {
        const res = await reportsApi.getAllInOne(startDate, endDate);
        if (res && res.success) {
          reportDataToExport = res.data;
        } else {
          throw new Error(res?.error || 'Failed to generate all-in-one report data');
        }
      }
      exportAllInOneReportToExcel(reportDataToExport);
    } catch (err) {
      console.error('Failed to export Excel report:', err);
      alert(err.message || 'Failed to export Excel file');
    } finally {
      setIsExportingExcel(false);
    }
  };

  const handleDownloadPDF = async () => {
    const reportElement = document.getElementById('report-content-area');
    if (!reportElement) return;

    try {
      setIsGeneratingPdf(true);
      setPdfProgressText('Preparing...');
      document.body.classList.add('pdf-mode');

      // Allow DOM to update
      await new Promise((resolve) => setTimeout(resolve, 60));

      setPdfProgressText('Rendering table...');
      const canvas = await html2canvas(reportElement, {
        scale: 1.25, // Optimized scale: fast rasterization while keeping crisp readable text on A4
        useCORS: true,
        logging: false,
        backgroundColor: '#ffffff',
        removeContainer: true,
        imageTimeout: 0,
      });

      const pdf = new jsPDF({
        orientation: 'p',
        unit: 'mm',
        format: 'a4',
        compress: true,
      });
      const pdfWidth = pdf.internal.pageSize.getWidth();
      const pageHeight = pdf.internal.pageSize.getHeight();

      // Collect clean break boundaries from table rows and cards to prevent cutting names/rows in half
      const elRect = reportElement.getBoundingClientRect();
      const scaleFactor = canvas.height / (elRect.height || reportElement.offsetHeight || 1);
      const candidateBreakPoints = [];

      const breakElements = reportElement.querySelectorAll('tr, .report-customer-card, .card, .kpi-grid, .print-header');
      breakElements.forEach((el) => {
        const r = el.getBoundingClientRect();
        const bottomCanvasPx = Math.round((r.bottom - elRect.top) * scaleFactor);
        if (bottomCanvasPx > 0 && bottomCanvasPx < canvas.height) {
          candidateBreakPoints.push(bottomCanvasPx);
        }
      });

      const sortedBreaks = Array.from(new Set(candidateBreakPoints)).sort((a, b) => a - b);

      const topOffsetMm = 4;
      const bottomOffsetMm = 6;
      const usableHeightMm = pageHeight - (topOffsetMm + bottomOffsetMm);
      const pxPerMm = canvas.width / pdfWidth;
      const maxPageHeightPx = Math.floor(usableHeightMm * pxPerMm);

      let currentY = 0;
      let pageNum = 0;

      while (currentY < canvas.height) {
        setPdfProgressText(`Page ${pageNum + 1}...`);
        await new Promise((resolve) => setTimeout(resolve, 0)); // yield to UI thread so progress updates smoothly

        if (pageNum > 0) {
          pdf.addPage();
        }

        const remainingHeight = canvas.height - currentY;
        let sliceHeight = Math.min(maxPageHeightPx, remainingHeight);

        // If more content remains after this page, find the best row/element break
        if (currentY + sliceHeight < canvas.height) {
          const minCut = currentY + Math.floor(maxPageHeightPx * 0.70);
          const maxCut = currentY + maxPageHeightPx;

          let validCut = sortedBreaks
            .filter((b) => b >= minCut && b <= maxCut)
            .pop(); // Highest row bottom that fits on this page

          if (!validCut) {
            validCut = sortedBreaks
              .filter((b) => b > currentY && b <= maxCut)
              .pop();
          }

          if (validCut) {
            sliceHeight = validCut - currentY;
          }
        }

        sliceHeight = Math.max(1, sliceHeight);

        // Render only the slice for this page to avoid duplicating entire canvas
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

        // JPEG at 0.85 quality keeps each page ~80-150KB instead of multi-megabyte uncompressed PNG
        const pageImgData = pageCanvas.toDataURL('image/jpeg', 0.85);
        const slicePdfHeight = (sliceHeight * pdfWidth) / canvas.width;
        const currentTopMm = pageNum === 0 ? 0 : topOffsetMm;

        pdf.addImage(pageImgData, 'JPEG', 0, currentTopMm, pdfWidth, slicePdfHeight, undefined, 'FAST');

        currentY += sliceHeight;
        pageNum++;
      }

      setPdfProgressText('Saving...');
      const filename = `VyapaarSetu_Master_Report_${reportType}_${new Date().toISOString().slice(0, 10)}.pdf`;
      if (typeof Capacitor !== 'undefined' && Capacitor.isNativePlatform()) {
        const pdfBase64 = pdf.output('datauristring').split(',')[1];
        await downloadFile({
          data: pdfBase64,
          filename,
          mimeType: 'application/pdf',
          title: `Report ${reportType}`,
        });
      } else {
        pdf.save(filename);
      }
    } catch (err) {
      console.error('Failed to generate PDF', err);
    } finally {
      document.body.classList.remove('pdf-mode');
      setIsGeneratingPdf(false);
      setPdfProgressText('');
    }
  };

  /**
   * Print the report through the browser's own print dialog.
   */
  const handlePrint = () => {
    if (typeof Capacitor !== 'undefined' && Capacitor.isNativePlatform()) {
      handleDownloadPDF();
      return;
    }

    document.body.classList.add('printing-report');

    let cleaned = false;
    const cleanup = () => {
      if (cleaned) return;
      cleaned = true;
      document.body.classList.remove('printing-report');
      window.removeEventListener('afterprint', cleanup);
      clearTimeout(backstop);
    };
    const backstop = setTimeout(cleanup, 60000);
    window.addEventListener('afterprint', cleanup);

    if (typeof window !== 'undefined' && window.AndroidNativePrint?.printReceipt) {
      window.AndroidNativePrint.printReceipt();
    } else {
      window.print();
    }
  };

  const REPORT_TABS = [
    { key: 'all_in_one', label: t('reports.typeAllInOne') || '📋 All-in-One Master Report' },
    { key: 'daily',      label: t('reports.typeDaily')      },
    { key: 'range',      label: t('reports.typeRange')      },
    { key: 'customers',  label: t('reports.typeCustomers')  },
    { key: 'vegetables', label: t('reports.typeVegetables') },
    { key: 'credit',     label: t('reports.typeCredit')     },
    { key: 'commission', label: t('reports.typeCommission') },
  ];

  // ─── KPI Cards per report type ──────────────────────────────────────────────
  const renderKpiCards = () => {
    if (!data) return null;
    switch (reportType) {
      case 'all_in_one': {
        const sum = data.summary || {};
        return (
          <div className="kpi-grid no-print" style={{ gridTemplateColumns: 'repeat(auto-fit, minmax(160px, 1fr))', gap: 14, marginBottom: 24 }}>
            <div className="kpi-card">
              <div className="kpi-icon-box kpi-icon-blue"><ReceiptIcon style={{ width: '18px', height: '18px' }} /></div>
              <div className="kpi-content">
                <div className="kpi-value">₹{Number(sum.total_sales || 0).toLocaleString('en-IN', { maximumFractionDigits: 0 })}</div>
                <div className="kpi-label">Total Net Sales</div>
              </div>
            </div>
            <div className="kpi-card">
              <div className="kpi-icon-box kpi-icon-green"><CheckIcon style={{ width: '18px', height: '18px' }} /></div>
              <div className="kpi-content">
                <div className="kpi-value">₹{Number(sum.total_paid || 0).toLocaleString('en-IN', { maximumFractionDigits: 0 })}</div>
                <div className="kpi-label">Total Collected</div>
              </div>
            </div>
            <div className="kpi-card">
              <div className="kpi-icon-box kpi-icon-red"><AlertIcon style={{ width: '18px', height: '18px' }} /></div>
              <div className="kpi-content">
                <div className="kpi-value">₹{Number(sum.total_credit_outstanding || 0).toLocaleString('en-IN', { maximumFractionDigits: 0 })}</div>
                <div className="kpi-label">Outstanding Udhar</div>
              </div>
            </div>
            <div className="kpi-card">
              <div className="kpi-icon-box kpi-icon-purple"><SaveIcon style={{ width: '18px', height: '18px' }} /></div>
              <div className="kpi-content">
                <div className="kpi-value">₹{Number(sum.total_commission || 0).toLocaleString('en-IN', { maximumFractionDigits: 0 })}</div>
                <div className="kpi-label">Commission Earned</div>
              </div>
            </div>
            <div className="kpi-card">
              <div className="kpi-icon-box kpi-icon-teal"><ChartIcon style={{ width: '18px', height: '18px' }} /></div>
              <div className="kpi-content">
                <div className="kpi-value">{sum.total_bills || 0}</div>
                <div className="kpi-label">Invoices Count</div>
              </div>
            </div>
            <div className="kpi-card">
              <div className="kpi-icon-box kpi-icon-orange"><UsersIcon style={{ width: '18px', height: '18px' }} /></div>
              <div className="kpi-content">
                <div className="kpi-value">{sum.total_customers_count || 0}</div>
                <div className="kpi-label">Active Customers</div>
              </div>
            </div>
            <div className="kpi-card">
              <div className="kpi-icon-box kpi-icon-green"><LeafIcon style={{ width: '18px', height: '18px' }} /></div>
              <div className="kpi-content">
                <div className="kpi-value">{Number(sum.total_vegetables_volume || 0).toFixed(1)}</div>
                <div className="kpi-label">Total Volume Sold</div>
              </div>
            </div>
          </div>
        );
      }
      case 'daily':
      case 'range': {
        const sum = data.summary || {};
        const custCount = data.customers?.length || (data.bills ? new Set(data.bills.map((b) => b.customer_id)).size : 0);
        return (
          <div className="kpi-grid no-print" style={{ gridTemplateColumns: 'repeat(auto-fit, minmax(150px, 1fr))', marginBottom: 20 }}>
            <div className="kpi-card">
              <div className="kpi-icon-box kpi-icon-blue"><ReceiptIcon style={{ width: '18px', height: '18px' }} /></div>
              <div className="kpi-content">
                <div className="kpi-value">₹{Number(sum.total_sales || 0).toLocaleString('en-IN', { maximumFractionDigits: 0 })}</div>
                <div className="kpi-label">{t('reports.totalSales') || 'एकूण विक्री (Turnover)'}</div>
              </div>
            </div>
            <div className="kpi-card">
              <div className="kpi-icon-box kpi-icon-green"><CheckIcon style={{ width: '18px', height: '18px' }} /></div>
              <div className="kpi-content">
                <div className="kpi-value">₹{Number(sum.total_paid || 0).toLocaleString('en-IN', { maximumFractionDigits: 0 })}</div>
                <div className="kpi-label">{t('reports.paidAmount') || 'एकूण जमा (Collected)'}</div>
              </div>
            </div>
            <div className="kpi-card">
              <div className="kpi-icon-box kpi-icon-red"><ChartIcon style={{ width: '18px', height: '18px' }} /></div>
              <div className="kpi-content">
                <div className="kpi-value">₹{Number(sum.total_outstanding || sum.total_remaining || 0).toLocaleString('en-IN', { maximumFractionDigits: 0 })}</div>
                <div className="kpi-label">{t('credit.totalOutstanding') || 'चालू उधारी (Market Udhar)'}</div>
              </div>
            </div>
            <div className="kpi-card">
              <div className="kpi-icon-box kpi-icon-purple"><SaveIcon style={{ width: '18px', height: '18px' }} /></div>
              <div className="kpi-content">
                <div className="kpi-value">₹{Number(sum.total_commission || 0).toLocaleString('en-IN', { maximumFractionDigits: 0 })}</div>
                <div className="kpi-label">{t('reports.commission') || 'कमिशन (Commission)'}</div>
              </div>
            </div>
            <div className="kpi-card">
              <div className="kpi-icon-box kpi-icon-teal"><UsersIcon style={{ width: '18px', height: '18px' }} /></div>
              <div className="kpi-content">
                <div className="kpi-value">{custCount}</div>
                <div className="kpi-label">{t('reports.activeCustomers') || 'ग्राहक (Customers)'}</div>
              </div>
            </div>
          </div>
        );
      }
      case 'customers': {
        if (!Array.isArray(data)) return null;
        const totalPurch = data.reduce((s, c) => s + Number(c.total_purchase || 0), 0);
        const totalBills = data.reduce((s, c) => s + Number(c.total_bills || 0), 0);
        const totalDues  = data.reduce((s, c) => s + Number(c.total_pending_credit || 0), 0);
        return (
          <div className="kpi-grid no-print" style={{ gridTemplateColumns: 'repeat(auto-fit, minmax(160px, 1fr))', marginBottom: 20 }}>
            <div className="kpi-card">
              <div className="kpi-icon-box kpi-icon-blue"><UsersIcon style={{ width: '18px', height: '18px' }} /></div>
              <div className="kpi-content">
                <div className="kpi-value">{data.length}</div>
                <div className="kpi-label">Total Customers</div>
              </div>
            </div>
            <div className="kpi-card">
              <div className="kpi-icon-box kpi-icon-green"><ReceiptIcon style={{ width: '18px', height: '18px' }} /></div>
              <div className="kpi-content">
                <div className="kpi-value">₹{totalPurch.toLocaleString('en-IN', { maximumFractionDigits: 0 })}</div>
                <div className="kpi-label">Total Purchases</div>
              </div>
            </div>
            <div className="kpi-card">
              <div className="kpi-icon-box kpi-icon-teal"><ChartIcon style={{ width: '18px', height: '18px' }} /></div>
              <div className="kpi-content">
                <div className="kpi-value">{totalBills}</div>
                <div className="kpi-label">Bills Generated</div>
              </div>
            </div>
            <div className="kpi-card">
              <div className="kpi-icon-box kpi-icon-red"><AlertIcon style={{ width: '18px', height: '18px' }} /></div>
              <div className="kpi-content">
                <div className="kpi-value">₹{totalDues.toLocaleString('en-IN', { maximumFractionDigits: 0 })}</div>
                <div className="kpi-label">Outstanding Dues</div>
              </div>
            </div>
          </div>
        );
      }
      case 'vegetables': {
        if (!Array.isArray(data)) return null;
        const totalVol = data.reduce((s, v) => s + Number(v.total_quantity || 0), 0);
        const totalVal = data.reduce((s, v) => s + Number(v.total_sales || 0), 0);
        return (
          <div className="kpi-grid no-print" style={{ gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))', marginBottom: 20 }}>
            <div className="kpi-card">
              <div className="kpi-icon-box kpi-icon-green"><LeafIcon style={{ width: '18px', height: '18px' }} /></div>
              <div className="kpi-content">
                <div className="kpi-value">₹{totalVal.toLocaleString('en-IN', { maximumFractionDigits: 0 })}</div>
                <div className="kpi-label">Vegetable Revenue</div>
              </div>
            </div>
            <div className="kpi-card">
              <div className="kpi-icon-box kpi-icon-teal"><ChartIcon style={{ width: '18px', height: '18px' }} /></div>
              <div className="kpi-content">
                <div className="kpi-value">{totalVol.toFixed(1)}</div>
                <div className="kpi-label">Total Volume Sold</div>
              </div>
            </div>
          </div>
        );
      }
      case 'credit': {
        const sum = data.summary || {};
        return (
          <div className="kpi-grid no-print" style={{ gridTemplateColumns: 'repeat(auto-fit, minmax(160px, 1fr))', marginBottom: 20 }}>
            <div className="kpi-card">
              <div className="kpi-icon-box kpi-icon-orange"><ReceiptIcon style={{ width: '18px', height: '18px' }} /></div>
              <div className="kpi-content">
                <div className="kpi-value">₹{Number(sum.total_outstanding || 0).toLocaleString('en-IN', { maximumFractionDigits: 0 })}</div>
                <div className="kpi-label">{t('credit.totalOutstanding')}</div>
              </div>
            </div>
            <div className="kpi-card">
              <div className="kpi-icon-box kpi-icon-red"><ChartIcon style={{ width: '18px', height: '18px' }} /></div>
              <div className="kpi-content">
                <div className="kpi-value">₹{Number(sum.credit_added || 0).toLocaleString('en-IN', { maximumFractionDigits: 0 })}</div>
                <div className="kpi-label">{t('credit.todayAdded')}</div>
              </div>
            </div>
            <div className="kpi-card">
              <div className="kpi-icon-box kpi-icon-green"><CheckIcon style={{ width: '18px', height: '18px' }} /></div>
              <div className="kpi-content">
                <div className="kpi-value">₹{Number(sum.credit_recovered || 0).toLocaleString('en-IN', { maximumFractionDigits: 0 })}</div>
                <div className="kpi-label">{t('credit.todayRecovered')}</div>
              </div>
            </div>
          </div>
        );
      }
      case 'commission': {
        const totalComm = Number(data.total_commission || 0);
        const billCount = data.billWise?.length || 0;
        return (
          <div className="kpi-grid no-print" style={{ gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))', marginBottom: 20 }}>
            <div className="kpi-card">
              <div className="kpi-icon-box kpi-icon-purple"><SaveIcon style={{ width: '18px', height: '18px' }} /></div>
              <div className="kpi-content">
                <div className="kpi-value">₹{totalComm.toLocaleString('en-IN', { maximumFractionDigits: 0 })}</div>
                <div className="kpi-label">{t('reports.totalCommission')}</div>
              </div>
            </div>
            <div className="kpi-card">
              <div className="kpi-icon-box kpi-icon-blue"><ReceiptIcon style={{ width: '18px', height: '18px' }} /></div>
              <div className="kpi-content">
                <div className="kpi-value">{billCount}</div>
                <div className="kpi-label">Commission Invoices</div>
              </div>
            </div>
          </div>
        );
      }
      default:
        return null;
    }
  };

  // ─── Table ──────────────────────────────────────────────────────────────────
  const renderTableData = () => {
    if (!data) return null;
    switch (reportType) {
      case 'all_in_one': {
        const shop = data.shop || {};
        const sum = data.summary || {};
        const bills = data.bills || [];
        const customers = data.customers || [];
        const vegSales = data.vegetable_sales || [];
        const ledger = data.credit_ledger || [];

        return (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 32 }}>
            {/* ── Executive Profile & KPI Summary Dossier ────────── */}
            <div
              style={{
                border: '1px solid var(--color-border)',
                borderRadius: 'var(--border-radius-md)',
                padding: '18px 22px',
                background: 'var(--color-bg-light)',
              }}
            >
              <div style={{ display: 'flex', justifyContent: 'space-between', flexWrap: 'wrap', gap: 12, marginBottom: 16 }}>
                <div>
                  <h2 style={{ margin: 0, fontSize: '1.25rem', color: 'var(--color-text-primary)', fontWeight: 800 }}>
                    {shop.vendor_name || t('common.appName')}
                  </h2>
                  <div style={{ fontSize: '0.85rem', color: 'var(--color-text-muted)', marginTop: 2 }}>
                    {shop.tagline && <span>{shop.tagline} • </span>}
                    {shop.market_name && <span>{shop.market_name} • </span>}
                    {shop.gala_number && <span>{shop.gala_number} • </span>}
                    {shop.city && <span>{shop.city}</span>}
                  </div>
                  <div style={{ fontSize: '0.82rem', color: 'var(--color-text-secondary)', marginTop: 2 }}>
                    <strong>Proprietor:</strong> {shop.owner_name || 'N/A'} | <strong>Contact:</strong> {shop.mobile_number || 'N/A'} {shop.secondary_mobile ? `/ ${shop.secondary_mobile}` : ''}
                  </div>
                </div>
                <div style={{ textAlign: 'right' }}>
                  <div style={{ fontSize: '0.82rem', color: 'var(--color-text-muted)', textTransform: 'uppercase', fontWeight: 700 }}>
                    {t('reports.masterRecord')}
                  </div>
                  <div style={{ fontSize: '0.85rem', fontWeight: 600 }}>
                    Period: {data.meta?.period_label || 'All-Time'}
                  </div>
                  <div style={{ fontSize: '0.78rem', color: 'var(--color-text-muted)' }}>
                    Generated: {formatDDMMYYYY(new Date())}
                  </div>
                </div>
              </div>

              {/* Summary Financial Grid */}
              <div
                style={{
                  display: 'grid',
                  gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))',
                  gap: 12,
                  paddingTop: 12,
                  borderTop: '1px solid var(--color-border)',
                }}
              >
                <div>
                  <div style={{ fontSize: '0.75rem', color: 'var(--color-text-muted)' }}>Gross Sales</div>
                  <div style={{ fontSize: '1.05rem', fontWeight: 700 }}>₹{Number(sum.total_subtotal || 0).toLocaleString('en-IN')}</div>
                </div>
                <div>
                  <div style={{ fontSize: '0.75rem', color: 'var(--color-text-muted)' }}>Total Net Sales</div>
                  <div style={{ fontSize: '1.05rem', fontWeight: 700, color: 'var(--color-primary)' }}>₹{Number(sum.total_sales || 0).toLocaleString('en-IN')}</div>
                </div>
                <div>
                  <div style={{ fontSize: '0.75rem', color: 'var(--color-text-muted)' }}>Cash Collection</div>
                  <div style={{ fontSize: '1.05rem', fontWeight: 700, color: 'var(--color-success)' }}>₹{Number(sum.cash_collection || 0).toLocaleString('en-IN')}</div>
                </div>
                <div>
                  <div style={{ fontSize: '0.75rem', color: 'var(--color-text-muted)' }}>UPI Collection</div>
                  <div style={{ fontSize: '1.05rem', fontWeight: 700, color: 'var(--color-success)' }}>₹{Number(sum.upi_collection || 0).toLocaleString('en-IN')}</div>
                </div>
                <div>
                  <div style={{ fontSize: '0.75rem', color: 'var(--color-text-muted)' }}>Total Outstanding Dues</div>
                  <div style={{ fontSize: '1.05rem', fontWeight: 700, color: 'var(--color-error)' }}>₹{Number(sum.total_credit_outstanding || 0).toLocaleString('en-IN')}</div>
                </div>
                <div>
                  <div style={{ fontSize: '0.75rem', color: 'var(--color-text-muted)' }}>Commission Earned</div>
                  <div style={{ fontSize: '1.05rem', fontWeight: 700, color: '#7c3aed' }}>₹{Number(sum.total_commission || 0).toLocaleString('en-IN')}</div>
                </div>
              </div>
            </div>

            {/* ── Section 1: Invoices & Sales Log ─────────────────── */}
            <div>
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 10 }}>
                <h3 style={{ fontSize: '1rem', fontWeight: 700, margin: 0, display: 'flex', alignItems: 'center', gap: 6 }}>
                  <ReceiptIcon style={{ width: '16px', height: '16px', color: 'var(--color-primary)' }} />
                  {t('reports.invoicesRecord')} ({bills.length})
                </h3>
              </div>
              <div className="table-wrapper" style={{ maxHeight: 400, overflowY: 'auto' }}>
                <table className="data-table">
                  <thead>
                    <tr>
                      <th className="table-th">{t('billing.billNumber')}</th>
                      <th className="table-th">{t('billing.customer')}</th>
                      <th className="table-th">{t('billing.date')}</th>
                      <th className="table-th">Items Summary</th>
                      <th className="table-th" style={{ textAlign: 'right' }}>{t('billing.total')}</th>
                      <th className="table-th" style={{ textAlign: 'right' }}>{t('billing.paid')}</th>
                      <th className="table-th">{t('billing.status')}</th>
                    </tr>
                  </thead>
                  <tbody>
                    {bills.length === 0 ? (
                      <tr><td colSpan={7} className="table-cell" style={{ textAlign: 'center', color: 'var(--color-text-muted)' }}>No invoices in this period</td></tr>
                    ) : (
                      bills.map((bill) => (
                        <tr className="table-row" key={bill.id}>
                          <td className="table-cell" style={{ fontWeight: 600, fontFamily: 'monospace', fontSize: '0.82rem' }}>{bill.bill_number}</td>
                          <td className="table-cell">
                            <div style={{ fontWeight: 600 }}>{bill.customer_name}</div>
                            <div className="text-muted text-sm">{bill.customer_mobile}</div>
                          </td>
                          <td className="table-cell" style={{ whiteSpace: 'nowrap', fontSize: '0.82rem' }}>{formatDDMMYYYY(bill.date)}</td>
                          <td className="table-cell" style={{ fontSize: '0.82rem', maxWidth: 260, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                            {bill.items_summary || '-'}
                          </td>
                          <td className="table-cell" style={{ fontWeight: 700, textAlign: 'right' }}>₹{Number(bill.final_amount).toFixed(2)}</td>
                          <td className="table-cell" style={{ textAlign: 'right', color: 'var(--color-success)' }}>₹{Number(bill.paid_amount).toFixed(2)}</td>
                          <td className="table-cell">
                            <span className={`badge badge-${bill.payment_status === 'Paid' ? 'success' : bill.payment_status === 'Partial' ? 'warning' : 'error'}`}>
                              {t(`billing.status${bill.payment_status}`)}
                            </span>
                          </td>
                        </tr>
                      ))
                    )}
                  </tbody>
                </table>
              </div>
            </div>

            {/* ── Section 2: Customer Directory & Udhar Receivables ─ */}
            <div>
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 10 }}>
                <h3 style={{ fontSize: '1rem', fontWeight: 700, margin: 0, display: 'flex', alignItems: 'center', gap: 6 }}>
                  <UsersIcon style={{ width: '16px', height: '16px', color: 'var(--color-primary)' }} />
                  {t('reports.customerLedgerRecord')} ({customers.length})
                </h3>
              </div>
              <div className="table-wrapper" style={{ maxHeight: 360, overflowY: 'auto' }}>
                <table className="data-table">
                  <thead>
                    <tr>
                      <th className="table-th">{t('customers.name')}</th>
                      <th className="table-th">{t('customers.mobile')}</th>
                      <th className="table-th">{t('customers.address')}</th>
                      <th className="table-th" style={{ textAlign: 'right' }}>{t('reports.thPurchases')}</th>
                      <th className="table-th" style={{ textAlign: 'right' }}>{t('reports.thPaid')}</th>
                      <th className="table-th" style={{ textAlign: 'right' }}>{t('reports.thOutstanding')}</th>
                    </tr>
                  </thead>
                  <tbody>
                    {customers.length === 0 ? (
                      <tr><td colSpan={6} className="table-cell" style={{ textAlign: 'center', color: 'var(--color-text-muted)' }}>{t('reports.noCustomersFound')}</td></tr>
                    ) : (
                      customers.map((c) => (
                        <tr className="table-row" key={c.id}>
                          <td className="table-cell" style={{ fontWeight: 600 }}>{c.name}</td>
                          <td className="table-cell" style={{ color: 'var(--color-text-muted)', fontSize: '0.82rem' }}>{c.mobile}</td>
                          <td className="table-cell" style={{ fontSize: '0.82rem' }}>{c.address || '-'}</td>
                          <td className="table-cell" style={{ textAlign: 'right', fontWeight: 600 }}>₹{Number(c.total_purchases).toFixed(2)}</td>
                          <td className="table-cell" style={{ textAlign: 'right', color: 'var(--color-success)' }}>₹{Number(c.total_paid).toFixed(2)}</td>
                          <td className="table-cell" style={{ textAlign: 'right' }}>
                            <span className={`badge ${c.current_credit_balance > 0 ? 'badge-warning' : 'badge-success'}`}>
                              ₹{Number(c.current_credit_balance).toFixed(2)}
                            </span>
                          </td>
                        </tr>
                      ))
                    )}
                  </tbody>
                </table>
              </div>
            </div>

            {/* ── Section 3: Vegetable Sales Breakdown ────────────── */}
            <div>
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 10 }}>
                <h3 style={{ fontSize: '1rem', fontWeight: 700, margin: 0, display: 'flex', alignItems: 'center', gap: 6 }}>
                  <LeafIcon style={{ width: '16px', height: '16px', color: 'var(--color-success)' }} />
                  {t('reports.vegetableSalesRecord')} ({vegSales.length})
                </h3>
              </div>
              <div className="table-wrapper" style={{ maxHeight: 320, overflowY: 'auto' }}>
                <table className="data-table">
                  <thead>
                    <tr>
                      <th className="table-th">{t('vegetables.name')}</th>
                      <th className="table-th" style={{ textAlign: 'right' }}>{t('reports.thVolumeSold')}</th>
                      <th className="table-th">{t('reports.thUnit')}</th>
                      <th className="table-th" style={{ textAlign: 'right' }}>{t('reports.thTotalRevenue')}</th>
                      <th className="table-th" style={{ textAlign: 'right' }}>{t('reports.thInvoicesCount')}</th>
                      <th className="table-th" style={{ textAlign: 'right' }}>{t('reports.thAvgRate')}</th>
                    </tr>
                  </thead>
                  <tbody>
                    {vegSales.length === 0 ? (
                      <tr><td colSpan={6} className="table-cell" style={{ textAlign: 'center', color: 'var(--color-text-muted)' }}>{t('reports.noVegetableSales')}</td></tr>
                    ) : (
                      vegSales.map((v) => (
                        <tr className="table-row" key={v.vegetable_id || v.vegetable_name}>
                          <td className="table-cell" style={{ fontWeight: 600 }}>{v.vegetable_name}</td>
                          <td className="table-cell" style={{ textAlign: 'right', fontWeight: 600 }}>{Number(v.total_quantity).toFixed(2)}</td>
                          <td className="table-cell" style={{ color: 'var(--color-text-muted)', fontSize: '0.82rem' }}>{v.vegetable_unit || 'kg'}</td>
                          <td className="table-cell" style={{ fontWeight: 700, textAlign: 'right', color: 'var(--color-primary)' }}>₹{Number(v.total_sales).toFixed(2)}</td>
                          <td className="table-cell" style={{ textAlign: 'right' }}>{v.total_bills}</td>
                          <td className="table-cell" style={{ textAlign: 'right', fontWeight: 600 }}>₹{v.average_rate}</td>
                        </tr>
                      ))
                    )}
                  </tbody>
                </table>
              </div>
            </div>

            {/* ── Section 4: Payments & Credit Passbook Log ────────── */}
            <div>
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 10 }}>
                <h3 style={{ fontSize: '1rem', fontWeight: 700, margin: 0, display: 'flex', alignItems: 'center', gap: 6 }}>
                  <ChartIcon style={{ width: '16px', height: '16px', color: '#2563eb' }} />
                  {t('reports.paymentsRecord')} ({ledger.length})
                </h3>
              </div>
              <div className="table-wrapper" style={{ maxHeight: 320, overflowY: 'auto' }}>
                <table className="data-table">
                  <thead>
                    <tr>
                      <th className="table-th">{t('reports.thDateTime')}</th>
                      <th className="table-th">{t('billing.customer')}</th>
                      <th className="table-th">{t('reports.thType')}</th>
                      <th className="table-th" style={{ textAlign: 'right' }}>{t('reports.thAmount')}</th>
                      <th className="table-th">{t('reports.thMode')}</th>
                      <th className="table-th" style={{ textAlign: 'right' }}>{t('reports.thBalanceAfter')}</th>
                      <th className="table-th">{t('reports.thBillRef')}</th>
                    </tr>
                  </thead>
                  <tbody>
                    {ledger.length === 0 ? (
                      <tr><td colSpan={7} className="table-cell" style={{ textAlign: 'center', color: 'var(--color-text-muted)' }}>{t('reports.noLedgerEntries')}</td></tr>
                    ) : (
                      ledger.map((r) => (
                        <tr className="table-row" key={r.id}>
                          <td className="table-cell" style={{ fontSize: '0.82rem', whiteSpace: 'nowrap' }}>
                            {formatDDMMYYYY(r.created_at)} {formatStoredTime(r.created_at, language === 'mr')}
                          </td>
                          <td className="table-cell" style={{ fontWeight: 600 }}>{r.customer_name}</td>
                          <td className="table-cell">
                            <span className={`badge badge-${r.transaction_type === 'PAYMENT_RECEIVED' ? 'success' : 'warning'}`}>
                              {r.transaction_type === 'PAYMENT_RECEIVED' ? (t('credit.typePaymentReceived') || 'Payment Received') : r.transaction_type === 'CREDIT_ADDED' ? (t('credit.typeCreditAdded') || 'Credit Added') : r.transaction_type}
                            </span>
                          </td>
                          <td className="table-cell" style={{ textAlign: 'right', fontWeight: 700, color: r.transaction_type === 'PAYMENT_RECEIVED' ? 'var(--color-success)' : 'var(--color-error)' }}>
                            ₹{Number(r.amount).toFixed(2)}
                          </td>
                          <td className="table-cell" style={{ fontSize: '0.82rem' }}>{r.payment_mode || 'Cash'}</td>
                          <td className="table-cell" style={{ textAlign: 'right', fontWeight: 600 }}>₹{Number(r.balance_after_transaction).toFixed(2)}</td>
                          <td className="table-cell" style={{ fontSize: '0.82rem', fontFamily: 'monospace' }}>{r.bill_number || (r.bill_id ? `#${r.bill_id}` : '-')}</td>
                        </tr>
                      ))
                    )}
                  </tbody>
                </table>
              </div>
            </div>
          </div>
        );
      }
      case 'daily':
      case 'range': {
        const bills = data.bills || [];
        const customers = data.customers || [];
        const sum = data.summary || {};

        if (customers.length === 0 && bills.length === 0) {
          return (
            <div style={{ textAlign: 'center', padding: '40px 20px', color: 'var(--color-text-muted)' }}>
              <ReceiptIcon style={{ width: '40px', height: '40px', marginBottom: 12, opacity: 0.5 }} />
              <p style={{ fontSize: '1rem', fontWeight: 600 }}>{t('common.noData') || 'या कालावधीत कोणतीही विक्री किंवा व्यवहार नोंदवलेले नाहीत'}</p>
            </div>
          );
        }

        // If customers array is available with items, render organized customer cards
        if (customers.length > 0) {
          return (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 20 }}>
              {customers.map((c, cIdx) => (
                <div
                  key={c.customer_id || cIdx}
                  className="card report-customer-card"
                  style={{
                    padding: 0,
                    overflow: 'hidden',
                    border: '1px solid var(--color-border)',
                    borderRadius: 'var(--border-radius-md, 10px)',
                    boxShadow: '0 2px 8px rgba(0,0,0,0.04)',
                    breakInside: 'avoid',
                    pageBreakInside: 'avoid'
                  }}
                >
                  {/* Customer Banner */}
                  <div
                    style={{
                      background: 'var(--color-bg-light, #f8fafc)',
                      borderBottom: '1px solid var(--color-border)',
                      padding: '12px 18px',
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'space-between',
                      flexWrap: 'wrap',
                      gap: 10
                    }}
                  >
                    <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
                      <div style={{ background: '#e0f2fe', color: '#0284c7', width: 30, height: 30, borderRadius: '50%', display: 'flex', alignItems: 'center', justifyContent: 'center', fontWeight: 700, fontSize: '0.85rem' }}>
                        {cIdx + 1}
                      </div>
                      <div>
                        <div style={{ fontWeight: 700, fontSize: '1rem', color: 'var(--color-text-primary)' }}>
                          {c.customer_name}
                        </div>
                        <div style={{ fontSize: '0.8rem', color: 'var(--color-text-muted)', display: 'flex', alignItems: 'center', gap: 8 }}>
                          <span>📱 {c.customer_mobile || (language === 'mr' ? 'मोबाईल नाही' : 'No mobile')}</span>
                          {c.bill_numbers?.length > 0 && (
                            <span style={{ background: '#f1f5f9', padding: '1px 6px', borderRadius: 4, fontFamily: 'monospace' }}>
                              #{c.bill_numbers.join(', ')}
                            </span>
                          )}
                        </div>
                      </div>
                    </div>

                    <div style={{ textAlign: 'right' }}>
                      <span style={{ fontSize: '0.75rem', color: 'var(--color-text-muted)', display: 'block' }}>
                        {language === 'mr' ? 'मागील उधारी बाकी (Prev Udhar)' : 'Previous Udhar Due'}
                      </span>
                      <span style={{ fontWeight: 700, color: c.previous_balance > 0 ? '#d97706' : 'var(--color-text-primary)' }}>
                        ₹{Number(c.previous_balance || 0).toFixed(2)}
                      </span>
                    </div>
                  </div>

                  {/* Customer Produce Items Table */}
                  <div className="table-wrapper" style={{ margin: 0 }}>
                    <table className="data-table" style={{ margin: 0, width: '100%' }}>
                      <thead>
                        <tr style={{ background: '#f8fafc' }}>
                          <th className="table-th" style={{ width: 45, textAlign: 'center' }}>
                            {language === 'mr' ? 'अ.क्र' : 'Sr.'}
                          </th>
                          {reportType === 'range' && (
                            <th className="table-th" style={{ width: 100, whiteSpace: 'nowrap' }}>
                              {language === 'mr' ? 'दिनांक (Date)' : 'Date'}
                            </th>
                          )}
                          <th className="table-th">
                            {language === 'mr' ? 'शेतमालाचे नांव (Produce / Vegetable)' : 'Produce / Vegetable'}
                          </th>
                          <th className="table-th" style={{ textAlign: 'right' }}>
                            {language === 'mr' ? 'प्रमाण / वजन (Qty/Weight)' : 'Quantity / Weight'}
                          </th>
                          <th className="table-th" style={{ textAlign: 'right' }}>
                            {language === 'mr' ? 'दर (Rate ₹)' : 'Rate (₹)'}
                          </th>
                          <th className="table-th" style={{ textAlign: 'right' }}>
                            {language === 'mr' ? 'रक्कम (Amount ₹)' : 'Amount (₹)'}
                          </th>
                        </tr>
                      </thead>
                      <tbody>
                        {c.items && c.items.length > 0 ? (
                          (() => {
                            const sortedItems = [...c.items].sort((a, b) => {
                              const da = a.transaction_date || '';
                              const db = b.transaction_date || '';
                              return da.localeCompare(db);
                            });

                            let lastDate = null;

                            return sortedItems.map((it, itIdx) => {
                              const itemDate = it.transaction_date || '';
                              const showDateHeader = reportType === 'range' && itemDate && itemDate !== lastDate;
                              if (showDateHeader) {
                                lastDate = itemDate;
                              }

                              return (
                                <React.Fragment key={it.id || itIdx}>
                                  {showDateHeader && (
                                    <tr style={{ background: '#f1f5f9', borderTop: '2px solid var(--color-border)' }}>
                                      <td colSpan={6} style={{ padding: '6px 14px', fontSize: '0.8rem', fontWeight: 700, color: 'var(--color-primary)' }}>
                                        📅 {formatDDMMYYYY(itemDate)} {getDayName(itemDate, language === 'mr') ? `(${getDayName(itemDate, language === 'mr')})` : ''}
                                      </td>
                                    </tr>
                                  )}
                                  <tr className="table-row">
                                    <td className="table-cell" style={{ textAlign: 'center', color: 'var(--color-text-muted)', fontSize: '0.82rem' }}>
                                      {itIdx + 1}
                                    </td>
                                    {reportType === 'range' && (
                                      <td className="table-cell" style={{ fontSize: '0.8rem', whiteSpace: 'nowrap', color: 'var(--color-primary)', fontWeight: 600 }}>
                                        {itemDate ? formatDDMMYYYY(itemDate) : '-'}
                                      </td>
                                    )}
                                    <td className="table-cell" style={{ fontWeight: 600 }}>
                                      {it.vegetable_name}
                                    </td>
                                    <td className="table-cell" style={{ textAlign: 'right', fontWeight: 600 }}>
                                      {it.weight} {it.unit || 'kg'}
                                    </td>
                                    <td className="table-cell" style={{ textAlign: 'right' }}>
                                      ₹{Number(it.rate).toFixed(2)}
                                    </td>
                                    <td className="table-cell" style={{ textAlign: 'right', fontWeight: 700 }}>
                                      ₹{Number(it.base_amount || 0).toFixed(2)}
                                    </td>
                                  </tr>
                                </React.Fragment>
                              );
                            });
                          })()
                        ) : (
                          <tr>
                            <td colSpan={reportType === 'range' ? 6 : 5} className="table-cell" style={{ textAlign: 'center', color: 'var(--color-text-muted)', padding: '14px' }}>
                              {language === 'mr' ? 'या दिवशी भाजी खरेदी नाही (फक्त जमा रक्कम / मागील बाकी नोंद)' : 'No produce purchase on this day (Payment or balance record only)'}
                            </td>
                          </tr>
                        )}
                      </tbody>
                    </table>
                  </div>

                  {/* Financial Reconciliation Strip */}
                  <div
                    style={{
                      background: '#f1f5f9',
                      borderTop: '1px solid var(--color-border)',
                      padding: '12px 18px',
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'space-between',
                      flexWrap: 'wrap',
                      gap: 12,
                      fontSize: '0.88rem'
                    }}
                  >
                    <div style={{ display: 'flex', gap: 14, flexWrap: 'wrap', alignItems: 'center' }}>
                      <div>
                        <span style={{ color: 'var(--color-text-muted)', fontSize: '0.78rem' }}>
                          {language === 'mr' ? 'आजची खरेदी:' : 'Today Purchase:'}{' '}
                        </span>
                        <strong>₹{Number(c.today_base_purchase || 0).toFixed(2)}</strong>
                      </div>
                      <div>
                        <span style={{ color: 'var(--color-text-muted)', fontSize: '0.78rem' }}>
                          {language === 'mr' ? 'कमिशन:' : 'Commission:'}{' '}
                        </span>
                        <strong>₹{Number(c.today_commission || 0).toFixed(2)}</strong>
                      </div>
                      <div style={{ background: '#ffffff', padding: '3px 10px', borderRadius: 6, border: '1px solid var(--color-border)' }}>
                        <span style={{ color: 'var(--color-primary)', fontWeight: 700, fontSize: '0.82rem' }}>
                          {language === 'mr' ? 'आजचे एकूण बिल:' : "Today's Bill:"}{' '}
                        </span>
                        <strong style={{ color: 'var(--color-primary)', fontSize: '0.98rem' }}>₹{Number(c.today_bill_total || 0).toFixed(2)}</strong>
                      </div>
                    </div>

                    <div style={{ display: 'flex', gap: 14, alignItems: 'center', flexWrap: 'wrap' }}>
                      <div>
                        <span style={{ color: 'var(--color-text-muted)', fontSize: '0.78rem' }}>
                          {language === 'mr' ? 'आज जमा रक्कम:' : 'Paid Today:'}{' '}
                        </span>
                        <strong style={{ color: '#15803d', fontSize: '0.98rem' }}>₹{Number(c.today_paid || 0).toFixed(2)}</strong>
                      </div>
                      <div style={{ background: c.closing_balance > 0 ? '#fef3c7' : '#dcfce7', padding: '4px 12px', borderRadius: 8, border: `1px solid ${c.closing_balance > 0 ? '#f59e0b' : '#16a34a'}` }}>
                        <span style={{ color: c.closing_balance > 0 ? '#92400e' : '#166534', fontWeight: 700, fontSize: '0.82rem' }}>
                          {language === 'mr' ? 'चालू बाकी (Closing Udhar):' : 'Closing Udhar Balance:'}{' '}
                        </span>
                        <strong style={{ color: c.closing_balance > 0 ? '#b45309' : '#15803d', fontSize: '1.05rem', fontWeight: 800 }}>₹{Number(c.closing_balance || 0).toFixed(2)}</strong>
                      </div>
                    </div>
                  </div>
                </div>
              ))}

              {/* Day Financial Grand Total Footer */}
              <div
                style={{
                  background: 'linear-gradient(135deg, #15803d, #166534)',
                  color: '#ffffff',
                  padding: '16px 22px',
                  borderRadius: 'var(--border-radius-md, 10px)',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'space-between',
                  flexWrap: 'wrap',
                  gap: 16
                }}
              >
                <div>
                  <h4 style={{ margin: '0 0 4px 0', fontSize: '1.05rem', color: '#ffffff', fontWeight: 800 }}>
                    {language === 'mr' ? 'दिवसाची एकूण गोषवारा बेरीज (Daily Grand Total)' : 'Daily Summary Grand Total'}
                  </h4>
                  <div style={{ fontSize: '0.82rem', color: '#bbf7d0' }}>
                    {language === 'mr' ? `एकूण ग्राहक: ${customers.length} | तयार झालेली बिले: ${sum.total_bills || bills.length}` : `Active Customers: ${customers.length} | Bills Generated: ${sum.total_bills || bills.length}`}
                  </div>
                </div>

                <div style={{ display: 'flex', gap: 24, alignItems: 'center', flexWrap: 'wrap' }}>
                  <div>
                    <div style={{ fontSize: '0.75rem', color: '#bbf7d0' }}>
                      {language === 'mr' ? 'एकूण विक्री (Turnover)' : 'Total Sales Turnover'}
                    </div>
                    <div style={{ fontSize: '1.15rem', fontWeight: 800, color: '#ffffff' }}>
                      ₹{Number(sum.total_sales || 0).toFixed(2)}
                    </div>
                  </div>
                  <div>
                    <div style={{ fontSize: '0.75rem', color: '#bbf7d0' }}>
                      {language === 'mr' ? 'एकूण जमा (Collected)' : 'Total Paid Collected'}
                    </div>
                    <div style={{ fontSize: '1.15rem', fontWeight: 800, color: '#bbf7d0' }}>
                      ₹{Number(sum.total_paid || 0).toFixed(2)}
                    </div>
                  </div>
                  <div>
                    <div style={{ fontSize: '0.75rem', color: '#fef08a' }}>
                      {language === 'mr' ? 'एकूण चालू येणे बाकी (Market Udhar)' : 'Total Market Outstanding Udhar'}
                    </div>
                    <div style={{ fontSize: '1.15rem', fontWeight: 800, color: '#fef08a' }}>
                      ₹{Number(sum.market_udhar || sum.total_outstanding || sum.total_remaining || 0).toFixed(2)}
                    </div>
                  </div>
                </div>
              </div>
            </div>
          );
        }

        // Fallback for bills-only if customers breakdown is empty
        return (
          <table className="data-table">
            <thead>
              <tr>
                <th className="table-th">{t('billing.billNumber')}</th>
                <th className="table-th">{t('billing.customer')}</th>
                <th className="table-th">{t('billing.date')}</th>
                <th className="table-th" style={{ textAlign: 'right' }}>{t('billing.total')}</th>
                <th className="table-th" style={{ textAlign: 'right' }}>{t('billing.paid')}</th>
                <th className="table-th">{t('billing.status')}</th>
              </tr>
            </thead>
            <tbody>
              {bills.map((bill) => (
                <tr className="table-row" key={bill.id}>
                  <td className="table-cell" style={{ fontWeight: 600, fontFamily: 'monospace', fontSize: '0.82rem' }}>{bill.bill_number}</td>
                  <td className="table-cell">
                    <div style={{ fontWeight: 600 }}>{bill.customer_name}</div>
                    <div className="text-muted text-sm">{bill.customer_mobile}</div>
                  </td>
                  <td className="table-cell" style={{ whiteSpace: 'nowrap', fontSize: '0.82rem' }}>{formatDDMMYYYY(bill.date)}</td>
                  <td className="table-cell" style={{ fontWeight: 700, textAlign: 'right' }}>₹{Number(bill.final_amount).toFixed(2)}</td>
                  <td className="table-cell" style={{ textAlign: 'right', color: 'var(--color-success)' }}>₹{Number(bill.paid_amount).toFixed(2)}</td>
                  <td className="table-cell">
                    <span className={`badge badge-${bill.payment_status === 'Paid' ? 'success' : bill.payment_status === 'Partial' ? 'warning' : 'error'}`}>
                      {t(`billing.status${bill.payment_status}`)}
                    </span>
                  </td>
                </tr>
              ))}
            </tbody>
            <tfoot>
              <tr style={{ background: 'var(--color-bg-light)', fontWeight: 700 }}>
                <td className="table-cell" colSpan={3} style={{ textAlign: 'right' }}>Total:</td>
                <td className="table-cell" style={{ textAlign: 'right' }}>₹{bills.reduce((s, b) => s + Number(b.final_amount), 0).toFixed(2)}</td>
                <td className="table-cell" style={{ textAlign: 'right', color: 'var(--color-success)' }}>₹{bills.reduce((s, b) => s + Number(b.paid_amount), 0).toFixed(2)}</td>
                <td className="table-cell"></td>
              </tr>
            </tfoot>
          </table>
        );
      }
      case 'customers': {
        if (!Array.isArray(data)) return null;
        return (
          <table className="data-table">
            <thead>
              <tr>
                <th className="table-th">{t('customers.name')}</th>
                <th className="table-th">{t('customers.mobile')}</th>
                <th className="table-th" style={{ textAlign: 'right' }}>{t('billing.totalBills')}</th>
                <th className="table-th" style={{ textAlign: 'right' }}>Total Purchases</th>
                <th className="table-th" style={{ textAlign: 'right' }}>Total Paid</th>
                <th className="table-th">{t('credit.balanceAfter')}</th>
              </tr>
            </thead>
            <tbody>
              {data.map((c) => (
                <tr className="table-row" key={c.customer_id}>
                  <td className="table-cell" style={{ fontWeight: 600 }}>{c.customer_name}</td>
                  <td className="table-cell" style={{ color: 'var(--color-text-muted)', fontSize: '0.82rem' }}>
                    <span style={{ display: 'inline-flex', alignItems: 'center', gap: 4 }}><PhoneIcon style={{ width: '12px', height: '12px' }} /> {c.customer_mobile}</span>
                  </td>
                  <td className="table-cell" style={{ textAlign: 'right' }}>{c.total_bills}</td>
                  <td className="table-cell" style={{ fontWeight: 600, textAlign: 'right' }}>₹{Number(c.total_purchase).toFixed(2)}</td>
                  <td className="table-cell" style={{ color: 'var(--color-success)', textAlign: 'right' }}>₹{Number(c.total_paid).toFixed(2)}</td>
                  <td className="table-cell">
                    <span className={`badge ${c.total_pending_credit > 0 ? 'badge-warning' : 'badge-success'}`}>
                      ₹{Number(c.total_pending_credit).toFixed(2)}
                    </span>
                  </td>
                </tr>
              ))}
            </tbody>
            <tfoot>
              <tr style={{ background: 'var(--color-bg-light)', fontWeight: 700 }}>
                <td className="table-cell" colSpan={2} style={{ textAlign: 'right' }}>Total:</td>
                <td className="table-cell" style={{ textAlign: 'right' }}>{data.reduce((s, c) => s + Number(c.total_bills), 0)}</td>
                <td className="table-cell" style={{ textAlign: 'right' }}>₹{data.reduce((s, c) => s + Number(c.total_purchase), 0).toFixed(2)}</td>
                <td className="table-cell" style={{ color: 'var(--color-success)', textAlign: 'right' }}>₹{data.reduce((s, c) => s + Number(c.total_paid), 0).toFixed(2)}</td>
                <td className="table-cell" style={{ color: 'var(--color-error)' }}>
                  <span className="badge badge-error" style={{ background: 'transparent', padding: 0 }}>
                    ₹{data.reduce((s, c) => s + Number(c.total_pending_credit), 0).toFixed(2)}
                  </span>
                </td>
              </tr>
            </tfoot>
          </table>
        );
      }
      case 'vegetables': {
        if (!Array.isArray(data)) return null;
        return (
          <table className="data-table">
            <thead>
              <tr>
                <th className="table-th">{t('vegetables.name')}</th>
                <th className="table-th" style={{ textAlign: 'right' }}>Volume Sold</th>
                <th className="table-th">Unit</th>
                <th className="table-th" style={{ textAlign: 'right' }}>Total Revenue</th>
                <th className="table-th" style={{ textAlign: 'right' }}>Bills Count</th>
              </tr>
            </thead>
            <tbody>
              {data.map((v) => (
                <tr className="table-row" key={v.vegetable_id}>
                  <td className="table-cell" style={{ fontWeight: 600 }}>{v.vegetable_name}</td>
                  <td className="table-cell" style={{ textAlign: 'right', fontWeight: 600 }}>{Number(v.total_quantity).toFixed(2)}</td>
                  <td className="table-cell" style={{ color: 'var(--color-text-muted)', fontSize: '0.82rem' }}>{v.vegetable_unit ? t(`vegetables.units.${v.vegetable_unit}`) : ''}</td>
                  <td className="table-cell" style={{ fontWeight: 700, textAlign: 'right', color: 'var(--color-primary)' }}>₹{Number(v.total_sales).toFixed(2)}</td>
                  <td className="table-cell" style={{ textAlign: 'right' }}>{v.total_bills}</td>
                </tr>
              ))}
            </tbody>
            <tfoot>
              <tr style={{ background: 'var(--color-bg-light)', fontWeight: 700 }}>
                <td className="table-cell" style={{ textAlign: 'right' }}>Total:</td>
                <td className="table-cell" style={{ textAlign: 'right' }}>{data.reduce((s, v) => s + Number(v.total_quantity), 0).toFixed(2)}</td>
                <td className="table-cell"></td>
                <td className="table-cell" style={{ textAlign: 'right', color: 'var(--color-primary)' }}>₹{data.reduce((s, v) => s + Number(v.total_sales), 0).toFixed(2)}</td>
                <td className="table-cell" style={{ textAlign: 'right' }}>{data.reduce((s, v) => s + Number(v.total_bills), 0)}</td>
              </tr>
            </tfoot>
          </table>
        );
      }
      case 'credit': {
        const rawList = data.customers || [];
        const list = [...rawList].sort((a, b) => {
          const dateA = Number(a.today_recovery || 0) > 0 ? date : (a.last_transaction_date || '');
          const dateB = Number(b.today_recovery || 0) > 0 ? date : (b.last_transaction_date || '');
          if (dateA !== dateB) {
            return dateB.localeCompare(dateA); // Latest date first
          }
          return (Number(b.credit_balance) || 0) - (Number(a.credit_balance) || 0);
        });
        const recoveries = data.recoveries || [];
        const totalRecovered = recoveries.reduce((s, r) => s + Number(r.amount || 0), 0);
        return (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 24 }}>
            {/* 1. Recovery on this date list */}
            <div className="card" style={{ padding: '16px 20px' }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12, flexWrap: 'wrap', gap: 8 }}>
                <h3 style={{ margin: 0, fontSize: '0.95rem', fontWeight: 700, color: 'var(--color-text-primary)', display: 'flex', alignItems: 'center', gap: 8 }}>
                  <CheckIcon style={{ width: 16, height: 16, color: 'var(--color-success)' }} />
                  {t('credit.recoveryListTitle') || 'या तारखेला झालेली वसुली (ग्राहकनिहाय)'}
                </h3>
                <span className="badge badge-success" style={{ fontWeight: 700 }}>
                  एकूण वसुली: ₹{totalRecovered.toFixed(2)} ({recoveries.length} ग्राहक)
                </span>
              </div>

              {recoveries.length === 0 ? (
                <div style={{ padding: '20px', textAlign: 'center', color: 'var(--color-text-muted)', fontSize: '0.85rem' }}>
                  {t('credit.noRecoveriesOnDate') || 'या तारखेला कोणतीही वसुली नोंदवली नाही.'}
                </div>
              ) : (
                <div style={{ overflowX: 'auto' }}>
                  <table className="data-table">
                    <thead>
                      <tr>
                        <th className="table-th">{t('credit.recoveredFrom') || 'ग्राहक'}</th>
                        <th className="table-th">{t('customers.mobile')}</th>
                        <th className="table-th">{t('credit.paymentMode')}</th>
                        <th className="table-th">{t('credit.recoveredTime') || 'वेळ'}</th>
                        <th className="table-th">{t('credit.note')}</th>
                        <th className="table-th" style={{ textAlign: 'right' }}>{t('credit.recoveredAmount') || 'वसुली रक्कम'}</th>
                      </tr>
                    </thead>
                    <tbody>
                      {recoveries.map((r) => (
                        <tr className="table-row" key={r.id}>
                          <td className="table-cell" style={{ fontWeight: 600 }}>{r.customer_name}</td>
                          <td className="table-cell" style={{ color: 'var(--color-text-muted)', fontSize: '0.82rem' }}>
                            <span style={{ display: 'inline-flex', alignItems: 'center', gap: 4 }}><PhoneIcon style={{ width: '12px', height: '12px' }} /> {r.customer_mobile || '—'}</span>
                          </td>
                          <td className="table-cell">
                            <span style={{
                              padding: '2px 8px', borderRadius: 10, fontSize: '0.72rem', fontWeight: 600,
                              background: r.payment_mode === 'UPI' ? '#eff6ff' : '#f0fdf4',
                              color: r.payment_mode === 'UPI' ? '#1d4ed8' : '#15803d',
                            }}>
                              {r.payment_mode}
                            </span>
                          </td>
                          <td className="table-cell" style={{ fontSize: '0.8rem', color: 'var(--color-text-muted)', whiteSpace: 'nowrap' }}>
                            {r.created_at ? new Date(r.created_at).toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit' }) : '—'}
                          </td>
                          <td className="table-cell" style={{ fontSize: '0.8rem', color: 'var(--color-text-muted)' }}>
                            {r.note || '—'}
                          </td>
                          <td className="table-cell" style={{ textAlign: 'right', fontWeight: 700, color: 'var(--color-success)' }}>
                            ₹{Number(r.amount).toFixed(2)}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                    <tfoot>
                      <tr style={{ background: 'var(--color-bg-light)', fontWeight: 700 }}>
                        <td className="table-cell" colSpan={5} style={{ textAlign: 'right' }}>एकूण वसुली (Total Recovery):</td>
                        <td className="table-cell" style={{ textAlign: 'right', color: 'var(--color-success)', fontSize: '0.9rem' }}>
                          ₹{totalRecovered.toFixed(2)}
                        </td>
                      </tr>
                    </tfoot>
                  </table>
                </div>
              )}
            </div>

            {/* 2. Customer Outstanding Balance Listing */}
            <div className="card" style={{ padding: '16px 20px' }}>
              <h3 style={{ margin: '0 0 12px 0', fontSize: '0.95rem', fontWeight: 700, color: 'var(--color-text-primary)' }}>
                {t('credit.customersWithBalance') || 'उधार शिल्लक असलेले ग्राहक (Outstanding Balances)'}
              </h3>
              <div style={{ overflowX: 'auto' }}>
                <table className="data-table">
                  <thead>
                    <tr>
                      <th className="table-th">{t('customers.name')}</th>
                      <th className="table-th">{t('customers.mobile')}</th>
                      <th className="table-th" style={{ textAlign: 'center' }}>{t('credit.todaySubmit') || 'आज जमा / भरणा'}</th>
                      <th className="table-th" style={{ textAlign: 'center' }}>{t('credit.lastBalanceUpdate') || 'शेवटचा व्यवहार दिनांक'}</th>
                      <th className="table-th" style={{ textAlign: 'right' }}>{t('credit.balanceAfter')}</th>
                    </tr>
                  </thead>
                  <tbody>
                    {list.map((c) => {
                      const todayPaid = Number(c.today_recovery || 0);
                      const hasTodayPaid = todayPaid > 0;
                      const lastDate = c.last_transaction_date;
                      const daysAgo = getDaysAgoLabel(lastDate, date, language === 'mr');

                      return (
                        <tr className="table-row" key={c.id}>
                          <td className="table-cell" style={{ fontWeight: 600 }}>{c.name}</td>
                          <td className="table-cell" style={{ color: 'var(--color-text-muted)', fontSize: '0.82rem' }}>
                            <span style={{ display: 'inline-flex', alignItems: 'center', gap: 4 }}>
                              <PhoneIcon style={{ width: '12px', height: '12px' }} /> {c.mobile || '—'}
                            </span>
                          </td>
                          <td className="table-cell" style={{ textAlign: 'center' }}>
                            {hasTodayPaid ? (
                              <span style={{
                                display: 'inline-flex', alignItems: 'center', gap: 4,
                                padding: '3px 8px', borderRadius: '12px',
                                background: '#dcfce7', color: '#15803d',
                                fontWeight: 700, fontSize: '0.82rem'
                              }}>
                                🟢 ₹{todayPaid.toFixed(2)}
                              </span>
                            ) : (
                              <span style={{ color: 'var(--color-text-muted)', fontSize: '0.8rem' }}>—</span>
                            )}
                          </td>
                          <td className="table-cell" style={{ textAlign: 'center', whiteSpace: 'nowrap' }}>
                            {hasTodayPaid ? (
                              <span style={{ fontWeight: 700, color: '#15803d', fontSize: '0.82rem' }}>
                                {language === 'mr' ? 'आज' : 'Today'} ({formatDDMMYYYY(date)})
                              </span>
                            ) : lastDate ? (
                              <span style={{ fontSize: '0.82rem', color: 'var(--color-text-primary)' }}>
                                <strong>{formatDDMMYYYY(lastDate)}</strong>
                                {daysAgo && (
                                  <span style={{ color: 'var(--color-text-muted)', fontSize: '0.74rem', marginLeft: 4 }}>
                                    ({daysAgo})
                                  </span>
                                )}
                              </span>
                            ) : (
                              <span style={{ color: 'var(--color-text-muted)', fontSize: '0.8rem' }}>—</span>
                            )}
                          </td>
                          <td className="table-cell" style={{ textAlign: 'right' }}>
                            <span className="badge badge-warning">₹{Number(c.credit_balance).toFixed(2)}</span>
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                  <tfoot>
                    <tr style={{ background: 'var(--color-bg-light)', fontWeight: 700 }}>
                      <td className="table-cell" colSpan={2} style={{ textAlign: 'right' }}>Total:</td>
                      <td className="table-cell" style={{ textAlign: 'center', color: 'var(--color-success)', fontWeight: 700 }}>
                        ₹{list.reduce((s, c) => s + Number(c.today_recovery || 0), 0).toFixed(2)}
                      </td>
                      <td className="table-cell"></td>
                      <td className="table-cell" style={{ textAlign: 'right' }}>
                        <span className="badge badge-warning" style={{ background: 'transparent', padding: 0 }}>
                          ₹{list.reduce((s, c) => s + Number(c.credit_balance), 0).toFixed(2)}
                        </span>
                      </td>
                    </tr>
                  </tfoot>
                </table>
              </div>
            </div>
          </div>
        );
      }
      case 'commission': {
        const list = data.billWise || [];
        return (
          <table className="data-table">
            <thead>
              <tr>
                <th className="table-th">{t('billing.billNumber')}</th>
                <th className="table-th">{t('billing.customer')}</th>
                <th className="table-th">{t('billing.date')}</th>
                <th className="table-th" style={{ textAlign: 'right' }}>{t('billing.total')}</th>
                <th className="table-th" style={{ textAlign: 'right' }}>{t('reports.totalCommission')}</th>
              </tr>
            </thead>
            <tbody>
              {list.map((c) => (
                <tr className="table-row" key={c.bill_id}>
                  <td className="table-cell" style={{ fontWeight: 600, fontFamily: 'monospace', fontSize: '0.82rem' }}>{c.bill_number}</td>
                  <td className="table-cell" style={{ fontWeight: 600 }}>{c.customer_name}</td>
                  <td className="table-cell" style={{ fontSize: '0.82rem', whiteSpace: 'nowrap' }}>{formatDDMMYYYY(c.date)}</td>
                  <td className="table-cell" style={{ textAlign: 'right' }}>₹{Number(c.final_amount).toFixed(2)}</td>
                  <td className="table-cell" style={{ textAlign: 'right', fontWeight: 700, color: 'var(--color-primary)' }}>₹{Number(c.commission_amount).toFixed(2)}</td>
                </tr>
              ))}
            </tbody>
            <tfoot>
              <tr style={{ background: 'var(--color-bg-light)', fontWeight: 700 }}>
                <td className="table-cell" colSpan={3} style={{ textAlign: 'right' }}>Total:</td>
                <td className="table-cell" style={{ textAlign: 'right' }}>₹{list.reduce((s, c) => s + Number(c.final_amount), 0).toFixed(2)}</td>
                <td className="table-cell" style={{ textAlign: 'right', color: 'var(--color-primary)' }}>₹{list.reduce((s, c) => s + Number(c.commission_amount), 0).toFixed(2)}</td>
              </tr>
            </tfoot>
          </table>
        );
      }
      default:
        return null;
    }
  };

  const hasData = () => {
    if (!data) return false;
    if (reportType === 'all_in_one') return true;
    if (reportType === 'daily' || reportType === 'range') {
      return Boolean((data.bills && data.bills.length > 0) || (data.customers && data.customers.length > 0));
    }
    if (reportType === 'credit') return Boolean((data.customers && data.customers.length > 0) || (data.recoveries && data.recoveries.length > 0) || data.summary);
    if (reportType === 'commission') return Boolean(data.billWise && data.billWise.length > 0);
    return Array.isArray(data) ? data.length > 0 : Boolean(data);
  };

  return (
    <div className="reports-page">
      <style
        dangerouslySetInnerHTML={{
          __html: `
        .print-header { display: none; }
        @media print {
          body.printing-report #report-content-area,
          body.printing-report #report-content-area * { visibility: visible !important; }
          body.printing-report #report-content-area {
            width: 100% !important; padding: 0 !important; margin: 0 !important;
          }
          body.printing-report .main-content { margin-left: 0 !important; }
          .sidebar, #main-sidebar, .topbar, .reports-selectors, .reports-filters, .no-print,
          .toast, .modal-backdrop { display: none !important; visibility: hidden !important; }
          main, .content, .reports-page { margin: 0 !important; padding: 0 !important; background: #fff !important; width: 100% !important; }
          .card:not(.report-customer-card) { border: none !important; box-shadow: none !important; background: #fff !important; padding: 0 !important; }
          .report-customer-card {
            border: 1px solid #cbd5e1 !important;
            border-radius: 8px !important;
            box-shadow: none !important;
            break-inside: avoid !important;
            page-break-inside: avoid !important;
            margin-bottom: 16px !important;
          }
          body { color: #000 !important; background: #fff !important; }
          .print-header { display: block !important; }
        }
        body.pdf-mode .sidebar, body.pdf-mode #main-sidebar, body.pdf-mode .topbar, body.pdf-mode .reports-selectors, body.pdf-mode .reports-filters, body.pdf-mode .no-print { display: none !important; visibility: hidden !important; }
        body.pdf-mode main, body.pdf-mode .content, body.pdf-mode .reports-page { margin: 0 !important; padding: 0 !important; background: #fff !important; width: 100% !important; }
        body.pdf-mode .card:not(.report-customer-card) { border: none !important; box-shadow: none !important; background: #fff !important; padding: 0 !important; }
        body.pdf-mode .report-customer-card {
          border: 1px solid #cbd5e1 !important;
          border-radius: 8px !important;
          box-shadow: none !important;
          break-inside: avoid !important;
          page-break-inside: avoid !important;
          margin-bottom: 16px !important;
        }
        body.pdf-mode { color: #000 !important; background: #fff !important; }
        body.pdf-mode .print-header { display: block !important; }
      `,
        }}
      />

      {/* ── Page Header ───────────────────────────────────────────────────── */}
      <div className="page-header-bar no-print" style={{ flexWrap: 'wrap', gap: 14 }}>
        <div>
          <h1 className="page-title">{t('reports.title')}</h1>
          <p className="page-desc">{t('reports.subtitle')}</p>
        </div>
        <div className="reports-header-actions" style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
          <button className="btn btn-outline" onClick={fetchReport} disabled={loading}>
            ↻ Refresh
          </button>
          <button
            className="btn btn-success"
            onClick={handleDownloadMasterExcel}
            disabled={isExportingExcel}
            style={{
              display: 'inline-flex',
              alignItems: 'center',
              gap: 6,
              background: '#16a34a',
              color: '#fff',
              border: 'none',
              fontWeight: 600,
            }}
          >
            {isExportingExcel ? (
              <span className="spinner" style={{ width: 14, height: 14 }} />
            ) : (
              <SaveIcon style={{ width: '15px', height: '15px' }} />
            )}
            {isExportingExcel ? 'Exporting...' : t('reports.downloadMasterExcel')}
          </button>
          <button
            className="btn btn-outline"
            onClick={handlePrint}
            disabled={!hasData() || isGeneratingPdf}
            style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}
          >
            <PrintIcon style={{ width: '15px', height: '15px' }} />
            {t('common.print') || 'Print'}
          </button>
          <button
            className="btn btn-primary"
            onClick={handleDownloadPDF}
            disabled={!hasData() || isGeneratingPdf}
            style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}
          >
            {isGeneratingPdf ? (
              <span className="spinner" style={{ width: 15, height: 15 }} />
            ) : (
              <FolderIcon style={{ width: '15px', height: '15px' }} />
            )}
            {isGeneratingPdf ? (pdfProgressText || 'Generating...') : 'Download PDF'}
          </button>
        </div>
      </div>

      {/* ── Report Type Tabs (Vyapar-style pill tabs) ──────────────────────── */}
      <div className="report-tabs reports-selectors no-print" style={{ overflowX: 'auto', paddingBottom: 4 }}>
        {REPORT_TABS.map((tab) => (
          <button
            key={tab.key}
            className={`report-tab${reportType === tab.key ? ' active' : ''}`}
            onClick={() => {
              if (reportType !== tab.key) {
                setReportType(tab.key);
              }
            }}
          >
            {tab.label}
          </button>
        ))}
      </div>

      {/* ── Date Filters ──────────────────────────────────────────────────── */}
      <div
        className="card reports-filters no-print"
        style={{ display: 'flex', gap: 16, alignItems: 'flex-end', padding: '14px 20px', marginBottom: 20, flexWrap: 'wrap' }}
      >
        {(reportType === 'daily' || reportType === 'credit') && (
          <div className="form-group" style={{ marginBottom: 0 }}>
            <label className="form-label">{t('reports.singleDate')}</label>
            <input
              type="date"
              className="form-input"
              value={date}
              onChange={(e) => setDate(e.target.value)}
              style={{ width: 'auto' }}
            />
          </div>
        )}
        {reportType !== 'daily' && reportType !== 'credit' && (
          <>
            <div className="form-group" style={{ marginBottom: 0 }}>
              <label className="form-label">{t('reports.startDate')}</label>
              <input
                type="date"
                className="form-input"
                value={startDate}
                onChange={(e) => setStartDate(e.target.value)}
                style={{ width: 'auto' }}
              />
            </div>
            <div className="form-group" style={{ marginBottom: 0 }}>
              <label className="form-label">{t('reports.endDate')}</label>
              <input
                type="date"
                className="form-input"
                value={endDate}
                onChange={(e) => setEndDate(e.target.value)}
                style={{ width: 'auto' }}
              />
            </div>
          </>
        )}
        <button className="btn btn-primary" onClick={fetchReport} disabled={loading}>
          {loading ? (
            <>
              <span className="spinner" style={{ width: 13, height: 13 }} /> Loading…
            </>
          ) : (
            t('reports.generate')
          )}
        </button>
      </div>

      {/* ── Report Content Area (for PDF and Print) ──────────────────────── */}
      <div id="report-content-area" style={{ padding: '0px 20px', background: '#fff' }}>
        {/* Print Header (print-only) */}
        <div className="print-header">
          <h2 style={{ margin: '0 0 4px 0' }}>{t('common.appName')}</h2>
          <p style={{ margin: '0 0 10px 0', fontSize: '0.9rem', color: '#555' }}>
            <strong>Report:</strong> {reportType === 'all_in_one' ? 'All-in-One Master Business Record' : t(`reports.type${reportType.charAt(0).toUpperCase() + reportType.slice(1)}`)} |&nbsp;
            {reportType === 'daily' || reportType === 'credit'
              ? `Date: ${formatDDMMYYYY(date)}`
              : `Range: ${formatDDMMYYYY(startDate)} to ${formatDDMMYYYY(endDate)}`}
          </p>
          <hr style={{ border: 'none', borderTop: '2px solid #000', margin: '10px 0 20px 0' }} />
        </div>

        {/* ── KPI Cards ─────────────────────────────────────────────────────── */}
        {renderKpiCards()}

        {/* ── Data Table / Dossier Section ─────────────────────────────────── */}
        <div className="card print-section" style={{ padding: 0, overflow: 'hidden', boxShadow: 'none' }}>
          {error && !loading && (
            <div className="table-error no-print" style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '12px 16px' }}>
              <AlertIcon /> {error}
            </div>
          )}
          {loading && (
            <div className="table-message no-print">
              <span className="spinner" style={{ margin: 'auto' }} />
            </div>
          )}
          {!loading && !error && !hasData() && (
            <div className="table-message">
              <ChartIcon style={{ width: '2rem', height: '2rem', color: 'var(--color-text-muted)', marginBottom: 10 }} />
              <p style={{ fontWeight: 600, color: 'var(--color-text-primary)', margin: 0 }}>{t('reports.noData')}</p>
            </div>
          )}
          {!loading && !error && hasData() && (
            <div className="table-wrapper" style={{ border: 'none' }}>{renderTableData()}</div>
          )}
        </div>
      </div>
    </div>
  );
}
