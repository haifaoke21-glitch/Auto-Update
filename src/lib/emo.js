// ═══════════════════════════════════════════════════════════════════════
// EMO — emoji premium siap pakai untuk pesan HTML / Rich Message.
//
//   E.ok, E.no, E.warn, ...  -> string <tg-emoji emoji-id="ID">emoji</tg-emoji> (konstanta)
//   emo("👑 Owner")          -> bungkus emoji di teks DINAMIS (mis. ikon role dari data) jadi <tg-emoji>
//
// ID diambil dari data/EmojiPrem By @AboutAzmi.js. Emoji yang belum punya ID sendiri memakai ID emoji terdekat
// (sama seperti ALIASES di premiumEmoji.js). Kalau pemilik bot tidak premium, Telegram menampilkan emoji biasa.
// Jangan dipakai untuk teks tombol (tombol memakai icon_custom_emoji_id lewat lapisan runtime).
// ═══════════════════════════════════════════════════════════════════════

import fs from "fs";
import { emojiMap as extraEmoji } from "../../data/EmojiPrem By @AboutAzmi.js";

const tg = (id, e) => `<tg-emoji emoji-id="${id}">${e}</tg-emoji>`;

// emoji -> id (dipakai emo() untuk teks dinamis)
const MAP = {
  "✅": "6120946172010959542", "❌": "5210952531676504517", "ℹ️": "5231012545799666522", "⚠️": "5420323339723881652",
  "🚫": "5240241223632954241", "📝": "5334882760735598374", "📋": "6307686831735444755", "🔎": "5231012545799666522",
  "👤": "5373012449597335010", "🛡️": "6204072077159309131", "⚙️": "5341715473882955310", "⏳": "5454415424319931791",
  "🔇": "5213391561999526028", "🔊": "5213391561999526028", "♻️": "6251145511428950009", "👢": "5240241223632954241",
  "🤖": "5287684458881756303", "😅": "6093522689861882360", "🟢": "6120946172010959542", "🔴": "5411225014148014586",
  "🖥️": "5282843764451195532", "🧾": "5334882760735598374", "📊": "5231200819986047254", "🧩": "6120946172010959542",
  "📖": "6307686831735444755", "⌨️": "5373330964372004748", "🆕": "6123129707614441341", "✍️": "5879841310902324730",
  "🔑": "5330115548900501467", "📌": "5397782960512444700",
  // ikon role (roles.js)
  "👑": "5217822164362739968", "💎": "5427168083074628963", "🛒": "5431499171045581032", "🌟": "6123129707614441341",
  "👨‍💻": "5967763324425736076", "🔱": "5217822164362739968", "🏛️": "6204072077159309131", "💼": "5445221832074483553",
  "🤝": "4976940882071651344", "☁️": "6073395072953485376",
};

const strip = (s) => s.replace(/\uFE0F/g, "");
const escRe = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
const IDS = new Map(Object.entries(MAP).map(([k, v]) => [strip(k), v]));
// Tambahan otomatis dari data/EmojiPrem By @AboutAzmi.js (emoji sungguhan saja, bukan simbol teks seperti → ✓).
try {
  const extra = extraEmoji || {};
  for (const [k, v] of Object.entries(extra)) {
    const key = strip(k);
    if (key !== "©" && /\p{Extended_Pictographic}|\u20E3/u.test(key) && /^\d{5,}$/.test(String(v)) && !IDS.has(key)) IDS.set(key, String(v));
  }
} catch { /* pakai MAP bawaan saja */ }
const RE = new RegExp(
  [...IDS.keys()].sort((a, b) => [...b].length - [...a].length).map((k) => [...k].map((ch) => escRe(ch) + "\\uFE0F?").join("")).join("|"),
  "gu"
);

/** Bungkus emoji yang dikenal di teks dinamis (tanpa tag HTML) jadi <tg-emoji>. Emoji lain dibiarkan. */
export const emo = (text = "") => String(text).replace(RE, (m) => tg(IDS.get(strip(m)), m));

export const E = Object.fromEntries(
  Object.entries({
    ok: "✅", no: "❌", info: "ℹ️", warn: "⚠️", deny: "🚫", note: "📝", list: "📋", search: "🔎", user: "👤",
    shield: "🛡️", gear: "⚙️", wait: "⏳", mute: "🔇", unmute: "🔊", reset: "♻️", kick: "👢", bot: "🤖", laugh: "😅",
    on: "🟢", off: "🔴", pc: "🖥️", receipt: "🧾", chart: "📊", puzzle: "🧩", book: "📖", keyboard: "⌨️", fresh: "🆕",
    pencil: "✍️", key: "🔑", pin: "📌",
  }).map(([name, e]) => [name, tg(MAP[e], e)])
);
