from __future__ import annotations

from collections.abc import Callable, Mapping, Sequence
from typing import Any, Literal, NewType, NotRequired, TypedDict

JsonScalar = str | int | float | bool | None
Json = JsonScalar | Sequence["Json"] | Mapping[str, "Json"]
JsonObject = dict[str, Json]
Metadata = Mapping[str, str]

ArtifactId = NewType("ArtifactId", str)
BackupId = NewType("BackupId", str)
CommandId = NewType("CommandId", str)
OrgId = NewType("OrgId", str)
PreviewId = NewType("PreviewId", str)
ProjectId = NewType("ProjectId", str)
SandboxId = NewType("SandboxId", str)
TemplateId = NewType("TemplateId", str)
TemplateVersionId = NewType("TemplateVersionId", str)

KnownErrorCode = Literal[
    "agent_event_replay",
    "agent_provider_untrusted",
    "agent_registration_revoked",
    "agent_token_expired",
    "authorization_pending",
    "backup_not_restorable",
    "backup_project_mismatch",
    "backup_template_mismatch",
    "billing_not_configured",
    "billing_spend_cap_reached",
    "claim_email_mismatch",
    "code_source_too_large",
    "credit_exhausted",
    "directory_not_empty",
    "download_export_failed",
    "expired_token",
    "feature_not_enabled",
    "file_already_exists",
    "file_not_found",
    "file_too_large",
    "forbidden",
    "idempotency_key_reused",
    "idempotency_request_in_progress",
    "invalid_api_key",
    "invalid_claim_token",
    "invalid_file_encoding",
    "invalid_identity_assertion",
    "invalid_metadata_key",
    "invalid_metadata_value",
    "invalid_request",
    "metadata_too_large",
    "metadata_too_many_keys",
    "missing_idempotency_key",
    "not_found",
    "org_suspended",
    "parent_directory_not_found",
    "path_is_directory",
    "path_not_directory",
    "path_outside_workspace",
    "preview_unavailable",
    "quota_exceeded",
    "rate_limited",
    "reserved_env_key",
    "resource_allocation_failed",
    "sandbox_destroyed",
    "sandbox_ttl_exceeded",
    "slow_down",
    "stream_gap",
    "unauthorized",
    "unsupported_code_language",
    "unsupported_preview_auth_mode",
    "unsupported_runtime_option",
    "upload_checksum_mismatch",
    "upload_conflict",
    "upload_expired",
    "upload_incomplete",
    "upload_not_found",
    "upload_size_mismatch",
    "usage_export_in_progress",
]
ErrorCode = KnownErrorCode | str

FileEncoding = Literal["base64", "utf8"]
CodeArtifactPolicy = Literal["inline_only", "promote"]
CodeLanguage = Literal["python", "javascript", "typescript"]
CommandCancelMode = Literal["force", "graceful"]
CommandCollectOn = Literal["always", "success"]
CommandLogStream = Literal["stderr", "stdout"]
PreviewAuthMode = Literal["authenticated", "token"]
WorkspaceRunStatus = Literal[
    "awaiting_archive",
    "archive_uploaded",
    "starting",
    "extracting",
    "running",
    "collecting",
    "succeeded",
    "failed",
    "canceled",
]


class CommandCollectRequest(TypedDict, total=False):
    path: str
    name: str


class WorkspaceRunArtifactRequest(TypedDict):
    path: str
    name: NotRequired[str]


class RunCommandOptions(TypedDict, total=False):
    background: bool
    collect: Sequence[CommandCollectRequest]
    collect_on: CommandCollectOn
    cwd: str
    env: Mapping[str, str]
    idempotency_key: str
    on_stderr: Callable[[str], None]
    on_stdout: Callable[[str], None]
    on_stream_error: Callable[[BaseException], None]
    timeout_ms: int


class ApiErrorEnvelope(TypedDict):
    error: "ApiError"


class ApiError(TypedDict):
    code: str
    message: str
    details: NotRequired[dict[str, Any]]
