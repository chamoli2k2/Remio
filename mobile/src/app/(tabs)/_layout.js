import { Tabs } from 'expo-router';
import { Platform } from 'react-native';
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
    tabBarStyle: { backgroundColor: c.surface, borderTopColor: c.border, height: 56 + insets.bottom, paddingTop: 6, paddingBottom: Platform.OS === 'ios' ? insets.bottom : insets.bottom + 4 },
  }}>
    {[tab('index', 'Home', 'home'), tab('library', 'Library', 'layers'), tab('notes', 'Notes', 'edit-3'), tab('profile', 'Profile', 'user')].map(t => <Tabs.Screen key={t.name} {...t} />)}
  </Tabs>;
}
