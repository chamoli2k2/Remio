/**
 * The invite programme, in one place so the server that pays it out and the pages that describe it
 * can never disagree. Rewards are Premium time, never cash, and the referrer's side is capped.
 */
export const REFERRAL = {
  /** Different calendar days the invited person must study on before anyone is rewarded. */
  activeDaysRequired: 7,
  /** Premium days the invited person gets once they have studied that long. */
  refereeRewardDays: 15,
  /** A code can be added to an existing account only this soon after it was made. */
  redeemWindowDays: 7,
  /** What the person who invited gets, by how many of their invitees have qualified. */
  milestones: [
    { qualified: 1, days: 7, label: 'Your first study partner' },
    { qualified: 3, days: 30, label: 'Three study partners' },
    { qualified: 5, days: 60, label: 'Five study partners' },
  ],
  codeMin: 4,
  codeMax: 20,
};
/** Rewards stop after the last milestone. */
export const REFERRAL_CAP = REFERRAL.milestones[REFERRAL.milestones.length - 1].qualified;
export const REFERRAL_MAX_DAYS = REFERRAL.milestones.reduce((sum, m) => sum + m.days, 0);
/** What `premiumPlan` holds on an account whose Premium came from an invite. */
export const REFERRAL_PLAN_ID = 'referral';
export const REFERRAL_PLAN_LABEL = 'Invite reward';

/** Letters and digits only, upper case, so "my-code" and "MYCODE" are the same code. */
export const normaliseCode = value => String(value ?? '').toUpperCase().replace(/[^A-Z0-9]/g, '');
export const referralLink = (origin, code) => `${String(origin).replace(/\/$/, '')}/signup?ref=${encodeURIComponent(code)}`;

/** Written about the goal, not the product: a message people would send a classmate anyway. */
export function inviteMessage({ code, link, brand, goal }) {
  const lead = goal || `I'm using ${brand} to remember what I study with flashcards and spaced repetition.`;
  return `${lead} Join with my code ${code} and study on ${REFERRAL.activeDaysRequired} days to get ${REFERRAL.refereeRewardDays} days of Premium free: ${link}`;
}
