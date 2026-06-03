"use strict";

(function installSafeSetImmediate(root) {
  if (!root) return;

  if (typeof root.setImmediate !== "function") {
    root.setImmediate = function setImmediateShim(handler) {
      var args = Array.prototype.slice.call(arguments, 1);
      return root.setTimeout(function runSetImmediateShim() {
        handler.apply(root, args);
      }, 0);
    };
  }

  if (typeof root.clearImmediate !== "function") {
    root.clearImmediate = function clearImmediateShim(handle) {
      root.clearTimeout(handle);
    };
  }
}(typeof globalThis !== "undefined" ? globalThis : typeof self !== "undefined" ? self : typeof global !== "undefined" ? global : this));

module.exports = {};
