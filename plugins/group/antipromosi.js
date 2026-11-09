import { toggleCommand } from "../../src/lib/groupUtil.js";

export default toggleCommand({
  command: ["antipromo"],
  key: "antipromosi",
  title: "Anti Promosi",
  description: "Hapus otomatis promosi (link undangan, link tersembunyi, kata & domain promosi).",
  onNote: "Pesan promosi dari member akan dihapus (admin dikecualikan), termasuk pesan yang diedit belakangan. Pastikan bot admin dengan izin hapus pesan.",
  needs: "can_delete_messages",
  needsLabel: "Hapus pesan",
});
