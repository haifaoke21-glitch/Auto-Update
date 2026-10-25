// ============================================================
//  CVPS — klien DigitalOcean + data pilihan (spec / OS / region)
//  Dipindah dari bot CPANEL (src/cvps.js). API key DO disimpan per slot (1..10)
//  di database/main/cpanel.json -> "do" (lewat /setdo, atau seed dari config.js -> cvps.apiKeys).
// ============================================================
import axios from "axios";
import config from "../../../config.js";
import { cpanelDb } from "../../database.js";
import { canUseVps } from "../cpanel/roles.js";
import { editCbView, note } from "../richUi.js";

export const DO_SLOTS = Array.from({ length: 10 }, (_, i) => String(i + 1));
export const isDoSlot = (s) => DO_SLOTS.includes(String(s));
const BASE = "https://api.digitalocean.com/v2";

export const cvpsCfg = () => {
  const c = config.cvps || {};
  return {
    apiKeys: c.apiKeys || {},
    tag: String(c.tag || "azmistecu-vps").replace(/[^A-Za-z0-9:_-]/g, "-"),
    passwordLength: Math.min(Math.max(parseInt(c.passwordLength ?? 14), 8), 32),
    rules: Array.isArray(c.rules) && c.rules.length ? c.rules : ["No hacking", "No mining", "No torrent", "No DDoS", "No overload (CPU 100%)", "Dilarang untuk aktivitas ilegal apa pun"],
  };
};

// ---------- Spesifikasi, OS & region ----------
export const vpsSpecs = {
  r1c1: { size: "s-1vcpu-1gb", name: "RAM 1GB • Core 1", icon: "🟦" },
  r2c2: { size: "s-2vcpu-2gb", name: "RAM 2GB • Core 2", icon: "🟦" },
  r4c2: { size: "s-2vcpu-4gb", name: "RAM 4GB • Core 2", icon: "🟦" },
  r8c4: { size: "s-4vcpu-8gb", name: "RAM 8GB • Core 4", icon: "🟪" },
  r16c4: { size: "s-4vcpu-16gb-amd", name: "RAM 16GB • Core 4", icon: "🟪" },
  r16c8: { size: "s-8vcpu-16gb-amd", name: "RAM 16GB • Core 8", icon: "🟥" },
  r32c8: { size: "s-8vcpu-32gb-amd", name: "RAM 32GB • Core 8", icon: "🟥" },
};
export const vpsImages = {
  ubuntu20: { image: "ubuntu-20-04-x64", name: "Ubuntu 20.04 LTS" },
  ubuntu22: { image: "ubuntu-22-04-x64", name: "Ubuntu 22.04 LTS" },
  ubuntu24: { image: "ubuntu-24-04-x64", name: "Ubuntu 24.04 LTS" },
  debian11: { image: "debian-11-x64", name: "Debian 11" },
  debian12: { image: "debian-12-x64", name: "Debian 12" },
  centos9: { image: "centos-stream-9-x64", name: "CentOS Stream 9" },
};
export const vpsRegions = {
  sgp1: { name: "Singapore", flag: "🇸🇬", latency: "Tercepat untuk Asia" },
  nyc1: { name: "New York", flag: "🇺🇸", latency: "USA Pantai Timur" },
  sfo3: { name: "San Francisco", flag: "🇺🇸", latency: "USA Pantai Barat" },
  lon1: { name: "London", flag: "🇬🇧", latency: "Eropa Barat" },
  fra1: { name: "Frankfurt", flag: "🇩🇪", latency: "Eropa Tengah" },
  ams3: { name: "Amsterdam", flag: "🇳🇱", latency: "Eropa Barat" },
  tor1: { name: "Toronto", flag: "🇨🇦", latency: "Amerika Utara" },
  blr1: { name: "Bangalore", flag: "🇮🇳", latency: "Asia Selatan" },
};
// OS yang bisa dipilih saat /rebuild (slug image DigitalOcean)
export const REBUILD_OS = [
  { name: "Ubuntu 20.04", slug: "ubuntu-20-04-x64" },
  { name: "Ubuntu 22.04", slug: "ubuntu-22-04-x64" },
  { name: "Ubuntu 24.04", slug: "ubuntu-24-04-x64" },
  { name: "Ubuntu 25.04", slug: "ubuntu-25-04-x64" },
  { name: "Ubuntu 25.10", slug: "ubuntu-25-10-x64" },
  { name: "Fedora 42", slug: "fedora-42-x64" },
  { name: "Debian 12", slug: "debian-12-x64" },
  { name: "Debian 13", slug: "debian-13-x64" },
  { name: "CentOS Stream 9", slug: "centos-stream-9-x64" },
  { name: "CentOS Stream 10", slug: "centos-stream-10-x64" },
  { name: "AlmaLinux 8", slug: "almalinux-8-x64" },
  { name: "AlmaLinux 9", slug: "almalinux-9-x64" },
  { name: "AlmaLinux 10", slug: "almalinux-10-x64" },
  { name: "Rocky Linux 8", slug: "rockylinux-8-x64" },
  { name: "Rocky Linux 9", slug: "rockylinux-9-x64" },
  { name: "Rocky Linux 10", slug: "rockylinux-10-x64" },
];

// ---------- Slot API key ----------
(function seedFromConfig() {
  let dirty = false;
  for (const [slot, key] of Object.entries(cvpsCfg().apiKeys)) {
    if (isDoSlot(slot) && key && !cpanelDb.data.do[slot]?.key) {
      cpanelDb.data.do[slot] = { key: String(key).trim(), updatedAt: new Date().toISOString() };
      dirty = true;
    }
  }
  if (dirty) cpanelDb.write().catch(() => {});
})();

