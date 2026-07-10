# @crownest/mcp

`@crownest/mcp` is a stdio MCP server that lets MCP hosts use CrowNest Sandboxes as tools. It wraps the TypeScript SDK, creates Sandboxes on demand, runs Commands and Python code, manages Workspace files under `/workspace`, creates and downloads Artifacts, manages Previews, inspects Code Contexts, and exposes safe API-key and Project operations for agents.

The package is published as `@crownest/mcp`. Once maintainers publish a registry release, MCP hosts can run it with `npx @crownest/mcp`.

The hosted CrowNest service and runtime implementation are not part of this package.

Docs: https://crownest.dev/docs

License: Apache-2.0

## Host Configuration

Claude Code:

```bash
claude mcp add crownest -e CROWNEST_API_KEY=cn_live_... -- npx @crownest/mcp
```

Generic MCP configuration:

```json
{
  "mcpServers": {
    "crownest": {
      "command": "npx",
      "args": ["@crownest/mcp"],
      "env": {
        "CROWNEST_API_KEY": "cn_live_..."
      }
    }
  }
}
```

Set `CROWNEST_API_URL` only when targeting a non-production CrowNest API.

## Sandbox Lifecycle

The server sends MCP startup instructions that describe `/workspace`, the lazy default Sandbox model, Code Run output promotion, usage discovery, Sandbox TTL semantics, retry/idempotency routing, and cleanup.

It lazily creates one default Sandbox on the first stateful tool call. Tools that operate inside a Sandbox return `sandbox_id`, and later calls can pass that `sandbox_id` to keep using the same Workspace. `create_sandbox` creates additional Sandboxes for the same server session, and `kill_sandbox` removes a server-created Sandbox. When stdio closes, the server best-effort kills Sandboxes it created.

`CROWNEST_API_KEY` is a host-process credential for the SDK. It is not passed into Sandbox runtime environment variables.

## Tools

| Tool                  | Description                                                                                                                        |
| --------------------- | ---------------------------------------------------------------------------------------------------------------------------------- |
| `run_code`            | Runs Python code in a Sandbox. Variables and imports persist in the Code Context. Outputs are promoted to Artifacts when possible. |
| `list_code_contexts`  | Lists live Code Contexts in a Sandbox.                                                                                             |
| `get_code_context`    | Inspects a live Code Context in a Sandbox.                                                                                         |
| `run_command`         | Runs a Command in the foreground by default, or starts it immediately with `background: true` for follow-up through Command tools. |
| `get_command`         | Inspects Command status, exit code, and timing by Command id.                                                                      |
| `cancel_command`      | Cancels a Command by Command id with graceful or force mode.                                                                       |
| `stream_command_logs` | Reads the currently available bounded Command log buffer.                                                                          |
| `create_sandbox`      | Creates an additional Sandbox for this MCP server session, optionally with `ttl_ms`, without changing the lazy default Sandbox.    |
| `list_sandboxes`      | Lists live Sandboxes visible to the configured API Key, with optional live status filtering and limit.                             |
| `get_usage`           | Reads compute usage, spend metadata, quota buckets, and MCP-session Sandbox state.                                                 |
| `get_sandbox`         | Inspects a Sandbox by id or the current lazy default Sandbox.                                                                      |
| `set_sandbox_ttl`     | Resets the TTL countdown from now to `ttl_ms`; it does not add `ttl_ms` to the existing expiry.                                    |
| `kill_sandbox`        | Kills a server-created Sandbox. If it was the default Sandbox, the next default call creates a new one.                            |
| `write_file`          | Writes utf-8 text to a Workspace path, normally under `/workspace`.                                                                |
| `read_file`           | Reads utf-8 text from a Workspace path.                                                                                            |
| `list_files`          | Lists files in a Workspace path, defaulting to `/workspace`.                                                                       |
| `delete_file`         | Deletes a file or empty directory from the Workspace.                                                                              |
| `move_file`           | Moves or renames a Workspace file.                                                                                                 |
| `make_directory`      | Creates a Workspace directory.                                                                                                     |
| `stat_file`           | Inspects Workspace file metadata.                                                                                                  |
| `create_artifact`     | Creates a durable Artifact from a Workspace file.                                                                                  |
| `list_artifacts`      | Lists Artifacts for a Sandbox.                                                                                                     |
| `get_artifact`        | Inspects Artifact metadata by Artifact id.                                                                                         |
| `download_artifact`   | Downloads an Artifact by id and returns base64 content plus content type.                                                          |
| `delete_artifact`     | Deletes an Artifact by Artifact id.                                                                                                |
| `create_preview`      | Creates a Preview for a Sandbox HTTP service. Token auth mode returns a one-time Preview token.                                    |
| `list_previews`       | Lists Previews for a Sandbox.                                                                                                      |
| `get_preview`         | Inspects a Preview by Preview id.                                                                                                  |
| `revoke_preview`      | Revokes a Preview by Preview id.                                                                                                   |
| `list_api_keys`       | Lists API Key metadata without returning secret key values.                                                                        |
| `revoke_api_key`      | Revokes an API Key by API Key id.                                                                                                  |
| `create_project`      | Creates a Project for isolating Sandboxes, usage, quotas, and API-key restrictions.                                                |

## Local Development

```bash
pnpm --filter @crownest/mcp test
pnpm --filter @crownest/mcp typecheck
pnpm --filter @crownest/mcp build
CROWNEST_API_KEY= node packages/mcp/dist/index.js
```
