import { Link } from 'react-router-dom';
import { Mail, ReceiptIndianRupee, ShieldAlert, MapPin, Clock3, MessageCircleQuestion, ArrowRight } from 'lucide-react';
import { BRAND } from '../../../shared/brand.js';

/** Names and addresses come from the one brand config, so renaming the product rewrites these pages
 *  too. The pages are a solid starting point, not legal advice: have a lawyer read them against the
 *  jurisdiction you actually operate in. */
const COMPANY = {
  name: BRAND.name,
  legalName: BRAND.legalName,
  email: BRAND.email.general,
  billing: BRAND.email.billing,
  privacy: BRAND.email.privacy,
  security: BRAND.email.security,
  city: BRAND.city,
  country: BRAND.country,
  updated: BRAND.policyUpdated,
  refundDays: BRAND.refundDays,
};

function LegalPage({ eyebrow, title, lede, sections }) {
  return <article className="legal">
    <header className="legal-head">
      <span className="eyebrow">{eyebrow}</span>
      <h1>{title}</h1>
      <p className="legal-lede">{lede}</p>
      <p className="legal-updated"><Clock3 size={14}/> Last updated {COMPANY.updated}</p>
    </header>
    <div className="legal-body">
      {/* Built from the same array as the sections, so a new section can never go missing from the list. */}
      <nav className="legal-toc" aria-label="On this page">
        <p>On this page</p>
        <ol>{sections.map((s, i) => <li key={s.id}><a href={`#${s.id}`}><span>{i + 1}</span>{s.title}</a></li>)}</ol>
      </nav>
      <div className="legal-content">
        {sections.map((s, i) => <section id={s.id} key={s.id}>
          <h2><span className="legal-number">{i + 1}</span>{s.title}</h2>
          {s.body}
        </section>)}
      </div>
    </div>
    <footer className="legal-foot">
      <div><h3>Still have a question?</h3><p>We would rather explain it than have you guess.</p></div>
      <Link className="button secondary" to="/contact">Contact us <ArrowRight size={15}/></Link>
    </footer>
  </article>;
}

