import { test, expect } from '@playwright/test';
import { signUp, createFolder, createCard, PASSWORD, unique } from './helpers.js';
test('anonymous visitors see the homepage and can sign up through the UI', async ({ page }) => {
  await page.goto('/');
  await expect(page.getByRole('link', { name: /explore/i }).first()).toBeVisible();
  await page.goto('/signup');
  const username = unique('ui');
  await page.getByPlaceholder('Gaurav Prakash').fill('UI Person'); await page.locator('input[name=username]').fill(username);
  await page.locator('input[name=email]').fill(`${username}@example.test`); await page.locator('input[name=password]').fill(PASSWORD);
  // The e2e server skips checking the emailed code, but the form still asks for one in two steps.
  await page.getByRole('button', { name: 'Email me a code' }).click();
  await page.locator('input[name=emailCode]').fill('123456');
  await page.getByRole('button', { name: 'Create your account' }).click();
  await expect(page.getByRole('link', { name: 'My library' })).toBeVisible();
  await expect(page.getByText(`@${username}`)).toBeVisible();
});
test('create a Markdown + LaTeX + cloze card in the editor, see it rendered, then study it', async ({ page }) => {
  await signUp(page); const folder = await createFolder(page, 'Biology');
  await page.goto(`/folders/${folder.id}`);
  await page.getByRole('button', { name: 'Add card' }).click();
  const front = page.getByLabel('front text');
  await front.fill('The **{{c1::mitochondria}}** is the powerhouse of the cell. Energy: $E = mc^2$');
  await expect(page.getByText('cloze card · back optional')).toBeVisible();
  await page.getByRole('button', { name: 'Preview Markdown, math and cloze' }).first().click();
  const preview = page.locator('.editor-preview').first();
  await expect(preview.locator('mark.cloze-hidden')).toBeVisible(); // blanks in the preview
  await expect(preview.locator('.katex')).toBeVisible(); // KaTeX loaded lazily and rendered
  await page.getByRole('button', { name: 'Create flashcard' }).click();
  await expect(page.getByText('Flashcard created')).toBeVisible();
  const card = page.locator('.flashcard-item').first();
  await expect(card.locator('mark.cloze-hidden')).toBeVisible(); await expect(card.locator('.katex')).toBeVisible();
  await card.getByRole('button', { name: /^Flip card/ }).click();
  await expect(card.locator('mark.cloze:not(.cloze-hidden)')).toHaveText('mitochondria');
  // Study: reveal, rate, session summary. Ratings show FSRS interval previews.
  await page.goto(`/folders/${folder.id}/study?mode=all`);
  await expect(page.locator('.study-card-body mark.cloze-hidden')).toBeVisible();
  await page.getByRole('button', { name: 'Reveal answer' }).click();
  await expect(page.locator('.study-card-body mark.cloze:not(.cloze-hidden)')).toHaveText('mitochondria');
  const good = page.getByRole('button', { name: /^Good/ }); await expect(good).toContainText(/Next in/); await good.click();
  await expect(page.getByText(/That’s a good session/)).toBeVisible();
  await expect(page.getByText('1 card reviewed', { exact: false }).or(page.locator('.session-result strong').first())).toBeVisible();
});
test('cards can be imported from CSV with a dry-run preview and exported back', async ({ page }) => {
  await signUp(page); const folder = await createFolder(page, 'Capitals');
  await page.goto(`/folders/${folder.id}`);
  await page.getByRole('button', { name: 'More options' }).click(); await page.getByRole('menuitem', { name: 'Import cards' }).click();
  await page.locator('input[type=file]').setInputFiles({ name: 'capitals.csv', mimeType: 'text/csv', buffer: Buffer.from('front,back,tags\nCapital of France?,Paris,geo\nCapital of Peru?,Lima,geo\n') });
  await expect(page.locator('.import-summary')).toContainText('Found 2 cards');
  await page.getByRole('button', { name: /Import 2 cards/ }).click();
  await expect(page.locator('.flashcard-item')).toHaveCount(2);
  const csv = await page.request.get(`/api/folders/${folder.id}/export?format=csv`); expect(csv.status()).toBe(200); expect(await csv.text()).toContain('Capital of Peru?');
  const json = await (await page.request.get(`/api/folders/${folder.id}/export`)).json(); expect(json.cards).toHaveLength(2);
});
test('progress page shows FSRS retention analytics and the study heatmap after a review', async ({ page }) => {
  await signUp(page); const folder = await createFolder(page, 'Stats'); const card = await createCard(page, folder.id, 'Q', 'A');
  const review = await page.request.post('/api/reviews', { data: { cardId: card.id, rating: 'good', requestId: crypto.randomUUID(), version: 0 } });
  expect(review.status(), await review.text()).toBe(200);
  await page.goto('/progress');
  await expect(page.getByText(/RETENTION/i).first()).toBeVisible();
  await expect(page.locator('.heatmap')).toBeVisible();
  await expect(page.getByText('1-day streak.')).toBeVisible();
});
