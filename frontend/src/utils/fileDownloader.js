/**
 * Universal File Downloader
 * Seamless file saving across Mobile Android APK (Capacitor), Desktop Electron, and Web Browsers.
 */

import { Capacitor } from '@capacitor/core';
import { Filesystem, Directory } from '@capacitor/filesystem';
import { Share } from '@capacitor/share';

/**
 * Convert Blob to Base64 string (without data URL prefix)
 * @param {Blob} blob
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
 * Convert ArrayBuffer to Base64 string
 * @param {ArrayBuffer} buffer
 * @returns {string}
 */
export function arrayBufferToBase64(buffer) {
  let binary = '';
  const bytes = new Uint8Array(buffer);
  const len = bytes.byteLength;
  for (let i = 0; i < len; i++) {
    binary += String.fromCharCode(bytes[i]);
  }
  return window.btoa(binary);
}

/**
 * Download or share a file across Android APK and Web Browser.
 *
 * @param {Object} options
 * @param {Blob|ArrayBuffer|Uint8Array|string} options.data File data (Blob, ArrayBuffer, or Base64 string)
 * @param {string} options.filename Output file name (e.g. "bill-101.pdf", "report.xlsx")
 * @param {string} [options.mimeType] MIME type (e.g. "application/pdf", "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet")
 * @param {string} [options.title] Title for the mobile share dialog
 * @returns {Promise<{ success: boolean, uri?: string }>}
 */
export async function downloadFile({ data, filename, mimeType = 'application/octet-stream', title }) {
  if (!data) throw new Error('No data provided for file download');

  const cleanFilename = (filename || 'download').replace(/[/\\?%*:|"<>]/g, '_');

  // 1. NATIVE ANDROID APK FLOW (Capacitor)
  if (typeof Capacitor !== 'undefined' && Capacitor.isNativePlatform()) {
    try {
      let base64String = '';
      if (typeof data === 'string') {
        if (data.startsWith('data:')) {
          base64String = data.split(',')[1] || '';
        } else {
          // Check if string is already valid base64 (e.g. from XLSX.write base64 or pdf.output)
          const isBase64 = /^[A-Za-z0-9+/=\r\n]+$/.test(data.trim()) && data.trim().length % 4 === 0 && !data.includes('{') && !data.includes('<');
          if (isBase64) {
            base64String = data.trim().replace(/[\r\n]+/g, '');
          } else {
            // It's a raw text/JSON string - encode to base64 with full UTF-8 Unicode support
            const utf8Bytes = new TextEncoder().encode(data);
            base64String = arrayBufferToBase64(utf8Bytes.buffer);
          }
        }
      } else if (data instanceof Blob) {
        base64String = await blobToBase64(data);
      } else if (data instanceof ArrayBuffer || ArrayBuffer.isView(data)) {
        const buffer = data instanceof ArrayBuffer ? data : data.buffer;
        base64String = arrayBufferToBase64(buffer);
      }

      // Write file to Cache directory first for fast I/O and instant share access
      const writeResult = await Filesystem.writeFile({
        path: cleanFilename,
        data: base64String,
        directory: Directory.Cache,
        recursive: true,
      });

      // Also attempt to write to user-accessible Documents directory
      try {
        await Filesystem.writeFile({
          path: cleanFilename,
          data: base64String,
          directory: Directory.Documents,
          recursive: true,
        });
      } catch (_) {}

      // Open Android system share / save sheet with the file attached
      if (writeResult?.uri) {
        await Share.share({
          title: cleanFilename,
          files: [writeResult.uri],
          dialogTitle: title || `Save or Open ${cleanFilename}`,
        });
        return { success: true, uri: writeResult.uri };
      }
    } catch (err) {
      if (err?.name === 'AbortError') {
        return { success: true };
      }
      console.warn('Native file save/share failed, falling back to browser flow:', err);
    }
  }

  // 2. DESKTOP / WEB BROWSER FLOW
  if (typeof window !== 'undefined') {
    let blob;
    if (data instanceof Blob) {
      blob = data;
    } else if (typeof data === 'string') {
      if (data.startsWith('data:')) {
        const pureBase64 = data.split(',')[1] || '';
        const byteCharacters = atob(pureBase64);
        const byteNumbers = new Uint8Array(byteCharacters.length);
        for (let i = 0; i < byteCharacters.length; i++) {
          byteNumbers[i] = byteCharacters.charCodeAt(i);
        }
        blob = new Blob([byteNumbers], { type: mimeType });
      } else {
        const isBase64 = /^[A-Za-z0-9+/=\r\n]+$/.test(data.trim()) && data.trim().length % 4 === 0 && !data.includes('{') && !data.includes('<');
        if (isBase64) {
          const byteCharacters = atob(data.trim().replace(/[\r\n]+/g, ''));
          const byteNumbers = new Uint8Array(byteCharacters.length);
          for (let i = 0; i < byteCharacters.length; i++) {
            byteNumbers[i] = byteCharacters.charCodeAt(i);
          }
          blob = new Blob([byteNumbers], { type: mimeType });
        } else {
          blob = new Blob([data], { type: mimeType });
        }
      }
    } else if (data instanceof ArrayBuffer || ArrayBuffer.isView(data)) {
      blob = new Blob([data], { type: mimeType });
    }

    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = cleanFilename;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    setTimeout(() => URL.revokeObjectURL(url), 10000);
    return { success: true };
  }

  return { success: false, error: 'Unsupported environment' };
}
