# @crownest/sdk

TypeScript SDK for CrowNest cloud sandboxes for coding agents.

The SDK provides typed resource clients, automatic retries for safe requests,
request timeouts, cursor pagination, and wait helpers for long-running work.

## Install

Install the package and provide a bearer credential.

```bash
pnpm add @crownest/sdk
export CROWNEST_BEARER_TOKEN="cn_agent_or_cn_live_..."
```

```ts
import { createCrowNestClient } from "@crownest/sdk";

const client = createCrowNestClient();

const sandbox = await client.sandboxes.create({ template: "python-node" });

const result = await sandbox.commands.run("python3 -c 'print(40 + 2)'");
console.log(result.exitCode, result.stdout);

await sandbox.files.write("notes.txt", "hello from crownest");
const content = await sandbox.files.read("notes.txt");
console.log(content);

const artifact = await sandbox.artifacts.create({ path: "notes.txt" });
console.log("artifact:", artifact.id);

await sandbox.commands.run("python3 -m http.server 8000", {
  background: true,
});
const { preview } = await sandbox.previews.create({ port: 8000 });
console.log("preview:", preview.url);

await sandbox.kill();
```

## Configure the client

Pass client options when you need a custom endpoint, retry policy, or request
timeout.

```ts
const client = createCrowNestClient({
  apiKey: process.env.CROWNEST_API_KEY,
  baseUrl: "https://api.crownest.dev",
  maxRetries: 2,
  timeoutMs: 30_000,
});
```

`maxRetries` counts retries after the first attempt, so the default value of
`2` permits three total attempts. The SDK retries `GET` requests and mutations
that carry an idempotency key after network failures or transient HTTP
responses. It uses exponential backoff with jitter and honors `Retry-After`.
An automatically generated idempotency key stays unchanged across retries.
For unary requests, `timeoutMs` is a wall-clock deadline that includes retries
and response-body reading. For SSE requests, it bounds connection establishment
through receipt of the response headers. After that, it becomes the default
inactivity window: every received byte resets the deadline, including server
heartbeat events. Override the streaming phase per call with
`streamIdleTimeoutMs`.

```ts
for await (const event of client.commands.streamLogs(command.id, {
  timeoutMs: 10_000,
  streamIdleTimeoutMs: 5_000,
})) {
  console.log(event);
}
```

Command and Workspace Run streams emit heartbeat bytes on a nominal 500 ms
loop. Backend reads happen before each heartbeat, so use an inactivity window
of several seconds or more rather than treating 500 ms as a hard cadence. When
`timeoutMs` and `streamIdleTimeoutMs` are both unset, the SDK doesn't impose a
client-side request or inactivity deadline; server-side operation timeouts
still apply.

Pagination-backed list methods accept `limit`, `cursor`, and `signal`. They
return an `AutoPage<T>` that retains `data`, `hasMore`, and `nextCursor`.

```ts
const firstPage = await client.sandboxes.list({ limit: 25 });
console.log(firstPage.data, firstPage.nextCursor);

const nextPage = await firstPage.nextPage();

for await (const sandbox of firstPage) {
  console.log(sandbox.id);
}
```

Async iteration fetches later pages as needed and preserves the filters from
the first request. File listings, command logs, and Workspace Run events remain
bounded response shapes rather than cursor pages.

## Wait for resources

Use wait helpers when the next step depends on a resource reaching a stable
state. Polling backs off between requests and supports timeouts and abort
signals.

```ts
const ready = await sandbox.waitUntilReady({ timeoutMs: 60_000 });

const command = await ready.commands.run("pnpm test", { background: true });
const completed = await ready.commands.wait(command.id, {
  timeoutMs: 10 * 60_000,
});

const terminalRun = await client.workspaceRuns.waitUntilDone("wsr_123", {
  timeoutMs: 10 * 60_000,
});
```

`commands.run()` waits for completion by default. Set `background: true` to
return the created Command immediately. Background commands can't use
`collect` or `collectOn`; the TypeScript input type rejects that combination.

Reset a Sandbox TTL countdown from the current time with `setTtl()`.

```ts
const updated = await client.sandboxes.setTtl(sandbox.id, {
  ttlMs: 60 * 60 * 1000,
});

await updated.setTtl({ ttlMs: 30 * 60 * 1000 });
```

## Run a workspace archive

`workspaceRuns.run()` creates a Workspace Run, uploads its archive, and starts
execution. Archives up to 8 MiB use the direct upload endpoint. Larger archives
use a staged transfer automatically. Set `wait: true` to return the terminal
run instead of the started run.

```ts
const workspaceRun = await client.workspaceRuns.run({
  archive: {
    body: archiveBytes,
    sha256: archiveSha256,
    sizeBytes: archiveBytes.byteLength,
  },
  command: "pnpm test",
  template: "python-node",
  wait: true,
  waitOptions: { timeoutMs: 15 * 60_000 },
});

for await (const event of client.workspaceRuns.streamEvents(workspaceRun.id)) {
  console.log(event);
}
```

The lower-level `create`, `uploadArchive`, `createArchiveTransfer`,
`uploadArchiveToTransfer`, `finalizeArchive`, `start`, and `runArchive`
primitives remain available.

## Handle API errors

Failed API responses throw `CrowNestApiError`. The error includes `status`,
`code`, `details`, `requestId`, `retryAfterMs`, and a derived `retryable`
property. Unknown server error codes remain available as strings.

```ts
import { CrowNestApiError } from "@crownest/sdk";

try {
  await client.sandboxes.get("sbx_missing");
} catch (error) {
  if (error instanceof CrowNestApiError) {
    console.error(error.code, error.requestId, error.retryable);
  }
}
```

Every HTTP request includes
`x-crownest-sdk: @crownest/sdk/<package-version>` for diagnostics.

## Resource model

Use the SDK's resource names consistently across client methods and API
responses.

CrowNest uses Sandboxes for isolated execution, Commands for process
invocations, Workspace files for live working state, Artifacts for durable
outputs, and Previews for authenticated HTTP services.

The hosted CrowNest service and runtime implementation are not part of this
package.

`CROWNEST_BEARER_TOKEN` may be an auth.md agent access token or a developer
API key. `CROWNEST_API_KEY` and the `{ apiKey }` option remain supported for
developer-key compatibility.

Docs: https://crownest.dev/docs

License: Apache-2.0
