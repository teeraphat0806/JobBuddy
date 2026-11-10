/**
 * Postback `data` is a small query string, e.g. `a=menu&m=prefs` or `a=wiz&v=remote`.
 * LINE limits postback data to 300 characters.
 */
export type PostbackData = Record<string, string>;

export function encodePostback(data: PostbackData): string {
  const encoded = new URLSearchParams(data).toString();
  if (encoded.length > 300) throw new Error(`Postback data too long: ${encoded.length} chars`);
  return encoded;
}

export function decodePostback(raw: string): PostbackData {
  return Object.fromEntries(new URLSearchParams(raw));
}
