/**
 * Marathi spelling fixes applied to the Devanagari that comes out of the scheme engine.
 *
 * Two of these could not be done upstream in ITRANS, because they are facts about the
 * rendered script rather than about the romanisation. The third is a backstop.
 *
 * Everything a rule engine can fix *before* conversion is fixed in romanToItrans.js —
 * this file is deliberately small. If a fix can be expressed as "the vendor typed X and
 * meant ITRANS Y", it belongs there, not here.
 */

/** Combining nukta, U+093C. */
const NUKTA = /़/g;

/** A halant left on the final consonant. */
const TRAILING_HALANT = /्$/;

/** Zero-width joiner and non-joiner, which nothing here should be emitting. */
const ZERO_WIDTH = /[‌‍]/g;

/**
 * @param {string} devanagari Output of the scheme engine.
 * @returns {string} the same text spelled the way a Marathi reader expects.
 */
export function applyMarathiOrthography(devanagari) {
  let out = String(devanagari || '');
  if (!out) return '';

  // ── 1. Drop the trailing halant ────────────────────────────────────────────
  // ITRANS is explicit about the inherent vowel: a consonant with no vowel after it is
  // a bare consonant, so `paaTiil` renders पाटील् and `saMt` renders संत्. Marathi does
  // not write that halant — the words are पाटील and संत. Since the vendor is typing
  // whole words and not Sanskrit stems, a final halant is always an artefact.
  out = out.replace(TRAILING_HALANT, '');

  // ── 2. Strip nukta ─────────────────────────────────────────────────────────
  // A backstop for romanToItrans's q/f/z rules. ITRANS maps those three letters to क़, फ़
  // and ज़, which are Urdu and Persian forms; Marathi uses क, फ and ज. Because the nukta
  // is a combining mark, removing U+093C alone handles every one of them — and also the
  // precomposed ड़/ढ़ once they are decomposed, which is why this runs before the
  // zero-width pass rather than as a per-character table.
  out = out.normalize('NFD').replace(NUKTA, '').normalize('NFC');

  // ── 3. Remove zero-width joiners ───────────────────────────────────────────
  // These are invisible on screen but they are real characters in the value that gets
  // saved, so a name stored with one will not match the same name typed without it —
  // the customer silently becomes two customers.
  out = out.replace(ZERO_WIDTH, '');

  return out;
}
