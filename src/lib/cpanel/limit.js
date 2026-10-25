// Limit request pembuatan panel per role (dipindah dari CPANEL: src/limit.js)
import { cpanelDb } from "../../database.js";
import { isOwner } from "../../middleware.js";
import { hasFlat, hasPrem, hasRes, premSlots, resSlots } from "./roles.js";

export const ROLE_ORDER = ["member", "reseller", "premium", "pt", "tk", "ceo", "founder"];
export const DEFAULT_LIMITS = { member: 5, reseller: 5, premium: 10, pt: 15, tk: 20, ceo: 25, founder: -1 };

const isUnlimitedValue = (v) => v === null || v === -1 || v === "unlimited" || v === Infinity;

/** Role untuk keperluan limit. "owner" = tidak terkena limit */
export function limitRole(id) {
  if (isOwner(id) || hasFlat(id, "developer") || hasFlat(id, "root") || hasFlat(id, "owner")) return "owner";
  if (hasFlat(id, "founder")) return "founder";
  if (hasFlat(id, "ceo")) return "ceo";
  if (hasFlat(id, "tk")) return "tk";
  if (hasFlat(id, "pt")) return "pt";
  if (premSlots(id).length) return "premium";
  if (resSlots(id).length) return "reseller";
  return "member";
}

export function getRoleLimit(role) {
  const v = cpanelDb.data.limits[role];
  return v === undefined ? DEFAULT_LIMITS[role] ?? 5 : v;
}

/** Cek tanpa memotong kuota */
export function checkLimit(id) {
  const role = limitRole(id);
  if (role === "owner") return { allowed: true, role, limit: null, remaining: null, used: 0 };
  const limit = getRoleLimit(role);
  const used = cpanelDb.data.usage[String(id)]?.count || 0;
  if (isUnlimitedValue(limit)) return { allowed: true, role, limit: null, remaining: null, used };
  const remaining = limit - used;
  return { allowed: remaining > 0, role, limit, used, remaining: Math.max(remaining, 0) };
}

/** Panggil SETELAH panel berhasil dibuat */
export async function consumeLimit(id) {
  const role = limitRole(id);
  if (role === "owner" || isUnlimitedValue(getRoleLimit(role))) return;
  const key = String(id);
  cpanelDb.data.usage[key] ||= { count: 0 };
  cpanelDb.data.usage[key].count += 1;
  await cpanelDb.write();
}

export async function setRoleLimit(role, value) {
  if (!ROLE_ORDER.includes(role)) return false;
  cpanelDb.data.limits[role] = value === "unlimited" ? null : Number(value);
  await cpanelDb.write();
  return true;
}

export async function resetAllLimits() {
  cpanelDb.data.limits = {};
  cpanelDb.data.usage = {};
  await cpanelDb.write();
}

export async function resetUserUsage(id) {
  delete cpanelDb.data.usage[String(id)];
  await cpanelDb.write();
}

export const fmtLimit = (v) => (isUnlimitedValue(v) ? "∞ Unlimited" : `${v}x`);
