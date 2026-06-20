import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { LmStudioEngine } from "./src/engine/lmstudio.ts";
import { pairedTxtAdapter } from "./src/formats/paired-txt-adapter.ts";
import { mask, restore } from "./src/engine/protect.ts";
import { loadGlossary } from "./src/glossary/load.ts";
import { languageDir, languageCnDir } from "./src/config/paths.ts";

const file = "LifeSkillCombatTalk_language.txt"; // боевые реплики, есть теги и смысл
const en = await readFile(join(languageDir, file), "utf8");
const cn = await readFile(join(languageCnDir, file), "utf8");
const { units } = pairedTxtAdapter.extract(en, cn);
const glossary = await loadGlossary();

const picks = units.filter(u => /\p{L}/u.test(u.en) && u.en.length > 15).slice(0, 4);
const engine = new LmStudioEngine({ concurrency: 2 });
const masks = picks.map(u => mask(u.en, glossary));
const reqs = picks.map((u, i) => ({ text: masks[i].masked, reference: u.cn }));
const out = await engine.translate(reqs);

for (let i = 0; i < picks.length; i++) {
  const r = restore(out[i], masks[i]);
  console.log("EN :", picks[i].en);
  console.log("CN :", picks[i].cn);
  console.log("RU :", r.ok ? r.text : "[restore failed: " + r.error + "]");
  console.log("теги сохранены:", r.ok);
  console.log("---");
}
