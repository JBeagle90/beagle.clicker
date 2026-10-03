// How the scheduled update is coming along, for the owner's panel (owner.js, GET progress): the
// newest run of .github/workflows/scheduled-update.yml on GitHub, as plain stages, and when the
// last few checks ran. Read with GH_DISPATCH_TOKEN when it's set (it can read Actions); without it,
// GitHub's public API answers too (the repository is public), but only 60 times an hour, so
// answers are kept longer.
//   → { ok, run: { id, url, event, status, conclusion, at, updatedAt }, stages: [{ key, label, state,
//       startedAt, endedAt }], summary, checks: [{ at, event, status, conclusion }], checkedAt }
//   state: done | running | waiting | skipped | failed
"use strict";
const { json } = require("./util");

const KEEP_TOKEN = 10 * 1000, KEEP_PUBLIC = 90 * 1000; // how long one answer from GitHub is reused
const CHECKS = 6;

const repoOf = env => /^[\w.-]+\/[\w.-]+$/.test(env.GH_REPO || "") ? env.GH_REPO : "JBeagle90/beagle.clicker";

// The stages, from the workflow's jobs and steps. Keep in step with the names in the workflow.
const STAGES = [
  { key: "pick", label: "Picking what to build", job: "pick" },
  { key: "screen", label: "Checking it suits the game", job: "build", steps: ["Screen the suggestion", "Screen result"] },
  { key: "build", label: "Claude is building it", job: "build", steps: ["Claude builds it"] },
  { key: "check", label: "Tests and checks", job: "build", steps: ["Cost and refusals", "What Claude says", "Tests", "Guard", "Build", "Commit, with its line in the changelog"] },
  { key: "publish", label: "Publishing it", job: "publish" },
  { key: "deploy", label: "Going live", job: "deploy" }, // the Deploy workflow's jobs: "deploy / test", "deploy / deploy"
  { key: "report", label: "Telling the game", job: "report" },
];

// One GitHub job or step → done | running | waiting | skipped | failed.
function stateOf(x) {
  if (x.status !== "completed") return x.status === "in_progress" ? "running" : "waiting";
  return x.conclusion === "success" || x.conclusion === "neutral" ? "done" : x.conclusion === "skipped" ? "skipped" : "failed";
}

// Several jobs or steps as one stage.
function combine(items) {
  if (!items.length) return null;
  const s = items.map(stateOf);
  const state = s.includes("failed") ? "failed" : s.includes("running") ? "running"
    : s.every(x => x === "skipped") ? "skipped" : s.every(x => x === "done" || x === "skipped") ? "done"
    : s.includes("done") ? "running" : "waiting";
  const times = k => items.map(x => Date.parse(x[k] || "")).filter(t => t > 0);
  const started = times("started_at"), ended = times("completed_at");
  return { state, startedAt: started.length ? Math.min(...started) : null,
    endedAt: (state === "done" || state === "failed") && ended.length ? Math.max(...ended) : null };
}

function stagesOf(run, jobs) {
  const over = run.status === "completed";
  return STAGES.map(st => {
    const js = jobs.filter(j => j.name === st.job || j.name.startsWith(st.job + " / "));
    let got = null;
    if (st.steps && js.length) {
      const steps = (js[0].steps || []).filter(s => st.steps.includes(s.name));
      // The job hasn't reached these steps yet, or never will (skipped, failed before them).
      got = combine(steps) || (stateOf(js[0]) === "running" ? { state: "waiting" } : null);
    } else got = combine(js);
    // Not there yet: waiting while the run goes on, skipped once it's over.
    if (!got) got = { state: over ? "skipped" : "waiting" };
    else if (over && (got.state === "waiting" || got.state === "running")) got = { state: "skipped" };
    return { key: st.key, label: st.label, state: got.state, startedAt: got.startedAt || null, endedAt: got.endedAt || null };
  });
}

