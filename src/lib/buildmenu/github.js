// ============================================================
//  GITHUB ACTIONS BUILD ENGINE (diport dari server_github_actions_trigger.js ke ESM)
//  Build APK sepenuhnya lewat GitHub Actions (tanpa VPS). Mendukung BANYAK worker (repo + token) dengan
//  pemilihan round-robin. Kelola lewat /addworkergithub, /listworkergithub, /removeworkergithub (owner).
//
//  Kontrak dengan workflow (.github/workflows/build-flutter.yml): inputs { jobId, userId, payload }.
//  payload = JSON { mode:"zip", url, buildType, perfMode, engine, tag }; artifact hasil build = apk-<jobId>.
//  Worker = { id, label, repo "owner/repo", token, workflows:{ flutter, native }, enabled, addedBy, addedAt }
//  Data worker: database/githubworkers.json
// ============================================================
import fs from "fs";
import path from "path";
import axios from "axios";
import { pipeline } from "stream/promises";

const WORKERS_PATH = path.join(process.cwd(), "database", "githubworkers.json");
const API = "https://api.github.com";
export const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// ─── CRUD worker ─────────────────────────────────────────────
export function listWorkers() {
  try { return JSON.parse(fs.readFileSync(WORKERS_PATH, "utf8")); } catch { return []; }
}
function saveWorkers(list) {
  fs.mkdirSync(path.dirname(WORKERS_PATH), { recursive: true });
  fs.writeFileSync(WORKERS_PATH, JSON.stringify(list, null, 2));
}
export const getWorker = (id) => listWorkers().find((w) => w.id === id) || null;

export function addWorker({ label, repo, token, workflowFlutter, workflowNative, addedBy }) {
  const list = listWorkers();
  const worker = {
    id: "gh-" + Date.now().toString(36) + Math.random().toString(36).slice(2, 6),
    label: label || repo,
    repo,
    token,
    workflows: {
      flutter: workflowFlutter || "build-flutter.yml",
      ...(workflowNative ? { native: workflowNative } : {}), // kosong = engine native memakai workflow Flutter
    },
    enabled: true,
    addedBy: Number(addedBy),
    addedAt: new Date().toISOString(),
  };
  list.push(worker);
  saveWorkers(list);
  return worker;
}
export function removeWorker(idOrIndex) {
  const list = listWorkers();
  const i = /^\d+$/.test(String(idOrIndex)) ? Number(idOrIndex) - 1 : list.findIndex((w) => w.id === idOrIndex);
  if (i < 0 || i >= list.length) return null;
  const [gone] = list.splice(i, 1);
  saveWorkers(list);
  return gone;
}

// Round-robin antar worker yang aktif
let cursor = 0;
export function pickWorkerRoundRobin() {
  const c = listWorkers().filter((w) => w.enabled !== false);
  if (!c.length) return null;
  const i = cursor % c.length;
  cursor = (i + 1) % c.length;
  return c[i];
}

const authHeaders = (w) => ({ Authorization: `Bearer ${w.token}`, Accept: "application/vnd.github.v3+json" });

// ─── Cabang default & release (tempat ZIP source dititipkan) ─
const branchCache = new Map();
async function getDefaultBranch(w) {
  if (branchCache.has(w.repo)) return branchCache.get(w.repo);
  try {
    const { data } = await axios.get(`${API}/repos/${w.repo}`, { headers: authHeaders(w), timeout: 20000 });
    branchCache.set(w.repo, data.default_branch || "main");
  } catch {
    return "main";
  }
  return branchCache.get(w.repo);
}

async function getLatestCommitSha(w) {
  const branch = await getDefaultBranch(w);
  const { data } = await axios.get(`${API}/repos/${w.repo}/git/ref/heads/${branch}`, { headers: authHeaders(w), timeout: 20000 });
  return data.object.sha;
}

/** Cek token & repo (dipakai /addworkergithub). Lempar error dengan pesan jelas bila gagal. */
export async function verifyWorker(w) {
  try {
    const { data } = await axios.get(`${API}/repos/${w.repo}`, { headers: authHeaders(w), timeout: 20000 });
    return { branch: data.default_branch, private: data.private, canPush: data.permissions ? !!(data.permissions.push || data.permissions.admin) : true };
  } catch (e) {
    const s = e.response?.status;
    if (s === 401) throw new Error("Token GitHub tidak valid / kedaluwarsa.");
    if (s === 404) throw new Error("Repo tidak ditemukan (atau token tidak punya akses ke repo itu).");
    throw new Error(`Gagal menghubungi GitHub: ${e.message}`);
  }
}

