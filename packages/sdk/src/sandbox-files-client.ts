import type {
  DeleteFileResponse,
  FileDownloadUrlResponse,
  FileEncoding,
  FileStat,
  ListFilesResponse,
} from "@crownest/contracts";

import { base64ToBytes, bytesToBase64 } from "./byte-utils";
import type { Transport } from "./protocol";
import type { SandboxHandle } from "./sandbox-handle";

export function createSandboxFilesClient(
  sandboxId: `sbx_${string}`,
  transport: Transport,
): SandboxHandle["files"] {
  return {
    async delete(path) {
      await transport.request<DeleteFileResponse>(
        `/v1/sandboxes/${sandboxId}/files?path=${encodeURIComponent(path)}`,
        { method: "DELETE" },
      );
    },
    downloadUrl(path) {
      return transport.request<FileDownloadUrlResponse>(
        `/v1/sandboxes/${sandboxId}/files/download-url`,
        { body: { path }, method: "POST" },
      );
    },
    async list(path = "/workspace") {
      const response = await transport.request<ListFilesResponse>(
        `/v1/sandboxes/${sandboxId}/files?path=${encodeURIComponent(path)}`,
        { method: "GET" },
      );
      return response;
    },
    async mkdir(path, input = {}) {
      const response = await transport.request<{ readonly file: FileStat }>(
        `/v1/sandboxes/${sandboxId}/files/mkdir`,
        { body: { path, ...input }, method: "POST" },
      );
      return response.file;
    },
    async move(from, to, input = {}) {
      const response = await transport.request<{ readonly file: FileStat }>(
        `/v1/sandboxes/${sandboxId}/files/move`,
        { body: { from, to, ...input }, method: "POST" },
      );
      return response.file;
    },
    read(path, input = {}) {
      return readSandboxFile(sandboxId, transport, path, input);
    },
    async readBytes(path) {
      const content = await readSandboxFile(sandboxId, transport, path, {
        encoding: "base64",
      });
      return base64ToBytes(content);
    },
    async stat(path) {
      const response = await transport.request<{ readonly file: FileStat }>(
        `/v1/sandboxes/${sandboxId}/files/stat?path=${encodeURIComponent(path)}`,
        { method: "GET" },
      );
      return response.file;
    },
    write(path, content, input = {}) {
      return writeSandboxFile(sandboxId, transport, path, content, input);
    },
    writeBytes(path, bytes, input = {}) {
      return writeSandboxFile(sandboxId, transport, path, bytesToBase64(bytes), {
        ...input,
        encoding: "base64",
      });
    },
  };
}

async function readSandboxFile(
  sandboxId: `sbx_${string}`,
  transport: Transport,
  path: string,
  input: { readonly encoding?: FileEncoding } = {},
): Promise<string> {
  const response = await transport.request<{
    readonly content: string;
    readonly encoding: FileEncoding;
  }>(readFilePath(sandboxId, path, input.encoding), { method: "GET" });
  return response.content;
}

async function writeSandboxFile(
  sandboxId: `sbx_${string}`,
  transport: Transport,
  path: string,
  content: string,
  input: {
    readonly createParents?: boolean;
    readonly encoding?: FileEncoding;
    readonly overwrite?: boolean;
  } = {},
): Promise<FileStat> {
  const response = await transport.request<{ readonly file: FileStat }>(
    `/v1/sandboxes/${sandboxId}/files`,
    { body: { content, path, ...input }, method: "PUT" },
  );
  return response.file;
}

function readFilePath(
  sandboxId: `sbx_${string}`,
  path: string,
  encoding?: FileEncoding,
): string {
  const encodedPath = encodeURIComponent(path);
  const encodingParam =
    encoding === undefined ? "" : `&encoding=${encodeURIComponent(encoding)}`;

  return `/v1/sandboxes/${sandboxId}/files/read?path=${encodedPath}${encodingParam}`;
}
