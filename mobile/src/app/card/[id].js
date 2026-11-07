import { useEffect, useRef, useState } from 'react';
import { KeyboardAvoidingView, Platform, Pressable, ScrollView, Text, View } from 'react-native';
import { Alert } from '../../alert';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { findCard, removeCard, saveCard } from '../../offline';
import { FONT, useTheme } from '../../theme';
import { Button, ErrorBox, Field, Icon, Loading, Surface, Txt } from '../../components/ui';
import ImageField from '../../components/ImageField';
import { CLOZE_RE } from '../../../../shared/cloze.js';

const nextCloze = text => { CLOZE_RE.lastIndex = 0; return Math.max(0, ...[...String(text).matchAll(CLOZE_RE)].map(m => Number(m[1]))) + 1; };
const tagsOf = text => [...new Set(text.split(/[,\n]/).map(t => t.trim().toLowerCase()).filter(Boolean))].slice(0, 10);

/** Make or change one flashcard: text and a picture on each side, a hint, and tags. */
export default function CardEditor() {
  const { id, folder } = useLocalSearchParams();
  const isNew = id === 'new';
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const { c } = useTheme();
  const [state, setState] = useState({ loading: !isNew, error: '', card: null });
  const [front, setFront] = useState({ text: '', image: null, drawing: null }), [back, setBack] = useState({ text: '', image: null, drawing: null });
  const [hint, setHint] = useState(''), [tags, setTags] = useState('');
  const [saving, setSaving] = useState(false), [error, setError] = useState(''), [conflict, setConflict] = useState(false), [attempt, setAttempt] = useState(0);
  const selection = useRef({ start: 0, end: 0 });
  const [dirty, setDirty] = useState(false);

  useEffect(() => {
    if (isNew) return;
    let live = true;
    setState(s => ({ ...s, loading: true, error: '' }));
    findCard(folder, id).then(card => {
      if (!live) return;
      if (!card) return setState({ loading: false, error: 'This card no longer exists.', card: null });
      setState({ loading: false, error: '', card });
      setFront({ text: card.front.text || '', image: card.front.image || null, drawing: card.front.drawing || null });
      setBack({ text: card.back.text || '', image: card.back.image || null, drawing: card.back.drawing || null });
      setHint(card.hint || ''); setTags((card.tags || []).join(', ')); setDirty(false); setConflict(false);
    }, e => live && setState({ loading: false, error: e.message, card: null }));
    return () => { live = false; };
  }, [id, folder, isNew, attempt]);

  const edit = setter => value => { setter(value); setDirty(true); };
  const filled = side => !!(side.text.trim() || side.image || side.drawing);
  const hasCloze = /\{\{c\d+::/.test(front.text);

  function makeCloze() {
    const { start, end } = selection.current;
    if (end <= start) return Alert.alert('Select a word first', 'Select the word or phrase in the front text that you want to hide, then tap this again.');
    const picked = front.text.slice(start, end);
    edit(setFront)({ ...front, text: `${front.text.slice(0, start)}{{c${nextCloze(front.text)}::${picked}}}${front.text.slice(end)}` });
  }

  async function save() {
    if (saving) return;
    if (!filled(front)) return setError('Add text or a picture to the front.');
    if (!filled(back) && !hasCloze) return setError('Add text or a picture to the back, or hide a word on the front.');
    setSaving(true); setError('');
    const body = {
      front: { text: front.text, image: front.image, drawing: front.drawing }, back: { text: back.text, image: back.image, drawing: back.drawing },
      hint: hint.trim(), tags: tagsOf(tags), source: state.card?.source || '',
    };
    try {
      // Written to the phone first and sent when there is a connection; a refusal (too long, not allowed, changed elsewhere) comes back here.
      await saveCard({ folderId: folder, cardId: isNew ? null : id, body, version: state.card?.version });
      setDirty(false); router.back();
    } catch (e) {
      if (e.code === 'VERSION_CONFLICT') setConflict(true); else setError(e.message);
      setSaving(false);
    }
  }

  const close = () => (!dirty ? router.back() : Alert.alert('Discard your changes?', 'This card has edits that are not saved.', [{ text: 'Keep editing', style: 'cancel' }, { text: 'Discard', style: 'destructive', onPress: () => router.back() }]));
  const remove = () => Alert.alert('Delete this card?', 'It is removed along with its study history. This cannot be undone.', [
    { text: 'Cancel', style: 'cancel' },
    { text: 'Delete', style: 'destructive', onPress: async () => { try { await removeCard({ folderId: folder, cardId: id }); router.back(); } catch (e) { setError(e.message); } } },
  ]);

  const section = (title, side, setSide, placeholder, isFront) => <Surface style={{ gap: 12 }}>
    <Text style={{ fontFamily: FONT.semibold, fontSize: 11.5, letterSpacing: 1.4, color: c.accent }}>{title}</Text>
    <Field value={side.text} onChangeText={t => edit(setSide)({ ...side, text: t })} placeholder={placeholder} multiline maxLength={10000}
      onSelectionChange={isFront ? e => { selection.current = e.nativeEvent.selection; } : undefined}
      style={{ minHeight: 110, paddingTop: 12, textAlignVertical: 'top' }} />
    {isFront ? <Button small variant="ghost" icon="eye-off" title="Hide selected word (cloze)" onPress={makeCloze} style={{ alignSelf: 'flex-start' }} /> : null}
    <ImageField folderId={folder} value={side.image} onChange={v => edit(setSide)({ ...side, image: v })} />
    {side.drawing ? <Txt variant="small" style={{ fontStyle: 'italic' }}>This side also has a drawing. It is kept as it is; change it on remio.in.</Txt> : null}
  </Surface>;

  return <KeyboardAvoidingView style={{ flex: 1, backgroundColor: c.bg }} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
    <View style={{ flexDirection: 'row', alignItems: 'center', gap: 12, paddingHorizontal: 20, paddingTop: insets.top + 12, paddingBottom: 10 }}>
      <Pressable onPress={close} hitSlop={10} accessibilityRole="button" accessibilityLabel="Close"><Icon name="x" size={24} color={c.muted} /></Pressable>
      <Text style={{ flex: 1, fontFamily: FONT.display, fontSize: 22, letterSpacing: -0.5, color: c.ink }}>{isNew ? 'New card' : 'Edit card'}</Text>
      <Button title="Save" small loading={saving} disabled={state.loading || !!state.error} onPress={save} />
    </View>
    <ScrollView contentContainerStyle={{ padding: 20, paddingTop: 8, paddingBottom: 40 + insets.bottom, gap: 14 }} keyboardShouldPersistTaps="handled">
      {state.loading ? <Loading /> : null}
      {state.error ? <ErrorBox message={state.error} onRetry={() => setAttempt(a => a + 1)} /> : null}
      {!state.loading && !state.error ? <>
        {conflict ? <Surface style={{ gap: 10, borderColor: c.danger }}>
          <Txt variant="medium">This card changed somewhere else.</Txt>
          <Txt variant="small">Nothing was overwritten. Load the latest version, then make your change again.</Txt>
          <Button small variant="secondary" title="Load latest" onPress={() => setAttempt(a => a + 1)} />
        </Surface> : null}
        {section('FRONT  |  THE QUESTION', front, setFront, 'What do you want to remember?', true)}
        {section('BACK  |  THE ANSWER', back, setBack, hasCloze ? 'Optional: a cloze card shows the full sentence on the back.' : 'The answer', false)}
        <Field label="Hint (optional)" value={hint} onChangeText={t => edit(setHint)(t)} placeholder="A nudge, shown on request" maxLength={1000} />
        <Field label="Tags (optional, separated by commas)" value={tags} onChangeText={t => edit(setTags)(t)} placeholder="biology, chapter 3" autoCapitalize="none" />
        {error ? <Txt variant="small" style={{ color: c.danger }} accessibilityRole="alert">{error}</Txt> : null}
        {!isNew ? <Button title="Delete card" variant="danger" icon="trash-2" onPress={remove} /> : null}
      </> : null}
    </ScrollView>
  </KeyboardAvoidingView>;
}
