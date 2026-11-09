import { resolveTarget, requireBotRight, say, esc, mention, friendlyError } from "../../src/lib/groupUtil.js";

// /settag — beri / ubah / hapus TAG anggota grup (label kecil di samping nama, Bot API 9.5+).
//   Balas pesan member : /settag Bendahara
//   Pakai username/ID  : /settag @username Bendahara
//   Hapus tag          : /settag hapus   (balas pesan)  atau  /settag @username hapus
// Aturan Telegram: tag 1–16 karakter, TANPA emoji, hanya untuk member biasa (bukan admin/pemilik grup).
// Bot harus admin dengan izin "Kelola tag" (can_manage_tags).

const MAX_TAG = 16;
const HAS_EMOJI = /\p{Extended_Pictographic}|\p{Regional_Indicator}|[⃣️‍]/u;
const RESET_WORDS = new Set(["hapus", "reset", "off", "delete", "del", "-"]);

export default {
  command: ["settag"],
  category: "group",
  description: "Beri/ubah/hapus tag member grup (maks 16 huruf, tanpa emoji). Balas pesan atau pakai @username. Contoh: /settag @user Bendahara · /settag hapus",
  adminOnly: true,
  groupOnly: true,
  run: async (ctx, { args }) => {
    if (!(await requireBotRight(ctx, "can_manage_tags", "Kelola tag"))) return;

    const t = await resolveTarget(ctx, args, { usage: "/settag @username Bendahara" });
    if (!t) return;

    const rawTag = t.rest.join(" ").trim();
    if (!rawTag) {
      return say(ctx, `<tg-emoji emoji-id="5231012545799666522">ℹ️</tg-emoji> Tulis tag-nya.\nContoh: <code>/settag @username Bendahara</code> atau balas pesan lalu <code>/settag Bendahara</code>.\nHapus tag: <code>/settag hapus</code>`);
    }

    const remove = RESET_WORDS.has(rawTag.toLowerCase());
    const tag = remove ? "" : rawTag;

    if (!remove) {
      if ([...tag].length > MAX_TAG) return say(ctx, `<tg-emoji emoji-id="5210952531676504517">❌</tg-emoji> Tag terlalu panjang (${[...tag].length} karakter). Maksimal ${MAX_TAG}.`);
      if (HAS_EMOJI.test(tag)) return say(ctx, `<tg-emoji emoji-id="5210952531676504517">❌</tg-emoji> Tag tidak boleh berisi emoji.`);
    }

    if (t.status === "self-bot") return say(ctx, "<tg-emoji emoji-id=\"5240241223632954241\">🚫</tg-emoji> Aku tidak bisa memberi tag untuk diriku sendiri <tg-emoji emoji-id=\"6093522689861882360\">😅</tg-emoji>");
    if (["creator", "administrator"].includes(t.status)) {
      return say(ctx, "<tg-emoji emoji-id=\"5240241223632954241\">🚫</tg-emoji> Tag hanya bisa diberikan ke member biasa, bukan admin atau pemilik grup.");
    }

    try {
      // Telegraf 4.16 belum punya method ini -> panggil langsung lewat callApi
      await ctx.telegram.callApi("setChatMemberTag", { chat_id: ctx.chat.id, user_id: t.id, tag });
      await say(
        ctx,
        remove
          ? `<tg-emoji emoji-id="6120946172010959542">✅</tg-emoji> Tag ${mention(t.id, t.name)} berhasil <b>dihapus</b>.`
          : `<tg-emoji emoji-id="6120946172010959542">✅</tg-emoji> Tag ${mention(t.id, t.name)} diatur menjadi <b>${esc(tag)}</b>.`
      );
    } catch (err) {
      const msg = String(err?.description || err?.message || "");
      if (/method.*not found|unknown method/i.test(msg)) {
        return say(ctx, "<tg-emoji emoji-id=\"5210952531676504517\">❌</tg-emoji> Server Bot API ini belum mendukung tag member (butuh Bot API 9.5+).");
      }
      await say(ctx, `<tg-emoji emoji-id="5210952531676504517">❌</tg-emoji> ${friendlyError(err, "mengatur tag")}`);
    }
  },
};
