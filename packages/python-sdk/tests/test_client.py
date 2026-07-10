from __future__ import annotations

import asyncio
import json
import threading

import httpx
import pytest

from crownest import _resources as resources
from crownest import AsyncCrowNest, CrowNest, CrowNestApiError, SandboxHandle
from crownest._transport import (
    DEFAULT_TIMEOUT_SECONDS,
    MAX_BLOCKING_COMMAND_TIMEOUT_SECONDS,
)


def test_sync_client_creates_sandbox_handle_and_runs_command() -> None:
    requests: list[httpx.Request] = []

    def handler(request: httpx.Request) -> httpx.Response:
        requests.append(request)
        if request.url.path == "/v1/sandboxes":
            return json_response({"sandbox": sandbox_body()})
        if request.url.path == "/v1/sandboxes/sbx_123/ttl":
            return json_response({"sandbox": sandbox_body(ttlMs=5_400_000)})
        if request.url.path == "/v1/sandboxes/sbx_123/commands":
            return json_response({"command": command_body()})
        if request.url.path == "/v1/commands/cmd_123/cancel":
            return json_response({"command": command_body(status="canceled")})
        raise AssertionError(f"unexpected request: {request.method} {request.url}")

    client = CrowNest(
        api_key="cnk_test",
        base_url="https://api.test",
        http_client=httpx.Client(transport=httpx.MockTransport(handler)),
    )

    sandbox = client.sandboxes.create(project_id="prj_123", template="python-node")
    extended = sandbox.set_ttl(ttl_ms=5_400_000, idempotency_key="ttl-key")
    command = extended.commands.run(
        "python main.py",
        collect=[{"path": "/workspace/output.txt", "name": "output.txt"}],
        collect_on="success",
    )
    canceled = extended.commands.cancel("cmd_123", mode="force")

    assert sandbox.id == "sbx_123"
    assert sandbox["status"] == "ready"
    assert extended["ttlMs"] == 5_400_000
    assert command["id"] == "cmd_123"
    assert canceled["status"] == "canceled"
    assert requests[0].headers["authorization"] == "Bearer cnk_test"
    assert requests[0].headers["idempotency-key"]
    assert json.loads(requests[0].content) == {
        "projectId": "prj_123",
        "template": "python-node",
    }
    assert requests[1].headers["idempotency-key"] == "ttl-key"
    assert json.loads(requests[1].content) == {"ttlMs": 5_400_000}
    assert json.loads(requests[2].content) == {
        "background": False,
        "collect": [{"path": "/workspace/output.txt", "name": "output.txt"}],
        "collectOn": "success",
        "command": "python main.py",
    }
    assert requests[3].url.path == "/v1/commands/cmd_123/cancel"
    assert json.loads(requests[3].content) == {"mode": "force"}


def test_owned_http_clients_allow_max_blocking_command_timeout() -> None:
    sync_client = CrowNest(api_key="cnk_test")
    short_timeout_client = CrowNest(api_key="cnk_test", timeout=30)
    async_client = AsyncCrowNest(api_key="cnk_test", timeout=45)

    try:
        assert DEFAULT_TIMEOUT_SECONDS > MAX_BLOCKING_COMMAND_TIMEOUT_SECONDS
        assert sync_client._transport._client.timeout == httpx.Timeout(
            DEFAULT_TIMEOUT_SECONDS
        )
        assert short_timeout_client._transport._client.timeout == httpx.Timeout(30)
        assert async_client._transport._client.timeout == httpx.Timeout(45)
    finally:
        sync_client.close()
        short_timeout_client.close()
        asyncio.run(async_client.aclose())


def test_caller_provided_idempotency_keys_are_sent_and_removed_from_body() -> None:
    requests: list[httpx.Request] = []

    def handler(request: httpx.Request) -> httpx.Response:
        requests.append(request)
        if request.url.path == "/v1/sandboxes":
            return json_response({"sandbox": sandbox_body()})
        if request.url.path == "/v1/sandboxes/sbx_123/ttl":
            return json_response({"sandbox": sandbox_body(ttlMs=5_400_000)})
        if request.url.path == "/v1/sandboxes/sbx_123/commands":
            return json_response({"command": command_body()})
        if request.url.path == "/v1/sandboxes/sbx_123/artifacts":
            return json_response({"artifact": artifact_body()})
        raise AssertionError(f"unexpected request: {request.method} {request.url}")

    client = CrowNest(
        api_key="cnk_test",
        base_url="https://api.test",
        http_client=httpx.Client(transport=httpx.MockTransport(handler)),
    )

    client.sandboxes.create(idempotency_key="create-key", project_id="prj_123")
    client.sandboxes.set_ttl(
        "sbx_123",
        ttl_ms=5_400_000,
        idempotency_key="ttl-key",
    )
    client.commands.run("sbx_123", "python main.py", idempotency_key="run-key")
    client.artifacts.create(
        "sbx_123",
        path="/workspace/output.txt",
        idempotency_key="artifact-key",
    )

    assert requests[0].headers["idempotency-key"] == "create-key"
    assert json.loads(requests[0].content) == {"projectId": "prj_123"}
    assert requests[1].headers["idempotency-key"] == "ttl-key"
    assert json.loads(requests[1].content) == {"ttlMs": 5_400_000}
    assert requests[2].headers["idempotency-key"] == "run-key"
    assert json.loads(requests[2].content) == {
        "background": False,
        "command": "python main.py",
    }
    assert requests[3].headers["idempotency-key"] == "artifact-key"
    assert json.loads(requests[3].content) == {"path": "/workspace/output.txt"}


def test_python_command_methods_reject_unknown_keyword_options() -> None:
    client = CrowNest(
        api_key="cnk_test",
        base_url="https://api.test",
        http_client=httpx.Client(
            transport=httpx.MockTransport(lambda _request: json_response({}))
        ),
    )

    with pytest.raises(TypeError, match="timeout_millis"):
        client.commands.run("sbx_123", "python main.py", timeout_millis=1)  # type: ignore[call-arg]

    sandbox = SandboxHandle(sandbox_body(), client._transport)
    with pytest.raises(TypeError, match="timeout_millis"):
        sandbox.commands.run("python main.py", timeout_millis=1)  # type: ignore[call-arg]


def test_command_and_ttl_clean_break_surfaces() -> None:
    requests: list[httpx.Request] = []

    def handler(request: httpx.Request) -> httpx.Response:
        requests.append(request)
        if request.url.path == "/v1/sandboxes/sbx_123/commands":
            return json_response({"command": command_body(status="running")})
        if request.url.path == "/v1/sandboxes/sbx_123/ttl":
            return json_response({"sandbox": sandbox_body(ttlMs=120_000)})
        raise AssertionError(f"unexpected request: {request.method} {request.url}")

    client = CrowNest(
        api_key="cnk_test",
        base_url="https://api.test",
        http_client=httpx.Client(transport=httpx.MockTransport(handler)),
    )
    sandbox = SandboxHandle(sandbox_body(), client._transport)

    background = sandbox.commands.run("python worker.py", background=True)
    updated = client.sandboxes.set_ttl("sbx_123", ttl_ms=120_000)

    assert background["status"] == "running"
    assert updated["ttlMs"] == 120_000
    assert json.loads(requests[0].content) == {
        "background": True,
        "command": "python worker.py",
    }
    assert json.loads(requests[1].content) == {"ttlMs": 120_000}
    assert not hasattr(client.commands, "start")
    assert not hasattr(sandbox.commands, "start")
    assert not hasattr(client.sandboxes, "extend")
    assert not hasattr(sandbox, "extend")

    with pytest.raises(ValueError, match="background=False"):
        client.commands.run(
            "sbx_123",
            "python worker.py",
            background=True,
            collect=[{"path": "/workspace/output.txt"}],
        )


@pytest.mark.asyncio
async def test_async_background_command_and_set_ttl_use_canonical_routes() -> None:
    requests: list[httpx.Request] = []

    async def handler(request: httpx.Request) -> httpx.Response:
        requests.append(request)
        if request.url.path == "/v1/sandboxes/sbx_123/commands":
            return json_response({"command": command_body(status="running")})
        if request.url.path == "/v1/sandboxes/sbx_123/ttl":
            return json_response({"sandbox": sandbox_body(ttlMs=120_000)})
        raise AssertionError(f"unexpected request: {request.method} {request.url}")

    async with AsyncCrowNest(
        api_key="cnk_test",
        base_url="https://api.test",
        http_client=httpx.AsyncClient(transport=httpx.MockTransport(handler)),
    ) as client:
        command = await client.commands.run(
            "sbx_123", "python worker.py", background=True
        )
        sandbox = await client.sandboxes.set_ttl("sbx_123", ttl_ms=120_000)
        assert not hasattr(client.commands, "start")
        assert not hasattr(client.sandboxes, "extend")

    assert command["status"] == "running"
    assert sandbox["ttlMs"] == 120_000
    assert json.loads(requests[0].content) == {
        "background": True,
        "command": "python worker.py",
    }


