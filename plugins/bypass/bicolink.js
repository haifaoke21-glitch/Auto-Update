import { makeBypassPlugin } from "../../src/lib/bypassApi.js";

export default makeBypassPlugin({
  command: ["bicolink"],
  endpoint: "bicolink",
  label: "Bicolink",
  example: "https://bicolink.com/xxxx",
  provider: "theresav",
});