const termsSections = [
  {
    id: 'about', title: 'About these terms', body: <>
      <p>{COMPANY.name} is a flashcard and spaced-repetition service operated by {COMPANY.legalName}, based in {COMPANY.city}, {COMPANY.country}. These terms are the agreement between you and us. By creating an account or using {COMPANY.name}, you accept them.</p>
      <p>If you are setting {COMPANY.name} up for a school, a company, or any other organisation, you confirm that you are allowed to accept these terms on its behalf.</p>
    </>,
  },
  {
    id: 'account', title: 'Your account', body: <>
      <p>You need an account to create collections, study, or join a classroom. Reading a published collection does not require one.</p>
      <ul>
        <li>Keep your password to yourself. Anything done through your account is treated as done by you.</li>
        <li>An account belongs to one person. If you want several people working on the same material, share the folder or add them to a classroom rather than passing a login around.</li>
        <li>You must be at least 13 years old, or the minimum age of digital consent where you live if it is higher. Below that, a parent, guardian, or teacher should hold the account.</li>
        <li>If you think someone else has got into your account, write to {COMPANY.security} and we will help you lock it down.</li>
      </ul>
    </>,
  },
  {
    id: 'content', title: 'Your content stays yours', body: <>
      <p>Every card, folder, note, and image you add to {COMPANY.name} remains yours. We claim no ownership of it.</p>
      <p>To actually run the service we need your permission to store your content, process it, back it up, and display it to you and to anyone you have chosen to share it with. That permission is limited to operating {COMPANY.name} and it ends when you delete the content or your account. We do not use your private material to advertise to you or sell it on.</p>
      <p>You confirm that you have the right to upload what you upload. Please do not paste in a copyrighted question bank, a paid course’s material, or anything else you are not licensed to reproduce. We may remove content that breaks these terms or the law, and we will tell you why when we can.</p>
    </>,
  },
  {
    id: 'sharing', title: 'Sharing, publishing, and classrooms', body: <>
      <p>New collections are private. Nothing you make becomes visible to anyone else until you choose to share or publish it.</p>
      <ul>
        <li><strong>Sharing</strong> gives named people access as viewers or editors. You can change or withdraw that at any time.</li>
        <li><strong>Publishing</strong> makes a collection readable by anyone on the internet, including people who are not signed in and search engines. Others may copy it into their own library; those copies are theirs to edit and are not linked back to yours. Unpublishing stops new readers but does not recall copies already made.</li>
        <li><strong>Classrooms and teams</strong> are run by their owner, who decides who to invite. Teachers can see progress on the classroom’s own material so they can help. They cannot see anyone’s personal library, and a member’s own collections stay entirely separate.</li>
        <li>Removing someone from a classroom ends their access from that moment. Material they created inside the classroom stays with the classroom.</li>
      </ul>
    </>,
  },
  {
    id: 'conduct', title: 'How to behave here', body: <>
      <p>{COMPANY.name} is a study tool. Please do not use it to:</p>
      <ul>
        <li>post unlawful material, harass anyone, or share content that sexualises minors;</li>
        <li>distribute exam material you are not permitted to share, or help anyone cheat in a supervised examination;</li>
        <li>upload malware, scrape the service at scale, probe or attack our infrastructure, or work around usage limits;</li>
        <li>impersonate another person, or send unwanted bulk invitations;</li>
        <li>resell access to {COMPANY.name} or pass off the service as your own.</li>
      </ul>
      <p>Accounts that do these things may be suspended or closed. Where the situation allows it, we will warn you first.</p>
    </>,
  },
  {
    id: 'moderation', title: 'Reporting content, and how we decide', body: <>
      <p>Anything published here can be reported. Open a public collection and use <strong>Report this collection</strong> at the foot of the page. You do not need an account to do it, and you can leave an email address if you want to be told what we decided.</p>
      <p>Tell us what is wrong and, if you can, which cards. A notice that says only “this is bad” is hard to act on; one that points at the specific problem usually gets sorted the same day.</p>
      <h3>What happens next</h3>
      <ul>
        <li><strong>A person reads it.</strong> We do not use automated filters to take material down, and nothing is removed because a report simply arrived.</li>
        <li><strong>If we agree, the collection is unpublished, not deleted.</strong> It stops being public and stays in its owner’s account. We would rather hide something wrongly for a day than destroy somebody’s work on one complaint.</li>
        <li><strong>The owner is told what was decided and why</strong>, in enough detail to put it right or to argue with us.</li>
        <li><strong>If we disagree with the report, the collection stays up</strong> and we say so.</li>
      </ul>
      <h3>If you think we got it wrong</h3>
      <p>Reply to the decision, or write to {COMPANY.email}, and a different person will look again. Say why you think the decision was wrong; we will answer in writing. Nothing here takes away your right to go to a court or an out-of-court dispute body in your own country instead.</p>
      <p>Reporting things in bad faith — to harass somebody, or to get a competitor taken down — is itself a breach of these terms, and we will suspend accounts that do it repeatedly.</p>
    </>,
  },
  {
    id: 'plans', title: 'Plans and payment', body: <>
      <p>Creating an account, building collections, studying with spaced repetition, publishing to the community, and tracking your own progress are all free, and we intend to keep them that way.</p>
      <p>Premium adds projects, card import and export, folder covers, hosting live quizzes, and inviting editors. Classrooms are billed per seat. Prices are shown in rupees in India and in US dollars elsewhere we sell, follow the country on your account, and include any taxes we are required to add. The current figures are on our <Link to="/pricing">pricing page</Link>.</p>
      <ul>
        <li><strong>Nothing renews automatically.</strong> Every plan is a single payment that buys a fixed period, and we do not store a mandate against your card or UPI ID. When the period ends, your account simply returns to the free tier and your content stays where it is.</li>
        <li>You pay online through our payment gateway with a card, UPI, net banking, or a wallet, and your plan unlocks as soon as the payment clears.</li>
        <li>Adding seats to a classroom part-way through a period is charged pro rata to the renewal date you already have, so topping up never shortens what you have paid for.</li>
        <li>If we change our prices, the change only affects purchases you make afterwards. A period you have already paid for is never repriced.</li>
      </ul>
    </>,
  },
  {
    id: 'cancellation', title: 'Your right to cancel', body: <>
      <p>If you are a consumer in the United Kingdom or the European Union, the law gives you <strong>{COMPANY.refundDays} days</strong> from the day you buy to cancel a contract made at a distance, without giving any reason. You do not have to have a fault to point at, and you do not have to explain yourself.</p>
      <p>Because Premium switches on the moment your payment clears, you are asking us to start straight away. In some places that would normally cost you the cancellation right. We have chosen not to rely on that: the {COMPANY.refundDays} days stand either way, and we apply them to everybody, in every country we sell in, not only where a law requires it.</p>
      <p>To cancel, write to {COMPANY.billing} from the address on your account, or use the wording below. You do not have to use this form — a plain email saying you have changed your mind is enough.</p>
      <blockquote>
        <p>To {COMPANY.legalName}, {COMPANY.city}, {COMPANY.country} — I give notice that I cancel my contract for the supply of the following service: [plan], ordered on [date], account [username]. [Your name, address, and the date.]</p>
      </blockquote>
      <p>We refund within 14 days of accepting the cancellation, to the method you paid with. The refund policy below is how we handle everything else, including situations the statutory right does not cover.</p>
    </>,
  },
  {
    id: 'refunds', title: 'Refund policy', body: <>
      <p>We would rather refund you than keep money you are not happy about. This section is the whole policy.</p>
      <h3>When you can get your money back</h3>
      <ul>
        <li><strong>Personal Premium plans:</strong> a full refund within <strong>{COMPANY.refundDays} days</strong> of payment, for any reason at all. You do not have to justify it.</li>
        <li><strong>Classroom and team plans:</strong> a full refund within <strong>{COMPANY.refundDays} days</strong>, as long as no more than two people besides the owner have taken a seat. Once a class is properly under way, we can only refund the seats nobody has claimed.</li>
        <li><strong>Extra seats</strong> bought part-way through a period stay refundable for {COMPANY.refundDays} days, while they are still unclaimed.</li>
        <li><strong>Something went wrong on our side:</strong> if a feature you paid for was unavailable for a meaningful stretch and we could not fix it, tell us and we will refund or extend your plan, whichever you prefer. This is not limited to {COMPANY.refundDays} days.</li>
        <li><strong>Paid twice, or paid by mistake:</strong> refunded in full whenever you notice, with no time limit.</li>
        <li><strong>Payment never confirmed:</strong> if a UPI transfer is rejected at review, or a gateway payment fails after the money left your account, you get it all back automatically. You do not need to ask.</li>
      </ul>
      <h3>When we cannot refund</h3>
      <ul>
        <li>After the window above has closed. Because nothing auto-renews, you will never be billed for a period you did not deliberately choose, so there is no surprise charge to undo.</li>
        <li>Part-way through a period you have used and are simply finished with. We do not pro-rate unused time.</li>
        <li>Accounts closed for breaking the rules in section 5.</li>
      </ul>
      <h3>How to ask</h3>
      <p>Email {COMPANY.billing} from the address on your account, with the order reference from Settings → Premium. We reply within two working days. Approved refunds go back to the method you paid with, within 5–7 working days at our end, and your bank or UPI provider may take a little longer to show it. Refunds for a UPI transfer are sent to the UPI ID the payment came from.</p>
      <p>Asking for a refund does not delete your account or your collections. You keep everything you made; only the paid features switch off.</p>
    </>,
  },
  {
    id: 'availability', title: 'Availability and changes', body: <>
      <p>We work to keep {COMPANY.name} running and quick, but we do not promise uninterrupted service. Maintenance, a failure at a hosting provider, or something we simply did not foresee can all cause downtime.</p>
      <p>The service will change over time. We add features, improve them, and occasionally retire ones that are not working out. If we remove something you rely on, or something you paid for, we will give you reasonable notice and a fair way out, which may include a refund under section 7.</p>
      <p>Please keep your own copy of anything you cannot afford to lose. Premium accounts can export a folder to JSON or CSV at any time.</p>
    </>,
  },
  {
    id: 'closing', title: 'Ending your account', body: <>
      <p>You may stop using {COMPANY.name} whenever you like. To delete your account, open Settings, confirm with your password, and it is erased straight away. If you would rather we did it, write to {COMPANY.privacy} from the address on the account and we will action it and confirm when it is done. Section 7 of our <Link to="/privacy">Privacy Policy</Link> explains exactly what is removed and when.</p>
      <p>We may suspend or close an account that breaks these terms, that we are legally required to close, or that has been dormant for a very long time. Except in serious cases we will contact you first and give you a chance to export your material.</p>
    </>,
  },
  {
    id: 'liability', title: 'Liability', body: <>
      <p>{COMPANY.name} is provided as it is. We do not warrant that it will be error-free, that it will suit a particular purpose, or that studying here guarantees any result in an exam or elsewhere.</p>
      <p>To the extent the law allows, we are not liable for indirect or consequential loss, lost profits, or lost data where you had a reasonable opportunity to keep your own copy. Where we are liable, our total liability is limited to the amount you paid us in the twelve months before the claim.</p>
      <p>None of this limits liability that cannot lawfully be limited, including for fraud or for death or personal injury caused by negligence. If you are a consumer, your statutory rights are unaffected.</p>
    </>,
  },
  {
    id: 'law', title: 'Governing law', body: <>
      <p>These terms are governed by the laws of {COMPANY.country}, and the courts of {COMPANY.city} have jurisdiction over any dispute. If you are a consumer elsewhere, you keep the protection of the mandatory laws of the country you live in.</p>
      <p>Before anything formal, please write to us. Almost everything is quicker to settle over email.</p>
    </>,
  },
  {
    id: 'accessibility', title: 'Accessibility', body: <>
      <p>We build this to be usable with a keyboard alone, to work with a screen reader, and to keep text readable at the contrast levels the WCAG 2.2 AA guidelines ask for. We test it, but we are a small team and we will not claim it is perfect.</p>
      <p>If something here is hard or impossible for you to use, write to {COMPANY.email} and tell us what stopped you. We treat that as a bug rather than a feature request, and we will tell you what we are doing about it.</p>
    </>,
  },
  {
    id: 'contact', title: 'How to reach us, and who we are', body: <>
      <p>{COMPANY.legalName}, {COMPANY.city}, {COMPANY.country}.</p>
      <ul>
        <li><strong>Anything at all:</strong> {COMPANY.email}</li>
        <li><strong>Payments, invoices, and refunds:</strong> {COMPANY.billing}</li>
        <li><strong>Data protection and privacy:</strong> {COMPANY.privacy}</li>
        <li><strong>Security reports:</strong> {COMPANY.security}</li>
      </ul>
      <p>That first address is also our single point of contact for regulators and for anyone giving formal notice about content, including under the EU Digital Services Act. We accept correspondence in English.</p>
      <p>A person reads these. We aim to reply within two working days.</p>
    </>,
  },
  {
    id: 'updates', title: 'Changes to these terms', body: <>
      <p>We will update this page when the service or the law changes, and the date at the top will always tell you when it last happened. If a change materially affects your rights, we will let you know in the app or by email before it takes effect.</p>
      <p>Carrying on using {COMPANY.name} after a change means you accept the revised terms. If you would rather not, you can close your account and, if you are inside a refund window, ask for your money back.</p>
    </>,
  },
];

