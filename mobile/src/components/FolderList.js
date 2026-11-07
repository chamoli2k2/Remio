import { useMemo, useState } from 'react';
import { View, useWindowDimensions } from 'react-native';
import { useRouter } from 'expo-router';
import { useQuery } from '../hooks/useQuery';
import FolderCard from './FolderCard';
import { Empty, ErrorBox, Field, Loading, PageHeading, Screen, TopBar } from './ui';

/** A titled grid of folders from one endpoint, with search: the shape Archive, Shared and Explore share. */
export default function FolderList({ eyebrow, title, subtitle, path, filter, emptyTitle, emptyText, searchable = true }) {
  const router = useRouter();
  const { width } = useWindowDimensions();
  const { data, error, loading, reload } = useQuery(path);
  const [query, setQuery] = useState('');
  const list = useMemo(() => {
    const q = query.trim().toLowerCase();
    return (data?.folders || []).filter(f => (!filter || filter(f)) && (!q || `${f.title} ${f.description || ''}`.toLowerCase().includes(q)));
  }, [data, filter, query]);
  const cardWidth = (Math.min(width, 640) - 40 - 12) / 2;
  return <Screen onRefresh={reload}>
    <TopBar />
    <PageHeading eyebrow={eyebrow} title={title} subtitle={subtitle} />
    {searchable ? <Field value={query} onChangeText={setQuery} placeholder="Search folders" autoCapitalize="none" autoCorrect={false} returnKeyType="search" clearButtonMode="while-editing" /> : null}
    {error ? <ErrorBox message={error} onRetry={reload} /> : null}
    {loading && !data ? <Loading /> : null}
    {data && !list.length ? <Empty icon="layers" title={query ? 'No matching folders' : emptyTitle} text={query ? 'Try a different word.' : emptyText} /> : null}
    <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 12 }}>
      {list.map(f => <FolderCard key={f.id} f={f} width={cardWidth} onPress={() => router.push(`/folder/${f.id}`)} />)}
    </View>
  </Screen>;
}
