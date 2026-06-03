"use strict";

module.exports = function immediateShim(task) {
  setTimeout(task, 0);
};
