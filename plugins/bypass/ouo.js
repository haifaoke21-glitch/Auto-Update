import { makeBypassPlugin, dualRoutes } from "../../src/lib/bypassApi.js";

// 2 API: kyzzz /ouo (utama) lalu theresav /ouo (cadangan)
export default makeBypassPlugin({
  command: ["ouo", "auo"],
  endpoint: "ouo",
  label: "Ouo.io",
  example: "https://ouo.io/xxxx",
  routes: dualRoutes("ouo"),
});
