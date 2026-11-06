import { useEffect } from 'react';
import { Stack } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import * as SplashScreen from 'expo-splash-screen';
import { useFonts } from 'expo-font';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { DMSans_400Regular, DMSans_500Medium, DMSans_700Bold } from '@expo-google-fonts/dm-sans';
import { Manrope_700Bold, Manrope_800ExtraBold } from '@expo-google-fonts/manrope';
import { ThemeProvider, useTheme } from '../theme';
import { AuthProvider, useAuth } from '../auth';

SplashScreen.preventAutoHideAsync().catch(() => {});

/**
 * Which screens exist depends on whether somebody is signed in. `Stack.Protected` removes the
 * other group entirely, so a signed-out person cannot be navigated (or deep-linked) to a library
 * and a signed-in one lands on the app instead of the login form.
 */
function Routes() {
  const { status } = useAuth();
  const { c, dark } = useTheme();
  const signedIn = status === 'signedIn';
  useEffect(() => { if (status !== 'loading') SplashScreen.hideAsync().catch(() => {}); }, [status]);
  if (status === 'loading') return null;
  return <>
    <StatusBar style={dark ? 'light' : 'dark'} />
    <Stack screenOptions={{ headerShown: false, contentStyle: { backgroundColor: c.bg }, animation: 'slide_from_right' }}>
      <Stack.Protected guard={signedIn}>
        <Stack.Screen name="(tabs)" />
        <Stack.Screen name="folder/[id]" />
        <Stack.Screen name="study/[id]" options={{ gestureEnabled: false, animation: 'slide_from_bottom' }} />
        <Stack.Screen name="notebook/[id]" />
        <Stack.Screen name="note/[id]" />
      </Stack.Protected>
      <Stack.Protected guard={!signedIn}>
        <Stack.Screen name="(auth)" />
      </Stack.Protected>
    </Stack>
  </>;
}

export default function RootLayout() {
  const [loaded, error] = useFonts({ DMSans_400Regular, DMSans_500Medium, DMSans_700Bold, Manrope_700Bold, Manrope_800ExtraBold });
  // A font that fails to load should not leave the app on the splash screen forever.
  if (!loaded && !error) return null;
  return <SafeAreaProvider><ThemeProvider><AuthProvider><Routes /></AuthProvider></ThemeProvider></SafeAreaProvider>;
}
