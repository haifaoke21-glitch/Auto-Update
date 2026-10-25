import { usersDb, getGroup, saveGroup } from "../database.js";
import { isOwner } from "../middleware.js";
import { replyView, note, quote } from "./richUi.js";
import { E } from "./emo.js";

// Helper bersama untuk semua plugin kategori group (moderasi, toggle, sapaan).

/** Buang surrogate yatim (hasil memotong emoji di tengah) + karakter kontrol; Telegram menolak teks seperti ini ("must be encoded in UTF-8") */
export const wf = (s = "") =>
  String(s).replace(/[\uD800-\uDBFF](?![\uDC00-\uDFFF])|(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]/g, "").replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F]/g, "");
/** Potong teks maksimal n karakter (per code point, emoji tidak terbelah) */
export const cut = (s = "", n = 32) => {
  const a = Array.from(wf(s));
  return a.length > n ? a.slice(0, n).join("") : a.join("");
};
export const esc = (s = "") => wf(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
export const mention = (id, name) => `<a href="tg://user?id=${id}">${esc(name || "User")}</a>`;
export const fullName = (u) => [u?.first_name, u?.last_name].filter(Boolean).join(" ") || u?.title || "User";

/** Izin kosong untuk mute (dipakai /mute dan tombol Mute di kartu warn) */
export const MUTE_PERMS = {
  can_send_messages: false, can_send_audios: false, can_send_documents: false, can_send_photos: false,
  can_send_videos: false, can_send_video_notes: false, can_send_voice_notes: false, can_send_polls: false,
  can_send_other_messages: false, can_add_web_page_previews: false,
};

const errText = (err) => String(err?.description || err?.message || err).replace(/^\d+:\s*/, "").replace(/^Bad Request:\s*/i, "");

/** Balas (reply ke pesan pemanggil) dengan HTML; tidak pernah melempar error */
export function say(ctx, html, extra = {}) {
  return ctx.reply(html, {
    parse_mode: "HTML",
    link_preview_options: { is_disabled: true },
    reply_parameters: { message_id: ctx.message?.message_id, allow_sending_without_reply: true },
    ...extra,
  }).catch((e) => console.warn("[GROUP] reply gagal:", errText(e)));
}

/** Balas dengan Rich Message (cadangan HTML otomatis); tidak pernah melempar error */
export const richSay = (ctx, rich, rows) => replyView(ctx, rich, rows).catch((e) => console.warn("[GROUP] rich gagal:", errText(e)));

/** Kartu singkat (kutipan): ikon + judul tebal + isi. Contoh: card(ctx, E.ok, "Berhasil", "Isi pesan") */
export const card = (ctx, icon, titleHtml, body = "") => richSay(ctx, note(icon, titleHtml, body));

/** Terjemahkan error Telegram yang umum jadi pesan yang mudah dimengerti */
export function friendlyError(err, action = "menjalankan perintah") {
  const t = errText(err).toLowerCase();
  if (t.includes("not enough rights") || t.includes("rights to") || t.includes("need to be admin") || t.includes("administrator rights"))
    return `Gagal ${action}: bot belum punya izin yang cukup. Jadikan bot admin dan aktifkan izin yang dibutuhkan.`;
  if (t.includes("can't remove chat owner") || t.includes("owner")) return `Gagal ${action}: target adalah pemilik grup.`;
  if (t.includes("user is an administrator")) return `Gagal ${action}: target adalah admin grup.`;
  if (t.includes("user not found") || t.includes("participant_id_invalid") || t.includes("member not found"))
    return `Gagal ${action}: pengguna tidak ditemukan.`;
  if (t.includes("chat_admin_required")) return `Gagal ${action}: bot harus jadi admin grup.`;
  return `Gagal ${action}: ${errText(err)}`;
}

const _me = new WeakMap(); // cache per instance bot (bot utama & clone beda identitas)
export async function botInfo(ctx) {
  if (!_me.has(ctx.telegram)) _me.set(ctx.telegram, await ctx.telegram.getMe());
  return _me.get(ctx.telegram);
}

/** Data member bot di grup ini (status + izin), null jika gagal */
export async function botMember(ctx) {
  try {
    const me = await botInfo(ctx);
    return await ctx.telegram.getChatMember(ctx.chat.id, me.id);
  } catch {
    return null;
  }
}

/**
 * Pastikan bot admin dengan izin tertentu (mis. "can_restrict_members").
 * Membalas pesan penjelasan & mengembalikan false jika belum cukup.
 */
export async function requireBotRight(ctx, right, label) {
  const m = await botMember(ctx);
  if (!m || !["administrator", "creator"].includes(m.status)) {
    await card(ctx, E.warn, "Bot belum jadi admin", "Jadikan bot sebagai <b>admin grup</b> dulu supaya fitur ini bisa jalan.");
    return false;
  }
  if (m.status === "administrator" && right && m[right] === false) {
    await card(ctx, E.warn, "Izin bot belum cukup", `Bot belum punya izin <b>${esc(label || right)}</b>. Aktifkan di pengaturan admin bot.`);
    return false;
  }
  return true;
}

/** Cari id user dari @username lewat database user bot */
function idByUsername(username) {
  const u = username.replace(/^@/, "").toLowerCase();
  for (const [id, data] of Object.entries(usersDb.data.users || {})) {
    if ((data.username || "").toLowerCase() === u) return id;
  }
  return null;
}

/**
 * Tentukan target perintah moderasi. Urutan: balas pesan -> text_mention -> @username -> ID angka.
 * Mengembalikan { id, name, status, rest } atau null (sudah membalas pesan bantuan).
 * rest = argumen sisa setelah target (durasi / alasan).
 * opts.usage: contoh pemakaian untuk pesan bantuan. opts.allowOutside: boleh target yang tidak ada di grup (ban).
 */
export async function resolveTarget(ctx, args, opts = {}) {
  const msg = ctx.message;
  const reply = msg.reply_to_message;
  let id = null;
  let name = null;
  let rest = [...args];

  if (reply?.from && !reply.forum_topic_created) {
    id = reply.from.id;
    name = fullName(reply.from);
  } else {
    const ent = (msg.entities || []).find((e) => e.type === "text_mention" && e.user);
    if (ent) {
      id = ent.user.id;
      name = fullName(ent.user);
      rest = args.slice(1);
    } else if (args[0]) {
      const a = args[0];
      if (/^@\w{4,}$/.test(a)) id = idByUsername(a);
      else if (/^\d{5,}$/.test(a)) id = Number(a);
      if (id) rest = args.slice(1);
      else if (/^@/.test(a)) {
        await card(ctx, E.no, "Pengguna belum dikenal", `<code>${esc(a)}</code> belum dikenal bot. Balas pesannya langsung, atau pakai ID angka.`);
        return null;
      }
    }
  }

  if (!id) {
    await richSay(ctx, note(E.info, "Pilih target dulu", "Balas pesan target, atau sebutkan @username / ID.") + quote(`Contoh: <code>${esc(opts.usage || "/perintah @username")}</code>`));
    return null;
  }

  let status = null;
  try {
    const m = await ctx.telegram.getChatMember(ctx.chat.id, id);
    status = m.status;
    name ||= fullName(m.user);
    if (m.user?.is_bot && m.user.id === (await botInfo(ctx)).id) status = "self-bot";
  } catch {
    /* tidak ditemukan di grup */
  }
  if (!status && !opts.allowOutside) {
    await card(ctx, E.no, "Pengguna tidak ditemukan", "Pengguna itu tidak ada di grup ini.");
    return null;
  }
  name ||= usersDb.data.users?.[String(id)]?.name || String(id);
  return { id, name, status, rest };
}

/** Tolak target yang tidak boleh dikenai aksi (bot sendiri, diri sendiri, owner bot, admin grup) */
export async function guardTarget(ctx, t, action, { allowAdmin = false } = {}) {
  let why = null;
  if (t.status === "self-bot") why = `Aku tidak bisa ${action} diriku sendiri ${E.laugh}`;
  else if (t.id === ctx.from.id) why = `Kamu tidak bisa ${action} diri sendiri.`;
  else if (isOwner(t.id)) why = `Tidak bisa ${action} owner bot.`;
  else if (!allowAdmin && ["creator", "administrator"].includes(t.status))
    why = `Tidak bisa ${action} ${t.status === "creator" ? "pemilik grup" : "admin grup"}. Demote dulu kalau memang perlu.`;
  if (why) {
    await card(ctx, E.deny, "Tidak bisa dilakukan", why);
    return false;
  }
  return true;
}

/** "10m", "2h", "1d", "1w", "45" (menit) -> detik. null jika bukan durasi. */
export function parseDuration(str) {
  const m = /^(\d+)\s*(s|m|h|d|w)?$/i.exec(String(str || "").trim());
  if (!m) return null;
  const n = Number(m[1]);
  const mult = { s: 1, m: 60, h: 3600, d: 86400, w: 604800 }[(m[2] || "m").toLowerCase()];
  return n * mult;
}

export function fmtDuration(sec) {
  const parts = [];
  for (const [label, size] of [["hari", 86400], ["jam", 3600], ["menit", 60], ["detik", 1]]) {
    const v = Math.floor(sec / size);
    if (v) { parts.push(`${v} ${label}`); sec -= v * size; }
    if (parts.length === 2) break;
  }
  return parts.join(" ") || "0 detik";
}

/** Alasan sebagai kutipan Rich Message (kosong kalau tidak ada alasan) */
export const reasonQuote = (words) => (words.length ? quote(`${E.note} <b>Alasan</b>`, esc(words.join(" "))) : "");

export const reasonLine = (words) => (words.length ? `\n${E.note} Alasan: ${esc(words.join(" "))}` : "");

/** Isi template sapaan: {name} {mention} {group} {count} {id} */
export function renderGreeting(tpl, vars) {
  return esc(tpl).replace(/\{(name|mention|group|count|id)\}/gi, (_, k) => {
    k = k.toLowerCase();
    return k === "mention" ? mention(vars.id, vars.name) : esc(String(vars[k] ?? ""));
  });
}

/**
 * Pabrik plugin toggle on/off sederhana (antilink, antipromosi, antiforward).
 * needs: izin bot yang dibutuhkan saat diaktifkan (mis. "can_delete_messages").
 */
export function toggleCommand({ command, key, title, description, onNote, needs, needsLabel }) {
  return {
    command,
    category: "group",
    description: `${description} Contoh: /${command[0]} on | off | status`,
    adminOnly: true,
    groupOnly: true,
    run: async (ctx, { args }) => {
      const mode = args[0]?.toLowerCase();
      const now = getGroup(ctx.chat.id)[key];
      const cmd = command[0];
      if (!["on", "off"].includes(mode)) {
        return richSay(
          ctx,
          note(E.gear, esc(title), `Status: <b>${now ? "AKTIF" : "nonaktif"}</b> ${now ? E.ok : E.no}`) +
            quote(`Nyalakan: <code>/${cmd} on</code>`, `Matikan: <code>/${cmd} off</code>`)
        );
      }
      const on = mode === "on";
      await saveGroup(ctx.chat.id, { [key]: on });
      await richSay(ctx, note(E.ok, `${esc(title)} ${on ? "diaktifkan" : "dinonaktifkan"}`) + (on && onNote ? quote(onNote) : ""));
      if (on && needs) await requireBotRight(ctx, needs, needsLabel);
    },
  };
}
