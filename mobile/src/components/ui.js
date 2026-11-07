import { useMemo } from 'react';
import { ActivityIndicator, Image, Pressable, RefreshControl, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useRouter } from 'expo-router';
import { Feather, MaterialCommunityIcons } from '@expo/vector-icons';
import { FONT, RADIUS, useTheme } from '../theme';
import { BRAND } from '../../../shared/brand.js';
import { useAuth } from '../auth';

/** Styles that depend on the theme, rebuilt only when it changes. */
export function useStyles(factory) {
  const theme = useTheme();
  return useMemo(() => StyleSheet.create(factory(theme)), [theme]); // eslint-disable-line react-hooks/exhaustive-deps
}

export function Screen({ children, scroll = true, onRefresh, refreshing = false, edges = ['top'], padded = true, contentStyle }) {
  const { c } = useTheme();
  const insets = useSafeAreaInsets();
  // Content runs the full height of the screen and is padded by the notch and home bar itself,
  // so scrolling passes behind the status bar instead of stopping under a separate strip.
  const top = edges.includes('top') ? insets.top : 0;
  const pad = padded ? 20 : 0;
  const body = scroll
    ? <ScrollView
        style={{ flex: 1 }}
        contentInsetAdjustmentBehavior="never"
        contentContainerStyle={[{ padding: pad, paddingTop: top ? top + 6 : pad, paddingBottom: 24 + insets.bottom, gap: 16 }, contentStyle]}
        keyboardShouldPersistTaps="handled"
        refreshControl={onRefresh ? <RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={c.accent} progressViewOffset={top} /> : undefined}>
        {children}
      </ScrollView>
    : <View style={[{ flex: 1, padding: pad, paddingTop: top ? top + 6 : pad }, contentStyle]}>{children}</View>;
  return <View style={{ flex: 1, backgroundColor: c.bg }}>{body}</View>;
}

export function Txt({ children, style, variant = 'body', numberOfLines, ...rest }) {
  const { c } = useTheme();
  const base = {
    display: { fontFamily: FONT.display, fontSize: 30, letterSpacing: -1, color: c.ink },
    title: { fontFamily: FONT.heading, fontSize: 22, letterSpacing: -0.5, color: c.ink },
    heading: { fontFamily: FONT.heading, fontSize: 17, color: c.ink },
    body: { fontFamily: FONT.body, fontSize: 15, lineHeight: 22, color: c.ink },
    medium: { fontFamily: FONT.medium, fontSize: 15, color: c.ink },
    small: { fontFamily: FONT.body, fontSize: 13, color: c.muted },
    label: { fontFamily: FONT.semibold, fontSize: 12, letterSpacing: 0.6, textTransform: 'uppercase', color: c.muted },
  }[variant];
  return <Text style={[base, style]} numberOfLines={numberOfLines} {...rest}>{children}</Text>;
}

export function Surface({ children, style, onPress, ...rest }) {
  const { c } = useTheme();
  const box = [{ backgroundColor: c.surface, borderColor: c.border, borderWidth: 1, borderRadius: RADIUS, padding: 16 }, style];
  if (!onPress) return <View style={box} {...rest}>{children}</View>;
  return <Pressable onPress={onPress} style={({ pressed }) => [...box, pressed && { opacity: 0.85, transform: [{ scale: 0.995 }] }]} {...rest}>{children}</Pressable>;
}

