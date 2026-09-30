import dns from 'node:dns/promises';
import https from 'node:https';
import net from 'node:net';
import { assert } from '../utils/errors.js';
import { BRAND } from '../../../shared/brand.js';

/**
 * Fetching a picture from an address somebody else chose.
 *
 * This is the only place in the app that makes an outbound request to a host a user named, and it
 * exists because an assistant cannot hand us bytes — a language model can see an image but cannot
 * reproduce it, so the only thing it can pass along is a link.
 *
 * That makes this the sharpest edge in the whole assistant feature. The URL may come from a
 * document the user did not write: a PDF can contain text instructing the model to fetch
 * `http://169.254.169.254/latest/meta-data/`, and a server that obliges will read its own cloud
 * credentials and store them as a flashcard image. Server-side request forgery is the name for it,
 * and the useful way to think about it is that this function is a proxy we are offering to the
 * internet, so every address it can be talked into reaching is an address the internet can reach.
 *
 * Four things hold it, and the third is the one that is usually missing:
 *
 *  1. HTTPS only. A plaintext fetch can have its bytes rewritten in transit, and we would then
 *     store and serve whatever the rewriter chose.
 *  2. The address is checked, not the name. A hostname tells us nothing; `localhost.attacker.com`
 *     resolves to 127.0.0.1 and looks entirely ordinary.
 *  3. The connection is pinned to the address that was checked. Resolving, validating, and then
 *     handing the *hostname* to the HTTP client means it resolves a second time — and a DNS server
 *     under someone else's control can answer differently the second time. This is DNS rebinding,
 *     and it defeats the careful validation in step 2 completely.
 *  4. Redirects are followed by hand, and each hop starts again at step 1. A perfectly innocent
 *     URL that redirects to an internal one is the same attack with an extra step.
 */

/** Said in the request, so anybody reading their own logs can see who called and why. */
const USER_AGENT = `${BRAND.name}/1.0 (+https://${BRAND.domain})`;
const TIMEOUT_MS = 5000;
const MAX_REDIRECTS = 2;
/**
 * The ceiling on what we will pull down for one image.
 *
 * This number and `AGENT_LIMITS.imagesPerCall` multiply together into the amplification factor
 * of the whole feature: how much traffic a one-kilobyte tool call can make this server pull in.
 * Three megabytes by six is eighteen, which is in the same range as an ordinary file upload and
 * comfortable on a small instance; it was five by eight until that product was written down.
 *
 * Generous for a real picture even so. A three megabyte JPEG is a large photograph, and it
 * leaves here as a few hundred kilobytes of WebP.
 */
export const MAX_FETCH_BYTES = 3 * 1024 * 1024;

/**
 * Ranges that are not somewhere on the public internet.
 *
 * `169.254.0.0/16` is the one with teeth: every major cloud, Render included, answers its instance
 * metadata on 169.254.169.254, without authentication, to anything that can make a local HTTP
 * request. The rest are here because a server that can be aimed at a private network is a way
 * through the firewall, and a fetch that reports "this one connected and that one did not" maps
 * the inside of it.
 */
const BLOCKED = [
  ['0.0.0.0', 8],         // "this host on this network"
  ['10.0.0.0', 8],        // RFC 1918 private
  ['100.64.0.0', 10],     // carrier-grade NAT
  ['127.0.0.0', 8],       // loopback
  ['169.254.0.0', 16],    // link-local, and the cloud metadata service
  ['172.16.0.0', 12],     // RFC 1918 private
  ['192.0.0.0', 24],      // IETF protocol assignments
  ['192.0.2.0', 24],      // documentation
  ['192.88.99.0', 24],    // 6to4 relay anycast
  ['192.168.0.0', 16],    // RFC 1918 private
  ['198.18.0.0', 15],     // benchmarking
  ['198.51.100.0', 24],   // documentation
  ['203.0.113.0', 24],    // documentation
  ['224.0.0.0', 4],       // multicast
  ['240.0.0.0', 4],       // reserved, including the broadcast address
];

const toInt = ip => ip.split('.').reduce((n, octet) => ((n << 8) + Number(octet)) >>> 0, 0);
const withinRange = (ip, [network, bits]) => {
  const mask = bits === 0 ? 0 : (0xffffffff << (32 - bits)) >>> 0;
  return (toInt(ip) & mask) === (toInt(network) & mask);
};

/** Whether an address is one we are willing to open a socket to. Exported because it is tested directly. */
export const isPublicAddress = ip => net.isIPv4(ip) && !BLOCKED.some(range => withinRange(ip, range));

/**
 * The URL, and the single address we will accept for it.
 *
 * IPv6 is refused outright rather than filtered, and that is a deliberate trade. Getting the v6
 * blocklist right means parsing compressed notation, unique-local and link-local prefixes, and —
 * the part that quietly breaks such checks — IPv4-mapped forms like `::ffff:127.0.0.1`, which are
 * loopback wearing a different hat. Resolving only A records means no v6 address is ever reached,
 * so none of that has to be correct. The cost is that an image host reachable *only* over IPv6
 * cannot be used, which is rare enough to be worth the smaller thing to get wrong.
 */