def test_sync_background_command_preserves_callback_streaming() -> None:
    stdout: list[str] = []
    received = threading.Event()

    def handler(request: httpx.Request) -> httpx.Response:
        if request.url.path == "/v1/sandboxes/sbx_123/commands":
            assert json.loads(request.content) == {
                "background": True,
                "command": "python worker.py",
            }
            return json_response({"command": command_body(status="running")})
        if request.url.path == "/v1/commands/cmd_123/stream":
            return httpx.Response(
                200,
                content=(
                    b'data: {"type":"log","seq":1,"stream":"stdout",'
                    b'"data":"ready\\n","createdAt":"now"}\n\n'
                    b'data: {"type":"terminal","createdAt":"now","command":'
                    + json.dumps(command_body()).encode()
                    + b"}\n\n"
                ),
                headers={"content-type": "text/event-stream"},
            )
        raise AssertionError(f"unexpected request: {request.method} {request.url}")

    client = CrowNest(
        api_key="cnk_test",
        base_url="https://api.test",
        http_client=httpx.Client(transport=httpx.MockTransport(handler)),
    )

    def on_stdout(chunk: str) -> None:
        stdout.append(chunk)
        received.set()

    command = client.commands.run(
        "sbx_123",
        "python worker.py",
        background=True,
        on_stdout=on_stdout,
    )

    assert command["status"] == "running"
    assert received.wait(timeout=1)
    assert stdout == ["ready\n"]


@pytest.mark.asyncio
async def test_async_background_command_preserves_callback_streaming() -> None:
    stdout: list[str] = []
    received = asyncio.Event()

    async def handler(request: httpx.Request) -> httpx.Response:
        if request.url.path == "/v1/sandboxes/sbx_123/commands":
            return json_response({"command": command_body(status="running")})
        if request.url.path == "/v1/commands/cmd_123/stream":
            return httpx.Response(
                200,
                content=(
                    b'data: {"type":"log","seq":1,"stream":"stdout",'
                    b'"data":"ready\\n","createdAt":"now"}\n\n'
                    b'data: {"type":"terminal","createdAt":"now","command":'
                    + json.dumps(command_body()).encode()
                    + b"}\n\n"
                ),
                headers={"content-type": "text/event-stream"},
            )
        raise AssertionError(f"unexpected request: {request.method} {request.url}")

    async with AsyncCrowNest(
        api_key="cnk_test",
        base_url="https://api.test",
        http_client=httpx.AsyncClient(transport=httpx.MockTransport(handler)),
    ) as client:

        def on_stdout(chunk: str) -> None:
            stdout.append(chunk)
            received.set()

        command = await client.commands.run(
            "sbx_123",
            "python worker.py",
            background=True,
            on_stdout=on_stdout,
        )
        await asyncio.wait_for(received.wait(), timeout=1)

    assert command["status"] == "running"
    assert stdout == ["ready\n"]


def test_sync_client_retries_retryable_idempotent_request() -> None:
    requests: list[httpx.Request] = []

    def handler(request: httpx.Request) -> httpx.Response:
        requests.append(request)
        if len(requests) == 1:
            return json_response(
                {"error": {"code": "slow_down", "message": "Try again."}},
                headers={"retry-after": "0"},
                status_code=503,
            )
        return json_response({"sandbox": sandbox_body()})

    client = CrowNest(
        api_key="cnk_test",
        base_url="https://api.test",
        http_client=httpx.Client(transport=httpx.MockTransport(handler)),
        max_retries=1,
    )

    sandbox = client.sandboxes.create()

    assert sandbox["id"] == "sbx_123"
    assert len(requests) == 2
    assert requests[0].headers["idempotency-key"]
    assert (
        requests[1].headers["idempotency-key"] == requests[0].headers["idempotency-key"]
    )
    assert requests[0].headers["user-agent"].startswith("crownest-python/")
    assert requests[0].headers["x-crownest-sdk"].startswith("crownest-python/")


def test_sync_client_does_not_retry_non_idempotent_mutations() -> None:
    requests: list[httpx.Request] = []

    def handler(request: httpx.Request) -> httpx.Response:
        requests.append(request)
        return json_response(
            {"error": {"code": "slow_down", "message": "Try again."}},
            headers={"retry-after": "0"},
            status_code=503,
        )

    client = CrowNest(
        api_key="cnk_test",
        base_url="https://api.test",
        http_client=httpx.Client(transport=httpx.MockTransport(handler)),
        max_retries=1,
    )

    with pytest.raises(CrowNestApiError) as failure:
        client.commands.cancel("cmd_123")

    assert failure.value.code == "slow_down"
    assert failure.value.retry_after_seconds == 0
    assert failure.value.retryable is True
    assert failure.value.status == 503
    assert len(requests) == 1


@pytest.mark.asyncio
async def test_async_client_extends_sandbox_handles() -> None:
    requests: list[httpx.Request] = []

    async def handler(request: httpx.Request) -> httpx.Response:
        requests.append(request)
        if request.url.path == "/v1/sandboxes":
            return json_response({"sandbox": sandbox_body()})
        if request.url.path == "/v1/sandboxes/sbx_123/ttl":
            return json_response({"sandbox": sandbox_body(ttlMs=5_400_000)})
        if request.url.path == "/v1/commands/cmd_123/cancel":
            return json_response({"command": command_body(status="canceled")})
        raise AssertionError(f"unexpected request: {request.method} {request.url}")

    async with AsyncCrowNest(
        api_key="cnk_test",
        base_url="https://api.test",
        http_client=httpx.AsyncClient(transport=httpx.MockTransport(handler)),
    ) as client:
        sandbox = await client.sandboxes.create(project_id="prj_123")
        extended = await sandbox.set_ttl(
            ttl_ms=5_400_000,
            idempotency_key="async-ttl-key",
        )
        canceled = await extended.commands.cancel("cmd_123", mode="force")

    assert extended["ttlMs"] == 5_400_000
    assert canceled["status"] == "canceled"
    assert requests[1].headers["idempotency-key"] == "async-ttl-key"
    assert json.loads(requests[1].content) == {"ttlMs": 5_400_000}
    assert requests[2].url.path == "/v1/commands/cmd_123/cancel"
    assert json.loads(requests[2].content) == {"mode": "force"}


def test_file_artifact_project_preview_and_download_routes() -> None:
    requests: list[httpx.Request] = []

    def handler(request: httpx.Request) -> httpx.Response:
        requests.append(request)
        path = request.url.path
        if path == "/crownest/v1/sandboxes/sbx_123/files":
            return json_response({"file": file_body()})
        if path == "/crownest/v1/sandboxes/sbx_123/files/read":
            return json_response({"content": "hello", "encoding": "utf8"})
        if path == "/crownest/v1/sandboxes/sbx_123/files/mkdir":
            return json_response({"file": directory_body()})
        if path == "/crownest/v1/sandboxes/sbx_123/files/move":
            return json_response({"file": file_body(path="/workspace/renamed.txt")})
        if path == "/crownest/v1/sandboxes/sbx_123/files/stat":
            return json_response({"file": file_body()})
        if path == "/crownest/v1/sandboxes/sbx_123/files/download-url":
            return json_response(
                {"authMode": "api_key", "method": "GET", "url": "https://download"}
            )
        if path == "/crownest/v1/sandboxes/sbx_123/artifacts":
            return json_response({"data": [artifact_body()], "hasMore": False})
        if path == "/crownest/v1/artifacts/art_123/download-url":
            return json_response(
                {
                    "authMode": "api_key",
                    "headers": {"x-content-type-options": "nosniff"},
                    "method": "GET",
                    "url": "https://download",
                }
            )
        if path == "/crownest/v1/artifacts/art_123/download":
            return httpx.Response(200, content=b"artifact-bytes")
        if path == "/crownest/v1/projects" and request.method == "GET":
            return json_response({"data": [project_body()], "hasMore": False})
        if path == "/crownest/v1/projects" and request.method == "POST":
            return json_response({"project": project_body(project_id="prj_created")})
        if path == "/crownest/v1/sandboxes/sbx_123/previews":
            return json_response(
                {"preview": preview_body(auth_mode="token"), "previewToken": "pvt_sync"}
            )
        raise AssertionError(f"unexpected request: {request.method} {request.url}")

    client = CrowNest(
        api_key="cnk_test",
        base_url="https://api.test/crownest",
        http_client=httpx.Client(transport=httpx.MockTransport(handler)),
    )

    assert client.files.write("sbx_123", "/workspace/input.txt", "hello")["path"]
    assert client.files.read("sbx_123", "/workspace/input.txt") == "hello"
    assert client.files.mkdir("sbx_123", "/workspace/data", parents=True)["type"]
    assert client.files.move(
        "sbx_123", "/workspace/input.txt", "/workspace/renamed.txt"
    )
    assert client.files.stat("sbx_123", "/workspace/input.txt")["sizeBytes"] == 5
    assert (
        client.files.download_url("sbx_123", "/workspace/input.txt")["method"] == "GET"
    )
    assert client.artifacts.list("sbx_123")["data"][0]["id"] == "art_123"
    assert client.artifacts.download_url("art_123")["method"] == "GET"
    assert client.artifacts.download("art_123") == b"artifact-bytes"
    assert client.projects.list()["data"][0]["id"] == "prj_123"
    assert client.projects.create(name="Agent Workspace")["id"] == "prj_created"
    preview_create = client.previews.create("sbx_123", port=8080, auth_mode="token")
    assert preview_create["preview"]["id"] == "prv_123"
    assert preview_create["preview"]["authMode"] == "token"
    assert preview_create["previewToken"] == "pvt_sync"
    assert requests[0].url.path == "/crownest/v1/sandboxes/sbx_123/files"


