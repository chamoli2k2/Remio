import { useEffect, useId, useMemo, useRef, useState } from 'react';
import { Check, ChevronDown, Search } from 'lucide-react';

/** Accent- and case-blind, so "cote" finds Côte d'Ivoire and "aland" finds Åland Islands. */
const fold = s => s.normalize('NFD').replace(/\p{Diacritic}/gu, '').toLowerCase();

/** Roughly the height of eight rows. Kept here because the open/up decision has to know it too. */
const POPUP_MAX = 268;

/**
 * A country chooser that stays the size of a field.
 *
 * A native select is the obvious control for this and the wrong one: handed 245 countries the
 * browser opens a list as tall as the screen, painted in the operating system's colours rather than
 * ours, with no way to search it but holding a key down. This is the same control drawn as part of
 * the page — a fixed-height scrolling list, filtered as you type, no taller than it needs to be.
 *
 * The value is a country code, never a name. Display names drift between browser versions and these
 * end up stored on accounts and invoices, so the stable half is what travels. Where `name` is given
 * a hidden input carries the matching country name, because that is the shape the server stores and
 * a plain form post has to keep working without knowing any of this.
 */
export default function CountryPicker({
  value, onChange, options, name, disabled, label = 'Country',
  placeholder = 'Choose a country', searchFrom = 12,
}) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');
  const [active, setActive] = useState(0);
  const [drop, setDrop] = useState('down');
  const wrap = useRef(null), trigger = useRef(null), search = useRef(null), list = useRef(null);
  const id = useId();

  // No search box for a handful of countries: a field that sells to five markets does not need one,
  // and an empty text input above five rows only asks a question nobody had.
  const searchable = options.length > searchFrom;
  const chosen = options.find(c => c.code === value) || null;

  const shown = useMemo(() => {
    const q = fold(query.trim());
    if (!q) return options;
    return options.filter(c => fold(c.name).includes(q) || c.code.toLowerCase() === q || (c.dial || '').includes(q));
  }, [options, query]);

  const close = () => { setOpen(false); trigger.current?.focus(); };
  const pick = code => { onChange(code); setOpen(false); trigger.current?.focus(); };

  function openList() {
    if (disabled) return;
    // Flipped upwards when the list would otherwise run off the bottom of the window, which for a
    // field near the end of a form on a laptop screen is most of the time.
    const box = trigger.current.getBoundingClientRect();
    const below = window.innerHeight - box.bottom;
    setDrop(below < POPUP_MAX && box.top > below ? 'up' : 'down');
    setQuery('');
    setActive(Math.max(0, options.findIndex(c => c.code === value)));
    setOpen(true);
  }

  useEffect(() => { if (open) (searchable ? search : list).current?.focus(); }, [open, searchable]);

  useEffect(() => {
    if (!open) return;
    const away = e => { if (!wrap.current?.contains(e.target)) setOpen(false); };
    document.addEventListener('mousedown', away);
    return () => document.removeEventListener('mousedown', away);
  }, [open]);

  // Keeps the highlighted row on screen while arrowing through 245 of them.
  useEffect(() => { if (open) list.current?.querySelector('[data-active=true]')?.scrollIntoView({ block: 'nearest' }); }, [open, active]);

  function keys(e) {
    if (!open) {
      if (['Enter', ' ', 'ArrowDown'].includes(e.key)) { e.preventDefault(); openList(); }
      return;
    }
    // Tab leaves the field, so it closes the list rather than trapping focus inside it.
    if (e.key === 'Tab') { setOpen(false); return; }
    if (e.key === 'Escape') { e.preventDefault(); close(); return; }
    if (e.key === 'ArrowDown') { e.preventDefault(); setActive(a => Math.min(a + 1, shown.length - 1)); return; }
    if (e.key === 'ArrowUp') { e.preventDefault(); setActive(a => Math.max(a - 1, 0)); return; }
    if (e.key === 'Home') { e.preventDefault(); setActive(0); return; }
    if (e.key === 'End') { e.preventDefault(); setActive(shown.length - 1); return; }
    if (e.key === 'Enter') { e.preventDefault(); if (shown[active]) pick(shown[active].code); }
  }

  const activeId = shown[active] ? `${id}-${shown[active].code}` : undefined;

  return <div className={`cpick ${open ? 'is-open' : ''}`} ref={wrap} onKeyDown={keys}>
    {name && <input type="hidden" name={name} value={chosen?.name || ''}/>}
    <button type="button" ref={trigger} className="cpick-trigger" disabled={disabled}
      aria-haspopup="listbox" aria-expanded={open} aria-label={`${label}${chosen ? `: ${chosen.name}` : ''}`}
      onClick={() => (open ? close() : openList())}>
      <span className={chosen ? '' : 'cpick-empty-value'}>{chosen ? chosen.name : placeholder}</span>
      <ChevronDown size={15} aria-hidden="true"/>
    </button>
    {open && <div className={`cpick-pop is-${drop}`}>
      {searchable && <div className="cpick-search">
        <Search size={14} aria-hidden="true"/>
        <input ref={search} type="text" value={query} placeholder="Search countries" autoComplete="off"
          role="combobox" aria-expanded="true" aria-controls={`${id}-list`} aria-autocomplete="list"
          aria-activedescendant={activeId} aria-label={`Search ${label.toLowerCase()}`}
          onChange={e => { setQuery(e.target.value); setActive(0); }}/>
      </div>}
      <ul className="cpick-list" id={`${id}-list`} role="listbox" ref={list}
        tabIndex={searchable ? -1 : 0} aria-label={label} aria-activedescendant={activeId}>
        {shown.map((c, i) => <li key={c.code} id={`${id}-${c.code}`} role="option"
          data-active={i === active} aria-selected={c.code === value}
          className={`cpick-item ${i === active ? 'is-active' : ''}`}
          onMouseEnter={() => setActive(i)}
          // Without this the search input loses focus on press and the click never lands.
          onMouseDown={e => e.preventDefault()}
          onClick={() => pick(c.code)}>
          <span>{c.name}</span>
          {c.code === value && <Check size={14} aria-hidden="true"/>}
        </li>)}
        {!shown.length && <li className="cpick-none">Nothing matches “{query.trim()}”.</li>}
      </ul>
    </div>}
  </div>;
}
