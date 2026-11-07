import { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';
import { Appearance, useColorScheme } from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { BRAND } from '../../shared/brand.js';

/**
 * The same colours as the website, so the two read as one product. They are copied from the
 * website's stylesheet (`:root` and `html[data-theme=dark]`) rather than invented; if the web
 * palette changes, change it here too.
 */
export const PALETTES = {
  light: {
    accent: '#6348dc', accentDark: '#4d36bc', ink: '#272235', muted: '#736b81', border: '#e7e3f0', bg: '#f5f3fa',
    surface: '#ffffff', surface2: '#f7f5fb', surface3: '#efecf6', soft: '#f0ebff', soft2: '#e2d9fb',
    text2: '#594665', text3: '#796a85', onAccent: '#ffffff', brand: '#5a45e0', danger: '#b4455f', success: '#4c8b78',
  },
  dark: {
    accent: '#9b86f5', accentDark: '#b3a3f8', ink: '#f4f1fa', muted: '#a8a1ba', border: '#4a4660', bg: '#1f1d28',
    surface: '#2a2834', surface2: '#333140', surface3: '#3d3a4c', soft: '#3a3458', soft2: '#4a4470',
    text2: '#d0cbdc', text3: '#a8a1ba', onAccent: '#ffffff', brand: '#6e56e8', danger: '#f3a3b6', success: '#9fd6c3',
  },
};

/** Folder colours: the tone for icons and accents, a tint for backgrounds. */
export const TONES = {
  light: {
    violet: { tone: '#8c70d4', light: '#f0eafc', cover: '#efebfa' }, blue: { tone: '#6b9ec3', light: '#eaf2fa', cover: '#eaf2f9' },
    orange: { tone: '#d4a05c', light: '#fdf4e7', cover: '#fcf1e4' }, green: { tone: '#72a89b', light: '#edf5f0', cover: '#eaf4ef' },
    pink: { tone: '#c780ab', light: '#fbedf5', cover: '#faecf3' }, slate: { tone: '#8e98ad', light: '#f0f1f5', cover: '#ecf0f5' },
  },
  dark: {
    violet: { tone: '#b8a4f7', light: '#3d3664', cover: '#38325c' }, blue: { tone: '#8fc0e2', light: '#2c3e52', cover: '#283849' },
    orange: { tone: '#e8bb7c', light: '#4a3a24', cover: '#443620' }, green: { tone: '#94c9bb', light: '#2a433c', cover: '#263d37' },
    pink: { tone: '#e0a0c8', light: '#4a3342', cover: '#442f3c' }, slate: { tone: '#b3bbcc', light: '#363a4a', cover: '#323645' },
  },
};

/** The four answer buttons while studying. */
export const RATINGS = {
  light: {
    again: { fg: '#b77386', border: '#ecd7df', bg: '#fff7fa' }, hard: { fg: '#b29b6f', border: '#eaddc6', bg: '#fffcf5' },
    good: { fg: '#7da99a', border: '#cbe2d9', bg: '#f5fcf9' }, easy: { fg: '#a887c3', border: '#ddcbed', bg: '#faf5ff' },
  },
  dark: {
    again: { fg: '#f3a3b6', border: '#4a2a35', bg: '#2a1a21' }, hard: { fg: '#e5c98f', border: '#4a4029', bg: '#2a2519' },
    good: { fg: '#9fd6c3', border: '#2b4a40', bg: '#192a24' }, easy: { fg: '#c7b3f7', border: '#3f3260', bg: '#221c36' },
  },
};

export const FONT = {
  body: 'DMSans_400Regular', medium: 'DMSans_500Medium', semibold: 'DMSans_700Bold',
  heading: 'Manrope_700Bold', display: 'Manrope_800ExtraBold',
};
export const RADIUS = 14;

const KEY = `${BRAND.slug}.theme`;
const ThemeContext = createContext(null);

/** `system` follows the phone, like the website does until a person picks one. */
// react-native-web has no setColorScheme; there the app's own colours already follow the preference.
const applyScheme = pref => { if (typeof Appearance.setColorScheme === 'function') Appearance.setColorScheme(pref === 'system' ? null : pref); };

export function ThemeProvider({ children }) {
  const system = useColorScheme();
  const [preference, setPref] = useState('system');
  useEffect(() => { AsyncStorage.getItem(KEY).then(v => { if (v === 'light' || v === 'dark') setPref(v); }).catch(() => {}); }, []);
  const setPreference = useCallback(next => {
    setPref(next);
    AsyncStorage.setItem(KEY, next).catch(() => {});
    // Keeps native chrome (status bar, keyboard, alerts) in step with the choice.
    applyScheme(next);
  }, []);
  useEffect(() => { if (preference !== 'system') applyScheme(preference); }, [preference]);

  const dark = (preference === 'system' ? system : preference) === 'dark';
  const value = useMemo(() => {
    const mode = dark ? 'dark' : 'light';
    return { dark, preference, setPreference, c: PALETTES[mode], tones: TONES[mode], ratings: RATINGS[mode], tone: color => TONES[mode][color] || TONES[mode].violet };
  }, [dark, preference, setPreference]);
  return <ThemeContext.Provider value={value}>{children}</ThemeContext.Provider>;
}

export const useTheme = () => useContext(ThemeContext);
