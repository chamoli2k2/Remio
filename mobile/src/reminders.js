import { AppState, Platform } from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import * as Notifications from 'expo-notifications';
import { api } from './api';
import { BRAND } from '../../shared/brand.js';

/**
 * Study reminders, scheduled on the phone itself.
 *
 * Nothing is sent from the server, so there is no push token to store, no service to run, and the
 * reminders still arrive with no signal. What keeps them dynamic is that the whole set is worked
 * out again from the learner's real numbers whenever the app opens, comes to the front, or a
 * session ends: today's reminder says how many cards are due and mentions the streak; it is left
 * out once the daily goal is met or nothing is due; a "streak saver" nudge appears in the evening
 * only if there is a streak and nothing has been reviewed yet; and the days ahead rotate through
 * different wording. Reminders for later days cannot know the future count, so they never state one.
 */

const PREFS_KEY = `${BRAND.slug}.reminders`, STATS_KEY = `${BRAND.slug}.reminders.stats`;
const CHANNEL = 'reminders', DAYS_AHEAD = 7, SAVER = { hour: 20, minute: 30 };
export const DEFAULTS = { enabled: false, hour: 19, minute: 0, streakSaver: true };
export const supported = Platform.OS !== 'web';

if (supported) {
  // Reminders are for when the app is closed; while it is open there is nothing to remind about.
  Notifications.setNotificationHandler({ handleNotification: async () => ({ shouldShowBanner: false, shouldShowList: false, shouldPlaySound: false, shouldSetBadge: false }) });
}

export async function loadPrefs() {
  try { return { ...DEFAULTS, ...JSON.parse((await AsyncStorage.getItem(PREFS_KEY)) || '{}') }; } catch { return { ...DEFAULTS }; }
}
export async function savePrefs(prefs) { await AsyncStorage.setItem(PREFS_KEY, JSON.stringify(prefs)).catch(() => {}); }

export async function permission() {
  if (!supported) return 'unsupported';
  const p = await Notifications.getPermissionsAsync();
  return p.granted ? 'granted' : p.canAskAgain === false ? 'blocked' : 'undetermined';
}

/** Ask the system for permission, once the person has turned reminders on. */
export async function requestPermission() {
  if (!supported) return 'unsupported';
  if ((await permission()) === 'granted') return 'granted';
  const p = await Notifications.requestPermissionsAsync();
  return p.granted ? 'granted' : p.canAskAgain === false ? 'blocked' : 'undetermined';
}

async function ensureChannel() {
  if (Platform.OS === 'android') await Notifications.setNotificationChannelAsync(CHANNEL, { name: 'Study reminders', importance: Notifications.AndroidImportance.DEFAULT, lightColor: '#5a45e0' });
}

/** Today's numbers: fresh from the server, or the last ones seen when the phone is offline. */
async function currentStats() {
  try {
    const { stats } = await api('/stats', { timeout: 8000 });
    const slim = { due: stats.due || 0, reviewsToday: stats.reviewsToday || 0, goal: stats.goal || 20, streak: stats.streak?.current || 0, day: new Date().toDateString() };
    await AsyncStorage.setItem(STATS_KEY, JSON.stringify(slim)).catch(() => {});
    return slim;
  } catch {
    try {
      const saved = JSON.parse((await AsyncStorage.getItem(STATS_KEY)) || 'null');
      // Counts from another day say nothing about today, so only the streak is kept.
      return saved ? (saved.day === new Date().toDateString() ? saved : { due: null, reviewsToday: 0, goal: saved.goal, streak: saved.streak, day: saved.day }) : null;
    } catch { return null; }
  }
}

const at = (base, dayOffset, hour, minute) => { const d = new Date(base); d.setDate(d.getDate() + dayOffset); d.setHours(hour, minute, 0, 0); return d; };
const plural = (n, word) => `${n.toLocaleString('en')} ${word}${n === 1 ? '' : 's'}`;

// Wording for the days ahead. None states a count, because none can know it.
const FUTURE = [
  name => ({ title: `${name ? `${name}, a` : 'A'} few minutes is enough`, body: 'Your cards are ready. A short review today keeps them fresh.' }),
  () => ({ title: 'Time to remember something', body: `Open ${BRAND.name} and clear today’s due cards.` }),
  name => ({ title: `Keep it going${name ? `, ${name}` : ''}`, body: 'Small sessions, done often, are what make memory last.' }),
  () => ({ title: 'Your cards are waiting', body: 'A quick round now means less to catch up on later.' }),
  () => ({ title: 'One more session', body: 'A little progress today builds on yesterday.' }),
];