def test_sync_crud_completion_routes() -> None:
    requests: list[httpx.Request] = []
    api_key = api_key_body()
    context = code_context_body()

    def handler(request: httpx.Request) -> httpx.Response:
        requests.append(request)
        path = request.url.path
        if path == "/v1/api-keys":
            return json_response({"data": [api_key], "hasMore": False})
        if path == "/v1/api-keys/key_123":
            return json_response({"apiKey": api_key})
        if path == "/v1/projects":
            return json_response({"project": project_body(project_id="prj_created")})
        if path == "/v1/sandboxes/sbx_123/code/contexts":
            return json_response({"data": [context], "hasMore": False})
        if path == "/v1/sandboxes/sbx_123/code/contexts/cctx_123":
            return json_response({"context": context})
        if path == "/v1/sandboxes/sbx_123":
            return json_response({"sandbox": sandbox_body()})
        raise AssertionError(f"unexpected request: {request.method} {request.url}")

    client = CrowNest(
        api_key="cnk_test",
        base_url="https://api.test",
        http_client=httpx.Client(transport=httpx.MockTransport(handler)),
    )

    assert client.api_keys.list()["data"][0]["id"] == "key_123"
    assert client.api_keys.get("key_123")["id"] == "key_123"
    assert client.api_keys.revoke("key_123")["id"] == "key_123"
    assert client.projects.create(name="Agent Workspace")["id"] == "prj_created"
    assert client.code.list_contexts("sbx_123")["data"][0]["id"] == "cctx_123"
    assert client.code.get_context("sbx_123", "cctx_123")["id"] == "cctx_123"
    sandbox = client.sandboxes.get("sbx_123")
    assert sandbox.code.list_contexts()["data"][0]["id"] == "cctx_123"
    assert sandbox.code.get_context("cctx_123")["id"] == "cctx_123"

    assert [request.method for request in requests[:4]] == [
        "GET",
        "GET",
        "DELETE",
        "POST",
    ]
    assert json.loads(requests[3].content) == {"name": "Agent Workspace"}


def test_sync_sandbox_handles_expose_symmetric_helpers() -> None:
    requests: list[httpx.Request] = []

    def handler(request: httpx.Request) -> httpx.Response:
        requests.append(request)
        path = request.url.path
        if path == "/v1/sandboxes" and request.method == "GET":
            return json_response(
                {"data": [sandbox_body(status="creating")], "hasMore": False}
            )
        if path == "/v1/sandboxes/sbx_123" and request.method == "DELETE":
            return json_response({"sandbox": sandbox_body(status="destroyed")})
        if path == "/v1/sandboxes/sbx_123" and request.method == "GET":
            return json_response({"sandbox": sandbox_body(status="ready")})
        if path == "/v1/commands/cmd_123":
            return json_response({"command": command_body(status="running")})
        if path == "/v1/commands/cmd_123/logs":
            return json_response(
                {
                    "data": [
                        {
                            "commandId": "cmd_123",
                            "createdAt": "now",
                            "data": "ready\n",
                            "seq": 1,
                            "stream": "stdout",
                        }
                    ],
                    "hasMore": False,
                }
            )
        if path == "/v1/artifacts/art_123":
            return json_response({"artifact": artifact_body()})
        if path == "/v1/artifacts/art_123/download-url":
            return json_response(
                {"authMode": "api_key", "method": "GET", "url": "https://download"}
            )
        if path == "/v1/artifacts/art_123/download":
            return httpx.Response(200, content=b"artifact-bytes")
        if path == "/v1/previews/prv_123":
            return json_response({"preview": preview_body(auth_mode="token")})
        raise AssertionError(f"unexpected request: {request.method} {request.url}")

    client = CrowNest(
        api_key="cnk_test",
        base_url="https://api.test",
        http_client=httpx.Client(transport=httpx.MockTransport(handler)),
    )

    listed = client.sandboxes.list()["data"][0]
    assert listed.commands.get("cmd_123")["status"] == "running"
    assert listed.commands.logs("cmd_123")["data"][0]["seq"] == 1
    assert listed.artifacts.get("art_123")["id"] == "art_123"
    assert listed.artifacts.download_url("art_123")["method"] == "GET"
    assert listed.artifacts.download("art_123") == b"artifact-bytes"
    assert listed.artifacts.delete("art_123")["id"] == "art_123"
    assert listed.previews.get("prv_123")["authMode"] == "token"
    assert listed.previews.revoke("prv_123")["id"] == "prv_123"
    assert (
        listed.wait_until_ready(interval_seconds=0, timeout_seconds=1)["status"]
        == "ready"
    )
    assert client.sandboxes.kill("sbx_123").status == "destroyed"


@pytest.mark.asyncio
async def test_async_crud_completion_routes() -> None:
    requests: list[httpx.Request] = []
    api_key = api_key_body()
    context = code_context_body()

    async def handler(request: httpx.Request) -> httpx.Response:
        requests.append(request)
        path = request.url.path
        if path == "/v1/api-keys":
            return json_response({"data": [api_key], "hasMore": False})
        if path == "/v1/api-keys/key_123":
            return json_response({"apiKey": api_key})
        if path == "/v1/projects":
            return json_response({"project": project_body(project_id="prj_created")})
        if path == "/v1/sandboxes/sbx_123/code/contexts":
            return json_response({"data": [context], "hasMore": False})
        if path == "/v1/sandboxes/sbx_123/code/contexts/cctx_123":
            return json_response({"context": context})
        if path == "/v1/sandboxes/sbx_123":
            return json_response({"sandbox": sandbox_body()})
        raise AssertionError(f"unexpected request: {request.method} {request.url}")

    async with AsyncCrowNest(
        api_key="cnk_test",
        base_url="https://api.test",
        http_client=httpx.AsyncClient(transport=httpx.MockTransport(handler)),
    ) as client:
        assert (await client.api_keys.list())["data"][0]["id"] == "key_123"
        assert (await client.api_keys.get("key_123"))["id"] == "key_123"
        assert (await client.api_keys.revoke("key_123"))["id"] == "key_123"
        assert (await client.projects.create(name="Agent Workspace"))[
            "id"
        ] == "prj_created"
        assert (await client.code.list_contexts("sbx_123"))["data"][0][
            "id"
        ] == "cctx_123"
        assert (await client.code.get_context("sbx_123", "cctx_123"))[
            "id"
        ] == "cctx_123"
        sandbox = await client.sandboxes.get("sbx_123")
        assert (await sandbox.code.list_contexts())["data"][0]["id"] == "cctx_123"
        assert (await sandbox.code.get_context("cctx_123"))["id"] == "cctx_123"

    assert [request.method for request in requests[:4]] == [
        "GET",
        "GET",
        "DELETE",
        "POST",
    ]


@pytest.mark.asyncio
async def test_async_preview_create_returns_token_envelope() -> None:
    requests: list[httpx.Request] = []

    async def handler(request: httpx.Request) -> httpx.Response:
        requests.append(request)
        if request.url.path == "/v1/sandboxes/sbx_123/previews":
            return json_response(
                {
                    "preview": preview_body(auth_mode="token"),
                    "previewToken": "pvt_async",
                }
            )
        raise AssertionError(f"unexpected request: {request.method} {request.url}")

    async with AsyncCrowNest(
        api_key="cnk_test",
        base_url="https://api.test",
        http_client=httpx.AsyncClient(transport=httpx.MockTransport(handler)),
    ) as client:
        created = await client.previews.create("sbx_123", port=8080, auth_mode="token")

    assert created["preview"]["authMode"] == "token"
    assert created["previewToken"] == "pvt_async"
    assert json.loads(requests[0].content) == {"authMode": "token", "port": 8080}


def test_usage_metadata_filters_and_byte_helpers() -> None:
    requests: list[httpx.Request] = []

    def handler(request: httpx.Request) -> httpx.Response:
        requests.append(request)
        path = request.url.path
        if path == "/v1/usage":
            return json_response(
                {
                    "computeUnitSeconds": {"used": 42},
                    "computeUnitSecondsPerCredit": 1000,
                    "credits": {"used": 1},
                    "period": {
                        "end": "2026-07-01T00:00:00.000Z",
                        "resetAt": "2026-07-01T00:00:00.000Z",
                        "start": "2026-06-01T00:00:00.000Z",
                    },
                    "pricingVersion": "beta",
                    "quotas": {},
                }
            )
        if path == "/v1/sandboxes":
            return json_response({"data": [sandbox_body()], "hasMore": False})
        if path == "/v1/sandboxes/sbx_123/files":
            return json_response({"file": file_body(path="/workspace/blob.bin")})
        if path == "/v1/sandboxes/sbx_123/files/read":
            return json_response({"content": "AP8Q", "encoding": "base64"})
        raise AssertionError(f"unexpected request: {request.method} {request.url}")

    client = CrowNest(
        api_key="cnk_test",
        base_url="https://api.test",
        http_client=httpx.Client(transport=httpx.MockTransport(handler)),
    )

    assert client.usage()["computeUnitSeconds"]["used"] == 42
    assert (
        client.sandboxes.list(metadata={"agent.id": "codex/1"})["data"][0]["id"]
        == "sbx_123"
    )
    assert client.files.write_bytes("sbx_123", "/workspace/blob.bin", b"\x00\xff\x10")[
        "path"
    ]
    assert client.files.read_bytes("sbx_123", "/workspace/blob.bin") == b"\x00\xff\x10"
    assert requests[1].url.query == b"metadata.agent.id=codex%2F1"
    assert json.loads(requests[2].content) == {
        "content": "AP8Q",
        "encoding": "base64",
        "path": "/workspace/blob.bin",
    }
    assert requests[3].url.query == b"path=%2Fworkspace%2Fblob.bin&encoding=base64"


