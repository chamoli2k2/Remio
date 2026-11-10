import { useEffect, useState } from 'react';
import { KeyboardAvoidingView, Platform, Pressable, ScrollView, Text, View } from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { useRouter } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { saveCard } from '../offline';
import { useQuery } from '../hooks/useQuery';
import { FONT, useTheme } from '../theme';
import { Button, Empty, Field, Icon, Loading, Surface, Txt } from '../components/ui';
import ImageField from '../components/ImageField';

const LAST = 'remio.quickFolder';

/**
 * Capture a card in a few seconds: pick a folder, type the question and answer, save, and go
 * again. The folder you used last is remembered, and it all works with no connection.
 */
export default function QuickAdd() {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const { c } = useTheme();
  const { data, loading, error } = useQuery('/folders');
  const [folderId, setFolderId] = useState(null);
  const [front, setFront] = useState(''), [back, setBack] = useState(''), [image, setImage] = useState(null);
  const [saving, setSaving] = useState(false), [message, setMessage] = useState(''), [problem, setProblem] = useState(''), [added, setAdded] = useState(0);
  const folders = (data?.folders || []).filter(f => ['owner', 'editor'].includes(f.role) && !f.archived);

  useEffect(() => { AsyncStorage.getItem(LAST).then(v => v && setFolderId(v)).catch(() => {}); }, []);
  const chosen = folders.find(f => f.id === folderId) || (folders.length ? folders[0] : null);

  async function save(another) {
    if (saving || !chosen) return;
    if (!front.trim() && !image) return setProblem('Add a question first.');
    if (!back.trim() && !/\{\{c\d+::/.test(front)) return setProblem('Add the answer.');
    setSaving(true); setProblem(''); setMessage('');
    try {
      const r = await saveCard({ folderId: chosen.id, cardId: null, body: { front: { text: front, image, drawing: null }, back: { text: back, image: null, drawing: null }, hint: '', tags: [], source: '' } });
      AsyncStorage.setItem(LAST, chosen.id).catch(() => {});
      if (!another) return router.back();
      setFront(''); setBack(''); setImage(null); setAdded(n => n + 1);
      setMessage(r.status === 'queued' ? 'Saved on this phone. It syncs when you are online.' : 'Added.');
    } catch (e) { setProblem(e.message); }
    finally { setSaving(false); }
  }

  return <KeyboardAvoidingView style={{ flex: 1, backgroundColor: c.bg }} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
    <View style={{ flexDirection: 'row', alignItems: 'center', gap: 12, paddingHorizontal: 20, paddingTop: insets.top + 12, paddingBottom: 10 }}>
      <Pressable onPress={() => router.back()} hitSlop={10} accessibilityRole="button" accessibilityLabel="Close"><Icon name="x" size={24} color={c.muted} /></Pressable>
      <Text style={{ flex: 1, fontFamily: FONT.display, fontSize: 22, letterSpacing: -0.5, color: c.ink }}>Quick add</Text>
      {added ? <Txt variant="small">{added} added</Txt> : null}
    </View>
    <ScrollView contentContainerStyle={{ padding: 20, paddingTop: 8, paddingBottom: 40 + insets.bottom, gap: 14 }} keyboardShouldPersistTaps="handled">
      {loading && !data ? <Loading /> : null}
      {error && !data ? <Txt variant="small" style={{ color: c.danger }}>{error}</Txt> : null}
      {data && !folders.length ? <Surface><Empty icon="folder-plus" title="No folder to add to" text="Create a folder first, then add cards here." action={<Button title="New folder" icon="plus" onPress={() => router.replace('/folder/edit')} />} /></Surface> : null}
      {folders.length ? <>
        <View style={{ gap: 8 }}>
          <Txt variant="label">ADD TO</Txt>
          <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: 8 }} keyboardShouldPersistTaps="handled">
            {folders.map(f => { const on = chosen?.id === f.id;
              return <Pressable key={f.id} onPress={() => { if (f.id !== chosen?.id) setImage(null); setFolderId(f.id); }} accessibilityRole="button" accessibilityState={{ selected: on }}
                style={{ paddingHorizontal: 14, paddingVertical: 10, borderRadius: 12, backgroundColor: on ? c.accent : c.surface, borderWidth: 1, borderColor: on ? c.accent : c.border }}>
                <Text style={{ fontFamily: FONT.medium, fontSize: 14, color: on ? '#fff' : c.text2 }} numberOfLines={1}>{f.title}</Text>
              </Pressable>; })}
          </ScrollView>
        </View>
        <Field label="Question" value={front} onChangeText={t => { setFront(t); setMessage(''); }} placeholder="What do you want to remember?" multiline maxLength={10000} style={{ minHeight: 96, paddingTop: 12, textAlignVertical: 'top' }} />
        <Field label="Answer" value={back} onChangeText={setBack} placeholder="The answer" multiline maxLength={10000} style={{ minHeight: 96, paddingTop: 12, textAlignVertical: 'top' }} />
        {chosen ? <ImageField folderId={chosen.id} value={image} onChange={setImage} /> : null}
        {problem ? <Txt variant="small" style={{ color: c.danger }} accessibilityRole="alert">{problem}</Txt> : null}
        {message ? <Txt variant="small" style={{ color: c.success }}>{message}</Txt> : null}
        <Button title="Save and add another" icon="plus" loading={saving} onPress={() => save(true)} />
        <Button title="Save and close" variant="secondary" disabled={saving} onPress={() => save(false)} />
      </> : null}
    </ScrollView>
  </KeyboardAvoidingView>;
}
