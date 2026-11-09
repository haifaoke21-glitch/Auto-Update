// ═══════════════════════════════════════════════════════════════════════
// DAFTAR MEMBER GRUP — dipakai /zombies dan /all (tagall).
//
// Fitur grup yang butuh daftar member LENGKAP hanya memakai GramJS (MTProto).
// Bot API Telegram tidak bisa mengambil daftar member, jadi tidak ada fallback
// ke member yang tercatat.
//
// Syarat: config.mtproto.apiId + apiHash terisi (atau env API_ID / API_HASH)
// dan bot ADMIN di grup.
// ═══════════════════════════════════════════════════════════════════════
import { mtprotoConfigured, getGroupMembersMT } from "./mtproto.js";
import { isCloneCtx } from "./cloneGuard.js";

/**
 * @returns {{ source: "gramjs"|"unavailable", members: Array<{id:string,deleted:boolean,bot:boolean,admin:boolean,accessHash:string|null,name?:string}>, reason?: string }}
 */
export async function listGroupMembers(ctx) {
  const chatId = ctx.chat.id;
  if (isCloneCtx(ctx)) {
    return { source: "unavailable", reason: "clone", members: [] };
  }
  if (!mtprotoConfigured()) {
    return { source: "unavailable", reason: "not_configured", members: [] };
  }
  try {
    const members = await getGroupMembersMT(chatId);
    if (members.length) return { source: "gramjs", members };
    return { source: "unavailable", reason: "empty", members: [] };
  } catch (e) {
    const reason = `failed: ${e?.errorMessage || e?.message || e}`;
    console.warn("[MEMBERS] GramJS gagal mengambil daftar member:", reason);
    return { source: "unavailable", reason, members: [] };
  }
}

/** Kalimat penjelasan singkat bila daftar lengkap tidak bisa diambil */
export function fallbackHint(reason) {
  if (reason === "not_configured") return "Isi <code>mtproto.apiId</code> & <code>apiHash</code> di config.js (dari my.telegram.org) agar fitur grup bisa mengambil daftar member lengkap lewat GramJS.";
  if (reason === "clone") return "Bot clone tidak mendukung daftar member lengkap. Pakai bot utama.";
  if (reason === "empty") return "Daftar member kosong. Pastikan bot <b>admin</b> di grup ini.";
  if (String(reason || "").startsWith("failed")) return "Gagal mengambil daftar member lewat GramJS. Pastikan bot <b>admin</b> di grup ini dan apiId/apiHash benar.";
  return "Tidak bisa mengambil daftar member lewat GramJS.";
}
