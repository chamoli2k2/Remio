import { View } from 'react-native';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { useQuery } from '../../hooks/useQuery';
import { useTheme } from '../../theme';
import { BackButton, Button, Empty, ErrorBox, FolderBadge, Header, Icon, Loading, Screen, Surface, Txt } from '../../components/ui';

export default function Notebook() {
  const { id } = useLocalSearchParams();
  const router = useRouter();
  const { c } = useTheme();
  const { data, error, loading, reload } = useQuery(`/notebooks/${id}`);
  const nb = data?.notebook, pages = data?.notes || [];
  const canEdit = nb && ['owner', 'editor'].includes(nb.role);

  return <Screen onRefresh={reload}>
    <Header title={nb?.title || 'Notebook'} subtitle={nb?.collection?.title} left={<BackButton />} />
    {error ? <ErrorBox message={error} onRetry={reload} /> : null}
    {loading && !data ? <Loading /> : null}
    {canEdit ? <Button title="New page" icon="plus" onPress={() => router.push(`/note/new?notebook=${id}`)} /> : null}
    {data && !pages.length ? <Surface><Empty icon="file-text" title="No pages yet" text={canEdit ? 'Add the first page.' : 'This notebook has no pages.'} /></Surface> : null}
    {pages.map(p => <Surface key={p.id} onPress={() => router.push(`/note/${p.id}`)} style={{ gap: 4 }}>
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
        {p.pending ? <Icon name="clock" size={14} color={c.accent} /> : null}
        {p.pinned ? <Icon name="bookmark" size={14} color={c.accent} /> : null}
        <Txt variant="medium" numberOfLines={1} style={{ flex: 1 }}>{p.title || 'Untitled page'}</Txt>
      </View>
      {p.snippet ? <Txt variant="small" numberOfLines={2}>{p.snippet}</Txt> : null}
      {p.pending ? <Txt variant="small" style={{ color: c.accent }}>Waiting to sync</Txt> : null}
    </Surface>)}
  </Screen>;
}