const privacySections = [
  {
    id: 'summary', title: 'The short version', body: <>
      <div className="legal-callout">
        <p>We collect what {COMPANY.name} needs to work and nothing more. Your cards are yours, your private collections stay private, and nothing you write is ever used to target an advertisement. You can get a copy of everything or have it deleted by asking us.</p>
      </div>
      <p>The rest of this page is the detail behind that paragraph. If anything here is unclear, write to {COMPANY.privacy} and we will explain it properly.</p>
    </>,
  },
  {
    id: 'collect', title: 'What we collect', body: <>
      <h3>Things you give us</h3>
      <ul>
        <li><strong>Your account:</strong> name, username, email address, and a password that we store only as a bcrypt hash, never as text we could read. A profile picture and bio are optional.</li>
        <li><strong>Your content:</strong> the folders, cards, tags, hints, and images you create or upload. Images are converted to WebP and resized when you upload them.</li>
        <li><strong>Billing details:</strong> if you buy a plan, the name, email, and phone number you type at checkout, plus a record of the order. <strong>Card and UPI credentials never reach our servers</strong>; the payment gateway handles those directly.</li>
        <li><strong>Anything you write to us:</strong> support emails and the messages in them.</li>
      </ul>
      <h3>Things the service produces</h3>
      <ul>
        <li><strong>Study history:</strong> which cards you reviewed, how you rated them, and when. This is what the scheduling algorithm runs on; without it spaced repetition cannot work.</li>
        <li><strong>Technical logs:</strong> IP address, browser user-agent, and timestamps, kept briefly so we can find faults and spot abuse. Errors are recorded with a request identifier so we can trace a single failure without trawling through your content.</li>
      </ul>
    </>,
  },
  {
    id: 'never', title: 'What we do not do', body: <>
      <ul>
        <li>We do not sell, rent, or trade your personal data. There is no version of this where that changes quietly.</li>
        <li><strong>We never use your cards, your collections, or your study history to target advertising,</strong> and we never send any of it to an advertiser. What you are learning is not a signal we sell.</li>
        <li>We do not run analytics trackers, and we do not build a profile of you ourselves.</li>
        <li>We do not read your private collections. The narrow exceptions are when you ask support to look at something specific, and where the law genuinely compels us.</li>
      </ul>
    </>,
  },
  {
    id: 'why', title: 'Why we hold it', body: <>
      <p>Each thing we store has a job to do:</p>
      <ul>
        <li>to give you the service you signed up for: your account, your content, and your schedule;</li>
        <li>to take payment and keep the records that tax law requires us to keep;</li>
        <li>to keep the service secure, to investigate abuse, and to fix faults;</li>
        <li>to reply when you contact us;</li>
        <li>to send you the occasional message that actually matters, such as a security notice or a change to these policies. We do not send marketing email you did not ask for.</li>
      </ul>
    </>,
  },
  {
    id: 'location', title: 'How we work out your country', body: <>
      <p>When you first arrive we read the network address your request came from, work out which country it is likely to be in, and throw the address away. It is not written to our database and it is not in our logs.</p>
      <p>We use it for two things: filling in the country box when you sign up, so you are not scrolling a list of two hundred, and deciding whether this is a country where we show ads. You can change the country on your account at any time, and your choice always overrules our guess.</p>
      <p>It never decides what you are charged. The price you pay follows the country saved on your account, which only you can set.</p>
    </>,
  },
  {
    id: 'bases', title: 'What allows us to hold it', body: <>
      <p>Under the UK and EU data protection rules we have to be able to name the legal ground for each use, not merely a good intention. Ours are:</p>
      <ul>
        <li><strong>Performing our contract with you:</strong> your account, your collections, your study history, and anything you buy. Without these the service does not exist.</li>
        <li><strong>Legitimate interests:</strong> keeping the service secure, preventing abuse, fixing faults, and understanding in aggregate how it is used. We use the least personal data that answers the question, and you can object at any time.</li>
        <li><strong>Legal obligation:</strong> payment and tax records, which we have to keep whatever either of us would prefer.</li>
        <li><strong>Consent:</strong> only where we ask for it plainly, and you can withdraw it as easily as you gave it.</li>
      </ul>
      <p>We do not profile you, we do not make decisions about you by algorithm alone, and we do not use your content to train models.</p>
    </>,
  },
  {
    id: 'transfers', title: 'Where your data is, and when it crosses a border', body: <>
      <p>The service runs on hosting and database providers described in the section below, and their servers may be in a different country from you. Where data leaves the UK or the European Economic Area, it is covered by the transfer safeguards those providers publish — standard contractual clauses in practice.</p>
      <p>If you would like the detail for your own account, write to {COMPANY.privacy} and we will tell you exactly which providers hold what.</p>
    </>,
  },
  {
    id: 'ads', title: 'Advertising', body: <>
      <p>The free tier carries advertising in some countries. We would rather tell you exactly how it works than leave you to guess from a policy.</p>
      <h3>Where they appear, and where they never will</h3>
      <ul>
        <li>On the explore page, under a published collection, and on the screen you reach when a study session finishes.</li>
        <li><strong>Never inside a study session.</strong> No ad appears next to a card you are reading or a button you are rating with. That is partly to protect you from clicking one by accident, and mostly because interrupting the thing you came here to do would make the product worse.</li>
        <li>Never on a page about your account, your payments, or your progress.</li>
        <li><strong>Never for a Premium account.</strong> No ads, and no ad script loaded at all.</li>
      </ul>
      <h3>What the advertiser gets, and does not</h3>
      <ul>
        <li>Ads are served by Google AdSense. Where they appear, Google may set cookies and use your device's information and approximate location to choose them.</li>
        <li><strong>Your cards, collections, tags, notes and study history are never shared with anyone for advertising.</strong> They are not sent to Google, they do not influence which ad you see, and they never will. An advertiser cannot learn what you are studying.</li>
        <li>We do not pass your name, email address or account details to an advertiser.</li>
      </ul>
      <h3>Turning personalisation off</h3>
      <p>Use <strong>Your privacy choices</strong> in the footer of any page. From then on ads in that browser are chosen from the page's own content rather than from anything about you. We also honour the Global Privacy Control signal automatically, so if your browser sends one you are already opted out.</p>
      <p>And if you would rather see none at all, Premium removes them entirely — that is one of the things it is for.</p>
    </>,
  },
  {
    id: 'cookies', title: 'Cookies and local storage', body: <>
      <p>We use one cookie: a signed session cookie that keeps you logged in. Removing it logs you out, and nothing else depends on it.</p>
      <p>Your browser also stores a couple of preferences locally, such as light or dark mode and how wide you dragged the sidebar. These never leave your device and are not sent to us.</p>
      <p>There are no analytics cookies on {COMPANY.name}. On the free tier, in some countries, Google AdSense sets advertising cookies on the pages where ads appear — the section on advertising below says which pages, and how to turn the personalisation off. A Premium account is shown no ads, so no advertising cookie is ever set on it.</p>
    </>,
  },
  {
    id: 'processors', title: 'Who else touches your data', body: <>
      <p>We use a small number of suppliers to run the service. Each one receives only what it needs, and none of them may use your data for their own purposes:</p>
      <ul>
        <li><strong>Hosting and database providers:</strong> they store the application and its data.</li>
        <li><strong>Our payment gateway:</strong> it processes card and UPI payments and returns a confirmation. It handles your payment credentials so that we never have to.</li>
        <li><strong>Email delivery:</strong> for account and transactional messages.</li>
      </ul>
      <p>We will also disclose data where a valid legal order requires it, and we will tell you when we are permitted to.</p>
    </>,
  },
  {
    id: 'sharing', title: 'What other people can see', body: <>
      <p>Most visibility on {COMPANY.name} is a choice you make:</p>
      <ul>
        <li>Your username, display name, profile picture, and bio are visible to other signed-in users and on any collection you publish.</li>
        <li>A <strong>published</strong> collection is readable by anyone, signed in or not, and may be indexed by search engines.</li>
        <li>A <strong>shared</strong> collection is visible only to the people you named.</li>
        <li>In a <strong>classroom</strong>, the teacher can see your progress on the classroom’s own material. They cannot see your personal library, your other classrooms, or your email address.</li>
        <li>Your study history, review ratings, and daily goal are never shown to other users outside a classroom’s own material.</li>
      </ul>
    </>,
  },
  {
    id: 'retention', title: 'How long we keep it, and deleting it', body: <>
      <p>We keep your account and content for as long as your account is open.</p>
      <p>You can delete everything yourself from Settings. It asks for your password, then erases your account, your collections, your cards, your uploaded images, and your study history immediately. Backups roll off on their own within 30 days. If you own a classroom that other people are still in, hand it over or close it first so their work does not go with you.</p>
      <p>Two things outlive the deletion. Records of payments are kept for as long as Indian tax and accounting law requires, with your name, address, and phone number stripped out of them at the moment you delete. Security logs are kept briefly in a form that is not tied to your content.</p>
    </>,
  },
  {
    id: 'rights', title: 'Your rights', body: <>
      <p>Whatever country you are in, we will honour these:</p>
      <ul>
        <li><strong>See it:</strong> ask for a copy of the personal data we hold about you.</li>
        <li><strong>Take it:</strong> export your collections to JSON or CSV, or ask us for an export.</li>
        <li><strong>Fix it:</strong> correct anything inaccurate, most of it yourself in Settings.</li>
        <li><strong>Delete it:</strong> have your account and content removed, as described above.</li>
        <li><strong>Object:</strong> tell us to stop a particular use of your data.</li>
        <li><strong>Complain:</strong> raise it with your local data protection authority. We would appreciate the chance to put it right first.</li>
      </ul>
      <p>Write to {COMPANY.privacy}. We answer within 30 days and we do not charge for it.</p>
    </>,
  },
  {
    id: 'states', title: 'If you live in the United States', body: <>
      <p>Several states — California, Virginia, Colorado, Connecticut, Utah, Texas and others — give you specific rights over your personal information. We give the same rights to everyone, wherever they live, so there is no separate form to fill in.</p>
      <h3>The short version</h3>
      <ul>
        <li><strong>We do not sell your personal information for money,</strong> and we never have.</li>
        <li><strong>We do share it for advertising, in the sense California means.</strong> Where we show ads, Google AdSense may use cookies and your device's information to personalise them, and under the CCPA that counts as sharing for cross-context behavioural advertising even though no money changes hands and no data leaves us in bulk.</li>
        <li><strong>You can stop that in one click.</strong> Use <strong>Your privacy choices</strong> at the bottom of any page, and ads here stop being personalised for this browser. If your browser sends a Global Privacy Control signal we honour it before you ask.</li>
        <li><strong>Premium accounts see no ads at all,</strong> so none of this applies to them.</li>
        <li><strong>What we collect</strong> is your account details, the content you make, your study history, and — if you buy something — billing details and a record of the order. The section above sets this out in full.</li>
        <li><strong>You can see it, correct it, take it, or have it deleted.</strong> Most of it you can do yourself in Settings; for the rest, write to {COMPANY.privacy}.</li>
        <li><strong>We will not treat you differently for exercising any of this.</strong> No worse price, no reduced service.</li>
      </ul>
      <p>We answer within 45 days, and we will tell you if we need longer. If somebody acts on your behalf, we will ask for enough to be sure they are allowed to.</p>
    </>,
  },
  {
    id: 'children', title: 'Children and classrooms', body: <>
      <p>{COMPANY.name} is not intended for children under 13, or under the local age of digital consent where that is higher. We do not knowingly collect their data, and if we learn that we have, we delete it.</p>
      <p>A school or teacher setting up a classroom is responsible for having whatever consent local law requires before inviting students. We have deliberately limited what a teacher can see to the classroom’s own material, so joining a class never exposes a student’s personal library.</p>
    </>,
  },
  {
    id: 'security', title: 'How we protect it', body: <>
      <p>Passwords are hashed with bcrypt and cannot be recovered, only reset. Traffic runs over HTTPS. Session cookies are signed, HTTP-only, and cannot be read by scripts in the page. Access to production data is limited to the people who need it to operate the service.</p>
      <p>No system is perfectly secure, and we will not pretend otherwise. If a breach ever affects your data, we will tell you and the relevant authority promptly, explain what happened, and say what we are doing about it.</p>
      <p>If you have found a vulnerability, please report it to {COMPANY.security} rather than disclosing it publicly. We will work with you and we will not pursue good-faith research.</p>
    </>,
  },
  {
    id: 'changes', title: 'Changes to this policy', body: <>
      <p>When our practices change, this page changes with them and the date at the top moves. If a change is significant, we will tell you in the app or by email rather than hoping you notice.</p>
    </>,
  },
];

