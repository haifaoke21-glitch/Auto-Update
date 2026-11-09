// ═══════════════════════════════════════════════════════════════════════
// RICH CARD - helper buat nyusun pesan "kartu" (judul + tabel + catatan)
// jadi SATU pesan HTML yang RESMI VALID buat Telegram Bot API.
//
// KENAPA DIBIKIN SENDIRI (bukan pake "sendRichMessage"/<table>/<img>):
// Telegram Bot API cuma support tag HTML TERBATAS di parse_mode:'HTML' -
// <b>, <i>, <u>, <s>, <code>, <pre>, <a>, <tg-spoiler>, <blockquote>.
// GAK ADA <table>, <img>, <h2>, dst - kalau tetep dikirim, Telegram bakal
// nolak pesannya (error "can't parse entities"). Jadi "tabel" di sini
// ditiru pake <pre> (blok monospace) + kolom yang di-rata pake spasi -
// itu teknik STANDAR buat bikin tabel-tabelan di Telegram, dan beneran
// jalan di server asli (bukan cuma harapan kayak sendRichMessage).
//
// CARA PAKE:
//   const { buildCard } = require('./richCard');
//   const html = buildCard({
//     title: '📋 Daftar Grup',
//     subtitle: 'Data per hari ini',
//     headers: ['No', 'Nama', 'Target?'],
//     rows: [['1', 'Grup A', 'Ya'], ['2', 'Grup B', 'Tidak']],
//     note: 'Total: 2 grup',
//   });
//   await message.edit({ text: html, parseMode: 'html' });
//
// title/subtitle/note BOLEH pake tag HTML manual (<b>, <code>, dst) -
// gak di-escape otomatis, SAMA kayak cara nulis teks di userbotTexts.js.
// Isi headers/rows OTOMATIS di-escape (karena biasanya data mentah,
// misal nama grup, yang bisa kebetulan ngandung karakter "<" / "&").
// ═══════════════════════════════════════════════════════════════════════

function escapeHtml(text) {
  return String(text ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}

function padCell(text, width) {
  const str = String(text ?? '');
  return str.length >= width ? str : str + ' '.repeat(width - str.length);
}

// Susun headers+rows jadi teks TABEL BERKOTAK PENUH (border kiri-kanan-
// atas-bawah + pemisah antar baris), buat dibungkus <pre>. Ini teknik
// box-drawing character (┌─┬─┐, │, ├─┼─┤, └─┴─┘) - tampilannya jauh
// lebih mirip "tabel beneran" dibanding cuma garis pemisah header doang.
// Semua isi cell di-escape HTML dulu SEBELUM diukur lebarnya, biar
// perataannya gak meleset gara-gara "&amp;" dianggap 1 kolom tapi
// panjangnya beda sama "&".
function buildTableText(headers, rows) {
  const escapedHeaders = headers.map((h) => escapeHtml(h));
  const escapedRows = rows.map((r) => r.map((c) => escapeHtml(c)));
  const allRows = [escapedHeaders, ...escapedRows];

  const colWidths = escapedHeaders.map((_, colIndex) =>
    Math.max(...allRows.map((r) => String(r[colIndex] ?? '').length))
  );

  const renderRow = (r) =>
    '│ ' + r.map((cell, i) => padCell(cell, colWidths[i])).join(' │ ') + ' │';

  const borderLine = (left, mid, right) =>
    left + colWidths.map((w) => '─'.repeat(w + 2)).join(mid) + right;

  const topBorder = borderLine('┌', '┬', '┐');
  const headerSeparator = borderLine('├', '┼', '┤');
  const bottomBorder = borderLine('└', '┴', '┘');

  return [
    topBorder,
    renderRow(escapedHeaders),
    headerSeparator,
    ...escapedRows.map(renderRow),
    bottomBorder,
  ].join('\n');
}

// Susun satu "kartu" lengkap: judul, subjudul opsional, tabel opsional
// (headers+rows), catatan opsional. Balikin STRING HTML siap kirim
// (parseMode:'html' / parse_mode:'HTML').
function buildCard({ title, subtitle, headers, rows, note }) {
  const parts = [];

  if (title) parts.push(`<b>${title}</b>`);
  if (subtitle) parts.push(subtitle);

  if (headers && rows && rows.length) {
    parts.push(`<pre>${buildTableText(headers, rows)}</pre>`);
  }

  if (note) parts.push(note);

  return parts.join('\n\n');
}

// Sama kayak buildCard, tapi buat ROWS YANG BANYAK - dipecah jadi
// BEBERAPA pesan HTML kalau tabelnya kepanjangan (biar aman dari limit
// ~4096 karakter Telegram DAN biar tag <pre> gak ke-motong di tengah,
// yang bakal bikin Telegram nolak parse HTML-nya). Header tabel
// diulang di tiap pesan lanjutan biar tetep jelas kolomnya, judul cuma
// nongol di pesan pertama (dikasih tanda "(lanjutan)" di pesan
// berikutnya), catatan (note) cuma nongol di pesan TERAKHIR.
// Balikin ARRAY of string HTML - kirim satu-satu pake message.edit
// (buat yang pertama) + client.sendMessage (buat sisanya).
function buildCardChunks({ title, subtitle, headers, rows, note, maxLen = 3500 }) {
  if (!headers || !rows || rows.length === 0) {
    return [buildCard({ title, subtitle, note })];
  }

  const escapedHeaders = headers.map((h) => escapeHtml(h));
  const escapedRows = rows.map((r) => r.map((c) => escapeHtml(c)));
  const colWidths = escapedHeaders.map((_, i) =>
    Math.max(...[escapedHeaders, ...escapedRows].map((r) => String(r[i] ?? '').length))
  );

  const renderRow = (r) =>
    '│ ' + r.map((cell, i) => padCell(cell, colWidths[i])).join(' │ ') + ' │';
  const borderLine = (left, mid, right) =>
    left + colWidths.map((w) => '─'.repeat(w + 2)).join(mid) + right;

  const topBorder = borderLine('┌', '┬', '┐');
  const headerLine = renderRow(escapedHeaders);
  const headerSeparator = borderLine('├', '┼', '┤');
  const bottomBorder = borderLine('└', '┴', '┘');
  const bodyLines = escapedRows.map(renderRow);

  const bodyChunks = [];
  let current = [];
  let currentLen = topBorder.length + headerLine.length + headerSeparator.length + bottomBorder.length;

  for (const line of bodyLines) {
    if (currentLen + line.length + 1 > maxLen && current.length) {
      bodyChunks.push(current);
      current = [];
      currentLen = topBorder.length + headerLine.length + headerSeparator.length + bottomBorder.length;
    }
    current.push(line);
    currentLen += line.length + 1;
  }
  if (current.length) bodyChunks.push(current);

  return bodyChunks.map((chunkLines, i) => {
    const tableText = [topBorder, headerLine, headerSeparator, ...chunkLines, bottomBorder].join('\n');
    const parts = [];

    if (i === 0) {
      if (title) parts.push(`<b>${title}</b>`);
      if (subtitle) parts.push(subtitle);
    } else if (title) {
      parts.push(`<b>${title} (lanjutan)</b>`);
    }

    parts.push(`<pre>${tableText}</pre>`);

    if (i === bodyChunks.length - 1 && note) parts.push(note);

    return parts.join('\n\n');
  });
}

export { buildCard, buildCardChunks, buildTableText, escapeHtml };
