/**
 * fuzzySearch.js
 * Offline fuzzy search utility using Fuse.js.
 * Wraps Fuse.js with app-specific config for Marathi vegetable/customer search.
 *
 * Usage:
 *   import { fuzzySearch } from './fuzzySearch';
 *   const results = fuzzySearch(allVegetables, 'shev', ['name', 'search_keywords']);
 */

import Fuse from 'fuse.js';
import { normalizeRoman, getSearchVariants } from './normalize';

// ─── Default Fuse config for names/keywords ───────────────────────────────────
const DEFAULT_OPTIONS = {
  includeScore: true,
  threshold: 0.4,        // 0 = exact, 1 = match anything
  distance: 100,
  minMatchCharLength: 2,
  useExtendedSearch: false,
  ignoreLocation: true,  // important: match anywhere in string, not just prefix
};

/**
 * Perform offline fuzzy search against a list of records.
 *
 * @param {Object[]} records     - Array of data objects
 * @param {string}   query       - Search query (English or Marathi)
 * @param {string[]} keys        - Fields to search in (e.g. ['name', 'search_keywords'])
 * @param {Object}   [options]   - Additional Fuse options
 * @returns {Object[]}           - Matching records sorted by score (best first)
 */
export function fuzzySearch(records, query, keys, options = {}) {
  if (!records || records.length === 0) return [];
  if (!query || query.trim().length < 1) return records;

  const variants = getSearchVariants(query);

  // Build search data: augment each record with a normalized copy of each key
  const augmented = records.map((rec) => ({
    ...rec,
    _normalized_name: normalizeRoman(rec.name || ''),
    _normalized_keywords: normalizeRoman(rec.search_keywords || ''),
  }));

  const fuseKeys = [
    // Original fields
    ...keys,
    // Normalized shadow fields
    '_normalized_name',
    '_normalized_keywords',
  ];

  const fuse = new Fuse(augmented, {
    ...DEFAULT_OPTIONS,
    ...options,
    keys: fuseKeys,
  });

  // Run search for each variant, collect unique results
  const seen = new Set();
  const results = [];

  for (const v of variants) {
    const hits = fuse.search(v);
    for (const hit of hits) {
      const id = hit.item.id ?? hit.item.name;
      if (!seen.has(id)) {
        seen.add(id);
        results.push(hit.item);
      }
    }
  }

  return results;
}

/**
 * Filter + sort records using fuzzy matching.
 * Returns the original records if query is empty.
 *
 * @param {Object[]} records
 * @param {string}   query
 * @param {string[]} keys
 * @returns {Object[]}
 */
export function applyFuzzyFilter(records, query, keys) {
  if (!query || query.trim().length === 0) return records;
  return fuzzySearch(records, query, keys);
}