/** Upload ZIP project sebagai release asset sementara (di-stream, tidak dimuat ke RAM). Return { releaseId, browserUrl } */
export async function uploadZipToRelease(w, localZip, fileName, tag) {
  const headers = authHeaders(w);
  try {
    const sha = await getLatestCommitSha(w);
    await axios.post(`${API}/repos/${w.repo}/git/refs`, { ref: `refs/tags/${tag}`, sha }, { headers, timeout: 20000 }).catch(() => {});
  } catch {}
  const rel = await axios.post(
    `${API}/repos/${w.repo}/releases`,
    { tag_name: tag, name: `Build Source ${tag}`, body: `Temporary release untuk build ${tag}. Dihapus otomatis setelah build selesai.`, draft: false, prerelease: true },
    { headers, timeout: 30000 }
  );
  const releaseId = rel.data.id;
  try {
    const uploadUrl = rel.data.upload_url.replace("{?name,label}", `?name=${encodeURIComponent(fileName || "project.zip")}`);
    const asset = await axios.post(uploadUrl, fs.createReadStream(localZip), {
      headers: { ...headers, "Content-Type": "application/zip", "Content-Length": fs.statSync(localZip).size },
      maxBodyLength: Infinity,
      maxContentLength: Infinity,
      timeout: 600000,
    });
    return { releaseId, browserUrl: asset.data.browser_download_url };
  } catch (e) {
    await deleteRelease(w, releaseId).catch(() => {});
    throw e;
  }
}

export async function deleteRelease(w, releaseId) {
  if (!releaseId) return;
  const headers = authHeaders(w);
  try {
    const { data } = await axios.get(`${API}/repos/${w.repo}/releases/${releaseId}`, { headers, timeout: 20000 });
    await axios.delete(`${API}/repos/${w.repo}/releases/${releaseId}`, { headers, timeout: 20000 }).catch(() => {});
    if (data.tag_name) await axios.delete(`${API}/repos/${w.repo}/git/refs/tags/${data.tag_name}`, { headers, timeout: 20000 }).catch(() => {});
  } catch {}
}

// ─── Dispatch workflow & polling ─────────────────────────────
async function findWorkflowRun(w, workflowFile, since, tries = 8) {
  for (let i = 0; i < tries; i++) {
    try {
      const { data } = await axios.get(`${API}/repos/${w.repo}/actions/workflows/${workflowFile}/runs?event=workflow_dispatch&per_page=5`, { headers: authHeaders(w), timeout: 20000 });
      const run = (data.workflow_runs || []).find((r) => new Date(r.created_at).getTime() >= since - 15000);
      if (run) return run.id;
    } catch {}
    await sleep(4000);
  }
  return null;
}

/** Jalankan workflow build dari ZIP source. Return runId. */
export async function triggerWorkflow(w, browserUrl, tag, { buildType = "release", perfMode = "fast", engine = "flutter" } = {}) {
  const isNative = engine === "native";
  const workflowFile = (isNative && w.workflows?.native) || w.workflows?.flutter || "build-flutter.yml";
  const branch = await getDefaultBranch(w);
  const since = Date.now();
  await axios.post(
    `${API}/repos/${w.repo}/actions/workflows/${workflowFile}/dispatches`,
    {
      ref: branch,
      inputs: {
        jobId: String(tag),
        userId: "0",
        payload: JSON.stringify({
          mode: "zip",
          url: browserUrl,
          buildType: buildType === "debug" ? "debug" : "release",
          perfMode: perfMode === "low" ? "low" : "fast", // fast = arm64 saja | low = arm32 + arm64 (device lama)
          engine: isNative ? "native" : "flutter",
          tag,
        }),
      },
    },
    { headers: authHeaders(w), timeout: 30000 }
  );
  await sleep(5000);
  const runId = await findWorkflowRun(w, workflowFile, since);
  if (!runId) throw new Error("Gagal menemukan workflow run di GitHub Actions setelah dispatch.");
  return runId;
}

/** Status run: { status, conclusion, durationSec } */
export async function getRunStatus(w, runId) {
  const { data: run } = await axios.get(`${API}/repos/${w.repo}/actions/runs/${runId}`, { headers: authHeaders(w), timeout: 20000 });
  let durationSec = 0;
  if (run.run_started_at) {
    const end = run.status === "completed" && run.updated_at ? new Date(run.updated_at).getTime() : Date.now();
    durationSec = Math.max(0, Math.round((end - new Date(run.run_started_at).getTime()) / 1000));
  }
  return { status: run.status, conclusion: run.conclusion, durationSec };
}

export async function cancelRun(w, runId) {
  await axios.post(`${API}/repos/${w.repo}/actions/runs/${runId}/cancel`, {}, { headers: authHeaders(w), timeout: 20000 }).catch(() => {});
}

