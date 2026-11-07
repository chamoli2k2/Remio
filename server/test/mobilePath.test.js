import test from 'node:test';
import assert from 'node:assert/strict';
import { isSafePath } from '../../mobile/src/path.js';

test('the phone only sends requests to plain, expected paths', () => {
  for (const ok of ['/folders', '/folders/66a1b2c3d4e5f60718293a4b/cards', '/notes/search?q=a/b..c', '/users/some_name/follow', '/auth/me', '/folders/archived'])
    assert.equal(isSafePath(ok), true, ok);
  for (const bad of ['', 'folders', '/', '//evil.example/x', '/folders/../auth/logout', '/cards/./x', '/folders/a//b', '/folders/a b', '/folders/a\\b', '/folders/%2e%2e/x', '/folders/..', '/cards/x/../../folders/y', '/folders/a?x=1/../..'.replace('?x=1/../..', '/..'), null, 42])
    assert.equal(isSafePath(bad), false, String(bad));
});
