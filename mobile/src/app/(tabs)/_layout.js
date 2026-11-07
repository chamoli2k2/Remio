import { Stack } from 'expo-router';
import { useTheme } from '../../theme';

/** The destinations in the side menu. They swap in place rather than stacking, as menu choices should. */
export default function MainLayout() {
  const { c } = useTheme();
  return <Stack screenOptions={{ headerShown: false, animation: 'fade', contentStyle: { backgroundColor: c.bg } }} />;
}
