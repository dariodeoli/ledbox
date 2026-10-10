import { execFileSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { git, inventory, LIVE, readJson, SLOTS, servedBaseline } from "./automation-core.mjs";

const roles = { "slot/panel": "Panel/UX", "slot/operacion": "Operación", "slot/finanzas": "Finanzas/fiscal/portal", "slot/plataforma": "Plataforma" };
export function slotStatus(cwd) {
  const worktrees = git(cwd, "worktree", "list", "--porcelain").split("\n\n").map(block => {
    const lines = block.split("\n");
    return { path: lines.find(l => l.startsWith("worktree "))?.slice(9), branch: lines.find(l => l.startsWith("branch "))?.slice(7).replace(/^refs\/heads\//, "") };
  });
  return SLOTS.map(branch => {
    const wt = worktrees.find(w => w.branch === branch);
    if (!wt) return { branch, role: roles[branch], status: "NO_WORKTREE" };
    try {
      const currentBranch = git(wt.path, "branch", "--show-current");
      const dirty = git(wt.path, "status", "--porcelain").split("\n").filter(Boolean).length;
      return { ...wt, currentBranch, role: roles[branch], dirty, status: dirty ? "DIRTY" : "CLEAN" };
    } catch { return { ...wt, role: roles[branch], status: "UNAVAILABLE" }; }
  });
}
function issue173(cwd) {
  try {
    return JSON.parse(execFileSync("gh", ["issue", "view", "173", "--repo", "dariodeoli/ledbox", "--json", "number,title,state,url"], { cwd, encoding: "utf8", timeout: 15000, stdio: ["ignore", "pipe", "pipe"] }));
  } catch { return { number: 173, status: "UNAVAILABLE" }; }
}
function ownerPending(cwd) {
  const path = join(cwd, "docs/PENDIENTES-DUENO.md");
  if (!existsSync(path)) return [];
  return readFileSync(path, "utf8").split(/\n(?=##\s)/).filter(section => !/^##\s+Resuelt/i.test(section.trim())).flatMap(section => {
    const scoped = /#173\b/.test(section.split("\n")[0]);
    return section.split(/\n(?=- )/).filter(block => block.trim().startsWith("- ") && (scoped || /#173\b/.test(block))).map(block => block.replace(/\s+/g, " ").trim());
  });
}
async function surface(url, fetcher) {
  try {
    const response = await fetcher(url, { method: "GET", redirect: "manual", cache: "no-store", signal: AbortSignal.timeout(15000) });
    const result = { url, status: response.status, ok: response.status === 200 };
    if (url.endsWith("/api/health") && response.status === 200) {
      const body = await response.json();
      result.health = { status: body.status, version: body.version, sha: body.sha, database: body.database, migrations: body.migrations };
    } else await response.body?.cancel();
    return result;
  } catch { return { url, status: "UNAVAILABLE", ok: false }; }
}
export async function diagnostics(cwd, config, mode, { fetcher = fetch, issueReader = issue173 } = {}) {
  if (mode === "al") return { status: "READ_ONLY", scope: "#173", slots: slotStatus(cwd), issue: issueReader(cwd), dispatch: "MANUAL_BRIEF_ONLY" };
  const state = existsSync(config.stateFile) ? readJson(config.stateFile) : { deployments: {} };
  const baseline = servedBaseline(cwd, config, state);
  const work = inventory(cwd, baseline?.sha ?? `origin/${LIVE}`);
  const pending = { count: work.count, baseSHA: work.baseSHA, remoteBaseSHA: work.remoteBaseSHA,
    auto: { status: baseline ? "SERVED_BASELINE_ACCREDITED" : "AUTO_WAITING_SERVED_BASELINE", count: baseline ? work.count : null, countBaseSHA: baseline?.sha ?? null, threshold: 10, watchIntervalMs: 1200000, cooldownMs: 600000 },
    mergeBranches: work.branches.map(b => ({ branch: b.branch, sha: b.sha })), excluded: work.excluded };
  if (mode !== "pp") return { status: "READ_ONLY", scope: "#173", ...pending, commits: work.functional.map(i => ({ sha: i.sha, type: /^(\w+)/.exec(i.subject)?.[1] ?? "other", subject: i.subject, patchId: i.patch })) };
  const urls = ["https://ledbox.online/api/health", "https://ledbox.online/", "https://app.ledbox.online/login", "https://eventos.ledbox.online/", "https://clientes.ledbox.online/", "https://demo.ledbox.online/"];
  return { status: "READ_ONLY", scope: "#173", ...pending, liveBranch: LIVE, head: git(cwd, "rev-parse", "HEAD"), localVersion: readJson(join(cwd, "package.json")).version, candidateSHA: state?.pending?.candidateSHA ?? null, releaseSHA: state?.pending?.releaseSHA ?? null, paused: existsSync(config.pauseFile), slots: slotStatus(cwd), issue: issueReader(cwd), ownerPending: ownerPending(cwd), surfaces: await Promise.all(urls.map(url => surface(url, fetcher))) };
}
