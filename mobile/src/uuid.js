/**
 * A random v4 UUID, used as the request id on each review so the server can recognise a repeat.
 * It is an idempotency key, not a secret, so a plain random source is enough; the platform's
 * `crypto.randomUUID` is used when it exists.
 */
export function uuid() {
  const native = globalThis.crypto?.randomUUID;
  if (typeof native === 'function') return native.call(globalThis.crypto);
  const hex = n => Math.floor(Math.random() * 16 ** n).toString(16).padStart(n, '0');
  return `${hex(8)}-${hex(4)}-4${hex(3)}-${(8 + Math.floor(Math.random() * 4)).toString(16)}${hex(3)}-${hex(8)}${hex(4)}`;
}
