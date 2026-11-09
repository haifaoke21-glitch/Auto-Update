import { toggleCommand } from "../../src/lib/groupUtil.js";

export default toggleCommand({
  command: ["antibot"],
  key: "antibot",
  title: "Anti Bot",
  description: "Keluarkan otomatis bot lain yang ditambahkan member ke grup (admin boleh menambah bot).",
  onNote: "Bot yang ditambahkan member biasa akan langsung dikeluarkan. Admin grup & owner bot dikecualikan. Pastikan bot admin dengan izin Blokir pengguna (dan Hapus pesan).",
  needs: "can_restrict_members",
  needsLabel: "Blokir pengguna",
});
