/**
 * Upload the installed mod (`<game>/Mod/TaiwuRus`) to its existing Steam Workshop
 * item through steamcmd, instead of the in-game mod manager.
 *
 *   npm run publish -- "change note"   # note is optional, shown on the Workshop page
 *
 * Publishes what is INSTALLED, so run `npm run mod` first. The Workshop item id is
 * the `FileId` in the deployed Config.Lua. steamcmd reuses its cached session or
 * prompts for the login itself — the script never sees or stores credentials.
 *
 * Like the in-game publish, it appends an `UpdateLogList` entry to the deployed
 * Config.Lua; the next build carries it back into `dist/Config.Lua` to be committed.
 */
import { spawnSync } from "node:child_process";
import { readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

import { modDir } from "../config/paths.js";
import { appendUpdateLog } from "../publish/update-log.js";
import { writeFileAtomic } from "../util/fs.js";

/** The Scroll of Taiwu on Steam. */
const APP_ID = 838350;
/** The account that owns the Workshop item; `TAIWU_STEAM_USER` overrides it. */
const STEAM_USER = "krasnovmv";

/** steamcmd's VDF: backslash is an escape character, so quote it along with `"`. */
const vdf = (s: string): string => `"${s.replace(/\\/g, "\\\\").replace(/"/g, '\\"')}"`;

async function main(): Promise<void> {
  const user = process.env.TAIWU_STEAM_USER ?? STEAM_USER;
  const note = process.argv.slice(2).join(" ");

  const configFile = path.join(modDir(), "Config.Lua");
  const original = readFileSync(configFile, "utf8");
  const fileId = /^[ \t]*FileId\s*=\s*(\d+)/m.exec(original)?.[1];
  if (!fileId) {
    console.error(`No FileId in ${configFile} — publish once from the in-game mod manager first`);
    process.exitCode = 1;
    return;
  }

  const vdfFile = path.join(tmpdir(), "taiwurus-workshop.vdf");
  writeFileSync(
    vdfFile,
    [
      `"workshopitem"`,
      `{`,
      `\t"appid" "${APP_ID}"`,
      `\t"publishedfileid" "${fileId}"`,
      `\t"contentfolder" ${vdf(modDir())}`,
      `\t"changenote" ${vdf(note)}`,
      `}`,
      ``,
    ].join("\n"),
  );

  // ponytail: mutate-then-restore keyed on the exit code. A killed terminal, or steamcmd
  // exiting 0 on a failed upload, leaves a phantom entry (git diff of dist/Config.Lua after
  // the next build shows it). Upload from a staged copy if that ever bites.
  await writeFileAtomic(configFile, appendUpdateLog(original, Math.floor(Date.now() / 1000)));
  console.log(`Uploading ${modDir()} -> Workshop item ${fileId}`);
  // stdio inherited so steamcmd can prompt.
  const run = spawnSync(
    process.env.TAIWU_STEAMCMD ?? "steamcmd",
    ["+login", user, "+workshop_build_item", vdfFile, "+quit"],
    { stdio: "inherit" },
  );
  if (run.status !== 0) {
    await writeFileAtomic(configFile, original);
    console.error(
      run.error
        ? `steamcmd failed to start: ${run.error.message}`
        : `steamcmd exited with ${run.status}`,
    );
    process.exitCode = 1;
    return;
  }
  console.log(`Published: https://steamcommunity.com/sharedfiles/filedetails/?id=${fileId}`);
}

await main();
