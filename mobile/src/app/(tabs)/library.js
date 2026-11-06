import { useMemo, useState } from 'react';
import { FlatList, RefreshControl, View } from 'react-native';
import { useRouter } from 'expo-router';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useQuery } from '../../hooks/useQuery';
import { useTheme } from '../../theme';
import { Empty, ErrorBox, Field, FolderBadge, Icon, Loading, Pill, Surface, Txt } from '../../components/ui';

export default function Library() {
  const router = useRouter();
  const { c, tone } = useTheme();
  const { data, error, loading, reload } = useQuery('/folders');
  const [query, setQuery] = useState('');
  const [refreshing, setRefreshing] = useState(false);
  const folders = useMemo(() => {
    const q = query.trim().toLowerCase();
    return (data?.folders || []).filter(f => !q || f.title.toLowerCase().includes(q) || (f.tags || []).some(t => t.toLowerCase().includes(q)));
  }, [data, query]);

  return <SafeAreaView edges={['top']} style={{ flex: 1, backgroundColor: c.bg }}>
    <FlatList
      data={folders}
      keyExtractor={f => f.id}
      contentContainerStyle={{ padding: 20, paddingBottom: 40, gap: 12 }}
      keyboardShouldPersistTaps="handled"
      refreshControl={<RefreshControl refreshing={refreshing} tintColor={c.accent} onRefresh={async () => { setRefreshing(true); await reload(); setRefreshing(false); }} />}
      ListHeaderComponent={<View style={{ gap: 14, marginBottom: 4 }}>
        <Txt variant="display" style={{ fontSize: 28 }}>Library</Txt>
        <Field value={query} onChangeText={setQuery} placeholder="Search your folders" autoCapitalize="none" autoCorrect={false} returnKeyType="search" clearButtonMode="while-editing" />
        {error ? <ErrorBox message={error} onRetry={reload} /> : null}
      </View>}
      ListEmptyComponent={loading && !data ? <Loading /> : error ? null
        : <Empty icon="layers" title={query ? 'No matching folders' : 'Your library is empty'} text={query ? 'Try a different word.' : 'Folders you create on remio.in appear here.'} />}
      renderItem={({ item: f }) => <Surface onPress={() => router.push(`/folder/${f.id}`)} style={{ flexDirection: 'row', alignItems: 'center', gap: 14 }}>
        <FolderBadge icon={f.icon} color={f.color} />
        <View style={{ flex: 1, gap: 4 }}>
          <Txt variant="medium" numberOfLines={1}>{f.title}</Txt>
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
            <Txt variant="small">{f.cardCount} card{f.cardCount === 1 ? '' : 's'}</Txt>
            {f.role && f.role !== 'owner' ? <Pill tone={tone(f.color)}>{f.role === 'editor' ? 'Can edit' : 'Shared'}</Pill> : null}
          </View>
        </View>
        <Icon name="chevron-right" size={18} color={c.muted} />
      </Surface>}
    />
  </SafeAreaView>;
}
