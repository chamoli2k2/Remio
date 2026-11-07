import { Redirect } from 'expo-router';
import { useAuth } from '../auth';

/**
 * Where a link lands when its screen is not available: a signed-out visitor opening the app's
 * home, or a signed-in one opening the login page. Each is sent to the screen that exists for them.
 */
export default function NotFound() {
  const { status } = useAuth();
  return <Redirect href={status === 'signedIn' ? '/' : '/login'} />;
}
