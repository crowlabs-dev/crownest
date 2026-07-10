# CrowNest Python SDK

Use the CrowNest Python SDK to create cloud sandboxes, run commands, manage
workspace files and artifacts, and launch reproducible Workspace Runs. Both
synchronous and asynchronous clients include retries, pagination, and polling
helpers.

## Install and authenticate

Install the package and expose a CrowNest bearer credential in your
environment.

```bash
pip install crownest
export CROWNEST_BEARER_TOKEN="cn_live_..."
```

```python
from crownest import CrowNest

with CrowNest() as client:
    sandbox = client.sandboxes.create(template="python-node", ttl_ms=60 * 60_000)
    sandbox.files.write(
        "/workspace/main.py",
        "from pathlib import Path\nPath('/workspace/output.txt').write_text('hello')\n",
    )
    command = sandbox.commands.run(
        "python3 /workspace/main.py",
        collect=[{"path": "/workspace/output.txt", "name": "output.txt"}],
        collect_on="success",
    )
    print(command["status"], command.get("exitCode"))
    print(sandbox.files.read("/workspace/output.txt"))
```

`commands.run()` waits for completion by default. Pass `background=True` to
return as soon as the command starts. Artifact collection is available only for
foreground commands.

```python
worker = sandbox.commands.run(
    "python3 /workspace/worker.py",
    background=True,
)
print(worker["id"], worker["status"])
```

Use `sandbox.set_ttl(ttl_ms=...)` or
`client.sandboxes.set_ttl(sandbox_id, ttl_ms=...)` to change a live sandbox's
TTL. Setting the TTL resets its expiration countdown from the time of the
request.

The client reads `CROWNEST_BEARER_TOKEN` by default and falls back to
`CROWNEST_API_KEY` for developer API keys. You can also pass `credential` or
`api_key` directly and use `base_url` for local development.

## Use the asynchronous client

Use `AsyncCrowNest` when your application already runs an asynchronous event
loop.

```python
from crownest import AsyncCrowNest

async with AsyncCrowNest() as client:
    projects = await client.projects.list()
    async for project in projects:
        print(project["id"])
```

## Iterate through list results

List methods return a fetched page that exposes `data`, `has_more`, and
`next_cursor`. Iterating over the page fetches following pages automatically.
Use `next_page()` when you need explicit page boundaries.

```python
page = client.sandboxes.list(limit=50)
print(page.data, page.has_more, page.next_cursor)

for sandbox in page:
    print(sandbox.id)

second_page = page.next_page()
```

Pass `cursor` to resume from a saved cursor. Asynchronous list methods return
an `AsyncPage`; use `async for` and `await page.next_page()` with that type.

## Launch a Workspace Run in one call

Use `workspace_runs.run()` to create the run, upload a `.tar.gz` archive,
start execution, and wait for a terminal result. The SDK calculates the archive
digest and chooses direct upload for archives up to 8 MiB or staged transfer for
larger archives.

```python
from pathlib import Path

result = client.workspace_runs.run(
    Path("workspace.tar.gz").read_bytes(),
    command="pytest -q",
    artifacts=[{"path": "/workspace/test-results.xml"}],
)
print(result["status"])
```

Pass `stream=True` to receive the Workspace Run event iterator instead of
waiting. The lower-level `create()`, `upload_archive()`, staged transfer,
`finalize_archive()`, and `start()` methods remain available.

## Wait for resources

Polling helpers use exponential backoff and enforce a timeout. Use
`sandbox.wait_until_ready()`, `client.commands.wait(command_id)`, or
`client.workspace_runs.wait_for_terminal(workspace_run_id)` when you don't need
to manage polling yourself.

## Configure retries and handle errors

The client retries transient network failures and HTTP `429`, `500`, `502`,
`503`, and `504` responses for `GET` requests and requests carrying an
idempotency key. The default `max_retries=2` permits three total attempts.
Retries honor `Retry-After`, use exponential backoff with jitter, and reuse an
auto-generated idempotency key for the entire logical request.

Every request sends `User-Agent` and `x-crownest-sdk` identity headers. API
failures raise `CrowNestApiError` with `status`, `code`, `details`,
`request_id`, `retry_after_seconds`, and `retryable` attributes. Known API error
codes are available through the exported `KnownErrorCode` type, while unknown
server codes remain valid strings for forward compatibility.

## Resource model

CrowNest uses Sandboxes for isolated execution, Commands for process
invocations, Workspace files for live working state, Artifacts for durable
outputs, and Previews for authenticated HTTP services.

## Package scope

This package contains the Python client. The hosted CrowNest service and runtime
implementation are separate.

Docs: https://crownest.dev/docs

License: Apache-2.0
