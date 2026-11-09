import { addWorker, listWorkers, removeWorker, verifyWorker } from "../../src/lib/buildmenu/github.js";
import { escH } from "../../src/lib/util.js";

// Kelola worker GitHub Actions untuk Build APK (tombol Build Menu di /start). Khusus owner, chat pribadi (token jangan di grup).
const REPO_RE = /^[\w.-]+\/[\w.-]+$/;

export default {
  command: ["addworkergithub", "listworkergithub", "removeworkergithub"],
  category: "owner",
  description:
    "Kelola worker GitHub Actions untuk Build APK. /addworkergithub owner/repo <token> [workflow_flutter] [workflow_native] • /listworkergithub • /removeworkergithub <no>",
  ownerOnly: true,
  privateOnly: true,
  loading: false,
  run: async (ctx, { args }) => {
    const cmd = (ctx.message?.text || "").trim().replace(/^[^\w]/, "").split(/\s+/)[0].split("@")[0].toLowerCase();
    const html = (t) => ctx.reply(t, { parse_mode: "HTML" });

    if (cmd === "listworkergithub") {
      const list = listWorkers();
      if (!list.length) return html("📭 Belum ada worker GitHub.\nTambah: <code>/addworkergithub owner/repo ghp_token</code>");
      return html(
        `<b>Worker GitHub (${list.length})</b>\n\n` +
          list.map((w, i) => `${i + 1}. <code>${escH(w.repo)}</code> — ${escH(w.label)} ${w.enabled === false ? "🔴 nonaktif" : "🟢 aktif"}\n   workflow: <code>${escH(w.workflows?.flutter || "-")}</code>${w.workflows?.native ? ` • native: <code>${escH(w.workflows.native)}</code>` : ""}`).join("\n")
      );
    }

    if (cmd === "removeworkergithub") {
      if (!args[0]) return html("Contoh: <code>/removeworkergithub 1</code> (nomor dari /listworkergithub)");
      const gone = removeWorker(args[0]);
      return html(gone ? `🗑️ Worker <code>${escH(gone.repo)}</code> dihapus.` : "❌ Worker tidak ditemukan.");
    }

    // addworkergithub
    const [repo, token, workflowFlutter, workflowNative] = args;
    // pesan berisi token langsung dihapus dari chat
    ctx.deleteMessage().catch(() => {});
    if (!repo || !token || !REPO_RE.test(repo)) {
      return html(
        "Cara pakai:\n<code>/addworkergithub owner/repo ghp_token [workflow_flutter] [workflow_native]</code>\n\n" +
          "• Token: GitHub Personal Access Token dengan izin <b>repo</b> + <b>workflow</b>\n" +
          "• Repo harus berisi workflow <code>build-flutter.yml</code> (lihat <code>data/build/PATCH_build-flutter.md</code>)\n" +
          "• workflow_native opsional (kosong = engine native memakai workflow Flutter)"
      );
    }
    let info;
    try {
      info = await verifyWorker({ repo, token });
    } catch (e) {
      return html(`❌ ${escH(e.message)}`);
    }
    const w = addWorker({ repo, token, workflowFlutter, workflowNative, addedBy: ctx.from.id });
    return html(
      `✅ Worker ditambahkan: <code>${escH(w.repo)}</code>\nBranch: <code>${escH(info.branch)}</code> • ${info.private ? "private" : "public"}` +
        (info.canPush ? "" : "\n⚠️ Token tampaknya tidak punya izin tulis ke repo ini — build akan gagal.") +
        "\n\n<i>Pesan berisi token sudah dihapus dari chat.</i>"
    );
  },
};
