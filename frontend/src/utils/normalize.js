/**
 * normalize.js
 * Normalizes romanized Marathi/Hindi transliterations so different
 * spellings of the same word produce the same canonical form.
 *
 * Usage:
 *   import { normalizeRoman } from './normalize';
 *   normalizeRoman('kaanda')  // → 'kanda'
 *   normalizeRoman('shevaga') // → 'shevga'
 */

/**
 * Normalize a romanized Marathi string to a canonical form.
 * Rules applied:
 *   1. Lowercase
 *   2. Repeated vowels → single vowel (e.g. 'aa' → 'a', 'ii' → 'i')
 *      except 'ee' which maps to 'i' (common alternate for ई)
 *   3. Common alternate spellings → canonical form
 * @param {string} input
 * @returns {string}
 */
export function normalizeRoman(input) {
  if (!input || typeof input !== 'string') return '';
  let s = input.toLowerCase().trim();

  // ── 1. Common alternate spellings → canonical ──────────────────
  const replacements = [
    // Vowel variants
    [/aa+/g,   'a'],   // kaanda → kanda, saal → sal
    [/ee+/g,   'i'],   // shree → shri
    [/ii+/g,   'i'],   // beej → bij
    [/oo+/g,   'u'],   // moos → mus
    [/uu+/g,   'u'],   // puur → pur
    // Trailing 'a' / 'aa' doubles
    [/aga$/,   'ga'],  // shevaga → shevga
    [/aka$/,   'ka'],
    [/ata$/,   'ta'],
    [/ala$/,   'la'],
    // 'w' → 'v'
    [/w/g,     'v'],
    // 'q' → 'k'
    [/q/g,     'k'],
    // 'x' → 'ks'
    [/x/g,     'ks'],
    // double consonants collapse to single (ball → bal)
    [/(.)\1+/g, '$1'],
  ];

  for (const [pattern, replacement] of replacements) {
    s = s.replace(pattern, replacement);
  }

  return s;
}

/**
 * Generate search variants for a query string.
 * Returns the original + normalized form so searches hit both.
 * @param {string} query
 * @returns {string[]}
 */
export function getSearchVariants(query) {
  if (!query) return [];
  const normalized = normalizeRoman(query);
  const variants = new Set([query.toLowerCase(), normalized]);
  return [...variants];
}
