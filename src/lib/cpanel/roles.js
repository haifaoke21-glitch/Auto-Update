// ============================================================
//  Role CPanel (dipindah dari bot CPANEL ke AzmiStecu-MD)
//
//  Hierarki (tinggi -> rendah):
//    Developer > Root > Founder > Owner > CEO > TK > PT > Premium > Reseller > User
//  + ResVPS (role khusus reseller VPS)
//
//  Premium & Reseller punya VERSI per panel (V1..V20):
//    Premium Vn  -> boleh membuat Admin Panel di panel slot n (/cadp, /cadpv2 ...)
//    Reseller Vn -> boleh membuat panel di slot n (/1gb ... /10gb, /unli, /1gbv2 ...)
//
//  Owner bot (config.js -> ownerIds) otomatis punya semua akses.
// ============================================================
import { cpRolesDb } from "../../database.js";
import { isOwner } from "../../middleware.js";

export const MAX_SLOT = 20;
export const SLOTS = Array.from({ length: MAX_SLOT }, (_, i) => String(i + 1));

// Role "datar" (satu daftar saja)
export const FLAT = {
  developer: { label: "Developer", icon: "👨‍💻" },
  root: { label: "Root", icon: "🔱" },
  founder: { label: "Founder", icon: "🏛️" },
  owner: { label: "Owner", icon: "👑" },
  ceo: { label: "CEO", icon: "💼" },
  tk: { label: "TK", icon: "🛡️" },
  pt: { label: "PT", icon: "🤝" },
  resvps: { label: "Reseller VPS", icon: "☁️" },
};

// Urutan untuk menentukan "rank" tertinggi
const RANK_ORDER = ["developer", "root", "founder", "owner", "ceo", "tk", "pt"];

const arr = (obj, key) => (obj[key] ||= []);

export const slotLabel = (slot) => `V${slot}`;

// ---------- Cek role ----------
export function hasFlat(id, role) {
  return (cpRolesDb.data.roles[role] || []).includes(String(id));
}
export function hasPrem(id, slot = "1") {
  return (cpRolesDb.data.prem[String(slot)] || []).includes(String(id));
}
export function hasRes(id, slot = "1") {
  return (cpRolesDb.data.res[String(slot)] || []).includes(String(id));
}
export const premSlots = (id) => SLOTS.filter((s) => hasPrem(id, s));
export const resSlots = (id) => SLOTS.filter((s) => hasRes(id, s));

/** Staff = owner bot, Developer, Root, Founder, atau Owner CPanel: akses penuh ke fitur panel */
export function isStaff(id) {
  return isOwner(id) || ["developer", "root", "founder", "owner"].some((r) => hasFlat(id, r));
}

/** Boleh memakai fitur CVPS (Create VPS DigitalOcean): staff atau Reseller VPS */
export const canUseVps = (id) => isStaff(id) || hasFlat(id, "resvps");

/** Boleh membuat panel (reseller) di slot tertentu */
export const canCreatePanel = (id, slot = "1") => isStaff(id) || hasRes(id, slot);
/** Boleh membuat admin panel (premium) di slot tertentu */
export const canCreateAdmin = (id, slot = "1") => isStaff(id) || hasPrem(id, slot);

/** Rank tertinggi untuk ditampilkan */
export function highestRole(id) {
  if (isOwner(id)) return { key: "botowner", label: "Owner Bot", icon: "👑" };
  for (const r of RANK_ORDER) if (hasFlat(id, r)) return { key: r, ...FLAT[r] };
  if (premSlots(id).length) return { key: "premium", label: "Premium", icon: "💎" };
  if (resSlots(id).length) return { key: "reseller", label: "Reseller", icon: "🛒" };
  if (hasFlat(id, "resvps")) return { key: "resvps", ...FLAT.resvps };
  return { key: "user", label: "User", icon: "👤" };
}

