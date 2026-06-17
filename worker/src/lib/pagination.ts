export const PER_PAGE = 5;

export interface Page<T> {
  page: number;
  pageItems: T[];
  hasPrev: boolean;
  hasNext: boolean;
}

export function paginate<T>(items: T[], requestedPage: number): Page<T> {
  const lastPage = Math.max(0, Math.ceil(items.length / PER_PAGE) - 1);
  const page = requestedPage >= 0 && requestedPage <= lastPage ? requestedPage : 0;
  const start = page * PER_PAGE;
  const pageItems = items.slice(start, start + PER_PAGE);
  return { page, pageItems, hasPrev: page > 0, hasNext: page < lastPage };
}
