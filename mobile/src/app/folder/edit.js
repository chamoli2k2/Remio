import { useEffect, useState } from 'react';
import { KeyboardAvoidingView, Platform, Pressable, ScrollView, Text, View } from 'react-native';
import { Alert } from '../../alert';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { api } from '../../api';
import { FONT, useTheme } from '../../theme';
import ImageField from '../../components/ImageField';
import { Button, ErrorBox, Field, FolderBadge, Icon, Loading, Surface, Txt } from '../../components/ui';

const COLORS = ['violet', 'blue', 'orange', 'green', 'pink', 'slate'];
const ICONS = ['layers', 'code', 'globe', 'brain', 'book', 'flask', 'terminal', 'palette'];

/** Create a folder, or change or delete one you own. */
export default function FolderEditor() {
  const { id } = useLocalSearchParams();
  const isNew = !id;
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const { c, tone } = useTheme();
  const [state, setState] = useState({ loading: !isNew, error: '', folder: null });
  const [form, setForm] = useState({ title: '', description: '', color: 'violet', icon: 'layers', visibility: 'private', thumbnail: null });
  const [saving, setSaving] = useState(false), [error, setError] = useState(''), [attempt, setAttempt] = useState(0);
  const [confirming, setConfirming] = useState(false), [typed, setTyped] = useState('');
  const set = key => value => setForm(f => ({ ...f, [key]: value }));

  useEffect(() => {
    if (isNew) return;
    let live = true;
    api(`/folders/${id}`).then(r => {
      if (!live) return;
      const f = r.folder;
      setState({ loading: false, error: '', folder: f });
      setForm({ title: f.title, description: f.description || '', color: f.color, icon: f.icon, visibility: f.visibility === 'global' ? 'global' : 'private', thumbnail: f.thumbnail || null });
    }, e => live && setState({ loading: false, error: e.message, folder: null }));
    return () => { live = false; };
  }, [id, isNew, attempt]);

  async function save() {
    if (saving) return;
    if (!form.title.trim()) return setError('Give the folder a name.');
    setSaving(true); setError('');
    try {
      const body = { ...form, title: form.title.trim(), thumbnail: isNew ? null : form.thumbnail };
      if (isNew) { const r = await api('/folders', { method: 'POST', body }); router.replace(`/folder/${r.folder.id}`); }
      else { await api(`/folders/${id}`, { method: 'PATCH', body: { ...body, version: state.folder.version } }); router.back(); }
    } catch (e) { setError(e.status === 409 ? 'This folder changed somewhere else. Close this screen and open it again.' : e.message); setSaving(false); }
  }

  async function destroy() {
    if (typed.trim() !== state.folder.title) return setError('Type the folder name exactly to confirm.');
    setSaving(true); setError('');
    try { await api(`/folders/${id}`, { method: 'DELETE', body: { confirm: typed.trim() } }); router.dismissAll(); router.replace('/'); }
    catch (e) { setError(e.message); setSaving(false); }
  }

  const canDelete = !isNew && state.folder?.role === 'owner';
  return <KeyboardAvoidingView style={{ flex: 1, backgroundColor: c.bg }} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
    <View style={{ flexDirection: 'row', alignItems: 'center', gap: 12, paddingHorizontal: 20, paddingTop: insets.top + 12, paddingBottom: 10 }}>
      <Pressable onPress={() => router.back()} hitSlop={10} accessibilityRole="button" accessibilityLabel="Close"><Icon name="x" size={24} color={c.muted} /></Pressable>
      <Text style={{ flex: 1, fontFamily: FONT.display, fontSize: 22, letterSpacing: -0.5, color: c.ink }}>{isNew ? 'New folder' : 'Edit folder'}</Text>
      <Button title={isNew ? 'Create' : 'Save'} small loading={saving && !confirming} disabled={state.loading || !!state.error} onPress={save} />
    </View>
    <ScrollView contentContainerStyle={{ padding: 20, paddingTop: 8, paddingBottom: 40 + insets.bottom, gap: 16 }} keyboardShouldPersistTaps="handled">
      {state.loading ? <Loading /> : null}
      {state.error ? <ErrorBox message={state.error} onRetry={() => setAttempt(a => a + 1)} /> : null}
      {!state.loading && !state.error ? <>
        <Field label="Name" value={form.title} onChangeText={set('title')} placeholder="Biology, Spanish verbs…" maxLength={80} />
        <Field label="Description (optional)" value={form.description} onChangeText={set('description')} placeholder="What is in this folder?" multiline maxLength={500} style={{ minHeight: 80, paddingTop: 12, textAlignVertical: 'top' }} />

        {!isNew ? <View style={{ gap: 8 }}>
          <Txt variant="small" style={{ fontFamily: FONT.medium, color: c.text2 }}>Cover picture</Txt>
          <ImageField folderId={id} value={form.thumbnail} onChange={set('thumbnail')} />
        </View> : null}
        <View style={{ gap: 8 }}>
          <Txt variant="small" style={{ fontFamily: FONT.medium, color: c.text2 }}>Colour</Txt>
          <View style={{ flexDirection: 'row', gap: 12 }}>
            {COLORS.map(k => <Pressable key={k} onPress={() => set('color')(k)} accessibilityRole="button" accessibilityLabel={k} accessibilityState={{ selected: form.color === k }}
              style={{ width: 38, height: 38, borderRadius: 19, backgroundColor: tone(k).tone, borderWidth: form.color === k ? 3 : 0, borderColor: c.ink }} />)}
          </View>
        </View>
        <View style={{ gap: 8 }}>
          <Txt variant="small" style={{ fontFamily: FONT.medium, color: c.text2 }}>Icon</Txt>
          <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 10 }}>
            {ICONS.map(k => <Pressable key={k} onPress={() => set('icon')(k)} accessibilityRole="button" accessibilityLabel={k} accessibilityState={{ selected: form.icon === k }}
              style={{ padding: 3, borderRadius: 16, borderWidth: 2, borderColor: form.icon === k ? c.accent : 'transparent' }}>
              <FolderBadge icon={k} color={form.color} size={44} />
            </Pressable>)}
          </View>
        </View>
        <View style={{ gap: 8 }}>
          <Txt variant="small" style={{ fontFamily: FONT.medium, color: c.text2 }}>Who can see it</Txt>
          <View style={{ flexDirection: 'row', backgroundColor: c.surface3, borderRadius: 12, padding: 4 }}>
            {[['private', 'Only me'], ['global', 'Everyone']].map(([k, label]) => {
              const on = form.visibility === k;
              return <Pressable key={k} onPress={() => set('visibility')(k)} accessibilityRole="button" accessibilityState={{ selected: on }} style={{ flex: 1, alignItems: 'center', paddingVertical: 9, borderRadius: 9, backgroundColor: on ? c.surface : 'transparent' }}>
                <Txt style={{ fontFamily: on ? FONT.semibold : FONT.body, color: on ? c.ink : c.muted }}>{label}</Txt>
              </Pressable>;
            })}
          </View>
          {form.visibility === 'global' ? <Txt variant="small">Anyone can find and study this folder. Cards you add become public.</Txt> : null}
        </View>

        {error ? <Txt variant="small" style={{ color: c.danger }} accessibilityRole="alert">{error}</Txt> : null}

        {canDelete ? <Surface style={{ gap: 12, marginTop: 8 }}>
          <Txt variant="heading">Delete folder</Txt>
          {!confirming ? <>
            <Txt variant="small">Deleting removes the folder, its cards and everyone's study history for it. This cannot be undone.</Txt>
            <Button title="Delete this folder" variant="danger" icon="trash-2" onPress={() => { setConfirming(true); setError(''); }} />
          </> : <>
            <Txt variant="small">Type <Text style={{ fontFamily: FONT.semibold, color: c.ink }}>{state.folder.title}</Text> to confirm.</Txt>
            <Field value={typed} onChangeText={setTyped} autoCapitalize="none" autoCorrect={false} />
            <View style={{ flexDirection: 'row', gap: 10 }}>
              <Button title="Cancel" variant="secondary" style={{ flex: 1 }} onPress={() => { setConfirming(false); setTyped(''); setError(''); }} />
              <Button title="Delete forever" variant="danger" loading={saving} style={{ flex: 1 }} disabled={typed.trim() !== state.folder.title} onPress={destroy} />
            </View>
          </>}
        </Surface> : null}
      </> : null}
    </ScrollView>
  </KeyboardAvoidingView>;
}
