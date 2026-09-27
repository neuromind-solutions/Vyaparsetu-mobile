/**
 * Casual romanised Marathi → ITRANS.
 *
 * Sanscript is a faithful *scheme* converter: give it correct ITRANS and it gives back
 * correct Devanagari. But nobody types ITRANS. A vendor types "kothimbir", not
 * "kothiMbiira", so something has to stand between the keyboard and the scheme engine.
 * That is this file, and it is where the actual language knowledge lives.
 *
 * Each rule below is a separate named step so a wrong one can be found and changed
 * without re-reading the whole pipeline. They are applied in order, and the order
 * matters: the nasal rule runs first because it inspects plain lowercase letters, and
 * every later rule may introduce the uppercase letters ITRANS uses for retroflex and
 * sibilant consonants (T, Sh, GY, M).
 *
 * What this file deliberately does NOT try to do is guess vowel length in the middle of
 * a word. "batata" is six letters with three short a's; बटाटा has two long ones. No rule
 * can recover that, because "batata" and "bataataa" are the same word to the person
 * typing. That ambiguity is the dictionary's job (see wordDictionary.js), which is why
 * the dictionary is layer one and this is layer two.
 */

/**
 * Consonants that turn a preceding n/m into an anusvara.
 *
 * Marathi writes कांदा, संत, तांबे, चिंच, रंग — an anusvara — where a literal reading of
 * the typed letters produces the conjuncts कान्दा, सन्त, ताम्बे, चिन्च, रङ्ग. This single
 * rule is the largest correctness win in the file.
 *
 * Four followers are deliberately absent:
 *   h — नह is न्ह (म्हात्रे, न्हावी), a real cluster, not a nasalised vowel.
 *   y — न्य is real and common (कन्या, अन्य); अंय does not occur.
 *   n — न्न is real (अन्न).
 *   m — न्म is real (जन्म).
 * Liquids and semivowels ARE included: संवाद, संलग्न, संरक्षण all take the anusvara.
 *
 * Longer clusters come first so `n` + `chh` is not read as `n` + `c`.
 */
const NASAL_FOLLOWERS = 'khh|kh|gh|chh|ch|jh|th|dh|ph|bh|sh|k|g|c|j|t|d|p|f|b|z|s|l|r|v|w|x|q';

/**
 * The ordered rewrite rules. `{ name, pattern, replace }` — name is for the check script's
 * failure output, so a regression names the rule that broke rather than just the word.
 */
const RULES = [
  // ── Nasals ──────────────────────────────────────────────────────────────────
  // Must be first: it matches lowercase letters only, and the rules below introduce
  // uppercase ones. `M` is the ITRANS anusvara.
  {
    name: 'nasal-to-anusvara',
    pattern: new RegExp(`([nm])(?=(?:${NASAL_FOLLOWERS}))`, 'g'),
    replace: 'M',
  },

  // ── Conjuncts and sibilants, longest first ──────────────────────────────────
  // क्ष. Both the `ksh` people type and the `x` they sometimes reach for.
  { name: 'ksha',        pattern: /kshh|ksh/g, replace: 'kSh' },
  { name: 'ksha-from-x', pattern: /x/g,        replace: 'kSh' },

  // ष is always followed by a retroflex ट/ठ in Marathi and Sanskrit — कष्ट, राष्ट्र, दुष्ट,
  // अष्टमी, निष्ठा. So `sht` is one of the few places retroflexion can be inferred with
  // confidence rather than guessed. (शिस्त is safe: there the `sh` is followed by a vowel.)
  { name: 'shtha', pattern: /shth/g, replace: 'ShTh' },
  { name: 'shta',  pattern: /sht/g,  replace: 'ShT' },

  // ष elsewhere, when spelled out as `shh`.
  { name: 'ssha', pattern: /shh/g, replace: 'Sh' },
  // छ.
  { name: 'chha', pattern: /chh/g, replace: 'Ch' },
  // ज्ञ — all three spellings vendors use for ज्ञानेश / ज्ञानेश्वर.
  { name: 'dnya', pattern: /dny|gny|jny/g, replace: 'GY' },

  // ── Letters ITRANS reads differently from casual Roman ──────────────────────
  // Bare c is क (चणा keeps its `ch`); `ck` is the same sound spelled twice.
  { name: 'ck-to-k', pattern: /ck/g,     replace: 'k' },
  { name: 'c-to-k',  pattern: /c(?!h)/g, replace: 'k' },

  // q, f and z map to ITRANS letters that carry a nukta — क़, फ़, ज़. Those are Urdu and
  // Persian forms; Marathi does not use them, and they render as visibly foreign text.
  // Route each to its Marathi equivalent instead. (marathiOrthography.js strips any
  // nukta that still gets through, as a backstop.)
  { name: 'q-to-k',   pattern: /q/g, replace: 'k' },
  { name: 'f-to-pha', pattern: /f/g, replace: 'ph' },
  { name: 'z-to-jha', pattern: /z/g, replace: 'jh' },
  { name: 'w-to-va',  pattern: /w/g, replace: 'v' },

  // ── Vowel length ────────────────────────────────────────────────────────────
  // English spelling habits for the long vowels: dEEpak → दीपक, mOOg → मूग.
  { name: 'ee-to-ii', pattern: /ee/g, replace: 'ii' },
  { name: 'oo-to-uu', pattern: /oo/g, replace: 'uu' },

  // Marathi orthography has no word-final short इ or उ — मेथी, कोबी, भाजी, शेपू, चिकू are
  // all written long. The lookbehind keeps the diphthongs (जय, बाजू already long) out of it.
  { name: 'final-i-long', pattern: /(?<![aeiou])i$/, replace: 'ii' },
  { name: 'final-u-long', pattern: /(?<![aeiou])u$/, replace: 'uu' },
];

