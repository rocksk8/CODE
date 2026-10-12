// Safety nets for long runs: a time limit per stage, a quiet-for-too-long heartbeat, a low-memory stop and a CPU-saturation notice.
// Used by explore.mjs (each stage is a child process) and the graphical interface. Pure helpers are exported so they can be tested.
import os from 'node:os';
import fs from 'node:fs';
import { spawn, execFileSync } from 'node:child_process';

const MIN = 60000;
/** Default time limit (ms) of one stage; SITE_EXPLORER_STAGE_LIMIT_MS overrides everything (tests, CI), SITE_EXPLORER_STAGE_MINUTES scales the defaults. */
export function stageLimitMs(script, env = process.env) {
  const forced = Number(env.SITE_EXPLORER_STAGE_LIMIT_MS); if (Number.isFinite(forced) && forced > 0) return forced;
  const base = /^crawl\.mjs$/.test(script) ? 30 : /^capture-3d\.mjs$/.test(script) ? 25 : /^(a11y|verify|frameworks)\.mjs$/.test(script) ? 20 : /^health-check\.mjs$/.test(script) ? 15 : 10;
  const scale = Number(env.SITE_EXPLORER_STAGE_MINUTES); const mins = Number.isFinite(scale) && scale > 0 ? Math.max(1, base * scale / 10) : base;
  return Math.round(mins * MIN);
}
/** Overall limit of one whole run (ms); stages that have not started when it is over are skipped. */
export function runLimitMs(env = process.env) { const m = Number(env.SITE_EXPLORER_MAX_MINUTES); return (Number.isFinite(m) && m > 0 ? m : 120) * MIN; }
/** Memory is "low" when what is still available is under 128 MB or under 2 % of the total (a computer that is about to start swapping heavily). */
export function isLowMemory(availableBytes, totalBytes) { return Number.isFinite(availableBytes) && Number.isFinite(totalBytes) && totalBytes > 0 && availableBytes < Math.max(128 * 1048576, totalBytes * 0.02); }
/** Linux: "MemAvailable" is what can be used without swapping (os.freemem() is MemFree, which ignores the page cache and is always small on a busy machine). */
export function parseMeminfo(text) { const m = /^MemAvailable:\s+(\d+)\s*kB/m.exec(text || ''); return m ? Number(m[1]) * 1024 : null; }
/** macOS: free + inactive + speculative + purgeable pages from `vm_stat` (os.freemem() counts only the truly free ones, so it looks nearly empty on a healthy Mac). */
export function parseVmStat(text) {
  const size = /page size of (\d+) bytes/.exec(text || ''); if (!size) return null; const pages = (k) => { const m = new RegExp('^' + k + ':\\s+(\\d+)', 'm').exec(text); return m ? Number(m[1]) : 0; };
  return (pages('Pages free') + pages('Pages inactive') + pages('Pages speculative') + pages('Pages purgeable')) * Number(size[1]);
}
let snapCache = { at: 0, v: null };
/** { total, avail } in bytes, or avail = Infinity when it cannot be measured reliably (then nothing is ever stopped for memory). */
export function memorySnapshot() {
  if (Date.now() - snapCache.at < 3000 && snapCache.v) return snapCache.v;
  let total = os.totalmem(), avail = Infinity;
  try {
    if (process.platform === 'linux') {
      const a = parseMeminfo(fs.readFileSync('/proc/meminfo', 'utf8')); if (a != null) avail = a;
      try { const lim = fs.readFileSync('/sys/fs/cgroup/memory.max', 'utf8').trim(); if (/^\d+$/.test(lim)) { const cur = Number(fs.readFileSync('/sys/fs/cgroup/memory.current', 'utf8')); total = Math.min(total, Number(lim)); avail = Math.min(avail, Number(lim) - cur); } } catch {}
    } else if (process.platform === 'darwin') {
      const a = parseVmStat(execFileSync('vm_stat', { encoding: 'utf8', timeout: 2000 })); if (a != null) avail = a;
    } else if (process.platform === 'win32') avail = os.freemem();
  } catch {}
  snapCache = { at: Date.now(), v: { total, avail } }; return snapCache.v;
}
/** Stop a child process and what it started (the browser). */
export function killTree(child) {
  if (!child || child.exitCode != null) return;
  try { if (process.platform === 'win32') spawn('taskkill', ['/pid', String(child.pid), '/T', '/F'], { stdio: 'ignore', windowsHide: true }).on('error', () => {}); else child.kill('SIGKILL'); } catch { try { child.kill(); } catch {} }
}
/**
 * Watch one child process. Calls notify(kind, text) for 'quiet' (no output for a while), 'cpu' (machine saturated) and, when it has to act,
 * 'timeout' / 'memory' (after killing the child). Returns stop().
 */
