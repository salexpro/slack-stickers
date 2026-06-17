import type { StickerRecord } from '../types';

interface NavState {
  page: number;
  hasPrev: boolean;
  hasNext: boolean;
}

// Action IDs are stable contract strings consumed by slackInteract.ts.
export const ACTION = {
  select: 'select',
  remove: 'remove',
  prev: 'prev',
  next: 'next',
  cancel: 'cancel',
} as const;

export function buildPickerBlocks(stickers: StickerRecord[], nav: NavState): unknown[] {
  const blocks: unknown[] = [
    { type: 'section', text: { type: 'mrkdwn', text: '*Select a sticker*' } },
  ];

  for (const s of stickers) {
    blocks.push({ type: 'image', image_url: s.public_url, alt_text: 'sticker' });
    blocks.push({
      type: 'actions',
      elements: [
        {
          type: 'button',
          text: { type: 'plain_text', text: 'Select' },
          action_id: ACTION.select,
          value: s.file_unique_id,
        },
        {
          type: 'button',
          text: { type: 'plain_text', text: 'Remove' },
          style: 'danger',
          action_id: ACTION.remove,
          // value packs sticker id + current page so re-render returns to the same page
          value: `${s.file_unique_id}:${nav.page}`,
        },
      ],
    });
  }

  const navElements: unknown[] = [];
  if (nav.hasPrev) {
    navElements.push({
      type: 'button', text: { type: 'plain_text', text: 'Prev' },
      action_id: ACTION.prev, value: String(nav.page - 1),
    });
  }
  if (nav.hasNext) {
    navElements.push({
      type: 'button', text: { type: 'plain_text', text: 'Next' },
      action_id: ACTION.next, value: String(nav.page + 1),
    });
  }
  navElements.push({
    type: 'button', text: { type: 'plain_text', text: 'Cancel' },
    style: 'danger', action_id: ACTION.cancel, value: 'cancel',
  });
  blocks.push({ type: 'actions', elements: navElements });

  return blocks;
}

export function buildPostedBlocks(imageUrl: string, slackUserId: string): unknown[] {
  return [
    { type: 'context', elements: [{ type: 'mrkdwn', text: `<@${slackUserId}> posted` }] },
    { type: 'image', image_url: imageUrl, alt_text: 'sticker' },
  ];
}
