import { getBuffer, escH, isUrl, getMediaBuffer } from "../../src/lib/util.js";

async function resolveAvatar(ctx, provided) {
  if (provided && isUrl(provided)) return provided;
  // Coba dari reply foto
  const buf = await getMediaBuffer(ctx, ["photo"]);
  if (buf) {
    const msg = ctx.message?.reply_to_message || ctx.message;
    const fileId = msg?.photo?.at(-1)?.file_id;
    if (fileId) {
      try {
        const link = await ctx.telegram.getFileLink(fileId);
        return link.href;
      } catch {}
    }
  }
  return null;
}

export default {
  command: ["fakethreads"],
  category: "fake",
  description: "Buat fake Threads.",
  run: async (ctx, { text }) => {
    const parts = (text || "").split("|").map(s => s.trim()).filter(Boolean);
    if (parts.length < 2) {
      return ctx.replyWithHTML(
        `🎭 <b>Fake Threads</b>\n\n` +
        `Contoh:\n<code>/fakethreads username | https://i.pravatar.cc/150 | Halo dunia! | 1500</code>\n\n` +
        `Atau reply foto + <code>/fakethreads username | teks | 500</code>\n` +
        `Likes bersifat opsional (default jika tidak diisi).`
      );
    }

    let username = parts[0];
    let avatar = null;
    let content = "";
    let likes = null;

    // Deteksi likes (angka di akhir)
    const last = parts[parts.length - 1];
    if (/^\d+$/.test(last) && parts.length >= 3) {
      likes = last;
      parts.pop();
    }

    if (parts.length >= 2 && isUrl(parts[1])) {
      avatar = parts[1];
      content = parts.slice(2).join(" | ");
    } else {
      content = parts.slice(1).join(" | ");
      avatar = await resolveAvatar(ctx, null);
    }

    if (!avatar) avatar = "https://i.pravatar.cc/150";
    if (!content) return ctx.reply("❌ Teks wajib diisi.");

    try {
      let url = `https://api.nexray.eu.cc/maker/fakethreads?username=${encodeURIComponent(username)}&avatar=${encodeURIComponent(avatar)}&text=${encodeURIComponent(content)}`;
      if (likes) url += `&likes=${encodeURIComponent(likes)}`;

      const buf = await getBuffer(url);
      const likeText = likes ? ` • ${Number(likes).toLocaleString("id-ID")} likes` : "";
      await ctx.replyWithPhoto({ source: buf }, {
        caption: `✅ Fake Threads oleh <b>${escH(username)}</b>${likeText}`,
        parse_mode: "HTML",
      });
    } catch (err) {
      await ctx.reply(`❌ Gagal membuat fake Threads: ${escH(err.message)}`, { parse_mode: "HTML" });
    }
  },
};
