import { Tabs } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Feather } from '@expo/vector-icons';
import { FONT, useTheme } from '../../theme';

const tab = (name, title, icon) => ({ name, options: { title, tabBarIcon: ({ color, size }) => <Feather name={icon} size={size - 2} color={color} /> } });

export default function TabsLayout() {
  const { c } = useTheme();
  const insets = useSafeAreaInsets();
  return <Tabs screenOptions={{
    headerShown: false,
    tabBarActiveTintColor: c.accent, tabBarInactiveTintColor: c.muted,
    tabBarLabelStyle: { fontFamily: FONT.medium, fontSize: 11 },
    tabBarStyle: { backgroundColor: c.surface, borderTopColor: c.border, height: 54 + Math.max(insets.bottom - 10, 8), paddingTop: 6, paddingBottom: Math.max(insets.bottom - 10, 8) },
  }}>
    {[tab('index', 'Library', 'layers'), tab('notes', 'Notes', 'edit-3'), tab('profile', 'Profile', 'user')].map(t => <Tabs.Screen key={t.name} {...t} />)}
  </Tabs>;
}
