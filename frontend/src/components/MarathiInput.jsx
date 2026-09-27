/**
 * MarathiInput — Reusable Component
 * ────────────────────────────────────────────────────────────────
 * Allows typing with an English keyboard while showing Marathi
 * transliteration suggestions. Supports manual Marathi typing too.
 * Works completely offline — no external APIs.
 *
 * Props:
 *  id            {string}             – Input element id
 *  name          {string}             – Input name (for form)
 *  value         {string}             – Controlled value
 *  onChange      {function(value)}    – Called with the new string value
 *  placeholder   {string}
 *  className     {string}             – Extra CSS classes for the input
 *  hasError      {boolean}            – Adds .input-error class
 *  autoFocus     {boolean}
 *  disabled      {boolean}
 *  label         {string}             – Shown above suggestion pills (optional)
 *  variant       {string}             – 'search' or 'default'
 */

import { useState, useRef, useEffect, useCallback } from 'react';
import { getTransliterationSuggestions } from '../utils/transliterate';

// ─── Helpers ──────────────────────────────────────────────────────────────────

/** Returns true if the string contains Devanagari characters */
function hasDevanagari(str) {
  return /[\u0900-\u097F]/.test(str);
}

/** Returns true if string is entirely ASCII (English typing mode) */
function isAscii(str) {
  for (let i = 0; i < str.length; i++) {
    if (str.charCodeAt(i) > 127) return false;
  }
  return true;
}

