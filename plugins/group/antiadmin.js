import { toggleCommand } from "../../src/lib/groupUtil.js";

export default toggleCommand({
  command: ["antiadmin"],
  key: "antiadmin",
  title: "Anti Admin",
  description: "Hapus otomatis pesan member yang me-mention/menandai admin (@admin atau @username admin).",
  onNote: "Pesan member biasa yang menandai admin akan dihapus (admin & owner dikecualikan). Pastikan bot admin dengan izin hapus pesan.",
  needs: "can_delete_messages",
  needsLabel: "Hapus pesan",
});
