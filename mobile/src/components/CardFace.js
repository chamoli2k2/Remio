import RemoteImage from './RemoteImage';
import { Image, View } from 'react-native';
import { hasCloze } from '../../../shared/cloze.js';
import { useTheme } from '../theme';
import Rich from './Rich';
import { Txt } from './ui';

/** Which side of a card to show. A cloze card has only a front: its back is the same text with the answers revealed. */
export function sideOf(card, flipped) {
  const f = card.front || {}, b = card.back || {};
  const clozeCard = hasCloze(f.text) && !(b.text || '').trim() && !b.image && !b.drawing;
  if (clozeCard) return { ...f, cloze: flipped ? 'show' : 'hide' };
  return { ...(flipped ? b : f), cloze: 'show' };
}

export const previewText = card => {
  const s = sideOf(card, false);
  return (s.text || '').replace(/\{\{c\d+::([\s\S]*?)(?:::[\s\S]*?)?\}\}/g, '$1').replace(/[#*_`>\[\]]/g, '').trim() || (s.image ? 'Picture card' : s.drawing ? 'Drawing card' : 'Empty card');
};

export default function CardFace({ side, size = 20 }) {
  const { c } = useTheme();
  return <View style={{ gap: 14, alignItems: 'center', alignSelf: 'stretch' }}>
    {side.image ? <RemoteImage id={side.image} resizeMode="contain" accessibilityLabel="Card picture"
      style={{ width: '100%', height: 190, borderRadius: 12, backgroundColor: c.surface2 }} /> : null}
    {side.drawing ? <Txt variant="small" style={{ fontStyle: 'italic' }}>This card has a drawing. Open it on {`remio.in`} to see it.</Txt> : null}
    {side.text?.trim() ? <Rich text={side.text} cloze={side.cloze} size={size} center /> : null}
    {!side.text?.trim() && !side.image && !side.drawing ? <Txt variant="small">Nothing on this side.</Txt> : null}
  </View>;
}
