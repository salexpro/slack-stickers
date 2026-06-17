const FIVE_MIN = 60 * 5;

function timingSafeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

export async function verifySlackSignature(
  signingSecret: string,
  timestamp: string | null,
  signature: string | null,
  rawBody: string,
  nowSec: number
): Promise<boolean> {
  if (!timestamp || !signature) return false;
  const ts = Number(timestamp);
  if (!Number.isFinite(ts) || Math.abs(nowSec - ts) > FIVE_MIN) return false;

  const key = await crypto.subtle.importKey(
    'raw', new TextEncoder().encode(signingSecret),
    { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']
  );
  const mac = await crypto.subtle.sign(
    'HMAC', key, new TextEncoder().encode(`v0:${timestamp}:${rawBody}`)
  );
  const hex = [...new Uint8Array(mac)].map((b) => b.toString(16).padStart(2, '0')).join('');
  return timingSafeEqual(`v0=${hex}`, signature);
}