/** Ringkasan semua role milik user (untuk /myrole) */
export function describeRoles(id) {
  const out = [];
  if (isOwner(id)) out.push("👑 Owner Bot (akses penuh)");
  for (const r of Object.keys(FLAT)) if (hasFlat(id, r)) out.push(`${FLAT[r].icon} ${FLAT[r].label}`);
  const p = premSlots(id);
  const r = resSlots(id);
  if (p.length) out.push(`💎 Premium ${p.map(slotLabel).join(", ")}`);
  if (r.length) out.push(`🛒 Reseller ${r.map(slotLabel).join(", ")}`);
  return out;
}

// ---------- Hak memberi role ----------
// super  : hanya owner bot
// staff  : owner bot, Developer, Root, Founder, Owner CPanel
// mgr    : staff + TK + PT
// mgr2   : mgr + Premium (V1)
export function canGrant(id, level) {
  switch (level) {
    case "super": return isOwner(id);
    case "staff": return isStaff(id);
    case "mgr": return isStaff(id) || hasFlat(id, "tk") || hasFlat(id, "pt");
    case "mgr2": return isStaff(id) || hasFlat(id, "tk") || hasFlat(id, "pt") || hasPrem(id, "1");
    default: return false;
  }
}
export const GRANT_TEXT = {
  super: "Khusus Owner Bot.",
  staff: "Khusus Owner Bot / Developer / Root / Founder / Owner CPanel.",
  mgr: "Khusus Owner, TK, atau PT.",
  mgr2: "Khusus Owner, TK, PT, atau Premium.",
};

// ---------- Operasi tulis ----------
function addTo(list, id) {
  if (list.includes(id)) return false;
  list.push(id);
  return true;
}
function delFrom(map, key, id) {
  const cur = map[key] || [];
  if (!cur.includes(id)) return false;
  map[key] = cur.filter((x) => x !== id);
  return true;
}

const addFlat = (role, id) => addTo(arr(cpRolesDb.data.roles, role), id);
const delFlat = (role, id) => delFrom(cpRolesDb.data.roles, role, id);
const addPrem = (slot, id) => addTo(arr(cpRolesDb.data.prem, String(slot)), id);
const delPrem = (slot, id) => delFrom(cpRolesDb.data.prem, String(slot), id);
const addRes = (slot, id) => addTo(arr(cpRolesDb.data.res, String(slot)), id);
const delRes = (slot, id) => delFrom(cpRolesDb.data.res, String(slot), id);

const addAllPrem = (id) => SLOTS.reduce((n, s) => n + (addPrem(s, id) ? 1 : 0), 0);
const delAllPrem = (id) => SLOTS.reduce((n, s) => n + (delPrem(s, id) ? 1 : 0), 0);
const addAllRes = (id) => SLOTS.reduce((n, s) => n + (addRes(s, id) ? 1 : 0), 0);
const delAllRes = (id) => SLOTS.reduce((n, s) => n + (delRes(s, id) ? 1 : 0), 0);

/**
 * Jalankan operasi role.
 * spec: { op: "add"|"del", type: "flat"|"prem"|"res"|"allprem"|"allres"|"all", role?, slot? }
 * return: { changed: number, text: string }  (changed 0 = tidak ada perubahan)
 */
export async function applyRole(spec, rawId) {
  const id = String(rawId);
  let changed = 0;
  const add = spec.op === "add";

  if (spec.type === "flat") {
    changed += (add ? addFlat : delFlat)(spec.role, id) ? 1 : 0;
    // Cascade seperti CPANEL: Owner / TK / PT otomatis dapat Premium & Reseller semua versi
    if (["owner", "tk", "pt"].includes(spec.role)) {
      if (spec.role === "tk") changed += (add ? addFlat : delFlat)("pt", id) ? 1 : 0;
      changed += (add ? addAllPrem : delAllPrem)(id);
      changed += (add ? addAllRes : delAllRes)(id);
    }
  } else if (spec.type === "prem") {
    changed += (add ? addPrem : delPrem)(spec.slot, id) ? 1 : 0;
  } else if (spec.type === "res") {
    changed += (add ? addRes : delRes)(spec.slot, id) ? 1 : 0;
  } else if (spec.type === "allprem") {
    changed += (add ? addAllPrem : delAllPrem)(id);
  } else if (spec.type === "allres") {
    changed += (add ? addAllRes : delAllRes)(id);
  } else if (spec.type === "all") {
    for (const r of ["owner", "ceo", "tk", "pt"]) changed += (add ? addFlat : delFlat)(r, id) ? 1 : 0;
    changed += (add ? addAllPrem : delAllPrem)(id);
    changed += (add ? addAllRes : delAllRes)(id);
  }

  if (add) {
    if (changed) recordLast(id, spec);
  } else if (changed) {
    pruneLast(id);
  }

  if (changed) await cpRolesDb.write();
  return { changed };
}


