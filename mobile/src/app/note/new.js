import { useEffect, useRef, useState } from 'react';
import { KeyboardAvoidingView, Platform, Pressable, ScrollView, Text, View } from 'react-native';
import { Alert } from '../../alert';
import { useLocalSearchParams, useNavigation, useRouter } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { createNote } from '../../offline';
import { attachImage, isPending, pickImage } from '../../upload';
import { NOTE_LIMITS } from '../../../../shared/notes.js';
import { FONT, useTheme } from '../../theme';
import { Button, Field, Icon, Surface, Txt } from '../../components/ui';
import RemoteImage from '../../components/RemoteImage';

const MAX_PHOTOS = 6;

/**
 * A quick page: a title, some text and a few pictures. Anything bigger (drawings, resizing pictures,
 * rearranging, formatting) is for the website. It works without a connection and is sent later.
 */
export default function NewNote() {
  const { notebook } = useLocalSearchParams();
  const router = useRouter(), navigation = useNavigation();
  const done = useRef(false);
  const insets = useSafeAreaInsets();
  const { c } = useTheme();
  const [title, setTitle] = useState(''), [text, setText] = useState(''), [photos, setPhotos] = useState([]);
  const [busy, setBusy] = useState(false), [saving, setSaving] = useState(false), [error, setError] = useState('');
  const dirty = !!(title.trim() || text.trim() || photos.length);

  async function add(source) {
    if (busy || photos.length >= MAX_PHOTOS) return;
    setError('');
    try {
      const asset = await pickImage(source);
      if (!asset) return;
      setBusy(true);
      const photo = await attachImage(`/notebooks/${notebook}/images`, asset);
      setPhotos(list => [...list, photo]);
    } catch (e) { setError(e.message || 'The picture could not be added.'); }
    finally { setBusy(false); }
  }

  async function save() {
    if (saving) return;
    if (!title.trim() && !text.trim() && !photos.length) return setError('Write something or add a picture first.');
    setSaving(true); setError('');
    try { await createNote({ notebookId: notebook, title, text, photos }); done.current = true; if (router.canGoBack()) router.back(); else router.replace('/notes'); }
    catch (e) { setError(e.message); setSaving(false); }
  }

  // Android back and the iOS swipe go through here as well as the close button.
  useEffect(() => navigation.addListener('beforeRemove', e => {
    if (!dirty || done.current) return;
    e.preventDefault();
    Alert.alert('Discard this page?', 'What you wrote is not saved.', [{ text: 'Keep writing', style: 'cancel' }, { text: 'Discard', style: 'destructive', onPress: () => navigation.dispatch(e.data.action) }]);
  }), [navigation, dirty]);
  const close = () => (router.canGoBack() ? router.back() : router.replace('/notes'));

  return <KeyboardAvoidingView style={{ flex: 1, backgroundColor: c.bg }} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
    <View style={{ flexDirection: 'row', alignItems: 'center', gap: 12, paddingHorizontal: 20, paddingTop: insets.top + 12, paddingBottom: 10 }}>
      <Pressable onPress={close} hitSlop={10} accessibilityRole="button" accessibilityLabel="Close"><Icon name="x" size={24} color={c.muted} /></Pressable>
      <Text style={{ flex: 1, fontFamily: FONT.display, fontSize: 22, letterSpacing: -0.5, color: c.ink }}>New page</Text>
      <Button title="Save" small loading={saving} onPress={save} />
    </View>
    <ScrollView contentContainerStyle={{ padding: 20, paddingTop: 8, paddingBottom: 40 + insets.bottom, gap: 14 }} keyboardShouldPersistTaps="handled">
      <Field label="Title" value={title} onChangeText={setTitle} placeholder="Untitled page" maxLength={NOTE_LIMITS.title} />
      <Field label="Text" value={text} onChangeText={setText} placeholder="Write here. Markdown works." multiline maxLength={NOTE_LIMITS.body} style={{ minHeight: 200, paddingTop: 12, textAlignVertical: 'top' }} />
      <Surface style={{ gap: 12 }}>
        <Text style={{ fontFamily: FONT.semibold, fontSize: 11.5, letterSpacing: 1.4, color: c.accent }}>PICTURES  |  {photos.length}/{MAX_PHOTOS}</Text>
        {photos.map((p, i) => <View key={`${p}${i}`} style={{ gap: 8 }}>
          <RemoteImage id={p} resizeMode="contain" accessibilityLabel={`Picture ${i + 1}`} style={{ width: '100%', height: 170, borderRadius: 12, backgroundColor: c.surface2 }} />
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10 }}>
            {isPending(p) ? <Txt variant="small" style={{ flex: 1 }}>Uploads when you are online.</Txt> : <View style={{ flex: 1 }} />}
            <Button small variant="danger" icon="trash-2" title="Remove" onPress={() => setPhotos(list => list.filter((_, j) => j !== i))} />
          </View>
        </View>)}
        {photos.length < MAX_PHOTOS ? <View style={{ flexDirection: 'row', gap: 8, flexWrap: 'wrap' }}>
          <Button small variant="soft" icon="image" title="Add picture" loading={busy} onPress={() => add('library')} />
          {Platform.OS !== 'web' ? <Button small variant="soft" icon="camera" title="Camera" disabled={busy} onPress={() => add('camera')} /> : null}
        </View> : null}
      </Surface>
      <Txt variant="small">For drawings, formatting and larger pages, open this page on remio.in.</Txt>
      {error ? <Txt variant="small" style={{ color: c.danger }} accessibilityRole="alert">{error}</Txt> : null}
    </ScrollView>
  </KeyboardAvoidingView>;
}
