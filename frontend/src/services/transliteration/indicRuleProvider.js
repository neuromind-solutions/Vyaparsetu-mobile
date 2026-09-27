/**
 * The rule-based transliteration provider.
 *
 * Composes the three pieces into one engine that satisfies the provider contract in
 * index.js: normalise casual Roman to ITRANS, hand that to the scheme engine, then fix
 * the Marathi spelling of what comes back.
 *
 * Why a rule engine and not AI4Bharat's own package: `@ai4bharat/indic-transliterate`
 * posts every keystroke to xlit-api.ai4bharat.org. This app is sold as offline-first and
 * its EULA promises no business data leaves the machine, so a customer's name going out
 * over the wire is not a trade-off that was available. The neural IndicXlit model that
 * backs that API is ~100 MB, which would dominate an installer that is currently a few
 * tens of MB. A scheme engine plus Marathi rules plus the domain dictionary gets the
 * accuracy where it needs to be for the words this shop actually types, in 189 KB, with
 * nothing leaving the PC.
 *
 * If that trade-off ever changes, this file is the only thing that has to be replaced —
 * see setProvider in ./index.js.
 */
import Sanscript from '@indic-transliteration/sanscript';
import {
  romanToItrans,
  retroflexVariant,
  retroflexLaVariant,
  hasDevanagari,
} from './romanToItrans.js';
import { applyMarathiOrthography } from './marathiOrthography.js';

// The published package is UMD; the interop shape differs between the Vite bundle and a
// plain `node` run of the check script, so accept either.
const sanscript = Sanscript.default || Sanscript;

/**
 * ITRANS → Marathi, with the spelling fixes applied.
 *
 * @param {string} itrans
 * @returns {string} '' if the scheme engine cannot read the input.
 */
function render(itrans) {
  if (!itrans) return '';
  try {
    return applyMarathiOrthography(sanscript.t(itrans, 'itrans', 'devanagari'));
  } catch {
    // A scheme engine that throws must not take the input box down with it. The vendor
    // keeps typing and simply sees no suggestion for this word.
    return '';
  }
}

export const indicRuleProvider = {
  name: 'indic-rules',

  /**
   * The single best reading of a word.
   * @param {string} word casual romanised Marathi
   * @returns {string} Devanagari, or '' when there is nothing to convert
   */
  transliterate(word) {
    return render(romanToItrans(word));
  },

  /**
   * Every reading worth offering, best first.
   *
   * More than one, because casual Roman is genuinely ambiguous about retroflexion: `t` is
   * both त and ट, `d` is both द and ड, `l` is both ल and ळ. Guessing once means being
   * confidently wrong about half the words; offering the alternatives means the vendor
   * picks the right one from a list they are already looking at.
   *
   * @param {string} word casual romanised Marathi
   * @returns {string[]} deduped, in priority order, possibly empty
   */
  variants(word) {
    const itrans = romanToItrans(word);
    if (!itrans) return [];

    const readings = [
      itrans,
      retroflexVariant(itrans),
      retroflexLaVariant(itrans),
    ];

    const out = [];
    for (const reading of readings) {
      const rendered = render(reading);
      // Drop empties, duplicates, and anything the engine passed through unchanged —
      // Latin text in the dropdown is noise, not a suggestion.
      if (rendered && hasDevanagari(rendered) && !out.includes(rendered)) {
        out.push(rendered);
      }
    }
    return out;
  },
};
