import { planById } from './account.js';
import { teamPlanById } from './teams.js';

export const NOTIFICATION_TYPES = ['follow', 'connect.request', 'connect.accepted', 'premium.requested', 'premium.approved', 'premium.declined', 'team.joined', 'team.removed', 'team.assignment', 'team.seats', 'referral.joined', 'referral.qualified', 'referral.reward'];

const who = n => n.actor?.name || n.actor?.username || 'Someone';
const planLabel = n => planById(n.data?.plan)?.label || teamPlanById(n.data?.plan)?.label || 'Premium';
const day = value => new Date(value).toLocaleDateString();

/** Single source of truth for how a stored notification reads in the UI. */
export function describeNotification(n) {
  switch (n.type) {
    case 'follow':
      return { icon: 'follow', title: `${who(n)} followed you`, body: 'Take a look at their public folders.', href: n.actor ? `/u/${n.actor.username}` : '/friends' };
    case 'connect.request':
      return { icon: 'connect', title: `${who(n)} wants to connect`, body: 'Accept to become friends.', href: '/friends' };
    case 'connect.accepted':
      return { icon: 'friends', title: `${who(n)} accepted your request`, body: 'You are friends now.', href: '/friends' };
    case 'premium.requested':
      return { icon: 'premium', title: `${who(n)} requested ${planLabel(n)}`, body: 'Review the payment screenshot in the dashboard.', href: '/dashboard' };
    case 'premium.approved':
      return { icon: 'premium', title: `Your ${planLabel(n)} plan is active`, body: n.data?.expiresAt ? `Renews or ends on ${new Date(n.data.expiresAt).toLocaleDateString()}.` : 'It never expires.', href: '/premium' };
    case 'premium.declined':
      return { icon: 'declined', title: 'Premium request declined', body: 'Get in touch if you think this is a mistake.', href: '/premium' };
    case 'team.joined':
      return { icon: 'team', title: `${who(n)} joined ${n.data?.teamName || 'your team'}`, body: `They came in as a ${n.data?.role || 'member'}.`, href: n.data?.teamId ? `/teams/${n.data.teamId}` : '/teams' };
    case 'team.removed':
      return { icon: 'declined', title: `You were removed from ${n.data?.teamName || 'a team'}`, body: 'Your own folders and study history are untouched.', href: '/teams' };
    case 'team.assignment':
      return { icon: 'assignment', title: `New assignment: ${n.data?.title || 'study set'}`, body: n.data?.dueAt ? `Due ${day(n.data.dueAt)} in ${n.data?.teamName || 'your team'}.` : `Set in ${n.data?.teamName || 'your team'}.`, href: n.data?.folderId ? `/folders/${n.data.folderId}` : '/teams' };
    case 'team.seats':
      return { icon: 'team', title: `${n.data?.seats || ''} seats are ready`.trim(), body: n.data?.expiresAt ? `Your team plan runs to ${day(n.data.expiresAt)}.` : 'Invite people from the team page.', href: '/teams' };
    case 'referral.joined':
      return { icon: 'friends', title: `${who(n)} joined with your invite`, body: 'You are both rewarded once they have studied on 7 different days.', href: '/invite' };
    case 'referral.qualified':
      return { icon: 'premium', title: `${who(n)} stuck with it`, body: n.data?.days ? `You earned ${n.data.days} days of Premium. ${n.data?.qualified || ''} study partner${n.data?.qualified === 1 ? '' : 's'} so far.`.replace('  ', ' ') : 'Your invite reward limit has been reached, but they are doing great.', href: '/invite' };
    case 'referral.reward':
      return { icon: 'premium', title: `You earned ${n.data?.days || ''} days of Premium`.replace('  ', ' '), body: 'Thank you for studying on 7 different days. Enjoy it.', href: '/premium' };
    default:
      return { icon: 'bell', title: 'Something happened', body: '', href: '/' };
  }
}
