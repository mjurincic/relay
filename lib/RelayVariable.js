/**
 * Copyright (c) 2013-present, Facebook, Inc.
 * All rights reserved.
 *
 * This source code is licensed under the BSD-style license found in the
 * LICENSE file in the root directory of this source tree. An additional grant
 * of patent rights can be found in the PATENTS file in the same directory.
 *
 * @providesModule RelayVariable
 * @typechecks
 * 
 */

'use strict';

var _classCallCheck = require('babel-runtime/helpers/class-call-check')['default'];

var RelayVariable = (function () {
  function RelayVariable(name) {
    _classCallCheck(this, RelayVariable);

    this.name = name;
  }

  RelayVariable.prototype.getName = function getName() {
    return this.name;
  };

  return RelayVariable;
})();

module.exports = RelayVariable;