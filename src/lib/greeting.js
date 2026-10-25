import { getGroup, saveGroup } from "../database.js";
import { say, esc } from "./groupUtil.js";
import {
  compileTemplate, sendTemplate, makeVars, previewText, describeTemplate, VAR_LIST,
} from "./greetingFormat.js";
import { buildEntry, sendFilter, describeEntry, archiveEntry } from "./filterCore.js";

export const DEFAULT_WELCOME = "👋 Selamat datang, {mention}!\nKamu member ke-{count} di {group}.\nBaca deskripsi grup sebelum bertanya, ketik /rules untuk lihat aturan.";
export const DEFAULT_GOODBYE = "👋 {name} telah meninggalkan {group}.";

const OK = '<tg-emoji emoji-id="6120946172010959542">✅</tg-emoji>';
const NO = '<tg-emoji emoji-id="5210952531676504517">❌</tg-emoji>';
const INFO = '<tg-emoji emoji-id="5231012545799666522">ℹ️</tg-emoji>';

const errMsg = (e) => String(e?.description || e?.message || e).replace(/^\d+:\s*/, "").replace(/^Bad Request:\s*/i, "").slice(0, 200);

const helpText = (c, title) =>
  `${INFO} <b>Cara set ${esc(title)}</b>\n\n` +
  `Siapkan <b>satu pesan</b> yang sudah jadi (teks berformat, Rich Message, tombol link, font, emoji premium, atau <b>foto / video / GIF / stiker / file</b> + caption), lalu <b>balas pesan itu</b> dengan <code>/${c} set</code>. Semuanya ikut tersimpan.\n\n` +
  `<b>Variabel</b> (di teks / caption / tombol)\n<code>${esc(VAR_LIST)}</code>\n\n` +
  `<b>Tombol</b> — ikut tersalin dari pesan yang dibalas (tombol link). Atau tulis di teks, satu baris = satu baris tombol:\n` +
  `<pre>B(Join Grup,https://t.me/grup)BS(Rules,t.me/rules)\nBD(Owner,@username)\n[Info](buttonurl://example.com)</pre>` +
  `<code>B</code> biasa · <code>BP</code> biru · <code>BS</code> hijau · <code>BD</code> merah · <code>:same</code> = sebaris (maks 4 per baris, 12 total).\n\n` +
  `Ikon premium di tombol: ketik emoji premium di awal teks tombol (<code>B(👑 OWNER,https://t.me/owner)</code>) atau pakai ID: <code>B({5217822164362739968|👑} OWNER,https://t.me/owner)</code>.\n\n` +
  `<b>Rich Message</b> — tiap elemen satu baris\n` +
  `<pre>H(Selamat Datang)\nHalo {mention}!\nT(Info Grup)\n(Grup)({group})\n(Member)({count})\nEX(Aturan)\nDilarang spam\nBQ(Kutipan)\nD\nF(Pesan otomatis)</pre>` +
  `Pakai <code>/${c} test</code> untuk melihat hasilnya.`;

/** Template aktif untuk grup: template baru (V2) → teks lama (polos) → bawaan */
const cache = new Map();
export function resolveTemplate(group, key) {
  const tplKey = `${key}Tpl`;
  const textKey = `${key}Text`;
  const stored = group[tplKey];
  if (stored && typeof stored.legacy === "string") return stored;
  const src = group[textKey] || (key === "welcome" ? DEFAULT_WELCOME : DEFAULT_GOODBYE);
  if (!cache.has(src)) {
    const c = compileTemplate(src, []);
    cache.set(src, c.tpl || { v: 2, rich: null, legacy: esc(src), buttons: [] });
    if (cache.size > 200) cache.delete(cache.keys().next().value);
  }
  return cache.get(src);
}

