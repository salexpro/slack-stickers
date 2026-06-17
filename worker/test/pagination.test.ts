import { describe, it, expect } from 'vitest';
import { paginate, PER_PAGE } from '../src/lib/pagination';

describe('paginate', () => {
  it('exposes a page size constant', () => {
    expect(PER_PAGE).toBe(5);
  });

  it('slices the requested page and reports nav availability', () => {
    const items = [1, 2, 3, 4, 5, 6, 7]; // 7 items, PER_PAGE 5
    const p0 = paginate(items, 0);
    expect(p0.pageItems).toEqual([1, 2, 3, 4, 5]);
    expect(p0.hasPrev).toBe(false);
    expect(p0.hasNext).toBe(true);

    const p1 = paginate(items, 1);
    expect(p1.pageItems).toEqual([6, 7]);
    expect(p1.hasPrev).toBe(true);
    expect(p1.hasNext).toBe(false);
  });

  it('clamps out-of-range pages to a valid page', () => {
    const items = [1, 2, 3];
    const p = paginate(items, 9);
    expect(p.page).toBe(0);
    expect(p.pageItems).toEqual([1, 2, 3]);
  });
});
