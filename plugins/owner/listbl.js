import { getBlacklist, esc } from "../../src/lib/cfd.js";

export default {
  command: ["listbl"],
  category: "owner",
  description: "Lihat daftar chat yang di-blacklist dari /cfd",
  ownerOnly: true,
  loading: false,
  run: async (ctx) => {
    const items = getBlacklist();
    if (!items.length) {
      return ctx.reply("Blacklist CFD masih kosong.\nTambah dengan /addbl di grup, atau /addbl <chat_id>.");
    }

    const header = `<b>Blacklist CFD</b> (${items.length})\n\n`;
    const lines = items.map((it, i) => `${i + 1}. ${esc(it.title)}\n    <code>${esc(it.id)}</code>`);

    // Pecah supaya tidak melewati batas 4096 karakter per pesan Telegram
    const chunks = [];
    let cur = header;
    for (const line of lines) {
      if (cur.length + line.length + 1 > 3800) {
        chunks.push(cur);
        cur = "";
      }
      cur += line + "\n";
    }
    chunks.push(cur);
    for (const c of chunks) await ctx.reply(c.trimEnd(), { parse_mode: "HTML" });
  },
};