export function Button({ title, onPress, variant = 'primary', loading = false, disabled = false, icon, style, small = false }) {
  const { c } = useTheme();
  const off = disabled || loading;
  const palette = {
    primary: { bg: c.accent, fg: c.onAccent, border: c.accent },
    secondary: { bg: c.surface, fg: c.ink, border: c.border },
    soft: { bg: c.soft, fg: c.accent, border: c.soft },
    ghost: { bg: 'transparent', fg: c.accent, border: 'transparent' },
    danger: { bg: 'transparent', fg: c.danger, border: c.border },
  }[variant];
  return <Pressable accessibilityRole="button" accessibilityState={{ disabled: off }} disabled={off} onPress={onPress}
    style={({ pressed }) => [{
      minHeight: small ? 38 : 50, paddingHorizontal: small ? 14 : 20, borderRadius: 12, borderWidth: 1, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8,
      backgroundColor: palette.bg, borderColor: palette.border, opacity: off ? 0.55 : pressed ? 0.85 : 1,
    }, style]}>
    {loading ? <ActivityIndicator color={palette.fg} /> : icon ? <Feather name={icon} size={small ? 16 : 18} color={palette.fg} /> : null}
    <Text numberOfLines={1} style={{ fontFamily: FONT.semibold, fontSize: small ? 14 : 16, color: palette.fg, flexShrink: 1 }}>{title}</Text>
  </Pressable>;
}

export function Field({ label, error, style, ...props }) {
  const { c, dark } = useTheme();
  return <View style={{ gap: 6 }}>
    {label ? <Txt variant="small" style={{ fontFamily: FONT.medium, color: c.text2 }}>{label}</Txt> : null}
    <TextInput placeholderTextColor={c.text3} selectionColor={c.accent} keyboardAppearance={dark ? 'dark' : 'light'}
      style={[{ minHeight: 50, borderRadius: 12, borderWidth: 1, borderColor: error ? c.danger : c.border, backgroundColor: c.surface, paddingHorizontal: 14, fontFamily: FONT.body, fontSize: 16, color: c.ink }, style]} {...props} />
    {error ? <Txt variant="small" style={{ color: c.danger }}>{error}</Txt> : null}
  </View>;
}

export function Icon({ name, size = 20, color, ...rest }) {
  const { c } = useTheme();
  return <Feather name={name} size={size} color={color || c.ink} {...rest} />;
}

/** The icon names a folder or notebook can have, mapped to what the phone's icon set calls them. */
const FOLDER_ICONS = { layers: 'layers-outline', code: 'code-tags', globe: 'earth', brain: 'brain', book: 'book-open-variant', flask: 'flask-outline', terminal: 'console', palette: 'palette-outline' };

export function FolderBadge({ icon = 'layers', color = 'violet', size = 44, bare = false }) {
  const { tone } = useTheme();
  const t = tone(color);
  if (bare) return <MaterialCommunityIcons name={FOLDER_ICONS[icon] || FOLDER_ICONS.layers} size={size * 0.8} color={t.tone} />;
  return <View style={{ width: size, height: size, borderRadius: size * 0.3, backgroundColor: t.light, alignItems: 'center', justifyContent: 'center' }}>
    <MaterialCommunityIcons name={FOLDER_ICONS[icon] || FOLDER_ICONS.layers} size={size * 0.5} color={t.tone} />
  </View>;
}

export function Logo({ size = 32, word = true }) {
  const { c } = useTheme();
  return <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10 }}>
    <Image source={require('../../assets/logo.png')} style={{ width: size, height: size, borderRadius: size * 0.28 }} accessibilityLabel={`${BRAND.name} logo`} />
    {word ? <Text style={{ fontFamily: FONT.display, fontSize: size * 0.92, letterSpacing: -1.4, color: c.ink }}>{BRAND.name}<Text style={{ color: c.accent }}>.</Text></Text> : null}
  </View>;
}

export function Loading({ label = 'Loading…' }) {
  const { c } = useTheme();
  return <View style={{ paddingVertical: 48, alignItems: 'center', gap: 12 }}><ActivityIndicator color={c.accent} /><Txt variant="small">{label}</Txt></View>;
}

export function ErrorBox({ message, onRetry }) {
  const { c } = useTheme();
  return <Surface style={{ borderColor: c.danger, gap: 10 }}>
    <Txt style={{ color: c.danger }}>{message}</Txt>
    {onRetry ? <Button title="Try again" variant="secondary" small onPress={onRetry} /> : null}
  </Surface>;
}

