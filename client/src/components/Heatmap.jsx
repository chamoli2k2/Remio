import { useCallback, useMemo, useRef, useState } from 'react';
const DAY = 86400000;
const utcDay = d => { const s = new Date(d); s.setUTCHours(0, 0, 0, 0); return s; };
const key = d => d.toISOString().slice(0, 10);
/** Must match `.heatmap` in styles.css: a cell, the gap between cells, and the weekday label column. */
const CELL = 12, GAP = 3, LABELS = 30;
/**
 * GitHub-style contribution grid: one column per week, one cell per UTC day, shaded by review count.
 *
 * The cells keep one size and the grid shows as many recent weeks as its box has room for, up to
 * `weeks`: a phone sees the last few months, a wide screen most of the year, and nowhere do the
 * squares balloon to fill the width.
 */
export default function Heatmap({ data = [], weeks: most = 53, now = new Date() }) {
  const [room, setRoom] = useState(26);
  const observer = useRef(null);
  const boxRef = useCallback(el => {
    observer.current?.disconnect();
    if (!el) return;
    const fit = () => setRoom(Math.max(8, Math.floor((el.clientWidth - LABELS + GAP) / (CELL + GAP))));
    observer.current = new ResizeObserver(fit);
    observer.current.observe(el);
    fit();
  }, []);
  const weeks = Math.min(most, room);
  const { columns, months, max } = useMemo(() => {
    const byDate = new Map(data.map(d => [d.date, d])); const today = utcDay(now);
    const end = new Date(today.getTime() + (6 - today.getUTCDay()) * DAY); // pad to the end of the current week (Saturday)
    const start = new Date(end.getTime() - (weeks * 7 - 1) * DAY);
    const columns = []; const months = []; let max = 0;
    for (let w = 0; w < weeks; w++) {
      const col = [];
      for (let i = 0; i < 7; i++) { const d = new Date(start.getTime() + (w * 7 + i) * DAY); const entry = byDate.get(key(d)); const count = d > today ? null : entry?.count || 0; if (count) max = Math.max(max, count); col.push({ date: key(d), count, recalled: entry?.recalled || 0 }); }
      const first = new Date(start.getTime() + w * 7 * DAY);
      // A label needs about three columns of room, so one squeezed against the left edge is dropped.
      if (first.getUTCDate() <= 7 && w <= weeks - 3) months.push({ index: w, label: first.toLocaleDateString(undefined, { month: 'short', timeZone: 'UTC' }) });
      columns.push(col);
    }
    return { columns, months, max };
  }, [data, weeks, now]);
  const level = count => count == null ? 'future' : count === 0 ? 0 : Math.min(4, Math.ceil(count / Math.max(1, max) * 4));
  const track = `repeat(${weeks}, ${CELL}px)`;
  return <div className="heatmap" ref={boxRef} role="img" aria-label={`Study activity for the last ${weeks} weeks`}>
    <div className="heatmap-months" style={{ gridTemplateColumns: track }}>{months.map(m => <span key={m.index} style={{ gridColumnStart: m.index + 1 }}>{m.label}</span>)}</div>
    <div className="heatmap-body"><div className="heatmap-days"><span>Mon</span><span>Wed</span><span>Fri</span></div>
      <div className="heatmap-grid" style={{ gridTemplateColumns: track }}>{columns.map((col, w) => <div className="heatmap-week" key={w}>{col.map(c => <span key={c.date} className={`heatmap-cell level-${level(c.count)}`} title={c.count == null ? '' : `${c.date}: ${c.count} review${c.count === 1 ? '' : 's'}${c.count ? `, ${Math.round(c.recalled / c.count * 100)}% recalled` : ''}`}/>)}</div>)}</div></div>
    <div className="heatmap-legend"><span>Less</span>{[0, 1, 2, 3, 4].map(l => <span key={l} className={`heatmap-cell level-${l}`}/>)}<span>More</span></div>
  </div>;
}
