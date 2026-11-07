import RemoteImage from '../../components/RemoteImage';
import { useEffect, useState } from 'react';
import { Image, KeyboardAvoidingView, Platform, ScrollView, TextInput, View, useWindowDimensions } from 'react-native';
import { Alert } from '../../alert';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useLocalSearchParams, useNavigation } from 'expo-router';
import { api } from '../../api';
import { cachedApi, discardLocalNote, isLocal, saveNote } from '../../offline';
import { segmentsOf, NOTE_LIMITS } from '../../../../shared/notes.js';
import { FONT, useTheme } from '../../theme';
import { BackButton, Button, ErrorBox, Header, IconButton, Loading, Txt } from '../../components/ui';
import Rich from '../../components/Rich';

export default function NoteScreen() {
  const { id } = useLocalSearchParams();
  const { c } = useTheme();
  const { width } = useWindowDimensions();
  const navigation = useNavigation();
  const [state, setState] = useState({ loading: true, error: '', note: null, role: null });
  const [editing, setEditing] = useState(false), [title, setTitle] = useState(''), [body, setBody] = useState('');
  const [saving, setSaving] = useState(false), [conflict, setConflict] = useState(false), [attempt, setAttempt] = useState(0);
  const { note, role } = state;
  const canEdit = ['owner', 'editor'].includes(role);
  const dirty = editing && note && (title !== note.title || body !== note.body);

  useEffect(() => {
    let live = true;
    setState(s => ({ ...s, loading: true, error: '' }));
    cachedApi(`/notes/${id}`).then(r => live && setState({ loading: false, error: '', note: r.note, role: r.role }), e => live && setState(s => ({ ...s, loading: false, error: e.message })));
    return () => { live = false; };
  }, [id, attempt]);

  // Unsaved typing is never thrown away without asking.
  useEffect(() => navigation.addListener('beforeRemove', e => {
    if (!dirty) return;
    e.preventDefault();
    Alert.alert('Discard your changes?', 'This page has edits that are not saved.', [{ text: 'Keep editing', style: 'cancel' }, { text: 'Discard', style: 'destructive', onPress: () => navigation.dispatch(e.data.action) }]);
  }), [navigation, dirty]);

  function startEdit() { setTitle(note.title); setBody(note.body); setConflict(false); setEditing(true); }

  async function save() {
    if (saving || !dirty) return;
    setSaving(true);
    try {
      await saveNote({ noteId: id, version: note.version, title, body });
      setEditing(false); setConflict(false); setAttempt(a => a + 1);
    } catch (e) {
      if (e.code === 'VERSION_CONFLICT') setConflict(true);
      else Alert.alert('Not saved', e.message);
    } finally { setSaving(false); }
  }

  const removePage = () => Alert.alert('Delete this page?', 'The page and its history are removed. This cannot be undone.', [
    { text: 'Cancel', style: 'cancel' },
    { text: 'Delete', style: 'destructive', onPress: async () => { try { if (isLocal(id)) discardLocalNote(id); else await api(`/notes/${id}`, { method: 'DELETE' }); setEditing(false); navigation.goBack(); } catch (e) { Alert.alert('Not deleted', e.message); } } },
  ]);

  const reloadLatest = () => { setEditing(false); setConflict(false); setAttempt(a => a + 1); };

  return <SafeAreaView style={{ flex: 1, backgroundColor: c.bg }}>
    <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
      <ScrollView contentContainerStyle={{ padding: 20, paddingBottom: 60, gap: 16 }} keyboardShouldPersistTaps="handled">
        <Header title={editing ? 'Editing page' : note?.title || 'Untitled page'} left={<BackButton />}
          right={note && canEdit ? (editing ? <Button title="Save" small loading={saving} disabled={!dirty} onPress={save} /> : <IconButton name="edit-2" label="Edit page" onPress={startEdit} />) : null} />
        {state.loading && !note ? <Loading /> : null}
        {state.error ? <ErrorBox message={state.error} onRetry={() => setAttempt(a => a + 1)} /> : null}
        {conflict ? <View style={{ gap: 10, padding: 14, borderRadius: 14, backgroundColor: c.surface2, borderWidth: 1, borderColor: c.border }}>
          <Txt variant="medium">This page changed somewhere else.</Txt>
          <Txt variant="small">Save was refused so nothing is overwritten. Copy your text if you need it, then load the latest version.</Txt>
          <Button title="Load latest" small variant="secondary" onPress={reloadLatest} />
        </View> : null}

        {note && editing ? <>
          <TextInput value={title} onChangeText={setTitle} placeholder="Title" placeholderTextColor={c.text3} maxLength={NOTE_LIMITS.title} selectionColor={c.accent}
            style={{ fontFamily: FONT.display, fontSize: 24, color: c.ink }} />
          <TextInput value={body} onChangeText={setBody} multiline placeholder="Write here. Markdown works." placeholderTextColor={c.text3} maxLength={NOTE_LIMITS.body} selectionColor={c.accent}
            textAlignVertical="top" style={{ minHeight: 320, fontFamily: FONT.body, fontSize: 16, lineHeight: 24, color: c.ink, padding: 14, borderRadius: 14, backgroundColor: c.surface, borderWidth: 1, borderColor: c.border }} />
        </> : null}

        {note && !editing ? <>
          <Txt variant="display" style={{ fontSize: 26 }}>{note.title || 'Untitled page'}</Txt>
          {segmentsOf(note.body).map((s, i) => s.kind === 'text' ? <Rich key={i} text={s.text} />
            : s.kind === 'media' ? <View key={i} style={{ gap: 6 }}>
              <RemoteImage id={s.id} resizeMode="contain" accessibilityLabel={s.caption || 'Picture'}
                style={{ width: ((width - 40) * (s.width || 100)) / 100, height: ((width - 40) * (s.width || 100)) / 100 * 0.75, borderRadius: 10, backgroundColor: c.surface2 }} />
              {s.caption ? <Txt variant="small">{s.caption}</Txt> : null}
            </View>
            : <View key={i} style={{ padding: 14, borderRadius: 12, backgroundColor: c.surface2 }}><Txt variant="small" style={{ fontStyle: 'italic' }}>A drawing. Open this page on remio.in to see it.</Txt></View>)}
          {(note.pendingPhotos || []).map((p, i) => <RemoteImage key={`${p}${i}`} id={p} resizeMode="contain" accessibilityLabel={`Picture ${i + 1}`}
            style={{ width: width - 40, height: (width - 40) * 0.75, borderRadius: 10, backgroundColor: c.surface2 }} />)}
          {note.pending ? <Txt variant="small" style={{ color: c.accent }}>Saved on this phone. It syncs when you are online.</Txt> : null}
          {!note.body.trim() && !(note.pendingPhotos || []).length ? <Txt variant="small">This page is empty.</Txt> : null}
          {canEdit ? <Button title="Delete page" variant="danger" icon="trash-2" onPress={removePage} /> : null}
        </> : null}
      </ScrollView>
    </KeyboardAvoidingView>
  </SafeAreaView>;
}
