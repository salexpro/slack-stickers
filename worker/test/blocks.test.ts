import { describe, it, expect } from 'vitest';
import { buildPickerBlocks, buildPostedBlocks } from '../src/lib/blocks';
import type { StickerRecord } from '../src/types';

const sticker = (id: string): StickerRecord => ({
  file_unique_id: id, ext: 'png', animated: 0,
  r2_key: `stickers/${id}.png`, public_url: `https://img/${id}.png`, created_at: 0,
});

describe('buildPickerBlocks', () => {
  it('renders an image + Select/Remove per sticker and nav row', () => {
    const blocks = buildPickerBlocks([sticker('A'), sticker('B')], { page: 0, hasPrev: false, hasNext: true });
    const json = JSON.stringify(blocks);
    expect(json).toContain('https://img/A.png');
    expect(json).toContain('select'); // select action_id
    expect(json).toContain('remove');
    expect(json).toContain('next');   // next button present
    expect(json).not.toContain('"action_id":"prev"'); // no prev on page 0
    expect(json).toContain('cancel');
  });

  it('encodes page into prev/next button values', () => {
    const blocks = buildPickerBlocks([sticker('A')], { page: 2, hasPrev: true, hasNext: true });
    const json = JSON.stringify(blocks);
    expect(json).toContain('"value":"1"'); // prev → page-1
    expect(json).toContain('"value":"3"'); // next → page+1
  });
});

describe('buildPostedBlocks', () => {
  it('renders a public image block crediting the poster', () => {
    const blocks = buildPostedBlocks('https://img/A.png', 'U123');
    const json = JSON.stringify(blocks);
    expect(json).toContain('https://img/A.png');
    expect(json).toContain('<@U123>');
  });
});
