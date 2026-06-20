/**
 * Credential resolution for the Yandex engine: use the environment variable when
 * present, otherwise fall back to the `yc` CLI. Returns a lazy provider so the
 * (potentially slow / failing) CLI call happens only when translation actually
 * starts, not at construction time.
 */
import { ycFolderId, ycIamToken } from "./yc.js";

export function iamTokenProvider(): () => Promise<string> {
  const token = process.env.TAIWU_YANDEX_IAM_TOKEN;
  return token ? () => Promise.resolve(token) : ycIamToken;
}

export function folderIdProvider(): () => Promise<string> {
  const folderId = process.env.TAIWU_YANDEX_FOLDER_ID;
  return folderId ? () => Promise.resolve(folderId) : ycFolderId;
}
