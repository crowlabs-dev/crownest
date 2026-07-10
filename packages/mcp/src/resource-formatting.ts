export type ArtifactMetadata = {
  readonly createdAt?: string;
  readonly contentType?: string;
  readonly deletedAt?: string;
  readonly id: string;
  readonly name?: string;
  readonly sandboxId?: string;
  readonly sizeBytes?: number;
  readonly sourcePath?: string;
};

export type SandboxMetadata = {
  readonly createdAt?: string;
  readonly destroyedAt?: string;
  readonly expiresAt: string;
  readonly id: string;
  readonly projectId?: string;
  readonly status: string;
  readonly templateSlug?: string;
  readonly templateVersion?: string;
  readonly ttlMs?: number;
};

export type PreviewMetadata = {
  readonly authMode: string;
  readonly createdAt?: string;
  readonly expiresAt?: string;
  readonly id: string;
  readonly port: number;
  readonly revokedAt?: string;
  readonly sandboxId: string;
  readonly slug: string;
  readonly url: string;
};

export type CodeContextMetadata = {
  readonly createdAt?: string;
  readonly cwd: string;
  readonly expiresAt?: string;
  readonly id: string;
  readonly isDefault?: boolean;
  readonly language: string;
  readonly sandboxId: string;
};

export type ApiKeyMetadata = {
  readonly createdAt?: string;
  readonly id: string;
  readonly last4: string;
  readonly lastUsedAt?: string;
  readonly name: string;
  readonly prefix: string;
  readonly projectIds?: readonly string[];
  readonly revokedAt?: string;
  readonly scopes: readonly string[];
};

export type ProjectMetadata = {
  readonly createdAt?: string;
  readonly id: string;
  readonly name: string;
  readonly orgId?: string;
};

export function artifactPayload(artifact: ArtifactMetadata): Record<string, unknown> {
  return {
    artifact_id: artifact.id,
    content_type: artifact.contentType,
    created_at: artifact.createdAt,
    deleted_at: artifact.deletedAt,
    name: artifact.name,
    sandbox_id: artifact.sandboxId,
    size_bytes: artifact.sizeBytes,
    source_path: artifact.sourcePath,
  };
}

export function sandboxPayload(sandbox: SandboxMetadata): Record<string, unknown> {
  return {
    created_at: sandbox.createdAt,
    destroyed_at: sandbox.destroyedAt,
    expires_at: sandbox.expiresAt,
    project_id: sandbox.projectId,
    sandbox_id: sandbox.id,
    status: sandbox.status,
    template: formatTemplate(sandbox),
    ttl_ms: sandbox.ttlMs,
  };
}

export function previewPayload(preview: PreviewMetadata): Record<string, unknown> {
  return {
    auth_mode: preview.authMode,
    created_at: preview.createdAt,
    expires_at: preview.expiresAt,
    port: preview.port,
    preview_id: preview.id,
    revoked_at: preview.revokedAt,
    sandbox_id: preview.sandboxId,
    slug: preview.slug,
    url: preview.url,
  };
}

export function codeContextPayload(
  context: CodeContextMetadata,
): Record<string, unknown> {
  return {
    code_context_id: context.id,
    created_at: context.createdAt,
    cwd: context.cwd,
    expires_at: context.expiresAt,
    is_default: context.isDefault,
    language: context.language,
    sandbox_id: context.sandboxId,
  };
}

export function apiKeyPayload(apiKey: ApiKeyMetadata): Record<string, unknown> {
  return {
    api_key_id: apiKey.id,
    created_at: apiKey.createdAt,
    last4: apiKey.last4,
    last_used_at: apiKey.lastUsedAt,
    name: apiKey.name,
    prefix: apiKey.prefix,
    project_ids: apiKey.projectIds,
    revoked_at: apiKey.revokedAt,
    scopes: apiKey.scopes,
  };
}

export function projectPayload(project: ProjectMetadata): Record<string, unknown> {
  return {
    created_at: project.createdAt,
    name: project.name,
    org_id: project.orgId,
    project_id: project.id,
  };
}

function formatTemplate(sandbox: SandboxMetadata): string | undefined {
  if (sandbox.templateSlug === undefined) return undefined;
  return sandbox.templateVersion === undefined
    ? sandbox.templateSlug
    : `${sandbox.templateSlug}@${sandbox.templateVersion}`;
}