export async function getArtifacts(w, runId) {
  const { data } = await axios.get(`${API}/repos/${w.repo}/actions/runs/${runId}/artifacts`, { headers: authHeaders(w), timeout: 20000 });
  return (data.artifacts || []).map((a) => ({ id: a.id, name: a.name }));
}

/** Download artifact (.zip berisi APK) langsung ke disk, retry 3x */
export async function downloadArtifactZip(w, artifactId, dest) {
  let last;
  for (let i = 1; i <= 3; i++) {
    try {
      const res = await axios.get(`${API}/repos/${w.repo}/actions/artifacts/${artifactId}/zip`, {
        headers: authHeaders(w), responseType: "stream", maxContentLength: 1024 ** 3, maxRedirects: 5, timeout: 300000,
      });
      await pipeline(res.data, fs.createWriteStream(dest));
      return;
    } catch (e) {
      last = e;
      try { fs.unlinkSync(dest); } catch {}
      if (i < 3) await sleep(1500 * i);
    }
  }
  throw last;
}

// ─── Log error build ─────────────────────────────────────────
const ERR_LINE_RES = [
  /##\[error\]/i, /^e: (file:\/\/)?\S+\.kts?:\d+/i, /\.dart:\d+:\d+: (Error|Warning)/i, /\.java:\d+: error:/i,
  /FAILURE: Build failed/i, /What went wrong:/i, /Execution failed for task/i, /Gradle task .* failed/i,
  /\berror:\s/i, /\bException\b|\bError:\s/, /Could not (resolve|find|GET|determine)/i, /Unhandled exception|Bad state|No such file/i,
];

/** Log job yang gagal, dengan blok error bernomor baris. Return null bila tidak ada job gagal. */
export async function getFailedStepLog(w, runId) {
  const headers = authHeaders(w);
  let jobs = [];
  try {
    jobs = (await axios.get(`${API}/repos/${w.repo}/actions/runs/${runId}/jobs?per_page=50`, { headers, timeout: 20000 })).data.jobs || [];
  } catch { return null; }
  const failedJob = jobs.find((j) => j.conclusion === "failure") || jobs.find((j) => ["cancelled", "timed_out"].includes(j.conclusion));
  if (!failedJob) return null;
  const step = failedJob.steps?.find((s) => s.conclusion === "failure");
  const base = { stepName: step?.name || failedJob.name, stepNumber: step?.number || null, jobName: failedJob.name };

  let raw = "";
  for (let i = 1; i <= 3 && !raw; i++) {
    try {
      raw = String((await axios.get(`${API}/repos/${w.repo}/actions/jobs/${failedJob.id}/logs`, {
        headers, responseType: "text", transformResponse: [(d) => d], timeout: 45000, maxContentLength: 80 * 1024 * 1024,
      })).data || "");
    } catch { if (i < 3) await sleep(1500 * i); }
  }
  if (!raw) return { ...base, errorBlocks: [], locations: [], fullLog: "", totalLines: 0, tail: [] };

  const lines = raw.replace(/\r/g, "").split("\n").map((l) => l.replace(/^﻿/, "").replace(/^\d{4}-\d{2}-\d{2}T[\d:.]+Z\s?/, ""));
  const total = lines.length;
  const hit = [];
  for (let i = 0; i < total; i++) if (ERR_LINE_RES.some((re) => re.test(lines[i]))) hit.push(i);

  const blocks = [];
  for (const i of hit) {
    const from = Math.max(0, i - 3), to = Math.min(total - 1, i + 6);
    const last = blocks[blocks.length - 1];
    if (last && from <= last.to + 1) last.to = Math.max(last.to, to);
    else blocks.push({ from, to, first: i });
  }
  const errorBlocks = blocks.slice(0, 25).map((b) => ({
    from: b.from + 1, to: b.to + 1,
    lines: lines.slice(b.from, b.to + 1).map((t, k) => `L${String(b.from + k + 1).padStart(5, " ")} | ${t}`),
  }));

  const locations = [];
  const seen = new Set();
  const LOC = /([A-Za-z0-9_\-./\\]+\.(?:dart|kt|kts|java|gradle|xml|yaml|yml|json|properties|swift)):(\d+)(?::(\d+))?/g;
  for (const i of hit) {
    for (const m of lines[i].matchAll(LOC)) {
      const key = `${m[1]}:${m[2]}:${m[3] || ""}`;
      if (seen.has(key) || locations.length >= 15) continue;
      seen.add(key);
      locations.push({ file: m[1], line: m[2], col: m[3] || null, logLine: i + 1 });
    }
  }
  return { ...base, errorBlocks, locations, fullLog: lines.join("\n"), totalLines: total, tail: lines.filter(Boolean).slice(-60) };
}
