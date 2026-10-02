/**
 * Excel Import / Export Utilities for VyapaarSetu
 * Handles .xlsx, .xls, .csv generation and parsing with Marathi & English support.
 */

import * as XLSX from 'xlsx';
import { Capacitor } from '@capacitor/core';
import { formatDDMMYYYY } from './dates';
import { downloadFile } from './fileDownloader';

/**
 * Universal Excel workbook saver.
 * On native Android APK (Capacitor), saves as base64 and invokes native share/save sheet.
 * On desktop browser, triggers XLSX.writeFile.
 */
export async function saveWorkbook(wb, filename) {
  if (typeof Capacitor !== 'undefined' && Capacitor.isNativePlatform()) {
    try {
      const base64Data = XLSX.write(wb, { bookType: 'xlsx', type: 'base64' });
      await downloadFile({
        data: base64Data,
        filename,
        mimeType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
        title: `Save ${filename}`,
      });
      return;
    } catch (e) {
      console.warn('Native Excel save failed, falling back to XLSX.writeFile:', e);
    }
  }
  XLSX.writeFile(wb, filename);
}

/**
 * Sanitizes worksheet title according to Microsoft Excel specifications:
 * - Maximum length 31 characters
 * - No forbidden characters: \ / ? * : [ ]
 */
export function sanitizeSheetName(name, fallback = 'Sheet') {
  if (!name) return fallback;
  // Replace slashes with dash (e.g. 12/09/2026 -> 12-09-2026), strip forbidden chars: \ / ? * : [ ]
  let cleaned = String(name).replace(/[\\/]/g, '-').replace(/[?*:[\]]/g, '').replace(/\s+/g, ' ').trim();
  if (cleaned.length > 31) {
    cleaned = cleaned.slice(0, 31).trim();
  }
  return cleaned || fallback;
}

/**
 * Appends a worksheet to a workbook safely enforcing Excel's 31-character limit and uniqueness.
 */
export function appendSheetSafely(wb, ws, name) {
  let safeName = sanitizeSheetName(name);
  if (wb.SheetNames.includes(safeName)) {
    let counter = 1;
    while (wb.SheetNames.includes(safeName.slice(0, 28) + `_${counter}`)) {
      counter++;
    }
    safeName = safeName.slice(0, 28) + `_${counter}`;
  }
  XLSX.utils.book_append_sheet(wb, ws, safeName);
}

// ─── Header Normalizer ────────────────────────────────────────────────────────
function normalizeKey(str) {
  return String(str || '')
    .toLowerCase()
    .replace(/[\s_\-()[\]/\\:]+/g, '')
    .trim();
}

const VEG_HEADER_MAP = {
  name: [
    'name',
    'vegetablename',
    'item',
    'itemname',
    'भाजीचेनाव',
    'भाजीनाव',
    'भाजी',
    'नाव',
    'भाजीचेनावname',
  ],
  rate: [
    'rate',
    'price',
    'rateperunit',
    'दर',
    'भाव',
    'किंमत',
    'दरrate',
  ],
  unit: [
    'unit',
    'एकक',
    'माप',
    'एककunit',
  ],
  search_keywords: [
    'searchkeywords',
    'keywords',
    'aliases',
    'शोधकीवर्ड',
    'पर्यायीनावे',
    'कीवर्ड',
    'शोधकीवर्डsearchkeywords',
  ],
  notes: [
    'notes',
    'note',
    'remark',
    'टिप्पणी',
    'माहिती',
    'टिप्पणीnotes',
  ],
};

const CUSTOMER_HEADER_MAP = {
  name: [
    'name',
    'customername',
    'party',
    'partyname',
    'ग्राहकाचेनाव',
    'ग्राहकनाव',
    'ग्राहक',
    'नाव',
    'ग्राहकाचेनावcustomername',
  ],
  mobile: [
    'mobile',
    'mobilenumber',
    'phone',
    'phonenumber',
    'contact',
    'मोबाईल',
    'मोबाईलक्रमांक',
    'फोन',
    'संपर्क',
    'मोबाईलmobilenumber10digits',
  ],
  address: [
    'address',
    'city',
    'village',
    'पत्ता',
    'गाव',
    'ठिकाण',
    'पत्ताaddress',
  ],
  search_keywords: [
    'searchkeywords',
    'keywords',
    'aliases',
    'alias',
    'nickname',
    'nicknames',
    'शोधकीवर्ड',
    'पर्यायीनावे',
    'टोपणनाव',
    'कीवर्ड',
    'शोधकीवर्डsearchkeywords',
  ],
  opening_balance_date: [
    'openingbalancedate',
    'balancedate',
    'openingdate',
    'date',
    'udhardate',
    'आरंभीचीतारीख',
    'आरंभीचीतारीखopeningdateyyyymmdd',
    'आरंभीचीतारीखopeningdateddmmyyyy',
    'आरंभीचीतारीखopeningdate',
    'सुरुवातीच्याबाकीचीतारीख',
    'सुरुवातीचीतारीख',
    'बाकीतारीख',
    'उधारीतारीख',
    'आरंभीचीबाकीतारीख',
    'तारीख',
    'दिनांक',
  ],
  opening_balance: [
    'openingbalance',
    'openingbalance₹',
    'balance',
    'credit',
    'udhar',
    'आरंभीचीउधारी',
    'आरंभीचीउधारीopeningbalance₹',
    'आरंभीचीउधारीopeningbalance',
    'सुरुवातीचीउधारी',
    'सुरुवातीचीबाकी',
    'आरंभीचीशिल्लक',
    'उधारी',
    'उधारीशिल्लक',
    'शिल्लक',
  ],
  notes: [
    'notes',
    'note',
    'remark',
    'remarks',
    'टिप्पणी',
    'माहिती',
    'टिप्पणीnotes',
  ],
};

function matchField(rawHeader, headerMap) {
  if (!rawHeader) return null;
  const str = String(rawHeader).trim();
  const norm = normalizeKey(str);

  // 1. Direct normalized match against full string
  for (const [field, aliases] of Object.entries(headerMap)) {
    if (aliases.some((alias) => norm === normalizeKey(alias))) {
      return field;
    }
  }

  // 2. Break down bilingual / formatted headers like "आरंभीची तारीख (Opening Date YYYY-MM-DD)" or "दर / Rate (₹)"
  const parts = str.split(/[\(\)\[\]\/|]+/).map((p) => p.trim()).filter(Boolean);
  for (const part of parts) {
    const partNorm = normalizeKey(part);
    if (!partNorm) continue;
    for (const [field, aliases] of Object.entries(headerMap)) {
      if (aliases.some((alias) => partNorm === normalizeKey(alias))) {
        return field;
      }
    }
  }

  // 3. Substring matching (checking if alias is contained in header or any of its segments)
  for (const [field, aliases] of Object.entries(headerMap)) {
    for (const alias of aliases) {
      const aliasNorm = normalizeKey(alias);
      if (aliasNorm.length >= 4) {
        if (norm.includes(aliasNorm) || parts.some((p) => normalizeKey(p).includes(aliasNorm))) {
          return field;
        }
      }
    }
  }

  return null;
}

// ─── Export Functions ─────────────────────────────────────────────────────────

/**
 * Export vegetables array to an Excel (.xlsx) file.
 * @param {Array} vegetables
 * @param {string} [filename]
 */
