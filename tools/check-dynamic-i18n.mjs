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

// Find dynamic t(`...`) calls
const dynamicCalls = [];
for (const file of files) {
  const content = fs.readFileSync(file, 'utf8');
  const lines = content.split('\n');
  lines.forEach((line, idx) => {
    if (line.includes('t(`') || line.includes('t(\'') || line.includes('t("')) {
      const match = line.match(/t\(([`'"][^)]+[`'"])/g);
      if (match) {
        match.forEach(m => {
          if (m.includes('${')) {
            dynamicCalls.push({ file: path.relative(srcDir, file), line: idx + 1, call: m });
          }
        });
      }
    }
  });
}

console.log('=== DYNAMIC T() CALLS ===');
console.log(JSON.stringify(dynamicCalls, null, 2));
