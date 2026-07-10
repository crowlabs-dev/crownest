import {
  readFile as readFileBytes,
  writeFile as writeFileBytes,
} from "node:fs/promises";
import { basename } from "node:path";

import type { CrowNestClient } from "@crownest/sdk";

import {
  booleanFlag,
  jsonFlagSpec,
  parseFlags,
  rejectExtraPositionals,
  requiredArg,
  requiredPrefixedArg,
  stringFlag,
  UsageError,
} from "./flags";
import type { CliInput, CliResult } from "./index";
import { jsonEnvelope, renderList, renderRecord } from "./output";

export async function deleteFileCommand(
  client: () => CrowNestClient,
  args: readonly string[],
): Promise<CliResult> {
  const parsed = parseFlags(args, jsonFlagSpec);
  const sandboxId = requiredSandboxId(parsed.positionals[0], "sandbox id");
  const path = requiredArg(parsed.positionals[1], "path");
  rejectExtraPositionals(parsed.positionals.slice(2), "files delete");
  await client().files.delete(sandboxId, path);
  const result = { path, status: "deleted" };
  return ok(
    booleanFlag(parsed.flags, "--json") ? jsonEnvelope(result) : renderRecord(result),
  );
}

export async function listFilesCommand(
  client: () => CrowNestClient,
  args: readonly string[],
): Promise<CliResult> {
  const parsed = parseFlags(args, jsonFlagSpec);
  const sandboxId = requiredSandboxId(parsed.positionals[0], "sandbox id");
  const path = parsed.positionals[1];
  rejectExtraPositionals(parsed.positionals.slice(2), "files list");
  const filesPage = await client().files.list(sandboxId, path);
  return ok(
    booleanFlag(parsed.flags, "--json")
      ? jsonEnvelope(filesPage.data)
      : renderList(filesPage.data, [
          { key: "path" },
          { key: "type" },
          { key: "sizeBytes", label: "size" },
          { key: "modifiedAt" },
        ]),
  );
}

export async function mkdirCommand(
  client: () => CrowNestClient,
  args: readonly string[],
): Promise<CliResult> {
  const parsed = parseFlags(args, {
    "--parents": "boolean",
    ...jsonFlagSpec,
  });
  const sandboxId = requiredSandboxId(parsed.positionals[0], "sandbox id");
  const path = requiredArg(parsed.positionals[1], "path");
  rejectExtraPositionals(parsed.positionals.slice(2), "files mkdir");
  const file = await client().files.mkdir(sandboxId, path, {
    parents: booleanFlag(parsed.flags, "--parents"),
  });
  return ok(
    booleanFlag(parsed.flags, "--json") ? jsonEnvelope(file) : renderRecord(file),
  );
}

export async function moveFileCommand(
  client: () => CrowNestClient,
  args: readonly string[],
): Promise<CliResult> {
  const parsed = parseFlags(args, {
    "--overwrite": "boolean",
    ...jsonFlagSpec,
  });
  const sandboxId = requiredSandboxId(parsed.positionals[0], "sandbox id");
  const from = requiredArg(parsed.positionals[1], "from");
  const to = requiredArg(parsed.positionals[2], "to");
  rejectExtraPositionals(parsed.positionals.slice(3), "files move");
  const file = await client().files.move(sandboxId, from, to, {
    overwrite: booleanFlag(parsed.flags, "--overwrite"),
  });
  return ok(
    booleanFlag(parsed.flags, "--json") ? jsonEnvelope(file) : renderRecord(file),
  );
}

export async function readFileCommand(
  client: () => CrowNestClient,
  args: readonly string[],
): Promise<CliResult> {
  const parsed = parseFlags(args, jsonFlagSpec);
  const sandboxId = requiredSandboxId(parsed.positionals[0], "sandbox id");
  const path = requiredArg(parsed.positionals[1], "path");
  rejectExtraPositionals(parsed.positionals.slice(2), "files read");
  const content = await client().files.read(sandboxId, path);
  return ok(booleanFlag(parsed.flags, "--json") ? jsonEnvelope(content) : content);
}

export async function statFileCommand(
  client: () => CrowNestClient,
  args: readonly string[],
): Promise<CliResult> {
  const parsed = parseFlags(args, jsonFlagSpec);
  const sandboxId = requiredSandboxId(parsed.positionals[0], "sandbox id");
  const path = requiredArg(parsed.positionals[1], "path");
  rejectExtraPositionals(parsed.positionals.slice(2), "files stat");
  const file = await client().files.stat(sandboxId, path);
  return ok(
    booleanFlag(parsed.flags, "--json") ? jsonEnvelope(file) : renderRecord(file),
  );
}