export function plan(stats, prefs, name, now = new Date()) {
  const items = [], first = name ? name.trim().split(/\s+/)[0] : '';
  const goalMet = !!stats && stats.reviewsToday >= stats.goal;
  const nothingDue = !!stats && stats.due === 0;
  for (let day = 0; day < DAYS_AHEAD; day++) {
    const when = at(now, day, prefs.hour, prefs.minute);
    if (when <= now) continue;
    if (day === 0) {
      if (goalMet || nothingDue) continue;
      const due = stats?.due;
      const streak = stats?.streak || 0;
      items.push({ when, title: due ? `${plural(due, 'card')} ready to review` : 'Time for your cards', body: streak > 0 ? `Keep your ${streak}-day streak going. A short session is enough.` : (first ? `${first}, a few minutes today keeps everything fresh.` : 'A few minutes today keeps everything fresh.') });
    } else items.push({ when, ...FUTURE[(now.getDate() + day) % FUTURE.length](first) });
  }
  if (prefs.streakSaver && stats && stats.streak > 0 && stats.reviewsToday === 0 && stats.due !== 0) {
    const when = at(now, 0, SAVER.hour, SAVER.minute);
    const before = prefs.hour * 60 + prefs.minute < SAVER.hour * 60 + SAVER.minute;
    if (when > now && before) items.push({ when, title: `Your ${stats.streak}-day streak is at risk`, body: stats.due ? `${plural(stats.due, 'card')} are waiting. One quick session keeps it alive.` : 'One quick session keeps it alive.' });
  }
  return items;
}

let running = null, lastRun = 0, lastName = '';

/** Work the schedule out again and replace what is scheduled. Safe to call often. */
export function sync({ name = lastName, force = false } = {}) {
  if (!supported) return Promise.resolve();
  lastName = name || '';
  if (!force && Date.now() - lastRun < 20_000) return running || Promise.resolve();
  lastRun = Date.now();
  // Runs one after another: two at once would both clear the schedule and then both fill it, doubling every reminder.
  const job = async () => {
    const prefs = await loadPrefs();
    await Notifications.cancelAllScheduledNotificationsAsync();
    if (!prefs.enabled || (await permission()) !== 'granted') return;
    await ensureChannel();
    const stats = await currentStats();
    for (const item of plan(stats, prefs, name)) {
      await Notifications.scheduleNotificationAsync({
        content: { title: item.title, body: item.body, sound: false, data: { url: '/' } },
        trigger: { type: Notifications.SchedulableTriggerInputTypes.DATE, date: item.when, channelId: CHANNEL },
      });
    }
  };
  const run = (running || Promise.resolve()).then(job).catch(() => {}).finally(() => { if (running === run) running = null; });
  running = run;
  return run;
}

/** Remove every reminder, for signing out. */
export async function clear() { if (supported) await Notifications.cancelAllScheduledNotificationsAsync().catch(() => {}); }

/** A notification a few seconds from now, showing what a real one will look like with today's numbers. */
export async function sendTest(name) {
  const stats = await currentStats();
  const first = name ? name.trim().split(/\s+/)[0] : '';
  await ensureChannel();
  await Notifications.scheduleNotificationAsync({
    content: { title: stats?.due ? `${plural(stats.due, 'card')} ready to review` : 'Time for your cards', body: stats?.streak > 0 ? `Keep your ${stats.streak}-day streak going. A short session is enough.` : `${first ? `${first}, a` : 'A'} few minutes today keeps everything fresh.`, sound: false },
    trigger: { type: Notifications.SchedulableTriggerInputTypes.TIME_INTERVAL, seconds: 5, channelId: CHANNEL },
  });
  return stats;
}

/** Keep the schedule current: when the app comes to the front, and once now. */
export function watch(getName) {
  sync({ name: getName() });
  const sub = AppState.addEventListener('change', state => { if (state === 'active') sync({ name: getName() }); });
  return () => sub.remove();
}
