import { lookup as dnsLookup, type LookupAddress } from 'node:dns';
import http from 'node:http';
import https from 'node:https';
import { BlockList, isIP } from 'node:net';
import type { LookupFunction } from 'node:net';

/**
 * Fetch a user-supplied web page without letting the user point us at our own network
 * (SSRF): only http(s) on standard ports, and every resolved address must be public.
 * The check runs inside the socket's DNS lookup, so a DNS answer can't change between
 * "check" and "connect".
 */

const blocked = new BlockList();
for (const [net, prefix] of [
  ['0.0.0.0', 8],
  ['10.0.0.0', 8],
  ['100.64.0.0', 10],
  ['127.0.0.0', 8],
  ['169.254.0.0', 16],
  ['172.16.0.0', 12],
  ['192.0.0.0', 24],
  ['192.168.0.0', 16],
  ['198.18.0.0', 15],
  ['224.0.0.0', 3],
] as const) {
  blocked.addSubnet(net, prefix, 'ipv4');
}
for (const [net, prefix] of [
  ['::', 128],
  ['::1', 128],
  ['fc00::', 7],
  ['fe80::', 10],
  ['64:ff9b::', 96],
] as const) {
  blocked.addSubnet(net, prefix, 'ipv6');
}

export function isPublicAddress(address: string): boolean {
  const family = isIP(address);
  if (family === 4) return !blocked.check(address, 'ipv4');
  if (family === 6) {
    const mapped = /^::ffff:(\d+\.\d+\.\d+\.\d+)$/i.exec(address)?.[1];
    if (mapped) return isPublicAddress(mapped);
    return !blocked.check(address, 'ipv6');
  }
  return false;
}

export class BlockedUrlError extends Error {}

const safeLookup: LookupFunction = (hostname, options, callback) => {
  dnsLookup(hostname, { ...options, all: true }, (err, addresses: LookupAddress[]) => {
    if (err) return callback(err, '', 0);
    const bad = addresses.find((a) => !isPublicAddress(a.address));
    if (bad || addresses.length === 0) {
      return callback(new BlockedUrlError(`Refusing non-public address for ${hostname}`), '', 0);
    }
    if (options.all)
      return (callback as unknown as (e: null, a: LookupAddress[]) => void)(null, addresses);
    const first = addresses[0]!;
    callback(null, first.address, first.family);
  });
};

/** Throws BlockedUrlError for URLs we must never request. */
export function assertFetchable(url: URL): void {
  if (url.protocol !== 'http:' && url.protocol !== 'https:') {
    throw new BlockedUrlError(`Unsupported protocol ${url.protocol}`);
  }
  if (url.port && url.port !== '80' && url.port !== '443') {
    throw new BlockedUrlError(`Unsupported port ${url.port}`);
  }
  if (url.username || url.password) throw new BlockedUrlError('Credentials in URL');
  const host = url.hostname.replace(/^\[|\]$/g, '');
  if (isIP(host) && !isPublicAddress(host)) throw new BlockedUrlError('Non-public IP literal');
  if (host === 'localhost' || host.endsWith('.localhost') || host.endsWith('.internal')) {
    throw new BlockedUrlError('Local hostname');
  }
}

export interface FetchedPage {
  url: string;
  html: string;
}

export interface SafeFetchOptions {
  timeoutMs?: number;
  maxBytes?: number;
  maxRedirects?: number;
  userAgent: string;
}

function charsetOf(contentType: string | undefined, head: Buffer): string {
  const fromHeader = /charset=["']?([\w-]+)/i.exec(contentType ?? '')?.[1];
  if (fromHeader) return fromHeader.toLowerCase();
  const fromMeta = /<meta[^>]+charset=["']?([\w-]+)/i.exec(head.toString('latin1'))?.[1];
  return fromMeta?.toLowerCase() ?? 'utf-8';
}

function decode(body: Buffer, charset: string): string {
  const label = charset === 'tis-620' ? 'windows-874' : charset;
  try {
    return new TextDecoder(label).decode(body);
  } catch {
    return new TextDecoder('utf-8').decode(body);
  }
}

function requestOnce(
  url: URL,
  opts: Required<SafeFetchOptions>,
): Promise<{ status: number; location?: string; contentType?: string; body: Buffer }> {
  return new Promise((resolve, reject) => {
    const mod = url.protocol === 'https:' ? https : http;
    const req = mod.request(
      url,
      {
        method: 'GET',
        lookup: safeLookup,
        timeout: opts.timeoutMs,
        headers: {
          'user-agent': opts.userAgent,
          accept: 'text/html,application/xhtml+xml',
          'accept-language': 'th,en;q=0.8',
          'accept-encoding': 'identity',
        },
      },
      (res) => {
        const status = res.statusCode ?? 0;
        const contentType = res.headers['content-type'];
        if (status >= 300 && status < 400) {
          res.resume();
          return resolve({ status, location: res.headers.location, body: Buffer.alloc(0) });
        }
        if (status !== 200 || !/html/i.test(contentType ?? '')) {
          res.resume();
          return resolve({ status, contentType, body: Buffer.alloc(0) });
        }
        const chunks: Buffer[] = [];
        let size = 0;
        res.on('data', (chunk: Buffer) => {
          // Titles and meta tags live in <head>; we don't need the whole page.
          if (size >= opts.maxBytes) return;
          chunks.push(chunk);
          size += chunk.length;
          if (size >= opts.maxBytes) res.destroy();
        });
        const done = () => resolve({ status, contentType, body: Buffer.concat(chunks) });
        res.on('end', done);
        res.on('close', done);
        res.on('error', (e) => (size > 0 ? done() : reject(e)));
      },
    );
    req.on('timeout', () => req.destroy(new Error(`Timed out fetching ${url.host}`)));
    req.on('error', reject);
    req.end();
  });
}

/** GET an HTML page, following a few redirects, re-checking every hop. */
export async function safeFetchHtml(
  rawUrl: string,
  options: SafeFetchOptions,
): Promise<FetchedPage | null> {
  const opts: Required<SafeFetchOptions> = {
    timeoutMs: 8000,
    maxBytes: 512 * 1024,
    maxRedirects: 4,
    ...options,
  };
  let url = new URL(rawUrl);
  for (let hop = 0; hop <= opts.maxRedirects; hop++) {
    assertFetchable(url);
    const res = await requestOnce(url, opts);
    if (res.location && res.status >= 300 && res.status < 400) {
      url = new URL(res.location, url);
      continue;
    }
    if (res.status !== 200 || res.body.length === 0) return null;
    return { url: url.toString(), html: decode(res.body, charsetOf(res.contentType, res.body)) };
  }
  return null;
}
