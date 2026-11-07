import { AppState, Platform } from 'react-native';
import { api } from './api';
import { BRAND } from '../../shared/brand.js';

/**
 * Keeps the home screen widget in step with the real numbers: cards due, today's goal, streak.
 * The widget is part of the installed app, so in Expo Go and in the browser there is none and
 * every call here quietly does nothing.
 */
let widget = null;
if (Platform.OS !== 'web') { try { widget = require('./widgets/StudyWidget').default; } catch { widget = null; } }

let last = 0;
const clock = () => new Date().toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });

/** Fetch today's numbers and put them on the widget. Offline, the widget keeps what it had. */
export async function refreshWidget({ force = false } = {}) {
  if (!widget || (!force && Date.now() - last < 20_000)) return;
  last = Date.now();
  try {
    const { stats } = await api('/stats', { timeout: 8000 });
    widget.updateSnapshot({ brand: BRAND.name, due: stats.due || 0, done: stats.reviewsToday || 0, goal: stats.goal || 20, streak: stats.streak?.current || 0, updated: clock() });
  } catch { /* the last snapshot stays on screen */ }
}

/** Refresh now and whenever the app comes to the front. Returns the cleanup. */
export function watchWidget() {
  refreshWidget({ force: true });
  const sub = AppState.addEventListener('change', state => { if (state === 'active') refreshWidget(); });
  return () => sub.remove();
}

/** The widget shows someone's numbers, so signing out puts it back to empty. */
export function clearWidget() {
  try { widget?.updateSnapshot({ brand: BRAND.name, due: 0, done: 0, goal: 20, streak: 0, updated: '' }); } catch { /* nothing to clear */ }
}
