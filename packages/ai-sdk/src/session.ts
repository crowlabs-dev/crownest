import {
  createCrowNestClient,
  type CreateSandboxInput,
  type CrowNestClientOptions,
  type RunCommandOptions,
} from "@crownest/sdk";

export type CrownestToolsOptions = {
  readonly apiKey?: string;
  readonly baseUrl?: string;
  readonly client?: CrownestToolsClient;
  readonly sandboxId?: `sbx_${string}`;
  readonly template?: string;
  readonly ttlMs?: number;
};

export type CrownestToolsClient = {
  readonly code: {
    run(
      sandboxId: `sbx_${string}`,
      input: CrownestCodeRunInput,
    ): Promise<CrownestCodeRunResult>;
  };
  readonly commands: {
    run(
      sandboxId: `sbx_${string}`,
      command: string,
      input?: RunCommandOptions,
    ): Promise<CrownestCommandResult>;
  };
  readonly files: {
    read(
      sandboxId: `sbx_${string}`,
      path: string,
      input?: { readonly encoding?: "utf8" },
    ): Promise<string>;
    write(
      sandboxId: `sbx_${string}`,
      path: string,
      content: string,
      input?: {
        readonly createParents?: boolean;
        readonly encoding?: "utf8";
        readonly overwrite?: boolean;
      },
    ): Promise<CrownestFileStat>;
  };
  readonly sandboxes: {
    create(input?: CreateSandboxInput): Promise<CrownestCreatedSandbox>;
    kill(sandboxId: `sbx_${string}`): Promise<unknown>;
  };
};

type CrownestCreatedSandbox = {
  readonly expiresAt: string;
  readonly id: `sbx_${string}`;
  readonly status: string;
};

type CrownestCodeRunInput = {
  readonly artifactPolicy?: "inline_only" | "promote";
  readonly code: string;
  readonly contextId?: `cctx_${string}`;
  readonly cwd?: string;
  readonly language?: "python" | "javascript" | "typescript";
  readonly timeoutMs?: number;
};

type CrownestCodeRunResult = {
  readonly contextId: `cctx_${string}`;
  readonly durationMs?: number;
  readonly error?: {
    readonly message: string;
    readonly name?: string;
    readonly traceback?: readonly string[];
  };
  readonly executionCount: number;
  readonly language: "python" | "javascript" | "typescript";
  readonly outputs: readonly CrownestCodeOutput[];
  readonly sandboxId: `sbx_${string}`;
  readonly stderr: string;
  readonly stdout: string;
};

type CrownestCodeOutput =
  | {
      readonly artifactId: `art_${string}`;
      readonly contentType: string;
      readonly format: string;
      readonly kind: "artifact";
      readonly sizeBytes: number;
    }
  | {
      readonly format: string;
      readonly kind: "inline";
      readonly value: unknown;
    }
  | {
      readonly format: string;
      readonly kind: "rejected";
      readonly reason: string;
    };

type CrownestCommandResult = {
  readonly exitCode?: number;
  readonly id: `cmd_${string}`;
  readonly sandboxId: `sbx_${string}`;
  readonly status: string;
  readonly stderr?: string;
  readonly stdout?: string;
};

type CrownestFileStat = {
  readonly path: string;
  readonly sizeBytes: number;
  readonly type: string;
};

export class CrownestToolSession {
  readonly client: CrownestToolsClient;
  private readonly sandboxId: `sbx_${string}` | undefined;
  private readonly template: string | undefined;
  private readonly ttlMs: number | undefined;
  private createdSandbox: CrownestCreatedSandbox | undefined;
  private executionQueue: Promise<void> = Promise.resolve();
  private sandboxCreation: Promise<CrownestCreatedSandbox> | undefined;

  constructor(options: CrownestToolsOptions = {}) {
    this.client = options.client ?? createClient(options);
    this.sandboxId = options.sandboxId;
    this.template = options.template;
    this.ttlMs = options.ttlMs;
  }

  async resolveSandboxId(): Promise<`sbx_${string}`> {
    if (this.sandboxId !== undefined) return this.sandboxId;

    if (this.createdSandbox !== undefined) {
      if (canReuseCreatedSandbox(this.createdSandbox)) return this.createdSandbox.id;
      this.createdSandbox = undefined;
    }

    if (this.sandboxCreation !== undefined) {
      return (await this.sandboxCreation).id;
    }

    this.sandboxCreation = this.client.sandboxes
      .create(this.createSandboxInput())
      .then((sandbox) => {
        this.createdSandbox = sandbox;
        return sandbox;
      })
      .finally(() => {
        this.sandboxCreation = undefined;
      });

    return (await this.sandboxCreation).id;
  }

  async close(): Promise<void> {
    if (this.sandboxCreation !== undefined) {
      await this.sandboxCreation.catch(() => undefined);
    }

    const createdSandboxId = this.createdSandbox?.id;
    this.sandboxCreation = undefined;

    if (createdSandboxId !== undefined) {
      await this.client.sandboxes.kill(createdSandboxId);
      if (this.createdSandbox?.id === createdSandboxId) {
        this.createdSandbox = undefined;
      }
    }
  }

  async runInSandbox<T>(
    operation: (sandboxId: `sbx_${string}`) => Promise<T>,
  ): Promise<T> {
    return this.runExclusive(async () => {
      const sandboxId = await this.resolveSandboxId();

      try {
        return await operation(sandboxId);
      } catch (error) {
        if (isSandboxDestroyedError(error)) {
          this.forgetCreatedSandbox(sandboxId);
        }
        throw error;
      }
    });
  }

  async runExclusive<T>(operation: () => Promise<T>): Promise<T> {
    const result = this.executionQueue.then(operation, operation);
    this.executionQueue = result.then(
      () => undefined,
      () => undefined,
    );
    return result;
  }

  private createSandboxInput(): CreateSandboxInput {
    return {
      ...(this.template === undefined ? {} : { template: this.template }),
      ...(this.ttlMs === undefined ? {} : { ttlMs: this.ttlMs }),
    };
  }

  private forgetCreatedSandbox(sandboxId: `sbx_${string}`): void {
    if (this.createdSandbox?.id === sandboxId) {
      this.createdSandbox = undefined;
    }
  }
}

function createClient(options: CrownestToolsOptions): CrownestToolsClient {
  const clientOptions: CrowNestClientOptions = {
    ...(options.apiKey === undefined ? {} : { apiKey: options.apiKey }),
    ...(options.baseUrl === undefined ? {} : { baseUrl: options.baseUrl }),
  };

  return createCrowNestClient(clientOptions);
}

function canReuseCreatedSandbox(sandbox: CrownestCreatedSandbox): boolean {
  return (
    sandbox.status !== "destroyed" &&
    sandbox.status !== "failed" &&
    new Date(sandbox.expiresAt).getTime() > Date.now()
  );
}

function isSandboxDestroyedError(error: unknown): boolean {
  return (
    typeof error === "object" &&
    error !== null &&
    "code" in error &&
    error.code === "sandbox_destroyed"
  );
}
