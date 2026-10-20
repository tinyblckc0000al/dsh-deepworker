// dsh-ha-core — client bundle (the shared layer).
//
// ── TWO contracts live in this one file. Read both before editing. ──────────────────────────
//
// ① SHARED LIBRARY. One self-registering factory whose id MUST equal the package name, so a
//    consuming plugin can `require("dsh-ha-core")` after declaring it in `dsh.client.external`.
//    No relative imports are possible here (client plugins have no module system).
//
// ② BUNDLE ROW ⇒ THIS FILE IS ALSO A PLUGIN, AND MUST HAVE A PLUGIN'S SHAPE.
//    It is not only required by others: the shell loads it as a bundle row and hands its
//    factory's RETURN VALUE to cordis as the plugin object (app.asar
//    dsh-client-modules/lib/client.js:671-690 materialize → :743-756 import → the vendored
//    Loader's `unwrapExports(...)` → `registry.plugin(o, ...)`). A "shared layer" that exports
//    only its helpers is therefore an *invalid plugin*, and it takes the whole boot down.
//
//    Measured on a real machine, 2026-10-14: adding dsh-ha-core to
//    ~/.dsh/profiles/desktop/package.json's `dsh.profile.bundles` made the App fail to start
//    with, verbatim,
//
//      Error: invalid plugin, expect function or object with an "apply" method, received object
//
//    (crash log ~/Library/Logs/DeepSeek Harness/crash-2026-10-14T01-32-39-811Z-web-boot.log;
//    the host's bootFailed handler that writes it is app.asar lib/main.js:11573). The cause was
//    exactly this file: `exports.apply` and `exports.inject` were missing, so cordis's
//    `registry.plugin(o)` resolved no apply and threw. Keep them — `apply` may stay empty
//    (this layer has nothing to do at activation), but `inject` must stay an array.
//
//    Guarded by dsh-ha-core/verify/_bundle_row_shape.mjs, whose assertion is executed by both
//    verify_core.mjs and verify_portability.mjs for EVERY local bundle row. Do not delete the
//    two exports below, and do not "clean up" this comment: it is the only thing standing
//    between a future edit and a second failed boot.
window.__ModuleLoader__.load({
  id: "dsh-ha-core",
  factory: function (require) {
    var exports = {};

    /**
     * Compare two session ids tolerantly.
     *
     * Moved here first because it is pure, dependency-free, and already the cause of one
     * silent failure (the host sees `session-<uuid>`, the client may hold the bare uuid).
     * @returns {boolean}
     */
    function sameSessionId(a, b) {
      var x = String(a == null ? "" : a);
      var y = String(b == null ? "" : b);
      if (x === "" || y === "") return false;
      if (x === y) return true;
      return x.replace(/^session-/, "") === y.replace(/^session-/, "");
    }

    // ── ② the bundle-row plugin face (see the header; required for the row to activate) ──────
    // Empty on purpose: this layer is pure data + helpers, it has nothing to do when activated.
    exports.apply = function () {};
    exports.inject = [];

    // ── ① the shared-library face that consumers require() ──────────────────────────────────
    exports.__test = { sameSessionId: sameSessionId };
    exports.sameSessionId = sameSessionId;
    exports.version = "0.1.0";
    return exports;
  }
});
