// ============================================================
//  Klien Pterodactyl untuk fitur CPanel + penyimpanan slot panel.
//  Slot: "1".."20" (Panel V1..V20) dan "adp" (panel khusus Admin Panel).
//  Domain + PLTA (Application API) disimpan di database/main/cpanel.json (lewat /setpanel
//  atau seed dari config.js -> cpanel.panels).
// ============================================================
import axios from "axios";
import { cpanelDb } from "../../database.js";
import { SLOTS } from "./roles.js";
import { cfg } from "./util.js";

export const PANEL_SLOTS = [...SLOTS, "adp"];
export const isValidSlot = (s) => PANEL_SLOTS.includes(String(s));
export const slotName = (s) => (String(s) === "adp" ? "Panel ADP" : `Panel V${s}`);

// ---------- Slot panel ----------
const clean = (p) => ({
  domain: String(p.domain || "").trim().replace(/\/+$/, ""),
  plta: String(p.plta || "").trim(),
  pltc: String(p.pltc || "").trim(),
});

/** Seed dari config.js bila slot belum diisi lewat database */
function seedFromConfig() {
  let dirty = false;
  for (const [slot, p] of Object.entries(cfg().panels || {})) {
    if (!isValidSlot(slot) || !p?.domain || !p?.plta) continue;
    if (!cpanelDb.data.panels[slot]?.domain) {
      cpanelDb.data.panels[slot] = { ...clean(p), updatedAt: new Date().toISOString() };
      dirty = true;
    }
  }
  if (dirty) cpanelDb.write().catch(() => {});
}
seedFromConfig();

export function getPanel(slot) {
  const p = cpanelDb.data.panels[String(slot)];
  return p?.domain && p?.plta ? p : null;
}

