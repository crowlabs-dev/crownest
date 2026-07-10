export type ListColumn = {
  readonly key: string;
  readonly label?: string;
};

export function jsonEnvelope(value: unknown): string {
  return `${JSON.stringify({ data: sanitizeForOutput(value) })}\n`;
}

export function jsonPageEnvelope(page: {
  readonly data: readonly unknown[];
  readonly hasMore: boolean;
  readonly nextCursor?: string;
}): string {
  return `${JSON.stringify({
    data: sanitizeForOutput(page.data),
    hasMore: page.hasMore,
    ...(page.nextCursor === undefined ? {} : { nextCursor: page.nextCursor }),
  })}\n`;
}

export function jsonErrorEnvelope(error: {
  readonly code: string;
  readonly details?: Readonly<Record<string, unknown>> | null;
  readonly message: string;
  readonly remediation?: string | null;
  readonly retryable?: boolean;
  readonly status?: number | null;
}): string {
  return `${JSON.stringify({
    error: {
      code: error.code,
      details: error.details ?? null,
      message: error.message,
      remediation: error.remediation ?? null,
      retryable: error.retryable ?? false,
      status: error.status ?? null,
    },
  })}\n`;
}

export function renderRecord(record: object): string {
  const entries = Object.entries(toDisplayRecord(record));
  if (entries.length === 0) return "\n";

  return `${entries
    .map(([key, value]) => `${key}: ${formatValue(value)}`)
    .join("\n")}\n`;
}

export function renderList(
  rows: readonly object[],
  columns: readonly ListColumn[],
): string {
  const header = columns.map((column) => column.label ?? column.key).join("\t");
  const body = rows
    .map((row) =>
      columns.map((column) => formatValue(toDisplayRecord(row)[column.key])).join("\t"),
    )
    .join("\n");

  return body.length === 0 ? `${header}\n` : `${header}\n${body}\n`;
}

export function toDisplayRecord(record: object): Record<string, unknown> {
  const sanitized = sanitizeObject(record);
  const entries = Object.entries(sanitized).filter(
    ([, value]) => value !== undefined && typeof value !== "function",
  );
  const ordered = entries.sort(([left], [right]) => {
    return fieldRank(left) - fieldRank(right);
  });

  return Object.fromEntries(ordered);
}

export function sanitizeForOutput(value: unknown): unknown {
  if (Array.isArray(value)) {
    return value.map(sanitizeForOutput);
  }
  if (!isRecord(value)) {
    return value;
  }
  return sanitizeObject(value);
}

function sanitizeObject(record: object): Record<string, unknown> {
  const result: Record<string, unknown> = {};

  for (const [key, value] of Object.entries(record)) {
    if (typeof value === "function") continue;
    if (Array.isArray(value)) {
      result[key] = value.map(sanitizeForOutput);
      continue;
    }
    if (isRecord(value)) {
      const child = sanitizeObject(value);
      const hasFunctionMember = Object.values(value).some(
        (member) => typeof member === "function",
      );
      if (Object.keys(child).length === 0 && hasFunctionMember) continue;
      result[key] = child;
      continue;
    }
    result[key] = value;
  }

  return result;
}

function formatValue(value: unknown): string {
  if (value === undefined || value === null) return "";
  if (typeof value === "string") return value;
  if (typeof value === "number" || typeof value === "boolean") return String(value);
  return JSON.stringify(value);
}

function fieldRank(field: string): number {
  const rank = [
    "id",
    "secret",
    "status",
    "url",
    "path",
    "name",
    "port",
    "authMode",
    "expiresAt",
    "createdAt",
    "updatedAt",
  ].indexOf(field);

  return rank < 0 ? 1_000 : rank;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}