export function Empty({ icon = 'inbox', title, text, action }) {
  const { c } = useTheme();
  return <View style={{ alignItems: 'center', paddingVertical: 48, paddingHorizontal: 24, gap: 10 }}>
    <View style={{ width: 64, height: 64, borderRadius: 20, backgroundColor: c.soft, alignItems: 'center', justifyContent: 'center' }}><Feather name={icon} size={28} color={c.accent} /></View>
    <Txt variant="heading" style={{ textAlign: 'center' }}>{title}</Txt>
    {text ? <Txt variant="small" style={{ textAlign: 'center', lineHeight: 20 }}>{text}</Txt> : null}
    {action}
  </View>;
}

export function Pill({ children, tone }) {
  const { c } = useTheme();
  return <View style={{ paddingHorizontal: 10, paddingVertical: 4, borderRadius: 99, backgroundColor: tone?.light || c.soft }}>
    <Text style={{ fontFamily: FONT.semibold, fontSize: 12, color: tone?.tone || c.accent }}>{children}</Text>
  </View>;
}

export function Progress({ value, max, color }) {
  const { c } = useTheme();
  const pct = max > 0 ? Math.min(1, value / max) : 0;
  return <View style={{ height: 8, borderRadius: 99, backgroundColor: c.surface3, overflow: 'hidden' }}>
    <View style={{ width: `${pct * 100}%`, height: '100%', borderRadius: 99, backgroundColor: color || c.accent }} />
  </View>;
}

export function Header({ title, subtitle, left, right }) {
  return <View style={{ flexDirection: 'row', alignItems: 'center', gap: 12 }}>
    {left}
    <View style={{ flex: 1 }}>
      <Txt variant="title" numberOfLines={1}>{title}</Txt>
      {subtitle ? <Txt variant="small" numberOfLines={1}>{subtitle}</Txt> : null}
    </View>
    {right}
  </View>;
}

export function IconButton({ name, onPress, label, color }) {
  const { c } = useTheme();
  return <Pressable accessibilityRole="button" accessibilityLabel={label} onPress={onPress} hitSlop={8}
    style={({ pressed }) => ({ width: 40, height: 40, borderRadius: 12, alignItems: 'center', justifyContent: 'center', backgroundColor: pressed ? c.surface3 : c.surface, borderWidth: 1, borderColor: c.border })}>
    <Feather name={name} size={19} color={color || c.ink} />
  </Pressable>;
}

export function BackButton() {
  const router = useRouter();
  return <IconButton name="chevron-left" label="Back" onPress={() => (router.canGoBack() ? router.back() : router.replace('/'))} />;
}

/** The bar across the top of the main screens: the wordmark on the left, the account on the right. */
export function TopBar() {
  const router = useRouter();
  const { user } = useAuth();
  const { c } = useTheme();
  const initials = (user?.name || user?.username || '?').split(/\s+/).map(w => w[0]).slice(0, 2).join('').toUpperCase();
  return <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingBottom: 2 }}>
    <Logo size={30} />
    <Pressable onPress={() => router.push('/profile')} accessibilityRole="button" accessibilityLabel="Profile and settings" hitSlop={8}
      style={{ width: 38, height: 38, borderRadius: 19, backgroundColor: c.soft2, alignItems: 'center', justifyContent: 'center' }}>
      <Text style={{ fontFamily: FONT.semibold, fontSize: 13, color: c.accentDark }}>{initials}</Text>
    </Pressable>
  </View>;
}

/** Eyebrow, large title and a line under it: how every web page opens. */
export function PageHeading({ eyebrow, title, subtitle }) {
  const { c } = useTheme();
  return <View style={{ gap: 4 }}>
    {eyebrow ? <Text style={{ fontFamily: FONT.semibold, fontSize: 11, letterSpacing: 1.4, color: c.accent }}>{eyebrow}</Text> : null}
    <Text style={{ fontFamily: FONT.display, fontSize: 28, letterSpacing: -0.8, color: c.ink }}>{title}</Text>
    {subtitle ? <Txt variant="small" style={{ fontSize: 14 }}>{subtitle}</Txt> : null}
  </View>;
}
