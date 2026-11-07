/**
 * Whether a request path is one the app could have meant.
 *
 * Several screens put what is in a link (`remio://card/…?folder=…`) into a request address. A link
 * someone else crafted could carry `../` or an encoded slash to steer a button the person presses
 * (a delete, say) at a different endpoint than the screen intends. Only plain segments of letters,
 * digits, `_`, `-`, `:` and `.` are allowed, never `.` or `..` alone and never an empty one. The
 * query string after `?` is left to the caller, which encodes its own values.
 */
export function isSafePath(path) {
  if (typeof path !== 'string' || path[0] !== '/') return false;
  const parts = path.split('?')[0].slice(1).split('/');
  if (parts[parts.length - 1] === '') parts.pop();
  return parts.length > 0 && parts.every(part => part !== '' && part !== '.' && part !== '..' && /^[\w:.-]+$/.test(part));
}