// ─── Component ────────────────────────────────────────────────────────────────
export default function MarathiInput({
  id,
  name,
  value,
  onChange,
  placeholder = 'Type in English or Marathi...',
  className = '',
  hasError = false,
  autoFocus = false,
  disabled = false,
  label,
  variant = 'default',
}) {
  const isSearch = variant === 'search';
  const storageKey = isSearch ? 'translit_search_enabled' : 'translit_form_enabled';
  const defaultVal = !isSearch;

  // ── Transliteration Enable/Disable State ───────────────────────────────────
  const [isTranslitEnabled, setIsTranslitEnabled] = useState(() => {
    try {
      const saved = localStorage.getItem(storageKey);
      return saved !== null ? JSON.parse(saved) : defaultVal;
    } catch {
      // localStorage can be unavailable (private mode, disabled storage). The toggle
      // still works for this session; only the preference fails to persist.
      return defaultVal;
    }
  });

  const [suggestions, setSuggestions]   = useState([]);
  const [showSuggestions, setShowSuggestions] = useState(false);
  const [activeIdx, setActiveIdx]       = useState(-1);
  const inputRef = useRef(null);
  const containerRef = useRef(null);
  const lastTranslitRef = useRef({ original: '', transliterated: '' });

  // ── Save toggle preference to localStorage ─────────────────────────────────
  const toggleTranslit = useCallback((e) => {
    e.preventDefault();
    e.stopPropagation();
    setIsTranslitEnabled((prev) => {
      const next = !prev;
      try {
        localStorage.setItem(storageKey, JSON.stringify(next));
      } catch {
        // Safe fallback: the toggle still applies, it just won't be remembered.
      }
      return next;
    });
    // Refocus input
    setTimeout(() => inputRef.current?.focus(), 0);
  }, [storageKey]);

  // ── Generate suggestions whenever value changes ──────────────────────────
  useEffect(() => {
    if (!isTranslitEnabled || !value) {
      setSuggestions([]);
      setShowSuggestions(false);
      return;
    }

    // Extract the last word to transliterate
    const match = value.match(/(\S+)$/);
    const lastWord = match ? match[1] : '';

    // Only suggest if transliteration is active and the last word is ASCII
    if (!lastWord || !isAscii(lastWord) || lastWord.length < 1) {
      setSuggestions([]);
      setShowSuggestions(false);
      return;
    }
    const suggs = getTransliterationSuggestions(lastWord);
    setSuggestions(suggs);
    setShowSuggestions(suggs.length > 0);
    setActiveIdx(-1);
  }, [value, isTranslitEnabled]);

  // ── Close suggestions when clicking outside ──────────────────────────────
  useEffect(() => {
    function handleOutsideClick(e) {
      if (containerRef.current && !containerRef.current.contains(e.target)) {
        setShowSuggestions(false);
      }
    }
    document.addEventListener('mousedown', handleOutsideClick);
    return () => document.removeEventListener('mousedown', handleOutsideClick);
  }, []);

  // ── Helper to replace only the last word ─────────────────────────────────
  const replaceLastWord = useCallback((suggestion, addSpace = false) => {
    const match = value.match(/^([\s\S]*?)(\S+)$/);
    let newVal;
    if (match) {
      newVal = match[1] + suggestion;
    } else {
      newVal = suggestion;
    }
    if (addSpace) newVal += ' ';
    return newVal;
  }, [value]);

  // ── Handle suggestion selection ───────────────────────────────────────────
  const selectSuggestion = useCallback((suggestion) => {
    const transliteratedStr = replaceLastWord(suggestion, false);
    lastTranslitRef.current = { original: value, transliterated: transliteratedStr };
    onChange(transliteratedStr);
    setSuggestions([]);
    setShowSuggestions(false);
    setActiveIdx(-1);
    // Return focus to input
    setTimeout(() => inputRef.current?.focus(), 0);
  }, [onChange, value, replaceLastWord]);

  // ── Keyboard navigation of suggestions ───────────────────────────────────
  function handleKeyDown(e) {
    // If transliteration is disabled, behave like a completely normal input field
    if (!isTranslitEnabled) return;

    // Undo transliteration if user immediately hits Backspace
    if (e.key === 'Backspace') {
      const { original, transliterated } = lastTranslitRef.current;
      if (value === transliterated && original) {
        e.preventDefault();
        onChange(original);
        lastTranslitRef.current = { original: '', transliterated: '' };
        return;
      }
    }

    if (!showSuggestions || suggestions.length === 0) return;

    // Auto-transliterate on Space
    if (e.key === ' ') {
      e.preventDefault();
      const topSuggestion = suggestions[activeIdx >= 0 ? activeIdx : 0];
      const transliteratedStr = replaceLastWord(topSuggestion, true); // add trailing space
      lastTranslitRef.current = { original: value, transliterated: transliteratedStr };
      onChange(transliteratedStr);
      setSuggestions([]);
      setShowSuggestions(false);
      setActiveIdx(-1);
      return;
    }

    // Auto-transliterate on Enter
    if (e.key === 'Enter') {
      e.preventDefault();
      const topSuggestion = suggestions[activeIdx >= 0 ? activeIdx : 0];
      const transliteratedStr = replaceLastWord(topSuggestion, false);
      lastTranslitRef.current = { original: value, transliterated: transliteratedStr };
      onChange(transliteratedStr);
      setSuggestions([]);
      setShowSuggestions(false);
      setActiveIdx(-1);
      return;
    }

    if (e.key === 'ArrowDown') {
      e.preventDefault();
      setActiveIdx((prev) => Math.min(prev + 1, suggestions.length - 1));
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      setActiveIdx((prev) => Math.max(prev - 1, 0));
    } else if (e.key === 'Escape') {
      setShowSuggestions(false);
    }
  }

  const inputClass = [
    variant === 'search' ? 'search-input' : 'form-input',
    hasError ? 'input-error' : '',
    'marathi-input-field',
    className,
  ].filter(Boolean).join(' ');

  return (
    <div className={`marathi-input-wrapper${variant === 'search' ? ' marathi-search-wrapper' : ''}`} ref={containerRef}>
      {/* Input field */}
      <input
        ref={inputRef}
        id={id}
        name={name}
        type="text"
        className={inputClass}
        placeholder={placeholder}
        value={value}
        onChange={(e) => {
          const newVal = e.target.value;
          // If the new typed string doesn't match the last transliterated state, clear the undo ref
          if (newVal !== lastTranslitRef.current.transliterated) {
            lastTranslitRef.current = { original: '', transliterated: '' };
          }
          onChange(newVal);
        }}
        onKeyDown={handleKeyDown}
        onFocus={() => { if (isTranslitEnabled && suggestions.length > 0) setShowSuggestions(true); }}
        autoComplete="off"
        autoFocus={autoFocus}
        disabled={disabled}
        dir={hasDevanagari(value) ? 'auto' : 'ltr'}
        aria-autocomplete="list"
        aria-expanded={showSuggestions}
        aria-haspopup="listbox"
        style={{
          fontFamily: hasDevanagari(value) ? 'var(--font-devanagari)' : 'inherit',
          paddingRight: '40px' // Ensure space for the toggle button on the right
        }}
      />

      {/* Transliteration ON/OFF Toggle Button */}
      <button
        type="button"
        className={`mi-toggle-btn ${isTranslitEnabled ? 'active' : 'inactive'}`}
        onClick={toggleTranslit}
        title={isTranslitEnabled ? 'Switch to English Typing' : 'Switch to Marathi Transliteration'}
        aria-label="Toggle Marathi Transliteration"
        tabIndex={-1}
      >
        {isTranslitEnabled ? 'अ' : 'A'}
      </button>

      {/* Keyboard mode hint (only for default inputs when translit is active to prevent search layout shift) */}
      {variant !== 'search' && isTranslitEnabled && value && isAscii(value) && suggestions.length > 0 && (
        <div className="mi-hint">
          {label || 'मराठी सुचवणी'} — Press Space/Enter or select
        </div>
      )}

      {/* Suggestions dropdown */}
      {isTranslitEnabled && showSuggestions && suggestions.length > 0 && (
        <ul
          className="mi-suggestions"
          role="listbox"
          id={`${id}-suggestions`}
        >
          {suggestions.map((s, idx) => (
            <li
              key={s}
              role="option"
              aria-selected={idx === activeIdx}
              className={`mi-suggestion-item${idx === activeIdx ? ' active' : ''}`}
              onMouseDown={(e) => {
                e.preventDefault(); // prevent blur before click
                selectSuggestion(s);
              }}
              onTouchEnd={(e) => {
                e.preventDefault();
                selectSuggestion(s);
              }}
              onClick={() => selectSuggestion(s)}
              id={`${id}-suggestion-${idx}`}
            >
              <span className="mi-marathi-text">{s}</span>
              <span className="mi-roman-text">{(value || '').match(/(\S+)$/)?.[1] || ''}</span>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
