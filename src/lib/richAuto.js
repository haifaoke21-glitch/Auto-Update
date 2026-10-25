// AUTORICH - teks biasa -> markup Rich Message (via AI OpenAI-compatible) -> block.
// Config: config.js -> rich.autorich { baseUrl, apiKey, model } (kosong = ikut config.ai)


import axios from 'axios';
import config from '../../config.js';
import { expandAliases, promptSection, autoDecorate } from './richEmojiPool.js';
import { tidyMarkup, polishBlocks } from './richPolish.js';
import { parseRichMarkup } from './richBuild.js';

const REQUEST_TIMEOUT_MS = 30_000;

// ── ".autorich" - AI ngubah teks biasa jadi markup Rich Message (campuran banyak block) ──
// System prompt di bawah ini yang NENTUIN hasil .autorich: format markup-nya
// SAMA PERSIS kayak ".buildrich" (parser: userbotBuildRich.js), AI cuma disuruh
// nulis markup-nya doang, terus di-parse jadi block beneran. Mau hasilnya lebih
// banyak tabel / lebih ringkas / ganti gaya bahasa? Edit teks prompt ini aja
// (struktur pesan: LANGKAH 2 - tabel 2 kolom, quote, EX maks 5, tombol maks 4).
const AUTORICH_SYSTEM_PROMPT = [
  "Kamu adalah \"Rich Message Designer\". Tugasmu: mengubah teks promosi/jualan/informasi dari user menjadi Rich Message Telegram yang sangat rapi, menarik, ringkas, dan siap dikirim. JANGAN mengubah fakta, harga, kontak, username, URL, tanggal, jumlah, atau klaim utama. Kamu yang mengatur seluruh desain: pilih satu layout, susun judul, ringkasan, deskripsi, tabel 2 kolom, quote, detail yang bisa dilipat, footer, tombol, dan Premium Emoji. OUTPUT-mu HANYA MARKUP di bawah ini (tanpa penjelasan, tanpa salam, tanpa JSON, tanpa ``` code fence, tanpa markdown).",
  "",
  "=== LANGKAH 1: PILIH LAYOUT (dalam hati, JANGAN ditulis di output) ===",
  "Pilih SATU dari 30 tipe: product, service, package, pricing, promo, offer, stock, order, payment, download, announcement, update, status, warning, info, event, giveaway, membership, contact, portfolio, review, comparison, faq, steps, tutorial, schedule, market, changelog, news.",
  "Layout menentukan isi tabel dan detail:",
  "- product / service / package / pricing / promo / offer / stock / order / payment / membership / giveaway / market -> tabel berisi item atau paket beserta harga, isi, stok, periode, syarat. Quote = keunggulan atau penawaran utama.",
  "- announcement / update / status / warning / info / news / changelog / download -> tabel berisi poin kunci (apa, kapan, versi, status, link). Quote = pesan terpenting atau peringatan.",
  "- event / schedule -> tabel Waktu | Kegiatan (atau Tanggal | Acara). Detail = syarat dan info tambahan.",
  "- contact / portfolio / review -> tabel Kontak atau Karya | Detail. Quote = testimoni atau kalimat penutup yang kuat.",
  "- comparison -> tabel Aspek | Perbandingan (tetap 2 kolom, tulis pilihan yang dibandingkan di dalam sel).",
  "- faq -> tiap pertanyaan jadi 1 EX (jawaban di dalamnya). steps / tutorial -> langkah bernomor di dalam EX, tabel boleh merangkum alat/bahan/estimasi.",
  "",
  "=== LANGKAH 2: SUSUN PESAN (urutan tetap) ===",
  "1. H(judul) -> judul / kicker, maksimal 6 kata, diawali 1 Premium Emoji.",
  "2. Ringkasan (jika ada inti yang bisa diringkas): 1 paragraf maksimal 240 karakter, diawali 1 Premium Emoji.",
  "3. Deskripsi: paragraf pendek, total maksimal 900 karakter, tiap paragraf maksimal 3 kalimat. Paragraf pertama diawali 1 Premium Emoji. Kalau sumbernya panjang, padatkan dan buang pengulangan; sisanya pindahkan ke EX.",
  "4. Tabel (WAJIB 1, tidak lebih): T(judul tabel), lalu baris label kolom (kolom1)(kolom2), lalu isi. SELALU TEPAT 2 KOLOM, maksimal 8 baris isi, isi sel pendek (maksimal sekitar 40 karakter). 1 Premium Emoji di judul tabel, dan 1 Premium Emoji BERBEDA di awal sel pertama tiap baris isi. Label kolom polos tanpa emoji.",
  "5. BQ(quote) -> 1 kalimat inti / penekanan, diawali 1 Premium Emoji. Maksimal 1 quote.",
  "6. EX(judul) -> detail yang bisa dilipat, MAKSIMAL 5 EX. Tiap EX diawali 1 Premium Emoji BERBEDA. Isi EX boleh paragraf pendek, L(..) atau CC(..). Jangan ada EX, F(..), atau tombol di dalam EX. Pakai EX kalau teks panjang supaya halaman utama tetap ringkas.",
  "7. Tombol B/BP/BS/BD -> maksimal 4, HANYA kalau di teks sumber ada link (http, https, t.me, atau @username). Pakai link itu persis, JANGAN mengarang URL. Tidak ada link = tidak ada tombol.",
  "8. F(footer) -> catatan kecil, penutup, kontak singkat dari teks sumber, diawali 1 Premium Emoji. OPSIONAL. DILARANG footer berisi credit seperti \"dibuat oleh AI\" atau nama bot/model.",
  "Divider D: opsional, maksimal 2, hanya antar bagian besar. Jangan di awal, di akhir, tepat sebelum F, atau dua D berdekatan.",
  "Teks sumber sangat pendek tetap dibuat lengkap: susun ulang fakta yang ada jadi tabel ringkas 2 kolom (Aspek | Detail), quote, dan EX. Jangan menambah fakta baru.",
  "",
  "=== FORMAT MARKUP (1 elemen = 1 baris, keyword HURUF BESAR) ===",
  "H(teks)            -> heading / judul",
  "D                  -> garis pemisah, ditulis \"D\" saja 1 baris",
  "T(judul tabel)     -> tabel. Baris T(..) = judul tabel (1 sel).",
  "(kolom1)(kolom2)   -> baris tepat di bawah T(..) = label kolom. Baris (..)(..) berikutnya = isi tabel. Semua baris tabel WAJIB 2 sel (1 sel = 1 pasang kurung).",
  "EX(judul)          -> expandable (ketuk untuk buka). Isinya baris-baris tepat di bawahnya sampai baris kosong; boleh paragraf, L(..), CC(..), dan format teks. JANGAN taruh EX lain, F(..), atau tombol B di dalam EX.",
  "L(item 1)          -> list bullet. Item berikutnya: baris (item 2) / (item 3) tepat di bawahnya, sampai baris kosong.",
  "CC(item)           -> checklist (kotak centang, selalu tercentang). Item berikutnya baris (item). Pakai CC SAJA, JANGAN C(..).",
  "F(teks)            -> footer, paling bawah.",
  "B(teks,link)       -> tombol link. BP = biru, BS = hijau, BD = merah. Tombol sebaris: BS(a,link)BD(b,link).",
  "teks biasa         -> paragraf.",
  "BQ(teks)           -> blockquote. CD(teks) -> code (bisa di-tap untuk copy). P(teks) -> blok monospace. BH(teks) -> heading tebal. BL(item) -> list tebal.",
  "Catatan: paragraf tebal TIDAK bisa pakai \"B(\" (itu tombol). Tabel T(..) belum bisa pakai modifier.",
  "Baris KOSONG dipakai untuk menutup tabel / expandable / list sebelum elemen lain. Beri 1 baris kosong sebelum dan sesudah tiap T / L / CC / EX.",
  "",
  "=== CONTOH OUTPUT (ikuti POLA-nya, isi harus dari teks sumber; kode {E..} sesuaikan dengan arti di daftar emoji) ===",
  "H({E2} Promo Akhir Bulan)",
  "{E1} Diskon besar untuk semua paket hosting, berlaku sampai 31 Oktober.",
  "{E4} Hemat sampai 40 persen untuk pembelian paket tahunan. Semua paket sudah termasuk SSL gratis dan dukungan 24 jam.",
  "",
  "T({E9} Pilihan Paket)",
  "(Paket)(Harga)",
  "({E10} Basic)(Rp 25.000 per bulan)",
  "({E6} Pro)(Rp 45.000 per bulan)",
  "({E11} Bisnis)(Rp 90.000 per bulan)",
  "",
  "D",
  "",
  "BQ({E2} Promo berlaku sampai 31 Oktober 2026.)",
  "",
  "EX({E7} Cara order)",
  "L(1. Chat admin lewat tombol di bawah)",
  "(2. Pilih paket yang diinginkan)",
  "(3. Lakukan pembayaran dan kirim bukti)",
  "",
  "EX({E12} Syarat dan ketentuan)",
  "Promo tidak bisa digabung dengan voucher lain.",
  "",
  "BS(Chat Admin,https://t.me/contohadmin)",
  "F({E14} Admin online 09.00 sampai 21.00 WIB.)",
  "",
  "=== ATURAN WAJIB ===",
  "A. SETIA SAMA ISI. Pakai hanya informasi yang ada di teks sumber. Boleh menyusun ulang, meringkas, mengelompokkan, dan membuat judul; JANGAN mengarang fakta, angka, nama, atau link baru.",
  "B. Bahasa output = bahasa teks sumber (kecuali user minta lain).",
  "C. Isi sel tabel, item list, teks heading, dan teks di dalam kurung: 1 baris, TEKS POLOS. Dilarang markdown (** _ # `), dilarang HTML, dilarang baris baru di dalam elemen. Tanda kurung di dalam teks harus berpasangan.",
  "D. Baris paragraf biasa jangan diawali keyword markup (H( T( EX( L( CC( F( B( BQ( CD( P( atau D) kecuali memang mau dijadikan elemen itu.",
  "E. Heading, judul EX, judul tabel, label kolom, sel, dan item list: tanpa titik di akhir, ringkas, huruf kapital di awal. Kalimat paragraf diakhiri titik. Jangan menulis kalimat dengan HURUF BESAR SEMUA (kecuali singkatan).",
  "F. Kalau di teks sumber ada penanda emoji premium berbentuk {angka|emoji} (mis. {5111111111111111111|😭}), salin PERSIS apa adanya, jangan diubah atau dihapus.",
  "G. Kalau ada INSTRUKSI TAMBAHAN DARI USER (mis. \"tanpa tabel\", \"tanpa expandable\", \"bahasa inggris\"), instruksi itu MENANG dari aturan di atas.",
  "H. Maksimal 45 baris keyword. Rapi, ringkas, enak dibaca di HP.",
  "",
  "Ingat: keluarkan HANYA markup-nya. Contoh di atas cuma ilustrasi pola - JANGAN salin kalimat atau isinya.",
].join('\n');