// ---------- Role terakhir yang di-add (untuk tampilan info /cpanel) ----------
// Info hanya menampilkan 1 role: yang TERAKHIR di-add (kalau dicabut, jatuh ke role yang di-add sebelumnya) (root lalu founder -> Founder), plus di server mana
// role itu diberikan: "Server 1" / "Server 1, 2" / "All Server". Role datar (Root, Founder, dst) berlaku global
// jadi selalu "All Server". Premium/Reseller bisa per versi (V1..V20) = per server.
const lastMap = () => (cpRolesDb.data.last ||= {});

/** Rapikan daftar server: "all" tetap "all", selain itu urut angka tanpa duplikat */
const mergeServers = (a, b) => {
  if (a === "all" || b === "all") return "all";
  return [...new Set([...(a || []), ...(b || [])])].sort((x, y) => Number(x) - Number(y));
};

/** Teks server untuk tampilan: "All Server" atau "Server 1, 2" */
export const fmtServers = (servers) => (servers === "all" ? "All Server" : `Server ${(servers || []).join(", ")}`);

/** spec applyRole -> { key, label, icon, servers } (null kalau tidak dikenal) */
function lastFromSpec(spec) {
  switch (spec.type) {
    case "flat": return FLAT[spec.role] ? { key: `flat:${spec.role}`, label: FLAT[spec.role].label, icon: FLAT[spec.role].icon, servers: "all" } : null;
    case "prem": return { key: "prem", label: "Premium", icon: "💎", servers: [String(spec.slot)] };
    case "res": return { key: "res", label: "Reseller", icon: "🛒", servers: [String(spec.slot)] };
    case "allprem": return { key: "prem", label: "Premium", icon: "💎", servers: "all" };
    case "allres": return { key: "res", label: "Reseller", icon: "🛒", servers: "all" };
    case "all": return { key: "all", label: "Semua Akses", icon: "🌟", servers: "all" };
    default: return null;
  }
}

const MAX_HISTORY = 10;

/** Catat role yang baru saja di-add (paling baru di depan). Role sejenis yang barusan di-add digabung (Premium V1 lalu V2); role lain menggantikan di posisi teratas. */
function recordLast(id, spec) {
  const next = lastFromSpec(spec);
  if (!next) return;
  const hist = lastMap()[id] || [];
  if (hist[0] && hist[0].key === next.key) next.servers = mergeServers(hist[0].servers, next.servers);
  lastMap()[id] = [{ ...next, at: Date.now() }, ...hist.filter((r) => r.key !== next.key)].slice(0, MAX_HISTORY);
}

/** Satu catatan -> catatan yang masih berlaku (server disesuaikan dengan slot yang benar-benar dimiliki) atau null */
function validate(sid, rec) {
  if (rec.key.startsWith("flat:")) return hasFlat(sid, rec.key.slice(5)) ? rec : null;
  if (rec.key === "prem" || rec.key === "res") {
    const held = rec.key === "prem" ? premSlots(sid) : resSlots(sid);
    if (!held.length) return null;
    const servers = rec.servers === "all" ? (held.length === SLOTS.length ? "all" : held) : rec.servers.filter((x) => held.includes(x));
    return servers === "all" || servers.length ? { ...rec, servers } : null;
  }
  if (rec.key === "all") return ["owner", "ceo", "tk", "pt"].some((r) => hasFlat(sid, r)) ? rec : null;
  return null;
}

/** Riwayat role yang masih berlaku, terbaru di depan */
const liveHistory = (id) => {
  const sid = String(id);
  const hist = lastMap()[sid];
  return Array.isArray(hist) ? hist.map((r) => validate(sid, r)).filter(Boolean) : [];
};

