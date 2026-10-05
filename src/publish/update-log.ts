/** Add the next `[n] = { Timestamp = … }` entry to Config.Lua's `UpdateLogList`. */
export function appendUpdateLog(config: string, timestamp: number): string {
  const list = /(^\tUpdateLogList = \{\r?\n)([\s\S]*?)(?=^\t\},)/m;
  if (!list.test(config)) throw new Error("UpdateLogList not found in Config.Lua");
  return config.replace(list, (_whole, open: string, entries: string) => {
    // The file mixes line endings (game writer vs. build sync); follow the list's own tail.
    const eol = (entries || open).endsWith("\r\n") ? "\r\n" : "\n";
    const next = (entries.match(/\[\d+\] = \{/g) ?? []).length + 1;
    return `${open}${entries}\t\t[${next}] = {${eol}\t\t\tTimestamp = ${timestamp},${eol}\t\t},${eol}`;
  });
}