def test_sync_code_interpreter_routes() -> None:
    requests: list[httpx.Request] = []

    def handler(request: httpx.Request) -> httpx.Response:
        requests.append(request)
        path = request.url.path
        if path == "/v1/sandboxes":
            return json_response({"sandbox": sandbox_body()})
        if path == "/v1/sandboxes/sbx_123/code/contexts":
            return httpx.Response(201, json={"context": code_context_body()})
        if path == "/v1/sandboxes/sbx_123/code/runs":
            return json_response({"run": code_run_body()})
        if path == "/v1/sandboxes/sbx_123/code/runs/stream":
            return httpx.Response(
                200,
                text='event: stdout\ndata: {"type":"stdout","data":"ready\\n"}\n\n',
                headers={"content-type": "text/event-stream"},
            )
        if path == "/v1/sandboxes/sbx_123/code/contexts/cctx_123":
            return json_response({"context": code_context_body()})
        raise AssertionError(f"unexpected request: {request.method} {request.url}")

    client = CrowNest(
        api_key="cnk_test",
        base_url="https://api.test",
        http_client=httpx.Client(transport=httpx.MockTransport(handler)),
    )

    sandbox = client.sandboxes.create(template="python-node")
    context = sandbox.code.create_context(
        cwd="/workspace", language="typescript", timeout_ms=30_000
    )
    run = sandbox.code.run(
        "print('hi')",
        artifact_policy="promote",
        context_id="cctx_123",
        language="javascript",
    )
    events = list(
        sandbox.code.run_stream(
            "print('ready')", idempotency_key="stream-key", language="python"
        )
    )
    deleted = sandbox.code.delete_context("cctx_123")

    assert context["id"] == "cctx_123"
    assert run["executionCount"] == 1
    assert events == [{"type": "stdout", "data": "ready\n"}]
    assert deleted["id"] == "cctx_123"
    assert requests[1].method == "POST"
    assert requests[1].headers["idempotency-key"]
    assert json.loads(requests[1].content) == {
        "cwd": "/workspace",
        "language": "typescript",
        "timeoutMs": 30_000,
    }
    assert requests[2].method == "POST"
    assert requests[2].headers["idempotency-key"]
    assert json.loads(requests[2].content) == {
        "artifactPolicy": "promote",
        "code": "print('hi')",
        "contextId": "cctx_123",
        "language": "javascript",
    }
    assert requests[3].method == "POST"
    assert requests[3].url.path == "/v1/sandboxes/sbx_123/code/runs/stream"
    assert requests[3].headers["idempotency-key"] == "stream-key"
    assert json.loads(requests[3].content) == {
        "code": "print('ready')",
        "language": "python",
    }
    assert requests[4].method == "DELETE"
    assert requests[4].url.path == "/v1/sandboxes/sbx_123/code/contexts/cctx_123"
    assert "idempotency-key" not in requests[4].headers


def test_sync_root_code_client_routes() -> None:
    requests: list[httpx.Request] = []

    def handler(request: httpx.Request) -> httpx.Response:
        requests.append(request)
        path = request.url.path
        if path == "/v1/sandboxes/sbx_123/code/contexts":
            return httpx.Response(201, json={"context": code_context_body()})
        if path == "/v1/sandboxes/sbx_123/code/runs":
            return json_response({"run": code_run_body()})
        if path == "/v1/sandboxes/sbx_123/code/runs/stream":
            return httpx.Response(
                200,
                text='event: stdout\ndata: {"type":"stdout","data":"ready\\n"}\n\n',
                headers={"content-type": "text/event-stream"},
            )
        if path == "/v1/sandboxes/sbx_123/code/contexts/cctx_123":
            return json_response({"context": code_context_body()})
        raise AssertionError(f"unexpected request: {request.method} {request.url}")

    client = CrowNest(
        api_key="cnk_test",
        base_url="https://api.test",
        http_client=httpx.Client(transport=httpx.MockTransport(handler)),
    )

    context = client.code.create_context(
        "sbx_123",
        idempotency_key="context-key",
        language="typescript",
    )
    run = client.code.run(
        "sbx_123",
        "console.log('hi')",
        idempotency_key="run-key",
        language="javascript",
    )
    events = list(
        client.code.run_stream(
            "sbx_123",
            "print('ready')",
            idempotency_key="stream-key",
        )
    )
    deleted = client.code.delete_context("sbx_123", "cctx_123")

    assert context["id"] == "cctx_123"
    assert run["executionCount"] == 1
    assert events == [{"type": "stdout", "data": "ready\n"}]
    assert deleted["id"] == "cctx_123"
    assert requests[0].headers["idempotency-key"] == "context-key"
    assert json.loads(requests[0].content) == {"language": "typescript"}
    assert requests[1].headers["idempotency-key"] == "run-key"
    assert json.loads(requests[1].content) == {
        "code": "console.log('hi')",
        "language": "javascript",
    }
    assert requests[2].headers["idempotency-key"] == "stream-key"
    assert json.loads(requests[2].content) == {
        "code": "print('ready')",
        "language": "python",
    }
    assert requests[3].method == "DELETE"
    assert requests[3].url.path == "/v1/sandboxes/sbx_123/code/contexts/cctx_123"


@pytest.mark.asyncio
async def test_async_code_interpreter_routes() -> None:
    requests: list[httpx.Request] = []

    async def handler(request: httpx.Request) -> httpx.Response:
        requests.append(request)
        path = request.url.path
        if path == "/v1/sandboxes":
            return json_response({"sandbox": sandbox_body()})
        if path == "/v1/sandboxes/sbx_123/code/contexts":
            return httpx.Response(201, json={"context": code_context_body()})
        if path == "/v1/sandboxes/sbx_123/code/runs":
            return json_response({"run": code_run_body()})
        if path == "/v1/sandboxes/sbx_123/code/runs/stream":
            return httpx.Response(
                200,
                text='event: stdout\ndata: {"type":"stdout","data":"ready\\n"}\n\n',
                headers={"content-type": "text/event-stream"},
            )
        if path == "/v1/sandboxes/sbx_123/code/contexts/cctx_123":
            return json_response({"context": code_context_body()})
        raise AssertionError(f"unexpected request: {request.method} {request.url}")

    async with AsyncCrowNest(
        api_key="cnk_test",
        base_url="https://api.test",
        http_client=httpx.AsyncClient(transport=httpx.MockTransport(handler)),
    ) as client:
        sandbox = await client.sandboxes.create(template="python-node")
        context = await sandbox.code.create_context(
            idempotency_key="context-key", language="typescript"
        )
        run = await sandbox.code.run(
            "print('hi')", idempotency_key="run-key", language="javascript"
        )
        events = [
            event
            async for event in sandbox.code.run_stream(
                "print('ready')",
                idempotency_key="stream-key",
                language="python",
            )
        ]
        deleted = await sandbox.code.delete_context("cctx_123")

    assert context["id"] == "cctx_123"
    assert run["executionCount"] == 1
    assert events == [{"type": "stdout", "data": "ready\n"}]
    assert deleted["id"] == "cctx_123"
    assert requests[1].headers["idempotency-key"] == "context-key"
    assert json.loads(requests[1].content) == {"language": "typescript"}
    assert requests[2].headers["idempotency-key"] == "run-key"
    assert json.loads(requests[2].content) == {
        "code": "print('hi')",
        "language": "javascript",
    }
    assert requests[3].headers["idempotency-key"] == "stream-key"
    assert json.loads(requests[3].content) == {
        "code": "print('ready')",
        "language": "python",
    }
    assert requests[4].method == "DELETE"
    assert requests[4].url.path == "/v1/sandboxes/sbx_123/code/contexts/cctx_123"


@pytest.mark.asyncio
async def test_async_root_code_client_routes() -> None:
    requests: list[httpx.Request] = []

    async def handler(request: httpx.Request) -> httpx.Response:
        requests.append(request)
        path = request.url.path
        if path == "/v1/sandboxes/sbx_123/code/contexts":
            return httpx.Response(201, json={"context": code_context_body()})
        if path == "/v1/sandboxes/sbx_123/code/runs":
            return json_response({"run": code_run_body()})
        if path == "/v1/sandboxes/sbx_123/code/runs/stream":
            return httpx.Response(
                200,
                text='event: stdout\ndata: {"type":"stdout","data":"ready\\n"}\n\n',
                headers={"content-type": "text/event-stream"},
            )
        if path == "/v1/sandboxes/sbx_123/code/contexts/cctx_123":
            return json_response({"context": code_context_body()})
        raise AssertionError(f"unexpected request: {request.method} {request.url}")

    async with AsyncCrowNest(
        api_key="cnk_test",
        base_url="https://api.test",
        http_client=httpx.AsyncClient(transport=httpx.MockTransport(handler)),
    ) as client:
        context = await client.code.create_context(
            "sbx_123",
            idempotency_key="context-key",
            language="typescript",
        )
        run = await client.code.run(
            "sbx_123",
            "console.log('hi')",
            idempotency_key="run-key",
            language="javascript",
        )
        events = [
            event
            async for event in client.code.run_stream(
                "sbx_123",
                "print('ready')",
                idempotency_key="stream-key",
            )
        ]
        deleted = await client.code.delete_context("sbx_123", "cctx_123")

    assert context["id"] == "cctx_123"
    assert run["executionCount"] == 1
    assert events == [{"type": "stdout", "data": "ready\n"}]
    assert deleted["id"] == "cctx_123"
    assert requests[0].headers["idempotency-key"] == "context-key"
    assert json.loads(requests[0].content) == {"language": "typescript"}
    assert requests[1].headers["idempotency-key"] == "run-key"
    assert json.loads(requests[1].content) == {
        "code": "console.log('hi')",
        "language": "javascript",
    }
    assert requests[2].headers["idempotency-key"] == "stream-key"
    assert json.loads(requests[2].content) == {
        "code": "print('ready')",
        "language": "python",
    }
    assert requests[3].method == "DELETE"
    assert requests[3].url.path == "/v1/sandboxes/sbx_123/code/contexts/cctx_123"


