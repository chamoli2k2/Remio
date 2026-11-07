import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Animated, Easing, Pressable, ScrollView, Text, View, useWindowDimensions } from 'react-native';
import { Alert } from '../../alert';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useLocalSearchParams, useRouter } from 'expo-router';
import * as Haptics from 'expo-haptics';
import * as Speech from 'expo-speech';
import { cachedApi } from '../../offline';
import { enqueue, flush, flushSoon, pendingCards, pendingCount, subscribe, versionFor } from '../../reviewQueue';
import { uuid } from '../../uuid';
import { sync } from '../../reminders';
import { refreshWidget } from '../../widget';
import { FONT, useTheme } from '../../theme';
import { Button, ErrorBox, FolderBadge, Loading, Txt, Icon, Empty } from '../../components/ui';
import CardFace, { sideOf } from '../../components/CardFace';

const RATING_ROWS = [['again', 'Again', 'Review soon'], ['hard', 'Hard', 'Needs practice'], ['good', 'Good', 'Got it'], ['easy', 'Easy', 'Instantly']];

/**
 * A card that turns over. The two faces share one animated value; keying it by card means each new
 * card starts on its question instead of spinning back from the last answer.
 */
function FlipCard({ card, flipped, onToggle, height, hint, onHint }) {
  const { c } = useTheme();
  const turn = useRef(new Animated.Value(flipped ? 1 : 0)).current;
  useEffect(() => { Animated.timing(turn, { toValue: flipped ? 1 : 0, duration: 450, easing: Easing.out(Easing.cubic), useNativeDriver: true }).start(); }, [flipped, turn]);
  const spin = (from, to) => turn.interpolate({ inputRange: [0, 1], outputRange: [`${from}deg`, `${to}deg`] });
  // Opacity swaps at the half turn as well as backface hiding, because the browser build does not hide the far side reliably.
  const shown = back => turn.interpolate({ inputRange: [0, 0.49, 0.51, 1], outputRange: back ? [0, 0, 1, 1] : [1, 1, 0, 0] });
  const face = (label, side, back) => <Animated.View pointerEvents={back === flipped ? 'auto' : 'none'}
    style={{ opacity: shown(back), position: 'absolute', top: 0, left: 0, right: 0, bottom: 0, backfaceVisibility: 'hidden', transform: [{ perspective: 1400 }, { rotateY: back ? spin(180, 360) : spin(0, 180) }],
      borderRadius: 22, borderWidth: 1, borderColor: back ? `${c.accent}66` : c.border, backgroundColor: back ? c.surface2 : c.surface, padding: 20, paddingTop: 22 }}>
    <Text style={{ fontFamily: FONT.semibold, fontSize: 11.5, letterSpacing: 2, textAlign: 'center', color: c.accent, opacity: 0.8 }}>{label}</Text>
    <ScrollView style={{ flex: 1 }} contentContainerStyle={{ flexGrow: 1, justifyContent: 'center', paddingVertical: 12 }} showsVerticalScrollIndicator={false}>
      <CardFace side={side} size={21} />
    </ScrollView>
    {!back && card.hint ? <Pressable onPress={onHint} hitSlop={8} style={{ alignSelf: 'center', flexDirection: 'row', gap: 6, alignItems: 'center', paddingTop: 6 }}>
      <Icon name="help-circle" size={15} color={c.accent} /><Txt variant="small" style={{ color: c.accent, fontFamily: FONT.medium }}>{hint ? card.hint : 'Show hint'}</Txt>
    </Pressable> : null}
  </Animated.View>;
  return <Pressable onPress={onToggle} accessibilityRole="button" accessibilityLabel={flipped ? 'Answer. Tap to see the question' : 'Question. Tap to reveal the answer'} style={{ height }}>
    {face('THE QUESTION', sideOf(card, false), false)}
    {face('THE ANSWER', sideOf(card, true), true)}
  </Pressable>;
}

