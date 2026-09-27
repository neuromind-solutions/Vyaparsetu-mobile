/**
 * Roman → Marathi transliteration. The public interface.
 *
 * Three components consume this (MarathiInput, CustomerAutocomplete, VegetableAutocomplete)
 * and they all want the same thing: a list of Devanagari spellings for the word being
 * typed. Nothing they do depends on how that list is produced, which is what makes the
 * engine replaceable.
 *
 * ── Layers ───────────────────────────────────────────────────────────────────────
 *   1. Dictionary exact match   — the known answer for the shop's own vocabulary
 *   2. Dictionary prefix match  — completions while the word is still being typed
 *   3. Provider readings        — rules, for everything the dictionary has never seen
 *
 * The order is the point. Layer 1 outranks the rules because casual Roman cannot express
 * vowel length or retroflexion, so "batata" and "bataataa" are the same keystrokes to the
 * vendor while बटाटा is only one of them. Where the answer is known it is used; where it
 * is not, the rules offer their readings and the vendor picks.
 *
 * The dictionary lives at this layer rather than inside the provider on purpose: swapping
 * the engine must not cost the shop its vocabulary.
 */
import { WORD_DICT } from './wordDictionary.js';
import { indicRuleProvider } from './indicRuleProvider.js';

/**
 * MarathiInput renders the first suggestion on Space and the rest in a dropdown, and has
 * always been given at most five. Keeping that number here preserves its behaviour.
 */
const MAX_SUGGESTIONS = 5;

/** How many dictionary prefix completions to take before falling through to the rules. */
const MAX_PREFIX_MATCHES = 4;

/**
 * The active engine.
 *
 * A provider is `{ name, transliterate(word) => string, variants(word) => string[] }`.
 * `variants` is optional — a provider that only has one answer can omit it.
 */
let provider = indicRuleProvider;

/**
 * Swap the transliteration engine.
 *
 * The seam exists so a neural engine (IndicXlit via ONNX, or a hosted API for a client
 * who has accepted the network trade-off) can be dropped in without touching a single
 * component. The dictionary layer above keeps working either way.
 *
 * @param {{name?: string, transliterate: (word: string) => string, variants?: (word: string) => string[]}} next
 */
export function setProvider(next) {
  if (!next || typeof next.transliterate !== 'function') {
    throw new Error('A transliteration provider must implement transliterate(word).');
  }
  provider = next;
}

/** The active provider, mostly so a check script or a debug screen can name it. */
export function getProviderName() {
  return provider.name || 'unnamed';
}

/** Normalises input the way every layer expects: lowercase, trimmed. */
function normalise(input) {
  return String(input || '').toLowerCase().trim();
}

/**
 * The dictionary keys to try, in order.
 *
 * A vendor typing fast produces "kanda." or "ka-nda", and the word MarathiInput hands us
 * is whatever sat between two spaces. Dictionary keys are pure letters, so an exact-match
 * lookup on the raw input silently misses — the vendor gets rule output for a word whose
 * correct spelling is sitting in the dictionary. Trying the letters-only form as well
 * costs one comparison and closes that.
 *
 * @returns {string[]} one key, or two when stripping punctuation changed something
 */
function lookupKeys(key) {
  const letters = key.replace(/[^a-z]/g, '');
  return letters && letters !== key ? [key, letters] : [key];
}

/**
 * The single best Marathi spelling of a word.
 *
 * Dictionary first, then the provider. Returns '' rather than echoing the input back,
 * so a caller can tell "no idea" apart from "this is already Marathi".
 *
 * @param {string} word
 * @returns {string}
 */
export function transliterate(word) {
  const key = normalise(word);
  if (!key) return '';

  for (const candidate of lookupKeys(key)) {
    const exact = WORD_DICT[candidate];
    if (exact && exact.length > 0) return exact[0];
  }

  return provider.transliterate(key) || '';
}

/**
 * Up to five Marathi spellings for a word, best first.
 *
 * This is the function the three input components actually call, and its contract is
 * unchanged from the hand-rolled version it replaces: an array of at most five strings,
 * empty for empty input, never containing duplicates.
 *
 * @param {string} input
 * @returns {string[]}
 */
export function getSuggestions(input) {
  const key = normalise(input);
  if (!key) return [];

  // A Set for dedup, but iterated in insertion order — which is the priority order.
  const out = new Set();
  const keys = lookupKeys(key);

  // ── 1. Exact dictionary match ───────────────────────────────────────────────
  for (const candidate of keys) {
    for (const word of WORD_DICT[candidate] || []) out.add(word);
  }

  // ── 2. Dictionary prefix matches ────────────────────────────────────────────
  // Sorted shortest-key-first so the closest completion of what has been typed so far
  // comes before a longer one. The old implementation broke out of an unordered
  // Object.entries loop, which meant the suggestions a vendor saw depended on key
  // insertion order — the same three letters could offer different words after an
  // unrelated edit to the dictionary.
  const prefix = keys[keys.length - 1]; // the letters-only form, when there is one
  const prefixKeys = [];
  for (const dictKey of Object.keys(WORD_DICT)) {
    if (!keys.includes(dictKey) && dictKey.startsWith(prefix)) prefixKeys.push(dictKey);
  }
  prefixKeys.sort((a, b) => a.length - b.length || a.localeCompare(b));

  for (const dictKey of prefixKeys.slice(0, MAX_PREFIX_MATCHES)) {
    for (const word of WORD_DICT[dictKey]) out.add(word);
    if (out.size >= MAX_SUGGESTIONS) break;
  }

  // ── 3. Provider readings ────────────────────────────────────────────────────
  // Always consulted, even when the dictionary hit, so a vendor typing a name that
  // happens to prefix-match a vegetable still gets the reading of what they typed.
  const readings = typeof provider.variants === 'function'
    ? provider.variants(key)
    : [provider.transliterate(key)];

  for (const reading of readings) {
    if (reading) out.add(reading);
  }

  return [...out].slice(0, MAX_SUGGESTIONS);
}
