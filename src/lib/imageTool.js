import { getMediaBuffer, formatBytes } from "./util.js";
import { callApiTry, resolveFile, uploadTemp } from "./xapi.js";

// Balas aman: error apa pun saat membalas tidak boleh membuat command crash
const safe = (p) => Promise.resolve(p).catch(() => null);

/**
 * Runner umum untuk fitur "kirim foto -> API -> kirim foto hasil".
 * opts: { base, path, tag, caption, extra (param tambahan), waitText }
 * Return false kalau tidak ada foto.
 */
export async function runImageTool(ctx, { base, path, tag = path, caption, waitText, extra = {} }) {
  let wait = null;
  let typing = null;
  try {
    const buf = await getMediaBuffer(ctx, ["photo", "document"]);
    if (!buf) return false;

    wait = await safe(ctx.reply(`⏳ ${waitText || "Sedang memproses gambar, tunggu sebentar..."}`));
    typing = setInterval(() => ctx.sendChatAction("upload_photo").catch(() => {}), 4500);

    const link = await uploadTemp(buf);
    // Nama parameter gambar dicoba berurutan kalau server menolak
    const r = await callApiTry(base, path, ["url", "image", "imageUrl", "link"].map((k) => ({ [k]: link, ...extra })), { timeout: 180000 });
    const out = await resolveFile(r);
    if (!out?.buf?.length) throw new Error("Hasil dari API kosong");

    const cap = caption ? `${caption} (${formatBytes(out.buf.length)})` : undefined;
    try {
      if (out.buf.length > 10 * 1024 * 1024) throw new Error("too large for photo");
      await ctx.replyWithPhoto({ source: out.buf }, { caption: cap });
    } catch (e) {
      console.error(`[IMAGETOOL ${tag}] kirim foto gagal, kirim sebagai file:`, e.message);
      await ctx.replyWithDocument({ source: out.buf, filename: "result.png" }, { caption: cap });
    }
  } catch (err) {
    console.error(`[IMAGETOOL ${tag}]`, err.response?.status, err.response?.data ? String(err.response.data).slice(0, 300) : "", err.stack || err.message);
    const msg = String(err.message || "Unknown error").replace(/\s+/g, " ").slice(0, 300);
    await safe(ctx.reply(`❌ Gagal memproses: ${msg}`)); // teks biasa, tanpa parse_mode
  } finally {
    if (typing) clearInterval(typing);
    if (wait) safe(ctx.telegram.deleteMessage(ctx.chat.id, wait.message_id));
  }
  return true;
}
