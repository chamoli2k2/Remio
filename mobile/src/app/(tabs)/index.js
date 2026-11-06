import { useRouter } from 'expo-router';
import { View } from 'react-native';
import { useAuth } from '../../auth';
import { useQuery } from '../../hooks/useQuery';
import { useTheme } from '../../theme';
import { Button, Empty, ErrorBox, FolderBadge, Loading, Logo, Pill, Progress, Screen, Surface, Txt, Icon } from '../../components/ui';

function Stat({ label, value, icon, color }) {
  const { c } = useTheme();
  return <Surface style={{ flex: 1, gap: 6, padding: 14 }}>
    <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}><Icon name={icon} size={14} color={color || c.accent} /><Txt variant="label">{label}</Txt></View>
    <Txt variant="title">{value}</Txt>
  </Surface>;
}

export default function Home() {
  const router = useRouter();
  const { user } = useAuth();
  const { c } = useTheme();
  const stats = useQuery('/stats');
  const folders = useQuery('/folders');
  const s = stats.data?.stats;
  const list = (folders.data?.folders || []).filter(f => f.cardCount > 0).slice(0, 5);
  const refreshing = stats.loading || folders.loading;
  const hour = new Date().getHours();
  const hello = hour < 12 ? 'Good morning' : hour < 18 ? 'Good afternoon' : 'Good evening';

  return <Screen onRefresh={() => Promise.all([stats.reload(), folders.reload()])} refreshing={false}>
    <Logo size={30} />
    <View style={{ gap: 2, marginTop: 4 }}>
      <Txt variant="display" style={{ fontSize: 28 }}>{hello}{user?.name ? `, ${user.name.split(' ')[0]}` : ''}</Txt>
      <Txt variant="small">{s ? (s.due ? `${s.due} card${s.due === 1 ? '' : 's'} are ready to review.` : 'You are all caught up.') : 'Learn a little. Remember a lot.'}</Txt>
    </View>

    {stats.error ? <ErrorBox message={stats.error} onRetry={stats.reload} /> : null}
    {s ? <>
      <View style={{ flexDirection: 'row', gap: 12 }}>
        <Stat label="Due" value={s.due} icon="clock" />
        <Stat label="Streak" value={`${s.streak?.current || 0}d`} icon="zap" color="#d4a05c" />
        <Stat label="Mastered" value={s.mastered} icon="award" color={c.success} />
      </View>
      <Surface style={{ gap: 10 }}>
        <View style={{ flexDirection: 'row', justifyContent: 'space-between' }}>
          <Txt variant="heading">Today's goal</Txt>
          <Txt variant="small">{s.reviewsToday} / {s.goal} reviews</Txt>
        </View>
        <Progress value={s.reviewsToday} max={s.goal} color={s.reviewsToday >= s.goal ? c.success : c.accent} />
      </Surface>
    </> : stats.loading ? <Loading /> : null}

    <View style={{ gap: 12 }}>
      <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' }}>
        <Txt variant="heading">Continue studying</Txt>
        <Button title="All folders" variant="ghost" small onPress={() => router.push('/library')} />
      </View>
      {folders.loading && !folders.data ? <Loading /> : folders.error && !folders.data ? <ErrorBox message={folders.error} onRetry={folders.reload} />
        : !list.length ? <Surface><Empty icon="layers" title="No cards yet" text="Create folders and cards on remio.in, or in the app soon, and they will show up here." /></Surface>
        : list.map(f => <Surface key={f.id} onPress={() => router.push(`/folder/${f.id}`)} style={{ flexDirection: 'row', alignItems: 'center', gap: 14 }}>
          <FolderBadge icon={f.icon} color={f.color} />
          <View style={{ flex: 1, gap: 2 }}>
            <Txt variant="medium" numberOfLines={1}>{f.title}</Txt>
            <Txt variant="small">{f.cardCount} card{f.cardCount === 1 ? '' : 's'}</Txt>
          </View>
          <Icon name="chevron-right" size={18} color={c.muted} />
        </Surface>)}
    </View>
  </Screen>;
}
