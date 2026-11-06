import { useRouter, useLocalSearchParams } from 'expo-router';
import { View } from 'react-native';
import { useQuery } from '../../hooks/useQuery';
import { useTheme } from '../../theme';
import { BackButton, Button, Empty, ErrorBox, FolderBadge, Header, Loading, Pill, Screen, Surface, Txt } from '../../components/ui';
import { previewText } from '../../components/CardFace';

export default function FolderScreen() {
  const { id } = useLocalSearchParams();
  const router = useRouter();
  const { tone } = useTheme();
  const folder = useQuery(`/folders/${id}`);
  const cards = useQuery(`/folders/${id}/cards`);
  const f = folder.data?.folder, list = cards.data?.cards || [];
  const now = Date.now();
  const due = list.filter(c => !c.progress?.dueAt || new Date(c.progress.dueAt).getTime() <= now).length;

  return <Screen onRefresh={() => Promise.all([folder.reload(), cards.reload()])} edges={['top']}>
    <Header title={f?.title || 'Folder'} left={<BackButton />} />
    {folder.error ? <ErrorBox message={folder.error} onRetry={folder.reload} /> : null}
    {!f && folder.loading ? <Loading /> : null}
    {f ? <>
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 14 }}>
        <FolderBadge icon={f.icon} color={f.color} size={56} />
        <View style={{ flex: 1, gap: 6 }}>
          <Txt variant="small">{f.cardCount} card{f.cardCount === 1 ? '' : 's'}{cards.data ? ` · ${due} due` : ''}</Txt>
          <View style={{ flexDirection: 'row', gap: 6, flexWrap: 'wrap' }}>{(f.tags || []).slice(0, 4).map(t => <Pill key={t} tone={tone(f.color)}>{t}</Pill>)}</View>
        </View>
      </View>
      {f.description ? <Txt variant="body">{f.description}</Txt> : null}
      <View style={{ gap: 10 }}>
        <Button title={due ? `Study ${due} due` : 'Nothing due'} icon="play" disabled={!due} onPress={() => router.push(`/study/${id}?mode=due`)} />
        <Button title="Study all cards" variant="secondary" icon="repeat" disabled={!list.length} onPress={() => router.push(`/study/${id}?mode=all`)} />
      </View>
    </> : null}

    {cards.error ? <ErrorBox message={cards.error} onRetry={cards.reload} /> : null}
    {cards.loading && !cards.data ? <Loading /> : null}
    {cards.data && !list.length ? <Surface><Empty icon="layers" title="No cards yet" text="Add cards to this folder on remio.in." /></Surface> : null}
    {list.length ? <View style={{ gap: 8 }}>
      <Txt variant="label">CARDS</Txt>
      {list.slice(0, 200).map(card => <Surface key={card.id} style={{ padding: 14 }}><Txt numberOfLines={2}>{previewText(card)}</Txt></Surface>)}
      {list.length > 200 ? <Txt variant="small" style={{ textAlign: 'center' }}>Showing the first 200 of {list.length}. Study covers all of them.</Txt> : null}
    </View> : null}
  </Screen>;
}