const AUTORICH_MAX_SOURCE_CHARS = 6000;
const AUTORICH_TIMEOUT_MS = 90_000;

// Provider KHUSUS .autorich (config.js -> rich.autorich { baseUrl, apiKey, model }).
// Kalau baseUrl kosong, ikut provider /ai (config.ai). Key provider .ai GAK PERNAH
// dikirim ke URL autorich (dan sebaliknya).
// autorichApiModel boleh string atau array (dicoba berurutan kalau model
// sebelumnya gagal: gak ketemu / kena limit / error server).
function autorichProvider() {
  const own = config.rich?.autorich || {};
  const ownBase = String(own.baseUrl || '').trim();
  const base = ownBase || String(config.ai?.baseUrl || '').trim();
  const key = ownBase ? String(own.apiKey || '').trim() : String(config.ai?.apiKey || '').trim();
  const rawModels = ownBase ? own.model : config.ai?.model;
  const models = (Array.isArray(rawModels) ? rawModels : [rawModels])
    .map((m) => String(m || '').trim())
    .filter(Boolean);
  if (!models.length) models.push('gpt-3.5-turbo');
  // baseUrl berhenti di /v1 (bot menambahkan /chat/completions); URL lengkap tetap diterima
  const url = base && (/\/chat\/completions\/?$/.test(base) ? base : base.replace(/\/$/, '') + '/chat/completions');
  return { url, key, models };
}

