import sharp from 'sharp';

const WIDTH = 150;

export async function convertStatic(input: Buffer | Uint8Array): Promise<Buffer> {
  return await sharp(input).resize({ width: WIDTH }).png().toBuffer();
}
