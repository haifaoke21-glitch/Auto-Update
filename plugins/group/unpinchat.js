import { requireBotRight, card, friendlyError } from "../../src/lib/groupUtil.js";
import { E } from "../../src/lib/emo.js";

export default {
  command: ["unpinchat"],
  category: "group",
  description: "Lepas pin pesan. Balas pesan yang disematkan untuk melepas yang itu, tanpa balas untuk melepas pin terbaru, atau '/unpinchat all' untuk semua. Contoh: /unpinchat",
  adminOnly: true,
  groupOnly: true,
  run: async (ctx, { args }) => {
    if (!(await requireBotRight(ctx, "can_pin_messages", "Sematkan pesan"))) return;

    try {
      if (args[0]?.toLowerCase() === "all" || args[0]?.toLowerCase() === "semua") {
        await ctx.telegram.unpinAllChatMessages(ctx.chat.id);
        return card(ctx, E.ok, "Pin dilepas", "Semua pin di grup dilepas.");
      }
      const target = ctx.message?.reply_to_message;
      await ctx.telegram.unpinChatMessage(ctx.chat.id, target?.message_id);
      await card(ctx, E.ok, "Pin dilepas", target ? "Pin pesan itu dilepas." : "Pin terbaru dilepas.");
    } catch (err) {
      await card(ctx, E.no, "Gagal melepas pin", friendlyError(err, "melepas pin"));
    }
  },
};