// Pesan error dari body response provider (format OpenAI / Gemini, bisa array).
function apiErrorMessage(err) {
  const data = err && err.response && err.response.data;
  const e = Array.isArray(data) ? (data[0] && data[0].error) : (data && data.error);
  const msg = (e && (e.message || e.status)) || (typeof data === 'string' ? data : '') || err.message;
  return String(msg || 'unknown error').slice(0, 300);
}

// Error sementara di sisi provider (mis. Gemini 503 "high demand"): coba lagi
// model yang SAMA beberapa kali dgn jeda naik, baru pindah ke model berikutnya.
const RETRY_STATUSES = new Set([429, 500, 502, 503, 504]);
const RETRY_MAX_TRIES = 3;          // total percobaan per model
const RETRY_BASE_DELAY_MS = 2000;   // 2s, 4s, ...
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function postWithRetry(url, body, config, model) {
  for (let attempt = 1; ; attempt++) {
    try {
      return await axios.post(url, body, config);
    } catch (err) {
      const status = err && err.response && err.response.status;
      const transient = RETRY_STATUSES.has(status) || ['ECONNRESET', 'ETIMEDOUT', 'ECONNABORTED'].includes(err && err.code);
      if (!transient || attempt >= RETRY_MAX_TRIES) throw err;
      const retryAfter = Number(err.response && err.response.headers && err.response.headers['retry-after']);
      const wait = (Number.isFinite(retryAfter) && retryAfter > 0 ? Math.min(retryAfter * 1000, 15000) : RETRY_BASE_DELAY_MS * attempt)
        + Math.floor(Math.random() * 500);
      console.warn(`[AUTORICH] model "${model}" HTTP ${status || err.code} - coba lagi ${attempt}/${RETRY_MAX_TRIES - 1} dalam ${Math.round(wait / 1000)}s`);
      await sleep(wait);
    }
  }
}

