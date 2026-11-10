import RemoteImage from '../../components/RemoteImage';
import { useMemo, useState } from 'react';
import { Image, Pressable, Text, View, useWindowDimensions } from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';
import { useRouter } from 'expo-router';
import { useQuery } from '../../hooks/useQuery';
import { FONT, RADIUS, useTheme } from '../../theme';
import FolderCard from '../../components/FolderCard';
import { Button, Empty, ErrorBox, Field, Icon, Loading, PageHeading, Screen, Txt, TopBar, FolderBadge } from '../../components/ui';

const TABS = [['all', 'All folders'], ['private', 'Private'], ['global', 'Global'], ['saved', 'Liked']];

/** Today at a glance, in the same purple band the website opens with, kept to a few lines. */
function TodayStrip({ stats, onStudy }) {
  const done = stats?.reviewsToday || 0, goal = stats?.goal || 20;
  const streak = stats?.streak?.current || 0, level = stats?.game?.level;
  const chip = { flex: 1, flexDirection: 'row', alignItems: 'center', gap: 8, paddingVertical: 8, paddingHorizontal: 10, borderRadius: 12, backgroundColor: '#ffffff1a', borderWidth: 1, borderColor: '#ffffff29' };
  const value = { fontFamily: FONT.display, fontSize: 15, color: '#fff' }, label = { fontFamily: FONT.body, fontSize: 11, color: '#ffffffb3' };
  const Chip = ({ icon, color, big, small }) => <View style={chip}>
    <Icon name={icon} size={16} color={color} />
    <View style={{ flexShrink: 1 }}><Text style={value} numberOfLines={1}>{big}</Text><Text style={label} numberOfLines={1}>{small}</Text></View>
  </View>;
  return <LinearGradient colors={['#5a45e0', '#6d55ea']} start={{ x: 0, y: 0 }} end={{ x: 1, y: 1 }} style={{ borderRadius: 18, padding: 14, gap: 12 }}>
    <View style={{ flexDirection: 'row', alignItems: 'center', gap: 12 }}>
      <View style={{ flex: 1, gap: 2 }}>
        <Text style={{ fontFamily: FONT.display, fontSize: 18, lineHeight: 23, letterSpacing: -0.4, color: '#fff' }}>Keep your curiosity in good company.</Text>
        <Text style={{ fontFamily: FONT.body, fontSize: 13, color: '#ffffffd9' }}>{stats?.due ? `${stats.due} cards are ready when you are.` : 'Your next discovery is just a card away.'}</Text>
      </View>
    </View>
    <View style={{ flexDirection: 'row', gap: 8 }}>
      <Chip icon={done >= goal ? 'check-circle' : 'target'} color={done >= goal ? '#9fe3c5' : '#fff'} big={`${done}/${goal}`} small="Daily goal" />
      <Chip icon="zap" color="#ffd9a0" big={String(streak)} small="Day streak" />
      <Chip icon="star" color="#d9ccff" big={Number(level?.xp || 0).toLocaleString()} small={level ? `XP | Lv ${level.level}` : 'XP'} />
    </View>
    <Pressable onPress={onStudy} accessibilityRole="button" style={({ pressed }) => ({ minHeight: 44, borderRadius: 11, backgroundColor: '#fff', flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8, opacity: pressed ? 0.85 : 1 })}>
      <Text style={{ fontFamily: FONT.semibold, fontSize: 15, color: '#4d36bc' }}>Start a study session</Text>
      <Icon name="arrow-right" size={16} color="#4d36bc" />
    </Pressable>
  </LinearGradient>;
}

export default function Library() {
  const router = useRouter();
  const { c } = useTheme();
  const { width } = useWindowDimensions();
  const stats = useQuery('/stats');
  const folders = useQuery('/folders');
  const [tab, setTab] = useState('all'), [query, setQuery] = useState('');
  const all = folders.data?.folders || [];
  const list = useMemo(() => {
    const q = query.trim().toLowerCase();
    return all.filter(f => (!q || `${f.title} ${f.description || ''}`.toLowerCase().includes(q))
      && (tab === 'all' || (tab === 'private' && f.visibility === 'private') || (tab === 'global' && f.visibility === 'global') || (tab === 'saved' && (f.liked || f.saved))))
      .sort((a, b) => new Date(b.updatedAt) - new Date(a.updatedAt));
  }, [all, tab, query]);
  const cardWidth = (Math.min(width, 640) - 40 - 12) / 2;
  // With no cards anywhere this stays put: pushing '/' would stack a second library on top of this one.
  const startStudy = () => { const f = all.find(x => x.cardCount > 0); if (f) router.push(`/study/${f.id}?mode=due`); else router.push('/quick-add'); };

  return <Screen onRefresh={() => Promise.all([stats.reload(), folders.reload()])}>
    <TopBar />
    <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 12 }}>
      <View style={{ flex: 1 }}><PageHeading title="My library" subtitle="Everything you want to remember." /></View>
      <Button title="New folder" icon="plus" small onPress={() => router.push('/folder/edit')} />
    </View>
    {stats.error ? <ErrorBox message={stats.error} onRetry={stats.reload} /> : <TodayStrip stats={stats.data?.stats} onStudy={startStudy} />}

    <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8, marginTop: 8 }}>
      <Text style={{ fontFamily: FONT.display, fontSize: 21, letterSpacing: -0.5, color: c.ink }}>Your collections</Text>
      <View style={{ paddingHorizontal: 8, paddingVertical: 2, borderRadius: 8, backgroundColor: c.surface3 }}><Text style={{ fontFamily: FONT.semibold, fontSize: 12, color: c.muted }}>{all.length}</Text></View>
    </View>
    <View style={{ flexDirection: 'row', gap: 6, flexWrap: 'wrap' }}>
      {TABS.map(([key, label]) => {
        const on = tab === key;
        return <Pressable key={key} onPress={() => setTab(key)} accessibilityRole="button" accessibilityState={{ selected: on }}
          style={{ paddingHorizontal: 14, paddingVertical: 9, borderRadius: 12, backgroundColor: on ? c.soft : 'transparent' }}>
          <Text style={{ fontFamily: on ? FONT.semibold : FONT.medium, fontSize: 14, color: on ? c.accentDark : c.muted }}>{label}</Text>
        </Pressable>;
      })}
    </View>
    <Field value={query} onChangeText={setQuery} placeholder="Search folders" autoCapitalize="none" autoCorrect={false} returnKeyType="search" clearButtonMode="while-editing" />

    {folders.error ? <ErrorBox message={folders.error} onRetry={folders.reload} /> : null}
    {folders.loading && !folders.data ? <Loading /> : null}
    {folders.data && !list.length ? <Empty icon="layers" title={query || tab !== 'all' ? 'No matching folders' : 'Your library is empty'} text={query || tab !== 'all' ? 'Try a different filter or word.' : 'Folders you create on remio.in appear here.'} /> : null}
    <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 12 }}>
      {list.map(f => <FolderCard key={f.id} f={f} width={cardWidth} onPress={() => router.push(`/folder/${f.id}`)} />)}
    </View>
  </Screen>;
}
