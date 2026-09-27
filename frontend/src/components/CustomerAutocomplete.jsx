/**
 * CustomerAutocomplete Component
 * Keyboard-first customer selection autocomplete box.
 * Supports Marathi typing, English transliteration, and fuzzy search matching.
 */

import { useState, useRef, useEffect, forwardRef, useImperativeHandle } from 'react';
import { applyFuzzyFilter } from '../utils/fuzzySearch';
import { getTransliterationSuggestions } from '../utils/transliterate';

const CustomerAutocomplete = forwardRef(function CustomerAutocomplete(
  {
    customers = [],
    selectedCustomer = null,
    onSelectCustomer,
    placeholder = 'Type customer name or mobile...',
    hasError = false,
    id = 'customer-autocomplete-input',
    onNavigateNext,
    onNavigatePrev
  },
  ref
) {
  const [query, setQuery] = useState('');
  const [isOpen, setIsOpen] = useState(false);
  const [highlightedIndex, setHighlightedIndex] = useState(0);
  const [translitPills, setTranslitPills] = useState([]);

  const storageKey = 'translit_customer_autocomplete_enabled';
  const [isTranslitEnabled, setIsTranslitEnabled] = useState(() => {
    try {
      const saved = localStorage.getItem(storageKey);
      return saved !== null ? JSON.parse(saved) : true;
    } catch {
      return true;
    }
  });

  const inputRef = useRef(null);
  const dropdownRef = useRef(null);

  const toggleTranslit = (e) => {
    e.preventDefault();
    e.stopPropagation();
    setIsTranslitEnabled((prev) => {
      const next = !prev;
      try {
        localStorage.setItem(storageKey, JSON.stringify(next));
      } catch {}
      return next;
    });
    setTimeout(() => inputRef.current?.focus(), 0);
  };

  useImperativeHandle(ref, () => ({
    focus: () => {
      inputRef.current?.focus();
    },
    select: () => {
      inputRef.current?.select();
    },
    clear: () => {
      setQuery('');
      setIsOpen(false);
    }
  }));

  // Synchronize initial or external customer selection
  useEffect(() => {
    if (selectedCustomer) {
      setQuery(selectedCustomer.name);
    }
  }, [selectedCustomer]);

  // Generate fuzzy customer matches
  const filteredCustomers = applyFuzzyFilter(customers, query, ['name', 'mobile', 'search_keywords']);

  // Generate Marathi transliteration pills for query
  useEffect(() => {
    if (isTranslitEnabled && query && query.trim()) {
      const pills = getTransliterationSuggestions(query);
      setTranslitPills(pills || []);
    } else {
      setTranslitPills([]);
    }
  }, [query, isTranslitEnabled]);

  // Adjust highlight index bounds
  useEffect(() => {
    if (highlightedIndex >= filteredCustomers.length) {
      setHighlightedIndex(Math.max(0, filteredCustomers.length - 1));
    }
  }, [filteredCustomers, highlightedIndex]);

  function handleInputChange(e) {
    const val = e.target.value;
    setQuery(val);
    setIsOpen(true);
    setHighlightedIndex(0);
    if (!val) {
      onSelectCustomer(null);
    }
  }

  function handleSelect(customer) {
    if (!customer) return;
    onSelectCustomer(customer);
    setQuery(customer.name);
    setIsOpen(false);
  }

  function handleBlur() {
    setTimeout(() => {
      if (!selectedCustomer && query && query.trim()) {
        const q = query.trim().toLowerCase();
        const exact = customers.find(
          (c) => c.name.toLowerCase() === q || (c.mobile && c.mobile === query.trim())
        );
        if (exact) {
          handleSelect(exact);
        } else if (filteredCustomers.length === 1) {
          handleSelect(filteredCustomers[0]);
        }
      }
    }, 180);
  }

  function handleKeyDown(e) {
    if (e.key === ' ' && isTranslitEnabled && translitPills.length > 0) {
      const words = query.trim().split(/\s+/);
      const lastWord = words[words.length - 1];
      if (lastWord && !/[\u0900-\u097F]/.test(lastWord)) {
        e.preventDefault();
        const top = translitPills[0];
        const newQuery = query.replace(/\S+$/, top) + ' ';
        setQuery(newQuery);
        setIsOpen(true);
        return;
      }
    }

    if (e.key === 'ArrowDown') {
      if (!isOpen || filteredCustomers.length === 0) {
        if (onNavigateNext) {
          e.preventDefault();
          onNavigateNext();
        } else {
          setIsOpen(true);
        }
      } else {
        e.preventDefault();
        setHighlightedIndex((prev) => (prev + 1) % Math.max(1, filteredCustomers.length));
      }
    } else if (e.key === 'ArrowUp') {
      if (isOpen && filteredCustomers.length > 0) {
        e.preventDefault();
        setHighlightedIndex((prev) => (prev - 1 + filteredCustomers.length) % Math.max(1, filteredCustomers.length));
      } else if (onNavigatePrev) {
        e.preventDefault();
        onNavigatePrev();
      }
    } else if (e.key === 'ArrowRight') {
      const target = e.target;
      const isAtEnd = target.selectionStart === target.selectionEnd && target.selectionStart === target.value.length;
      const isAllSelected = target.selectionStart === 0 && target.selectionEnd === target.value.length;
      if ((isAtEnd || isAllSelected || !isOpen) && onNavigateNext) {
        e.preventDefault();
        setIsOpen(false);
        onNavigateNext();
      }
    } else if (e.key === 'ArrowLeft') {
      const target = e.target;
      const isAtStart = target.selectionStart === 0 && target.selectionEnd === 0;
      const isAllSelected = target.selectionStart === 0 && target.selectionEnd === target.value.length;
      if ((isAtStart || isAllSelected || !isOpen) && onNavigatePrev) {
        e.preventDefault();
        setIsOpen(false);
        onNavigatePrev();
      }
    } else if (e.key === 'Enter') {
      if (isOpen && filteredCustomers.length > 0 && highlightedIndex >= 0) {
        e.preventDefault();
        e.stopPropagation();
        const chosen = filteredCustomers[highlightedIndex];
        if (chosen) {
          handleSelect(chosen);
        }
      } else if (onNavigateNext) {
        e.preventDefault();
        onNavigateNext();
      }
    } else if (e.key === 'Escape') {
      setIsOpen(false);
    }
  }

  // Close dropdown on outside click
  useEffect(() => {
    function handleClickOutside(event) {
      if (
        dropdownRef.current &&
        !dropdownRef.current.contains(event.target) &&
        inputRef.current &&
        !inputRef.current.contains(event.target)
      ) {
        setIsOpen(false);
      }
    }
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  // Auto-scroll highlighted item into view
  useEffect(() => {
    if (isOpen && dropdownRef.current) {
      const activeEl = dropdownRef.current.children[highlightedIndex];
      if (activeEl) {
        activeEl.scrollIntoView({ block: 'nearest' });
      }
    }
  }, [highlightedIndex, isOpen]);

  return (
    <div style={{ position: 'relative', width: '100%' }}>
      <div style={{ position: 'relative', display: 'flex', alignItems: 'center' }}>
        <input
          ref={inputRef}
          id={id}
          name="customer"
          type="text"
          className={`input-field ${hasError ? 'input-error' : ''}`}
          placeholder={placeholder}
          title={placeholder}
          value={query}
          onChange={handleInputChange}
          onFocus={(e) => {
            e.target.select();
            setIsOpen(true);
          }}
          onBlur={handleBlur}
          onKeyDown={handleKeyDown}
          autoComplete="off"
          style={{
            fontSize: '1rem',
            padding: '0.65rem 0.85rem',
            paddingRight: (query || selectedCustomer) ? '4rem' : '2.4rem',
            width: '100%',
            borderColor: selectedCustomer ? '#16a34a' : undefined,
            backgroundColor: selectedCustomer ? '#f0fdf4' : undefined,
            fontWeight: selectedCustomer ? 600 : 400
          }}
        />
        
        {/* Marathi Transliteration Toggle Button */}
        <button
          type="button"
          className={`mi-toggle-btn ${isTranslitEnabled ? 'active' : 'inactive'}`}
          onClick={toggleTranslit}
          title={isTranslitEnabled ? 'मराठी टायपिंग चालू आहे (Switch to English)' : 'मराठी टायपिंग बंद आहे (Switch to Marathi)'}
          aria-label="Toggle Marathi Transliteration"
          tabIndex={-1}
          style={{
            position: 'absolute',
            right: (query || selectedCustomer) ? '34px' : '8px',
            top: '50%',
            transform: 'translateY(-50%)',
            zIndex: 2,
            width: '24px',
            height: '24px',
            fontSize: '0.78rem',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            borderRadius: '4px',
            cursor: 'pointer'
          }}
        >
          {isTranslitEnabled ? 'अ' : 'A'}
        </button>

        {selectedCustomer && !query && (
          <span
            style={{
              position: 'absolute',
              right: '34px',
              fontSize: '0.8rem',
              color: '#16a34a',
              fontWeight: 700,
              pointerEvents: 'none'
            }}
          >
            ✓
          </span>
        )}
        {(query || selectedCustomer) && (
          <button
            type="button"
            onClick={() => {
              setQuery('');
              onSelectCustomer(null);
              setIsOpen(true);
              inputRef.current?.focus();
            }}
            style={{
              position: 'absolute',
              right: '8px',
              background: 'none',
              border: 'none',
              color: '#94a3b8',
              cursor: 'pointer',
              fontSize: '0.9rem',
              padding: '2px 6px',
              borderRadius: '50%',
            }}
            title="Clear customer"
          >
            ✕
          </button>
        )}
      </div>

      {/* Marathi Transliteration Hint Pills */}
      {translitPills.length > 0 && (
        <div style={{ display: 'flex', gap: '6px', flexWrap: 'wrap', marginTop: '4px' }}>
          {translitPills.slice(0, 3).map((pill, idx) => (
            <button
              key={idx}
              type="button"
              className="translit-pill"
              onMouseDown={(e) => {
                e.preventDefault();
                setQuery(pill);
                setIsOpen(true);
                setTimeout(() => inputRef.current?.focus(), 0);
              }}
              onTouchEnd={(e) => {
                e.preventDefault();
                setQuery(pill);
                setIsOpen(true);
                setTimeout(() => inputRef.current?.focus(), 0);
              }}
              onClick={() => {
                setQuery(pill);
                setIsOpen(true);
                inputRef.current?.focus();
              }}
              style={{
                fontSize: '0.75rem',
                padding: '2px 8px',
                background: '#e0f2fe',
                color: '#0369a1',
                border: '1px solid #bae6fd',
                borderRadius: '4px',
                cursor: 'pointer'
              }}
            >
              {pill}
            </button>
          ))}
        </div>
      )}

      {/* Autocomplete Dropdown List */}
      {isOpen && filteredCustomers.length > 0 && (
        <ul
          ref={dropdownRef}
          className="autocomplete-dropdown"
          style={{
            position: 'absolute',
            top: '100%',
            left: 0,
            right: 0,
            zIndex: 1000,
            maxHeight: '230px',
            overflowY: 'auto',
            background: '#ffffff',
            border: '2px solid #3b82f6',
            borderRadius: '6px',
            boxShadow: '0 12px 24px -4px rgba(0,0,0,0.18)',
            listStyle: 'none',
            margin: '4px 0 0 0',
            padding: 0
          }}
        >
          {filteredCustomers.map((cust, idx) => {
            const isHighlighted = idx === highlightedIndex;
            const isSelected = selectedCustomer?.id === cust.id;

            return (
              <li
                key={cust.id}
                onMouseDown={(e) => {
                  e.preventDefault();
                  handleSelect(cust);
                }}
                onTouchEnd={(e) => {
                  e.preventDefault();
                  handleSelect(cust);
                }}
                onClick={() => handleSelect(cust)}
                onMouseEnter={() => setHighlightedIndex(idx)}
                style={{
                  padding: '0.65rem 0.95rem',
                  cursor: 'pointer',
                  background: isHighlighted
                    ? '#1d4ed8'
                    : isSelected
                    ? '#eff6ff'
                    : '#ffffff',
                  color: isHighlighted ? '#ffffff' : '#0f172a',
                  borderBottom: '1px solid #e2e8f0',
                  borderLeft: isHighlighted ? '4px solid #60a5fa' : isSelected ? '4px solid #3b82f6' : '4px solid transparent',
                  display: 'flex',
                  justifyContent: 'space-between',
                  alignItems: 'center',
                  transition: 'background 0.1s ease'
                }}
              >
                <div style={{ display: 'flex', flexDirection: 'column', gap: '3px' }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                    <span style={{ fontWeight: isHighlighted || isSelected ? 700 : 600, fontSize: '0.95rem' }}>
                      {cust.name}
                    </span>
                    {isSelected && (
                      <span
                        style={{
                          fontSize: '0.72rem',
                          padding: '1px 6px',
                          background: isHighlighted ? 'rgba(255,255,255,0.25)' : '#dcfce7',
                          color: isHighlighted ? '#ffffff' : '#15803d',
                          borderRadius: '4px',
                          fontWeight: 700
                        }}
                      >
                        ✓ Selected
                      </span>
                    )}
                  </div>
                  {cust.search_keywords && (
                    <div
                      style={{
                        fontSize: '0.73rem',
                        color: isHighlighted ? 'rgba(255,255,255,0.9)' : '#64748b',
                        display: 'flex',
                        gap: '4px',
                        flexWrap: 'wrap'
                      }}
                    >
                      {cust.search_keywords.split(',').slice(0, 3).map((kw, i) => (
                        <span
                          key={i}
                          style={{
                            background: isHighlighted ? 'rgba(255,255,255,0.2)' : '#f1f5f9',
                            padding: '1px 5px',
                            borderRadius: '3px'
                          }}
                        >
                          {kw.trim()}
                        </span>
                      ))}
                    </div>
                  )}
                </div>
                <span
                  style={{
                    fontSize: '0.82rem',
                    color: isHighlighted ? 'rgba(255,255,255,0.9)' : '#64748b',
                    fontWeight: 500
                  }}
                >
                  {cust.mobile || ''}
                </span>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
});

export default CustomerAutocomplete;
