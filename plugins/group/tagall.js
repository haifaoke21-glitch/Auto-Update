import { getGroup } from "../../src/database.js";
import { say, esc } from "../../src/lib/groupUtil.js";
import { listGroupMembers, fallbackHint } from "../../src/lib/groupMembers.js";
import { sendTagMT, mtprotoConfigured } from "../../src/lib/mtproto.js";
import { isCloneCtx } from "../../src/lib/cloneGuard.js";

// Telegram membatasi 1 pesan maksimal 100 mention (entity), jadi member dipecah 100 per pesan. Mention tak terlihat (zero-width).
const MAX_MENTIONS = 100;
const HIDDEN = (id) => `<a href="tg://user?id=${id}">​</a>`;

export default {
  command: ["all"],
  category: "group",
  description: "Tag semua member (100 per pesan), termasuk yang belum pernah /start atau chat, tanpa menampilkan nama/username (mention tersembunyi). Contoh: /tagall Meeting jam 8",
  adminOnly: true,
  groupOnly: true,
  cooldown: 30000,
  run: async (ctx, { text }) => {
    const id = ctx.chat.id;
    const ids = new Map(); // id -> { id, accessHash }

    // 1) Daftar LENGKAP member (MTProto): termasuk yang belum pernah /start atau chat. Bot & akun terhapus dilewati.
    const list = await listGroupMembers(ctx);
    for (const m of list.members) if (!m.bot && !m.deleted) ids.set(m.id, { id: m.id, accessHash: m.accessHash });

    // 2) Admin grup (selalu tersedia) + member yang tercatat aktif — melengkapi bila daftar lengkap tidak bisa diambil
    const admins = await ctx.telegram.getChatAdministrators(id).catch(() => []);
    for (const a of admins) if (!a.user.is_bot && !ids.has(String(a.user.id))) ids.set(String(a.user.id), { id: String(a.user.id), accessHash: null });
    const seen = Object.entries(getGroup(id).members || {}).sort((a, b) => b[1] - a[1]);
    for (const [uid] of seen) if (!ids.has(uid)) ids.set(uid, { id: uid, accessHash: null });

    const all = [...ids.values()];
    if (!all.length) return say(ctx, "<tg-emoji emoji-id=\"5210952531676504517\">❌</tg-emoji> Belum ada member yang bisa ditandai." + (fallbackHint(list.reason) ? `\n<i>${fallbackHint(list.reason)}</i>` : ""));
    const total = await ctx.telegram.getChatMembersCount(id).catch(() => null);
    const reply = ctx.message.reply_to_message;
    const body = text?.trim() || reply?.text || reply?.caption || "";
    const head = `<tg-emoji emoji-id="5215668805199473901">📢</tg-emoji> <b>Perhatian semua member!</b>` + (body ? `\n\n${esc(body)}` : "");

    // pecah per 100 mention; pesan pertama membawa teks, sisanya hanya penanda
    const chunks = [];
    for (let i = 0; i < all.length; i += MAX_MENTIONS) chunks.push(all.slice(i, i + MAX_MENTIONS));
    const canMT = !isCloneCtx(ctx) && mtprotoConfigured();
    const plainHead = "📢 Perhatian semua member!" + (body ? `\n\n${body}` : "");
    for (let i = 0; i < chunks.length; i++) {
      const label = i === 0 ? head : `<tg-emoji emoji-id="5215668805199473901">📢</tg-emoji> <i>Lanjutan (${i + 1}/${chunks.length})</i>`;
      const foot = i === 0 && chunks.length > 1 ? `\n<i>(${i + 1}/${chunks.length})</i>` : "";
      try {
        await ctx.telegram.sendMessage(id, label + foot + chunks[i].map((m) => HIDDEN(m.id)).join(""), {
          parse_mode: "HTML",
          link_preview_options: { is_disabled: true },
          ...(i === 0 && reply ? { reply_parameters: { message_id: reply.message_id, allow_sending_without_reply: true } } : {}),
        });
      } catch (e) {
        // Bot API kadang menolak mention user yang belum pernah dilihat bot -> kirim lewat MTProto (mention memakai access_hash dari daftar member)
        const withHash = chunks[i].filter((m) => m.accessHash);
        if (canMT && withHash.length) {
          try {
            const head2 = (i === 0 ? plainHead : `📢 Lanjutan (${i + 1}/${chunks.length})`) + (i === 0 && chunks.length > 1 ? `\n(${i + 1}/${chunks.length})` : "");
            await sendTagMT(id, head2, withHash, { replyTo: i === 0 && reply ? reply.message_id : null });
          } catch (e2) {
            return say(ctx, `<tg-emoji emoji-id="5210952531676504517">❌</tg-emoji> Gagal tagall: ${esc(e2?.description || e2?.message || e?.description || e?.message)}`);
          }
        } else {
          return say(ctx, `<tg-emoji emoji-id="5210952531676504517">❌</tg-emoji> Gagal tagall: ${esc(e?.description || e?.message)}`);
        }
      }
      if (i === chunks.length - 1 && total && all.length < total - 1) {
        const hint = list.source === "tracked" ? fallbackHint(list.reason) : "";
        await say(ctx, `<tg-emoji emoji-id="5231012545799666522">ℹ️</tg-emoji> Tertandai <b>${all.length}</b> dari <b>${total}</b> member (bot & akun terhapus tidak ikut ditandai).${hint ? `\n<i>${hint}</i>` : ""}`);
      }
      if (i < chunks.length - 1) await new Promise((r) => setTimeout(r, 1500)); // jeda anti flood
    }
  },
};