async function resolveOne(raw) {
  let url;
  try { url = new URL(raw); } catch { assert(false, 400, 'That is not a valid URL.'); }
  assert(url.protocol === 'https:', 400, 'Image URLs have to start with https.');
  // Credentials in the URL would be sent to the host, and are a sign the link was not meant for us.
  assert(!url.username && !url.password, 400, 'That URL carries credentials and will not be fetched.');
  assert(net.isIP(url.hostname) !== 6, 400, 'That address cannot be reached.');

  let addresses;
  try { addresses = await dns.lookup(url.hostname, { all: true, family: 4 }); }
  catch { assert(false, 400, 'That address could not be looked up.'); }
  assert(addresses.length, 400, 'That address could not be looked up.');

  /**
   * Every answer has to pass, not merely one of them.
   *
   * A host that resolves to a public address and a private one is either misconfigured or is
   * trying its luck, and picking whichever we happened to like would make the outcome depend on
   * DNS ordering. If any address is somewhere we will not go, the name is refused.
   */
  for (const { address } of addresses) {
    assert(isPublicAddress(address), 400, 'That address is not on the public internet, so it will not be fetched.');
  }
  return { url, ip: addresses[0].address };
}

/**
 * Hand the socket the address we already vetted, instead of the name.
 *
 * This closes the rebinding window. The TLS handshake still uses the hostname for SNI and for
 * certificate verification — which is what we want, because the certificate has to belong to the
 * host that was asked for, not to the address it resolved to.
 */
const pinTo = ip => (_hostname, options, callback) => (options?.all
  ? callback(null, [{ address: ip, family: 4 }])
  : callback(null, ip, 4));

/** One hop. Returns either the bytes or the next URL to start over with. */
function hop(url, ip) {
  return new Promise((resolve, reject) => {
    const request = https.request(url, {
      lookup: pinTo(ip),
      family: 4,
      // Nothing that would authenticate us, and nothing that reveals where the link came from.
      headers: { 'User-Agent': USER_AGENT, Accept: 'image/*', 'Accept-Encoding': 'identity' },
      timeout: TIMEOUT_MS,
    }, response => {
      const { statusCode, headers } = response;

      if ([301, 302, 303, 307, 308].includes(statusCode) && headers.location) {
        response.destroy();
        // Resolved against the current URL so a relative Location works, and returned rather than
        // followed so the caller can run the whole validation again.
        try { return resolve({ next: new URL(headers.location, url).toString() }); }
        catch { return reject(new Error('redirect location is not a URL')); }
      }
      if (statusCode !== 200) { response.destroy(); return reject(new Error(`the server answered ${statusCode}`)); }

      const type = String(headers['content-type'] || '').split(';')[0].trim().toLowerCase();
      if (!type.startsWith('image/')) { response.destroy(); return reject(new Error(`that URL is ${type || 'not an image'}`)); }
      // A declared length over the ceiling saves downloading it to find out. It is not trusted:
      // the running total below is what actually enforces the limit.
      if (Number(headers['content-length']) > MAX_FETCH_BYTES) { response.destroy(); return reject(new Error('that image is too large')); }

      const chunks = []; let total = 0;
      response.on('data', chunk => {
        total += chunk.length;
        if (total > MAX_FETCH_BYTES) { response.destroy(new Error('that image is too large')); return; }
        chunks.push(chunk);
      });
      response.on('end', () => resolve({ body: Buffer.concat(chunks) }));
      response.on('error', reject);
    });

    // `timeout` only arms the socket; without this the request waits on a host that accepted the
    // connection and then said nothing, which is the cheapest way to tie up a worker.
    request.on('timeout', () => request.destroy(new Error('that server did not respond in time')));
    request.on('error', reject);
    request.end();
  });
}

/**
 * Fetch an image, or explain why not.
 *
 * Every failure is reported as a 400 with a message the calling model can act on, because the
 * caller is usually an assistant that will try a different URL. None of them say anything about
 * our network: "that address is not on the public internet" is as much as a probe ever learns,
 * whether it aimed at a private range, a name that does not resolve, or a host that refused.
 */
export async function fetchImage(raw) {
  let target = String(raw || '');
  for (let redirects = 0; redirects <= MAX_REDIRECTS; redirects += 1) {
    const { url, ip } = await resolveOne(target);
    let result;
    try { result = await hop(url, ip); }
    catch (error) { assert(false, 400, `That image could not be fetched — ${error.message}.`); }
    if (result.body) {
      assert(result.body.length, 400, 'That URL returned an empty file.');
      return { body: result.body, url: url.toString() };
    }
    target = result.next;
  }
  assert(false, 400, 'That URL redirects too many times.');
  return null;
}
