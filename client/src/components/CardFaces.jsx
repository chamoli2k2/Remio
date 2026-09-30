import Img from './Img';
import RichText, { sideOf, plainText } from './RichText';

/**
 * Both sides of a card, with the one facing away hidden rather than left out.
 *
 * ── Why both are in the page ──────────────────────────────────────────────────────────────────
 *
 * A published collection only used to render whichever side was showing, so the answers were not
 * in the HTML at all — a page of fifty cards offered a search engine fifty questions and nothing
 * else. The answers are the substance: they are what somebody searching a question is looking for,
 * and what makes the page worth more than a list of prompts. Now both are there, and turning the
 * card shows the other one rather than fetching or re-rendering it.
 *
 * This is the same arrangement as a tab strip or an accordion, which is a pattern search engines
 * read and index normally. It is not an attempt to show them something a visitor cannot get to:
 * the hidden side is one click away, and it is the same text either way.
 *
 * ── How it stays invisible without disturbing the layout ──────────────────────────────────────
 *
 * The wrapper is `display: contents`, so it generates no box of its own and the image and the text
 * remain direct flex children of the card exactly as they were. Without that, wrapping them would
 * have made the wrapper the flex item and collapsed a two-item column into one. Hiding is then the
 * `hidden` attribute, which the stylesheet has to honour explicitly — an author rule setting
 * `display` beats the browser's own rule for `[hidden]`, so leaving it implicit would show both
 * sides at once.
 */
export default function CardFaces({ card, flipped, sizes }) {
  // Asked for by name rather than by the flag, because `sideOf` is where the cloze rule lives: a
  // cloze card with an empty back has no second side, and its "answer" is its own front with the
  // deletions filled in.
  return [['front', sideOf(card, false)], ['back', sideOf(card, true)]].map(([name, side]) => (
    <span className="card-face" key={name} hidden={name === (flipped ? 'front' : 'back')}>
      {side.image && <Img id={side.image} alt={plainText(side.text) || 'Flashcard image'} sizes={sizes}/>}
      <RichText text={side.text} cloze={side.cloze}/>
    </span>
  ));
}
