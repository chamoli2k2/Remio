import { useState } from 'react';
import { Text, View, useWindowDimensions } from 'react-native';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { api } from '../../api';
import { Alert } from '../../alert';
import { useAuth } from '../../auth';
import { useQuery } from '../../hooks/useQuery';
import { FONT, useTheme } from '../../theme';
import FolderCard from '../../components/FolderCard';
import { BackButton, Button, Empty, ErrorBox, Header, Loading, Screen, Surface, Txt } from '../../components/ui';

/** A learner's public page: who they are, how many follow them, and the collections they have published. */
export default function Profile() {
  const { username } = useLocalSearchParams();
  const router = useRouter();
  const { user } = useAuth();
  const { c } = useTheme();
  const { width } = useWindowDimensions();
  const { data, error, loading, reload } = useQuery(`/users/${username}`);
  const [busy, setBusy] = useState(false);
  const p = data?.profile, folders = data?.folders || [];
  const rel = p?.relation || { following: false, friendship: user?.username === p?.username ? 'self' : 'none' };
  const cardWidth = (Math.min(width, 640) - 40 - 12) / 2;
  const initials = (p?.name || p?.username || '?').split(/\s+/).map(w => w[0]).slice(0, 2).join('').toUpperCase();

  async function act(path, method = 'POST') {
    if (busy) return;
    setBusy(true);
    try { await api(`/users/${p.username}/${path}`, { method }); await reload(); } catch (e) { Alert.alert('Could not do that', e.message); } finally { setBusy(false); }
  }

  return <Screen onRefresh={reload}>
    <Header title="Profile" left={<BackButton />} />
    {error ? <ErrorBox message={error} onRetry={reload} /> : null}
    {loading && !data ? <Loading /> : null}
    {p ? <>
      <Surface style={{ gap: 14, alignItems: 'center', paddingVertical: 22 }}>
        <View style={{ width: 78, height: 78, borderRadius: 39, backgroundColor: c.soft2, alignItems: 'center', justifyContent: 'center' }}>
          <Text style={{ fontFamily: FONT.display, fontSize: 28, color: c.accentDark }}>{initials}</Text>
        </View>
        <View style={{ alignItems: 'center', gap: 2 }}>
          <Text style={{ fontFamily: FONT.semibold, fontSize: 11, letterSpacing: 1.4, color: c.accent }}>LEARNER</Text>
          <Text style={{ fontFamily: FONT.display, fontSize: 26, letterSpacing: -0.7, color: c.ink, textAlign: 'center' }}>{p.name}</Text>
          <Txt variant="small">@{p.username}</Txt>
        </View>
        {p.bio ? <Txt variant="body" style={{ textAlign: 'center', color: c.text2 }}>{p.bio}</Txt> : null}
        <View style={{ flexDirection: 'row', gap: 22 }}>
          {[['followers', p.followers], ['following', p.following], ['friends', p.friends]].map(([label, n]) => <View key={label} style={{ alignItems: 'center' }}>
            <Text style={{ fontFamily: FONT.display, fontSize: 20, color: c.ink }}>{n || 0}</Text><Txt variant="small">{label}</Txt>
          </View>)}
        </View>
        {rel.friendship === 'self'
          ? <Button title="Settings" variant="soft" small icon="settings" onPress={() => router.push('/settings')} />
          : <View style={{ flexDirection: 'row', gap: 10, flexWrap: 'wrap', justifyContent: 'center' }}>
            <Button small title={rel.following ? 'Following' : 'Follow'} variant={rel.following ? 'secondary' : 'primary'} loading={busy} onPress={() => act('follow', rel.following ? 'DELETE' : 'POST')} />
            {rel.friendship === 'none' ? <Button small variant="secondary" title="Connect" disabled={busy} onPress={() => act('connect')} /> : null}
            {rel.friendship === 'outgoing' ? <Button small variant="secondary" title="Requested" disabled /> : null}
            {rel.friendship === 'incoming' ? <><Button small title="Accept" disabled={busy} onPress={() => act('connect/accept')} /><Button small variant="secondary" title="Decline" disabled={busy} onPress={() => act('connect/decline')} /></> : null}
            {rel.friendship === 'friends' ? <Button small variant="secondary" title="Friends" disabled={busy} onPress={() => act('connect', 'DELETE')} /> : null}
          </View>}
      </Surface>

      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8, marginTop: 4 }}>
        <Text style={{ fontFamily: FONT.display, fontSize: 21, letterSpacing: -0.5, color: c.ink }}>Public collections</Text>
        <View style={{ paddingHorizontal: 8, paddingVertical: 2, borderRadius: 8, backgroundColor: c.surface3 }}><Text style={{ fontFamily: FONT.semibold, fontSize: 12, color: c.muted }}>{folders.length}</Text></View>
      </View>
      {!folders.length ? <Surface><Empty icon="layers" title="A little mystery" text="This learner hasn't published any collections yet." /></Surface> : null}
      <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 12 }}>
        {folders.map(f => <FolderCard key={f.id} f={f} width={cardWidth} onPress={() => router.push(`/folder/${f.id}`)} />)}
      </View>
    </> : null}
  </Screen>;
}
