import { View, Text } from 'react-native';
import { useQuery } from '../../hooks/useQuery';
import { FONT, useTheme } from '../../theme';
import { ErrorBox, Icon, Loading, PageHeading, Progress, Screen, Surface, TopBar, Txt } from '../../components/ui';

function Stat({ icon, label, value, color }) {
  const { c } = useTheme();
  return <Surface style={{ flexBasis: '47%', flexGrow: 1, gap: 6, padding: 14 }}>
    <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}><Icon name={icon} size={14} color={color || c.accent} /><Txt variant="label">{label}</Txt></View>
    <Text style={{ fontFamily: FONT.display, fontSize: 24, letterSpacing: -0.6, color: c.ink }}>{value}</Text>
  </Surface>;
}

const STATES = [['new', 'New'], ['learning', 'Learning'], ['review', 'Review'], ['relearning', 'Relearning']];

export default function ProgressScreen() {
  const { c } = useTheme();
  const { data, error, loading, reload } = useQuery('/stats');
  const s = data?.stats;
  const forecast = s?.forecast || [], peak = Math.max(1, ...forecast.map(d => d.due));
  return <Screen onRefresh={reload}>
    <TopBar />
    <PageHeading eyebrow="STUDY" title="My progress" subtitle="How your memory is doing." />
    {error ? <ErrorBox message={error} onRetry={reload} /> : null}
    {loading && !data ? <Loading /> : null}
    {s ? <>
      <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 12 }}>
        <Stat icon="clock" label="Due now" value={s.due} />
        <Stat icon="layers" label="Total cards" value={s.totalCards} />
        <Stat icon="zap" label="Day streak" value={s.streak?.current || 0} color="#d4a05c" />
        <Stat icon="award" label="Longest streak" value={s.streak?.longest || 0} color="#d4a05c" />
        <Stat icon="check-circle" label="Mastered" value={s.mastered} color={c.success} />
        <Stat icon="repeat" label="Reviewed" value={s.reviewed} color={c.success} />
      </View>
      <Surface style={{ gap: 10 }}>
        <View style={{ flexDirection: 'row', justifyContent: 'space-between' }}><Txt variant="heading">Today's goal</Txt><Txt variant="small">{s.reviewsToday} / {s.goal} reviews</Txt></View>
        <Progress value={s.reviewsToday} max={s.goal} color={s.reviewsToday >= s.goal ? c.success : c.accent} />
      </Surface>
      {s.retention?.observed != null ? <Surface style={{ gap: 4 }}>
        <Txt variant="heading">Retention</Txt>
        <Text style={{ fontFamily: FONT.display, fontSize: 28, letterSpacing: -0.8, color: c.accent }}>{Math.round(s.retention.observed * 100)}%</Text>
        <Txt variant="small">of recent answers were remembered, from {s.retention.sampled} reviews. Your target is {Math.round((s.retention.desired || 0.9) * 100)}%.</Txt>
      </Surface> : null}
      <Surface style={{ gap: 12 }}>
        <Txt variant="heading">Cards by stage</Txt>
        {STATES.map(([key, label]) => <View key={key} style={{ gap: 5 }}>
          <View style={{ flexDirection: 'row', justifyContent: 'space-between' }}><Txt variant="small" style={{ color: c.text2 }}>{label}</Txt><Txt variant="small">{s.states?.[key] || 0}</Txt></View>
          <Progress value={s.states?.[key] || 0} max={Math.max(1, s.totalCards)} />
        </View>)}
      </Surface>
      {forecast.length ? <Surface style={{ gap: 10 }}>
        <Txt variant="heading">Coming due, next 14 days</Txt>
        <View style={{ flexDirection: 'row', alignItems: 'flex-end', gap: 4, height: 110 }}>
          {forecast.map((d, i) => <View key={d.date} style={{ flex: 1, height: `${Math.max(4, (d.due / peak) * 100)}%`, borderRadius: 4, backgroundColor: i === 0 ? c.accent : c.soft2 }} accessibilityLabel={`${d.date}: ${d.due} due`} />)}
        </View>
        <Txt variant="small">Today includes anything overdue. Peak: {peak} cards in a day.</Txt>
      </Surface> : null}
    </> : null}
  </Screen>;
}
