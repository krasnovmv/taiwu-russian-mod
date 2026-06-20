/**
 * Thin wrapper around the Yandex Cloud CLI (`yc`). Isolated here so the
 * subprocess integration can be swapped or mocked. Used as a fallback to obtain
 * credentials when they are not provided via environment variables.
 */
import { exec } from "node:child_process";
import { promisify } from "node:util";

const execAsync = promisify(exec);

/** Run a fixed `yc` subcommand and return trimmed stdout. */
async function yc(subcommand: string): Promise<string> {
  try {
    const { stdout } = await execAsync(`yc ${subcommand}`, { windowsHide: true });
    return stdout.trim();
  } catch (err) {
    throw new Error(
      `\`yc ${subcommand}\` failed — is the Yandex Cloud CLI installed and initialized ` +
        `(\`yc init\`)? Original: ${(err as Error).message}`,
      { cause: err },
    );
  }
}

/** A fresh IAM token (`yc iam create-token`). */
export function ycIamToken(): Promise<string> {
  return yc("iam create-token");
}

/** The configured folder id (`yc config get folder-id`). */
export function ycFolderId(): Promise<string> {
  return yc("config get folder-id");
}
