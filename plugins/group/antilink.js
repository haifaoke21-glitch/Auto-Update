import { toggleCommand } from "../../src/lib/groupUtil.js";

export default toggleCommand({
  command: ["antilink"],
  key: "antilink",
  title: "Anti Link",
  description: "Hapus otomatis link undangan grup/channel (t.me, WhatsApp, Discord) dari member.",
  onNote: "Link undangan dari member akan dihapus (admin dikecualikan). Pastikan bot admin dengan izin hapus pesan.",
  needs: "can_delete_messages",
  needsLabel: "Hapus pesan",
});
