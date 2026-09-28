import { useCallback, useEffect, useId, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { Check, ChevronDown, Search } from 'lucide-react';

/** Accent- and case-blind, so "cote" finds Côte d'Ivoire and "aland" finds Åland Islands. */
export const fold = s => s.normalize('NFD').replace(/\p{Diacritic}/gu, '').toLowerCase();

/** Roughly the height of eight rows. Kept here because the open-upwards decision has to know it. */
const LIST_MAX = 268;
const GAP = 5;

/**
 * The one dropdown in the app.
 *
 * A native select is drawn by the operating system, not by us: different metrics on every platform,
 * colours that ignore the dark theme, and, handed a long list, a popup as tall as the screen with no
 * way to search it but holding a key down. This is the same control drawn as part of the page, so a
 * dropdown in a toolbar looks like a dropdown in a form looks like a dropdown in a table.
 *
 * Options are `{ value, label }` and the value travels as-is, numbers included, so a caller can hand
 * `onChange` straight to a numeric setter without parsing anything back out of an event.
 *
 * The popup is portalled to the body and positioned against the viewport. That looks like overkill
 * next to an absolutely-positioned list, and it is the only version that survives every place this
 * is used: a table cell inside `overflow:auto` clips an absolute popup, and so does a modal.
 */
export default function Select({
  value, onChange, options, name, disabled, label,
  placeholder = 'Choose one', searchFrom = 12, searchPlaceholder = 'Search',
  match, formValue = o => o.value, compact = false, className = '',
}) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');
  const [active, setActive] = useState(0);
  const [box, setBox] = useState(null);
  const wrap = useRef(null), trigger = useRef(null), pop = useRef(null), search = useRef(null), list = useRef(null);
  const id = useId();

  // No search box for a handful of options: an empty text input above five rows only asks a question
  // nobody had. It appears when the list is long enough that scrolling it would be the alternative.
  const searchable = options.length > searchFrom;
  const chosen = options.find(o => o.value === value) || null;

  const shown = useMemo(() => {
    const q = fold(query.trim());
    if (!q) return options;
    const test = match || ((o, needle) => fold(o.label).includes(needle));
    return options.filter(o => test(o, q));
  }, [options, query, match]);

  const place = useCallback(() => {
    const t = trigger.current;
    if (!t) return;
    const r = t.getBoundingClientRect();
    const below = window.innerHeight - r.bottom, above = r.top;
    // Flipped upwards when the list would otherwise run off the bottom of the window, which for a
    // field near the end of a form on a laptop screen is most of the time.
    const up = below < LIST_MAX && above > below;
    setBox({
      up, top: r.bottom + GAP, bottom: window.innerHeight - r.top + GAP,
      left: r.left, right: window.innerWidth - r.right, width: r.width,
      // A compact trigger is narrower than its own options, so its popup grows past it. Anchored to
      // the right edge once the trigger sits in the right half of the window, where growing
      // rightwards would put half the list off-screen.
      end: compact && r.left > window.innerWidth * 0.55,
      room: Math.max(150, (up ? above : below) - 14),
    });
  }, [compact]);

  const close = () => { setOpen(false); trigger.current?.focus(); };
  const pick = v => { onChange(v); setOpen(false); trigger.current?.focus(); };

  function openList() {
    if (disabled) return;
    place();
    setQuery('');
    setActive(Math.max(0, options.findIndex(o => o.value === value)));
    setOpen(true);
  }

  useEffect(() => { if (open) (searchable ? search : list).current?.focus(); }, [open, searchable]);

  useEffect(() => {
    if (!open) return;
    // The popup lives on the body, so "outside" has to be asked of both halves of the control.
    const away = e => { if (!wrap.current?.contains(e.target) && !pop.current?.contains(e.target)) setOpen(false); };
    const follow = () => place();
    document.addEventListener('mousedown', away);
    // Capturing, because the thing that scrolls is usually a panel rather than the window.
    window.addEventListener('scroll', follow, true);
    window.addEventListener('resize', follow);
    return () => {
      document.removeEventListener('mousedown', away);
      window.removeEventListener('scroll', follow, true);
      window.removeEventListener('resize', follow);
    };
  }, [open, place]);

  // Keeps the highlighted row on screen while arrowing through a long list.
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
    if (e.key === 'Enter') { e.preventDefault(); if (shown[active]) pick(shown[active].value); }
  }

  const rowId = i => `${id}-o${i}`;
  const activeId = shown[active] ? rowId(active) : undefined;

  return <div className={`sel ${compact ? 'is-compact' : ''} ${open ? 'is-open' : ''} ${className}`.trim()} ref={wrap} onKeyDown={keys}>
    {name && <input type="hidden" name={name} value={chosen ? formValue(chosen) : ''}/>}
    <button type="button" ref={trigger} className="sel-trigger" disabled={disabled}
      aria-haspopup="listbox" aria-expanded={open}
      aria-label={label ? `${label}${chosen ? `: ${chosen.label}` : ''}` : undefined}
      onClick={() => (open ? close() : openList())}>
      <span className={chosen ? '' : 'sel-empty'}>{chosen ? chosen.label : placeholder}</span>
      <ChevronDown size={compact ? 14 : 15} aria-hidden="true"/>
    </button>
    {open && box && createPortal(
      <div ref={pop} className={`sel-pop ${box.up ? 'is-up' : 'is-down'} ${compact ? 'is-compact' : ''}`} style={{
        [box.up ? 'bottom' : 'top']: box.up ? box.bottom : box.top,
        ...(box.end ? { right: box.right } : { left: box.left }),
        [compact ? 'minWidth' : 'width']: box.width,
        maxHeight: box.room,
      }}>
        {searchable && <div className="sel-search">
          <Search size={14} aria-hidden="true"/>
          <input ref={search} type="text" value={query} placeholder={searchPlaceholder} autoComplete="off"
            role="combobox" aria-expanded="true" aria-controls={`${id}-list`} aria-autocomplete="list"
            aria-activedescendant={activeId} aria-label={searchPlaceholder}
            onChange={e => { setQuery(e.target.value); setActive(0); }}/>
        </div>}
        <ul className="sel-list" id={`${id}-list`} role="listbox" ref={list}
          tabIndex={searchable ? -1 : 0} aria-label={label} aria-activedescendant={activeId}>
          {shown.map((o, i) => <li key={String(o.value)} id={rowId(i)} role="option"
            data-active={i === active} aria-selected={o.value === value}
            className={`sel-item ${i === active ? 'is-active' : ''}`}
            onMouseEnter={() => setActive(i)}
            // Without this the search input loses focus on press and the click never lands.
            onMouseDown={e => e.preventDefault()}
            onClick={() => pick(o.value)}>
            <span>{o.label}</span>
            {o.value === value && <Check size={14} aria-hidden="true"/>}
          </li>)}
          {!shown.length && <li className="sel-none">Nothing matches “{query.trim()}”.</li>}
        </ul>
      </div>, document.body)}
  </div>;
}

/** Spares every caller the same three-line map from a list of plain values. */
export const optionsOf = (values, labelOf = String) => values.map(v => ({ value: v, label: labelOf(v) }));