export function exportVegetablesToExcel(vegetables, filename) {
  const todayStr = new Date().toISOString().slice(0, 10);
  const defaultFilename = `${todayStr}.xlsx`;
  const nameToUse = filename || defaultFilename;

  const rows = [
    [
      'भाजीचे नाव (Name)',
      'दर / Rate (₹)',
      'एकक / Unit',
      'शोध कीवर्ड (Search Keywords)',
      'टिप्पणी / Notes',
    ],
  ];

  vegetables.forEach((v) => {
    rows.push([
      v.name || '',
      Number(v.rate || 0),
      v.unit || 'kg',
      v.search_keywords || '',
      v.notes || '',
    ]);
  });

  const ws = XLSX.utils.aoa_to_sheet(rows);

  // Set column widths
  ws['!cols'] = [
    { wch: 24 }, // Name
    { wch: 14 }, // Rate
    { wch: 12 }, // Unit
    { wch: 30 }, // Search Keywords
    { wch: 24 }, // Notes
  ];

  const wb = XLSX.utils.book_new();
  appendSheetSafely(wb, ws, 'Vegetables');
  return saveWorkbook(wb, nameToUse);
}

/**
 * Export customers array to an Excel (.xlsx) file.
 * @param {Array} customers
 * @param {string} [filename]
 */
export function exportCustomersToExcel(customers, filename) {
  const todayStr = new Date().toISOString().slice(0, 10);
  const defaultFilename = `${todayStr}.xlsx`;
  const nameToUse = filename || defaultFilename;

  const rows = [
    [
      'ग्राहकाचे नाव (Customer Name)',
      'मोबाईल (Mobile Number)',
      'उधारी शिल्लक / Credit (₹)',
      'पत्ता (Address)',
      'शोध कीवर्ड (Search Keywords)',
      'टिप्पणी (Notes)',
      'नोंदणी तारीख (Registered Date)',
    ],
  ];

  customers.forEach((c) => {
    rows.push([
      c.name || '',
      c.mobile || '',
      Number(c.credit_balance || 0),
      c.address || '',
      c.search_keywords || '',
      c.notes || '',
      c.created_at ? new Date(c.created_at).toLocaleDateString('en-IN') : '',
    ]);
  });

  const ws = XLSX.utils.aoa_to_sheet(rows);

  ws['!cols'] = [
    { wch: 26 }, // Name
    { wch: 16 }, // Mobile
    { wch: 18 }, // Credit Balance
    { wch: 26 }, // Address
    { wch: 28 }, // Keywords
    { wch: 22 }, // Notes
    { wch: 18 }, // Registered Date
  ];

  const wb = XLSX.utils.book_new();
  appendSheetSafely(wb, ws, 'Customers');
  return saveWorkbook(wb, nameToUse);
}

/**
 * Generate sample Excel template for Vegetables.
 */
export function generateVegetablesSampleTemplate() {
  const rows = [
    [
      'भाजीचे नाव (Name)',
      'दर / Rate (₹)',
      'एकक / Unit',
      'शोध कीवर्ड (Search Keywords)',
      'टिप्पणी / Notes',
    ],
    ['टोमॅटो', 40, 'kg', 'tomato, tamatar, laal', 'ताजा लाल माल'],
    ['बटाटा', 30, 'kg', 'potato, batata, aloo', 'नवीन बटाटा'],
    ['कांदा', 25, 'kg', 'onion, kanda, pyaj', 'गावरान कांदा'],
    ['कोथिंबीर', 10, 'bundle', 'coriander, kothimbir', 'जुडी'],
    ['शेवगा शेंग', 80, 'kg', 'shevga, drumstick', ''],
    ['आले', 120, 'kg', 'ginger, aale, adrak', ''],
    ['लसूण', 180, 'kg', 'garlic, lasun, lahsun', ''],
    ['हिरवी मिरची', 60, 'kg', 'chilli, mirchi, green chilli', 'तिखट लवंगी'],
  ];

  const ws = XLSX.utils.aoa_to_sheet(rows);
  ws['!cols'] = [
    { wch: 22 },
    { wch: 14 },
    { wch: 12 },
    { wch: 32 },
    { wch: 22 },
  ];

  const wb = XLSX.utils.book_new();
  appendSheetSafely(wb, ws, 'Vegetables_Template');
  return saveWorkbook(wb, 'VyapaarSetu_Vegetables_Template.xlsx');
}

/**
 * Generate sample Excel template for Customers.
 */
export function generateCustomersSampleTemplate() {
  const rows = [
    [
      'ग्राहकाचे नाव (Customer Name)',
      'मोबाईल (Mobile Number - 10 Digits)',
      'पत्ता (Address)',
      'शोध कीवर्ड (Search Keywords)',
      'आरंभीची उधारी (Opening Balance ₹)',
      'आरंभीची तारीख (Opening Date DD/MM/YYYY)',
      'टिप्पणी (Notes)',
    ],
    ['रमेश पाटील', '9876543210', 'हॉटेल निसर्ग, मेन रोड', 'ramu, hotel nisarga', 1500, '01/08/2026', 'नियमित हॉटेल ग्राहक'],
    ['सुरेश जाधव', '9876543211', 'मार्केट यार्ड, पुणे', 'suresh, market yard', 0, '', 'रोख व उधारी'],
    ['गणेश शिंदे', '9876543212', 'कोथरूड', 'ganesh, kothrud', 500, '15/08/2026', ''],
    ['आनंद हॉटेल', '9876543213', 'शिवाजी चौक', 'anand hotel, shivaji chowk', 2400, '10/08/2026', 'आठवड्यातून एकदा हिशोब'],
  ];

  const ws = XLSX.utils.aoa_to_sheet(rows);
  ws['!cols'] = [
    { wch: 26 },
    { wch: 28 },
    { wch: 26 },
    { wch: 28 },
    { wch: 26 },
    { wch: 30 },
    { wch: 24 },
  ];

  const wb = XLSX.utils.book_new();
  appendSheetSafely(wb, ws, 'Customers_Template');
  return saveWorkbook(wb, 'VyapaarSetu_Customers_Template.xlsx');
}

// ─── Import / Parsing Functions ───────────────────────────────────────────────

/**
 * Read File object as ArrayBuffer.
 * @param {File} file
 * @returns {Promise<ArrayBuffer>}
 */
function readFileAsArrayBuffer(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = (e) => resolve(e.target.result);
    reader.onerror = (err) => reject(err);
    reader.readAsArrayBuffer(file);
  });
}

/**
 * Parse an uploaded Excel/CSV file into vegetable records with row-by-row validation.
 * @param {File} file
 * @param {Array} existingVegetables
 * @returns {Promise<{ items: Array, summary: { total: number, valid: number, invalid: number, duplicates: number } }>}
 */
