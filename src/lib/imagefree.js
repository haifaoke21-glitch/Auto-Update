import axios from "axios";
import config from "../../config.js";

const UA = "Mozilla/5.0 (Linux; Android 10; K) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/139.0.0.0 Mobile Safari/537.36";
const DEFAULTS = {
  apiUrl: "https://imagefree.org/api/image.php",
  siteUrl: "https://imagefree.org/",
  siteKey: "0x4AAAAAAB_58B_Bds-jVf2h",
  solverApi: "https://api.ikyyxd.my.id/bypass/turnstile-cf-min",
  width: 1024,
  height: 1024,
  timeoutSec: 180,
  intervalSec: 5,
};
const cfg = () => ({ ...DEFAULTS, ...Object.fromEntries(Object.entries(config.imagine || {}).filter(([, v]) => v !== "" && v != null)) });

/** /imagine aktif selama imagine.apiUrl tidak dikosongkan di config.js */
export const imagineReady = () => config.imagine?.apiUrl !== "";

const snippet = (v, n = 220) => { try { const t = typeof v === "string" ? v : JSON.stringify(v); return t.length > n ? t.slice(0, n) + "…" : t; } catch { return String(v); } };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function getTurnstileToken(c) {
  const res = await axios.get(c.solverApi, { params: { url: c.siteUrl, sitekey: c.siteKey }, timeout: 90000, validateStatus: () => true });
  const token = res.data?.status && res.data?.result?.token;
  if (!token) throw new Error("Solver captcha gagal mengembalikan token (coba lagi sebentar).");
  return token;
}

const headers = (c) => ({ "User-Agent": UA, Referer: c.siteUrl, Origin: c.siteUrl.replace(/\/+$/, "") });

// Request multipart/form-data memakai FormData bawaan Node (axios menambah boundary otomatis)
async function post(c, fields) {
  const form = new FormData();
  for (const [k, v] of Object.entries(fields)) form.append(k, String(v));
  return axios.post(c.apiUrl, form, { headers: headers(c), timeout: 30000, validateStatus: () => true });
}

/** Buat gambar dari teks. Return { url, taskId }. Dipakai oleh /imagine */
export async function generateImage(prompt) {
  const c = cfg();
  const token = await getTurnstileToken(c);

  const created = await post(c, {
    action: "generate",
    prompt,
    width: c.width,
    height: c.height,
    "cf-turnstile-response": token,
  });
  const task = created.data;
  if (!task?.task_id) {
    console.error("[IMAGINE] create gagal, HTTP", created.status, "body:", snippet(task, 600));
    throw new Error(`Server menolak permintaan (HTTP ${created.status}). Respons: ${snippet(task)}`);
  }

  const deadline = Date.now() + c.timeoutSec * 1000;
  let last;
  while (Date.now() < deadline) {
    await sleep(c.intervalSec * 1000);
    let r;
    try {
      r = (await post(c, { action: "status", task_id: task.task_id, api_node: task.api_node || 1 })).data;
    } catch (err) {
      last = err.message; // gangguan jaringan sesaat -> coba cek lagi
      continue;
    }
    last = r;
    if (r?.status === "completed" && r?.image_url) return { taskId: task.task_id, url: r.image_url };
    if (r?.status === "failed") throw new Error("Gambar gagal dibuat / ditolak server.");
  }
  console.error("[IMAGINE] timeout, status terakhir:", snippet(last, 400));
  throw new Error(`Waktu tunggu habis, coba lagi sebentar. (status terakhir: ${snippet(last, 120)})`);
}