export const getDoKey = (slot) => String(cpanelDb.data.do[String(slot)]?.key || "").trim();
export const configuredDoSlots = () => DO_SLOTS.filter((s) => getDoKey(s));

export async function setDoKey(slot, key, email = "") {
  if (!isDoSlot(slot)) throw new Error("Slot DO harus 1–10.");
  cpanelDb.data.do[String(slot)] = { key: String(key).trim(), email, updatedAt: new Date().toISOString() };
  await cpanelDb.write();
}
export async function removeDoKey(slot) {
  if (!cpanelDb.data.do[String(slot)]) return false;
  delete cpanelDb.data.do[String(slot)];
  await cpanelDb.write();
  return true;
}

// ---------- Klien API ----------
async function call(key, method, path, data) {
  const res = await axios({
    method,
    url: BASE + path,
    data,
    headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json" },
    timeout: 30000,
    validateStatus: () => true,
  });
  if (res.status >= 200 && res.status < 300) return res.data;
  throw new Error(res.data?.message || `HTTP ${res.status}`);
}

/** Panggil API DO memakai API key slot tertentu */
export function doApi(slot, method, path, data) {
  const key = getDoKey(slot);
  if (!key) throw new Error(`API Key DO slot ${slot} belum diatur (/setdo).`);
  return call(key, method, path, data);
}
/** Cek API key mentah (dipakai /setdo sebelum disimpan) */
export const checkDoKey = (key) => call(key, "GET", "/account").then((d) => d.account);

export async function createDroplet(slot, { hostname, spec, os, region, password }) {
  const c = cvpsCfg();
  const body = {
    name: hostname,
    region,
    size: vpsSpecs[spec].size,
    image: vpsImages[os].image,
    backups: false,
    ipv6: true,
    user_data: `#cloud-config\npassword: ${password}\nchpasswd: { expire: False }\nssh_pwauth: True`,
    tags: [c.tag, new Date().toISOString().split("T")[0]],
  };
  const d = await doApi(slot, "POST", "/droplets", body);
  return d.droplet.id;
}
export const getDroplet = (slot, id) => doApi(slot, "GET", `/droplets/${id}`).then((d) => d.droplet);
export const listDroplets = (slot) => doApi(slot, "GET", "/droplets?per_page=200").then((d) => d.droplets || []);
export const deleteDroplet = (slot, id) => doApi(slot, "DELETE", `/droplets/${id}`);
export const rebuildDroplet = (slot, id, image) => doApi(slot, "POST", `/droplets/${id}/actions`, { type: "rebuild", image });

/** Tunggu IP publik muncul (maks. maxMs). Mengembalikan null jika belum muncul. */
export async function waitForIp(slot, id, maxMs = 180000) {
  const end = Date.now() + maxMs;
  while (Date.now() < end) {
    await new Promise((r) => setTimeout(r, 5000));
    const ip = publicIp(await getDroplet(slot, id).catch(() => null));
    if (ip) return ip;
  }
  return null;
}

// ---------- Helper tampilan ----------
export const publicIp = (d) => d?.networks?.v4?.find((n) => n.type === "public")?.ip_address || null;
export const fmtStatus = (s) => (s === "active" ? "🟢 Active" : s === "off" ? "🔴 Off" : `🟡 ${s || "?"}`);
export function fmtAge(createdAt) {
  const hrs = Math.floor((Date.now() - new Date(createdAt)) / 3600000);
  const days = Math.floor(hrs / 24);
  return days > 0 ? `${days}h ${hrs % 24}j` : `${Math.max(hrs, 0)}j`;
}
export const autoHostname = (spec) => (String(spec?.size || "s-1vcpu-1gb").match(/^s-(.+)$/)?.[1] || "1vcpu-1gb").replace(/-amd$/, "");
export const cleanHostname = (s = "") => String(s).toLowerCase().replace(/[^a-z0-9-]/g, "").replace(/^-+|-+$/g, "").slice(0, 32);

/** Tombol pilih akun DO (hanya slot yang sudah punya API key). build(slot) -> callback_data */
export function accountKeyboard(build, extra = []) {
  const btns = configuredDoSlots().map((s) => ({ text: `Digital Ocean ${s}`, icon_custom_emoji_id: "6073395072953485376", emoji_fallback: "☁️", callback_data: build(s) }));
  const rows = [];
  for (let i = 0; i < btns.length; i += 2) rows.push(btns.slice(i, i + 2));
  return [...rows, ...extra];
}

/** Guard untuk callback: hanya pemanggil asli & yang masih berhak. Return true bila boleh lanjut. */
export async function cbGuard(ctx, uid) {
  if (String(ctx.from.id) !== String(uid)) {
    await ctx.answerCbQuery("Ini bukan menu kamu. Ketik perintahnya sendiri.", { show_alert: true });
    return false;
  }
  if (!canUseVps(ctx.from.id)) {
    await ctx.answerCbQuery("Khusus Reseller VPS.", { show_alert: true });
    return false;
  }
  return true;
}

/** Edit pesan callback jadi rich (tombol otomatis berwarna & beranimasi). text = HTML rich */
export const editCb = (ctx, rich, keyboard) => editCbView(ctx, rich, keyboard);

export const DENY_TEXT = note("❌", "Akses ditolak", "Khusus Reseller VPS (atau Owner Bot / Developer / Root / Founder / Owner CPanel).");
export const NO_DO_TEXT = note("⚠️", "API Key DigitalOcean belum ada", "Owner Bot: kirim <code>/setdo 1 &lt;api_key&gt;</code> lewat chat pribadi.");