export async function parseVegetablesExcelFile(file, existingVegetables = []) {
  const buffer = await readFileAsArrayBuffer(file);
  const wb = XLSX.read(buffer, { type: 'array' });

  const sheetName = wb.SheetNames[0];
  if (!sheetName) {
    throw new Error('Excel file has no worksheets.');
  }

  const sheet = wb.Sheets[sheetName];
  const rawData = XLSX.utils.sheet_to_json(sheet, { header: 1, defval: '' });

  if (rawData.length < 2) {
    throw new Error('Excel sheet is empty or only contains headers.');
  }

  const headers = rawData[0];
  const fieldMapping = {};

  headers.forEach((h, colIndex) => {
    const matched = matchField(h, VEG_HEADER_MAP);
    if (matched && fieldMapping[matched] === undefined) {
      fieldMapping[matched] = colIndex;
    }
  });

  // Fallback defaults if columns not matched by header names
  if (fieldMapping.name === undefined) fieldMapping.name = 0;
  if (fieldMapping.rate === undefined) fieldMapping.rate = 1;
  if (fieldMapping.unit === undefined) fieldMapping.unit = 2;
  if (fieldMapping.search_keywords === undefined) fieldMapping.search_keywords = 3;
  if (fieldMapping.notes === undefined) fieldMapping.notes = 4;

  const existingNamesMap = new Set(
    existingVegetables.map((v) => (v.name || '').trim().toLowerCase())
  );

  const items = [];
  let validCount = 0;
  let invalidCount = 0;
  let duplicateCount = 0;

  for (let i = 1; i < rawData.length; i++) {
    const row = rawData[i];
    // Skip completely empty rows
    if (!row || row.every((cell) => String(cell).trim() === '')) {
      continue;
    }

    const rawName = String(row[fieldMapping.name] ?? '').trim();
    const rawRate = row[fieldMapping.rate];
    const rawUnit = String(row[fieldMapping.unit] ?? '').trim();
    const rawKeywords = String(row[fieldMapping.search_keywords] ?? '').trim();
    const rawNotes = String(row[fieldMapping.notes] ?? '').trim();

    const rowErrors = [];

    if (!rawName) {
      rowErrors.push('Vegetable name is required');
    }

    const rateNum = parseFloat(rawRate);
    if (rawRate === undefined || rawRate === null || rawRate === '' || isNaN(rateNum) || rateNum < 0) {
      rowErrors.push('Valid rate (₹ 0 or more) is required');
    }

    const isExisting = rawName ? existingNamesMap.has(rawName.toLowerCase()) : false;
    if (isExisting) duplicateCount++;

    const isValid = rowErrors.length === 0;
    if (isValid) validCount++;
    else invalidCount++;

    items.push({
      rowIndex: i + 1,
      name: rawName,
      rate: isNaN(rateNum) ? 0 : rateNum,
      unit: rawUnit || 'kg',
      search_keywords: rawKeywords,
      notes: rawNotes,
      isValid,
      isExisting,
      errors: rowErrors,
    });
  }

  return {
    items,
    summary: {
      total: items.length,
      valid: validCount,
      invalid: invalidCount,
      duplicates: duplicateCount,
    },
  };
}

/**
 * Parse a raw date value from an Excel cell into YYYY-MM-DD.
 */
export function parseExcelDate(rawVal) {
  if (rawVal === undefined || rawVal === null || String(rawVal).trim() === '') {
    return null;
  }
  if (rawVal instanceof Date && !isNaN(rawVal.getTime())) {
    const y = rawVal.getFullYear();
    const m = String(rawVal.getMonth() + 1).padStart(2, '0');
    const d = String(rawVal.getDate()).padStart(2, '0');
    return `${y}-${m}-${d}`;
  }
  // Excel serial date number
  if (typeof rawVal === 'number' && rawVal > 0) {
    const d = new Date(Math.round((rawVal - 25569) * 86400 * 1000));
    if (!isNaN(d.getTime())) {
      const y = d.getUTCFullYear();
      const m = String(d.getUTCMonth() + 1).padStart(2, '0');
      const day = String(d.getUTCDate()).padStart(2, '0');
      return `${y}-${m}-${day}`;
    }
  }
  const str = String(rawVal).trim();
  // YYYY-MM-DD or YYYY/MM/DD
  if (/^\d{4}[-/]\d{1,2}[-/]\d{1,2}$/.test(str)) {
    const parts = str.split(/[-/]/);
    const y = parts[0];
    const m = parts[1].padStart(2, '0');
    const d = parts[2].padStart(2, '0');
    return `${y}-${m}-${d}`;
  }
  // DD-MM-YYYY or DD/MM/YYYY
  if (/^\d{1,2}[-/]\d{1,2}[-/]\d{4}$/.test(str)) {
    const parts = str.split(/[-/]/);
    const d = parts[0].padStart(2, '0');
    const m = parts[1].padStart(2, '0');
    const y = parts[2];
    return `${y}-${m}-${d}`;
  }
  const parsed = new Date(str);
  if (!isNaN(parsed.getTime())) {
    const y = parsed.getFullYear();
    const m = String(parsed.getMonth() + 1).padStart(2, '0');
    const d = String(parsed.getDate()).padStart(2, '0');
    return `${y}-${m}-${d}`;
  }
  return null;
}

/**
 * Parse uploaded Excel file for Customer Import.
 * @param {File} file
 * @param {Array} existingCustomers
 * @returns {Promise<{ items: Array, summary: Object }>}
 */
export async function parseCustomersExcelFile(file, existingCustomers = []) {
  const buffer = await readFileAsArrayBuffer(file);
  const wb = XLSX.read(buffer, { type: 'array' });

  const sheetName = wb.SheetNames[0];
  if (!sheetName) {
    throw new Error('Excel file has no worksheets.');
  }

  const sheet = wb.Sheets[sheetName];
  const rawData = XLSX.utils.sheet_to_json(sheet, { header: 1, defval: '' });

  if (rawData.length < 2) {
    throw new Error('Excel sheet is empty or only contains headers.');
  }

  const headers = rawData[0];
  const fieldMapping = {};

  headers.forEach((h, colIndex) => {
    const matched = matchField(h, CUSTOMER_HEADER_MAP);
    if (matched && fieldMapping[matched] === undefined) {
      fieldMapping[matched] = colIndex;
    }
  });

  if (fieldMapping.name === undefined) fieldMapping.name = 0;
  if (fieldMapping.mobile === undefined) fieldMapping.mobile = 1;
  if (fieldMapping.address === undefined) fieldMapping.address = 2;
  if (fieldMapping.opening_balance === undefined) fieldMapping.opening_balance = 3;
  if (fieldMapping.opening_balance_date === undefined && headers.length >= 6) {
    fieldMapping.opening_balance_date = 4;
  }
  if (fieldMapping.notes === undefined) {
    // If opening_balance_date was mapped to col 4, notes is col 5
    if (fieldMapping.opening_balance_date === 4 || headers.length >= 6) {
      fieldMapping.notes = 5;
    } else {
      fieldMapping.notes = 4;
    }
  }

  const existingMobilesMap = new Set(
    existingCustomers
      .filter((c) => c.mobile && String(c.mobile).trim())
      .map((c) => String(c.mobile).trim())
  );
  const existingNamesMap = new Set(
    existingCustomers
      .filter((c) => c.name && String(c.name).trim())
      .map((c) => String(c.name).trim().toLowerCase())
  );

  const seenInFileMobiles = new Set();
  const seenInFileNames = new Set();

  const items = [];
  let validCount = 0;
  let invalidCount = 0;
  let duplicateCount = 0;

  for (let i = 1; i < rawData.length; i++) {
    const row = rawData[i];
    if (!row || row.every((cell) => String(cell).trim() === '')) {
      continue;
    }

    const rawName = String(row[fieldMapping.name] ?? '').trim();
    // Clean mobile number (remove spaces, dashes, +91, leading zero if 11 digits)
    let rawMobile = String(row[fieldMapping.mobile] ?? '').replace(/\D/g, '');
    if (rawMobile.length === 12 && rawMobile.startsWith('91')) {
      rawMobile = rawMobile.slice(2);
    } else if (rawMobile.length === 11 && rawMobile.startsWith('0')) {
      rawMobile = rawMobile.slice(1);
    }
    const rawAddress = String(row[fieldMapping.address] ?? '').trim();
    const rawKeywords = fieldMapping.search_keywords !== undefined ? String(row[fieldMapping.search_keywords] ?? '').trim() : '';
    const rawNotes = String(row[fieldMapping.notes] ?? '').trim();
    const rawOpening = row[fieldMapping.opening_balance];
    const rawOpeningDate = fieldMapping.opening_balance_date !== undefined ? row[fieldMapping.opening_balance_date] : null;
    const openingBalanceDate = parseExcelDate(rawOpeningDate);

    const rowErrors = [];

    if (!rawName) {
      rowErrors.push('Customer name is required');
    }

    if (rawMobile && !/^\d{10}$/.test(rawMobile)) {
      rowErrors.push('Mobile must be 10 digits if provided');
    }

    let openingBalance = 0;
    if (rawOpening !== undefined && rawOpening !== null && String(rawOpening).trim() !== '') {
      const parsed = parseFloat(rawOpening);
      if (isNaN(parsed) || parsed < 0) {
        rowErrors.push('Opening balance must be 0 or more');
      } else {
        openingBalance = parsed;
      }
    }

    const lowerName = rawName.toLowerCase();
    const isExisting = (rawMobile && existingMobilesMap.has(rawMobile)) ||
                       (lowerName && existingNamesMap.has(lowerName)) ||
                       (rawMobile && seenInFileMobiles.has(rawMobile)) ||
                       (lowerName && seenInFileNames.has(lowerName));

    if (rawMobile) seenInFileMobiles.add(rawMobile);
    if (lowerName) seenInFileNames.add(lowerName);

    if (isExisting) duplicateCount++;

    const isValid = rowErrors.length === 0;
    if (isValid) validCount++;
    else invalidCount++;

    items.push({
      rowIndex: i + 1,
      name: rawName,
      mobile: rawMobile,
      address: rawAddress,
      search_keywords: rawKeywords,
      notes: rawNotes,
      opening_balance: openingBalance,
      opening_balance_date: openingBalanceDate,
      isValid,
      isExisting,
      errors: rowErrors,
    });
  }

  return {
    items,
    summary: {
      total: items.length,
      valid: validCount,
      invalid: invalidCount,
      duplicates: duplicateCount,
    },
  };
}


