import { useState } from 'react';
import { Pressable, Text, View } from 'react-native';
import { useRouter } from 'expo-router';
import { api } from '../../api';
import { Alert } from '../../alert';
import { useQuery } from '../../hooks/useQuery';
import { FONT, useTheme } from '../../theme';
import { Button, Empty, ErrorBox, Icon, Loading, PageHeading, Screen, Surface, TopBar, Txt } from '../../components/ui';

function Person({ p, children }) {
  const router = useRouter();
  const { c } = useTheme();
  const initials = (p.name || p.username).split(/\s+/).map(w => w[0]).slice(0, 2).join('').toUpperCase();
  return <Surface style={{ flexDirection: 'row', alignItems: 'center', gap: 12, padding: 12 }}>
    <Pressable onPress={() => router.push(`/u/${p.username}`)} accessibilityRole="button" style={{ flex: 1, flexDirection: 'row', alignItems: 'center', gap: 12 }}>
      <View style={{ width: 42, height: 42, borderRadius: 21, backgroundColor: c.soft2, alignItems: 'center', justifyContent: 'center' }}><Text style={{ fontFamily: FONT.semibold, fontSize: 14, color: c.accentDark }}>{initials}</Text></View>
      <View style={{ flex: 1 }}><Txt variant="medium" numberOfLines={1}>{p.name}</Txt><Txt variant="small" numberOfLines={1}>@{p.username}</Txt></View>
    </Pressable>
    {children}
  </Surface>;
}

export default function Friends() {
  const friends = useQuery('/me/friends'), requests = useQuery('/me/requests');
  const [busy, setBusy] = useState('');
  async function answer(username, action) {
    if (busy) return;
    setBusy(username);
    try { await api(`/users/${username}/connect/${action}`, { method: 'POST' }); await Promise.all([friends.reload(), requests.reload()]); }
    catch (e) { Alert.alert('Could not do that', e.message); }
    finally { setBusy(''); }
  }
  const asked = requests.data?.people || [], list = friends.data?.people || [];
  return <Screen onRefresh={() => Promise.all([friends.reload(), requests.reload()])}>
    <TopBar />
    <PageHeading eyebrow="YOUR PEOPLE" title="Friends" subtitle="Find people to follow and connect with on remio.in." />
    {friends.error ? <ErrorBox message={friends.error} onRetry={friends.reload} /> : null}
    {friends.loading && !friends.data ? <Loading /> : null}
    {asked.length ? <View style={{ gap: 10 }}>
      <Txt variant="label">REQUESTS</Txt>
      {asked.map(p => <Person key={p.id} p={p}>
        <Button small title="Accept" loading={busy === p.username} onPress={() => answer(p.username, 'accept')} />
        <Button small variant="secondary" title="Decline" disabled={!!busy} onPress={() => answer(p.username, 'decline')} />
      </Person>)}
    </View> : null}
    <View style={{ gap: 10 }}>
      <Txt variant="label">FRIENDS · {list.length}</Txt>
      {friends.data && !list.length ? <Surface><Empty icon="users" title="No friends yet" text="Connect with people from their profile on remio.in." /></Surface> : null}
      {list.map(p => <Person key={p.id} p={p}><Icon name="chevron-right" size={18} color="#8884" /></Person>)}
    </View>
  </Screen>;
}
