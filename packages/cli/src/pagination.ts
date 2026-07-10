import { type ParsedFlags, stringFlag, UsageError } from "./flags";

export const paginationFlagSpec = {
  "--all": "boolean",
  "--cursor": "string",
  "--limit": "string",
} as const;

export type PaginationOptions = {
  readonly all: boolean;
  readonly cursor?: string;
  readonly limit?: number;
};

export type Page<T> = {
  readonly data: readonly T[];
  readonly hasMore: boolean;
  readonly nextCursor?: string;
};

export function paginationOptions(flags: ParsedFlags["flags"]): PaginationOptions {
  const limitValue = stringFlag(flags, "--limit");
  let limit: number | undefined;
  if (limitValue !== undefined) {
    limit = Number(limitValue);
    if (
      !/^[0-9]+$/.test(limitValue) ||
      !Number.isSafeInteger(limit) ||
      limit <= 0 ||
      limit > 500
    ) {
      throw new UsageError("--limit must be an integer from 1 to 500.");
    }
  }
  const cursor = stringFlag(flags, "--cursor");

  return {
    all: flags["--all"] === true,
    ...(cursor === undefined ? {} : { cursor }),
    ...(limit === undefined ? {} : { limit }),
  };
}

export async function collectPages<T>(
  options: PaginationOptions,
  fetchPage: (cursor: string | undefined) => Promise<Page<T>>,
): Promise<Page<T>> {
  const firstPage = await fetchPage(options.cursor);
  if (!options.all || !firstPage.hasMore) return firstPage;

  const data = [...firstPage.data];
  let page = firstPage;
  const seenCursors = new Set<string>();

  while (page.hasMore) {
    const cursor = page.nextCursor;
    if (!cursor || seenCursors.has(cursor)) {
      throw new Error("Paginated response hasMore=true without a new nextCursor.");
    }
    seenCursors.add(cursor);
    page = await fetchPage(cursor);
    data.push(...page.data);
  }

  return { data, hasMore: false };
}

export function paginationSearchParams(
  options: PaginationOptions,
  cursor: string | undefined,
): URLSearchParams {
  const params = new URLSearchParams();
  if (options.limit !== undefined) params.set("limit", String(options.limit));
  if (cursor !== undefined) params.set("cursor", cursor);
  return params;
}