// Nembak endpoint AI (OpenAI-compatible) dgn system prompt bebas & TANPA
// histori / lowercase-paksa. Balikin teks mentahnya.
async function callAiRaw(messages, { temperature = 0.4, timeout = REQUEST_TIMEOUT_MS } = {}) {
  const { url: apiUrl, key: apiKey, models } = autorichProvider();
  if (!apiUrl) {
    const err = new Error('NOT_CONFIGURED');
    err.code = 'NOT_CONFIGURED';
    throw err;
  }
  let lastErr = null;
  const failures = [];
  for (let i = 0; i < models.length; i++) {
    const model = models[i];
    try {
      const res = await postWithRetry(
        apiUrl,
        { model, temperature, messages },
        {
          headers: {
            'Content-Type': 'application/json',
            ...(apiKey ? { Authorization: `Bearer ${apiKey}` } : {}),
          },
          timeout,
        },
        model
      );
      const reply = res.data && res.data.choices && res.data.choices[0] && res.data.choices[0].message && res.data.choices[0].message.content;
      if (!reply || !String(reply).trim()) {
        throw new Error('Response API AI kosong/gagal parse (cek format endpoint-nya OpenAI-compatible atau bukan).');
      }
      return String(reply).trim();
    } catch (err) {
      const status = err && err.response && err.response.status;
      const detail = status ? `HTTP ${status}: ${apiErrorMessage(err)}` : err.message;
      console.error(`[AUTORICH] model "${model}" gagal - ${detail}`);
      lastErr = status ? new Error(`${model} - ${detail}`) : err;
      failures.push(`${model} - ${detail}`);
      // key/akses salah: ganti model gak bakal nolong
      if (status === 401 || status === 403) throw lastErr;
    }
  }
  // semua model gagal: tampilin SEMUA alasannya (bukan cuma model terakhir)
  throw failures.length > 1 ? new Error(failures.join(' | ')) : (lastErr || new Error('Provider AI autorich gagal.'));
}

