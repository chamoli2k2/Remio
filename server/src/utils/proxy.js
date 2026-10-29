import net from 'node:net';

/**
 * Which address a request came from, depending on what sits in front of the app.
 *
 * Rate limits, login throttling and the country lookup all key on `req.ip`, so getting this wrong
 * is not cosmetic: answering with a proxy's address puts every visitor behind that proxy into one
 * bucket, and one busy classroom then locks everybody else out of signing in.
 *
 *   TRUST_PROXY unset or 0   nothing in front; the socket's address is the visitor's.
 *   TRUST_PROXY=1 (2, 3)     that many reverse proxies, each appending to X-Forwarded-For.
 *   TRUST_PROXY=cloudflare   the domain is proxied by our own Cloudflare zone, in front of the
 *                            host's proxy. The visitor is in CF-Connecting-IP.
 *
 * CF-Connecting-IP is a request header like any other, so it is believed only when the hop that
 * reached the host's proxy is a Cloudflare address. Someone calling the host directly with a forged
 * header is not one, and is counted by their own address.
 */

// https://www.cloudflare.com/ips/ — stable for years, but worth re-checking now and then.
const CLOUDFLARE_RANGES = [
  '173.245.48.0/20', '103.21.244.0/22', '103.22.200.0/22', '103.31.4.0/22', '141.101.64.0/18',
  '108.162.192.0/18', '190.93.240.0/20', '188.114.96.0/20', '197.234.240.0/22', '198.41.128.0/17',
  '162.158.0.0/15', '104.16.0.0/13', '104.24.0.0/14', '172.64.0.0/13', '131.0.72.0/22',
  '2400:cb00::/32', '2606:4700::/32', '2803:f800::/32', '2405:b500::/32', '2405:8100::/32',
  '2a06:98c0::/29', '2c0f:f248::/32',
];
const cloudflare = new net.BlockList();
for (const range of CLOUDFLARE_RANGES) {
  const [address, bits] = range.split('/');
  cloudflare.addSubnet(address, Number(bits), net.isIPv6(address) ? 'ipv6' : 'ipv4');
}

/** `::ffff:1.2.3.4` is how a dual-stack socket reports an IPv4 peer. */
const plain = ip => (ip?.startsWith('::ffff:') && net.isIPv4(ip.slice(7)) ? ip.slice(7) : ip || '');

export function isCloudflare(ip) {
  const address = plain(ip), family = net.isIP(address);
  return !!family && cloudflare.check(address, family === 6 ? 'ipv6' : 'ipv4');
}

/** Parses TRUST_PROXY. Throws on anything else, because guessing here silently breaks every limit. */
export function proxyMode(value = process.env.TRUST_PROXY) {
  const raw = String(value ?? '').trim().toLowerCase();
  if (!raw || raw === '0' || raw === 'false') return { hops: 0, cloudflare: false };
  if (raw === 'cloudflare') return { hops: 1, cloudflare: true };
  if (/^[1-3]$/.test(raw)) return { hops: Number(raw), cloudflare: false };
  throw new Error(`TRUST_PROXY must be 0, 1, 2, 3 or "cloudflare", not "${value}".`);
}

export function configureProxy(app, value = process.env.TRUST_PROXY) {
  const mode = proxyMode(value);
  if (!mode.hops) return mode;
  app.set('trust proxy', mode.hops);
  if (!mode.cloudflare) return mode;
  const forwarded = Object.getOwnPropertyDescriptor(Object.getPrototypeOf(app.request), 'ip').get;
  Object.defineProperty(app.request, 'ip', {
    configurable: true,
    enumerable: true,
    get() {
      const upstream = forwarded.call(this);
      const claimed = plain(String(this.get('cf-connecting-ip') || '').trim());
      return claimed && net.isIP(claimed) && isCloudflare(upstream) ? claimed : upstream;
    },
  });
  return mode;
}
