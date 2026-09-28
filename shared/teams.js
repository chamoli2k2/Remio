const DAY = 86400000;

/**
 * A team is billed per seat, so the price is a function of how many people the owner is paying for
 * rather than a tier they have to grow into. A classroom and a study team are the same entity; the
 * kind only decides what the roles are called on screen.
 */
export const TEAM_KINDS = [
  { id: 'classroom', label: 'Classroom', blurb: 'A teacher and their students.' },
  { id: 'team', label: 'Team', blurb: 'A group studying the same material together.' },
];
export const TEAM_ROLES = ['owner', 'teacher', 'student'];
const ROLE_LABELS = {
  classroom: { owner: 'Teacher (owner)', teacher: 'Teacher', student: 'Student' },
  team: { owner: 'Owner', teacher: 'Manager', student: 'Member' },
};
export const roleLabel = (kind, role) => ROLE_LABELS[kind === 'team' ? 'team' : 'classroom'][role] || role;

export const SEATS = { min: 5, max: 500 };
/**
 * What a seat costs is not here, because it depends on where the owner paying for it is: see
 * seatPrice and teamPlanFor in shared/pricing.js. The functions below are handed a plan with the
 * right rate already on it, so the proration stays plain arithmetic.
 */
export const TEAM_PLANS = [
  { id: 'team-monthly', label: 'Monthly', days: 30, blurb: 'Pay for the seats you need, month to month.' },
  { id: 'team-yearly', label: 'Yearly', days: 365, blurb: 'Two months free compared with paying monthly.' },
];
export const TEAM_PLAN_IDS = TEAM_PLANS.map(p => p.id);
export const teamPlanById = id => TEAM_PLANS.find(p => p.id === id) || null;

/** Seats are clamped rather than rejected so a stray number can never produce a nonsense price. */
export const clampSeats = n => Math.min(SEATS.max, Math.max(SEATS.min, Math.floor(Number(n) || 0)));
export const teamPrice = (plan, seats) => (plan ? plan.perSeat * clampSeats(seats) : 0);

/**
 * Buying more seats part-way through a term should not restart the term or charge a full period for
 * the days that remain, so the extra seats are prorated against the time actually left.
 */
export function seatTopUpPrice(plan, extraSeats, expiresAt, now = Date.now()) {
  if (!plan || extraSeats <= 0) return 0;
  const full = plan.perSeat * Math.floor(extraSeats);
  if (!plan.days || !expiresAt) return full;
  const left = new Date(expiresAt).getTime() - now;
  if (left <= 0) return full;
  return Math.max(1, Math.round(full * Math.min(1, left / (plan.days * DAY))));
}

export const teamExpired = (team, now = Date.now()) => !!team?.expiresAt && new Date(team.expiresAt).getTime() <= now;
export const teamActive = (team, now = Date.now()) => !!team?.plan && !teamExpired(team, now);
export function teamDaysLeft(team, now = Date.now()) {
  if (!team?.expiresAt) return null;
  return Math.ceil((new Date(team.expiresAt).getTime() - now) / DAY);
}
/** Renewing extends an unexpired term instead of truncating it, matching how personal plans work. */
export function teamExpiryAfter(team, plan, now = Date.now()) {
  if (!plan || plan.days == null) return null;
  const current = team?.expiresAt ? new Date(team.expiresAt).getTime() : 0;
  return new Date(Math.max(now, current) + plan.days * DAY);
}

export const seatsLeft = team => Math.max(0, (team?.seats || 0) - (team?.memberCount || 0));
export const canAddMember = (team, now = Date.now()) => teamActive(team, now) && seatsLeft(team) > 0;

/** Only the owner bills and deletes; teachers run the roster and the assignments. */
export const canManageTeam = role => role === 'owner';
export const canManageRoster = role => role === 'owner' || role === 'teacher';
export const canSeeProgress = role => role === 'owner' || role === 'teacher';

/**
 * A seat unlocks the Premium toolkit inside the team's own folders, and nothing outside them, so a
 * student's personal library is unaffected by joining or leaving a class.
 */
export const seatEntitles = (team, membership, now = Date.now()) => !!membership && teamActive(team, now);
