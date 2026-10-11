// Output-folder safety: never delete or overwrite files we did not create.
import { _t } from './i18n.mjs';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

/** Everything the handoff builder generates. Anything else in the folder belongs to the user. */
// NOT listed: `starter/` — people and AIs work inside it, so build-handoff backs it up instead of deleting it (see build-handoff.mjs)
export const HANDOFF_GENERATED = ['tokens', 'media', 'README.md', 'CLAUDE.md', 'ai-brief.md', 'SPEC.md', 'spec.json', 'handoff.json', 'health.md', 'health.json', 'inventory.csv', 'motion.md', 'motion.json', 'motion-pages', 'START-HERE.md', 'PROMPT.md', 'AI-PACKAGE.md'];
/** The living record is the user's: it is preserved across regeneration. */
export const HANDOFF_PRESERVED = ['DECISIONS.md'];

export class UnsafeOutputError extends Error {}

const samePath = (a, b) => path.resolve(a) === path.resolve(b);
export const isInside = (child, parent) => { const r = path.relative(path.resolve(parent), path.resolve(child)); return r === '' || (!r.startsWith('..') && !path.isAbsolute(r)); };

/**
 * Prepare `dir` for a regenerated package. Allowed: missing, empty, or a folder we made before (marker file present).
 * Refuses: filesystem root, home, cwd or any parent of cwd (unless it is our own previous output), and non-empty foreign folders.
 * Removes only generated entries; returns the preserved DECISIONS.md content (or null).
 */
export function claimOutputDir(dir, markerFile) {
  const abs = path.resolve(dir);
  const refuse = (why) => { throw new UnsafeOutputError(_t`不會寫入「${abs}」：${why}\n請指定一個新的資料夾，例如 --out ./handoff（不會動到你現有的檔案）。`); };
  if (samePath(abs, path.parse(abs).root)) refuse(_t('這是檔案系統的根目錄'));
  if (samePath(abs, os.homedir())) refuse(_t('這是你的家目錄'));
  const ours = fs.existsSync(path.join(abs, markerFile));
  if (!ours && isInside(process.cwd(), abs)) refuse(_t('這是目前工作目錄或它的上層'));
  if (!fs.existsSync(abs)) { fs.mkdirSync(abs, { recursive: true }); return { decisions: null, existed: false }; }
  if (!fs.statSync(abs).isDirectory()) refuse(_t('這是一個檔案，不是資料夾'));
  const entries = fs.readdirSync(abs);
  if (entries.length && !ours) refuse(_t`資料夾不是空的（有 ${entries.length} 個項目，例如 ${entries.slice(0, 3).join(_t('、'))}），而且不是先前由本工具產生的交接包`);
  let decisions = null;
  for (const f of HANDOFF_PRESERVED) { const p = path.join(abs, f); if (fs.existsSync(p)) decisions = fs.readFileSync(p, 'utf8'); }
  for (const name of HANDOFF_GENERATED) fs.rmSync(path.join(abs, name), { recursive: true, force: true });
  return { decisions, existed: true };
}

/** `--out` for single-file outputs must look like the thing we write, so a typo cannot clobber e.g. ~/.zshrc. */
export function requireExtension(file, re, what) {
  if (!re.test(file)) throw new UnsafeOutputError(_t`輸出檔名必須是 ${what}（收到「${file}」）。為避免覆蓋其他檔案，已停止。`);
  return path.resolve(file);
}

/** Explore output folder: may be new, empty, or one we made before (ABOUT-THIS-FOLDER.md / runs.json). Never a foreign non-empty folder, root or home. */
export function checkExploreOut(dir) {
  const abs = path.resolve(dir);
  const refuse = (why) => { throw new UnsafeOutputError(_t`不會寫入「${abs}」：${why}\n請指定一個新的資料夾，例如 --out ./explore-out（不會動到你現有的檔案）。`); };
  const has = (f) => fs.existsSync(path.join(abs, f));
  const ours = has('ABOUT-THIS-FOLDER.md') || (has('runs.json') && (has('site') || has('dashboard.html'))); // a lone runs.json could be somebody else's file
  if (ours) return abs;
  if (samePath(abs, path.parse(abs).root)) refuse(_t('這是檔案系統的根目錄'));
  if (samePath(abs, os.homedir())) refuse(_t('這是你的家目錄'));
  if (!fs.existsSync(abs)) return abs;
  if (!fs.statSync(abs).isDirectory()) refuse(_t('這是一個檔案，不是資料夾'));
  const entries = fs.readdirSync(abs);
  if (entries.length) refuse(_t`資料夾不是空的（有 ${entries.length} 個項目，例如 ${entries.slice(0, 3).join(_t('、'))}），而且不是先前由本工具產生的`);
  return abs;
}