// Bersihin output AI: buang code fence / label "markup:" / <think> kalau ada.
function cleanAutorichOutput(raw) {
  let t = String(raw || '').replace(/\r/g, '');
  t = t.replace(/<think>[\s\S]*?<\/think>/gi, '');
  const fenced = t.match(/```[a-zA-Z]*\n([\s\S]*?)```/);
  if (fenced) t = fenced[1];
  t = t.replace(/```[a-zA-Z]*/g, '');
  t = t.replace(/^\s*(markup|output|hasil)\s*:\s*\n/i, '');
  return t.trim();
}

/**
 * Teks biasa -> block Rich Message (campuran tipe block lengkap, tabel 1-3) via AI.
 * Kalau markup dari AI gagal di-parse, dicoba lagi 1x dengan ngasih tau error-nya.
 * @param {string} sourceText teks yang mau dijadiin Rich Message
 * @param {string} [hint] instruksi tambahan dari user (opsional), mis. "fokus tabel"
 * @returns {Promise<{ blocks: Array, markup: string }>}
 */
async function generateRichBlocks(sourceText, hint) {
  let source = String(sourceText || '').trim();
  if (source.length > AUTORICH_MAX_SOURCE_CHARS) source = source.slice(0, AUTORICH_MAX_SOURCE_CHARS);

  const userContent =
    (hint ? `INSTRUKSI TAMBAHAN DARI USER: ${hint}\n\n` : '') +
    'TEKS SUMBER (ubah jadi Rich Message pake markup, output HANYA markup):\n"""\n' + source + '\n"""';

  const messages = [
    { role: 'system', content: AUTORICH_SYSTEM_PROMPT + promptSection() },
    { role: 'user', content: userContent },
  ];

  // {E1}..{E15} -> {ID|emoji} premium, lalu judul yang belum berhias ditempelin emoji premium
  // autorich cuma pake checklist tercentang: C( nyasar dari AI dipaksa jadi CC(
  const onlyChecked = (t) => t.replace(/^(BQ|CD|B|P)?C\(/gm, '$1CC(');
  // urutan: rapihin tata letak markup -> kode emoji premium -> hias judul
  const finalize = (raw) => autoDecorate(expandAliases(onlyChecked(tidyMarkup(cleanAutorichOutput(raw)))));

  let markup = finalize(await callAiRaw(messages, { timeout: AUTORICH_TIMEOUT_MS }));
  let parsed = parseRichMarkup(markup);

  if (parsed.error) {
    messages.push({ role: 'assistant', content: markup });
    messages.push({
      role: 'user',
      content: `Markup-mu error: ${parsed.error}\nPerbaiki dan kirim ulang markup LENGKAP-nya (HANYA markup, tanpa penjelasan).`,
    });
    markup = finalize(await callAiRaw(messages, { temperature: 0.2, timeout: AUTORICH_TIMEOUT_MS }));
    parsed = parseRichMarkup(markup);
  }

  if (parsed.error) {
    const err = new Error(parsed.error);
    err.code = 'PARSE_FAILED';
    throw err;
  }
  // tata baca teks dirapihin (huruf kapital, titik, spasi, dll) - liat userbotRichPolish.js
  return { blocks: polishBlocks(parsed.blocks), markup };
}

export { generateRichBlocks };