export async function uploadFileCommand(
  client: () => CrowNestClient,
  args: readonly string[],
): Promise<CliResult> {
  const parsed = parseFlags(args, {
    "--create-parents": "boolean",
    "--to": "string",
    ...jsonFlagSpec,
  });
  const sandboxId = requiredSandboxId(parsed.positionals[0], "sandbox id");
  const localPath = requiredArg(parsed.positionals[1], "local path");
  const remotePathFlag = stringFlag(parsed.flags, "--to");
  const positionalRemotePath = parsed.positionals[2];
  const remotePath = remotePathFlag ?? positionalRemotePath ?? basename(localPath);
  rejectExtraPositionals(
    parsed.positionals.slice(
      remotePathFlag === undefined && positionalRemotePath !== undefined ? 3 : 2,
    ),
    "files upload",
  );
  const content = await readFileBytes(localPath);
  const file = await client().files.write(
    sandboxId,
    remotePath,
    content.toString("base64"),
    {
      createParents: booleanFlag(parsed.flags, "--create-parents"),
      encoding: "base64",
    },
  );

  return ok(
    booleanFlag(parsed.flags, "--json") ? jsonEnvelope(file) : renderRecord(file),
  );
}

export async function downloadFileCommand(
  client: () => CrowNestClient,
  args: readonly string[],
): Promise<CliResult> {
  const parsed = parseFlags(args, {
    "--output": "string",
    ...jsonFlagSpec,
  });
  const sandboxId = requiredSandboxId(parsed.positionals[0], "sandbox id");
  const remotePath = requiredArg(parsed.positionals[1], "remote path");
  const positionalOutput = parsed.positionals[2];
  const flaggedOutput = stringFlag(parsed.flags, "--output");
  if (positionalOutput !== undefined && flaggedOutput !== undefined) {
    throw new UsageError(
      "local path must be provided positionally or with --output, not both.",
    );
  }
  const outputPath = flaggedOutput ?? positionalOutput ?? basename(remotePath);
  rejectExtraPositionals(parsed.positionals.slice(3), "files download");

  const bytes = await client().files.readBytes(sandboxId, remotePath);
  await writeFileBytes(outputPath, bytes);
  const result = { path: outputPath, remotePath, sizeBytes: bytes.byteLength };
  return ok(
    booleanFlag(parsed.flags, "--json") ? jsonEnvelope(result) : renderRecord(result),
  );
}

export async function writeFileCommand(
  client: () => CrowNestClient,
  args: readonly string[],
  input?: CliInput,
): Promise<CliResult> {
  const [sandboxIdArg, pathArg, contentOrFlag, ...remainingArgs] = args;
  const contentIsFlag =
    contentOrFlag === "--file" || contentOrFlag?.startsWith("--file=") === true;
  const parsed = parseFlags(
    contentIsFlag ? [contentOrFlag, ...remainingArgs] : remainingArgs,
    {
      "--create-parents": "boolean",
      "--file": "string",
      ...jsonFlagSpec,
    },
  );
  const sandboxId = requiredSandboxId(sandboxIdArg, "sandbox id");
  const path = requiredArg(pathArg, "path");
  const positionalContent = contentIsFlag ? undefined : contentOrFlag;
  const localPath = stringFlag(parsed.flags, "--file");
  if (positionalContent !== undefined && localPath !== undefined) {
    throw new UsageError(
      "content must be provided positionally or with --file, not both.",
    );
  }
  rejectExtraPositionals(parsed.positionals, "files write");
  const content =
    localPath !== undefined
      ? await readFileBytes(localPath, "utf8")
      : positionalContent === "-"
        ? await readInput(input)
        : requiredArg(positionalContent, "content");
  const file = await client().files.write(sandboxId, path, content, {
    createParents: booleanFlag(parsed.flags, "--create-parents"),
  });
  return ok(
    booleanFlag(parsed.flags, "--json") ? jsonEnvelope(file) : renderRecord(file),
  );
}

async function readInput(input: CliInput | undefined): Promise<string> {
  if (input === undefined) {
    throw new UsageError("stdin is unavailable.");
  }
  let content = "";
  for await (const chunk of input) content += chunk;
  return content;
}

function requiredSandboxId(value: string | undefined, label: string): `sbx_${string}` {
  return requiredPrefixedArg(value, label, "sbx_") as `sbx_${string}`;
}

function ok(stdout: string): CliResult {
  return { exitCode: 0, stderr: "", stdout };
}
