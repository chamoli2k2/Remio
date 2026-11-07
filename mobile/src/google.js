import { Platform } from 'react-native';

/**
 * Signing in with Google from the phone.
 *
 * The phone asks Google for an ID token and the server checks it exactly as it does for the
 * website (`POST /api/auth/google`). Asking with the website's client id as `webClientId` makes the
 * token's audience that same client, so the server needs nothing extra to accept it.
 *
 * The sign-in library is native code, so it exists only in an installed or development build. In
 * Expo Go and in the browser it is absent, `googleAvailable` is false and the button is not shown.
 */
const WEB_CLIENT_ID = process.env.EXPO_PUBLIC_GOOGLE_WEB_CLIENT_ID || '';
const IOS_CLIENT_ID = process.env.EXPO_PUBLIC_GOOGLE_IOS_CLIENT_ID || '';

let lib = null;
if (Platform.OS !== 'web' && WEB_CLIENT_ID) {
  try {
    lib = require('@react-native-google-signin/google-signin');
    lib.GoogleSignin.configure({ webClientId: WEB_CLIENT_ID, ...(IOS_CLIENT_ID ? { iosClientId: IOS_CLIENT_ID } : {}), scopes: ['profile', 'email'] });
  } catch { lib = null; }
}

export const googleAvailable = !!lib && (Platform.OS !== 'ios' || !!IOS_CLIENT_ID);

/** Ask Google who the person is. Returns the ID token, or null if they backed out. */
export async function googleCredential() {
  const { GoogleSignin, isErrorWithCode, statusCodes } = lib;
  try {
    if (Platform.OS === 'android') await GoogleSignin.hasPlayServices({ showPlayServicesUpdateDialog: true });
    // Forget the last account so the person is asked which one to use, rather than silently reusing it.
    await GoogleSignin.signOut().catch(() => {});
    const result = await GoogleSignin.signIn();
    if (result.type === 'cancelled') return null;
    const token = result.data?.idToken;
    if (!token) throw new Error('Google did not return a sign-in. Please try again.');
    return token;
  } catch (e) {
    if (isErrorWithCode?.(e)) {
      if (e.code === statusCodes.SIGN_IN_CANCELLED) return null;
      if (e.code === statusCodes.IN_PROGRESS) return null;
      if (e.code === statusCodes.PLAY_SERVICES_NOT_AVAILABLE) throw new Error('Google Play services are needed to sign in with Google on this phone.');
    }
    throw new Error(e?.message?.includes('DEVELOPER_ERROR') ? 'Google sign-in is not set up for this build yet.' : e?.message || 'Google sign-in did not finish. Please try again.');
  }
}

/** Forget the Google account on the phone when signing out of the app. */
export const forgetGoogle = () => { try { lib?.GoogleSignin.signOut().catch(() => {}); } catch { /* nothing to forget */ } };
