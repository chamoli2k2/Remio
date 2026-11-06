import { useRef, useState } from 'react';
import { KeyboardAvoidingView, Linking, Platform, Pressable, ScrollView, TextInput, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useAuth } from '../../auth';
import { useTheme, FONT } from '../../theme';
import { Button, Field, Icon, Logo, Txt, Surface } from '../../components/ui';
import { BRAND } from '../../../../shared/brand.js';

const web = path => Linking.openURL(`https://${BRAND.domain}${path}`).catch(() => {});

export default function Login() {
  const { login } = useAuth();
  const { c } = useTheme();
  const [identifier, setIdentifier] = useState(''), [password, setPassword] = useState('');
  const [show, setShow] = useState(false), [busy, setBusy] = useState(false), [error, setError] = useState('');
  const passwordRef = useRef(null);

  async function submit() {
    if (busy) return;
    if (!identifier.trim() || !password) return setError('Enter your username or email, and your password.');
    setBusy(true); setError('');
    try { await login(identifier, password); }
    catch (e) { setError(e.message); setBusy(false); }
  }

  return <SafeAreaView style={{ flex: 1, backgroundColor: c.bg }}>
    <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
      <ScrollView contentContainerStyle={{ flexGrow: 1, justifyContent: 'center', padding: 24, gap: 28 }} keyboardShouldPersistTaps="handled">
        <View style={{ gap: 10 }}>
          <Logo size={44} />
          <Txt variant="body" style={{ color: c.muted, fontSize: 17 }}>{BRAND.tagline}</Txt>
        </View>

        <Surface style={{ gap: 16, padding: 20 }}>
          <Txt variant="title">Welcome back</Txt>
          <Field label="Username or email" value={identifier} onChangeText={setIdentifier} autoCapitalize="none" autoCorrect={false}
            autoComplete="username" textContentType="username" returnKeyType="next" onSubmitEditing={() => passwordRef.current?.focus()} />
          <View style={{ gap: 6 }}>
            <Txt variant="small" style={{ fontFamily: FONT.medium, color: c.text2 }}>Password</Txt>
            <View style={{ flexDirection: 'row', alignItems: 'center', borderRadius: 12, borderWidth: 1, borderColor: c.border, backgroundColor: c.surface }}>
              <TextInput ref={passwordRef} value={password} onChangeText={setPassword} secureTextEntry={!show} autoCapitalize="none" autoCorrect={false}
                autoComplete="current-password" textContentType="password" returnKeyType="go" onSubmitEditing={submit}
                placeholderTextColor={c.text3} selectionColor={c.accent}
                style={{ flex: 1, minHeight: 50, paddingHorizontal: 14, fontFamily: FONT.body, fontSize: 16, color: c.ink }} />
              <Pressable onPress={() => setShow(v => !v)} hitSlop={10} accessibilityLabel={show ? 'Hide password' : 'Show password'} style={{ padding: 14 }}>
                <Icon name={show ? 'eye-off' : 'eye'} size={19} color={c.muted} />
              </Pressable>
            </View>
          </View>
          {error ? <Txt variant="small" style={{ color: c.danger }} accessibilityRole="alert">{error}</Txt> : null}
          <Button title="Sign in" onPress={submit} loading={busy} />
          <Pressable onPress={() => web('/forgot-password')} hitSlop={8}><Txt variant="small" style={{ color: c.accent, textAlign: 'center', fontFamily: FONT.medium }}>Forgot your password?</Txt></Pressable>
        </Surface>

        <View style={{ alignItems: 'center', gap: 6 }}>
          <Txt variant="small">New to {BRAND.name}?</Txt>
          <Button title={`Create an account on ${BRAND.domain}`} variant="soft" small icon="external-link" onPress={() => web('/signup')} />
        </View>
      </ScrollView>
    </KeyboardAvoidingView>
  </SafeAreaView>;
}
