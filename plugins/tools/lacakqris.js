import sharp from "sharp";
import jsQR from "jsqr";
import { escH, getMediaBuffer } from "../../src/lib/util.js";
import { sendRich, richTable } from "../../src/lib/rich.js";
import { parseQris, locateMerchant, criteriaLabel, formatAddress } from "../../src/lib/qris.js";
import config from "../../config.js";

const h = escH;
const dash = (v) => (v === undefined || v === null || v === "" ? "-" : v);

// MCC mapping lebih lengkap (umum untuk merchant Indonesia)
const MCC_MAP = {
  // Makanan & Minuman
  "5811": "Catering",
  "5812": "Restoran",
  "5813": "Bar / Tempat Minum",
  "5814": "Restoran Cepat Saji / Fast Food",
  "5462": "Toko Roti / Bakery",
  "5441": "Toko Permen & Kue",
  "5451": "Toko Susu & Produk Susu",
  "5422": "Penjual Daging",

  // Toko & Ritel
  "5411": "Supermarket / Toko Kelontong Besar",
  "5499": "Toko Kelontong / Convenience Store",
  "5311": "Department Store",
  "5310": "Toko Diskon",
  "5331": "Toko Serba Ada / Variety Store",
  "5399": "Merchandise Umum",
  "5651": "Toko Pakaian",
  "5661": "Toko Sepatu",
  "5691": "Toko Pakaian Pria & Wanita",
  "5942": "Toko Buku",
  "5943": "Toko Alat Tulis & Kantor",
  "5944": "Toko Perhiasan",
  "5945": "Toko Mainan & Hobi",
  "5947": "Toko Hadiah & Suvenir",
  "5948": "Toko Tas & Koper",
  "5977": "Toko Kosmetik",
  "5999": "Ritel Khusus / Miscellaneous",

  // Elektronik & Komputer
  "5732": "Toko Elektronik",
  "5734": "Toko Software / Aplikasi",
  "5045": "Toko Komputer & Perangkat",

  // Kesehatan
  "5912": "Apotek",
  "8011": "Dokter / Klinik",
  "8021": "Dokter Gigi",
  "8042": "Optik",
  "8062": "Rumah Sakit",
  "8099": "Layanan Kesehatan Lainnya",

  // Transportasi & Bahan Bakar
  "5541": "SPBU",
  "5542": "Mesin Pompa Bensin Otomatis",
  "4121": "Taksi / Ojek Online",
  "4111": "Transportasi Lokal",

  // Akomodasi & Layanan
  "7011": "Hotel / Penginapan",
  "7230": "Salon / Barbershop",
  "7221": "Studio Foto",
  "7299": "Jasa Pribadi Lainnya",
  "7538": "Bengkel / Service Kendaraan",
  "5712": "Toko Perabot Rumah",
  "5722": "Toko Elektronik Rumah Tangga",

  // Lainnya yang sering
  "4722": "Agen Perjalanan",
  "5941": "Toko Olahraga",
  "5995": "Toko Hewan Peliharaan",
  "5992": "Toko Bunga",
  "5921": "Toko Minuman Beralkohol",
  "5122": "Obat-obatan (Wholesale)",
  "7399": "Jasa Bisnis Lainnya",
  "8999": "Jasa Profesional Lainnya",
};

const COUNTRY_MAP = { ID: "Indonesia", SG: "Singapura", MY: "Malaysia", TH: "Thailand", JP: "Jepang", KR: "Korea Selatan", CN: "Tiongkok" };

function mccLabel(mcc) {
  return MCC_MAP[mcc] || (mcc ? `MCC ${mcc}` : "-");
}

function countryName(code) {
  return COUNTRY_MAP[code] || code || "-";
}

// ---------- Baca QR dari foto (beberapa varian pengolahan gambar) ----------
async function decodeQrFromImage(buf) {
  const variants = [
    (s) => s,
    (s) => s.greyscale().normalise(),
    (s) => s.greyscale().normalise().sharpen(),
    (s) => s.greyscale().threshold(128),
    (s) => s.greyscale().normalise().linear(1.4, -40),
  ];
  for (const size of [1000, 1600, 700, 2200]) {
    for (const v of variants) {
      try {
        const { data, info } = await v(sharp(buf).rotate().resize({ width: size, height: size, fit: "inside" }).flatten({ background: "#ffffff" }))
          .ensureAlpha().raw().toBuffer({ resolveWithObject: true });
        const code = jsQR(new Uint8ClampedArray(data), info.width, info.height, { inversionAttempts: "attemptBoth" });
        if (code?.data) return code.data;
      } catch { /* coba varian berikutnya */ }
    }
  }
  return null;
}

