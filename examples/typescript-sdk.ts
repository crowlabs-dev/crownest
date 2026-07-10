import { createCrowNestClient } from "@crownest/sdk";

const client = createCrowNestClient();

const sandbox = await client.sandboxes.create();
await client.commands.run(sandbox.id, "python --version", {
  idempotencyKey: "example-python-version",
});