/** Same session the website builds: waiting reviews are sent first, and a due-only session leaves out cards already answered offline. */
async function loadSession(id, dueOnly) {
  await flushSoon(2500);
  const [f, c] = await Promise.all([cachedApi(`/folders/${id}`), cachedApi(`/folders/${id}/cards`)]);
  const queued = dueOnly ? pendingCards() : new Set();
  const now = Date.now();
  return { folder: f.folder, cards: c.cards.filter(card => !card.id.startsWith('local:') && (!dueOnly || (!queued.has(card.id) && (!card.progress?.dueAt || new Date(card.progress.dueAt).getTime() <= now)))) };
}

export default function Study() {
  const { id, mode } = useLocalSearchParams();
  const dueOnly = mode === 'due';
  const router = useRouter();
  const { c, ratings: tones } = useTheme();
  const [state, setState] = useState({ loading: true, error: '', data: null });
  const [attempt, setAttempt] = useState(0);
  const [index, setIndex] = useState(0), [flipped, setFlipped] = useState(false), [hint, setHint] = useState(false);
  const [given, setGiven] = useState([]), [pending, setPending] = useState(pendingCount());
  const answered = useRef(-1);

  useEffect(() => {
    let live = true;
    setState({ loading: true, error: '', data: null }); setIndex(0); setGiven([]); setFlipped(false); setHint(false); answered.current = -1;
    loadSession(id, dueOnly).then(data => live && setState({ loading: false, error: '', data }), e => live && setState({ loading: false, error: e.message, data: null }));
    return () => { live = false; };
  }, [id, dueOnly, attempt]);

  useEffect(() => subscribe(e => { if ('pending' in e) setPending(e.pending); }), []);
  // Leaving the session sends whatever is still waiting.
  useEffect(() => () => { flush().then(() => { sync({ force: true }); refreshWidget({ force: true }); }); }, []);

  const cards = state.data?.cards || [];
  const card = cards[index];
  const done = !state.loading && !state.error && index >= cards.length;
  const { height: screenH } = useWindowDimensions();

  const rate = useCallback(rating => {
    if (!card || answered.current === index) return; // a double tap counts once
    answered.current = index;
    const now = new Date();
    enqueue([{ cardId: card.id, rating, requestId: uuid(), version: versionFor(card), mode: 'classic', localHour: now.getHours(), reviewedAt: now.toISOString() }]);
    Speech.stop();
    (rating === 'again' ? Haptics.notificationAsync(Haptics.NotificationFeedbackType.Warning) : rating === 'hard' ? Haptics.selectionAsync() : Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success)).catch(() => {});
    setGiven(g => [...g, rating]); setIndex(i => i + 1); setFlipped(false); setHint(false);
  }, [card, index]);

  // Read the side that is showing aloud: markdown marks dropped, a hidden cloze spoken as "blank".
  function listen() {
    const side = card && sideOf(card, flipped);
    const spoken = (side?.text || '').replace(/\{\{c\d+::([\s\S]*?)(?:::[\s\S]*?)?\}\}/g, (_m, answer) => (side.cloze === 'hide' ? 'blank' : answer)).replace(/!\[[^\]]*\]\([^)]*\)/g, '').replace(/[#*_`>\[\]]/g, '').trim();
    Speech.stop();
    if (spoken) Speech.speak(spoken, { rate: 0.95 });
  }
  useEffect(() => () => { Speech.stop(); }, []);
  useEffect(() => { Speech.stop(); }, [index, flipped]);

  function leave() {
    if (!done && given.length) Alert.alert('Leave this session?', 'Your answers so far are saved.', [{ text: 'Keep studying', style: 'cancel' }, { text: 'Leave', onPress: () => router.back() }]);
    else router.back();
  }

  const counts = useMemo(() => given.reduce((m, r) => ({ ...m, [r]: (m[r] || 0) + 1 }), {}), [given]);

  const folder = state.data?.folder;
  const progress = cards.length ? Math.min(index, cards.length) / cards.length : 0;

  return <SafeAreaView style={{ flex: 1, backgroundColor: c.bg }}>
    <View style={{ flexDirection: 'row', alignItems: 'center', gap: 12, paddingHorizontal: 20, paddingTop: 12 }}>
      <FolderBadge icon={folder?.icon} color={folder?.color} size={46} />
      <View style={{ flex: 1 }}>
        <Text style={{ fontFamily: FONT.semibold, fontSize: 10.5, letterSpacing: 1.4, color: c.accent, opacity: 0.8 }}>STUDY SESSION</Text>
        <Text numberOfLines={1} style={{ fontFamily: FONT.heading, fontSize: 18, color: c.text2 }}>{folder?.title || ' '}</Text>
      </View>
      <Pressable onPress={leave} hitSlop={10} accessibilityRole="button" accessibilityLabel="Close study session" style={{ padding: 8 }}><Icon name="x" size={22} color={c.muted} /></Pressable>
    </View>
    <View style={{ marginHorizontal: 20, marginTop: 14, height: 6, borderRadius: 99, backgroundColor: c.soft2, overflow: 'hidden' }}>
      <View style={{ width: `${progress * 100}%`, height: '100%', borderRadius: 99, backgroundColor: c.accent }} />
    </View>

    {state.loading ? <Loading /> : state.error ? <View style={{ padding: 20 }}><ErrorBox message={state.error} onRetry={() => setAttempt(a => a + 1)} /></View>
      : !cards.length ? <View style={{ flex: 1, justifyContent: 'center', padding: 20, gap: 16 }}>
          <Empty icon="check-circle" title={dueOnly ? 'Nothing due' : 'No cards here'} text={dueOnly ? 'Everything in this folder is up to date. Come back later.' : 'Add cards to this folder first.'} />
          <Button title="Back" onPress={() => router.back()} />
        </View>
      : done ? <ScrollView contentContainerStyle={{ flexGrow: 1, justifyContent: 'center', padding: 24, gap: 20 }}>
          <View style={{ alignItems: 'center', gap: 10 }}>
            <View style={{ width: 72, height: 72, borderRadius: 22, backgroundColor: c.soft, alignItems: 'center', justifyContent: 'center' }}><Icon name="award" size={34} color={c.accent} /></View>
            <Text style={{ fontFamily: FONT.display, fontSize: 28, letterSpacing: -0.8, color: c.ink, textAlign: 'center' }}>Session complete</Text>
            <Txt variant="body" style={{ color: c.muted }}>You reviewed {given.length} card{given.length === 1 ? '' : 's'}.</Txt>
          </View>
          <View style={{ flexDirection: 'row', gap: 10 }}>
            {RATING_ROWS.map(([key, label]) => <View key={key} style={{ flex: 1, alignItems: 'center', padding: 12, borderRadius: 14, backgroundColor: tones[key].bg, borderWidth: 1, borderColor: tones[key].border }}>
              <Txt variant="title" style={{ color: tones[key].fg }}>{counts[key] || 0}</Txt>
              <Txt variant="small" style={{ color: tones[key].fg }}>{label}</Txt>
            </View>)}
          </View>
          <Button title="Done" onPress={() => router.back()} />
          <Button title="Study again" variant="secondary" icon="repeat" onPress={() => setAttempt(a => a + 1)} />
        </ScrollView>
      : <ScrollView contentContainerStyle={{ padding: 20, gap: 14 }} keyboardShouldPersistTaps="handled">
        <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' }}>
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6, paddingHorizontal: 14, paddingVertical: 8, borderRadius: 99, backgroundColor: c.accent }}>
            <Icon name="layers" size={14} color="#fff" /><Text style={{ fontFamily: FONT.semibold, fontSize: 14, color: '#fff' }}>Flip</Text>
          </View>
          <Pressable onPress={listen} accessibilityRole="button" accessibilityLabel="Read this side aloud" style={{ flexDirection: 'row', alignItems: 'center', gap: 6, paddingHorizontal: 14, paddingVertical: 8, borderRadius: 99, backgroundColor: c.soft }}>
            <Icon name="volume-2" size={14} color={c.accent} /><Text style={{ fontFamily: FONT.semibold, fontSize: 14, color: c.accentDark }}>Listen</Text>
          </Pressable>
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6, paddingHorizontal: 14, paddingVertical: 8, borderRadius: 99, backgroundColor: c.soft }}>
            <Icon name="zap" size={14} color={c.accent} /><Text style={{ fontFamily: FONT.display, fontSize: 14, color: c.ink }}>{given.length}</Text><Text style={{ fontFamily: FONT.body, fontSize: 13, color: c.muted }}>reviewed</Text>
          </View>
        </View>
        <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 12 }}>
          <Txt variant="small" style={{ fontSize: 14 }}>Card {index + 1} of {cards.length}</Txt>
          <Txt variant="small" style={{ fontSize: 12.5, flex: 1, textAlign: 'right' }}>{flipped ? 'How well did you remember?' : 'Take a moment. You know more than you think.'}</Txt>
        </View>

        <FlipCard key={card.id} card={card} flipped={flipped} onToggle={() => setFlipped(f => !f)} height={Math.max(300, Math.min(460, screenH * 0.46))} hint={hint} onHint={() => setHint(h => !h)} />

        {!flipped ? <View style={{ alignItems: 'center', gap: 10, marginTop: 6 }}>
          <Pressable onPress={() => setFlipped(true)} accessibilityRole="button" style={({ pressed }) => ({ flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 10, minWidth: 220, minHeight: 54, paddingHorizontal: 28, borderRadius: 14, backgroundColor: c.accent, opacity: pressed ? 0.88 : 1, shadowColor: c.accent, shadowOpacity: 0.35, shadowRadius: 14, shadowOffset: { width: 0, height: 8 }, elevation: 4 })}>
            <Text style={{ fontFamily: FONT.semibold, fontSize: 17, color: '#fff' }}>Reveal answer</Text><Icon name="rotate-ccw" size={18} color="#fff" />
          </Pressable>
          <Txt variant="small">Tap the card or the button to flip it.</Txt>
        </View> : <View style={{ gap: 10, marginTop: 4 }}>
          <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 10 }}>
            {RATING_ROWS.map(([key, label, sub], i) => {
              const next = card.progress?.preview?.[key];
              return <Pressable key={key} onPress={() => rate(key)} accessibilityRole="button" accessibilityLabel={`${label}${next ? `, next in ${next}` : ''}`}
                style={({ pressed }) => ({ width: '48%', flexGrow: 1, gap: 6, padding: 14, borderRadius: 14, backgroundColor: tones[key].bg, borderWidth: 1, borderColor: tones[key].border, opacity: pressed ? 0.75 : 1 })}>
                <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' }}>
                  <Text style={{ fontFamily: FONT.heading, fontSize: 16, color: tones[key].fg }}>{label}</Text>
                  <Text style={{ fontFamily: FONT.body, fontSize: 11, color: tones[key].fg, opacity: 0.6 }}>{i + 1}</Text>
                </View>
                <Text style={{ fontFamily: FONT.body, fontSize: 12.5, color: tones[key].fg, opacity: 0.85 }}>{next ? <>Next in <Text style={{ fontFamily: FONT.semibold }}>{next}</Text></> : sub}</Text>
              </Pressable>;
            })}
          </View>
          <Txt variant="small" style={{ textAlign: 'center' }}>Be honest with yourself. Every review helps.</Txt>
        </View>}
      </ScrollView>}
  </SafeAreaView>;
}
