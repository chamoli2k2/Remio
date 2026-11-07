import { useMemo } from 'react';
import { Linking, Platform } from 'react-native';
import Markdown from 'react-native-markdown-display';
import { FONT, useTheme } from '../theme';
import { CLOZE_RE } from '../../../shared/cloze.js';

/**
 * Card and note text: Markdown, with cloze deletions.
 *
 * Cloze text is turned into Markdown before rendering: `{{c1::answer::hint}}` becomes a bold
 * `[hint or …]` while the answer is hidden, and the bold answer once it is shown. Pictures written
 * into the text are not rendered, because a link in text somebody else wrote would make the phone
 * fetch an address they chose; real pictures come from the card's own image. Links open only if
 * they are web or mail addresses.
 *
 * Maths ($…$) is shown as written for now; it is not typeset on the phone yet.
 */
export function clozeToMarkdown(text, mode = 'show') {
  CLOZE_RE.lastIndex = 0;
  return String(text || '').replace(CLOZE_RE, (_m, _n, answer, hint) => (mode === 'hide' ? `**[${(hint || '…').trim()}]**` : `**${answer}**`));
}

// The Markdown parser slows down on very long attacker-written text, so a single block is cut at a length no real card or page section reaches.
const MAX_TEXT = 20_000;

const safeLink = url => {
  if (/^(https?:|mailto:)/i.test(url)) Linking.openURL(url).catch(() => {});
  return false;
};

export default function Rich({ text = '', cloze = 'show', size = 16, center = false, color }) {
  const { c } = useTheme();
  const style = useMemo(() => {
    const ink = color || c.ink;
    const mono = Platform.select({ ios: 'Menlo', android: 'monospace' });
    return {
      body: { fontFamily: FONT.body, fontSize: size, lineHeight: size * 1.5, color: ink, textAlign: center ? 'center' : 'left' },
      paragraph: { marginTop: 0, marginBottom: size * 0.6 },
      heading1: { fontFamily: FONT.display, fontSize: size * 1.5, color: ink, marginVertical: 8 },
      heading2: { fontFamily: FONT.heading, fontSize: size * 1.3, color: ink, marginVertical: 6 },
      heading3: { fontFamily: FONT.heading, fontSize: size * 1.12, color: ink, marginVertical: 4 },
      strong: { fontFamily: FONT.semibold, color: ink },
      em: { fontStyle: 'italic' },
      link: { color: c.accent, textDecorationLine: 'underline' },
      blockquote: { backgroundColor: c.surface2, borderLeftColor: c.accent, borderLeftWidth: 3, paddingHorizontal: 12, paddingVertical: 4, marginVertical: 6, borderRadius: 4 },
      code_inline: { fontFamily: mono, backgroundColor: c.surface3, color: ink, paddingHorizontal: 4, borderRadius: 4, fontSize: size * 0.9 },
      code_block: { fontFamily: mono, backgroundColor: c.surface3, color: ink, padding: 12, borderRadius: 10, borderWidth: 0, fontSize: size * 0.88 },
      fence: { fontFamily: mono, backgroundColor: c.surface3, color: ink, padding: 12, borderRadius: 10, borderWidth: 0, fontSize: size * 0.88 },
      bullet_list_icon: { color: c.accent },
      ordered_list_icon: { color: c.accent },
      table: { borderColor: c.border, borderWidth: 1, borderRadius: 8 },
      th: { padding: 6, fontFamily: FONT.semibold }, td: { padding: 6 }, tr: { borderColor: c.border },
      hr: { backgroundColor: c.border },
    };
  }, [c, size, center, color]);
  const rules = useMemo(() => ({ image: () => null }), []);
  return <Markdown style={style} rules={rules} onLinkPress={safeLink}>{clozeToMarkdown(String(text || '').slice(0, MAX_TEXT), cloze)}</Markdown>;
}
