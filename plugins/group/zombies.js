import { getGroup, groupsDb } from "../../src/database.js";
import { requireBotRight, say, esc, mention, friendlyError } from "../../src/lib/groupUtil.js";
import { listGroupMembers, fallbackHint } from "../../src/lib/groupMembers.js";

// Telegram Bot API tidak punya fungsi "daftar semua member". Jadi pemindaian dilakukan terhadap member
// yang sudah tercatat bot (lihat memberTracker.js: pengirim pesan, member join, reaksi). Makin lama bot
// aktif di grup, makin lengkap hasil scan-nya.
//
// Yang bisa dideteksi: akun yang dihapus (Telegram menandainya dengan nama "Deleted Account").
// Akun yang dibekukan/freeze oleh Telegram TIDAK ditandai apa pun di Bot API, jadi tidak bisa dibedakan
// dari akun biasa. Yang bisa dijangkau hanyalah akun yang tidak bisa diambil datanya lagi (dianggap zombie).

const DELAY_MS = 120; // jeda antar pengecekan supaya tidak kena flood limit
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const running = new Set(); // cegah scan/kick ganda di grup yang sama

const isDeleted = (u) => !!u && (u.first_name === "Deleted Account" || u.first_name === "Akun Terhapus");

async function scan(ctx) {
  const chatId = ctx.chat.id;
  const g = getGroup(chatId);
  g.members ||= {};
  const ids = Object.keys(g.members);
  const zombies = [];
  let checked = 0;
  let gone = 0;

  for (const id of ids) {
    try {
      const m = await ctx.telegram.getChatMember(chatId, Number(id));
      checked++;
      if (["left", "kicked"].includes(m.status)) {
        delete g.members[id]; // sudah tidak di grup, bersihkan dari catatan
        gone++;
      } else if (isDeleted(m.user) && !["creator", "administrator"].includes(m.status)) {
        zombies.push({ id: Number(id), status: m.status });
      }
    } catch (e) {
      const t = String(e?.description || e?.message || "").toLowerCase();
      if (t.includes("user not found") || t.includes("participant_id_invalid")) {
        // akun sudah tidak ada sama sekali di sisi Telegram -> zombie
        zombies.push({ id: Number(id), status: "unknown" });
      } else if (t.includes("too many requests")) {
        const wait = (e?.parameters?.retry_after || 5) * 1000;
        await sleep(wait);
      }
    }
    await sleep(DELAY_MS);
  }
  if (gone) groupsDb.write().catch(() => {});
  return { zombies, checked, total: ids.length, gone };
}

export default {
  command: ["zombies"],
  category: "group",
  description: "Deteksi otomatis akun terhapus di grup (termasuk yang belum pernah /start atau chat), hitung, lalu langsung dikeluarkan. Cukup ketik /zombies",
  adminOnly: true,
  groupOnly: true,
  cooldown: 15000,
  run: async (ctx) => {
    const chatId = ctx.chat.id;
    if (!(await requireBotRight(ctx, "can_restrict_members", "Blokir pengguna"))) return;
    if (running.has(chatId)) return say(ctx, "<tg-emoji emoji-id=\"5454415424319931791\">⏳</tg-emoji> Proses zombies untuk grup ini masih berjalan, tunggu sampai selesai.");

    running.add(chatId);
    try {
      // 1) Daftar LENGKAP member lewat MTProto (termasuk yang belum pernah /start atau chat).
      //    Akun terhapus langsung ketahuan dari daftar itu, tanpa pemindaian satu-satu.
      await say(ctx, "<tg-emoji emoji-id=\"5231012545799666522\">🔎</tg-emoji> Mengambil daftar member grup…");
      const list = await listGroupMembers(ctx);
      let zombies = [];
      let checked = list.members.length;
      let total = list.members.length;
      let gone = 0;

      if (list.source === "mtproto") {
        zombies = list.members.filter((m) => m.deleted && !m.admin).map((m) => ({ id: Number(m.id), status: "member" }));
      } else {
        // 2) Cadangan: pindai member yang tercatat bot (chat / join / reaksi)
        if (!total) {
          return say(ctx, "<tg-emoji emoji-id=\"5210952531676504517\">❌</tg-emoji> Daftar member lengkap tidak bisa diambil dan belum ada member yang tercatat bot.\n" + (fallbackHint(list.reason) || "Pastikan bot <b>admin</b> di grup ini."));
        }
        const est = Math.max(1, Math.ceil((total * DELAY_MS) / 1000));
        await say(ctx, `<tg-emoji emoji-id="5231012545799666522">🔎</tg-emoji> Memindai <b>${total}</b> member tercatat… (perkiraan ±${est} detik)`);
        const r = await scan(ctx);
        zombies = r.zombies; checked = r.checked; total = r.total; gone = r.gone;
      }

      if (!zombies.length) {
        const hint = list.source === "tracked" ? fallbackHint(list.reason) : "";
        return say(ctx, `<tg-emoji emoji-id="6120946172010959542">✅</tg-emoji> Tidak ada akun terhapus ditemukan.\n<tg-emoji emoji-id="5373012449597335010">👥</tg-emoji> Dipindai: <b>${checked}/${total}</b>${gone ? ` • ${gone} sudah keluar (dibersihkan dari catatan)` : ""}${hint ? `\n<i>${hint}</i>` : ""}`);
      }

      await say(ctx, `<tg-emoji emoji-id="6129486856212979482">🧟</tg-emoji> Ditemukan <b>${zombies.length}</b> akun terhapus. Mengeluarkan…`);

      let ok = 0;
      let fail = 0;
      let lastErr = null;
      for (const z of zombies) {
        try {
          await ctx.telegram.banChatMember(chatId, z.id);
          await ctx.telegram.unbanChatMember(chatId, z.id, { only_if_banned: true }); // kick, bukan ban permanen
          const g = getGroup(chatId);
          if (g.members) delete g.members[String(z.id)];
          ok++;
        } catch (e) {
          fail++;
          lastErr = e;
          const t = String(e?.description || e?.message || "").toLowerCase();
          if (t.includes("too many requests")) await sleep((e?.parameters?.retry_after || 5) * 1000);
        }
        await sleep(400);
      }
      await groupsDb.write().catch(() => {});
      await say(
        ctx,
        `<tg-emoji emoji-id="6269118781331609137">🧹</tg-emoji> <b>Selesai membersihkan zombie</b>\n<tg-emoji emoji-id="6120946172010959542">✅</tg-emoji> Dikeluarkan: <b>${ok}</b>${fail ? `\n<tg-emoji emoji-id="5210952531676504517">❌</tg-emoji> Gagal: <b>${fail}</b>${lastErr ? `\n<i>${esc(friendlyError(lastErr, "kick"))}</i>` : ""}` : ""}\n<tg-emoji emoji-id="5373012449597335010">👥</tg-emoji> Dipindai: <b>${checked}/${total}</b>${list.source === "tracked" && fallbackHint(list.reason) ? `\n<i>${fallbackHint(list.reason)}</i>` : ""}`
      );
    } catch (err) {
      await say(ctx, `<tg-emoji emoji-id="5210952531676504517">❌</tg-emoji> ${friendlyError(err, "memindai zombies")}`);
    } finally {
      running.delete(chatId);
    }
  },
};
