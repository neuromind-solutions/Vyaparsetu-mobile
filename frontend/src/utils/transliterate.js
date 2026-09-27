/**
 * transliterate.js — kept as a re-export of the transliteration service.
 *
 * This file used to hold a 973-line hand-rolled phoneme map. It had no retroflex
 * consonants at all (`t` was always dental त, never ट), mapped `th` to त instead of थ,
 * `nh` to ण and `ng` to ञ, and baked inconsistent inherent-a matras into a handful of
 * pairs — so vegetable names and Maratha surnames came out wrong. The engine now lives in
 * services/transliteration/ behind a replaceable provider.
 *
 * The file stays because three components import from this path
 * (MarathiInput, CustomerAutocomplete, VegetableAutocomplete) and none of them needs to
 * change. Prefer importing from '../services/transliteration' in new code.
 *
 * @see ../services/transliteration/index.js
 */
export {
  getSuggestions as getTransliterationSuggestions,
  transliterate as transliterateToMarathi,
  setProvider,
  getProviderName,
} from '../services/transliteration/index.js';
