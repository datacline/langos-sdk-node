import type { AsyncIterablePage, Page } from '../types.js';

interface WirePage<TWire> {
  object: 'list';
  data: TWire[];
  has_more: boolean;
  next_cursor: string | null;
}

export async function fetchPage<TWire, TOut>(
  fetcher: (cursor: string | undefined) => Promise<WirePage<TWire>>,
  mapItem: (w: TWire) => TOut,
  initialCursor?: string,
): Promise<AsyncIterablePage<TOut>> {
  const wire = await fetcher(initialCursor);
  return wrapPage(wire, mapItem, fetcher);
}

function wrapPage<TWire, TOut>(
  wire: WirePage<TWire>,
  mapItem: (w: TWire) => TOut,
  fetcher: (cursor: string | undefined) => Promise<WirePage<TWire>>,
): AsyncIterablePage<TOut> {
  const data = wire.data.map(mapItem);

  const page: Page<TOut> = {
    data,
    hasMore: !!wire.has_more,
    nextCursor: wire.next_cursor ?? null,
    async getNextPage() {
      if (!wire.has_more || !wire.next_cursor) return null;
      const next = await fetcher(wire.next_cursor);
      return wrapPage(next, mapItem, fetcher);
    },
  };

  const iter: AsyncIterable<TOut> = {
    async *[Symbol.asyncIterator]() {
      let current: Page<TOut> | null = page;
      while (current) {
        for (const item of current.data) yield item;
        current = await current.getNextPage();
      }
    },
  };

  return Object.assign({}, page, iter, {
    [Symbol.asyncIterator]: iter[Symbol.asyncIterator].bind(iter),
  }) as AsyncIterablePage<TOut>;
}
