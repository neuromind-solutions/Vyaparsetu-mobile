/**
 * VyapaarSetu - Duplicate Customer Cleanup Script
 * Scans the database for duplicate customer records (by mobile or name),
 * transfers any bills and credit transactions to the primary customer,
 * reconciles balances, and deletes duplicate records.
 *
 * Usage: node tools/cleanDuplicateCustomers.js
 */

const path = require('path');
const { initDb, execSelect } = require('../backend/database/db');
const customerService = require('../backend/services/customerService');

console.log('=== VyapaarSetu Customer Deduplication Tool ===\n');

try {
  initDb();

  const beforeCount = execSelect(`SELECT count(*) as cnt FROM customers WHERE is_deleted = 0`)[0].cnt;
  console.log(`Current active customers before deduplication: ${beforeCount}`);

  const result = customerService.deduplicateCustomers();

  const afterCount = execSelect(`SELECT count(*) as cnt FROM customers WHERE is_deleted = 0`)[0].cnt;
  console.log(`\nDeduplication Summary:`);
  console.log(`- Duplicate groups merged: ${result.mergedGroups}`);
  console.log(`- Duplicate records removed: ${result.duplicatesRemoved}`);
  console.log(`- Active customers remaining: ${afterCount}`);

  if (result.duplicatesRemoved > 0) {
    console.log('\n✅ Successfully removed all duplicate customers and reconciled balances!');
  } else {
    console.log('\n✨ No duplicate customers found in database.');
  }

  const remaining = execSelect(`SELECT id, name, mobile, address, credit_balance FROM customers WHERE is_deleted = 0 ORDER BY id ASC`);
  console.log('\nRemaining Active Customers:');
  console.table(remaining);
} catch (err) {
  console.error('❌ Error during deduplication:', err.message);
  process.exit(1);
}
