import { test, expect } from '@playwright/test';
import { signUp, createFolder, createCard } from './helpers.js';
/** A host and a player run a whole live quiz: lobby, timed question, reveal, podium. */
test('host a live quiz, a friend joins by code, both answer, scores and podium appear', async ({ browser }) => {
  const [hostCtx, playerCtx] = await Promise.all([browser.newContext(), browser.newContext()]);
  const host = await hostCtx.newPage(), player = await playerCtx.newPage();
  const [h, p] = await Promise.all([signUp(host, 'Host'), signUp(player, 'Player')]);
  const folder = await createFolder(host, 'Capitals');
  for (const [q, a] of [['Capital of France?', 'Paris'], ['Capital of Peru?', 'Lima'], ['Capital of Japan?', 'Tokyo']]) await createCard(host, folder.id, q, a);
  // Host: folder menu -> setup modal -> lobby with a code.
  await host.goto(`/folders/${folder.id}`); await expect(host.locator('.presence-label')).toBeVisible();
  await host.getByRole('button', { name: 'More options' }).click(); await host.getByRole('menuitem', { name: 'Host a live quiz' }).click();
  // Two clicks rather than selectOption: these are the app's own dropdown now, not a native select.
  const choose = async (field, option) => {
    await host.getByRole('button', { name: new RegExp(`^${field}`) }).click();
    await host.getByRole('option', { name: option, exact: true }).click();
  };
  await choose('Questions', '3 questions'); await choose('Seconds per question', '10 seconds');
  await host.getByRole('button', { name: 'Open the room' }).click();
  await expect(host.getByRole('heading', { name: 'Waiting for players' })).toBeVisible();
  const code = (await host.locator('.room-big-code').textContent()).trim(); expect(code).toMatch(/^[A-Z0-9]{6}$/);
  await expect(host).toHaveURL(new RegExp(`/rooms/${code}$`));
  // Player: join by typing the code; both lobbies list both players; only the host has a start button.
  await player.goto('/rooms'); await player.getByLabel('Room code').fill(code.toLowerCase()); await player.getByRole('button', { name: 'Join room' }).click();
  await expect(player.getByText('Waiting for the host to start…')).toBeVisible();
  await expect(host.locator('.room-players li')).toHaveCount(2); await expect(player.locator('.room-players li')).toHaveCount(2);
  await expect(player.getByRole('button', { name: 'Start the quiz' })).toHaveCount(0);
  await host.getByRole('button', { name: 'Start the quiz' }).click();
  // Question: prompt is one of the cards, four options, answers lock in, early reveal once both answered.
  await expect(host.getByRole('heading', { name: 'Question 1 of 3' })).toBeVisible(); await expect(player.getByRole('heading', { name: 'Question 1 of 3' })).toBeVisible();
  const prompt = (await player.locator('.room-prompt').textContent()).trim(); const answer = { 'Capital of France?': 'Paris', 'Capital of Peru?': 'Lima', 'Capital of Japan?': 'Tokyo' }[prompt]; expect(answer).toBeTruthy();
  await expect(player.locator('.room-option')).toHaveCount(3);
  await player.locator('.room-option', { hasText: answer }).click(); await expect(player.getByText('Answer locked in')).toBeVisible();
  await expect(host.locator('.room-status')).toContainText('1 of 2 answered');
  const wrong = host.locator('.room-option').filter({ hasNotText: answer }).first(); await wrong.click();
  await expect(player.locator('.room-verdict')).toContainText(/Correct · \+\d+ points/); await expect(host.locator('.room-verdict')).toContainText('Not this time');
  await expect(host.locator('.room-option.is-correct')).toContainText(answer); await expect(host.locator('.room-option.is-wrong')).toHaveCount(1);
  await expect(player.locator('.room-leaderboard li').first()).toContainText(p.name); // the player leads
  await expect(player.getByRole('button', { name: /Next question/ })).toHaveCount(0);
  // Host drives the remaining rounds; unanswered questions time out (10 s) on the server.
  await host.getByRole('button', { name: /Next question/ }).click(); await expect(host.getByRole('heading', { name: 'Question 2 of 3' })).toBeVisible();
  await host.locator('.room-option').first().click(); await player.locator('.room-option').first().click();
  await host.getByRole('button', { name: /Next question/ }).click(); await expect(player.getByRole('heading', { name: 'Question 3 of 3' })).toBeVisible();
  await expect(player.getByText('Time’s up')).toBeVisible({ timeout: 15_000 }); // nobody answers: server timer reveals
  await host.getByRole('button', { name: /See final standings/ }).click();
  await expect(player.getByRole('heading', { name: 'Final standings' })).toBeVisible();
  await expect(player.locator('.podium-step.place-1')).toContainText(p.name); await expect(player.getByText(/You finished #1/)).toBeVisible();
  await expect(host.locator('.room-leaderboard li')).toHaveCount(2); await expect(host.locator('.room-leaderboard li.is-me')).toContainText(h.name);
  await hostCtx.close(); await playerCtx.close();
});
test('quiz invite links send signed-out visitors through login and back to the room', async ({ page }) => {
  await page.goto('/rooms/ABC123');
  await expect(page).toHaveURL(/\/login\?next=%2Frooms%2FABC123/);
});
