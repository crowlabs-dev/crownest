import type {
  GetCommandResponse,
  ListCommandLogsResponse,
  Sandbox,
} from "@crownest/contracts";

import { runCommandWithCallbacks, streamCommandLogs } from "./command-stream";
import { pollUntil } from "./polling";
import {
  cancelCommand,
  commandLogParams,
  queryString,
  type Transport,
} from "./protocol";
import type { SandboxHandle } from "./sandbox-handle";

export function createSandboxCommands(
  sandbox: Sandbox,
  transport: Transport,
): SandboxHandle["commands"] {
  return {
    cancel(commandId, input = {}) {
      return cancelCommand(transport, commandId, input);
    },
    async get(commandId) {
      const response = await transport.request<GetCommandResponse>(
        `/v1/commands/${commandId}`,
        { method: "GET" },
      );
      return response.command;
    },
    async logs(commandId, input = {}) {
      const response = await transport.request<ListCommandLogsResponse>(
        `/v1/commands/${commandId}/logs${queryString(commandLogParams(input))}`,
        { method: "GET" },
      );
      return response;
    },
    run(command, input = {}) {
      return runCommandWithCallbacks(transport, sandbox.id, command, input);
    },
    streamLogs(commandId, input = {}) {
      return streamCommandLogs(transport, commandId, input);
    },
    wait(commandId, input = {}) {
      return pollUntil({
        fetch: async () => {
          const response = await transport.request<GetCommandResponse>(
            `/v1/commands/${commandId}`,
            { method: "GET", signal: input.signal },
          );
          return response.command;
        },
        isTerminal: (command) =>
          ["exited", "failed", "canceled", "timed_out", "killed"].includes(
            command.status,
          ),
        options: input,
        timeoutMessage: `Timed out waiting for Command ${commandId} to finish.`,
      });
    },
  };
}