def test_env_api_key_fallback_and_fail_fast(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.delenv("CROWNEST_API_KEY", raising=False)
    monkeypatch.delenv("CROWNEST_BEARER_TOKEN", raising=False)

    with pytest.raises(ValueError, match="CROWNEST_BEARER_TOKEN"):
        CrowNest()

    requests: list[httpx.Request] = []

    def handler(request: httpx.Request) -> httpx.Response:
        requests.append(request)
        return json_response({"data": [], "hasMore": False})

    monkeypatch.setenv("CROWNEST_API_KEY", "cnk_env")
    client = CrowNest(http_client=httpx.Client(transport=httpx.MockTransport(handler)))

    assert client.sandboxes.list() == {"data": [], "hasMore": False}
    assert requests[0].headers["authorization"] == "Bearer cnk_env"

    requests.clear()
    monkeypatch.setenv("CROWNEST_BEARER_TOKEN", "bearer_env")
    client = CrowNest(http_client=httpx.Client(transport=httpx.MockTransport(handler)))

    assert client.sandboxes.list() == {"data": [], "hasMore": False}
    assert requests[0].headers["authorization"] == "Bearer bearer_env"


def test_explicit_credential_alias_is_used_for_python_client() -> None:
    requests: list[httpx.Request] = []

    def handler(request: httpx.Request) -> httpx.Response:
        requests.append(request)
        return json_response({"data": [], "hasMore": False})

    client = CrowNest(
        credential="bearer_option",
        http_client=httpx.Client(transport=httpx.MockTransport(handler)),
    )

    assert client.sandboxes.list() == {"data": [], "hasMore": False}
    assert requests[0].headers["authorization"] == "Bearer bearer_option"


def test_non_json_errors_raise_structured_api_error() -> None:
    client = CrowNest(
        api_key="cnk_test",
        http_client=httpx.Client(
            transport=httpx.MockTransport(
                lambda _request: httpx.Response(
                    502,
                    content=b"<html>Bad Gateway</html>",
                    headers={"content-type": "text/html"},
                )
            )
        ),
    )

    with pytest.raises(CrowNestApiError) as failure:
        client.sandboxes.list()

    assert failure.value.status == 502
    assert failure.value.code == "invalid_error_response"


def test_api_errors_capture_request_id_and_derive_retryability_from_code() -> None:
    client = CrowNest(
        api_key="cnk_test",
        max_retries=0,
        http_client=httpx.Client(
            transport=httpx.MockTransport(
                lambda _request: json_response(
                    {
                        "error": {
                            "code": "idempotency_request_in_progress",
                            "message": "Still processing.",
                        }
                    },
                    headers={"x-request-id": "req_123"},
                    status_code=409,
                )
            )
        ),
    )

    with pytest.raises(CrowNestApiError) as failure:
        client.sandboxes.list()

    assert failure.value.request_id == "req_123"
    assert failure.value.retryable is True


def test_sync_pages_expose_cursors_and_iterate_across_pages() -> None:
    requests: list[httpx.Request] = []

    def handler(request: httpx.Request) -> httpx.Response:
        requests.append(request)
        if request.url.params.get("cursor") == "next_1":
            return json_response({"data": [sandbox_body(id="sbx_2")], "hasMore": False})
        return json_response(
            {
                "data": [sandbox_body(id="sbx_1")],
                "hasMore": True,
                "nextCursor": "next_1",
            }
        )

    client = CrowNest(
        api_key="cnk_test",
        base_url="https://api.test",
        http_client=httpx.Client(transport=httpx.MockTransport(handler)),
    )
    page = client.sandboxes.list(limit=1)

    assert page.data[0].id == "sbx_1"
    assert page.has_more is True
    assert page.next_cursor == "next_1"
    assert [sandbox.id for sandbox in page] == ["sbx_1", "sbx_2"]
    assert requests[0].url.params["limit"] == "1"
    assert requests[1].url.params["cursor"] == "next_1"


def test_sync_page_iteration_rejects_repeated_cursors() -> None:
    def handler(request: httpx.Request) -> httpx.Response:
        return json_response(
            {
                "data": [sandbox_body(id="sbx_1")],
                "hasMore": True,
                "nextCursor": "next_loop",
            }
        )

    client = CrowNest(
        api_key="cnk_test",
        base_url="https://api.test",
        http_client=httpx.Client(transport=httpx.MockTransport(handler)),
    )
    page = client.sandboxes.list(limit=1)

    with pytest.raises(RuntimeError, match="repeated pagination cursor"):
        list(page)


@pytest.mark.asyncio
async def test_async_page_iteration_rejects_repeated_cursors() -> None:
    async def handler(request: httpx.Request) -> httpx.Response:
        return json_response(
            {
                "data": [project_body("prj_1")],
                "hasMore": True,
                "nextCursor": "next_loop",
            }
        )

    async with AsyncCrowNest(
        api_key="cnk_test",
        base_url="https://api.test",
        http_client=httpx.AsyncClient(transport=httpx.MockTransport(handler)),
    ) as client:
        page = await client.projects.list(limit=1)
        with pytest.raises(RuntimeError, match="repeated pagination cursor"):
            _ = [project async for project in page]


@pytest.mark.asyncio
async def test_async_pages_iterate_across_pages() -> None:
    async def handler(request: httpx.Request) -> httpx.Response:
        if request.url.params.get("cursor") == "next_1":
            return json_response({"data": [project_body("prj_2")], "hasMore": False})
        return json_response(
            {
                "data": [project_body("prj_1")],
                "hasMore": True,
                "nextCursor": "next_1",
            }
        )

    async with AsyncCrowNest(
        api_key="cnk_test",
        base_url="https://api.test",
        http_client=httpx.AsyncClient(transport=httpx.MockTransport(handler)),
    ) as client:
        page = await client.projects.list(limit=1)
        project_ids = [project["id"] async for project in page]

    assert project_ids == ["prj_1", "prj_2"]


def test_workspace_run_convenience_uses_direct_upload_and_waits() -> None:
    requests: list[httpx.Request] = []

    def handler(request: httpx.Request) -> httpx.Response:
        requests.append(request)
        if request.url.path == "/v1/workspace-runs":
            return json_response({"workspaceRun": workspace_run_body()})
        if request.url.path.endswith("/archive"):
            return json_response(
                {"workspaceRun": workspace_run_body("archive_uploaded")}
            )
        if request.url.path.endswith("/start"):
            return json_response({"workspaceRun": workspace_run_body("running")})
        if request.url.path.endswith("/wsr_123"):
            return json_response({"workspaceRun": workspace_run_body("succeeded")})
        raise AssertionError(f"unexpected request: {request.method} {request.url}")

    client = CrowNest(
        api_key="cnk_test",
        base_url="https://api.test",
        http_client=httpx.Client(transport=httpx.MockTransport(handler)),
    )
    result = client.workspace_runs.run(b"archive", command="pytest -q")

    assert result["status"] == "succeeded"
    assert [request.url.path for request in requests] == [
        "/v1/workspace-runs",
        "/v1/workspace-runs/wsr_123/archive",
        "/v1/workspace-runs/wsr_123/start",
        "/v1/workspace-runs/wsr_123",
    ]
    assert requests[1].headers["x-crownest-archive-size"] == "7"


def test_unexpected_json_error_envelopes_preserve_response_body() -> None:
    client = CrowNest(
        api_key="cnk_test",
        http_client=httpx.Client(
            transport=httpx.MockTransport(
                lambda _request: httpx.Response(
                    500,
                    json={"details": {"requestId": "req_123"}},
                )
            )
        ),
    )

    with pytest.raises(CrowNestApiError) as failure:
        client.sandboxes.list()

    assert failure.value.status == 500
    assert failure.value.code == "invalid_error_response"
    assert failure.value.details == {"body": {"details": {"requestId": "req_123"}}}
    assert "unexpected JSON error response" in str(failure.value)


def test_sync_sse_stream_parses_data_payloads() -> None:
    def handler(request: httpx.Request) -> httpx.Response:
        assert request.url.params["afterSeq"] == "1"
        return httpx.Response(
            200,
            content=(
                b": ignored\n\n"
                b'data: {"type":"log","seq":2,"stream":"stdout",'
                b'"data":"ready\\n","createdAt":"2026-06-09T15:30:00.000Z"}\n\n'
                b'data: {"type":"heartbeat","createdAt":"2026-06-09T15:30:01.000Z"}'
            ),
            headers={"content-type": "text/event-stream"},
        )

    client = CrowNest(
        api_key="cnk_test",
        base_url="https://api.test",
        http_client=httpx.Client(transport=httpx.MockTransport(handler)),
    )

    events = list(client.commands.stream_logs("cmd_123", after_seq=1, reconnect=False))

    assert events == [
        {
            "type": "log",
            "seq": 2,
            "stream": "stdout",
            "data": "ready\n",
            "createdAt": "2026-06-09T15:30:00.000Z",
        },
        {"type": "heartbeat", "createdAt": "2026-06-09T15:30:01.000Z"},
    ]


def test_sync_sse_stream_reconnects_from_last_sequence() -> None:
    requests: list[httpx.Request] = []

    def first_then_reconnect(request: httpx.Request) -> httpx.Response:
        requests.append(request)
        if "afterSeq=1" in str(request.url):
            return httpx.Response(
                200,
                content=(
                    b'data: {"type":"log","seq":2,"stream":"stdout",'
                    b'"data":"again\\n","createdAt":"now"}\n\n'
                    b'data: {"type":"terminal","createdAt":"now","command":'
                    + json.dumps(command_body()).encode()
                    + b"}\n\n"
                ),
                headers={"content-type": "text/event-stream"},
            )
        return httpx.Response(
            200,
            stream=FailingByteStream(
                b'data: {"type":"log","seq":1,"stream":"stdout",'
                b'"data":"ready\\n","createdAt":"now"}\n\n'
            ),
            headers={"content-type": "text/event-stream"},
        )

    requests.clear()
    reconnecting_client = CrowNest(
        api_key="cnk_test",
        base_url="https://api.test",
        http_client=httpx.Client(transport=httpx.MockTransport(first_then_reconnect)),
    )
    events = list(reconnecting_client.commands.stream_logs("cmd_123"))

    assert [event.get("seq", event["type"]) for event in events] == [1, 2, "terminal"]
    assert str(requests[1].url).endswith("/v1/commands/cmd_123/stream?afterSeq=1")


def test_sync_sse_stream_reconnects_after_clean_close_before_terminal(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    requests: list[httpx.Request] = []
    monkeypatch.setattr(resources, "_STREAM_RECONNECT_DELAYS", (0, 0, 0, 0, 0))

    def first_then_reconnect(request: httpx.Request) -> httpx.Response:
        requests.append(request)
        if request.url.params.get("afterSeq") == "1":
            return httpx.Response(
                200,
                content=(
                    b'data: {"type":"log","seq":2,"stream":"stdout",'
                    b'"data":"again\\n","createdAt":"now"}\n\n'
                    b'data: {"type":"terminal","createdAt":"now","command":'
                    + json.dumps(command_body()).encode()
                    + b"}\n\n"
                ),
                headers={"content-type": "text/event-stream"},
            )
        return httpx.Response(
            200,
            content=(
                b'data: {"type":"log","seq":1,"stream":"stdout",'
                b'"data":"ready\\n","createdAt":"now"}\n\n'
            ),
            headers={"content-type": "text/event-stream"},
        )

    client = CrowNest(
        api_key="cnk_test",
        base_url="https://api.test",
        http_client=httpx.Client(transport=httpx.MockTransport(first_then_reconnect)),
    )

    events = list(client.commands.stream_logs("cmd_123"))

    assert [event.get("seq", event["type"]) for event in events] == [1, 2, "terminal"]
    assert str(requests[1].url).endswith("/v1/commands/cmd_123/stream?afterSeq=1")


def test_sync_sse_stream_does_not_reset_retries_on_heartbeat_only_failure(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    requests: list[httpx.Request] = []
    monkeypatch.setattr(resources, "_STREAM_RECONNECT_DELAYS", (0, 0, 0, 0, 0))

    def heartbeat_then_fail(request: httpx.Request) -> httpx.Response:
        requests.append(request)
        return httpx.Response(
            200,
            stream=FailingByteStream(
                b'data: {"type":"heartbeat","createdAt":"now"}\n\n'
            ),
            headers={"content-type": "text/event-stream"},
        )

    client = CrowNest(
        api_key="cnk_test",
        base_url="https://api.test",
        http_client=httpx.Client(transport=httpx.MockTransport(heartbeat_then_fail)),
    )

    with pytest.raises(httpx.TransportError, match="network reset"):
        list(client.commands.stream_logs("cmd_123"))

    assert len(requests) == 6
    assert {request.url.query for request in requests} == {b""}


def test_sync_run_callbacks_dispatch_chunks_and_return_terminal_command() -> None:
    stdout: list[str] = []
    stderr: list[str] = []
    requests: list[httpx.Request] = []

    def handler(request: httpx.Request) -> httpx.Response:
        requests.append(request)
        if request.url.path == "/v1/sandboxes/sbx_123/commands":
            return json_response({"command": command_body(status="running")})
        if request.url.path == "/v1/commands/cmd_123/stream":
            return httpx.Response(
                200,
                content=(
                    b'data: {"type":"log","seq":1,"stream":"stdout",'
                    b'"data":"out\\n","createdAt":"now"}\n\n'
                    b'data: {"type":"log","seq":2,"stream":"stderr",'
                    b'"data":"err\\n","createdAt":"now"}\n\n'
                    b'data: {"type":"terminal","createdAt":"now","command":'
                    + json.dumps(command_body()).encode()
                    + b"}\n\n"
                ),
                headers={"content-type": "text/event-stream"},
            )
        if request.url.path == "/v1/commands/cmd_123":
            return json_response({"command": command_body()})
        raise AssertionError(f"unexpected request: {request.method} {request.url}")

    client = CrowNest(
        api_key="cnk_test",
        base_url="https://api.test",
        http_client=httpx.Client(transport=httpx.MockTransport(handler)),
    )

    command = client.commands.run(
        "sbx_123",
        "python main.py",
        on_stdout=stdout.append,
        on_stderr=stderr.append,
    )

    assert command["status"] == "exited"
    assert stdout == ["out\n"]
    assert stderr == ["err\n"]
    assert json.loads(requests[0].content) == {
        "_crownestRequireCommandRead": True,
        "background": True,
        "command": "python main.py",
        "timeoutMs": 60_000,
    }

    requests.clear()
    stdout.clear()

    def collect_handler(request: httpx.Request) -> httpx.Response:
        requests.append(request)
        if request.url.path == "/v1/sandboxes/sbx_123/commands":
            return json_response(
                {
                    "command": {
                        **command_body(status="exited"),
                        "collectStatus": "succeeded",
                    }
                }
            )
        if request.url.path == "/v1/commands/cmd_123/logs":
            return json_response(
                {
                    "data": [
                        {
                            "commandId": "cmd_123",
                            "createdAt": "now",
                            "data": "collected\n",
                            "seq": 1,
                            "stream": "stdout",
                        }
                    ],
                    "hasMore": False,
                }
            )
        raise AssertionError(f"unexpected request: {request.method} {request.url}")

    collect_client = CrowNest(
        api_key="cnk_test",
        base_url="https://api.test",
        http_client=httpx.Client(transport=httpx.MockTransport(collect_handler)),
    )
    collected = collect_client.commands.run(
        "sbx_123",
        "python main.py",
        collect=[{"path": "/workspace/output.txt"}],
        collect_on="always",
        on_stdout=stdout.append,
    )

    assert collected["collectStatus"] == "succeeded"
    assert stdout == ["collected\n"]
    assert requests[0].url.path == "/v1/sandboxes/sbx_123/commands"
    assert json.loads(requests[0].content) == {
        "_crownestRequireCommandRead": True,
        "background": False,
        "collect": [{"path": "/workspace/output.txt"}],
        "collectOn": "always",
        "command": "python main.py",
    }
    assert requests[1].url.path == "/v1/commands/cmd_123/logs"


def test_sync_sse_stream_parses_structured_api_errors() -> None:
    requests: list[httpx.Request] = []

    def handler(request: httpx.Request) -> httpx.Response:
        requests.append(request)
        return httpx.Response(
            409,
            json={"error": {"code": "stream_gap", "message": "Missing logs."}},
        )

    client = CrowNest(
        api_key="cnk_test",
        base_url="https://api.test",
        http_client=httpx.Client(transport=httpx.MockTransport(handler)),
    )

    with pytest.raises(CrowNestApiError) as failure:
        list(client.commands.stream_logs("cmd_123"))

    assert failure.value.status == 409
    assert failure.value.code == "stream_gap"
    assert len(requests) == 1


@pytest.mark.asyncio
async def test_async_sse_stream_parses_structured_api_errors_without_retry() -> None:
    requests: list[httpx.Request] = []

    async def handler(request: httpx.Request) -> httpx.Response:
        requests.append(request)
        return httpx.Response(
            409,
            json={"error": {"code": "stream_gap", "message": "Missing logs."}},
        )

    async with AsyncCrowNest(
        api_key="cnk_test",
        base_url="https://api.test",
        http_client=httpx.AsyncClient(transport=httpx.MockTransport(handler)),
    ) as client:
        with pytest.raises(CrowNestApiError) as failure:
            async for _event in client.commands.stream_logs("cmd_123"):
                pass

    assert failure.value.status == 409
    assert failure.value.code == "stream_gap"
    assert len(requests) == 1


@pytest.mark.asyncio
async def test_async_sse_stream_reconnects_after_clean_close_before_terminal(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    requests: list[httpx.Request] = []
    monkeypatch.setattr(resources, "_STREAM_RECONNECT_DELAYS", (0, 0, 0, 0, 0))

    async def handler(request: httpx.Request) -> httpx.Response:
        requests.append(request)
        if request.url.params.get("afterSeq") == "1":
            return httpx.Response(
                200,
                content=(
                    b'data: {"type":"log","seq":2,"stream":"stdout",'
                    b'"data":"again\\n","createdAt":"now"}\n\n'
                    b'data: {"type":"terminal","createdAt":"now","command":'
                    + json.dumps(command_body()).encode()
                    + b"}\n\n"
                ),
                headers={"content-type": "text/event-stream"},
            )
        return httpx.Response(
            200,
            content=(
                b'data: {"type":"log","seq":1,"stream":"stdout",'
                b'"data":"ready\\n","createdAt":"now"}\n\n'
            ),
            headers={"content-type": "text/event-stream"},
        )

    async with AsyncCrowNest(
        api_key="cnk_test",
        base_url="https://api.test",
        http_client=httpx.AsyncClient(transport=httpx.MockTransport(handler)),
    ) as client:
        events = []
        async for event in client.commands.stream_logs("cmd_123"):
            events.append(event)

    assert [event.get("seq", event["type"]) for event in events] == [1, 2, "terminal"]
    assert str(requests[1].url).endswith("/v1/commands/cmd_123/stream?afterSeq=1")


@pytest.mark.asyncio
async def test_async_client_surface_and_sse_stream() -> None:
    requests: list[httpx.Request] = []

    async def handler(request: httpx.Request) -> httpx.Response:
        requests.append(request)
        if request.url.path == "/v1/projects":
            return json_response({"data": [project_body()], "hasMore": False})
        if request.url.path == "/v1/sandboxes":
            return json_response({"sandbox": sandbox_body()})
        if request.url.path == "/v1/sandboxes/sbx_123/files":
            return json_response({"file": file_body()})
        if request.url.path == "/v1/sandboxes/sbx_123/commands":
            return json_response({"command": command_body()})
        if request.url.path == "/v1/commands/cmd_123/stream":
            return httpx.Response(
                200,
                content=b'data: {"type":"heartbeat","createdAt":"now"}\n\n',
                headers={"content-type": "text/event-stream"},
            )
        raise AssertionError(f"unexpected request: {request.method} {request.url}")

    async with AsyncCrowNest(
        api_key="cnk_test",
        base_url="https://api.test",
        http_client=httpx.AsyncClient(transport=httpx.MockTransport(handler)),
    ) as client:
        assert (await client.projects.list())["data"][0]["id"] == "prj_123"
        sandbox = await client.sandboxes.create(template="python-node")
        assert sandbox.id == "sbx_123"
        assert (await sandbox.files.write("/workspace/input.txt", "hello"))["path"]
        command = await client.commands.run(
            "sbx_123",
            "python main.py",
            collect=[{"path": "/workspace/output.txt", "name": "output.txt"}],
            collect_on="success",
            timeout_ms=120_000,
        )
        assert command["id"] == "cmd_123"

        events = []
        async for event in client.commands.stream_logs("cmd_123", reconnect=False):
            events.append(event)

    assert events == [{"type": "heartbeat", "createdAt": "now"}]
    assert requests[1].headers["idempotency-key"]
    assert json.loads(requests[1].content) == {"template": "python-node"}
    assert json.loads(requests[2].content) == {
        "content": "hello",
        "path": "/workspace/input.txt",
    }
    assert requests[3].headers["idempotency-key"]
    assert json.loads(requests[3].content) == {
        "background": False,
        "collect": [{"path": "/workspace/output.txt", "name": "output.txt"}],
        "collectOn": "success",
        "command": "python main.py",
        "timeoutMs": 120_000,
    }


def test_sync_workspace_run_routes_and_transfer_auth() -> None:
    requests: list[httpx.Request] = []
    transfer = workspace_run_transfer("https://uploads.test/wsr_123/upl_123")

    def handler(request: httpx.Request) -> httpx.Response:
        requests.append(request)
        path = request.url.path
        if path == "/v1/workspace-runs" and request.method == "POST":
            return json_response({"workspaceRun": workspace_run_body()})
        if path == "/v1/workspace-runs/wsr_123/archive":
            return json_response(
                {
                    "archive": workspace_archive_body(),
                    "workspaceRun": workspace_run_body(status="archive_uploaded"),
                }
            )
        if path == "/v1/workspace-runs/wsr_123/archive-transfer":
            return json_response({"transfer": transfer})
        if str(request.url) == transfer["uploadUrl"]:
            return httpx.Response(204)
        if (
            str(request.url)
            == "https://api.test/v1/workspace-runs/wsr_123/archive-transfer/upl_same"
        ):
            return httpx.Response(204)
        if path == "/v1/workspace-runs/wsr_123/archive/finalize":
            return json_response(
                {
                    "archive": workspace_archive_body(),
                    "workspaceRun": workspace_run_body(status="archive_uploaded"),
                }
            )
        if path == "/v1/workspace-runs/wsr_123/start":
            return json_response({"workspaceRun": workspace_run_body(status="running")})
        if path == "/v1/workspace-runs/wsr_123" and request.method == "GET":
            return json_response({"workspaceRun": workspace_run_body(status="running")})
        if path == "/v1/workspace-runs" and request.method == "GET":
            return json_response({"data": [workspace_run_body()], "hasMore": False})
        if path == "/v1/workspace-runs/wsr_123/events":
            if request.url.params.get("stream") == "true":
                return httpx.Response(
                    200,
                    content=(
                        b'data: {"type":"status","seq":2,"status":"running",'
                        b'"createdAt":"now"}\n\n'
                        b'data: {"type":"terminal","seq":3,"createdAt":"now",'
                        b'"workspaceRun":'
                        + json.dumps(workspace_run_body(status="succeeded")).encode()
                        + b"}\n\n"
                    ),
                    headers={"content-type": "text/event-stream"},
                )
            return json_response(
                {
                    "data": [
                        {
                            "createdAt": "now",
                            "seq": 2,
                            "status": "running",
                            "type": "status",
                        }
                    ],
                    "hasMore": False,
                    "nextSeq": 2,
                }
            )
        if path == "/v1/workspace-runs/wsr_123/cancel":
            return json_response(
                {"workspaceRun": workspace_run_body(status="canceled")}
            )
        if path == "/v1/workspace-runs/wsr_123/evidence":
            return json_response({"evidence": workspace_run_evidence_body()})
        raise AssertionError(f"unexpected request: {request.method} {request.url}")

    client = CrowNest(
        api_key="cnk_test",
        base_url="https://api.test",
        http_client=httpx.Client(transport=httpx.MockTransport(handler)),
    )

    run = client.workspace_runs.create(
        command="pnpm test",
        artifacts=[{"path": "coverage/lcov.info", "name": "coverage"}],
        idempotency_key="create-run",
        keep_sandbox=True,
        metadata={"agent": "codex"},
        project_id="prj_123",
        source_metadata={"branch": "main"},
        template="python-node",
        timeout_ms=120_000,
    )
    direct = client.workspace_runs.upload_archive(
        "wsr_123",
        b"repo",
        sha256="a" * 64,
        size_bytes=4,
        idempotency_key="upload-run",
    )
    created_transfer = client.workspace_runs.create_archive_transfer(
        "wsr_123",
        sha256="a" * 64,
        size_bytes=4,
        idempotency_key="transfer-run",
    )
    client.workspace_runs.upload_archive_to_transfer(created_transfer, b"repo")
    client.workspace_runs.upload_archive_to_transfer(
        workspace_run_transfer(
            "https://api.test/v1/workspace-runs/wsr_123/archive-transfer/upl_same"
        ),
        body=b"repo",
    )
    finalized = client.workspace_runs.finalize_archive(
        "wsr_123",
        sha256="a" * 64,
        size_bytes=4,
        upload_id="upl_123",
        idempotency_key="finalize-run",
    )
    started = client.workspace_runs.start("wsr_123", idempotency_key="start-run")
    got = client.workspace_runs.get("wsr_123")
    listed = client.workspace_runs.list(
        metadata={"agent": "codex"},
        project_id="prj_123",
        status="running",
    )
    events_page = client.workspace_runs.list_events("wsr_123", after_seq=1, limit=10)
    streamed = list(
        client.workspace_runs.stream_events("wsr_123", after_seq=1, reconnect=False)
    )
    canceled = client.workspace_runs.cancel("wsr_123", idempotency_key="cancel-run")
    evidence = client.workspace_runs.evidence("wsr_123")

    assert run["id"] == "wsr_123"
    assert direct["archive"]["sha256"] == "a" * 64
    assert finalized["workspaceRun"]["status"] == "archive_uploaded"
    assert started["status"] == "running"
    assert got["id"] == "wsr_123"
    assert listed["data"][0]["id"] == "wsr_123"
    assert events_page["nextSeq"] == 2
    assert [event["type"] for event in streamed] == ["status", "terminal"]
    assert canceled["status"] == "canceled"
    assert evidence["workspaceRunId"] == "wsr_123"
    assert requests[0].headers["idempotency-key"] == "create-run"
    assert json.loads(requests[0].content) == {
        "artifacts": [{"name": "coverage", "path": "coverage/lcov.info"}],
        "command": "pnpm test",
        "keepSandbox": True,
        "metadata": {"agent": "codex"},
        "projectId": "prj_123",
        "sourceMetadata": {"branch": "main"},
        "template": "python-node",
        "timeoutMs": 120_000,
    }
    assert requests[1].content == b"repo"
    assert requests[1].headers["authorization"] == "Bearer cnk_test"
    assert requests[1].headers["content-type"] == "application/gzip"
    assert requests[1].headers["x-crownest-archive-sha256"] == "a" * 64
    assert requests[3].headers.get("authorization") is None
    assert requests[3].headers["x-upload-token"] == "token"
    assert requests[4].headers["authorization"] == "Bearer cnk_test"
    assert (
        requests[8].url.query
        == b"projectId=prj_123&status=running&metadata.agent=codex"
    )
    assert requests[9].url.query == b"afterSeq=1&limit=10"
    assert requests[10].url.query == b"afterSeq=1&stream=true"


def test_sync_transfer_auth_normalizes_default_base_url_port() -> None:
    requests: list[httpx.Request] = []

    def handler(request: httpx.Request) -> httpx.Response:
        requests.append(request)
        return httpx.Response(204)

    client = CrowNest(
        api_key="cnk_test",
        base_url="https://api.test:443",
        http_client=httpx.Client(transport=httpx.MockTransport(handler)),
    )

    client.workspace_runs.upload_archive_to_transfer(
        workspace_run_transfer(
            "https://api.test/v1/workspace-runs/wsr_123/archive-transfer/upl_same"
        ),
        body=b"repo",
    )

    assert requests[0].headers["authorization"] == "Bearer cnk_test"


def test_sync_workspace_run_run_archive_helper() -> None:
    requests: list[httpx.Request] = []
    transfer = workspace_run_transfer("https://uploads.test/wsr_123/upl_123")

    def handler(request: httpx.Request) -> httpx.Response:
        requests.append(request)
        path = request.url.path
        if path == "/v1/workspace-runs" and request.method == "POST":
            return json_response({"workspaceRun": workspace_run_body()})
        if path == "/v1/workspace-runs/wsr_123/archive-transfer":
            return json_response({"transfer": transfer})
        if str(request.url) == transfer["uploadUrl"]:
            return httpx.Response(204)
        if path == "/v1/workspace-runs/wsr_123/archive/finalize":
            return json_response(
                {
                    "archive": workspace_archive_body(),
                    "workspaceRun": workspace_run_body(status="archive_uploaded"),
                }
            )
        if path == "/v1/workspace-runs/wsr_123/start":
            return json_response({"workspaceRun": workspace_run_body(status="running")})
        raise AssertionError(f"unexpected request: {request.method} {request.url}")

    client = CrowNest(
        api_key="cnk_test",
        base_url="https://api.test",
        http_client=httpx.Client(transport=httpx.MockTransport(handler)),
    )

    run = client.workspace_runs.run_archive(
        b"repo",
        command="pnpm test",
        sha256="a" * 64,
        size_bytes=4,
        template="python-node",
    )

    assert run["status"] == "running"
    assert [request.url.path for request in requests] == [
        "/v1/workspace-runs",
        "/v1/workspace-runs/wsr_123/archive-transfer",
        "/wsr_123/upl_123",
        "/v1/workspace-runs/wsr_123/archive/finalize",
        "/v1/workspace-runs/wsr_123/start",
    ]
    assert json.loads(requests[0].content)["template"] == "python-node"
    assert requests[2].content == b"repo"
    assert requests[2].headers["content-length"] == "4"
    assert requests[2].headers["x-upload-token"] == "token"


@pytest.mark.asyncio
async def test_async_workspace_run_routes_and_stream() -> None:
    requests: list[httpx.Request] = []

    async def handler(request: httpx.Request) -> httpx.Response:
        requests.append(request)
        path = request.url.path
        if path == "/v1/workspace-runs" and request.method == "POST":
            return json_response({"workspaceRun": workspace_run_body()})
        if path == "/v1/workspace-runs/wsr_123/start":
            return json_response({"workspaceRun": workspace_run_body(status="running")})
        if path == "/v1/workspace-runs/wsr_123/archive-transfer/upl_async":
            return httpx.Response(200)
        if path == "/v1/workspace-runs/wsr_123/events":
            if request.url.params.get("stream") == "true":
                return httpx.Response(
                    200,
                    content=(
                        b'data: {"type":"terminal","seq":1,"createdAt":"now",'
                        b'"workspaceRun":'
                        + json.dumps(workspace_run_body(status="succeeded")).encode()
                        + b"}\n\n"
                    ),
                    headers={"content-type": "text/event-stream"},
                )
            return json_response({"data": [], "hasMore": False})
        if path == "/v1/workspace-runs/wsr_123/evidence":
            return json_response({"evidence": workspace_run_evidence_body()})
        raise AssertionError(f"unexpected request: {request.method} {request.url}")

    async with AsyncCrowNest(
        api_key="cnk_test",
        base_url="https://api.test",
        http_client=httpx.AsyncClient(transport=httpx.MockTransport(handler)),
    ) as client:
        run = await client.workspace_runs.create(command="pnpm test")
        started = await client.workspace_runs.start("wsr_123")
        await client.workspace_runs.upload_archive_to_transfer(
            workspace_run_transfer(
                "https://api.test/v1/workspace-runs/wsr_123/archive-transfer/upl_async"
            ),
            body=b"repo",
        )
        events_page = await client.workspace_runs.list_events("wsr_123")
        streamed = [
            event
            async for event in client.workspace_runs.stream_events(
                "wsr_123", reconnect=False
            )
        ]
        evidence = await client.workspace_runs.evidence("wsr_123")

    assert run["id"] == "wsr_123"
    assert started["status"] == "running"
    assert events_page["hasMore"] is False
    assert streamed[0]["type"] == "terminal"
    assert evidence["workspaceRunId"] == "wsr_123"
    assert requests[0].headers["idempotency-key"]
    assert requests[2].content == b"repo"
    assert requests[4].url.query == b"stream=true"


def json_response(
    body: object,
    *,
    headers: dict[str, str] | None = None,
    status_code: int = 200,
) -> httpx.Response:
    return httpx.Response(status_code, headers=headers, json=body)


def sandbox_body(**overrides: object) -> dict[str, object]:
    return {
        "expiresAt": "2026-06-09T15:30:00.000Z",
        "id": "sbx_123",
        "metadata": {},
        "orgId": "org_123",
        "projectId": "prj_123",
        "status": "ready",
        "templateId": "tpl_python_node",
        "templateSlug": "python-node",
        "templateVersion": "2026-06-01",
        "templateVersionId": "tplv_123",
        "ttlMs": 3_600_000,
        **overrides,
    }


def command_body(status: str = "exited") -> dict[str, object]:
    return {
        "command": "python main.py",
        "cwd": "/workspace",
        "env": {},
        "id": "cmd_123",
        "sandboxId": "sbx_123",
        "status": status,
    }


class FailingByteStream(httpx.SyncByteStream):
    def __init__(self, first_chunk: bytes) -> None:
        self._first_chunk = first_chunk

    def __iter__(self):
        yield self._first_chunk
        raise httpx.TransportError("network reset")


def code_context_body() -> dict[str, object]:
    return {
        "createdAt": "2026-06-09T15:30:00.000Z",
        "cwd": "/workspace",
        "id": "cctx_123",
        "language": "python",
        "sandboxId": "sbx_123",
    }


def code_run_body() -> dict[str, object]:
    return {
        "contextId": "cctx_123",
        "executionCount": 1,
        "language": "python",
        "outputs": [{"kind": "inline", "format": "text", "value": "hi"}],
        "sandboxId": "sbx_123",
        "stderr": "",
        "stdout": "hi\n",
    }


def file_body(path: str = "/workspace/input.txt") -> dict[str, object]:
    return {"path": path, "sizeBytes": 5, "type": "file"}


def directory_body() -> dict[str, object]:
    return {"path": "/workspace/data", "sizeBytes": 0, "type": "directory"}


def artifact_body() -> dict[str, object]:
    return {
        "createdAt": "2026-06-09T15:30:00.000Z",
        "id": "art_123",
        "name": "input.txt",
        "objectKey": "orgs/org_123/projects/prj_123/objects/obj_123",
        "orgId": "org_123",
        "projectId": "prj_123",
        "sandboxId": "sbx_123",
        "sizeBytes": 5,
    }


def api_key_body() -> dict[str, object]:
    return {
        "createdAt": "2026-06-09T15:30:00.000Z",
        "createdByUserId": "usr_123",
        "id": "key_123",
        "last4": "test",
        "name": "Manager",
        "orgId": "org_123",
        "prefix": "cn_live_test",
        "scopes": ["api_key:read", "api_key:revoke"],
    }


def project_body(project_id: str = "prj_123") -> dict[str, object]:
    return {
        "createdAt": "2026-06-09T15:30:00.000Z",
        "id": project_id,
        "name": "Default Project",
        "orgId": "org_123",
    }


def preview_body(*, auth_mode: str = "authenticated") -> dict[str, object]:
    return {
        "authMode": auth_mode,
        "createdAt": "2026-06-09T15:30:00.000Z",
        "id": "prv_123",
        "orgId": "org_123",
        "port": 8080,
        "projectId": "prj_123",
        "sandboxId": "sbx_123",
        "slug": "preview",
        "url": "https://preview.test",
    }


def workspace_run_body(status: str = "awaiting_archive") -> dict[str, object]:
    return {
        "command": "pnpm test",
        "createdAt": "2026-06-09T15:30:00.000Z",
        "id": "wsr_123",
        "keepSandbox": True,
        "metadata": {"agent": "codex"},
        "orgId": "org_123",
        "projectId": "prj_123",
        "status": status,
        "templateId": "tpl_python_node",
        "templateSlug": "python-node",
        "templateVersion": "2026-06-01",
        "templateVersionId": "tplv_123",
    }


def workspace_archive_body() -> dict[str, object]:
    return {
        "sha256": "a" * 64,
        "sizeBytes": 4,
        "uploadedAt": "2026-06-09T15:31:00.000Z",
    }


def workspace_run_transfer(upload_url: str) -> dict[str, object]:
    return {
        "checksumAlgorithm": "sha256",
        "expiresAt": "2026-06-09T15:40:00.000Z",
        "headers": {"x-upload-token": "token"},
        "id": "upl_123",
        "maxSizeBytes": 1_000,
        "method": "PUT",
        "status": "pending",
        "uploadUrl": upload_url,
        "workspaceRunId": "wsr_123",
    }


def workspace_run_evidence_body() -> dict[str, object]:
    return {
        "artifactErrors": [],
        "artifactIds": [],
        "cleanupStatus": "succeeded",
        "command": "pnpm test",
        "createdAt": "2026-06-09T15:30:00.000Z",
        "envKeys": [],
        "metadata": {"agent": "codex"},
        "orchestrationSucceeded": True,
        "orgId": "org_123",
        "projectId": "prj_123",
        "status": "succeeded",
        "workspaceRunId": "wsr_123",
    }