export function TermsPage() {
  return <LegalPage
    eyebrow="LEGAL"
    title="Terms of use"
    lede="The agreement between you and us, written to be read. Plain language, no traps, and a refund policy you can actually rely on."
    sections={termsSections}/>;
}

/**
 * The refund policy on a URL of its own.
 *
 * Built from the same section objects the terms are, rather than a second copy, because a refund
 * policy that quietly drifts out of step with the terms is worse than not having one. It exists
 * separately because a payment gateway, and the card networks behind it, expect a cancellation and
 * refund policy to be reachable as its own page — a fragment link part-way down a longer document
 * does not satisfy that, however complete the wording is.
 */
const refundSections = termsSections.filter(s => ['plans', 'cancellation', 'refunds'].includes(s.id));

export function RefundsPage() {
  return <LegalPage
    eyebrow="LEGAL"
    title="Cancellation and refunds"
    lede="What your money buys, what happens when a plan ends, and how to get it back if you are not happy."
    sections={refundSections}/>;
}

export function PrivacyPage() {
  return <LegalPage
    eyebrow="LEGAL"
    title="Privacy Policy"
    lede="What we collect, why we hold it, who else sees it, and how to get it all back or have it deleted."
    sections={privacySections}/>;
}

const CONTACT_CARDS = [
  { icon: Mail, title: 'General questions', text: `Anything about using ${COMPANY.name}, a feature you cannot find, or an idea you would like us to build.`, to: COMPANY.email },
  { icon: ReceiptIndianRupee, title: 'Billing and refunds', text: 'Plans, invoices, seats, and refund requests. Include the order reference from Settings → Premium.', to: COMPANY.billing },
  { icon: ShieldAlert, title: 'Privacy and security', text: 'Data requests, account deletion, and vulnerability reports. We will not pursue good-faith research.', to: COMPANY.privacy },
];

