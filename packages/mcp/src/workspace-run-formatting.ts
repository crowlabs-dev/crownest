export function transferPayload(transfer: {
  readonly checksumAlgorithm: string;
  readonly expiresAt: string;
  readonly headers: Readonly<Record<string, string>>;
  readonly id: `upl_${string}`;
  readonly maxSizeBytes: number;
  readonly method: string;
  readonly status: string;
  readonly uploadUrl: string;
  readonly workspaceRunId: `wsr_${string}`;
}): Record<string, unknown> {
  return {
    checksum_algorithm: transfer.checksumAlgorithm,
    expires_at: transfer.expiresAt,
    header_names: Object.keys(transfer.headers),
    max_size_bytes: transfer.maxSizeBytes,
    method: transfer.method,
    status: transfer.status,
    upload_id: transfer.id,
    upload_url: transfer.uploadUrl,
    workspace_run_id: transfer.workspaceRunId,
  };
}
