import { useEffect, useRef, useState } from 'react';
import { ImagePlus, X, Save, RotateCcw, History, Radio, WifiOff, Bold, Italic, Code, Sigma, Brackets, Eye, EyeOff } from 'lucide-react';
import { toast } from 'sonner';
import { Modal, Field, Button, ErrorState, Avatar } from './ui';
import { useApp } from '../hooks/useApp';
import { useCardDoc } from '../hooks/useRealtime';
import { api } from '../services/api';
import Img from './Img';
import { colorFor } from '../services/colors';
import CollabText, { PlainText } from './CollabText';
import RichText from './RichText';
import { CLOZE_RE, hasCloze } from '../../../shared/cloze.js';
import { BRAND } from '../../../shared/brand.js';
const nextCloze = text => Math.max(0, ...[...String(text).matchAll(CLOZE_RE)].map(m => Number(m[1]))) + 1;
/** Re-renders when a shared Y.Text changes so the live preview follows collaborators' edits too. */
function useYTextValue(ytext, enabled) {
  const [value, setValue] = useState(() => ytext?.toString() || '');
  useEffect(() => { if (!ytext || !enabled) return; setValue(ytext.toString()); const fn = () => setValue(ytext.toString()); ytext.observe(fn); return () => ytext.unobserve(fn); }, [ytext, enabled]);
  return value;
}
function SideEditor({ side, index, collaborative, live, form, updateSide, pasteImage, preview, setPreview, children }) {
  const ref = useRef(null); const ytext = collaborative ? live.doc.getText(side) : null;
  const liveText = useYTextValue(ytext, collaborative && preview); const text = collaborative ? liveText : form[side].text;
  const wrap = (before, after, fallback) => ref.current?.wrap(before, after, fallback);
  const cloze = () => { const selected = ref.current?.selection() || ''; const n = nextCloze(collaborative ? ytext.toString() : form[side].text); wrap(`{{c${n}::`, '}}', selected || 'answer'); };
  const onKeyDown = e => { if ((e.metaKey || e.ctrlKey) && e.shiftKey && e.key.toLowerCase() === 'c') { e.preventDefault(); cloze(); } else if ((e.metaKey || e.ctrlKey) && !e.shiftKey && e.key === 'b') { e.preventDefault(); wrap('**', '**', 'bold'); } else if ((e.metaKey || e.ctrlKey) && !e.shiftKey && e.key === 'i') { e.preventDefault(); wrap('_', '_', 'italic'); } };
  const props = { 'aria-label': `${side} text`, autoFocus: !index, maxLength: 10000, placeholder: index ? 'The answer, in your own words…' : 'What do you want to remember?', onPaste: pasteImage(side) };
  return <div className="side-editor">
    <div className="side-label"><span>{index ? '02' : '01'}</span>{index ? 'BACK · ANSWER' : 'FRONT · QUESTION'}{!index && hasCloze(text) && <em className="cloze-flag">cloze card · back optional</em>}</div>
    <div className="editor-toolbar" role="toolbar" aria-label={`${side} formatting`}>
      <button type="button" title="Bold (⌘B)" onClick={() => wrap('**', '**', 'bold')}><Bold size={14}/></button><button type="button" title="Italic (⌘I)" onClick={() => wrap('_', '_', 'italic')}><Italic size={14}/></button><button type="button" title="Inline code" onClick={() => wrap('`', '`', 'code')}><Code size={14}/></button>
      <button type="button" title="Math · LaTeX between $…$ (use $$…$$ for a block)" onClick={() => wrap('$', '$', '\\frac{a}{b}')}><Sigma size={14}/></button>
      <button type="button" className="cloze-button" title="Cloze deletion (⌘⇧C) · hides the selection until the card is flipped" onClick={cloze}><Brackets size={14}/> Cloze</button>
      <button type="button" className={preview ? 'is-active' : ''} title={preview ? 'Hide preview' : 'Preview Markdown, math and cloze'} onClick={() => setPreview(!preview)} aria-pressed={preview}>{preview ? <EyeOff size={14}/> : <Eye size={14}/>}</button>
    </div>
    <div onKeyDown={onKeyDown}>{collaborative ? <CollabText ref={ref} ytext={ytext} awareness={live.awareness} label={props['aria-label']} autoFocus={props.autoFocus} placeholder={props.placeholder} onPaste={props.onPaste}/> : <PlainText ref={ref} value={form[side].text} onChange={v => updateSide(side, { text: v })} {...props}/>}</div>
    {preview && <div className="editor-preview"><span>PREVIEW{!index && hasCloze(text) ? ' · FRONT SHOWN WITH BLANKS' : ''}</span>{text.trim() ? <RichText text={text} cloze={!index && hasCloze(text) ? 'hide' : 'show'}/> : <p className="preview-empty">Nothing to preview yet.</p>}</div>}
    {children}
  </div>;
}
export default function CardEditor({ folder, card, onClose, onEditing, liveVersion }) {
  const { refresh, user } = useApp(); const blank = { front: { text: '', image: null }, back: { text: '', image: null }, tags: [], hint: '', source: '' };
  const key = `${BRAND.storage.draft}:${user.id}:${folder.id}:${card?.id || 'new'}`;
  const [form, setForm] = useState(() => { try { const draft = JSON.parse(sessionStorage.getItem(key)); if (draft) return draft; } catch {} return card ? { front: card.front, back: card.back, tags: card.tags, hint: card.hint, source: card.source } : blank; });
  const [tag, setTag] = useState(''), [busy, setBusy] = useState(false), [uploading, setUploading] = useState(''), [error, setError] = useState(''), [history, setHistory] = useState(null), [preview, setPreview] = useState(false);
  // Existing cards are co-edited through a shared CRDT document; new cards are drafted locally until created.
  const live = useCardDoc(card?.id, { name: user.name, color: colorFor(user.id) }, !!card);
  const collaborative = !!card && live.ready;
  const versionRef = useRef(card?.version ?? 0); useEffect(() => { if (liveVersion != null) versionRef.current = liveVersion; }, [liveVersion]); useEffect(() => { if (live.version != null) versionRef.current = live.version; }, [live.version]);
  useEffect(() => { onEditing?.(card?.id || 'new'); return () => onEditing?.(null); }, [card?.id]);
  useEffect(() => { try { sessionStorage.setItem(key, JSON.stringify(collaborative ? { ...form, front: { ...form.front, text: '' }, back: { ...form.back, text: '' } } : form)); } catch {} }, [form, key, collaborative]);
  const update = (field, value) => setForm(f => ({ ...f, [field]: value }));
  const updateSide = (side, patch) => setForm(f => ({ ...f, [side]: { ...f[side], ...patch } }));
  const textOf = side => collaborative ? live.doc.getText(side).toString() : form[side].text;
  function addTag() { const next = tag.trim().toLowerCase().replace(/^#/, '').slice(0, 30); if (next && !form.tags.includes(next) && form.tags.length < 10) update('tags', [...form.tags, next]); setTag(''); }
  async function upload(side, file) { if (!file) return; if (file.size > 5 * 1024 * 1024) { setError('Choose an image smaller than 5 MB.'); return; } setUploading(side); setError(''); try { const data = new FormData(); data.append('image', file); const r = await api(`/folders/${folder.id}/images`, { method: 'POST', body: data }); updateSide(side, { image: r.id }); } catch (e) { setError(e.message); } finally { setUploading(''); } }
  const pasteImage = side => e => { const file = [...e.clipboardData.items].find(i => i.type.startsWith('image/'))?.getAsFile(); if (file) { e.preventDefault(); upload(side, file); } };
  function restore(snapshot) {
    if (collaborative) for (const side of ['front', 'back']) { const t = live.doc.getText(side); live.doc.transact(() => { t.delete(0, t.length); t.insert(0, snapshot[side]?.text || ''); }); }
    setForm(f => ({ ...f, ...snapshot, front: { ...snapshot.front, text: collaborative ? f.front.text : snapshot.front?.text || '' }, back: { ...snapshot.back, text: collaborative ? f.back.text : snapshot.back?.text || '' } }));
    setHistory(null); toast.info(collaborative ? 'Previous version loaded for everyone editing. Save to restore it.' : 'Previous version loaded into your draft. Save to restore it.');
  }
  async function save(another = false) {
    const body = { ...form, front: { ...form.front, text: textOf('front') }, back: { ...form.back, text: textOf('back') } };
    if (!body.front.text.trim() && !body.front.image) { setError('Add text or an image to the front.'); return; }
    if (!body.back.text.trim() && !body.back.image && !hasCloze(body.front.text)) { setError('Add text or an image to the back, or turn the front into a cloze card with {{c1::answer}}.'); return; }
    setBusy(true); setError('');
    try { const finalTags = tag.trim() ? [...new Set([...form.tags, tag.trim().toLowerCase().replace(/^#/, '')])].slice(0, 10) : form.tags; const r = await api(card ? `/cards/${card.id}` : `/folders/${folder.id}/cards`, { method: card ? 'PATCH' : 'POST', body: { ...body, tags: finalTags, ...(card ? { version: versionRef.current } : {}) } }); if (r.card) versionRef.current = r.card.version; sessionStorage.removeItem(key); refresh(); toast.success(card ? 'Card updated' : 'Flashcard created'); if (another) { setForm(blank); setTag(''); } else onClose(); }
    catch (e) { setError(e.message); } finally { setBusy(false); }
  }
  const status = !card ? null : collaborative ? <span className="live-badge" title="Changes sync instantly with collaborators"><Radio size={12}/> Live{live.peers.length ? ` · ${live.peers.length} other${live.peers.length > 1 ? 's' : ''} editing` : ''}</span> : live.error ? <span className="live-badge offline" title={live.error}><WifiOff size={12}/> Solo edit</span> : <span className="live-badge offline"><Radio size={12}/> Connecting…</span>;
  return <Modal open onClose={onClose} wide title={card ? 'Make it memorable' : 'One new thing to remember'} description={collaborative ? `${folder.title} · Everyone with editor access sees your typing as it happens.` : `${folder.title} · Drafts are kept in this browser tab until saved.`}><form className="form-stack" onSubmit={e => { e.preventDefault(); save(); }}>
    {card && <div className="editor-live-row">{status}<div className="peer-list">{live.peers.map(p => <span className="peer" key={p.id} style={{ '--peer': p.color }} title={p.name}><Avatar user={{ name: p.name }} small/></span>)}</div></div>}
    <div className="card-editor-sides">{['front', 'back'].map((side, i) => <SideEditor key={side} side={side} index={i} collaborative={collaborative} live={live} form={form} updateSide={updateSide} pasteImage={pasteImage} preview={preview} setPreview={setPreview}>
      {form[side].image && <div className="editor-image"><Img id={form[side].image} alt={`${side} attachment`} sizes="(max-width: 640px) 90vw, 420px"/><button type="button" className="icon-button" aria-label={`Remove ${side} image`} onClick={() => updateSide(side, { image: null })}><X size={17}/></button></div>}<div className="editor-footer"><label className="upload-button"><ImagePlus size={17}/>{uploading === side ? 'Uploading…' : 'Add image'}<input type="file" accept="image/png,image/jpeg,image/webp" disabled={!!uploading} onChange={e => upload(side, e.target.files[0])}/></label><small>or paste a screenshot</small></div></SideEditor>)}</div>
    <p className="editor-syntax-hint">Markdown works everywhere: <code>**bold**</code>, <code>`code`</code>, lists. Math with <code>{'$e^{i\\pi}$'}</code>. Hide part of the front with <code>{'{{c1::answer}}'}</code> to make a cloze card.</p>
    <Field label="Tags · optional"><div className="tag-input">{form.tags.map(t => <span className="tag" key={t}>{t}<button type="button" aria-label={`Remove ${t} tag`} onClick={() => update('tags', form.tags.filter(v => v !== t))}><X size={12}/></button></span>)}<input aria-label="New tag" placeholder="Type a tag, press Enter" value={tag} maxLength={30} onChange={e => setTag(e.target.value)} onBlur={addTag} onKeyDown={e => { if (e.key === 'Enter' || e.key === ',') { e.preventDefault(); addTag(); } }}/></div></Field>
    <div className="two-columns"><Field label="Hint · optional"><input placeholder="A little nudge in the right direction" value={form.hint} maxLength={1000} onChange={e => update('hint', e.target.value)}/></Field><Field label="Source link · optional"><input type="url" placeholder="https://…" value={form.source} onChange={e => update('source', e.target.value)}/></Field></div>
    {card && <button type="button" className="text-button history-trigger" onClick={async () => { try { const r = await api(`/cards/${card.id}/revisions`); setHistory(r.revisions); } catch (e) { setError(e.message); } }}><History size={16}/> View version history</button>}
    {history && <div className="revision-list">{!history.length ? <p>No previous versions yet.</p> : history.map(r => <div key={r.id}><div><strong>Version {r.version + 1}</strong><span>{r.snapshot.front?.text || 'Image card'} · {r.editor?.name}</span></div><button type="button" className="text-button" onClick={() => restore(r.snapshot)}><RotateCcw size={15}/> Use version</button></div>)}</div>}
    {error && <ErrorState message={error}/>}
    <div className="modal-actions"><Button type="button" className="secondary" onClick={onClose}>Close</Button><div>{!card && <Button type="button" className="secondary" disabled={busy || !!uploading} onClick={() => save(true)}>Save & add another</Button>}<Button type="submit" className="primary" loading={busy} disabled={!!uploading}><Save size={16}/>{card ? 'Save changes' : 'Create flashcard'}</Button></div></div>
  </form></Modal>;
}
