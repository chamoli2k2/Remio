import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Alert, Pressable, ScrollView, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useLocalSearchParams, useRouter } from 'expo-router';
import * as Haptics from 'expo-haptics';
import { api } from '../../api';
import { enqueue, flush, flushSoon, pendingCards, pendingCount, subscribe, versionFor } from '../../reviewQueue';
import { uuid } from '../../uuid';
import { FONT, useTheme } from '../../theme';
import { Button, ErrorBox, IconButton, Loading, Progress, Txt, Icon, Empty } from '../../components/ui';
import CardFace, { sideOf } from '../../components/CardFace';

const RATING_ROWS = [['again', 'Again', 'Review soon'], ['hard', 'Hard', 'Needs practice'], ['good', 'Good', 'Got it'], ['easy', 'Easy', 'Instantly']];

/** Same session the website builds: waiting reviews are sent first, and a due-only session leaves out cards already answered offline. */
async function loadSession(id, dueOnly) {
  await flushSoon(2500);
  const [f, c] = await Promise.all([api(`/folders/${id}`), api(`/folders/${id}/cards`)]);
  const queued = dueOnly ? pendingCards() : new Set();
  const now = Date.now();
  return { folder: f.folder, cards: c.cards.filter(card => !dueOnly || (!queued.has(card.id) && (!card.progress?.dueAt || new Date(card.progress.dueAt).getTime() <= now))) };
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
  useEffect(() => () => { flush(); }, []);

  const cards = state.data?.cards || [];
  const card = cards[index];
  const done = !state.loading && !state.error && index >= cards.length;
  const side = useMemo(() => (card ? sideOf(card, flipped) : null), [card, flipped]);

  const rate = useCallback(rating => {
    if (!card || answered.current === index) return; // a double tap counts once
    answered.current = index;
    const now = new Date();
    enqueue([{ cardId: card.id, rating, requestId: uuid(), version: versionFor(card), mode: 'classic', localHour: now.getHours(), reviewedAt: now.toISOString() }]);
    Haptics.selectionAsync().catch(() => {});
    setGiven(g => [...g, rating]); setIndex(i => i + 1); setFlipped(false); setHint(false);
  }, [card, index]);

  function leave() {
    if (!done && given.length) Alert.alert('Leave this session?', 'Your answers so far are saved.', [{ text: 'Keep studying', style: 'cancel' }, { text: 'Leave', onPress: () => router.back() }]);
    else router.back();
  }

  const counts = useMemo(() => given.reduce((m, r) => ({ ...m, [r]: (m[r] || 0) + 1 }), {}), [given]);

  return <SafeAreaView style={{ flex: 1, backgroundColor: c.bg }}>
    <View style={{ flexDirection: 'row', alignItems: 'center', gap: 14, padding: 16, paddingBottom: 8 }}>
      <IconButton name="x" label="Close study session" onPress={leave} />
      <View style={{ flex: 1, gap: 6 }}>
        <Progress value={Math.min(index, cards.length)} max={cards.length || 1} />
        <Txt variant="small">{state.data ? `${Math.min(index + 1, cards.length)} of ${cards.length}` : ' '}{pending ? ` · ${pending} to sync` : ''}</Txt>
      </View>
    </View>

    {state.loading ? <Loading /> : state.error ? <View style={{ padding: 20 }}><ErrorBox message={state.error} onRetry={() => setAttempt(a => a + 1)} /></View>
      : !cards.length ? <View style={{ flex: 1, justifyContent: 'center', padding: 20, gap: 16 }}>
          <Empty icon="check-circle" title={dueOnly ? 'Nothing due' : 'No cards here'} text={dueOnly ? 'Everything in this folder is up to date. Come back later.' : 'Add cards to this folder first.'} />
          <Button title="Back" onPress={() => router.back()} />
        </View>
      : done ? <ScrollView contentContainerStyle={{ flexGrow: 1, justifyContent: 'center', padding: 24, gap: 20 }}>
          <View style={{ alignItems: 'center', gap: 10 }}>
            <Icon name="award" size={48} color={c.accent} />
            <Txt variant="display" style={{ textAlign: 'center' }}>Session complete</Txt>
            <Txt variant="body" style={{ color: c.muted }}>You reviewed {given.length} card{given.length === 1 ? '' : 's'}.</Txt>
          </View>
          <View style={{ flexDirection: 'row', gap: 10 }}>
            {RATING_ROWS.map(([key, label]) => <View key={key} style={{ flex: 1, alignItems: 'center', padding: 12, borderRadius: 14, backgroundColor: tones[key].bg }}>
              <Txt variant="title" style={{ color: tones[key].fg }}>{counts[key] || 0}</Txt>
              <Txt variant="small" style={{ color: tones[key].fg }}>{label}</Txt>
            </View>)}
          </View>
          <Button title="Done" onPress={() => router.back()} />
          <Button title="Study again" variant="secondary" icon="repeat" onPress={() => setAttempt(a => a + 1)} />
        </ScrollView>
      : <>
        <ScrollView contentContainerStyle={{ flexGrow: 1, padding: 16 }} keyboardShouldPersistTaps="handled">
          <Pressable onPress={() => !flipped && setFlipped(true)} accessibilityRole="button" accessibilityLabel={flipped ? 'Answer' : 'Question. Tap to reveal the answer'}
            style={{ flex: 1, minHeight: 320, justifyContent: 'center', padding: 22, borderRadius: 22, backgroundColor: c.surface, borderWidth: 1, borderColor: c.border, gap: 18 }}>
            <Txt variant="label" style={{ textAlign: 'center' }}>{flipped ? 'THE ANSWER' : 'THE QUESTION'}</Txt>
            <CardFace side={side} />
            {card.hint && !flipped ? <Pressable onPress={() => setHint(h => !h)} hitSlop={8} style={{ alignSelf: 'center', flexDirection: 'row', gap: 6, alignItems: 'center' }}>
              <Icon name="help-circle" size={16} color={c.accent} />
              <Txt variant="small" style={{ color: c.accent, fontFamily: FONT.medium }}>{hint ? card.hint : 'Show hint'}</Txt>
            </Pressable> : null}
          </Pressable>
        </ScrollView>
        <View style={{ padding: 16, gap: 10 }}>
          {!flipped ? <Button title="Reveal answer" icon="rotate-ccw" onPress={() => setFlipped(true)} /> : <View style={{ flexDirection: 'row', gap: 8 }}>
            {RATING_ROWS.map(([key, label, sub]) => <Pressable key={key} onPress={() => rate(key)} accessibilityRole="button" accessibilityLabel={`${label}${card.progress?.preview?.[key] ? `, next in ${card.progress.preview[key]}` : ''}`}
              style={({ pressed }) => ({ flex: 1, alignItems: 'center', gap: 2, paddingVertical: 14, borderRadius: 14, backgroundColor: tones[key].bg, opacity: pressed ? 0.75 : 1 })}>
              <Txt style={{ color: tones[key].fg, fontFamily: FONT.semibold }}>{label}</Txt>
              <Txt variant="small" style={{ color: tones[key].fg, fontSize: 11 }} numberOfLines={1}>{card.progress?.preview?.[key] || sub}</Txt>
            </Pressable>)}
          </View>}
        </View>
      </>}
  </SafeAreaView>;
}
