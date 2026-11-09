// Helper kirim / edit Rich Message Telegram (Bot API 10.1+) dengan fallback HTML biasa.
// view = { rich: "<h2>..</h2>...", legacy: "<b>..</b>..." }
let richDisabled = false; // jadi true hanya kalau server tidak mengenal method rich sama sekali

const noMethod = (e) => /not found|unknown method/i.test(e?.message || "");
const notModified = (e) => /message is not modified/i.test(e?.message || "");

export const h = (s = "") => String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

export const simpleView = (text) => ({ rich: `<p>${text}</p>`, legacy: text });

export const richTable = (head, rows) =>
  `<table bordered striped><tr>${head.map((x) => `<th>${x}</th>`).join("")}</tr>` +
  rows.map((r) => `<tr>${r.map((x) => `<td>${x}</td>`).join("")}</tr>`).join("") +
  `</table>`;

/** extra: { reply_markup, reply_parameters, message_thread_id } */
export async function sendRich(telegram, chatId, view, extra = {}) {
  if (!richDisabled) {
    try {
      return await telegram.callApi("sendRichMessage", { chat_id: chatId, rich_message: { html: view.rich }, ...extra });
    } catch (e) {
      if (/forbidden|blocked|chat not found|can't initiate/i.test(e?.message || "")) throw e; // tidak ada gunanya coba cadangan
      if (noMethod(e)) richDisabled = true;
      else console.error("[RICH] send:", e.message);
    }
  }
  const { reply_parameters, ...rest } = extra;
  return telegram.sendMessage(chatId, view.legacy, { parse_mode: "HTML", link_preview_options: { is_disabled: true }, ...(reply_parameters ? { reply_parameters } : {}), ...rest });
}

/** reply_markup dikosongkan bila tidak diisi (tombol hilang) */
export async function editRich(telegram, chatId, messageId, view, reply_markup) {
  if (!richDisabled) {
    try {
      await telegram.callApi("editMessageText", {
        chat_id: chatId,
        message_id: messageId,
        rich_message: { html: view.rich },
        ...(reply_markup ? { reply_markup } : {}),
      });
      return;
    } catch (e) {
      if (notModified(e)) return;
      if (noMethod(e)) richDisabled = true;
      else console.error("[RICH] edit:", e.message);
    }
  }
  try {
    await telegram.editMessageText(chatId, messageId, undefined, view.legacy, { parse_mode: "HTML", link_preview_options: { is_disabled: true }, reply_markup });
  } catch (e) {
    if (!notModified(e)) console.error("[RICH] edit legacy:", e.message);
  }
}