export function watchChild(child, { limitMs, notify, quietMs = 90000, tickMs = 5000, lang = 'zh', getLastOutputAt = null, memoryReader = memorySnapshot, loadReader = () => os.loadavg()[0], canKill = process.platform !== 'darwin', cores = (os.cpus() || []).length || 1 } = {}) {
  const t0 = Date.now(); let lowStreak = 0, quietSaid = 0, cpuStreak = 0, cpuSaid = false, memSaid = false, stopped = false;
  const L = (zh, en) => (lang === 'en' ? en : zh);
  const timer = setInterval(() => {
    if (stopped) return;
    const ran = Date.now() - t0;
    if (limitMs && ran > limitMs) { stopped = true; clearInterval(timer); killTree(child); notify('timeout', L(`⏱ 超時通知：這個階段已執行超過 ${Math.round(limitMs / MIN)} 分鐘，已停止它並繼續下一階段。`, `⏱ Timeout notice: this stage ran longer than ${Math.round(limitMs / MIN)} minutes; it was stopped and the next stage continues.`)); return; }
    const m = memoryReader(); lowStreak = isLowMemory(m.avail, m.total) ? lowStreak + 1 : 0;
    if (lowStreak >= 6 && !canKill) { if (!memSaid) { memSaid = true; notify('memwarn', L(`🧠 記憶體偏低通知：可用記憶體約 ${Math.round(m.avail / 1048576)} MB。這台電腦可能變慢；沒有停止任何東西，必要時請關閉其他程式。`, `🧠 Low-memory notice: about ${Math.round(m.avail / 1048576)} MB is available. The computer may slow down; nothing was stopped. Close other programs if needed.`)); } }
    else if (lowStreak >= 6) { stopped = true; clearInterval(timer); killTree(child); notify('memory', L(`🧠 記憶體不足通知：可用記憶體只剩 ${Math.round(m.avail / 1048576)} MB，為了避免整台電腦卡死，已停止這個階段。請關閉其他程式，或減少頁數（--max-pages）後再試。`, `🧠 Low-memory notice: only ${Math.round(m.avail / 1048576)} MB is available; to keep the computer from freezing this stage was stopped. Close other programs or use fewer pages (--max-pages) and try again.`)); return; }
    const quiet = Date.now() - (getLastOutputAt ? getLastOutputAt() : t0);
    if (quiet > quietMs && Date.now() - quietSaid > quietMs) { quietSaid = Date.now(); notify('quiet', L(`⏳ 仍在執行：已 ${Math.round(quiet / 1000)} 秒沒有新訊息（已跑 ${Math.round(ran / MIN)} 分鐘，上限 ${Math.round((limitMs || 0) / MIN)} 分鐘）。網站很重時這是正常的。`, `⏳ Still running: no new output for ${Math.round(quiet / 1000)} s (${Math.round(ran / MIN)} min in, limit ${Math.round((limitMs || 0) / MIN)} min). Normal on a heavy site.`)); }
    let load = 0; try { load = loadReader(); } catch {}
    cpuStreak = load > cores * 1.5 ? cpuStreak + 1 : 0;
    if (cpuStreak >= 6 && !cpuSaid) { cpuSaid = true; notify('cpu', L('🔥 CPU 負載很高：電腦可能變慢，這個階段會花比較久；可以關閉其他程式。', '🔥 CPU load is high: the computer may feel slow and this stage will take longer; closing other programs helps.')); }
  }, tickMs);
  timer.unref?.();
  return () => { stopped = true; clearInterval(timer); };
}
