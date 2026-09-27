"use strict";

/**
 * The entry point of the single-file build, and nothing else.
 *
 * `src/main.js` starts itself with `if (require.main === module)`, which is
 * true when Node is handed the file and false once esbuild has wrapped it in a
 * bundle. So the bundle needs someone to say `main()` out loud, and this is
 * that someone. It is deliberately the only file in `sea/` that ends up inside
 * the executable: the host's behaviour must not fork between the two builds.
 */

require("../src/main.js").main();