function googleStaticSatUrl(lat, lon, key) {
  if (!key) return null;
  const center = `${lat},${lon}`;
  return `https://maps.googleapis.com/maps/api/staticmap?center=${center}&zoom=18&size=600x400&maptype=satellite&markers=color:red%7C${center}&key=${encodeURIComponent(key)}`;
}

function mapsLink(lat, lon) {
  return `https://www.google.com/maps/search/?api=1&query=${lat},${lon}`;
}

function satelliteViewLink(lat, lon) {
  return `https://www.google.com/maps/@${lat},${lon},18z/data=!3m1!1e3`;
}

function streetViewLink(lat, lon) {
  return `https://www.google.com/maps/@?api=1&map_action=pano&viewpoint=${lat},${lon}`;
}

function osmLink(lat, lon) {
  return `https://www.openstreetmap.org/?mlat=${lat}&mlon=${lon}#map=18/${lat}/${lon}`;
}

function directionsLink(lat, lon) {
  return `https://www.google.com/maps/dir/?api=1&destination=${lat},${lon}`;
}

function diagLine(diag) {
  const f = diag?.fail || [];
  return f.length ? `Sumber data yang gagal diakses: ${f.join("; ")}. Hasil bisa kurang akurat — coba ulang sebentar lagi.` : "";
}

