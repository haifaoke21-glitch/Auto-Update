# AzmiStecu-MD

Bot **Telegram** serba bisa berbasis Node.js dan [Telegraf](https://telegraf.js.org).

---

## Info Developer

| | |
|---|---|
| **Nama developer** | AzmiStecu |
| **Username** | [@AboutAzmii](https://t.me/AboutAzmii) |
| **Tanggal dibuat** | 21 September 2026 |
| **Terakhir update** | 19 Oktober 2026 |

---

## Donasi ke Developer

Script ini gratis. Kalau terbantu dan ingin mendukung pengembangannya, donasi bisa dikirim ke:

| | |
|---|---|
| **Dana** | `081928403904` |
| **Atas nama** | MUHAMMAD AZMI NF |

> Buat yang sudah donasi, terima kasih banyak atas dukungannya. Semoga ke depannya dilancarkan rezekinya, amin.

---

## Tentang Script

**AzmiStecu-MD** adalah script bot Telegram multifungsi. Cukup isi token dari [@BotFather](https://t.me/BotFather) dan ID owner di `config.js`, lalu bot siap dipakai di chat pribadi maupun grup. Kegunaannya:

**Moderasi grup**
- Kick, ban, mute (permanen atau berdurasi), warn dengan auto-kick, promote dan demote.
- Welcome dan goodbye berformat (tebal, kutipan, spoiler, tombol, Rich Message).
- Perlindungan grup: **anti link**, **anti promosi**, **anti forward**, dan **anti bot** (mengeluarkan bot yang ditambahkan member biasa).
- Balasan otomatis per kata kunci (`/filter`), sematkan pesan (`/pinchat`), tagall, link undangan pribadi (`/getlink`), dan pembersihan akun terhapus (`/zombies`).

**Force Subscribe per grup** (admin grup, tiap grup punya pengaturan sendiri)
- `/setfsub 1 @channel` memasang channel wajib di slot 1–5 (channel privat: `/setfsub 2 -100xxxx https://t.me/+link`), `/delfsub 1` atau `/delfsub all` menghapus, `/listfsub` melihat daftar (semua member bisa).
- `/fsub on|off` menyalakan/mematikan, `/fsub mode once|strict|soft` memilih mode:
  - **once**: verifikasi sekali saja (setelah lolos tidak dicek lagi).
  - **strict**: wajib subscribe terus; belum join / keluar channel = pesan dihapus + member dimute sampai join lagi lalu tekan **Saya Sudah Join**.
  - **soft**: pesan dihapus tanpa mute.
- `/reload` refresh cache admin & hasil cek join, `/checkfsub` diagnostik real-time (izin bot, akses channel, cache; balas pesan member untuk cek status join-nya).
- `/settings` melihat pengaturan grup + tombol **Force Subscribe** (panel on/off, ganti mode, reload, diagnostik).
- Syarat: bot admin di grup (izin Hapus pesan; mode strict juga Blokir pengguna) dan admin di setiap channel wajib. Admin grup & owner bot dikecualikan.

**Download dan pencarian**
- TikTok, YouTube, Instagram, Facebook, MediaFire, Pinterest, GitHub, dan musik.
- Pencarian YouTube, npm, Wikipedia, dan jadwal sholat (`/jadwalsholat <kota>`, tampil sebagai Rich Message).
- **Pengingat sholat otomatis**: `/autosholat on <kota>` (khusus owner) mengaktifkan pengingat tiap masuk waktu Subuh, Dzuhur, Ashar, Maghrib, dan Isya di SEMUA user dan grup; `/autosholat off` mematikannya di semua.
- **Lock all / Unlock all** (admin grup): `/lockall` menutup grup (hanya admin yang bisa kirim pesan), `/lockall 30m` menutup dengan timer (30s, 10m, 2h, 1d, 1w) lalu dibuka otomatis, `/unlockall` membuka kembali dengan izin grup seperti semula. Bot harus admin dengan izin Blokir pengguna.

**AI**
- Tanya jawab, buat gambar (`/imagine`), dan ringkas teks.

**Build Menu** (tombol **Build Menu** di `/start`, chat pribadi, bot utama saja)
- **Build APK**: kirim ZIP project **Flutter** atau **Android native (Gradle)** → pilih Debug/Release (+ Kencang/Low Device untuk Flutter) → APK dibuild di GitHub Actions lalu dikirim ke chat. Bila gagal, log error + nomor baris dikirim sebagai file.
- **Rename** (tombol: Rename All, Domain/URL, Ikon, Warna, Nama App): kirim ZIP project Flutter → ganti **domain/URL**, **warna**, **icon** atau **nama aplikasi**, hasilnya dikirim sebagai ZIP baru yang siap di-build.
- Biaya koin di `config.js` → `buildMenu` (owner gratis). Butuh minimal 1 worker GitHub: `/addworkergithub owner/repo <token>` (owner, chat pribadi), `/listworkergithub`, `/removeworkergithub <no>`. Setup workflow repo worker: `data/build/PATCH_build-flutter.md` + `data/build/build-profile.sh`.
- Paket tambahan: `adm-zip` (jalankan `npm install` setelah update).
- **File besar (GramJS/MTProto)**: isi `mtproto.apiId` & `mtproto.apiHash` di `config.js` (atau env `API_ID`, `API_HASH`; buat di https://my.telegram.org). Dengan itu bot bisa kirim file sampai `network.maxSendMB` (500 MB) dan terima ZIP sampai `buildMenu.maxBuildMB` (100 MB) di chat pribadi, tanpa Local Bot API Server. Tanpa itu, batasnya kembali ke Bot API: kirim 49 MB, unduh 20 MB. Paket tambahan: `telegram`, `big-integer` (jalankan `npm install`).

**Hiburan**
- Game tebak-tebakan dan quiz (`/tebakkata`, `/family100`, `/kuismath`, dll).
- **Suit** (`/suit`): lawan bot lewat tombol, atau reply teman untuk duel best-of-3 dengan pilihan rahasia.
- **Tic Tac Toe** (`/tictactoe` atau `/ttt`): buka lobi (teman bergabung lewat tombol), reply teman untuk menantang, atau `/tictactoe bot` untuk lawan bot. Ada tombol Menyerah dan Main Lagi.
- Pemenang mendapat koin; bisa diatur lewat konstanta `REWARD_*` di bagian atas tiap file `plugins/game/*.js`.
- Canvas (brat, quote, kalender) dan pembuat sticker.

**Tools harian**
- Kalkulator, cuaca, QR code, translate, short link, screenshot web, upload ke URL, dan text to speech.
- **`/cekerror`** — cek syntax error file `.js` / teks kode (CommonJS & ES Module, tanpa menjalankan kode, gratis).
- **`/fixerror`** — perbaiki syntax error otomatis memakai AI, hasilnya dikirim sebagai file `fixed_*.js`. Reply file/teks kode, atau kirim file dengan caption perintah.

**Bisnis panel dan VPS**
- Buat panel Pterodactyl (1–10GB atau Unlimited), kelola server, dan atur role reseller atau premium.
- Buat dan kelola VPS DigitalOcean, serta install panel otomatis.

**Fitur owner**
- Broadcast, blacklist, ban user, backup database, dan restart bot.
- **Jadi Bot**: user Premium bisa menjalankan salinan bot dengan token BotFather sendiri.

**Tampilan**
- Pesan memakai **Rich Message** (kartu, tabel, kutipan, spoiler) dan **emoji premium** (`<tg-emoji>`). Emoji premium tampil jika pemilik bot punya Telegram Premium, selain itu otomatis menjadi emoji biasa.

---

## Menjalankan

```bash
npm install
npm start
```

Butuh **Node.js 18+** atau lebih baru (Node 18, 20, 22 didukung). Isi `botToken` dan `ownerIds` di `config.js` sebelum menjalankan bot.