/**
 * Export All-In-One Master Business Record to a comprehensive multi-tab Excel Workbook (.xlsx)
 * @param {Object} reportData Data from /api/reports/all-in-one
 * @param {string} [filename]
 */
export function exportAllInOneReportToExcel(reportData, filename) {
  if (!reportData) return;

  const shop = reportData.shop || {};
  const summary = reportData.summary || {};
  const bills = reportData.bills || [];
  const customers = reportData.customers || [];
  const creditLedger = reportData.credit_ledger || [];
  const vegSales = reportData.vegetable_sales || [];
  const vegCatalog = reportData.vegetable_catalog || [];
  const meta = reportData.meta || {};

  const todayStr = new Date().toISOString().slice(0, 10);
  const defaultFilename = meta.start_date && meta.end_date
    ? `${meta.start_date}_to_${meta.end_date}.xlsx`
    : `${todayStr}.xlsx`;
  const nameToUse = filename || defaultFilename;

  const wb = XLSX.utils.book_new();

  // ─── Sheet 1: 📊 Executive Summary ──────────────────────────────────────────
  const summaryRows = [
    ['=== VYAPAARSETU BUSINESS MASTER RECORD / व्यापारी अहवाल ==='],
    ['दुकान / व्यवसाय (Shop Name)', shop.vendor_name || 'VyapaarSetu Store'],
    ['टॅगलाइन (Tagline)', shop.tagline || 'भाजीपाला व फळे अडतदार'],
    ['मालक (Owner / Proprietor)', shop.owner_name || ''],
    ['मोबाईल क्रमांक (Mobile)', shop.mobile_number || ''],
    ['दुसरा मोबाईल / WhatsApp', shop.secondary_mobile || ''],
    ['मार्केट / बाजार समिती', shop.market_name || ''],
    ['गाळा नं. (Gala No)', shop.gala_number || ''],
    ['पत्ता (Address)', `${shop.address || ''} ${shop.city || ''}`.trim()],
    ['अहवाल कालावधी (Period)', meta.period_label || 'All-Time'],
    ['अहवाल तयार तारीख (Generated Date)', new Date().toLocaleString('en-IN')],
    [],
    ['=== मुख्य आर्थिक व व्यापार निर्देशक (KEY FINANCIAL KPIS) ===', ''],
    ['एकूण बिले संख्या (Total Invoices Count)', Number(summary.total_bills || 0)],
    ['एकूण विक्री रक्कम / ग्रॉस (Total Gross Sales ₹)', Number(summary.total_subtotal || 0)],
    ['एकूण सूट (Total Discount Given ₹)', Number(summary.total_discount || 0)],
    ['एकूण निव्वळ विक्री (Total Net Sales ₹)', Number(summary.total_sales || 0)],
    ['एकूण जमा रक्कम (Total Amount Collected ₹)', Number(summary.total_paid || 0)],
    ['  - रोख जमा (Cash Collection ₹)', Number(summary.cash_collection || 0)],
    ['  - UPI जमा (UPI Collection ₹)', Number(summary.upi_collection || 0)],
    ['कालावधीतील उधारी विक्री (Period Credit Sales ₹)', Number(summary.credit_sales || 0)],
    ['एकूण चालू उधारी शिल्लक (Total Outstanding Dues ₹)', Number(summary.total_credit_outstanding || 0)],
    ['एकूण कमिशन उत्पन्न (Total Commission Earned ₹)', Number(summary.total_commission || 0)],
    ['एकूण नोंदणीकृत ग्राहक (Active Customers Count)', Number(summary.total_customers_count || customers.length)],
    ['भाजीपाला कॅटलॉग वस्तू (Vegetable Catalog Items)', Number(summary.total_vegetables_count || vegCatalog.length)],
    ['विक्री झालेले एकूण प्रमाण (Total Volume Sold)', Number(summary.total_vegetables_volume || 0)],
  ];

  const wsSummary = XLSX.utils.aoa_to_sheet(summaryRows);
  wsSummary['!cols'] = [{ wch: 48 }, { wch: 32 }];
  appendSheetSafely(wb, wsSummary, 'Executive Summary');

  // ─── Sheet 2: 🧾 Bills & Invoices ───────────────────────────────────────────
  const billRows = [
    [
      'बिल नं. (Bill No)',
      'दिनांक (Date)',
      'ग्राहकाचे नाव (Customer Name)',
      'मोबाईल (Mobile)',
      'पत्ता (Address)',
      'वस्तू तपशील (Items Summary)',
      'वस्तू संख्या (Item Count)',
      'उप-एकूण / Subtotal (₹)',
      'सूट / Discount (₹)',
      'कमिशन / Commission (₹)',
      'एकूण देय रक्कम / Grand Total (₹)',
      'भरलेली रक्कम / Paid (₹)',
      'उधारी शिल्लक / Remaining (₹)',
      'स्थिती / Payment Status',
      'पेमेंट प्रकार / Mode',
    ],
  ];

  bills.forEach((b) => {
    billRows.push([
      b.bill_number || `BILL-#${b.id}`,
      b.date ? new Date(b.date).toLocaleDateString('en-IN') : '',
      b.customer_name || '',
      b.customer_mobile || '',
      b.customer_address || '',
      b.items_summary || (b.items ? b.items.map((i) => `${i.vegetable_name} (${i.quantity} ${i.vegetable_unit || 'kg'} @ ₹${i.rate})`).join(', ') : ''),
      b.items ? b.items.length : 0,
      Number(b.subtotal || 0),
      Number(b.discount_amount || 0),
      Number(b.commission_amount || 0),
      Number(b.final_amount || 0),
      Number(b.paid_amount || 0),
      Number(b.remaining_amount || 0),
      b.payment_status || 'Paid',
      b.payment_type || 'Cash',
    ]);
  });

  const wsBills = XLSX.utils.aoa_to_sheet(billRows);
  wsBills['!cols'] = [
    { wch: 18 }, // Bill No
    { wch: 14 }, // Date
    { wch: 24 }, // Customer Name
    { wch: 15 }, // Mobile
    { wch: 22 }, // Address
    { wch: 45 }, // Items Summary
    { wch: 12 }, // Item Count
    { wch: 16 }, // Subtotal
    { wch: 14 }, // Discount
    { wch: 16 }, // Commission
    { wch: 14 }, // Hamali
    { wch: 14 }, // Transport
    { wch: 18 }, // Grand Total
    { wch: 16 }, // Paid
    { wch: 16 }, // Remaining
    { wch: 16 }, // Status
    { wch: 14 }, // Mode
  ];
  appendSheetSafely(wb, wsBills, 'Invoices & Bills');

  // ─── Sheet 3: 👥 Customers & Credit ─────────────────────────────────────────
  const customerRows = [
    [
      'ग्राहक क्रमांक (Customer ID)',
      'ग्राहकाचे नाव (Customer Name)',
      'मोबाईल नंबर (Mobile Number)',
      'पत्ता (Address / Village)',
      'कालावधीतील बिले (Invoices Count)',
      'एकूण खरेदी / Total Purchases (₹)',
      'एकूण जमा / Total Paid (₹)',
      'चालू उधारी शिल्लक / Outstanding Dues (₹)',
      'नोंदणी दिनांक (Registered Date)',
      'टिप्पणी (Notes)',
    ],
  ];

  customers.forEach((c) => {
    customerRows.push([
      `CUST-#${c.id}`,
      c.name || '',
      c.mobile || '',
      c.address || '',
      Number(c.total_bills || 0),
      Number(c.total_purchases || 0),
      Number(c.total_paid || 0),
      Number(c.current_credit_balance || 0),
      c.created_at ? new Date(c.created_at).toLocaleDateString('en-IN') : '',
      c.notes || '',
    ]);
  });

  const wsCustomers = XLSX.utils.aoa_to_sheet(customerRows);
  wsCustomers['!cols'] = [
    { wch: 16 },
    { wch: 26 },
    { wch: 16 },
    { wch: 26 },
    { wch: 16 },
    { wch: 20 },
    { wch: 18 },
    { wch: 24 },
    { wch: 16 },
    { wch: 24 },
  ];
  appendSheetSafely(wb, wsCustomers, 'Customer Ledger');

  // ─── Sheet 4: 💰 Payment & Credit Ledger ────────────────────────────────────
  const ledgerRows = [
    [
      'नोंद क्रमांक (Txn ID)',
      'तारीख व वेळ (Date & Time)',
      'ग्राहकाचे नाव (Customer Name)',
      'मोबाईल (Mobile)',
      'व्यवहार प्रकार (Type)',
      'रक्कम / Amount (₹)',
      'पेमेंट मार्ग (Payment Mode)',
      'व्यवहारानंतर शिल्लक / Balance After (₹)',
      'संबंधित बिल नं. (Bill Ref)',
      'टिप्पणी / Note',
    ],
  ];

  creditLedger.forEach((r) => {
    ledgerRows.push([
      `TXN-#${r.id}`,
      r.created_at ? new Date(r.created_at).toLocaleString('en-IN') : '',
      r.customer_name || '',
      r.customer_mobile || '',
      r.transaction_type === 'PAYMENT_RECEIVED'
        ? 'जमा / Payment Received'
        : r.transaction_type === 'CREDIT_ADDED'
        ? 'उधारी / Credit Given'
        : r.transaction_type === 'OPENING_BALANCE'
        ? 'आरंभीची उधारी / Opening Balance'
        : r.transaction_type,
      Number(r.amount || 0),
      r.payment_mode || 'Cash',
      Number(r.balance_after_transaction || 0),
      r.bill_number || (r.bill_id ? `BILL-#${r.bill_id}` : ''),
      r.note || '',
    ]);
  });

  const wsLedger = XLSX.utils.aoa_to_sheet(ledgerRows);
  wsLedger['!cols'] = [
    { wch: 14 },
    { wch: 22 },
    { wch: 24 },
    { wch: 16 },
    { wch: 24 },
    { wch: 16 },
    { wch: 16 },
    { wch: 22 },
    { wch: 18 },
    { wch: 26 },
  ];
  appendSheetSafely(wb, wsLedger, 'Passbook & Payments');

  // ─── Sheet 5: 🥕 Vegetable Sales Breakdown ──────────────────────────────────
  const vegSalesRows = [
    [
      'भाजीचे नाव (Vegetable Name)',
      'एकक / Unit',
      'विक्री प्रमाण / Total Volume Sold',
      'एकूण महसूल / Total Revenue (₹)',
      'बिलांची संख्या / Invoices Count',
      'सरासरी दर / Average Rate (₹)',
    ],
  ];

  vegSales.forEach((v) => {
    vegSalesRows.push([
      v.vegetable_name || '',
      v.vegetable_unit || 'kg',
      Number(v.total_quantity || 0),
      Number(v.total_sales || 0),
      Number(v.total_bills || 0),
      Number(v.average_rate || (v.total_quantity > 0 ? (v.total_sales / v.total_quantity).toFixed(2) : 0)),
    ]);
  });

  const wsVegSales = XLSX.utils.aoa_to_sheet(vegSalesRows);
  wsVegSales['!cols'] = [
    { wch: 26 },
    { wch: 12 },
    { wch: 20 },
    { wch: 20 },
    { wch: 18 },
    { wch: 18 },
  ];
  appendSheetSafely(wb, wsVegSales, 'Vegetable Sales');

  // ─── Sheet 6: 🥬 Vegetables Catalog ─────────────────────────────────────────
  const catalogRows = [
    [
      'क्रमांक (ID)',
      'भाजीचे नाव (Vegetable Name)',
      'चालू दर / Current Rate (₹)',
      'एकक / Unit',
      'शोध कीवर्ड (Search Keywords)',
      'टिप्पणी (Notes)',
    ],
  ];

  vegCatalog.forEach((v) => {
    catalogRows.push([
      `VEG-#${v.id}`,
      v.name || '',
      Number(v.rate || 0),
      v.unit || 'kg',
      v.search_keywords || '',
      v.notes || '',
    ]);
  });

  const wsCatalog = XLSX.utils.aoa_to_sheet(catalogRows);
  wsCatalog['!cols'] = [
    { wch: 12 },
    { wch: 26 },
    { wch: 16 },
    { wch: 12 },
    { wch: 32 },
    { wch: 24 },
  ];
  appendSheetSafely(wb, wsCatalog, 'Price Catalog');

  // Write and download Excel workbook
  return saveWorkbook(wb, nameToUse);
}