function buildView(q, loc, diag) {
  const P = loc?.parts || {};
  const jenisQR = q.dynamic ? `Dinamis${q.amount ? ` · Rp ${Number(q.amount).toLocaleString("id-ID")}` : ""}` : "Statis";
  const kategori = mccLabel(q.mcc);
  const klasifikasi = criteriaLabel(q.criteria);
  const negaraAsal = q.guid ? (q.guid.includes("QRIS") || q.guid.startsWith("ID.") ? "Indonesia (QRIS)" : h(q.guid)) : "Tidak diketahui";
  const buktiNegara = `${h(dash(q.country))} (${countryName(q.country)})`;

  const merchantRows = [
    ["Nama", `<b>${h(dash(q.name))}</b>`],
    ["Jenis QR", jenisQR],
    ["Kategori Merchant", h(kategori)],
    ["Klasifikasi", h(klasifikasi)],
    ["Negara Asal Jaringan Pembayaran", negaraAsal],
    ["Bukti Negara", buktiNegara],
    ["Kota / Kode pos (QR)", `${h(dash(q.city))}${q.cityValid === false ? " <i>(kode dari PJP, bukan nama kota)</i>" : ""} / ${h(dash(q.postal))}`],
    ["NMID", q.nmid ? `<code>${h(q.nmid)}</code>` : "-"],
    ["MCC", h(dash(q.mcc))],
    ["Penyedia (PJP)", q.guid ? `<b>${h(dash(q.acquirer))}</b> · <code>${h(q.guid)}</code>` : "-"],
    ...(q.pjpMerchantId ? [["ID merchant di PJP", `<code>${h(q.pjpMerchantId)}</code> <i>(bukan NMID)</i>`]] : []),
    ["Integritas (CRC)", q.crcOk ? "✅ Valid" : "⚠️ Tidak valid — QR mungkin diubah"],
  ];

  if (!loc) {
    const msg = `Lokasi tidak ditemukan. Penyebab umum: usaha belum terdaftar di peta publik atau nama pada QRIS tidak cocok dengan data peta. ${diagLine(diag)}`.trim();
    return {
      rich: `<div><h2>📍 Hasil Lacak QRIS</h2><h3>🏪 Data Merchant</h3>${richTable(["Data", "Isi"], merchantRows)}<blockquote>❌ ${h(msg)}</blockquote></div>`,
      legacy: `📍 <b>Hasil Lacak QRIS</b>\n\n🏪 <b>Data Merchant</b>\n${merchantRows.map(([k, v]) => `• ${k}: ${v}`).join("\n")}\n\n❌ ${h(msg)}`,
    };
  }

  const gmaps = loc.mapsUri || mapsLink(loc.lat, loc.lon);
  const satLink = satelliteViewLink(loc.lat, loc.lon);
  const isArea = loc.level === "area";
  const verifikasi = loc.level === "tinggi" ? "🟢 Tinggi" : loc.level === "sedang" ? "🟡 Sedang" : loc.level === "rendah" ? "🔴 Rendah" : "⚪ Hanya area";
  const statusLokasi = isArea
    ? "Tempat usaha TIDAK ditemukan di wilayah QRIS — yang ditampilkan hanya pusat area"
    : loc.status || (loc.level === "tinggi" ? "Nama, Kab/Kota & kode pos cocok dengan QRIS" : loc.level === "sedang" ? "Perkiraan (akurasi sedang)" : "Perkiraan (akurasi rendah)");
  const rapi = formatAddress(P, q.postal);
  const buktiWilayah = [loc.postalOk ? "kode pos cocok" : null, loc.cityOk ? "kota cocok" : null].filter(Boolean).join(", ");
  const vKota = loc.kotaOk === true ? "✅ cocok" : loc.kotaOk === false ? "⚠️ beda" : q.cityValid === false ? "❔ QRIS tidak memuat nama kota" : "❔ belum terverifikasi";
  const vPos = loc.postalHit ? "✅ cocok" : loc.postalMiss ? "⚠️ beda" : "❔ tidak ada di data peta";
  const verifWilayah = q.cityValid === false
    ? `Kab/Kota ${vKota} → ${h(dash(P.kota))} (diturunkan dari kode pos; QRIS hanya memuat kode PJP "${h(dash(q.city))}") · Kode pos ${vPos} (QRIS ${h(dash(q.postal))})`
    : `Kab/Kota ${vKota} (${h(dash(P.kota))} vs QRIS ${h(dash(q.city))}) · Kode pos ${vPos} (QRIS ${h(dash(q.postal))})`;

  const locRows = [];
  if (!isArea) {
    locRows.push(["Nama di QRIS", `<b>${h(dash(loc.qrisName || q.name))}</b>`]);
    locRows.push(["Nama di peta", `<b>${h(dash(loc.name))}</b>${loc.kind ? ` <i>(${h(loc.kind)})</i>` : ""}`]);
    locRows.push(["Kecocokan nama", `${loc.nameMatch ?? "-"}%${buktiWilayah ? ` · ${h(buktiWilayah)}` : ""}`]);
  } else {
    locRows.push(["Area perkiraan", `<b>${h(dash(loc.name))}</b>`]);
  }
  locRows.push(
    ["Alamat lengkap (rapi)", h(dash(rapi || loc.address))],
    ...(isArea ? [] : [["Alamat dari sumber peta", h(dash(loc.address))]]),
    ["Jalan", isArea ? "Tidak ada di QRIS (hanya kode pos)" : h(dash(P.jalan))],
    ["Kelurahan/Desa", isArea && !P.kelurahan && P.desaDalamKodePos ? `Beberapa desa: ${h(P.desaDalamKodePos.join(", "))}` : `${h(dash(P.kelurahan))}${isArea && P.kelurahan && P.wilayahSumber !== "Data kode pos lokal" ? " <i>(perkiraan)</i>" : ""}`],
    ["Kecamatan", `${h(dash(P.kecamatan))}${P.kecamatanAlt ? ` <i>(sumber lain: ${h(P.kecamatanAlt)})</i>` : ""}`],
    ["Kota / Kabupaten", h(dash(P.kota))],
    ["Verifikasi Kab/Kota & Kode pos", verifWilayah],
    ["Provinsi / Negara Bagian", h(dash(P.provinsi))],
    ["Kode pos", h(dash(P.kodepos || q.postal))],
    ["Koordinat Pin", `<code>${loc.lat.toFixed(6)}, ${loc.lon.toFixed(6)}</code>`],
    ["Tingkat Verifikasi", verifikasi],
    ["Status Lokasi", h(statusLokasi)],
    ["Link Lokasi Google Maps", `<a href="${gmaps}">Buka di Google Maps</a>`],
    ["Status Citra", `<a href="${satLink}">Lihat satelit</a>`],
    ["Sumber tempat", h(loc.source)],
  );
  if (P.wilayahSumber) locRows.push(["Sumber kecamatan/kelurahan", h(P.wilayahSumber)]);
  if (loc.phone) {
    const ph = loc.phone;
    const conf = ph.confidence === "tinggi" ? `✅ ${ph.sources.length} sumber cocok` : "⚠️ 1 sumber saja, cek dulu";
    const wa = ph.mobile ? ` · <a href="https://wa.me/${ph.e164.slice(1)}">WhatsApp</a>` : "";
    locRows.push(["Telepon", `<code>${h(ph.display)}</code> · ${h(ph.e164)}${wa} — ${conf} (${h(ph.sources.join(" + "))})`]);
    if (loc.phoneAlt?.length) locRows.push(["Nomor lain", h(loc.phoneAlt.join("; "))]);
  } else if (!isArea) {
    locRows.push(["Telepon", "Tidak ada di data peta (tidak ditebak)"]);
  }
  if (loc.hours) locRows.push(["Jam buka (OSM)", h(loc.hours)]);
  if (loc.rating) locRows.push(["Rating", `⭐ ${loc.rating}${loc.ratingCount ? ` (${loc.ratingCount} ulasan)` : ""}`]);

  // Kandidat lain (nama mirip) supaya bisa dicek manual — terutama untuk toko berantai / cabang
  (loc.alternatives || []).forEach((a, i) => {
    const tag = a.reason ? ` · ${a.reason}` : a.distKm != null ? ` · ±${a.distKm.toFixed(1)} km dari kode pos` : "";
    locRows.push([`Kandidat lain ${i + 1}`, `${h(dash(a.name))} — ${h(String(a.address || "").slice(0, 90))}${tag} · <a href="${mapsLink(a.lat, a.lon)}">Maps</a>`]);
  });

  const note = isArea
    ? "QRIS tidak memuat alamat jalan maupun koordinat, hanya nama dan kode pos. Tidak ada tempat bernama sama yang terbukti di kode pos ini (usaha rumahan/perorangan umumnya tidak ada di peta publik), jadi yang ditampilkan hanya wilayah kode pos — BUKAN titik rumah/usaha. Satu kode pos bisa mencakup beberapa desa."
    : loc.level === "tinggi"
      ? "QRIS tidak memuat koordinat; lokasi dicocokkan dari nama + Kab/Kota + kode pos QRIS ke data peta publik, bukan posisi real-time pemilik. Nomor telepon hanya diambil dari tempat yang sama dan tidak pernah ditebak."
      : "Akurasi sedang/rendah: nama, Kab/Kota, atau kode pos belum semuanya terbukti cocok dengan QRIS. Cek kandidat lain & bandingkan dengan data merchant sebelum dipercaya.";
  const dl = diagLine(diag || loc.diag);
  const noteFull = dl ? `${note} ${dl}` : note;

  return {
    rich: `<div><h2>📍 Hasil Lacak QRIS</h2><h3>🏪 Data Merchant</h3>${richTable(["Data", "Isi"], merchantRows)}<h3>🗺 Lokasi Terlacak</h3>${richTable(["Data", "Isi"], locRows)}<blockquote>${h(noteFull)}</blockquote></div>`,
    legacy: `📍 <b>Hasil Lacak QRIS</b>\n\n🏪 <b>Data Merchant</b>\n${merchantRows.map(([k, v]) => `• ${k}: ${v}`).join("\n")}\n\n🗺 <b>Lokasi Terlacak</b>\n${locRows.map(([k, v]) => `• ${k}: ${v}`).join("\n")}\n\n<i>${h(noteFull)}</i>`,
  };
}

