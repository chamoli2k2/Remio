import { useEffect, useState } from 'react';
import { Pressable, Text } from 'react-native';
import { usePathname, useRouter } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { isOffline, needsAttention, pendingChanges, subscribe } from '../offline';
import { pendingCount, subscribe as subscribeReviews } from '../reviewQueue';
import { FONT, useTheme } from '../theme';
import { Icon } from './ui';

/** A small pill saying what is waiting to sync. Hidden when there is nothing to say, and out of the way during study. */
export default function SyncBar() {
  const { c } = useTheme();
  const router = useRouter();
  const path = usePathname();
  const insets = useSafeAreaInsets();
  const [s, setS] = useState({ changes: pendingChanges(), problems: needsAttention(), reviews: pendingCount(), offline: isOffline() });
  useEffect(() => {
    const off = subscribe(e => setS(x => ({ ...x, changes: e.pending, problems: e.failed, offline: e.offline })));
    const off2 = subscribeReviews(e => { if ('pending' in e) setS(x => ({ ...x, reviews: e.pending })); });
    return () => { off(); off2(); };
  }, []);
  const waiting = s.changes + s.reviews;
  if (path.startsWith('/study') || path === '/sync' || (!s.problems && !waiting && !s.offline)) return null;
  const bad = s.problems > 0;
  const text = bad ? `${s.problems} change${s.problems === 1 ? '' : 's'} need${s.problems === 1 ? 's' : ''} your attention`
    : waiting ? (s.offline ? `Offline · ${waiting} waiting to sync` : `Syncing ${waiting}…`) : 'Offline · showing saved data';
  return <Pressable onPress={() => router.push('/sync')} accessibilityRole="button" accessibilityLabel={text}
    style={{ position: 'absolute', alignSelf: 'center', bottom: insets.bottom + 10, flexDirection: 'row', alignItems: 'center', gap: 8, paddingHorizontal: 14, paddingVertical: 9, borderRadius: 999,
      backgroundColor: bad ? c.danger : c.ink, shadowColor: '#000', shadowOpacity: 0.2, shadowRadius: 10, shadowOffset: { width: 0, height: 4 }, elevation: 6 }}>
    <Icon name={bad ? 'alert-circle' : s.offline ? 'wifi-off' : 'refresh-cw'} size={14} color={c.bg} />
    <Text style={{ fontFamily: FONT.medium, fontSize: 13, color: c.bg }}>{text}</Text>
  </Pressable>;
}
