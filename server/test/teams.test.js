import test from 'node:test';
import assert from 'node:assert/strict';
import {
  SEATS, TEAM_PLANS, teamPlanById, teamPrice, clampSeats, seatTopUpPrice,
  teamActive, teamExpired, teamDaysLeft, teamExpiryAfter, seatsLeft, canAddMember,
  canManageTeam, canManageRoster, canSeeProgress, roleLabel, seatEntitles,
} from '../../shared/teams.js';
import { defaultPricebook } from '../../shared/pricing.js';

const DAY = 86400000;
// A plan only carries a seat rate once it knows who is buying, so these are priced as an Indian
// buyer would see them. The arithmetic under test is the same whatever the rate happens to be.
const buyer = { country: 'India' };
const priced = id => defaultPricebook.teamPlanFor(teamPlanById(id), buyer);
const monthly = priced('team-monthly'), yearly = priced('team-yearly');

test('seat pricing scales with the roster and clamps nonsense inputs', () => {
  assert.equal(teamPrice(monthly, 10), monthly.perSeat * 10);
  assert.equal(teamPrice(yearly, 30), yearly.perSeat * 30);
  assert.equal(clampSeats(0), SEATS.min, 'below the minimum is raised, not rejected');
  assert.equal(clampSeats(99999), SEATS.max);
  assert.equal(clampSeats('12'), 12);
  assert.equal(clampSeats(NaN), SEATS.min);
  assert.equal(teamPrice(null, 10), 0, 'an unknown plan costs nothing rather than throwing');
  // A year should be cheaper per month than paying monthly, or the yearly plan is pointless.
  assert.ok(yearly.perSeat < monthly.perSeat * 12, `yearly ${yearly.perSeat} vs monthly*12 ${monthly.perSeat * 12}`);
});

test('extra seats bought part-way through a term are prorated against the days left', () => {
  const now = Date.now();
  const half = new Date(now + 15 * DAY); // halfway through a 30-day term
  assert.equal(seatTopUpPrice(monthly, 10, half, now), Math.round(monthly.perSeat * 10 * 0.5));
  const nearlyOver = new Date(now + 1 * DAY);
  assert.ok(seatTopUpPrice(monthly, 10, nearlyOver, now) < monthly.perSeat, 'a day left costs a sliver of a seat');
  assert.equal(seatTopUpPrice(monthly, 10, new Date(now - DAY), now), monthly.perSeat * 10, 'an expired term charges in full');
  assert.equal(seatTopUpPrice(monthly, 10, null, now), monthly.perSeat * 10, 'no end date means no discount to apply');
  assert.equal(seatTopUpPrice(monthly, 0, half, now), 0);
  assert.equal(seatTopUpPrice(monthly, 5, new Date(now + 40 * DAY), now), monthly.perSeat * 5, 'more time left than a term never costs more than full price');
  assert.ok(seatTopUpPrice(monthly, 1, new Date(now + 60_000), now) >= 1, 'a top-up is never free');
});

test('a team is only active while it has a plan and an open window', () => {
  const now = Date.now();
  assert.equal(teamActive({ plan: 'team-monthly', expiresAt: new Date(now + DAY) }, now), true);
  assert.equal(teamActive({ plan: '', expiresAt: new Date(now + DAY) }, now), false, 'a team with no plan was never paid for');
  assert.equal(teamActive({ plan: 'team-monthly', expiresAt: new Date(now - DAY) }, now), false);
  assert.equal(teamExpired({ plan: 'team-monthly', expiresAt: null }, now), false, 'no end date never lapses');
  assert.equal(teamDaysLeft({ expiresAt: new Date(now + 2.2 * DAY) }, now), 3, 'part days round up');
  assert.equal(teamDaysLeft({ expiresAt: null }), null);
});

test('renewing extends an unexpired term instead of truncating it', () => {
  const now = Date.now();
  const running = { expiresAt: new Date(now + 200 * DAY) };
  assert.equal(teamExpiryAfter(running, monthly, now).getTime(), now + 230 * DAY);
  const lapsed = { expiresAt: new Date(now - 10 * DAY) };
  assert.equal(teamExpiryAfter(lapsed, monthly, now).getTime(), now + 30 * DAY, 'a lapsed team restarts from today');
  assert.equal(teamExpiryAfter({}, null, now), null);
});

test('seats left gates joining, and a lapsed team cannot take anyone new', () => {
  const now = Date.now();
  const paid = { plan: 'team-monthly', expiresAt: new Date(now + DAY), seats: 10, memberCount: 9 };
  assert.equal(seatsLeft(paid), 1);
  assert.equal(canAddMember(paid, now), true);
  assert.equal(canAddMember({ ...paid, memberCount: 10 }, now), false, 'a full team is closed');
  assert.equal(seatsLeft({ ...paid, memberCount: 12 }), 0, 'an oversold count never reports negative room');
  assert.equal(canAddMember({ ...paid, expiresAt: new Date(now - DAY) }, now), false, 'an unpaid team is closed too');
});

test('a seat unlocks Premium inside the team and nothing outside it', () => {
  const now = Date.now();
  const paid = { plan: 'team-monthly', expiresAt: new Date(now + DAY) };
  const student = { role: 'student' };
  assert.equal(seatEntitles(paid, student, now), true);
  assert.equal(seatEntitles(paid, null, now), false, 'a stranger to the roster gets nothing');
  assert.equal(seatEntitles({ ...paid, expiresAt: new Date(now - DAY) }, student, now), false, 'the lapse closes the toolkit');
  assert.equal(seatEntitles({ plan: '', expiresAt: null }, student, now), false);
});

test('roles: the owner bills, teachers run the room, students only study', () => {
  assert.deepEqual(['owner', 'teacher', 'student'].map(canManageTeam), [true, false, false]);
  assert.deepEqual(['owner', 'teacher', 'student'].map(canManageRoster), [true, true, false]);
  assert.deepEqual(['owner', 'teacher', 'student'].map(canSeeProgress), [true, true, false]);
  assert.equal(roleLabel('classroom', 'student'), 'Student');
  assert.equal(roleLabel('team', 'student'), 'Member', 'the same role reads differently in a study team');
  assert.equal(roleLabel('team', 'teacher'), 'Manager');
  assert.equal(roleLabel('classroom', 'nonsense'), 'nonsense', 'an unknown role falls back to itself');
});

test('every team plan is priceable and labelled', () => {
  for (const plan of TEAM_PLANS) {
    assert.ok(plan.days > 0, `${plan.id} needs a term`);
    assert.ok(priced(plan.id).perSeat > 0, `${plan.id} needs a seat price in every region we sell in`);
    assert.ok(plan.label && plan.blurb, `${plan.id} needs copy`);
    assert.equal(teamPlanById(plan.id), plan);
  }
  assert.equal(teamPlanById('nope'), null);
});