export function ContactPage() {
  return <article className="legal contact-page">
    <header className="legal-head">
      <span className="eyebrow">CONTACT</span>
      <h1>Talk to us</h1>
      <p className="legal-lede">There is no ticket maze here. Pick whichever address fits and a person will read it.</p>
      <p className="legal-updated"><Clock3 size={14}/> We reply within two working days, usually sooner</p>
    </header>
    <div className="contact-grid">
      {CONTACT_CARDS.map(({ icon: Icon, title, text, to }) => <a className="contact-card" href={`mailto:${to}`} key={to}>
        <span className="contact-card-icon"><Icon size={20}/></span>
        <h2>{title}</h2>
        <p>{text}</p>
        <span className="contact-card-mail">{to} <ArrowRight size={14}/></span>
      </a>)}
    </div>
    <div className="contact-columns">
      <section className="contact-panel">
        <h2><MessageCircleQuestion size={17}/> Try these first</h2>
        <p>A lot of questions already have an answer waiting, and you will get it faster than we can type one.</p>
        <ul className="contact-links">
          <li><Link to="/#faq">Frequently asked questions <ArrowRight size={14}/></Link></li>
          <li><Link to="/terms#refunds">Refund policy <ArrowRight size={14}/></Link></li>
          <li><Link to="/privacy#rights">Your data and your rights <ArrowRight size={14}/></Link></li>
        </ul>
      </section>
      <section className="contact-panel">
        <h2><MapPin size={17}/> Where we are</h2>
        <p className="contact-address">{COMPANY.legalName}<br/>{COMPANY.city}, {COMPANY.country}</p>
        <p>We work across several time zones, so an email at an odd hour is genuinely fine. We do not have a phone line, because writing it down gets you a better answer than we could give on the spot.</p>
      </section>
    </div>
    <footer className="legal-foot">
      <div><h3>Reporting something urgent?</h3><p>Security issues and suspected account compromise jump the queue. Send those to {COMPANY.security}.</p></div>
      <a className="button secondary" href={`mailto:${COMPANY.security}`}>Email security <ArrowRight size={15}/></a>
    </footer>
  </article>;
}