// One line on how the run went, or where it is.
function summaryOf(run, stages) {
  const at = k => stages.find(s => s.key === k).state;
  if (run.status !== "completed") {
    const now = stages.find(s => s.state === "running") || stages.find(s => s.state === "waiting");
    return run.status === "in_progress" && now ? now.label + "…" : "Waiting for GitHub to start it…";
  }
  if (at("pick") === "skipped") return "Skipped: updates are paused (the UPDATES_PAUSED variable on GitHub).";
  const failed = stages.find(s => s.state === "failed");
  if (failed) return `It stopped at “${failed.label}”. The run on GitHub says why.`;
  if (run.conclusion === "cancelled") return "It was cancelled on GitHub.";
  if (at("report") === "done" && at("deploy") === "done") return "Finished: the update is live.";
  if (at("build") === "skipped" && at("screen") === "done") return "The quick check turned the suggestion down, so it wasn't built (see Recent runs).";
  if (at("build") === "skipped") return "Only a check: no update was due then, or there was nothing to build.";
  if (at("publish") === "skipped") return "Built, but not published: Claude turned it down or a check didn't pass (see Recent runs).";
  return "Finished.";
}

async function gh(env, path) {
  const headers = { Accept: "application/vnd.github+json", "X-GitHub-Api-Version": "2022-11-28", "User-Agent": "beagle.clicker" };
  if (env.GH_DISPATCH_TOKEN) headers.Authorization = `Bearer ${env.GH_DISPATCH_TOKEN}`;
  const r = await fetch(`https://api.github.com/repos/${repoOf(env)}/actions/${path}`, { headers, signal: AbortSignal.timeout(6000) });
  if (!r.ok) throw new Error(r.status === 403 || r.status === 429 ? "GitHub says to slow down. Adding GH_DISPATCH_TOKEN in Azure lifts that." : `GitHub answered ${r.status}.`);
  return r.json();
}

async function fresh(c) {
  const runs = (await gh(c.env, `workflows/scheduled-update.yml/runs?per_page=${CHECKS}`)).workflow_runs || [];
  if (!runs.length) return { ok: true, run: null, stages: [], summary: "No runs yet.", checks: [] };
  // The one under way (a check can be queued behind it), else the newest.
  const run = runs.find(r => r.status === "in_progress") || runs[0];
  const jobs = (await gh(c.env, `runs/${run.id}/jobs?per_page=30`)).jobs || [];
  const stages = stagesOf(run, jobs);
  return {
    ok: true,
    run: { id: run.id, url: run.html_url, event: run.event, status: run.status, conclusion: run.conclusion,
      at: Date.parse(run.run_started_at || run.created_at), updatedAt: Date.parse(run.updated_at) },
    stages, summary: summaryOf(run, stages),
    checks: runs.map(r => ({ at: Date.parse(r.run_started_at || r.created_at), event: r.event, status: r.status, conclusion: r.conclusion })),
  };
}

// GitHub's answer, reused for a few seconds so the panel's refreshes stay within GitHub's limits.
async function progress(c) {
  const keep = c.env.GH_DISPATCH_TOKEN ? KEEP_TOKEN : KEEP_PUBLIC;
  const cached = await c.store.read("sys", "ghrun");
  if (cached && c.now - cached.at < keep) return json(200, { ...cached.data, checkedAt: cached.at });
  try {
    const data = await fresh(c);
    await c.store.upsert({ id: "ghrun", pk: "sys", at: c.now, data, ttl: 3600 });
    return json(200, { ...data, checkedAt: c.now });
  } catch (e) {
    const why = e && e.name === "TimeoutError" ? "GitHub didn't answer in time." : (e && e.message) || "GitHub couldn't be reached.";
    if (cached) return json(200, { ...cached.data, checkedAt: cached.at, stale: why });
    return json(200, { ok: false, why });
  }
}

module.exports = { progress, repoOf, stagesOf, summaryOf };
