Folder egg Pterodactyl untuk fitur Install Panel.

Satu file .json = satu egg (format sederhana bot, bukan format export panel).
Dipakai lewat pilihan "Node.js / Python / Keduanya" di wizard Install Panel.

Kunci pilihan (nodejs, python) dipetakan di src/lib/installPanel.js -> EGG_CHOICES.
Mau ubah isi egg (startup, docker image, variabel)? Edit file .json-nya lalu restart bot.
bedrock.json dan golang.json tersedia tapi tidak dipakai kecuali ditambahkan ke EGG_CHOICES.