/** Pabrik plugin welcome / goodbye: on | off | set <teks> | reset | test | help | status */
export function greetingCommand({ command, key, textKey, title, description }) {
  const tplKey = `${key}Tpl`;
  const entKey = `${key}Entry`;
  const c = command[0];
  return {
    command,
    category: "group",
    description: `${description} Mendukung format, Rich Message & tombol. Set hanya lewat balas pesan. Contoh: /${c} on | off | set (balas pesan) | reset | test | help`,
    adminOnly: true,
    groupOnly: true,
    run: async (ctx, { args }) => {
      const sub = args[0]?.toLowerCase();
      const group = getGroup(ctx.chat.id);
      const memberCount = () => ctx.telegram.getChatMembersCount(ctx.chat.id).catch(() => "?");

      if (sub === "on" || sub === "off") {
        await saveGroup(ctx.chat.id, { [key]: sub === "on" });
        return say(ctx, `${OK} Pesan <b>${title}</b> ${sub === "on" ? "diaktifkan" : "dinonaktifkan"}.`);
      }

      if (sub === "help" || sub === "format" || sub === "bantuan") return say(ctx, helpText(c, title));

      if (sub === "set") {
        // Hanya lewat balas pesan: balas pesan yang sudah jadi (format, tombol, foto, video, dll) dengan /<perintah> set
        const msg = ctx.message;
        const guide = () => say(ctx, `${INFO} <b>Set ${esc(title)} lewat balas pesan.</b>\n1. Siapkan pesan ${esc(title)} yang sudah jadi (berformat, Rich Message, tombol, foto/video, dll).\n2. Balas pesan itu dengan <code>/${c} set</code>.\n\nKetik <code>/${c} help</code> untuk variabel &amp; contoh.`);
        if (!msg.reply_to_message) return guide();
        const r = buildEntry({ text: "/x w", entities: [], from: msg.from, chat: msg.chat, reply_to_message: msg.reply_to_message });
        if (r.usage) return guide();
        if (r.error) return say(ctx, `${NO} ${esc(r.error)}`);
        try { // diagnosa: berapa emoji premium & ikon tombol yang terbaca dari pesan yang dibalas
          const rp = msg.reply_to_message;
          const blob = JSON.stringify([rp.rich_message ?? null, rp.entities ?? null, rp.caption_entities ?? null]) || "";
          const inTxt = (blob.match(/"(?:custom_emoji_id|emoji_id|document_id)":"?\d{5,}/g) || []).length;
          const inBtn = JSON.stringify(rp.reply_markup || {}).match(/"icon_custom_emoji_id":"?\d{5,}/g)?.length || 0;
          console.log(`[GREETING] set ${key}: emoji premium di teks=${inTxt}, ikon tombol=${inBtn}, exact=${!!(r.entry.exact || r.entry.raw || r.entry.src)}`);
        } catch { /* diagnosa saja */ }

        // Kirim contoh dulu; hanya disimpan kalau Telegram menerimanya
        let entry = r.entry;
        let sent = null;
        const sample = async () => { sent = await sendFilter(ctx, entry, { members: [ctx.from] }); };
        try {
          try {
            await sample();
          } catch (e1) {
            if (entry.src && entry.type === "text") { // Rich Message ditolak -> salin pesan aslinya
              entry = { ...entry, type: "copy", tpl: entry.tpl?.buttons?.length ? { v: 2, rich: null, legacy: "", buttons: entry.tpl.buttons } : null };
              await sample();
            } else throw e1;
          }
        } catch (e) {
          return say(ctx, `${NO} Telegram menolak pesan ini, ${esc(title)} belum disimpan.\n<code>${esc(errMsg(e))}</code>`);
        }
        // Jenis "copy" bergantung pada pesan asli -> arsipkan salinannya supaya aman walau pesan asli dihapus
        entry = await archiveEntry(ctx, entry, sent);
        await saveGroup(ctx.chat.id, { [entKey]: entry, [tplKey]: null, [textKey]: "" });
        const kept = entry.type === "copy" ? (entry.backups || []).length : 0;
        return say(ctx, `${OK} ${esc(title)} disimpan (${esc(describeEntry(entry))}). Pesan di atas adalah contoh tampilannya.${entry.raw?.rich != null ? `\n${INFO} Dikirim ulang <b>persis seperti pesan asli</b> (emoji premium, tabel, tombol, warna & ikon tombol); variabel tetap diganti.` : ""}${entry.type === "copy" && !entry.raw ? `\n${NO} <b>Variabel tidak berfungsi</b> di salinan pesan: {mention}, {name}, {group}, {count}, dll tampil apa adanya karena Telegram menyalin pesan persis seperti aslinya. Agar variabel jalan, balas pesan <b>teks / caption berformat</b> atau tulis Rich Message pakai markup (<code>/${c} help</code>).\n${INFO} Salinan pesan sudah diarsipkan (${kept} cadangan), jadi aman walau pesan yang dibalas tadi dihapus.` : `\n${INFO} Isi pesan tersimpan di database, aman walau pesan yang dibalas dihapus.`}`);
      }

      if (sub === "reset") {
        await saveGroup(ctx.chat.id, { [textKey]: "", [tplKey]: null, [entKey]: null });
        return say(ctx, `${OK} Teks ${title} dikembalikan ke bawaan.`);
      }

      if (sub === "test") {
        try {
          if (group[entKey]) await sendFilter(ctx, group[entKey], { members: [ctx.from] });
          else await sendTemplate(ctx, resolveTemplate(group, key), makeVars([ctx.from], { group: ctx.chat.title, count: await memberCount() }));
        } catch (e) {
          return say(ctx, `${NO} Gagal mengirim contoh: <code>${esc(errMsg(e))}</code>`);
        }
        return;
      }

      // status
      const stored = group[tplKey];
      const hasNew = stored && typeof stored.legacy === "string";
      const ent = group[entKey];
      const kind = ent ? `custom — ${describeEntry(ent)}` : hasNew ? `custom — ${describeTemplate(stored)}` : group[textKey] ? "custom — teks biasa" : "bawaan";
      const tpl = resolveTemplate(group, key);
      return say(ctx,
        `<tg-emoji emoji-id="5341715473882955310">⚙️</tg-emoji> <b>${title}</b>: ${group[key] ? 'AKTIF <tg-emoji emoji-id="6120946172010959542">✅</tg-emoji>' : 'nonaktif <tg-emoji emoji-id="5210952531676504517">❌</tg-emoji>'}\n` +
        `<tg-emoji emoji-id="5334882760735598374">📝</tg-emoji> Teks: <i>${esc(kind)}</i>\n${ent ? "" : `<blockquote>${esc(previewText(tpl))}</blockquote>`}\n` +
        `Perintah: <code>/${c} on|off</code> · <code>/${c} set</code> (balas pesan jadi) · <code>/${c} reset</code> · <code>/${c} test</code> · <code>/${c} help</code>\n` +
        `Variabel: <code>${esc(VAR_LIST)}</code>`
      );
    },
  };
}

/** Kirim sapaan untuk satu atau beberapa member sekaligus (1 pesan, tidak spam) */
export async function sendGreeting(ctx, group, key, members) {
  const count = await ctx.telegram.getChatMembersCount(ctx.chat.id).catch(() => "?");
  try {
    const ent = group[`${key}Entry`];
    if (ent) await sendFilter(ctx, ent, { members });
    else await sendTemplate(ctx, resolveTemplate(group, key), makeVars(members, { group: ctx.chat.title, count }));
  } catch (e) {
    console.warn("[GREETING] gagal kirim:", e?.description || e?.message);
  }
}