function getDayNameMarathi(dateStr) {
  if (!dateStr) return '';
  const d = new Date(dateStr);
  if (isNaN(d.getTime())) return '';
  const days = ['रविवार', 'सोमवार', 'मंगळवार', 'बुधवार', 'गुरुवार', 'शुक्रवार', 'शनिवार'];
  return days[d.getDay()] || '';
}

/**
 * Dedicated Customer-Wise Daily & Range Report Excel Exporter
 * Generates datewise partitioned sales sheets + customer itemized breakdown + day-by-day summary + customer summary + KPIs sheet
 *
 * @param {Object} reportData Data from /api/reports/daily or /api/reports/sales-range
 * @param {string} [selectedDate]
 */
export function exportDailyReportToExcel(reportData, selectedDate) {
  if (!reportData) return;

  const shop = reportData.shop || {};
  const summary = reportData.summary || {};
  const customers = reportData.customers || [];
  const dateStr = selectedDate || reportData.meta?.startDate || new Date().toISOString().slice(0, 10);

  const wb = XLSX.utils.book_new();

  // 1. Gather all transactions across all customers with their dates
  const allTransactions = [];
  customers.forEach((c) => {
    (c.items || []).forEach((it) => {
      const txDate = it.transaction_date || reportData.meta?.startDate || dateStr;
      allTransactions.push({
        customer_id: c.customer_id,
        customer_name: c.customer_name,
        customer_mobile: c.customer_mobile || '-',
        vegetable_name: it.vegetable_name || '-',
        weight: Number(it.weight || 0),
        unit: it.unit || 'kg',
        rate: Number(it.rate || 0),
        base_amount: Number(it.base_amount || 0),
        commission_rate: Number(it.commission_rate || 8),
        commission_amount: Number(it.commission_amount || 0),
        final_amount: Number(it.final_amount || it.base_amount || 0),
        payment_type: it.payment_type || 'Credit',
        bill_number: it.bill_number || '-',
        transaction_date: txDate,
      });
    });
  });

  // ─── Sheet 1: 📅 तारीखनिहाय विक्री अहवाल (Datewise Sales & Transactions) ─────
  const datewiseRows = [
    [`${shop.vendor_name || 'व्यापारसेतू'} - तारीखनिहाय भाजीपाला विक्री अहवाल`],
    [`कालावधी (Period): ${dateStr.includes('_to_') ? dateStr.replace('_to_', ' ते ') : formatDDMMYYYY(dateStr)} | मालक: ${shop.owner_name || ''} | संपर्क: ${shop.mobile_number || ''}`],
    [],
  ];

  // Group transactions by date
  const txByDate = {};
  allTransactions.forEach((tx) => {
    const d = tx.transaction_date || dateStr;
    if (!txByDate[d]) txByDate[d] = [];
    txByDate[d].push(tx);
  });

  const sortedDates = Object.keys(txByDate).sort();

  let grandTotalWeight = 0;
  let grandTotalBase = 0;
  let grandTotalFinal = 0;

  if (sortedDates.length === 0) {
    datewiseRows.push(['या कालावधीत कोणतीही विक्री नोंदवलेली नाही (No transactions found in this period)']);
  } else {
    sortedDates.forEach((d) => {
      const txs = txByDate[d] || [];
      const dayWeight = txs.reduce((sum, tx) => sum + tx.weight, 0);
      const dayBase = txs.reduce((sum, tx) => sum + tx.base_amount, 0);
      const dayFinal = txs.reduce((sum, tx) => sum + tx.final_amount, 0);

      grandTotalWeight += dayWeight;
      grandTotalBase += dayBase;
      grandTotalFinal += dayFinal;

      const dayName = getDayNameMarathi(d);

      // Date Partition Section Header
      datewiseRows.push([
        `📅 दिनांक: ${formatDDMMYYYY(d)} (${dayName || 'Date: ' + d}) | एकूण व्यवहार: ${txs.length} | एकूण विक्री: ₹ ${dayFinal.toFixed(2)}`,
      ]);

      // Table Headers for this Date
      datewiseRows.push([
        'अ.क्र (Sr)',
        'दिनांक (Date)',
        'ग्राहकाचे नाव (Customer Name)',
        'मोबाईल (Mobile)',
        'भाजीपाला (Vegetable)',
        'प्रमाण / वजन (Qty/Weight)',
        'दर / Rate (₹)',
        'रक्कम / Amount (₹)',
        'पावती क्र. (Bill No)',
        'पेमेंट प्रकार (Payment)',
      ]);

      txs.forEach((tx, idx) => {
        datewiseRows.push([
          idx + 1,
          formatDDMMYYYY(tx.transaction_date),
          tx.customer_name,
          tx.customer_mobile,
          tx.vegetable_name,
          `${tx.weight} ${tx.unit}`,
          tx.rate,
          tx.base_amount,
          tx.bill_number,
          tx.payment_type,
        ]);
      });

      // Subtotal for this Date
      datewiseRows.push([
        `एकूण (${formatDDMMYYYY(d)})`,
        formatDDMMYYYY(d),
        `${new Set(txs.map((t) => t.customer_name)).size} ग्राहक`,
        '',
        `${txs.length} नोंदी`,
        `${Number(dayWeight.toFixed(2))} kg`,
        '',
        Number(dayBase.toFixed(2)),
        '',
        '',
      ]);

      // Empty separator row between date partitions
      datewiseRows.push([]);
    });

    // Grand Total Row across all dates
    datewiseRows.push([
      '=== सर्व दिवसांची एकूण विक्री (Grand Total) ===',
      `${sortedDates.length} दिवस (Days)`,
      `${customers.length} एकूण ग्राहक`,
      '',
      `${allTransactions.length} एकूण व्यवहार`,
      `${Number(grandTotalWeight.toFixed(2))} kg`,
      '',
      Number(grandTotalBase.toFixed(2)),
      '',
      '',
    ]);
  }

  const wsDatewise = XLSX.utils.aoa_to_sheet(datewiseRows);
  wsDatewise['!cols'] = [
    { wch: 8 },  // Sr
    { wch: 14 }, // Date
    { wch: 24 }, // Customer Name
    { wch: 15 }, // Mobile
    { wch: 22 }, // Vegetable
    { wch: 16 }, // Qty/Weight
    { wch: 12 }, // Rate
    { wch: 14 }, // Amount
    { wch: 15 }, // Bill No
    { wch: 15 }, // Payment Type
  ];
  const sheet1Name = sanitizeSheetName(dateStr.includes('_to_') ? dateStr.replace('_to_', ' to ') : dateStr);
  appendSheetSafely(wb, wsDatewise, sheet1Name);

  // ─── Sheet 2: 👥 ग्राहकनिहाय दैनिक खरेदी व उधारी (Customer Detailed Purchases) ─
  const detailRows = [
    [`${shop.vendor_name || 'व्यापारसेतू'} - ग्राहकनिहाय खरेदी, बिल व उधारी अहवाल`],
    [`कालावधी (Period): ${dateStr.includes('_to_') ? dateStr.replace('_to_', ' ते ') : formatDDMMYYYY(dateStr)} | मालक: ${shop.owner_name || ''} | संपर्क: ${shop.mobile_number || ''}`],
    [],
    [
      'अ.क्र (Sr)',
      'दिनांक (Date)',
      'ग्राहकाचे नाव (Customer Name)',
      'मोबाईल (Mobile)',
      'भाजीपाला (Vegetable)',
      'प्रमाण / वजन (Qty/Weight)',
      'दर / Rate (₹)',
      'रक्कम / Amount (₹)',
      'आजचे बिल / Today Bill (₹)',
      'मागील बाकी / Prev Udhar (₹)',
      'एकूण देय / Total Due (₹)',
      'आज जमा / Paid Today (₹)',
      'चालू बाकी / Closing Udhar (₹)',
      'पावती क्र. (Bill No)',
    ],
  ];

  let totalItemsAmount = 0;
  let totalBillsAmount = 0;
  let totalPaidAmount = 0;
  let totalClosingUdhar = 0;

  let rowIdx = 1;
  customers.forEach((c) => {
    // Sort customer items by transaction_date so their purchases are ordered day-by-day
    const items = [...(c.items || [])].sort((a, b) => {
      const da = a.transaction_date || '';
      const db = b.transaction_date || '';
      return da.localeCompare(db);
    });

    const totalDue = Number((c.previous_balance + c.today_bill_total).toFixed(2));
    totalBillsAmount += c.today_bill_total;
    totalPaidAmount += c.today_paid;
    totalClosingUdhar += c.closing_balance;

    if (items.length === 0) {
      detailRows.push([
        rowIdx++,
        formatDDMMYYYY(dateStr.split('_to_')[0]),
        c.customer_name,
        c.customer_mobile || '-',
        '— (फक्त जमा/बाकी नोंद)',
        '-',
        '-',
        0,
        c.today_bill_total,
        c.previous_balance,
        totalDue,
        c.today_paid,
        c.closing_balance,
        c.bill_numbers?.join(', ') || '-',
      ]);
    } else {
      items.forEach((it, itIdx) => {
        totalItemsAmount += it.base_amount || 0;
        const itemDateFormatted = it.transaction_date ? formatDDMMYYYY(it.transaction_date) : formatDDMMYYYY(dateStr.split('_to_')[0]);
        detailRows.push([
          itIdx === 0 ? rowIdx++ : '',
          itemDateFormatted,
          itIdx === 0 ? c.customer_name : '',
          itIdx === 0 ? (c.customer_mobile || '-') : '',
          it.vegetable_name || '-',
          `${it.weight || 0} ${it.unit || 'kg'}`,
          it.rate || 0,
          it.base_amount || 0,
          itIdx === 0 ? c.today_bill_total : '',
          itIdx === 0 ? c.previous_balance : '',
          itIdx === 0 ? totalDue : '',
          itIdx === 0 ? c.today_paid : '',
          itIdx === 0 ? c.closing_balance : '',
          it.bill_number || '-',
        ]);
      });
    }
  });

  detailRows.push([]);
  detailRows.push([
    'एकूण (Grand Total)',
    '',
    `${customers.length} ग्राहक (Customers)`,
    '',
    '',
    '',
    '',
    Number(totalItemsAmount.toFixed(2)),
    Number(totalBillsAmount.toFixed(2)),
    '',
    '',
    Number(totalPaidAmount.toFixed(2)),
    Number(totalClosingUdhar.toFixed(2)),
    '',
  ]);

  const wsDetail = XLSX.utils.aoa_to_sheet(detailRows);
  wsDetail['!cols'] = [
    { wch: 8 },  // Sr
    { wch: 14 }, // Date
    { wch: 22 }, // Customer Name
    { wch: 14 }, // Mobile
    { wch: 20 }, // Vegetable
    { wch: 16 }, // Qty/Weight
    { wch: 12 }, // Rate
    { wch: 14 }, // Amount
    { wch: 16 }, // Today's Bill
    { wch: 16 }, // Prev Udhar
    { wch: 14 }, // Total Due
    { wch: 14 }, // Paid Today
    { wch: 18 }, // Closing Udhar
    { wch: 14 }, // Bill No
  ];
  appendSheetSafely(wb, wsDetail, 'Customer Sales');

  // ─── Sheet 3: 📊 दैनिक गोषवारा (Day-by-Day Summary) ─────────────────────────
  const daySummaryRows = [
    [`${shop.vendor_name || 'व्यापारसेतू'} - दैनिक गोषवारा (Day-by-Day Summary)`],
    [`कालावधी (Period): ${dateStr.includes('_to_') ? dateStr.replace('_to_', ' ते ') : formatDDMMYYYY(dateStr)}`],
    [],
    [
      'अ.क्र (Sr)',
      'दिनांक (Date)',
      'वार (Day)',
      'सक्रिय ग्राहक (Active Customers)',
      'एकूण प्रमाण (Volume)',
      'भाजीपाला खरेदी / Base (₹)',
      'कमिशन / Comm (₹)',
      'एकूण विक्री / Net Total (₹)',
    ],
  ];

  let sumDayVol = 0, sumDayBase = 0, sumDayComm = 0, sumDayFinal = 0;
  sortedDates.forEach((d, idx) => {
    const txs = txByDate[d] || [];
    const vol = txs.reduce((sum, tx) => sum + tx.weight, 0);
    const base = txs.reduce((sum, tx) => sum + tx.base_amount, 0);
    const comm = txs.reduce((sum, tx) => sum + tx.commission_amount, 0);
    const final = txs.reduce((sum, tx) => sum + tx.final_amount, 0);
    const uniqueCustCount = new Set(txs.map((tx) => tx.customer_id)).size;

    sumDayVol += vol;
    sumDayBase += base;
    sumDayComm += comm;
    sumDayFinal += final;

    daySummaryRows.push([
      idx + 1,
      formatDDMMYYYY(d),
      getDayNameMarathi(d),
      uniqueCustCount,
      `${vol.toFixed(2)} kg`,
      Number(base.toFixed(2)),
      Number(comm.toFixed(2)),
      Number(final.toFixed(2)),
    ]);
  });

  daySummaryRows.push([]);
  daySummaryRows.push([
    'एकूण (Total)',
    `${sortedDates.length} दिवस`,
    '',
    `${customers.length} ग्राहक`,
    `${sumDayVol.toFixed(2)} kg`,
    Number(sumDayBase.toFixed(2)),
    Number(sumDayComm.toFixed(2)),
    Number(sumDayFinal.toFixed(2)),
  ]);

  const wsDaySummary = XLSX.utils.aoa_to_sheet(daySummaryRows);
  wsDaySummary['!cols'] = [
    { wch: 8 },  // Sr
    { wch: 14 }, // Date
    { wch: 14 }, // Day
    { wch: 20 }, // Customers
    { wch: 18 }, // Volume
    { wch: 20 }, // Base
    { wch: 16 }, // Comm
    { wch: 20 }, // Net Total
  ];
  appendSheetSafely(wb, wsDaySummary, 'Day Summary');

  // ─── Sheet 4: 📋 ग्राहक गोषवारा (Customer Summary) ───────────────────────────
  const summaryRows = [
    [`${shop.vendor_name || 'व्यापारसेतू'} - ग्राहकनिहाय गोषवारा`],
    [`कालावधी (Period): ${dateStr.includes('_to_') ? dateStr.replace('_to_', ' ते ') : formatDDMMYYYY(dateStr)}`],
    [],
    [
      'अ.क्र (Sr)',
      'ग्राहकाचे नाव (Customer Name)',
      'मोबाईल (Mobile)',
      'वस्तू संख्या (Item Count)',
      'खरेदी रक्कम / Base (₹)',
      'कमिशन / Comm (₹)',
      'बिल रक्कम / Bill (₹)',
      'मागील बाकी / Prev Udhar (₹)',
      'एकूण देय / Total Due (₹)',
      'जमा रक्कम / Paid (₹)',
      'चालू बाकी / Closing Udhar (₹)',
    ],
  ];

  let sumBase = 0, sumComm = 0, sumBills = 0, sumPaid = 0, sumClosing = 0;
  customers.forEach((c, idx) => {
    sumBase += c.today_base_purchase || 0;
    sumComm += c.today_commission || 0;
    sumBills += c.today_bill_total || 0;
    sumPaid += c.today_paid || 0;
    sumClosing += c.closing_balance || 0;

    summaryRows.push([
      idx + 1,
      c.customer_name,
      c.customer_mobile || '-',
      c.items?.length || 0,
      c.today_base_purchase || 0,
      c.today_commission || 0,
      c.today_bill_total || 0,
      c.previous_balance || 0,
      Number((c.previous_balance + c.today_bill_total).toFixed(2)),
      c.today_paid || 0,
      c.closing_balance || 0,
    ]);
  });

  summaryRows.push([]);
  summaryRows.push([
    'एकूण (Total)',
    `${customers.length} ग्राहक`,
    '',
    '',
    Number(sumBase.toFixed(2)),
    Number(sumComm.toFixed(2)),
    Number(sumBills.toFixed(2)),
    '',
    '',
    Number(sumPaid.toFixed(2)),
    Number(sumClosing.toFixed(2)),
  ]);

  const wsSummary = XLSX.utils.aoa_to_sheet(summaryRows);
  wsSummary['!cols'] = [
    { wch: 8 },  // Sr
    { wch: 24 }, // Name
    { wch: 15 }, // Mobile
    { wch: 14 }, // Items
    { wch: 16 }, // Base
    { wch: 14 }, // Comm
    { wch: 16 }, // Bill
    { wch: 16 }, // Prev Udhar
    { wch: 16 }, // Total Due
    { wch: 16 }, // Paid
    { wch: 18 }, // Closing Udhar
  ];
  appendSheetSafely(wb, wsSummary, 'Customer Summary');

  // ─── Sheet 5: 📈 कालावधी आर्थिक निर्देशक (Period Financial KPIs) ──────────────
  const kpiRows = [
    [`=== ${shop.vendor_name || 'व्यापारसेतू'} : व्यापार निर्देशक (${dateStr.includes('_to_') ? dateStr.replace('_to_', ' ते ') : formatDDMMYYYY(dateStr)}) ===`],
    [],
    ['एकूण उलाढाल / निव्वळ विक्री (Total Net Sales ₹)', Number(summary.total_sales || sumBills)],
    ['एकूण खरेदी रक्कम (Base Purchases ₹)', Number(summary.total_subtotal || sumBase)],
    ['एकूण कमिशन उत्पन्न (Total Commission Earned ₹)', Number(summary.total_commission || sumComm)],
    ['रोख जमा (Cash Collection ₹)', Number(summary.cash_collection || 0)],
    ['UPI जमा (UPI Collection ₹)', Number(summary.upi_collection || 0)],
    ['एकूण जमा रक्कम (Total Paid ₹)', Number(summary.total_paid || sumPaid)],
    ['कालावधीतील उधारी विक्री (Credit Sales ₹)', Number(summary.credit_sales || 0)],
    ['एकूण दुकानाची येणे बाकी / चालू उधारी (Total Outstanding Udhar ₹)', Number(summary.total_outstanding || 0)],
    ['सक्रिय ग्राहक संख्या (Active Customers Count)', customers.length],
    ['तयार झालेले बिल संख्या (Invoices Generated)', Number(summary.total_bills || 0)],
  ];
  const wsKpis = XLSX.utils.aoa_to_sheet(kpiRows);
  wsKpis['!cols'] = [{ wch: 48 }, { wch: 24 }];
  appendSheetSafely(wb, wsKpis, 'KPIs');

  const filename = `${dateStr}.xlsx`;
  return saveWorkbook(wb, filename);
}

