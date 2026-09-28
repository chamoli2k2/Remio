import { expect } from '@playwright/test';
let counter = 0;
export const PASSWORD = 'E2e-password-2026!';
export const unique = prefix => `${prefix}${Date.now().toString(36)}${(counter++).toString(36)}`.toLowerCase().slice(0, 20);
/** Signs up through the API (fast) and leaves the session cookie in the context; returns the account. */
export async function signUp(page, name = 'Learner') {
  const username = unique('u');
  const res = await page.request.post('/api/auth/signup', { data: { username, name: `${name} ${username.slice(-3)}`, email: `${username}@example.test`, password: PASSWORD, country: 'India' } });
  expect(res.status(), await res.text()).toBe(201);
  return { username, name: `${name} ${username.slice(-3)}` };
}
export async function createFolder(page, title, visibility = 'private') {
  const res = await page.request.post('/api/folders', { data: { title, visibility } });
  expect(res.status(), await res.text()).toBe(201);
  return (await res.json()).folder;
}
export async function createCard(page, folderId, front, back = '', extra = {}) {
  const res = await page.request.post(`/api/folders/${folderId}/cards`, { data: { front: { text: front }, back: { text: back }, ...extra } });
  expect(res.status(), await res.text()).toBe(201);
  return (await res.json()).card;
}
export const share = (page, folderId, username, role = 'editor') => page.request.post(`/api/folders/${folderId}/members`, { data: { username, role } });
