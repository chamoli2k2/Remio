import { Alert, Linking, Pressable, View } from 'react-native';
import { useAuth } from '../../auth';
import { FONT, useTheme } from '../../theme';
import { Button, Screen, Surface, Txt } from '../../components/ui';
import { BRAND } from '../../../../shared/brand.js';

const MODES = [['system', 'System'], ['light', 'Light'], ['dark', 'Dark']];
const web = path => Linking.openURL(`https://${BRAND.domain}${path}`).catch(() => {});

export default function Profile() {
  const { user, logout } = useAuth();
  const { c, preference, setPreference } = useTheme();
  const initials = (user?.name || user?.username || '?').split(/\s+/).map(w => w[0]).slice(0, 2).join('').toUpperCase();

  const signOut = () => Alert.alert('Sign out?', 'Answers not yet synced are sent first.', [{ text: 'Cancel', style: 'cancel' }, { text: 'Sign out', style: 'destructive', onPress: () => { logout(); } }]);

  return <Screen>
    <Txt variant="display" style={{ fontSize: 28 }}>Profile</Txt>
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