/**
 * Exports Credit / Udhar balance report to Excel with support for filtering > ₹10,000 debtors.
 *
 * @param {Object} creditData Data from /api/reports/credit
 * @param {string} [selectedDate]
 * @param {boolean} [onlyAbove10k] If true, exports only customers with balance >= 10000
 */
export async function exportCreditReportToExcel(creditData, selectedDate, onlyAbove10k = false) {
  if (!creditData) return;

  const rawCustomers = creditData.customers || [];
  const customers = onlyAbove10k
    ? rawCustomers.filter((c) => Number(c.credit_balance || 0) >= 10000)
    : rawCustomers;
  const recoveries = creditData.recoveries || [];
  const dateStr = selectedDate || new Date().toISOString().slice(0, 10);
  const wb = XLSX.utils.book_new();

  // Sheet 1: Customer Balances
  const title = onlyAbove10k
    ? `=== १०,०००+ उधारी थकबाकी ग्राहक यादी (${formatDDMMYYYY(dateStr)}) ===`
    : `=== ग्राहक उधारी अहवाल (${formatDDMMYYYY(dateStr)}) ===`;

  const balRows = [
    [title],
    [],
    [
      'अ.क्र (Sr.)',
      'ग्राहक नाव (Customer Name)',
      'मोबाईल (Mobile)',
      'आज जमा रक्कम (Today Paid ₹)',
      'शेवटचा व्यवहार दिनांक (Last Date)',
      'चालू येणे उधारी (Balance Udhar ₹)',
      'मर्यादा स्थिती (Limit Status)',
    ],
  ];

  let totalBal = 0;
  let totalToday = 0;
  customers.forEach((c, idx) => {
    const bal = Number(c.credit_balance || 0);
    const today = Number(c.today_recovery || 0);
    totalBal += bal;
    totalToday += today;
    balRows.push([
      idx + 1,
      c.name,
      c.mobile || '-',
      today,
      c.last_transaction_date ? formatDDMMYYYY(c.last_transaction_date) : '-',
      bal,
      bal >= 10000 ? '⚠️ मर्यादा ओलांडली (> ₹10,000)' : 'सामान्य (Normal)',
    ]);
  });

  balRows.push([]);
  balRows.push([
    'एकूण (Total)',
    `${customers.length} ग्राहक`,
    '',
    totalToday,
    '',
    totalBal,
    '',
  ]);

  const wsBal = XLSX.utils.aoa_to_sheet(balRows);
  wsBal['!cols'] = [
    { wch: 8 },
    { wch: 26 },
    { wch: 16 },
    { wch: 18 },
    { wch: 22 },
    { wch: 22 },
    { wch: 24 },
  ];
  appendSheetSafely(wb, wsBal, onlyAbove10k ? 'High Udhar 10k+' : 'Udhar Balances');

  // Sheet 2: Recoveries on this date (if present)
  if (recoveries.length > 0) {
    const recRows = [
      [`=== या तारखेला झालेली वसुली (${formatDDMMYYYY(dateStr)}) ===`],
      [],
      ['अ.क्र (Sr.)', 'ग्राहक नाव', 'मोबाईल', 'पेमेंट प्रकार', 'वेळ', 'तपशील / टीप', 'जमा रक्कम ₹'],
    ];
    let recTotal = 0;
    recoveries.forEach((r, idx) => {
      const amt = Number(r.amount || 0);
      recTotal += amt;
      recRows.push([
        idx + 1,
        r.customer_name,
        r.customer_mobile || '-',
        r.payment_mode || 'Cash',
        r.created_at ? new Date(r.created_at).toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit' }) : '-',
        r.note || '-',
        amt,
      ]);
    });
    recRows.push([]);
    recRows.push(['एकूण वसुली', `${recoveries.length} नोंदी`, '', '', '', '', recTotal]);
    const wsRec = XLSX.utils.aoa_to_sheet(recRows);
    wsRec['!cols'] = [
      { wch: 8 }, { wch: 24 }, { wch: 15 }, { wch: 14 }, { wch: 12 }, { wch: 24 }, { wch: 16 },
    ];
    appendSheetSafely(wb, wsRec, 'Recoveries');
  }

  const filename = onlyAbove10k
    ? `High_Credit_10k_Customers_${dateStr}.xlsx`
    : `Credit_Report_${dateStr}.xlsx`;
  return saveWorkbook(wb, filename);
}

