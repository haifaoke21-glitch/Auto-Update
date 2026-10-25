import { toggleCommand } from "../../src/lib/groupUtil.js";

export default toggleCommand({
  command: ["antifwd"],
  key: "antiforward",
  title: "Anti Forward",
  description: "Hapus otomatis pesan forward dari member.",
  onNote: "Pesan forward dari member akan dihapus (admin dikecualikan). Pastikan bot admin dengan izin hapus pesan.",
  needs: "can_delete_messages",
  needsLabel: "Hapus pesan",
});
