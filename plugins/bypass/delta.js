import { makeBypassPlugin } from "../../src/lib/bypassApi.js";

export default makeBypassPlugin({
  command: ["delta"],
  endpoint: "delta",
  label: "Delta",
  example: "https://auth.platorelay.com/a?d=xxxx",
  provider: "theresav",
  acceptText: true, // Delta mengembalikan KEY (teks), bukan link
  routes: () => [
    { endpoint: "delta", provider: "theresav" },
    { endpoint: "universal", provider: "theresav" },
  ],
});
