import { useCallback, useEffect, useState } from 'react';
import { Linking, Pressable, Switch, View } from 'react-native';
import { Alert } from '../../alert';
import { DEFAULTS, loadPrefs, permission, requestPermission, savePrefs, sendTest, supported, sync } from '../../reminders';
import { useAuth } from '../../auth';
import { FONT, useTheme } from '../../theme';
import { Button, PageHeading, Screen, Surface, TopBar, Txt } from '../../components/ui';
import { BRAND } from '../../../../shared/brand.js';

const MODES = [['system', 'System'], ['light', 'Light'], ['dark', 'Dark']];
const web = path => Linking.openURL(`https://${BRAND.domain}${path}`).catch(() => {});

const timeLabel = (h, m) => `${((h + 11) % 12) + 1}:${String(m).padStart(2, '0')} ${h < 12 ? 'AM' : 'PM'}`;

/** Turn the study reminders on or off, and choose when they arrive. */
function Reminders({ name }) {
  const { c } = useTheme();
  const [prefs, setPrefs] = useState(DEFAULTS), [perm, setPerm] = useState('undetermined'), [note, setNote] = useState('');
  useEffect(() => { loadPrefs().then(setPrefs); permission().then(setPerm); }, []);
  const change = useCallback(async patch => {
    const next = { ...prefs, ...patch };
    setPrefs(next); await savePrefs(next); await sync({ name, force: true });
  }, [prefs, name]);

  async function toggle(on) {
    setNote('');
    if (!on) return change({ enabled: false });
    const result = await requestPermission();
    setPerm(result);
    if (result !== 'granted') return setNote('Notifications are off for Remio on this phone. Allow them in Settings, then switch this on again.');
    await change({ enabled: true });
  }
  const step = delta => { const total = (prefs.hour * 60 + prefs.minute + delta + 1440) % 1440; change({ hour: Math.floor(total / 60), minute: total % 60 }); };
  const test = async () => { setNote(''); const s = await sendTest(name); setNote(s ? 'A test reminder arrives in a few seconds. Lock your phone or leave the app to see it.' : 'A test reminder arrives in a few seconds.'); };
  const row = { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 12 };

  if (!supported) return <Surface style={{ gap: 6 }}><Txt variant="heading">Reminders</Txt><Txt variant="small">Study reminders are available in the phone app.</Txt></Surface>;
  return <Surface style={{ gap: 14 }}>
    <View style={row}>
      <View style={{ flex: 1 }}><Txt variant="heading">Daily reminder</Txt><Txt variant="small">A nudge with how many cards are due and your streak.</Txt></View>
      <Switch value={prefs.enabled} onValueChange={toggle} trackColor={{ true: c.accent, false: c.surface3 }} accessibilityLabel="Daily study reminder" />
    </View>
    {prefs.enabled ? <>
      <View style={row}>
        <Txt>Time</Txt>
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10 }}>
          <Button title="-" variant="secondary" small onPress={() => step(-30)} />
          <Txt style={{ fontFamily: FONT.semibold, minWidth: 82, textAlign: 'center' }}>{timeLabel(prefs.hour, prefs.minute)}</Txt>
          <Button title="+" variant="secondary" small onPress={() => step(30)} />
        </View>
      </View>
      <View style={row}>
        <View style={{ flex: 1 }}><Txt>Streak saver</Txt><Txt variant="small">At 8:30 PM, only if you have a streak and have not studied yet.</Txt></View>
        <Switch value={prefs.streakSaver} onValueChange={v => change({ streakSaver: v })} trackColor={{ true: c.accent, false: c.surface3 }} accessibilityLabel="Streak saver reminder" />
      </View>
      <Button title="Send a test reminder" variant="soft" small icon="bell" onPress={test} />
    </> : null}
    {perm === 'blocked' ? <Button title="Open phone settings" variant="ghost" small onPress={() => Linking.openSettings().catch(() => {})} /> : null}
    {note ? <Txt variant="small" style={{ color: c.text2 }}>{note}</Txt> : null}
  </Surface>;
}

export default function Settings() {
  const { user, logout } = useAuth();
  const { c, preference, setPreference } = useTheme();
  const initials = (user?.name || user?.username || '?').split(/\s+/).map(w => w[0]).slice(0, 2).join('').toUpperCase();

  const signOut = () => Alert.alert('Sign out?', 'Answers not yet synced are sent first.', [{ text: 'Cancel', style: 'cancel' }, { text: 'Sign out', style: 'destructive', onPress: () => { logout(); } }]);

  return <Screen>
    <TopBar />
    <PageHeading eyebrow="YOUR ACCOUNT" title="Settings" />
    <Surface style={{ flexDirection: 'row', alignItems: 'center', gap: 14 }}>
      <View style={{ width: 56, height: 56, borderRadius: 28, backgroundColor: c.accent, alignItems: 'center', justifyContent: 'center' }}>
        <Txt style={{ color: '#fff', fontFamily: FONT.heading, fontSize: 20 }}>{initials}</Txt>
      </View>
      <View style={{ flex: 1 }}>
        <Txt variant="title" numberOfLines={1}>{user?.name}</Txt>
        <Txt variant="small" numberOfLines={1}>@{user?.username}{user?.email ? ` · ${user.email}` : ''}</Txt>
      </View>
    </Surface>

    <Surface style={{ gap: 12 }}>
      <Txt variant="heading">Appearance</Txt>
      <View style={{ flexDirection: 'row', backgroundColor: c.surface3, borderRadius: 12, padding: 4 }}>
        {MODES.map(([key, label]) => {
          const on = preference === key;
          return <Pressable key={key} onPress={() => setPreference(key)} accessibilityRole="button" accessibilityState={{ selected: on }}
            style={{ flex: 1, alignItems: 'center', paddingVertical: 9, borderRadius: 9, backgroundColor: on ? c.surface : 'transparent' }}>
            <Txt style={{ fontFamily: on ? FONT.semibold : FONT.body, color: on ? c.ink : c.muted }}>{label}</Txt>
          </Pressable>;
        })}
      </View>
    </Surface>

    <Reminders name={user?.name} />

    <Surface style={{ gap: 10 }}>
      <Txt variant="heading">Account</Txt>
      <Txt variant="small">Plan, billing, sharing and account deletion are managed on the website.</Txt>
      <Button title={`Open ${BRAND.domain}`} variant="soft" icon="external-link" onPress={() => web('/')} />
      <Button title="Privacy policy" variant="ghost" onPress={() => web('/privacy')} />
      <Button title="Terms" variant="ghost" onPress={() => web('/terms')} />
    </Surface>

    <Button title="Sign out" variant="danger" icon="log-out" onPress={signOut} />
  </Screen>;
}
