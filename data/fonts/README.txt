Font di folder ini dimuat otomatis saat bot start (rekursif; .ttf .otf .ttc .woff .woff2).
Dipakai oleh /qc dan /brat:
 - sebagai fallback otomatis kalau ada karakter yang tidak ada di font utama
 - sebagai pilihan manual: /qc font=NamaFont  atau  /brat font=NamaFont  (daftar: /qc fonts)

Sudah termasuk:
 - DejaVu Sans (+Bold)       : Latin, Yunani, Cyrillic, Arab, Ibrani, ribuan simbol & panah
 - DejaVu Math TeX Gyre      : huruf fancy unicode (bold/italic/script/fraktur/double-struck), simbol matematika
 - FreeSans (+Bold)          : Devanagari, Bengali, Thai, Tamil, Gujarati, dll

Emoji: digambar sebagai gambar Twemoji (diunduh otomatis ke data/cache/emoji, perlu internet sekali per emoji).

Mandarin / Jepang / Korea: pasang NotoSansCJK-Regular.ttc di folder ini (ada di zip AzmiStecuMD_font_cjk.zip),
lalu restart bot. Font Noto lain: https://fonts.google.com/noto (lisensi OFL).
Lisensi font bawaan: LICENSES.txt