/** True when the string already contains Devanagari, i.e. there is nothing to convert. */
export function hasDevanagari(text) {
  return /[ऀ-ॿ]/.test(String(text || ''));
}

/**
 * Normalises one casual-Roman word into ITRANS.
 *
 * @param {string} word A single word. Non-letters are dropped, so punctuation a vendor
 *   fat-fingers into the middle of a name cannot derail the scheme engine.
 * @returns {string} ITRANS, or '' when there is nothing usable to convert.
 */
export function romanToItrans(word) {
  const raw = String(word || '').toLowerCase().trim();
  if (!raw || hasDevanagari(raw)) return '';

  let out = raw.replace(/[^a-z]/g, '');
  if (!out) return '';

  for (const rule of RULES) {
    out = out.replace(rule.pattern, rule.replace);
  }
  return out;
}

/**
 * The same word read with retroflex t and d instead of dental.
 *
 * Casual Roman collapses two distinct Marathi sounds onto one key: `t` is both त (पती)
 * and ट (पाटील), `d` is both द (दही) and ड (डोंगर). There is no rule that recovers the
 * difference, so rather than silently picking one, the pipeline offers both readings and
 * lets the vendor choose — which is what the suggestion dropdown is for.
 *
 * The aspirates move together with their plain partners: थ→ठ, ध→ढ.
 *
 * @param {string} itrans Output of romanToItrans.
 * @returns {string} '' when the word has no t or d to flip.
 */
export function retroflexVariant(itrans) {
  if (!itrans || !/[td]/.test(itrans)) return '';
  // The aspirate replaces run first and emit uppercase, and the two bare replaces are
  // case-sensitive, so a Th written by the first line is not touched again by the third.
  // A doubled tt the vendor typed on purpose (बट्टा) survives as TT, which is correct.
  return itrans
    .replace(/th/g, 'Th')
    .replace(/dh/g, 'Dh')
    .replace(/t/g, 'T')
    .replace(/d/g, 'D');
}

/**
 * The same word read with ळ instead of ल.
 *
 * ळ is the retroflex lateral, and it is everywhere in Marathi — मुळा, काळा, नारळ, केळी,
 * हळद, माळी, टिळक, गोपाळ — while the same key also spells plain ल in लाल, माल, पाल. Again
 * unrecoverable by rule, so it becomes a second reading rather than a coin flip.
 *
 * @param {string} itrans Output of romanToItrans.
 * @returns {string} '' when the word has no l to flip.
 */
export function retroflexLaVariant(itrans) {
  if (!itrans || !/l/.test(itrans)) return '';
  return itrans.replace(/l/g, 'L');
}
