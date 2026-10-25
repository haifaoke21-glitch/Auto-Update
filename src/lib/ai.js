import axios from "axios";
import config from "../../config.js";

export const aiReady = () => Boolean(config.ai.apiKey);

const headers = () => ({ Authorization: `Bearer ${config.ai.apiKey}`, "Content-Type": "application/json" });

export async function chat(messages, { model = config.ai.model, temperature = 0.7, maxTokens, apiKey, baseUrl } = {}) {
  const { data } = await axios.post(
    `${(baseUrl || config.ai.baseUrl).replace(/\/$/, "")}/chat/completions`,
    { model, messages, temperature, ...(maxTokens ? { max_tokens: maxTokens } : {}) },
    { headers: apiKey ? { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" } : headers(), timeout: 90000 }
  );
  return data?.choices?.[0]?.message?.content?.trim() || "(tidak ada jawaban)";
}

// Memori percakapan singkat per chat+user (in-memory)
const memory = new Map();
export function getMemory(key) {
  return memory.get(key) || [];
}
export function pushMemory(key, role, content) {
  const list = memory.get(key) || [];
  list.push({ role, content });
  memory.set(key, list.slice(-8));
}
export const resetMemory = (key) => memory.delete(key);