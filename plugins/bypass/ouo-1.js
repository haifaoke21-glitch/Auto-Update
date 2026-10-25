import { makeBypassPlugin, dualRoutes } from "../../src/lib/bypassApi.js";

// 2 API: kyzzz /ouo (utama) lalu theresav /ouo (cadangan)
export default makeBypassPlugin({
  command: ["ouoio", "auoio"],
  endpoint: "ouo",
  label: "Ouo.io",
  example: "https://ouo.io/xxxx",
  routes: dualRoutes("ouo"),
});
