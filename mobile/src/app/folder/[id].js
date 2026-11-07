import RemoteImage from '../../components/RemoteImage';
import { useMemo, useState } from 'react';
import { Image, Pressable, Text, View } from 'react-native';
import { useRouter, useLocalSearchParams } from 'expo-router';
import { useQuery } from '../../hooks/useQuery';
import { FONT, useTheme } from '../../theme';
import { BackButton, Button, Empty, ErrorBox, Field, FolderBadge, Icon, Loading, Screen, Txt } from '../../components/ui';
import { previewText, sideOf } from '../../components/CardFace';

export default function FolderScreen() {
  const { id } = useLocalSearchParams();
  const router = useRouter();
  const { c } = useTheme();
  const folder = useQuery(`/folders/${id}`);
  const cards = useQuery(`/folders/${id}/cards`);
  const [query, setQuery] = useState('');
  const f = folder.data?.folder, list = cards.data?.cards || [];
  const now = Date.now();
  const due = list.filter(x => !x.progress?.dueAt || new Date(x.progress.dueAt).getTime() <= now).length;
  const shown = useMemo(() => {
    const q = query.trim().toLowerCase();
    return list.filter(x => !q || `${previewText(x)} ${(x.tags || []).join(' ')}`.toLowerCase().includes(q));
  }, [list, query]);
  const canEdit = ['owner', 'editor'].includes(f?.role);
  const vis = f?.visibility === 'global' ? ['globe', 'Public collection'] : f?.visibility === 'private' ? ['lock', 'Private collection'] : ['users', 'Shared collection'];

  return <Screen onRefresh={() => Promise.all([folder.reload(), cards.reload()])}>
    <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' }}>
      <Pressable onPress={() => (router.canGoBack() ? router.back() : router.replace('/'))} hitSlop={8} accessibilityRole="button" style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
        <Icon name="arrow-left" size={18} color={c.muted} /><Txt style={{ color: c.muted, fontFamily: FONT.medium }}>Back to library</Txt>
      </Pressable>
      {canEdit ? <Button small variant="soft" icon="edit-2" title="Edit folder" onPress={() => router.push(`/folder/edit?id=${id}`)} /> : null}
    </View>
    {folder.error ? <ErrorBox message={folder.error} onRetry={folder.reload} /> : null}
    {!f && folder.loading ? <Loading /> : null}
    {f ? <>
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 14 }}>
        {f.thumbnail ? <RemoteImage id={f.thumbnail} resizeMode="cover" accessibilityLabel={`${f.title} cover`} style={{ width: 64, height: 64, borderRadius: 19, backgroundColor: c.surface2 }} />
          : <FolderBadge icon={f.icon} color={f.color} size={64} />}
        <View style={{ flex: 1, gap: 3 }}>
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 5 }}><Icon name={vis[0]} size={12} color={c.muted} /><Txt variant="small" style={{ fontSize: 12.5 }}>{vis[1]}</Txt></View>
          <Text style={{ fontFamily: FONT.display, fontSize: 26, letterSpacing: -0.8, color: c.ink }}>{f.title}</Text>
        </View>
      </View>
      {f.description ? <Txt variant="body" style={{ color: c.text2 }}>{f.description}</Txt> : null}
      <Txt variant="small">{f.cardCount} card{f.cardCount === 1 ? '' : 's'}{f.owner?.username ? `  |  Created by @${f.owner.username}` : ''}</Txt>

      <View style={{ gap: 14, padding: 18, borderRadius: 18, backgroundColor: c.soft, borderWidth: 1, borderColor: c.soft2 }}>
        <View style={{ gap: 3 }}>
          <Text style={{ fontFamily: FONT.heading, fontSize: 17, color: c.text2 }}>A little practice makes it stick.</Text>
          <Txt variant="small">Flip a few cards, or settle into a focused study session.</Txt>
        </View>
        <View style={{ flexDirection: 'row', gap: 10 }}>
          <Button small title="Quick review" variant="secondary" disabled={!list.length} onPress={() => router.push(`/study/${id}?mode=all`)} style={{ flex: 1 }} />
          <Button small title={due ? `Study due · ${due}` : 'Nothing due'} icon="play" disabled={!due} onPress={() => router.push(`/study/${id}?mode=due`)} style={{ flex: 1.3 }} />
        </View>
      </View>
    </> : null}

    <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8, marginTop: 6 }}>
      <Text style={{ fontFamily: FONT.display, fontSize: 21, letterSpacing: -0.5, color: c.ink }}>Flashcards</Text>
      <View style={{ paddingHorizontal: 8, paddingVertical: 2, borderRadius: 8, backgroundColor: c.surface3 }}><Text style={{ fontFamily: FONT.semibold, fontSize: 12, color: c.muted }}>{list.length}</Text></View>
      <View style={{ flex: 1 }} />
      {canEdit ? <Button small icon="plus" title="Add card" onPress={() => router.push(`/card/new?folder=${id}`)} /> : null}
    </View>
    <Field value={query} onChangeText={setQuery} placeholder="Search cards or tags" autoCapitalize="none" autoCorrect={false} clearButtonMode="while-editing" />
    {cards.error ? <ErrorBox message={cards.error} onRetry={cards.reload} /> : null}
    {cards.loading && !cards.data ? <Loading /> : null}
    {cards.data && !list.length ? <Empty icon="layers" title="No cards yet" text={canEdit ? 'Add your first card to start studying.' : 'This folder has no cards yet.'} action={canEdit ? <Button title="Add a card" icon="plus" onPress={() => router.push(`/card/new?folder=${id}`)} /> : null} /> : null}
    {shown.slice(0, 200).map((card, i) => <Pressable key={card.id} disabled={!canEdit} onPress={() => router.push(`/card/${card.id}?folder=${id}`)} accessibilityRole="button" accessibilityLabel={`Edit card: ${previewText(card)}`}
      style={({ pressed }) => ({ gap: 14, padding: 16, borderRadius: 16, backgroundColor: c.surface, borderWidth: 1, borderColor: c.border, opacity: pressed ? 0.85 : 1 })}>
      <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' }}><Text style={{ fontFamily: FONT.semibold, fontSize: 11.5, letterSpacing: 1, color: c.muted }}><Text style={{ color: c.accent }}>{String(list.indexOf(card) + 1).padStart(2, '0')}</Text>  /  {sideOf(card, false).cloze === 'hide' ? 'CLOZE' : 'QUESTION'}</Text>{canEdit ? <Icon name="edit-2" size={14} color={c.muted} /> : null}</View>
      <Text numberOfLines={3} style={{ fontFamily: FONT.heading, fontSize: 16, lineHeight: 23, color: c.ink }}>{previewText(card)}</Text>
    </Pressable>)}
    {shown.length > 200 ? <Txt variant="small" style={{ textAlign: 'center' }}>Showing the first 200 of {shown.length}. Study covers all of them.</Txt> : null}
  </Screen>;
}