export default {
  command: ["lacakqris", "cekqris"],
  category: "tools",
  description: "Baca QRIS (foto/teks) → data merchant lengkap & alamat (semua tingkat akurasi) + citra satelit + peta interaktif, lalu kirim lokasinya.",
  cooldown: 8000,
  run: async (ctx, { text }) => {
    const arg = String(text || "").trim();
    let payload = /^000201/.test(arg) ? arg : null;
    const replyParams = { reply_parameters: { message_id: ctx.message.message_id, allow_sending_without_reply: true } };
    const thread = ctx.message.is_topic_message && ctx.message.message_thread_id ? { message_thread_id: ctx.message.message_thread_id } : {};
    let status = null;
    const cleanup = () => (status ? ctx.telegram.deleteMessage(ctx.chat.id, status.message_id).catch(() => {}) : null);

    try {
      if (!payload) {
        const buf = await getMediaBuffer(ctx, ["photo", "document"]);
        if (!buf) {
          return ctx.replyWithHTML(
            `📍 <b>Lacak QRIS</b>\n\nKirim / reply <b>foto QRIS</b> dengan caption <code>${h(config.prefix || "/")}lacakqris</code>\natau tempel teksnya: <code>${h(config.prefix || "/")}lacakqris 000201...</code>`
          );
        }
        status = await ctx.reply("🔎 Membaca QRIS...", replyParams).catch(() => null);
        payload = await decodeQrFromImage(buf);
        if (!payload) { await cleanup(); return ctx.reply("❌ QR tidak terbaca. Pakai foto yang tajam, lurus, dan QR memenuhi frame.", replyParams); }
      }

      const q = parseQris(payload);
      if (status) await ctx.telegram.editMessageText(ctx.chat.id, status.message_id, undefined, "📡 Melacak lokasi merchant...").catch(() => {});
      else status = await ctx.reply("📡 Melacak lokasi merchant...", replyParams).catch(() => null);

      const found = await locateMerchant(q);
      // Kirim lokasi untuk semua tingkat akurasi (rendah / sedang / tinggi / area)
      const loc = found && found.lat && found.lon ? found : null;
      const diag = found?.diag;
      await cleanup();

      await sendRich(ctx.telegram, ctx.chat.id, buildView(q, loc, diag), { ...replyParams, ...thread });

      // Lokasi SELALU dikirim otomatis. Level "area" = pusat wilayah kode pos (perkiraan), diberi label jelas
      if (loc) {
        const isAreaPin = loc.level === "area";
        const title = (isAreaPin ? `Perkiraan: ${q.name || "Merchant"}` : String(loc.name || q.name || "Lokasi QRIS")).slice(0, 60);
        const addr = (isAreaPin ? `Pusat wilayah kode pos ${q.postal || ""} (bukan titik usaha) — ` : "") + (String(loc.address || "").slice(0, 160) || "-");
        const levelLabel = isAreaPin ? "area (perkiraan pusat wilayah)" : loc.level;

        // Kirim citra satelit jika key Google tersedia
        const gKey = config?.lacakqris?.googleApiKey || process.env.GOOGLE_PLACES_KEY || "";
        const satUrl = googleStaticSatUrl(loc.lat, loc.lon, gKey);
        if (satUrl) {
          try {
            const res = await fetch(satUrl);
            if (res.ok) {
              const imgBuf = Buffer.from(await res.arrayBuffer());
              await ctx.telegram.sendPhoto(ctx.chat.id, { source: imgBuf }, {
                caption: `🛰️ <b>Citra Satelit</b> — ${h(title)}\nAkurasi: ${levelLabel}`,
                parse_mode: "HTML",
                ...thread,
              }).catch(() => {});
            }
          } catch { /* abaikan jika gagal */ }
        } else {
          await ctx.replyWithHTML(
            `🛰️ <b>Citra Satelit</b>: <a href="${satelliteViewLink(loc.lat, loc.lon)}">Buka tampilan satelit Google Maps</a>\nLokasi: ${h(title)} (akurasi ${levelLabel})`,
            { ...replyParams, ...thread }
          ).catch(() => {});
        }

        // Otomatis kirim lokasi (berlaku untuk rendah, sedang, tinggi)
        const venueMsg = await ctx.telegram.sendVenue(ctx.chat.id, loc.lat, loc.lon, title, addr, thread)
          .catch(() => ctx.telegram.sendLocation(ctx.chat.id, loc.lat, loc.lon, thread));

        // Integrasi peta interaktif: tombol buka peta
        if (venueMsg) {
          const keyboard = {
            inline_keyboard: [
              [
                { text: "🗺 Google Maps", url: mapsLink(loc.lat, loc.lon) },
                { text: "🛰️ Satelit", url: satelliteViewLink(loc.lat, loc.lon) },
              ],
              [
                { text: "🚶 Street View", url: streetViewLink(loc.lat, loc.lon) },
                { text: "🧭 Arahkan", url: directionsLink(loc.lat, loc.lon) },
              ],
              [
                { text: "🌍 OpenStreetMap", url: osmLink(loc.lat, loc.lon) },
              ],
            ],
          };
          await ctx.telegram.editMessageReplyMarkup(ctx.chat.id, venueMsg.message_id, undefined, keyboard).catch(() => {
            // Fallback: kirim pesan terpisah dengan tombol
            ctx.reply("🗺 <b>Peta Interaktif</b>", {
              parse_mode: "HTML",
              reply_markup: keyboard,
              ...replyParams,
              ...thread,
            }).catch(() => {});
          });
        }
      }
    } catch (err) {
      await cleanup();
      console.error("[LACAKQRIS]", err?.message);
      await ctx.reply(`❌ Gagal: ${err.message}`, replyParams).catch(() => {});
    }
  },
};
