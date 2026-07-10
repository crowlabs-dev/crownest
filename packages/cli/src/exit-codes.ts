export const CLI_EXIT_OK = 0;
export const CLI_EXIT_API_ERROR = 1;
export const CLI_EXIT_USAGE_ERROR = 2;
export const CLI_MAX_SANDBOX_EXIT_CODE = 125;

/** Preserve a sandbox command's nonzero exit code without entering signal space. */
export function sandboxCommandExitCode(exitCode: number): number {
  return Math.min(Math.max(Math.trunc(exitCode), 1), CLI_MAX_SANDBOX_EXIT_CODE);
}
