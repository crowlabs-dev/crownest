# Capability Map

Use MCP tools first when they are configured. Fall back to the CLI for shell
agents, or SDKs when writing application code.

| Need                 | MCP                   | CLI                                  |
| -------------------- | --------------------- | ------------------------------------ |
| Create Sandbox       | `create_sandbox`      | `crownest sandboxes create`          |
| List Sandboxes       | `list_sandboxes`      | `crownest sandboxes list`            |
| Set TTL              | `set_sandbox_ttl`     | `crownest sandboxes set-ttl`         |
| Kill Sandbox         | `kill_sandbox`        | `crownest sandboxes kill`            |
| Run command          | `run_command`         | `crownest commands run`              |
| Start command        | -                     | `crownest commands run --background` |
| Stream logs          | `stream_command_logs` | `crownest logs`                      |
| Cancel command       | `cancel_command`      | `crownest commands cancel`           |
| Run interpreter code | `run_code`            | `crownest code run`                  |
| Read file            | `read_file`           | `crownest files read`                |
| Write file           | `write_file`          | `crownest files write`               |
| Upload local file    | -                     | `crownest files upload`              |
| List files           | `list_files`          | `crownest files list`                |
| Stat file            | `stat_file`           | `crownest files stat`                |
| Make directory       | `make_directory`      | `crownest files mkdir`               |
| Move file            | `move_file`           | `crownest files move`                |
| Delete file          | `delete_file`         | `crownest files delete`              |
| Create Artifact      | `create_artifact`     | `crownest artifacts create`          |
| List Artifacts       | `list_artifacts`      | `crownest artifacts list`            |
| Download Artifact    | `download_artifact`   | `crownest artifacts download`        |
| Create Preview       | `create_preview`      | `crownest previews create`           |
| List Previews        | `list_previews`       | `crownest previews list`             |
| Revoke Preview       | `revoke_preview`      | `crownest previews revoke`           |
| Inspect usage        | `get_usage`           | -                                    |
