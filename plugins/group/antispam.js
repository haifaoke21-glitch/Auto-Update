import { toggleCommand } from "../../src/lib/groupUtil.js";

export default toggleCommand({
  command: ["antispam"],
  key: "antispam",
  title: "Anti Spam",
  description: "Hapus spam berdasarkan isi pesan: pesan sama berulang, mention berlebihan, karakter diulang-ulang (3x melanggar = mute 10 menit).",
  onNote: "Pesan spam dihapus, dan member yang melanggar 3x dalam 5 menit dimute 10 menit. Admin & owner dikecualikan. Bot perlu izin Hapus pesan dan Blokir pengguna.",
  needs: "can_restrict_members",
  needsLabel: "Blokir pengguna",
});
