import type { GetSandboxResponse, Sandbox } from "@crownest/contracts";

import type { WaitUntilReadyInput } from "./client-types";
import { pollUntil } from "./polling";
import type { Transport } from "./protocol";

type SandboxHandleFactory<T> = (sandbox: Sandbox, transport: Transport) => T;

export async function waitUntilSandboxReady<T>(
  sandbox: Sandbox,
  transport: Transport,
  createHandle: SandboxHandleFactory<T>,
  input: WaitUntilReadyInput = {},
): Promise<T> {
  let current = sandbox;
  let first = true;
  const ready = await pollUntil({
    fetch: async () => {
      if (first) {
        first = false;
        return current;
      }
      const response = await transport.request<GetSandboxResponse>(
        `/v1/sandboxes/${sandbox.id}`,
        { method: "GET", signal: input.signal },
      );
      current = response.sandbox;
      return current;
    },
    isTerminal: (value) => {
      if (isTerminalSandboxStatus(value.status)) {
        throw new Error(`Sandbox ${value.id} reached terminal status ${value.status}.`);
      }
      return isReadySandboxStatus(value.status);
    },
    options: input,
    timeoutMessage: `Timed out waiting for Sandbox ${sandbox.id} to become ready.`,
  });
  return createHandle(ready, transport);
}

function isReadySandboxStatus(status: Sandbox["status"]): boolean {
  return status === "ready" || status === "running" || status === "idle";
}

function isTerminalSandboxStatus(status: Sandbox["status"]): boolean {
  return status === "destroyed" || status === "failed";
}