/** Setelah role dicabut: buang catatan yang sudah tidak berlaku. Yang tampil = role terbaru yang masih dimiliki. */
function pruneLast(id) {
  const sid = String(id);
  if (!lastMap()[sid]) return;
  const live = liveHistory(sid);
  if (live.length) lastMap()[sid] = live;
  else delete lastMap()[sid];
}

/**
 * Role yang ditampilkan di info: { icon, label, server } atau null kalau tidak punya role.
 * Utama: role terakhir yang di-add. Kalau belum ada catatan (role lama sebelum fitur ini), dipakai role tertinggi.
 */
export function currentRoleInfo(id) {
  const rec = liveHistory(id)[0];
  if (rec) return { icon: rec.icon, label: rec.label, server: fmtServers(rec.servers) };
  if (isOwner(id)) return { icon: "👑", label: "Owner Bot", server: "All Server" };
  const top = highestRole(id);
  if (top.key === "user") return null;
  if (top.key === "premium") {
    const s = premSlots(id);
    return { icon: top.icon, label: top.label, server: fmtServers(s.length === SLOTS.length ? "all" : s) };
  }
  if (top.key === "reseller") {
    const s = resSlots(id);
    return { icon: top.icon, label: top.label, server: fmtServers(s.length === SLOTS.length ? "all" : s) };
  }
  return { icon: top.icon, label: top.label, server: "All Server" };
}

// ---------- Helper /delrole (tombol cabut role) ----------
// key tombol: "f-<role>" (role datar), "p-<slot>" (Premium Vn), "r-<slot>" (Reseller Vn)
const FLAT_GRANT = { developer: "super", root: "super", founder: "super", owner: "super", ceo: "staff", tk: "staff", pt: "staff", resvps: "staff" };

/** Level hak yang dibutuhkan untuk mencabut role dengan key tertentu */
export function grantForKey(key) {
  const [t, v] = String(key).split("-");
  if (t === "f") return FLAT_GRANT[v] || "super";
  if (t === "p") return "mgr";
  if (t === "r") return "mgr2";
  return "super";
}

/** Semua role CPanel/CVPS yang dimiliki user: [{ key, label, grant }] */
export function rolesOf(id) {
  const out = [];
  for (const r of Object.keys(FLAT)) {
    if (hasFlat(id, r)) out.push({ key: `f-${r}`, label: `${FLAT[r].icon} ${FLAT[r].label}`, grant: FLAT_GRANT[r] });
  }
  for (const s of premSlots(id)) out.push({ key: `p-${s}`, label: `💎 Premium ${slotLabel(s)}`, grant: "mgr" });
  for (const s of resSlots(id)) out.push({ key: `r-${s}`, label: `🛒 Reseller ${slotLabel(s)}`, grant: "mgr2" });
  return out;
}

/** Role milik target yang BOLEH dicabut oleh pemanggil */
export const revocableRoles = (callerId, targetId) => rolesOf(targetId).filter((r) => canGrant(callerId, r.grant));

/** Cabut satu role berdasarkan key tombol. return { changed } */
export async function revokeByKey(key, targetId) {
  const [t, v] = String(key).split("-");
  if (t === "f" && FLAT[v]) return applyRole({ op: "del", type: "flat", role: v }, targetId);
  if (t === "p" && SLOTS.includes(v)) return applyRole({ op: "del", type: "prem", slot: v }, targetId);
  if (t === "r" && SLOTS.includes(v)) return applyRole({ op: "del", type: "res", slot: v }, targetId);
  return { changed: 0 };
}

/** Daftar pemegang tiap role (untuk /listrole) */
export function roleHolders() {
  const rows = [];
  for (const r of Object.keys(FLAT)) rows.push({ label: `${FLAT[r].icon} ${FLAT[r].label}`, ids: cpRolesDb.data.roles[r] || [] });
  const uniq = (key) => [...new Set(SLOTS.flatMap((s) => cpRolesDb.data[key][s] || []))];
  rows.push({ label: "💎 Premium (semua versi)", ids: uniq("prem") });
  rows.push({ label: "🛒 Reseller (semua versi)", ids: uniq("res") });
  return rows;
}
