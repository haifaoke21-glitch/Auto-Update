import crypto from "crypto";
import config from "../../../config.js";
import { usersDb } from "../../database.js";
import { note } from "../richUi.js";

export const h = (s = "") => String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

/** Pengaturan CPanel dari config.js (dengan nilai bawaan) */
export function cfg() {
  const c = config.cpanel || {};
  return {
    groupOnly: c.groupOnly !== false, // pembuatan panel oleh non-owner hanya di grup (data login dikirim lewat DM)
    loc: parseInt(c.loc ?? 1),
    eggNode: parseInt(c.eggNode ?? 15),
    eggPython: parseInt(c.eggPython ?? 16),
    dockerNode: c.dockerNode || "ghcr.io/parkervcp/yolks:nodejs_20",
    dockerPython: c.dockerPython || "ghcr.io/parkervcp/yolks:python_3.11",
    emailDomain: c.emailDomain || "cpanel.net",
    notifChannelId: c.notifChannelId || "",
    panels: c.panels || {},
    rules: Array.isArray(c.rules) && c.rules.length ? c.rules : ["Jangan DDoS", "Jangan sebar domain", "Simpan data panel anda"],
  };
}

/** Nama command yang sedang dijalankan (tanpa prefix & @bot) */
export function cmdName(ctx) {
  const t = ctx.message?.text || ctx.message?.caption || "";
  const prefixes = [config.prefix, ...(config.altPrefixes || [])].filter(Boolean);
  let body = t;
  for (const p of prefixes) {
    if (t.startsWith(p)) { body = t.slice(p.length); break; }
  }
  return body.trim().split(/\s+/)[0].split("@")[0].toLowerCase();
}

export const fullName = (u = {}) => [u.first_name, u.last_name].filter(Boolean).join(" ") || u.username || String(u.id || "-");

/**
 * Tentukan user target: balasan pesan > ID angka > @username (yang pernah memakai bot).
 * Mengembalikan { id, name } atau null.
 */
export function resolveTarget(ctx, args = []) {
  const rep = ctx.message?.reply_to_message?.from;
  if (rep && !rep.is_bot) return { id: String(rep.id), name: fullName(rep), fromReply: true };
  const a = String(args[0] || "").trim();
  if (/^\d{5,15}$/.test(a)) {
    const u = usersDb.data.users?.[a];
    return { id: a, name: u?.name || a };
  }
  if (/^@?[A-Za-z0-9_]{3,32}$/.test(a) && a.startsWith("@")) {
    const uname = a.slice(1).toLowerCase();
    const found = Object.values(usersDb.data.users || {}).find((u) => (u.username || "").toLowerCase() === uname);
    if (found) return { id: String(found.id), name: found.name || a };
  }
  return null;
}

/** Password acak aman (huruf besar/kecil + angka) */
export function genPassword(len = 10) {
  const chars = "ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz23456789";
  return Array.from({ length: len }, () => chars[crypto.randomInt(chars.length)]).join("");
}

export const inGroup = (ctx) => ctx.chat?.type === "group" || ctx.chat?.type === "supergroup";

export const reply = (ctx, text, extra = {}) =>
  ctx.reply(text, {
    parse_mode: "HTML",
    disable_web_page_preview: true,
    reply_parameters: ctx.message?.message_id ? { message_id: ctx.message.message_id, allow_sending_without_reply: true } : undefined,
    ...extra,
  });

/** Kartu penolakan akses staff CPanel (rich) — pakai: replyView(ctx, STAFF_DENY) */
export const STAFF_DENY = note("❌", "Akses ditolak", "Khusus Owner Bot / Developer / Root / Founder / Owner CPanel.");
