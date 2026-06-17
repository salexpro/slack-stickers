export interface ConvertResult {
  bytes: ArrayBuffer;
  ext: 'png' | 'gif';
}

// Sends raw sticker bytes to the converter service; returns converted image bytes.
// Throws on non-2xx so the caller can report failure to the user.
export async function convert(
  converterUrl: string,
  kind: 'static' | 'animated',
  input: ArrayBuffer
): Promise<ConvertResult> {
  const res = await fetch(`${converterUrl.replace(/\/$/, '')}/convert`, {
    method: 'POST',
    headers: { 'content-type': 'application/octet-stream', 'x-sticker-kind': kind },
    body: input,
  });
  if (!res.ok) throw new Error(`converter failed: ${res.status}`);
  const contentType = res.headers.get('content-type') ?? '';
  const ext = contentType.includes('gif') ? 'gif' : 'png';
  return { bytes: await res.arrayBuffer(), ext };
}
