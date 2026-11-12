import { getJson, escH, isUrl } from "../../src/lib/util.js";

export default {
  command: ["amfind"],
  category: "tools",
  description: "Cari link preset Alight Motion dari link TikTok / YouTube / Instagram.",
  run: async (ctx, { text }) => {
    const url = String(text || "").trim();
    if (!url || !isUrl(url)) {
      return ctx.replyWithHTML(
        `🔍 <b>AM Find</b>\n\n` +
        `Cari link preset Alight Motion dari link TikTok, YouTube, atau Instagram.\n\n` +
        `Contoh:\n<code>/amfind https://www.tiktok.com/@user/video/123</code>`
      );
    }

    try {
      const apiUrl = "https://api-cloud.my.id/tools/amfind2";
      const data = await getJson(apiUrl, { url });
      if (!data?.status || !data.result) {
        throw new Error(data?.error || "Tidak menemukan hasil atau link tidak valid");
      }

      const r = data.result;
      const video = r.video || {};
      const author = r.author || {};
      const presets = Array.isArray(r.presets) ? r.presets : [];

      let msg = `🔍 <b>AM Find</b>\n\n`;
      if (video.title) msg += `📺 <b>${escH(video.title)}</b>\n`;
      if (author.nickname || author.uniqueId) {
        msg += `👤 ${escH(author.nickname || author.uniqueId)}\n`;
      }
      if (video.platform) msg += `Platform: ${escH(video.platform)}\n`;
      if (video.views) msg += `Views: ${Number(video.views).toLocaleString("id-ID")}\n`;
      msg += `\n`;

      if (presets.length) {
        msg += `<b>Preset Alight Motion ditemukan (${presets.length}):</b>\n`;
        presets.slice(0, 10).forEach((p, i) => {
          const link = typeof p === "string" ? p : (p.url || p.link || p.preset || JSON.stringify(p));
          msg += `${i + 1}. <a href="${escH(link)}">${escH(link)}</a>\n`;
        });
        if (presets.length > 10) msg += `... dan ${presets.length - 10} lainnya\n`;
      } else {
        msg += `❌ Tidak ada preset Alight Motion yang ditemukan di video ini.`;
      }

      if (r.scanned) {
        msg += `\n\nScanned: ${r.scanned.comments || 0} comments, ${r.scanned.replies || 0} replies`;
      }

      await ctx.replyWithHTML(msg, { disable_web_page_preview: true });
    } catch (err) {
      await ctx.reply(`❌ Gagal mencari preset: ${escH(err.message)}`, { parse_mode: "HTML" });
    }
  },
};
