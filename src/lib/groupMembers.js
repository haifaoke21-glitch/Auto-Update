// ═══════════════════════════════════════════════════════════════════════
// DAFTAR MEMBER GRUP — dipakai /zombies dan /all (tagall).
//
// Bot API Telegram tidak bisa mengambil daftar member grup, jadi sebelumnya bot hanya mengenal member yang
// pernah chat / join / bereaksi. Di sini daftar lengkap diambil lewat MTProto (GramJS, login sebagai bot),
// sehingga member yang TIDAK PERNAH /start atau chat tetap ikut terdeteksi.
//
// Syarat: config.mtproto.apiId + apiHash terisi (atau env API_ID / API_HASH) dan bot ADMIN di grup.
// Bila tidak terpenuhi (atau di bot clone), otomatis jatuh ke daftar member yang dicatat bot.
// ═══════════════════════════════════════════════════════════════════════
import { getGroup } from "../database.js";
import { mtprotoConfigured, getGroupMembersMT } from "./mtproto.js";
import { isCloneCtx } from "./cloneGuard.js";

/**
 * @returns {{ source: "mtproto"|"tracked", members: Array<{id:string,deleted:boolean,bot:boolean,admin:boolean,accessHash:string|null}>, reason?: string }}
 */
export async function listGroupMembers(ctx) {
  const chatId = ctx.chat.id;
  let reason = null;
  if (isCloneCtx(ctx)) reason = "clone";
  else if (!mtprotoConfigured()) reason = "not_configured";
  else {
    try {
      const members = await getGroupMembersMT(chatId);
      if (members.length) return { source: "mtproto", members };
      reason = "empty";
    } catch (e) {
      reason = `failed: ${e?.errorMessage || e?.message || e}`;
      console.warn("[MEMBERS] MTProto gagal, pakai daftar tercatat:", reason);
    }
  }
  const tracked = Object.keys(getGroup(chatId).members || {});
  return {
    source: "tracked",
    reason,
    members: tracked.map((id) => ({ id: String(id), deleted: false, bot: false, admin: false, accessHash: null })),
  };
}

/** Kalimat penjelasan singkat bila daftar lengkap tidak bisa diambil */
export function fallbackHint(reason) {
  if (reason === "not_configured") return "Isi <code>mtproto.apiId</code> &amp; <code>apiHash</code> di config.js (dari my.telegram.org) agar member yang belum pernah chat/start ikut terdeteksi.";
  if (reason === "clone") return "Bot clone hanya mengenal member yang tercatat. Pakai bot utama untuk pemindaian penuh.";
  if (String(reason || "").startsWith("failed")) return "Gagal mengambil daftar lengkap member. Pastikan bot <b>admin</b> di grup ini.";
  return "";
}
