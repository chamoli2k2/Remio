import { useEffect, useRef, useState } from 'react';
import { Animated, BackHandler, Easing, Linking, Platform, Pressable, ScrollView, Text, View, useWindowDimensions } from 'react-native';
import { usePathname, useRouter } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { api } from '../api';
import { useAuth } from '../auth';
import { useNav } from '../nav';
import { FONT, useTheme } from '../theme';
import { Icon, Logo } from './ui';
import { BRAND } from '../../../shared/brand.js';

const GROUPS = [
  ['WORKSPACE', [['/', 'layers', 'My library'], ['/notes', 'edit-3', 'Notes'], ['/archive', 'archive', 'Archived folders']]],
  ['STUDY', [['/progress', 'bar-chart-2', 'My progress']]],
  ['PEOPLE', [['/shared', 'users', 'Shared with me'], ['/friends', 'user-plus', 'Friends'], ['/explore', 'compass', 'Explore']]],
];

/**
 * The side menu, with the same destinations and grouping as the website's. It slides over the
 * screen from the left, closes when something is chosen, on a tap outside it, or on the back button.
 */
export default function Sidebar() {
  const { open, hide } = useNav();
  const { user, logout } = useAuth();
  const { c, tone } = useTheme();
  const router = useRouter(), pathname = usePathname(), insets = useSafeAreaInsets();
  const { width } = useWindowDimensions();
  const panelWidth = Math.min(320, width * 0.84);
  const slide = useRef(new Animated.Value(0)).current;
  const [mounted, setMounted] = useState(false), [folders, setFolders] = useState([]);

  useEffect(() => {
    if (open) { setMounted(true); api('/folders').then(r => setFolders((r.folders || []).filter(f => f.role === 'owner').slice(0, 5)), () => {}); }
    Animated.timing(slide, { toValue: open ? 1 : 0, duration: 240, easing: Easing.out(Easing.cubic), useNativeDriver: true }).start(({ finished }) => { if (finished && !open) setMounted(false); });
  }, [open, slide]);
  useEffect(() => {
    if (!open || Platform.OS === 'web') return undefined;
    const sub = BackHandler.addEventListener('hardwareBackPress', () => { hide(); return true; });
    return () => sub.remove();
  }, [open, hide]);

  if (!mounted) return null;

  const go = (path, { top = true } = {}) => {
    hide();
    if (top) { if (pathname === path) return; if (router.canDismiss()) router.dismissAll(); router.replace(path); }
    else router.push(path);
  };
  const initials = (user?.name || user?.username || '?').split(/\s+/).map(w => w[0]).slice(0, 2).join('').toUpperCase();
  const link = (key, icon, label, onPress, active) => <Pressable key={key} onPress={onPress} accessibilityRole="button" accessibilityState={{ selected: !!active }}
    style={({ pressed }) => ({ flexDirection: 'row', alignItems: 'center', gap: 12, paddingVertical: 11, paddingHorizontal: 12, borderRadius: 12, backgroundColor: active ? c.soft : pressed ? c.surface2 : 'transparent' })}>
    <Icon name={icon} size={18} color={active ? c.accentDark : c.muted} />
    <Text style={{ fontFamily: active ? FONT.semibold : FONT.medium, fontSize: 15, color: active ? c.accentDark : c.text2 }}>{label}</Text>
  </Pressable>;
  const caption = text => <Text style={{ fontFamily: FONT.semibold, fontSize: 10.5, letterSpacing: 1.4, color: c.muted, marginTop: 14, marginBottom: 4, paddingHorizontal: 12 }}>{text}</Text>;

  return <View pointerEvents="box-none" style={{ position: 'absolute', top: 0, left: 0, right: 0, bottom: 0, zIndex: 50 }}>
    <Animated.View style={{ position: 'absolute', top: 0, left: 0, right: 0, bottom: 0, backgroundColor: '#000', opacity: slide.interpolate({ inputRange: [0, 1], outputRange: [0, 0.45] }) }}>
      <Pressable style={{ flex: 1 }} onPress={hide} accessibilityRole="button" accessibilityLabel="Close menu" />
    </Animated.View>
    <Animated.View style={{ position: 'absolute', top: 0, bottom: 0, left: 0, width: panelWidth, backgroundColor: c.surface, borderRightWidth: 1, borderRightColor: c.border, paddingTop: insets.top + 8, paddingBottom: insets.bottom,
      transform: [{ translateX: slide.interpolate({ inputRange: [0, 1], outputRange: [-panelWidth, 0] }) }] }}>
      <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: 16, paddingBottom: 12 }}>
        <Logo size={28} />
        <Pressable onPress={hide} hitSlop={10} accessibilityRole="button" accessibilityLabel="Hide menu" style={{ padding: 6 }}><Icon name="menu" size={22} color={c.muted} /></Pressable>
      </View>
      <Pressable onPress={() => go('/folder/edit', { top: false })} accessibilityRole="button" style={({ pressed }) => ({ marginHorizontal: 16, marginBottom: 6, minHeight: 46, borderRadius: 12, backgroundColor: c.accent, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8, opacity: pressed ? 0.85 : 1 })}>
        <Icon name="plus" size={18} color="#fff" /><Text style={{ fontFamily: FONT.semibold, fontSize: 15, color: '#fff' }}>Create a folder</Text>
      </Pressable>

      <ScrollView contentContainerStyle={{ paddingHorizontal: 10, paddingBottom: 12 }}>
        {GROUPS.map(([name, items]) => <View key={name}>{caption(name)}{items.map(([path, icon, label]) => link(path, icon, label, () => go(path), pathname === path))}</View>)}
        {folders.length ? <View>{caption('YOUR FOLDERS')}{folders.map(f => <Pressable key={f.id} onPress={() => go(`/folder/${f.id}`, { top: false })} accessibilityRole="button"
          style={({ pressed }) => ({ flexDirection: 'row', alignItems: 'center', gap: 12, paddingVertical: 10, paddingHorizontal: 12, borderRadius: 12, backgroundColor: pressed ? c.surface2 : 'transparent' })}>
          <View style={{ width: 9, height: 9, borderRadius: 5, backgroundColor: tone(f.color).tone }} />
          <Text numberOfLines={1} style={{ flex: 1, fontFamily: FONT.medium, fontSize: 14.5, color: c.text2 }}>{f.title}</Text>
        </Pressable>)}</View> : null}
        <View style={{ marginTop: 14, borderTopWidth: 1, borderTopColor: c.border, paddingTop: 8 }}>
          {link('premium', 'award', 'Premium', () => { hide(); Linking.openURL(`https://${BRAND.domain}/premium`).catch(() => {}); })}
          {link('settings', 'settings', 'Settings', () => go('/settings'), pathname === '/settings')}
        </View>
      </ScrollView>

      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10, padding: 14, borderTopWidth: 1, borderTopColor: c.border }}>
        <Pressable onPress={() => go(`/u/${user?.username}`, { top: false })} accessibilityRole="button" accessibilityLabel="Your profile" style={{ flex: 1, flexDirection: 'row', alignItems: 'center', gap: 10 }}>
          <View style={{ width: 38, height: 38, borderRadius: 19, backgroundColor: c.soft2, alignItems: 'center', justifyContent: 'center' }}><Text style={{ fontFamily: FONT.semibold, fontSize: 13, color: c.accentDark }}>{initials}</Text></View>
          <View style={{ flex: 1 }}>
            <Text numberOfLines={1} style={{ fontFamily: FONT.semibold, fontSize: 14, color: c.ink }}>{user?.name || 'Guest'}</Text>
            <Text numberOfLines={1} style={{ fontFamily: FONT.body, fontSize: 12, color: c.muted }}>@{user?.username}</Text>
          </View>
        </Pressable>
        <Pressable onPress={() => { hide(); logout(); }} hitSlop={8} accessibilityRole="button" accessibilityLabel="Sign out" style={{ flexDirection: 'row', alignItems: 'center', gap: 6, padding: 8 }}>
          <Icon name="log-out" size={16} color={c.muted} /><Text style={{ fontFamily: FONT.medium, fontSize: 13, color: c.muted }}>Sign out</Text>
        </Pressable>
      </View>
    </Animated.View>
  </View>;
}
