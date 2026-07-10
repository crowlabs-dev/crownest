# Agent Patterns

## Stateful Code Runs

MCP:

```text
run_code({ "code": "x = 40" })
run_code({ "code": "print(x + 2)" })
```

CLI:

```bash
SANDBOX=$(crownest sandboxes create --template python-node --json | jq -r .data.id)
crownest code run "$SANDBOX" --language python --code "x = 40"
crownest code run "$SANDBOX" --language python --code "print(x + 2)"
```

## Create, Run, Collect, Kill

MCP:

```text
run_command({ "command": "python3 - <<'PY'\nfrom pathlib import Path\nPath('/workspace/report.txt').write_text('ready')\nPY" })
create_artifact({ "source_path": "/workspace/report.txt", "name": "report.txt" })
kill_sandbox({ "sandbox_id": "sbx_..." })
```

CLI:

```bash
SANDBOX=$(crownest sandboxes create --template python-node --json | jq -r .data.id)
crownest commands run "$SANDBOX" -- python3 -c "from pathlib import Path; Path('/workspace/report.txt').write_text('ready')"
crownest artifacts create "$SANDBOX" /workspace/report.txt --name report.txt
crownest sandboxes kill "$SANDBOX"
```

## Retry-Sensitive Work

Use stable idempotency keys for work that may retry after network failure.

```bash
crownest code run "$SANDBOX" \
  --idempotency-key "agent-step-42" \
  --language python \
  --code "print('retry-safe')"
```

MCP tools do not expose caller-provided idempotency keys. Use the CLI or SDK for
replay-sensitive mutating steps.

## Cleanup

Setting a Sandbox TTL resets its countdown from now. It does not pause, persist, or
revive expired Sandboxes.

```text
set_sandbox_ttl({ "sandbox_id": "sbx_...", "ttl_ms": 1800000 })
kill_sandbox({ "sandbox_id": "sbx_..." })
```

```bash
crownest sandboxes set-ttl "$SANDBOX" --ttl-ms 1800000
crownest sandboxes kill "$SANDBOX"
```
