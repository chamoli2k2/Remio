import { useEffect, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { ArrowRight, Layers, Users, Brain, Globe2, LockKeyhole, Search, ChevronDown, GraduationCap, Swords, Check, WifiOff, Bot, Share2, Flame, Plus, Quote } from 'lucide-react';
import { api } from '../services/api';
import { useQuery } from '../hooks/useApp';
import Img from '../components/Img';
import { FolderIcon, Loading, Avatar, Empty } from '../components/ui';
import { BRAND } from '../../../shared/brand.js';
import HomeDemo from '../components/HomeDemo';
import Reveal from '../components/Reveal';
import CountUp from '../components/CountUp';
import './home.css';

function matchesFolder(folder, query) {
  if (!query) return true;
  const hay = `${folder.title} ${folder.description} ${folder.tags?.join(' ') || ''} ${folder.owner?.username || ''}`.toLowerCase();
  return hay.includes(query.toLowerCase());
}

const FAQS = [
  [`Is ${BRAND.name} actually free?`,
    'Yes, and the free tier is the whole product rather than a teaser. Accounts, collections, cards, spaced repetition, publishing to the community, and your own progress all cost nothing, and we never ask for a card. Premium adds projects, deck import and export, folder covers, live quiz hosting, and editor invites.'],
  [`How does ${BRAND.name} decide what to show me each day?`,
    'It runs on FSRS, the scheduler behind modern Anki. Rate each answer honestly and it works out when you are about to forget that particular card, then brings it back just before you do. Hard cards return in a day or two, ones you know well drift out to weeks or months. Most people need a few minutes a day.'],
  ['What happens if I miss a few days?',
    'Nothing breaks and nothing is lost. There is no streak to protect, so there is nothing to feel bad about. Your due cards wait, and when you come back the schedule works from what you actually remember rather than what you meant to do.'],
  ['Can I study with friends, or run a class?',
    'Both. Share any folder by username, as a viewer or, on Premium, as an editor who can work on it with you live. Classrooms go further: buy seats, invite people with a code or link, set assignments with due dates, and read a coverage and accuracy report for the group.'],
  ['Who can see what I make?',
    'Only you, until you say otherwise. New collections are private. You can share one with named people, or publish it for anyone to read and copy. Even in a classroom, teachers only see progress on the classroom’s own material, never your personal library.'],
  ['Will I ever be charged automatically?',
    `No. There is no auto-renewal and we hold no mandate against your card or UPI ID. Each plan is one payment for a fixed period. When it runs out your account drops back to the free tier and every card you made stays exactly where it is. Changed your mind? Personal plans refund in full for ${BRAND.refundDays} days, which is the cancellation right UK and EU shoppers have by law and everyone else gets anyway.`],
  ['Can I bring in decks I already have, and get them out again?',
    'Yes, both ways. Premium accounts import from Anki, CSV, Markdown, or JSON, and export any folder back out as JSON or CSV whenever they like. Your cards are never locked in.'],
  ['Does it work on my phone?',
    `Yes. ${BRAND.name} runs in any modern browser and the layout adapts to phones and tablets, so you can review on the bus and write cards properly on a laptop later. It is one library either way.`],
];
/**
 * What the product actually does, written out rather than hinted at.
 *
 * Grouped by what somebody is trying to do rather than by which part of the code it lives in, and
 * tabbed rather than listed, because five short lists are read and one list of thirty is not.
 * `premium` marks the handful behind a plan, said here so nobody discovers it mid-task.
 */
const GUIDE = [
  { id: 'build', label: 'Build', icon: Layers, blurb: 'Turn what you are learning into cards worth coming back to.', items: [
    ['Folders for anything', 'Group cards however you think: a subject, a book, a week of revision. Give one an icon and a colour so you can find it at a glance.'],
    ['Two-sided cards', 'A question on the front, the answer on the back. Both sides take formatted text, lists, code, and maths, so a chemistry card and a programming card can each look right.'],
    ['Images on a card', 'Drop a diagram, a screenshot, or a photo of a whiteboard straight onto either side.'],
    ['Hints, sources, and tags', 'A nudge for when you are stuck, a note of where the fact came from, and tags to filter a big folder down to one topic.'],
    ['Import a deck you already have', 'Bring in Anki, CSV, Markdown, or JSON. Your old decks do not have to be retyped.', 'premium'],
    ['Export whenever you like', 'Download any folder as JSON or CSV. Nothing you make is locked in here.', 'premium'],
    ['Projects', 'Gather related folders into a project you can reopen as one piece of work.', 'premium'],
    ['Folder covers', 'Upload a thumbnail so a collection is recognisable rather than just titled.', 'premium'],
    ['Archive instead of delete', 'Put a finished collection out of the way without losing it.'],
  ] },
  { id: 'study', label: 'Study', icon: Brain, blurb: 'Review the few cards you are about to forget, not all of them.', items: [
    ['Spaced repetition that adapts', 'Scheduling runs on FSRS, the algorithm behind modern Anki. It learns how well you know each individual card rather than applying one rule to all of them.'],
    ['Four honest ratings', 'Again, Hard, Good, Easy. Rate truthfully and a difficult card returns in a day while one you know drifts out to months.'],
    ['Only what is due', 'Your daily session is the cards that have come round, so a big library does not mean a long sitting.'],
    ['Quick review', 'Want to go through a whole folder before an exam? Flip the lot without touching your schedule.'],
    ['Bookmarks', 'Flag a card to come back to, and filter a folder down to just those.'],
    ['A daily goal you set', 'Pick a number of cards that fits your day. Miss a few days and nothing breaks: there is no streak to protect.'],
    ['Progress worth reading', 'See what you have reviewed, how much you are retaining, and what is coming up, rather than a wall of statistics.'],
    ['Works offline', 'Cards you have opened stay available when the connection drops, so a commute is still study time.'],
  ] },
  { id: 'share', label: 'Share', icon: Users, blurb: 'Private until you decide otherwise, then shared exactly as far as you want.', items: [
    ['Private by default', 'Every new collection is yours alone. Nothing is published unless you publish it.'],
    ['Share with named people', 'Invite somebody by username as a viewer. They can read and study; they cannot change anything.'],
    ['Invite an editor', 'Give someone write access and you can both work on the same folder at once, seeing each other type. Viewers stay free.', 'premium'],
    ['Publish to the community', 'Make a collection public and anyone can read it, study it, and take their own copy — without an account.'],
    ['Copy anything public', 'Found a deck you like? Take a private copy and change it however you want. The original is untouched.'],
    ['Friends and profiles', 'Follow the people whose collections you keep going back to, and let them find yours.'],
    ['Your progress stays yours', 'Studying a shared folder tracks against your own memory. Nobody sees how you are doing on it.'],
  ] },
  { id: 'teach', label: 'Teach', icon: GraduationCap, blurb: 'Run a class or a study group without a spreadsheet.', items: [
    ['Classrooms and teams', 'Create a group, buy the seats you need, and add people as students or teachers.'],
    ['Join by code or link', 'Share a six-character code or a link. No manual invitations, one at a time.'],
    ['Assignments with due dates', 'Point the group at a folder, set a deadline, and everybody gets a notification.'],
    ['A report you can act on', 'See what proportion of the material each person has actually seen, and where the group is struggling.'],
    ['Seats added mid-term are prorated', 'Three more students in week six are charged for the weeks that remain, not a whole fresh period.'],
    ['Students keep their privacy', 'A teacher sees progress on the classroom’s own material and nothing else. Personal libraries stay personal.'],
  ] },
  { id: 'play', label: 'Play', icon: Swords, blurb: 'Turn a folder into a game when revision needs to be less lonely.', items: [
    ['Live quiz rooms', 'Turn any folder into a timed multiple-choice game. Questions are built from your own cards, with wrong answers drawn from the rest of the folder.', 'premium'],
    ['Anyone can join, free', 'Players enter a six-letter code. They do not need Premium, and they do not need an account.'],
    ['Scored on speed and accuracy', 'Right answers score, faster right answers score more, and a live leaderboard updates as the round runs.'],
    ['You choose the shape', 'Set how many questions and how long each one lasts before you open the room.'],
  ] },
];

function Guide() {
  const [open, setOpen] = useState(GUIDE[0].id);
  const shown = GUIDE.find(g => g.id === open) || GUIDE[0];
  return <section className="home-guide" id="guide">
    <div className="home-guide-head">
      <span className="eyebrow">THE GUIDE</span>
      <h2>Everything {BRAND.name} does</h2>
      <p>No tour to sit through and no account needed to read it. Pick an area and see exactly what you get.</p>
    </div>
    <div className="home-guide-tabs" role="tablist" aria-label={`What ${BRAND.name} does`}>
      {GUIDE.map(group => {
        const Icon = group.icon;
        return <button key={group.id} role="tab" type="button" id={`guide-tab-${group.id}`}
          aria-selected={group.id === open} aria-controls={`guide-panel-${group.id}`}
          className={group.id === open ? 'is-open' : ''} onClick={() => setOpen(group.id)}>
          <Icon size={16}/> {group.label}
        </button>;
      })}
    </div>
    <div className="home-guide-panel" role="tabpanel" id={`guide-panel-${shown.id}`} aria-labelledby={`guide-tab-${shown.id}`}>
      <p className="home-guide-blurb">{shown.blurb}</p>
      <ul className="home-guide-list">
        {shown.items.map(([title, text, tier]) => <li key={title}>
          <span className="home-guide-check"><Check size={13}/></span>
          <div>
            <h3>{title}{tier === 'premium' && <span className="home-guide-tier">Premium</span>}</h3>
            <p>{text}</p>
          </div>
        </li>)}
      </ul>
    </div>
    <p className="home-guide-foot">
      Everything without a Premium label is free, forever, in every country. <Link to="/pricing">See what Premium costs</Link>.
    </p>
  </section>;
}
function PublicFolderCard({ folder }) {
  return <Link className={`home-folder ${folder.color}`} to={`/folders/${folder.id}`}>
    <div className="home-folder-cover">{folder.thumbnail ? <Img className="tile-thumb" id={folder.thumbnail} alt={`${folder.title} flashcard collection`} sizes="(max-width: 900px) 100vw, 320px" max={folder.thumbnailWidth}/> : <span className="folder-icon"><FolderIcon name={folder.icon} size={26}/></span>}<span className="visibility-badge"><Globe2 size={11}/> Public</span></div>
    <div className="home-folder-body"><h3>{folder.title}</h3><p>{folder.description || 'A public collection of flashcards.'}</p>
      <div className="home-folder-meta"><span><Avatar user={folder.owner} small/> @{folder.owner?.username}</span><span>{folder.cardCount} cards · {folder.likeCount || 0} likes · {folder.copyCount || 0} copies</span></div></div>
  </Link>;
}

/** Questions a flashcard app can ask about flashcards. Each answer is a result from published research. */
const FACTS = [
  { q: 'How much do we forget in a day?', a: 'Without review, roughly half to two thirds of new material is gone within 24 hours. Hermann Ebbinghaus charted this curve in 1885, and later replications found the same shape.', src: 'Ebbinghaus, 1885' },
  { q: 'Testing yourself or rereading: which sticks?', a: 'In a well-known study, students who practised recalling a text remembered 61% of it a week later. Students who simply reread it remembered 40%.', src: 'Roediger & Karpicke, 2006' },
  { q: 'Does spacing really beat cramming?', a: 'A review of 317 experiments found that spreading study over time beats massing it into one sitting. The gap that works best grows with how long you need to remember.', src: 'Cepeda et al., 2006' },
  { q: 'Which study habits do researchers rate highest?', a: 'A major review of ten popular techniques rated practice testing and spaced practice as high-utility, and rated highlighting and rereading as low-utility.', src: 'Dunlosky et al., 2013' },
  { q: 'Who invented the flashcard box?', a: 'Sebastian Leitner, in the 1970s. Cards you answer correctly move up a box and come back less often. Spaced repetition software automates the same idea.', src: 'Leitner, 1972' },
];

function FactDeck() {
  const [open, setOpen] = useState(0), [touched, setTouched] = useState(false);
  // Turns the pages itself until somebody takes over, so a visitor who only watches still sees them all.
  useEffect(() => {
    if (touched || window.matchMedia?.('(prefers-reduced-motion: reduce)').matches) return undefined;
    const t = setInterval(() => setOpen((o) => (o + 1) % FACTS.length), 7000);
    return () => clearInterval(t);
  }, [touched]);
  const pick = (i) => { setOpen(i); setTouched(true); };
  return <div className="facts-deck">
    <ul className="facts-tabs" role="tablist" aria-label="Facts about flashcards">
      {FACTS.map((f, i) => <li key={f.q}><button type="button" role="tab" aria-selected={open === i} className={open === i ? 'is-on' : ''} onClick={() => pick(i)}><span>{String(i + 1).padStart(2, '0')}</span>{f.q}</button></li>)}
    </ul>
    <div className="facts-card" key={open}>
      <small className="facts-label"><Quote size={13}/> THE ANSWER</small>
      <p>{FACTS[open].a}</p>
      <footer>{FACTS[open].src}</footer>
    </div>
  </div>;
}

function HeroStack() {
  const cards = [['How long until we forget half?', 'About a day, without review.'], ['What is active recall?', 'Pulling an answer from memory instead of rereading it.'], ['What is a spaced interval?', 'A gap that grows each time you remember.']];
  const [step, setStep] = useState(0);
  useEffect(() => {
    if (window.matchMedia?.('(prefers-reduced-motion: reduce)').matches) return undefined;
    const t = setInterval(() => setStep((s) => s + 1), 1700);
    return () => clearInterval(t);
  }, []);
  const round = Math.floor(step / 2), flipped = step % 2 === 1;
  return <div className="hero-stack" aria-hidden="true">
    {cards.map(([q, a], i) => {
      const pos = (i - round % cards.length + cards.length) % cards.length;
      return <div key={q} className={`hs-card pos-${pos} ${pos === 0 && flipped ? 'is-flipped' : ''}`}>
        <div className="hs-in"><div className="hs-face"><small>QUESTION</small><p>{q}</p></div><div className="hs-face hs-back"><small>ANSWER</small><p>{a}</p></div></div>
      </div>;
    })}
    <span className="hs-chip hs-chip-a"><Flame size={13}/> 7 day streak</span>
    <span className="hs-chip hs-chip-b"><Check size={13}/> 18 cards due today</span>
  </div>;
}

/** Small looping pictures for the feature tiles. Pure CSS: each one is a few spans that move. */
const Curve = () => <svg className="viz-curve" viewBox="0 0 220 90" aria-hidden="true"><path className="c1" d="M4 8 C 40 10, 50 70, 90 78 S 160 84, 216 84"/><path className="c2" d="M4 8 C 30 8, 40 30, 60 30 C 70 8, 90 12, 110 24 C 125 8, 150 10, 216 14"/><circle cx="60" cy="30" r="3.5"/><circle cx="110" cy="24" r="3.5"/></svg>;
const Heat = () => <div className="viz-heat" aria-hidden="true">{Array.from({ length: 42 }, (_, i) => <i key={i} data-l={[0, 1, 2, 3, 1, 0, 2, 3, 2, 1, 3, 3, 0, 2][i % 14]} style={{ animationDelay: `${(i % 14) * 60 + Math.floor(i / 14) * 150}ms` }}/>)}</div>;
const Race = () => <div className="viz-race" aria-hidden="true">{[['Mia', 92], ['Dev', 78], ['You', 66], ['Zoe', 40]].map(([n, w], i) => <div key={n}><span>{n}</span><i style={{ '--w': `${w}%`, animationDelay: `${i * 160}ms` }}/></div>)}</div>;
const Chat = () => <div className="viz-chat" aria-hidden="true"><p className="u">Make 12 cards from my chapter on cells</p><p className="b"><i/><i/><i/></p><span><Check size={12}/> 12 cards added</span></div>;
const Avatars = () => <div className="viz-people" aria-hidden="true">{['A', 'M', 'D', 'Z'].map((n, i) => <i key={n} style={{ animationDelay: `${i * 220}ms` }}>{n}</i>)}<span><Plus size={12}/> Invite by username</span></div>;
const Offline = () => <div className="viz-offline" aria-hidden="true"><span className="off"><WifiOff size={13}/> Offline</span><div><i/><i/><i/></div><span className="sync"><Check size={12}/> Synced</span></div>;

function Features() {
  const tiles = [
    ['wide', Brain, 'Scheduling that learns you', 'FSRS, the algorithm behind modern Anki, tracks how well you know each card and brings it back just before you would forget.', <Curve key="a"/>],
    ['', Bot, 'An assistant that writes cards', 'Connect your own AI assistant and turn a chapter or a transcript into a deck.', <Chat key="b"/>],
    ['', Flame, 'A habit, not a streak trap', 'A daily goal you set. Miss a week and nothing breaks.', <Heat key="c"/>],
    ['', Users, 'Share by username', 'Invite viewers or live co-editors, or publish a collection for anyone to study.', <Avatars key="d"/>],
    ['', WifiOff, 'Works offline', 'Study on the train. Reviews sync when you are back online.', <Offline key="f"/>],
    ['wide', Swords, 'Live quiz rooms', 'Turn any folder into a timed game. Players join with a six-letter code, no account needed.', <Race key="e"/>],
  ];
  return <section className="features" id="features">
    <Reveal className="sec-head"><span className="kicker">What you get</span><h2>Everything a serious study habit needs</h2></Reveal>
    <div className="features-grid">
      {tiles.map(([cls, Icon, title, text, viz], i) => <Reveal key={title} className={`feat ${cls}`} delay={(i % 3) * 90}>
        <div className="feat-viz">{viz}</div>
        <div className="feat-copy"><span className="feat-icon"><Icon size={16}/></span><h3>{title}</h3><p>{text}</p></div>
      </Reveal>)}
    </div>
  </section>;
}

function Steps() {
  const steps = [[Layers, 'Collect', `Make a folder for anything worth remembering. Add two-sided text or image cards, with tags, hints, and sources.`], [Brain, 'Recall', `Study what is due. Rate each answer honestly and ${BRAND.name} brings difficult cards back sooner.`], [Users, 'Share', 'Invite people as viewers or editors, publish to the community, or keep it entirely to yourself.']];
  return <section className="steps" aria-label={`How ${BRAND.name} works`}>
    {steps.map(([Icon, title, text], i) => <Reveal key={title} className="step" delay={i * 110}><span className="step-n">{`0${i + 1}`}</span><h3><Icon size={18}/> {title}</h3><p>{text}</p></Reveal>)}
  </section>;
}

const Faq = () => <section className="faq" id="faq">
  <Reveal className="sec-head"><span className="kicker">Good questions</span><h2>The things people ask before they start</h2><p>Short answers, honestly given. If yours is not here, <Link to="/contact">ask us directly</Link> and a person will read it.</p></Reveal>
  <div className="faq-list">
    {FAQS.map(([question, answer]) => <details className="faq-item" key={question}>
      <summary>{question}<ChevronDown className="faq-chevron" size={18}/></summary>
      <div className="faq-answer"><p>{answer}</p></div>
    </details>)}
  </div>
</section>;

/** Three full rows of the grid. The rest of the library lives behind Explore. */
const HOME_FOLDERS = 9;

export default function HomePage() {
  const [params, setParams] = useSearchParams();
  const query = params.get('q') || '';
  const { data, loading } = useQuery('/folders?scope=explore', () => api('/folders?scope=explore').catch(() => ({ folders: [] })));
  const { data: people } = useQuery(`/users?q=${encodeURIComponent(query.trim())}`, undefined, { enabled: query.trim().length >= 2 });
  const all = data?.folders || [];
  const folders = all.filter(f => matchesFolder(f, query));
  // A search is left whole. Hiding something somebody asked for by name reads as a missing result
  // rather than a shortened list.
  const visible = query ? folders : folders.slice(0, HOME_FOLDERS);
  return <div className="home">
    <section className="hero">
      <div className="hero-copy">
        <span className="kicker">Flashcards, done properly</span>
        <h1>Learn a little.<br/><mark><span>Remember a lot.</span></mark></h1>
        <p>{BRAND.name} turns what you read, hear, and wonder about into flashcards you actually revisit. Build collections, study with spaced repetition, and learn alongside people you trust.</p>
        <div className="hero-actions"><Link className="button primary" to="/signup">Start for free <ArrowRight size={17}/></Link><Link className="button secondary" to="/explore">Browse public collections</Link></div>
        <ul className="hero-notes"><li><LockKeyhole size={13}/> Private by default</li><li><Users size={13}/> Share by username</li><li><Brain size={13}/> Smart scheduling</li></ul>
      </div>
      <HeroStack/>
    </section>

    <section className="showcase" aria-label={`A look inside ${BRAND.name}`}>
      <Reveal className="sec-head"><span className="kicker">See it in action</span><h2>This is the actual workspace</h2><p>Make a folder, add cards, study them. Three minutes from sign-up to your first review.</p></Reveal>
      <HomeDemo/>
    </section>

    <section className="facts" id="facts">
      <Reveal className="sec-head on-dark"><span className="kicker">Why it works</span><h2>Memory has rules. Flashcards follow them.</h2><p>Decades of research agree on a few simple things. {BRAND.name} is built around them.</p></Reveal>
      <Reveal className="facts-stats">
        <div><b><CountUp to={61} suffix="%"/></b><span>recalled after a week by students who tested themselves</span></div>
        <div><b><CountUp to={40} suffix="%"/></b><span>recalled by students who only reread</span></div>
        <div><b><CountUp to={317}/></b><span>experiments in the largest review of the spacing effect</span></div>
      </Reveal>
      <Reveal><FactDeck/></Reveal>
    </section>

    <Features/>
    <Steps/>
    <Guide/>

    <Reveal as="section" className="community" id="library">
      <div className="community-head"><div><span className="kicker">The community library</span><h2>Public collections, ready to study</h2></div><Link to="/explore" className="text-button">Explore all <ArrowRight size={15}/></Link></div>
      <form className="home-search folder-search" onSubmit={e => e.preventDefault()}><Search size={16}/><input aria-label="Search public collections and people" placeholder="Search collections or people…" value={query} onChange={e => setParams(e.target.value ? { q: e.target.value } : {})}/></form>
      {people?.users?.length > 0 && <div className="people-hits">{people.users.map(p => <Link key={p.id} className="person-chip" to={`/u/${p.username}`}><Avatar user={p} small/> {p.name} <small>@{p.username}</small></Link>)}</div>}
      {loading ? <Loading/> : !folders.length ? query ? <Empty title="No matching collections" text="Try another word. Titles, descriptions, tags, and authors are all searchable without an account."/> : <div className="home-empty"><Globe2 size={22}/><p>No public collections yet. Be the first: create an account and publish a folder.</p></div> : <div className="home-folder-grid">{visible.map(f => <PublicFolderCard folder={f} key={f.id}/>)}</div>}
      {folders.length > visible.length && <div className="home-folder-more"><Link className="button secondary" to="/explore">Explore more collections <ArrowRight size={16}/></Link></div>}
      <p className="community-note">Anyone can read and flip public cards. To save a collection, make a private copy, track progress, or create your own, you’ll need an account, which takes a few seconds.</p>
    </Reveal>

    <Faq/>

    <section className="cta">
      <h2>Your future self will thank you.</h2>
      <p>Free to use. No credit card, no noise.</p>
      <Link className="button cta-btn" to="/signup">Create your account <ArrowRight size={17}/></Link>
    </section>
  </div>;
}