export async function setPanel(slot, { domain, plta, pltc }) {
  if (!isValidSlot(slot)) throw new Error("Slot panel tidak dikenal.");
  if (!/^https?:\/\//i.test(domain || "")) throw new Error("Domain harus diawali http:// atau https://");
  if (!plta) throw new Error("PLTA (Application API key) wajib diisi.");
  cpanelDb.data.panels[String(slot)] = { ...clean({ domain, plta, pltc }), updatedAt: new Date().toISOString() };
  await cpanelDb.write();
}

export async function removePanel(slot) {
  if (!cpanelDb.data.panels[String(slot)]) return false;
  delete cpanelDb.data.panels[String(slot)];
  await cpanelDb.write();
  return true;
}

export const getActiveSlot = () => cpanelDb.data.active || "1";
export async function setActiveSlot(slot) {
  cpanelDb.data.active = String(slot);
  await cpanelDb.write();
}

// ---------- Setting on/off ----------
const DEFAULTS = { panelres: true, paneladp: true, adp: false };
export const getSetting = (key) => cpanelDb.data.settings[key] ?? DEFAULTS[key];
export async function setSetting(key, value) {
  cpanelDb.data.settings[key] = !!value;
  await cpanelDb.write();
}

// ---------- API ----------
/**
 * Panggil Application API. Mengembalikan { ok, status, data, error }.
 * Tidak pernah melempar error: kegagalan jaringan -> { ok:false, error }.
 */
export async function api(slot, method, path, body) {
  const p = getPanel(slot);
  if (!p) return { ok: false, status: 0, error: `${slotName(slot)} belum diatur. Owner bot: /setpanel ${slot} <domain> <plta> <pltc>` };
  try {
    const res = await axios({
      method,
      url: `${p.domain}/api/application${path}`,
      data: body,
      timeout: 30_000,
      validateStatus: () => true,
      headers: { Accept: "application/json", "Content-Type": "application/json", Authorization: `Bearer ${p.plta}` },
    });
    const ok = res.status >= 200 && res.status < 300;
    const err = res.data?.errors?.[0];
    return { ok, status: res.status, data: res.data, error: ok ? null : err?.detail || `HTTP ${res.status}` };
  } catch (e) {
    return { ok: false, status: 0, error: `Tidak bisa terhubung ke panel: ${e.code || e.message}` };
  }
}

/** Panggil Client API (butuh PLTC). Mengembalikan { ok, status, data, error } dan tidak pernah melempar error. */
export async function clientApi(slot, path) {
  const p = getPanel(slot);
  if (!p) return { ok: false, status: 0, error: `${slotName(slot)} belum diatur.` };
  if (!p.pltc) return { ok: false, status: 0, error: `PLTC (Client API key) ${slotName(slot)} belum diisi.` };
  try {
    const res = await axios({
      method: "GET",
      url: `${p.domain}/api/client${path}`,
      timeout: 20_000,
      validateStatus: () => true,
      headers: { Accept: "application/json", Authorization: `Bearer ${p.pltc}` },
    });
    const ok = res.status >= 200 && res.status < 300;
    return { ok, status: res.status, data: res.data, error: ok ? null : res.data?.errors?.[0]?.detail || `HTTP ${res.status}` };
  } catch (e) {
    return { ok: false, status: 0, error: `Tidak bisa terhubung ke panel: ${e.code || e.message}` };
  }
}

/** Ambil semua halaman suatu resource ("servers" | "users") */
export async function listAll(slot, resource) {
  const out = [];
  for (let page = 1; page <= 50; page++) {
    const r = await api(slot, "GET", `/${resource}?page=${page}&per_page=100`);
    if (!r.ok) return { ok: false, error: r.error, items: out };
    out.push(...(r.data.data || []).map((x) => x.attributes));
    const meta = r.data.meta?.pagination;
    if (!meta || page >= meta.total_pages) break;
  }
  return { ok: true, items: out };
}

export async function findServer(slot, input) {
  const q = String(input).trim();
  if (/^\d+$/.test(q)) {
    const r = await api(slot, "GET", `/servers/${q}`);
    if (r.ok) return { ok: true, server: r.data.attributes };
    if (r.status !== 404) return { ok: false, error: r.error };
  }
  const all = await listAll(slot, "servers");
  if (!all.ok) return { ok: false, error: all.error };
  const s = all.items.find((x) => x.uuid === q || x.identifier === q || x.uuid.startsWith(q));
  return s ? { ok: true, server: s } : { ok: false, error: "Server tidak ditemukan." };
}

// ---------- Egg ----------
export const RUNTIME_LABEL = { node: "Node.js", python: "Python" };

/** Tebak runtime egg dari nama egg / nama nest. null = bukan Node.js/Python */
export function eggRuntime(egg) {
  const byName = String(egg.name || "").toLowerCase();
  if (byName.includes("node")) return "node";
  if (byName.includes("python")) return "python";
  const byNest = String(egg.nestName || "").toLowerCase();
  if (byNest.includes("node")) return "node";
  if (byNest.includes("python")) return "python";
  return null;
}

/**
 * Ambil semua egg dari panel (semua nest). Hasil: array { id, name, nestId, nestName }.
 * Properti array `listError` terisi bila panel gagal dibaca.
 * Bila panel tidak mengembalikan egg sama sekali, dipakai egg cadangan dari config (eggNode / eggPython).
 */
export async function listEggChoices(slot) {
  const c = cfg();
  const out = [];
  const errors = [];
  const add = (egg, nestId, nestName) => {
    const id = Number(egg?.attributes?.id);
    const name = egg?.attributes?.name;
    if (id && name) out.push({ id, name: String(name), nestId: Number(nestId), nestName: String(nestName || "") });
  };

  // Cara 1: satu panggilan (nests?include=eggs)
  const nests = [];
  const r = await api(slot, "GET", "/nests?include=eggs&per_page=100");
  if (r.ok) {
    for (const nest of r.data.data || []) {
      const nestId = Number(nest.attributes?.id);
      const nestName = nest.attributes?.name;
      nests.push({ id: nestId, name: nestName });
      for (const egg of nest.attributes?.relationships?.eggs?.data || []) add(egg, nestId, nestName);
    }
  } else errors.push(r.error);

  // Cara 2 (cadangan): ambil egg tiap nest bila cara 1 tidak menghasilkan egg
  if (!out.length && nests.length) {
    await Promise.all(
      nests.map(async (n) => {
        const er = await api(slot, "GET", `/nests/${n.id}/eggs?per_page=100`);
        if (!er.ok) return errors.push(`Nest ${n.id}: ${er.error}`);
        for (const egg of er.data.data || []) add(egg, n.id, n.name);
      })
    );
  }

  // buang duplikat
  const seen = new Set();
  const eggs = out.filter((e) => {
    const k = `${e.nestId}:${e.id}`;
    if (seen.has(k)) return false;
    seen.add(k);
    return true;
  });
  eggs.sort((a, b) => a.name.localeCompare(b.name, "en", { numeric: true }));

  // Panel tidak mengembalikan egg sama sekali -> pakai ID egg dari config.js (tetap wajib dipilih lewat tombol)
  if (!eggs.length) {
    if (c.eggNode) eggs.push({ id: c.eggNode, name: "Node.js (default)", nestId: 0, nestName: "default", fallback: "node" });
    if (c.eggPython) eggs.push({ id: c.eggPython, name: "Python (default)", nestId: 0, nestName: "default", fallback: "python" });
    if (errors.length) eggs.listError = errors[0];
  }
  return eggs;
}

/** Ringkasan egg yang terdeteksi (untuk pesan "egg belum tersedia") */
export function eggSummary(eggs) {
  if (eggs?.listError) return `Gagal membaca daftar egg: ${String(eggs.listError).slice(0, 120)}`;
  const names = (eggs || []).filter((e) => !e.fallback).map((e) => e.name);
  if (!names.length) return "Panel tidak mengembalikan egg apa pun (cek akses API key / Nest & Egg).";
  return `Egg terdeteksi: ${names.slice(0, 8).join(", ")}${names.length > 8 ? ", ..." : ""}`;
}

/**
 * Detail egg terpilih (docker image, startup, environment default).
 * Mengembalikan { ok, egg: { id, name, dockerImage, startup, environment } } atau { ok:false, error }.
 */
export async function getEggDetail(slot, choice) {
  const c = cfg();
  if (choice.fallback) {
    const py = choice.fallback === "python";
    return {
      ok: true,
      egg: {
        id: choice.id,
        name: choice.name,
        dockerImage: py ? c.dockerPython : c.dockerNode,
        startup: py ? STARTUP_PY : STARTUP_NODE,
        environment: py ? { ...ENV_PY } : { ...ENV_NODE },
      },
    };
  }
  const r = await api(slot, "GET", `/nests/${choice.nestId}/eggs/${choice.id}?include=variables`);
  if (!r.ok) return { ok: false, error: r.error || `Gagal mengambil detail Egg ${choice.name}` };
  const a = r.data.attributes || {};
  const environment = {};
  for (const item of a.relationships?.variables?.data || []) {
    const v = item.attributes || {};
    if (v.env_variable && v.default_value !== null && v.default_value !== undefined) environment[v.env_variable] = String(v.default_value);
  }
  const dockerImage = a.docker_image || (Array.isArray(a.docker_images) ? a.docker_images[0] : Object.values(a.docker_images || {})[0]) || null;
  if (!dockerImage || !a.startup) return { ok: false, error: `Egg ${choice.name} tidak memiliki Docker Image atau Startup yang valid.` };
  return { ok: true, egg: { id: choice.id, name: choice.name, dockerImage, startup: a.startup, environment } };
}

const STARTUP_NODE =
  'if [[ -d .git ]] && [[ {{AUTO_UPDATE}} == "1" ]]; then git pull; fi; if [[ ! -z ${NODE_PACKAGES} ]]; then /usr/local/bin/npm install ${NODE_PACKAGES}; fi; if [[ ! -z ${UNNODE_PACKAGES} ]]; then /usr/local/bin/npm uninstall ${UNNODE_PACKAGES}; fi; if [ -f /home/container/package.json ]; then /usr/local/bin/npm install; fi; /usr/local/bin/${CMD_RUN}';
const STARTUP_PY =
  'if [[ -d .git ]] && [[ {{AUTO_UPDATE}} == "1" ]]; then git pull; fi; if [[ -f /home/container/requirements.txt ]]; then pip install --user -r requirements.txt; fi; python3 ${PY_FILE}';
const ENV_NODE = { INST: "npm", USER_UPLOAD: "0", AUTO_UPDATE: "0", CMD_RUN: "npm start", MAIN_FILE: "index.js" };
const ENV_PY = { PY_FILE: "main.py", REQUIREMENTS_FILE: "requirements.txt", USER_UPLOAD: "1", AUTO_UPDATE: "0" };

// ---------- Operasi ----------
export async function createUser(slot, { username, email, password, admin = false }) {
  const r = await api(slot, "POST", "/users", {
    email,
    username,
    first_name: username,
    last_name: admin ? "admin" : username,
    language: "en",
    root_admin: !!admin,
    password,
  });
  return r.ok ? { ok: true, user: r.data.attributes } : { ok: false, error: r.error, status: r.status };
}

/**
 * egg WAJIB (hasil getEggDetail().egg): { id, dockerImage, startup, environment }.
 * limits: { memory, disk, cpu } (0 = unlimited)
 */
export async function createServer(slot, { userId, name, egg, limits }) {
  if (!egg?.id) return { ok: false, error: "Egg belum dipilih." };
  const c = cfg();
  const r = await api(slot, "POST", "/servers", {
    name,
    user: userId,
    egg: egg.id,
    docker_image: egg.dockerImage,
    startup: egg.startup,
    environment: egg.environment,
    limits: { memory: limits.memory, swap: 0, disk: limits.disk, io: 500, cpu: limits.cpu },
    feature_limits: { databases: 5, backups: 5, allocations: 1 },
    deploy: { locations: [c.loc], dedicated_ip: false, port_range: [] },
  });
  return r.ok ? { ok: true, server: r.data.attributes } : { ok: false, error: r.error };
}

export const deleteUser = (slot, id) => api(slot, "DELETE", `/users/${id}`);
export const deleteServer = (slot, id) => api(slot, "DELETE", `/servers/${id}`);
export const suspendServer = (slot, id) => api(slot, "POST", `/servers/${id}/suspend`);
export const unsuspendServer = (slot, id) => api(slot, "POST", `/servers/${id}/unsuspend`);

export async function changePassword(slot, userId, newPassword) {
  const g = await api(slot, "GET", `/users/${userId}`);
  if (!g.ok) return { ok: false, error: g.error };
  const u = g.data.attributes;
  const r = await api(slot, "PATCH", `/users/${userId}`, {
    email: u.email,
    username: u.username,
    first_name: u.first_name,
    last_name: u.last_name,
    language: u.language || "en",
    password: newPassword,
  });
  return r.ok ? { ok: true, user: r.data.attributes } : { ok: false, error: r.error };
}
