import { useEffect, useMemo, useState } from 'react';
import { View } from 'react-native';
import { useRouter } from 'expo-router';
import { api } from '../../api';
import { useQuery } from '../../hooks/useQuery';
import { useTheme } from '../../theme';
import { Empty, ErrorBox, Field, FolderBadge, Icon, Loading, PageHeading, Screen, Surface, TopBar, Txt } from '../../components/ui';

export default function Notes() {
  const router = useRouter();
  const { c } = useTheme();
  const { data, error, loading, reload } = useQuery('/notebooks');
  const [q, setQ] = useState(''), [hits, setHits] = useState(null), [searchError, setSearchError] = useState('');
  const term = q.trim();

  // Search waits for a pause in typing, and an older answer never replaces a newer one.
  useEffect(() => {
    if (term.length < 2) { setHits(null); setSearchError(''); return; }
    let live = true;
    const t = setTimeout(() => api(`/notes/search?q=${encodeURIComponent(term)}`).then(r => live && (setHits(r.notes), setSearchError('')), e => live && setSearchError(e.message)), 350);
    return () => { live = false; clearTimeout(t); };
  }, [term]);

  const groups = useMemo(() => {
    const out = new Map();
    for (const n of data?.notebooks || []) { const k = n.collection?.title || 'Notebooks'; out.set(k, [...(out.get(k) || []), n]); }
    return [...out];
  }, [data]);

  return <Screen onRefresh={reload}>
    <TopBar />
    <PageHeading eyebrow="YOUR WRITING SPACE" title="Notes" subtitle="Notebooks and pages, in sync with the website." />
    <Field value={q} onChangeText={setQ} placeholder="Search every page" autoCapitalize="none" autoCorrect={false} returnKeyType="search" clearButtonMode="while-editing" />
    {error ? <ErrorBox message={error} onRetry={reload} /> : null}
    {searchError ? <ErrorBox message={searchError} /> : null}

    {hits ? (hits.length ? hits.map(n => <Surface key={n.id} onPress={() => router.push(`/note/${n.id}`)} style={{ gap: 4 }}>
        <Txt variant="medium" numberOfLines={1}>{n.title || 'Untitled page'}</Txt>
        <Txt variant="small" numberOfLines={2}>{n.snippet}</Txt>
        <Txt variant="small" style={{ color: c.accent }}>{n.notebookTitle}</Txt>
      </Surface>) : <Empty icon="search" title="No pages found" text="Try another word." />)
      : loading && !data ? <Loading />
      : data && !groups.length ? <Surface><Empty icon="edit-3" title="No notebooks yet" text="Notebooks you create on remio.in appear here." /></Surface>
      : groups.map(([name, books]) => <View key={name} style={{ gap: 10 }}>
        <Txt variant="label">{name.toUpperCase()}</Txt>
        {books.map(b => <Surface key={b.id} onPress={() => router.push(`/notebook/${b.id}`)} style={{ flexDirection: 'row', alignItems: 'center', gap: 14 }}>
          <FolderBadge icon={b.icon || 'book'} color={b.color} />
          <View style={{ flex: 1, gap: 2 }}>
            <Txt variant="medium" numberOfLines={1}>{b.title}</Txt>
            <Txt variant="small">{b.noteCount ?? 0} page{b.noteCount === 1 ? '' : 's'}</Txt>
          </View>
          <Icon name="chevron-right" size={18} color={c.muted} />
        </Surface>)}
      </View>)}
  </Screen>;
}
