import { makeBypassPlugin, dualRoutes } from "../../src/lib/bypassApi.js";

// 2 API: kyzzz /sfl (utama) lalu theresav /sfl (cadangan)
export default makeBypassPlugin({
  command: ["sfl"],
  endpoint: "sfl",
  label: "SFL",
  example: "https://sfl.gl/xxxx",
  routes: dualRoutes("sfl"),
});
