'use strict';

var Promise = require('fbjs/lib/Promise');

/**
 * Copyright (c) 2013-present, Facebook, Inc.
 * All rights reserved.
 *
 * This source code is licensed under the BSD-style license found in the
 * LICENSE file in the root directory of this source tree. An additional grant
 * of patent rights can be found in the PATENTS file in the same directory.
 *
 * @providesModule RelayNetworkDebug
 * @typechecks
 * 
 */

'use strict';

var Relay = require('./RelayPublic');

var performanceNow = require('fbjs/lib/performanceNow');

var RelayNetworkDebug = {
  init: function init(networkLayer) {
    var initTime = performanceNow();

    var queryCallback = function queryCallback(id, pendingQuery, error, results) {
      var time = performanceNow() - initTime;
      var name = pendingQuery.getDebugName();
      console.timeStamp('← END: Relay query ' + id + ' ' + name);
      console.groupCollapsed('%cRelay query ' + id + ' ' + time / 1000 + ' ' + name, 'color:' + (error ? 'red' : 'black') + ';');
      console.timeEnd(id);
      var query = pendingQuery.getQueryString();
      console.debug('%c%s\n', 'font-size:10px; color:#333; font-family:mplus-2m-regular,menlo,' + 'monospaced;', query);
      error && console.error(error);
      results && console.log(results);
      console.groupEnd();
    };

    var handlePending = function handlePending(pendingQuery) {
      var id = queryID++;
      var name = pendingQuery.getDebugName();
      console.timeStamp('START: Relay query ' + id + ' ' + name + ' →');
      console.time(id);
      pendingQuery.then(function (response) {
        return queryCallback(id, pendingQuery, null, response);
      }, function (error) {
        return queryCallback(id, pendingQuery, error);
      });
    };

    var queryID = 0;
    Relay.injectNetworkLayer({
      sendQueries: function sendQueries(requests) {
        requests.forEach(handlePending);
        return networkLayer.sendQueries(requests);
      },
      sendMutation: function sendMutation(request) {
        handlePending(request);
        return networkLayer.sendMutation(request);
      },
      supports: function supports() {
        return networkLayer.supports.apply(networkLayer, arguments);
      }
    });

    var _fetch = global.fetch;
    global.fetch = function (url, options) {
      for (var _len = arguments.length, args = Array(_len > 2 ? _len - 2 : 0), _key = 2; _key < _len; _key++) {
        args[_key - 2] = arguments[_key];
      }

      var id = queryID++;
      var name = url.split('/')[2];
      console.timeStamp('START: fetch ' + id + ' ' + name + ' →');
      console.time(id);

      var fetchCallback = function fetchCallback(error, results, args1) {
        console.timeStamp('← END: fetch ' + id + ' ' + name);
        console.groupCollapsed('%cfetch ' + id + ' ' + name, 'color:' + (error ? 'red' : 'black') + ';');
        console.timeEnd(id);
        console.debug({ url: url, options: options, args: args, args1: args1 });
        error && console.error(error);
        results && console.warn(results);
        try {
          results && console.debug(JSON.parse(results._bodyText));
        } catch (e) {}
        console.groupEnd();
      };

      return _fetch.apply(undefined, [url, options].concat(args)).then(function (results) {
        for (var _len2 = arguments.length, args1 = Array(_len2 > 1 ? _len2 - 1 : 0), _key2 = 1; _key2 < _len2; _key2++) {
          args1[_key2 - 1] = arguments[_key2];
        }

        fetchCallback(null, results, args1);
        return results;
      }, function (error) {
        for (var _len3 = arguments.length, args1 = Array(_len3 > 1 ? _len3 - 1 : 0), _key3 = 1; _key3 < _len3; _key3++) {
          args1[_key3 - 1] = arguments[_key3];
        }

        fetchCallback(error, undefined, args1);
        return error;
      });
    };
  }
};

module.exports = RelayNetworkDebug;