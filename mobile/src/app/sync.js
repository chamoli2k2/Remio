import { useEffect, useState } from 'react';
import { View } from 'react-native';
import { Alert } from '../alert';
import { discardProblem, flush, isOffline, problems, queued, retryProblem, saveForOffline, subscribe } from '../offline';
import { flush as flushReviews, pendingCount, subscribe as subscribeReviews } from '../reviewQueue';
import { useTheme } from '../theme';
import { BackButton, Button, Header, Icon, Screen, Surface, Txt } from '../components/ui';
import { stripCloze } from '../../../shared/cloze.js';

const first = (side = {}) => stripCloze(side.text || '').trim().slice(0, 70) || 'a picture';
const describe = o => ({
  'card.create': `New card: ${first(o.body?.front)}`,
  'card.update': `Edited card: ${first(o.body?.front)}`,
  'card.delete': 'Deleted a card',
  'note.create': `New page: ${o.body?.title || 'Untitled page'}`,
  'note.update': `Edited page: ${o.body?.title || 'Untitled page'}`,
}[o.type] || 'A change');

const WHY = {
  conflict: 'This was changed somewhere else after you started. Keep yours to replace it, or discard yours.',
  gone: 'What this change refers to no longer exists.',
  refused: 'The server did not accept this change.',
};

/** What is waiting to sync, what could not be, and a way to keep the library available offline. */
export default function Sync() {
  const { c } = useTheme();
  const [, tick] = useState(0);
  const [reviews, setReviews] = useState(pendingCount());
  const [busy, setBusy] = useState(''), [note, setNote] = useState(''), [bad, setBad] = useState(false);
  useEffect(() => { const a = subscribe(() => tick(n => n + 1)), b = subscribeReviews(e => { if ('pending' in e) setReviews(e.pending); }); return () => { a(); b(); }; }, []);

  const waiting = queued(), stuck = problems();
  const run = async (key, fn) => { setBusy(key); setNote(''); setBad(false); try { await fn(); } catch (e) { setNote(e.message); setBad(true); } finally { setBusy(''); } };

  return <Screen>
    <Header title="Sync" subtitle={isOffline() ? 'You are offline' : 'Changes made on this phone'} left={<BackButton />} />

    <Button title="Sync now" icon="refresh-cw" loading={busy === 'sync'} onPress={() => run('sync', () => Promise.all([flush(), flushReviews()]))} />
    {note ? <Txt variant="small" style={{ color: bad ? c.danger : c.success }}>{note}</Txt> : null}

    {stuck.length ? <View style={{ gap: 10 }}>
      <Txt variant="label">NEEDS YOUR ATTENTION</Txt>
      {stuck.map(o => <Surface key={o.id} style={{ gap: 10, borderColor: c.danger }}>
        <Txt variant="medium">{describe(o)}</Txt>
        <Txt variant="small">{WHY[o.reason] || o.message}</Txt>
        <View style={{ flexDirection: 'row', gap: 10 }}>
          {o.reason !== 'gone' ? <Button small title={o.reason === 'conflict' ? 'Keep mine' : 'Try again'} loading={busy === o.id} onPress={() => run(o.id, () => retryProblem(o.id))} style={{ flex: 1 }} /> : null}
          <Button small variant="danger" title="Discard" onPress={() => Alert.alert('Discard this change?', 'It is removed from this phone and not sent.', [{ text: 'Cancel', style: 'cancel' }, { text: 'Discard', style: 'destructive', onPress: () => discardProblem(o.id) }])} style={{ flex: 1 }} />
        </View>
      </Surface>)}
    </View> : null}

    <View style={{ gap: 10 }}>
      <Txt variant="label">WAITING TO SYNC</Txt>
      {waiting.map(o => <Surface key={o.id} style={{ flexDirection: 'row', alignItems: 'center', gap: 12 }}>
        <Icon name={o.inflight ? 'upload-cloud' : 'clock'} size={18} color={c.muted} />
        <Txt style={{ flex: 1 }} numberOfLines={2}>{describe(o)}</Txt>
      </Surface>)}
      {reviews ? <Surface style={{ flexDirection: 'row', alignItems: 'center', gap: 12 }}><Icon name="check-circle" size={18} color={c.muted} /><Txt style={{ flex: 1 }}>{reviews} card answer{reviews === 1 ? '' : 's'}</Txt></Surface> : null}
      {!waiting.length && !reviews ? <Txt variant="small">Everything is up to date.</Txt> : null}
    </View>

    <Surface style={{ gap: 10 }}>
      <Txt variant="medium">Study without a connection</Txt>
      <Txt variant="small">Save your folders and cards on this phone so you can study, add and edit cards anywhere. Changes sync when you are back online. Pictures are shown when you have a connection.</Txt>
      <Button variant="secondary" icon="download" loading={busy === 'save'} title={busy === 'save' ? 'Saving…' : 'Save my library for offline'}
        onPress={() => run('save', async () => { const n = await saveForOffline(); setNote(`Saved ${n} folder${n === 1 ? '' : 's'} on this phone.`); })} />
    </Surface>
  </Screen>;
}
