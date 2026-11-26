import { useEffect, useId, useState, type KeyboardEvent } from 'react';
import { api, errorMessage } from '../services/api';

export type MedicineSuggestion = { _id: string; name: string; brand?: string; strength: string; dosageForm: string; packSize?: string; isDemo?: boolean; matchType: 'partial' | 'approximate' };
export function MedicineAutocomplete({ value, selectedId, onChange, onSelect, disabled = false }: { value: string; selectedId?: string; onChange: (value: string) => void; onSelect: (medicine: MedicineSuggestion) => void; disabled?: boolean }) {
  const [suggestions, setSuggestions] = useState<MedicineSuggestion[]>([]); const [focused, setFocused] = useState(false); const [index, setIndex] = useState(-1); const [limited, setLimited] = useState(false);
  const listId = useId();
  const [error, setError] = useState('');
  useEffect(() => {
    setError('');
    const query = value.trim(); if (query.length < 2 || selectedId) { setSuggestions([]); setLimited(false); return; }
    const controller = new AbortController();
    const timer = window.setTimeout(() => { void api.get('/search/suggestions', { params: { q: query }, signal: controller.signal }).then(({ data }) => { if (controller.signal.aborted) return; setSuggestions(data.data.suggestions); setLimited(data.data.approximateLimited); setIndex(-1); }).catch((failure) => { if (!controller.signal.aborted) { setSuggestions([]); setLimited(false); setError(errorMessage(failure)); } }); }, 250);
    return () => { window.clearTimeout(timer); controller.abort(); };
  }, [value, selectedId]);
  function choose(medicine: MedicineSuggestion) { onSelect(medicine); setSuggestions([]); setFocused(false); setIndex(-1); }
  function keyboard(event: KeyboardEvent<HTMLInputElement>) {
    if (event.key === 'Escape') { setFocused(false); setIndex(-1); return; }
    if (!suggestions.length) return;
    if (event.key === 'ArrowDown') { event.preventDefault(); setFocused(true); setIndex((current) => Math.min(suggestions.length - 1, current + 1)); }
    if (event.key === 'ArrowUp') { event.preventDefault(); setFocused(true); setIndex((current) => Math.max(0, current - 1)); }
    if (event.key === 'Enter' && focused && index >= 0 && suggestions[index]) { event.preventDefault(); choose(suggestions[index]!); }
  }
  const open = focused && suggestions.length > 0;
  return <div className="medicine-autocomplete"><input disabled={disabled} aria-label="Search medicine" role="combobox" aria-autocomplete="list" aria-expanded={open} aria-controls={listId} aria-activedescendant={open && index >= 0 ? `${listId}-${index}` : undefined} autoComplete="off" maxLength={100} value={value} onChange={(event) => { onChange(event.target.value); setFocused(true); }} onFocus={() => setFocused(true)} onBlur={() => setFocused(false)} onKeyDown={keyboard} placeholder="Brand, generic, composition or strength"/>
    {open && <div className="medicine-suggestions" id={listId} role="listbox" aria-label="Medicine suggestions">{suggestions.some((item) => item.matchType === 'approximate') && <div className="suggestion-note">Similar spelling only. Check the medicine and strength before selecting.</div>}{suggestions.map((medicine, i) => <button type="button" role="option" aria-selected={i === index} id={`${listId}-${i}`} key={medicine._id} onMouseDown={(event) => event.preventDefault()} onClick={() => choose(medicine)}><strong>{medicine.name}{medicine.isDemo ? ' - DEMO' : ''}</strong><small>{[medicine.brand, medicine.strength, medicine.dosageForm, medicine.packSize].filter(Boolean).join(' · ')}</small></button>)}{limited && <div className="suggestion-note">Suggestion coverage is limited; refine the query.</div>}</div>}
    {error && <p className="inline-error" role="alert">Suggestions unavailable: {error}</p>}
  </div>;
}
