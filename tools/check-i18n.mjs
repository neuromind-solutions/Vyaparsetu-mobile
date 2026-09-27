import fs from 'fs';
import path from 'path';

const srcDir = 'd:/VyapaarSetu/frontend/src';
const enPath = 'd:/VyapaarSetu/frontend/src/i18n/en.json';
const mrPath = 'd:/VyapaarSetu/frontend/src/i18n/mr.json';

const en = JSON.parse(fs.readFileSync(enPath, 'utf8'));
const mr = JSON.parse(fs.readFileSync(mrPath, 'utf8'));

function resolvePath(obj, p) {
  return p.split('.').reduce((acc, key) => (acc && acc[key] !== undefined ? acc[key] : null), obj);
}

function getAllFiles(dir, exts = ['.jsx', '.js']) {
  let results = [];
  const list = fs.readdirSync(dir);
  list.forEach((file) => {
    const filePath = path.join(dir, file);
    const stat = fs.statSync(filePath);
    if (stat && stat.isDirectory()) {
      results = results.concat(getAllFiles(filePath, exts));
    } else {
      if (exts.includes(path.extname(file))) {
        results.push(filePath);
      }
    }
  });
  return results;
}

const files = getAllFiles(srcDir);
const regex = /\bt\(\s*['"]([a-zA-Z0-9_.]+)['"]/g;

const usedKeys = new Set();
const keyLocations = {};

for (const file of files) {
  const content = fs.readFileSync(file, 'utf8');
  let match;
  while ((match = regex.exec(content)) !== null) {
    const key = match[1];
    usedKeys.add(key);
    if (!keyLocations[key]) keyLocations[key] = [];
    keyLocations[key].push(path.relative(srcDir, file));
  }
}

const missingInEn = [];
const missingInMr = [];

for (const key of Array.from(usedKeys).sort()) {
  const inEn = resolvePath(en, key);
  const inMr = resolvePath(mr, key);
  if (inEn === null) {
    missingInEn.push({ key, files: keyLocations[key] });
  }
  if (inMr === null) {
    missingInMr.push({ key, files: keyLocations[key] });
  }
}

console.log('=== MISSING IN EN.JSON ===');
console.log(JSON.stringify(missingInEn, null, 2));

console.log('=== MISSING IN MR.JSON ===');
console.log(JSON.stringify(missingInMr, null, 2));
