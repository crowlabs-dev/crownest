import type { Pagination } from "@crownest/contracts";

/** A single API page that can also iterate transparently across later pages. */
export type AutoPage<T> = Pagination<T> &
  AsyncIterable<T> & {
    /** Fetch the next page, or return `undefined` when this is the last page. */
    nextPage(): Promise<AutoPage<T> | undefined>;
  };

type PageFetcher<T> = (cursor: string) => Promise<Pagination<T>>;

export function createPage<T>(
  response: Pagination<T>,
  fetchPage: PageFetcher<T>,
): AutoPage<T> {
  const nextPage = async (): Promise<AutoPage<T> | undefined> => {
    if (!response.hasMore) return undefined;
    if (response.nextCursor === undefined) {
      throw new Error("Paginated response hasMore=true without a nextCursor.");
    }
    const nextResponse = await fetchPage(response.nextCursor);
    if (nextResponse.nextCursor === response.nextCursor && nextResponse.hasMore) {
      throw new Error("Paginated response returned an unchanged nextCursor.");
    }
    return createPage(nextResponse, fetchPage);
  };

  const page = {
    data: response.data,
    hasMore: response.hasMore,
    ...(response.nextCursor === undefined ? {} : { nextCursor: response.nextCursor }),
  } as AutoPage<T>;
  Object.defineProperties(page, {
    nextPage: { enumerable: false, value: nextPage },
    [Symbol.asyncIterator]: {
      enumerable: false,
      value: async function* () {
        let current: AutoPage<T> | undefined = page;
        while (current !== undefined) {
          yield* current.data;
          current = await current.nextPage();
        }
      },
    },
  });
  return page;
}

export function paginationParams(input: {
  readonly cursor?: string | undefined;
  readonly limit?: number;
}): URLSearchParams {
  const params = new URLSearchParams();
  if (input.limit !== undefined) params.set("limit", String(input.limit));
  if (input.cursor !== undefined) params.set("cursor", input.cursor);
  return params;
}
