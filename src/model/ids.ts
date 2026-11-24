const ALPHABET = '0123456789abcdefghijklmnopqrstuvwxyz';

/** Short random id (not cryptographic; collision-safe enough for one document). */
export function uid(prefix = ''): string {
  let s = prefix;
  const bytes = new Uint8Array(10);
  crypto.getRandomValues(bytes);
  for (const b of bytes) s += ALPHABET[b % 36];
  return s;
}
