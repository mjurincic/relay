/**
 * Copyright (c) 2013-present, Facebook, Inc.
 * All rights reserved.
 *
 * This source code is licensed under the BSD-style license found in the
 * LICENSE file in the root directory of this source tree. An additional grant
 * of patent rights can be found in the PATENTS file in the same directory.
 *
 * @providesModule RelayRecord
 * @typechecks
 * 
 */

'use strict';

var _extends = require('babel-runtime/helpers/extends')['default'];

var _Object$keys = require('babel-runtime/core-js/object/keys')['default'];

Object.defineProperty(exports, '__esModule', {
  value: true
});

var MetadataKey = {
  DATA_ID: '__dataID__',
  FILTER_CALLS: '__filterCalls__',
  FORCE_INDEX: '__forceIndex__',
  MUTATION_IDS: '__mutationIDs__',
  PATH: '__path__',
  RANGE: '__range__',
  RESOLVED_DEFERRED_FRAGMENTS: '__resolvedDeferredFragments__',
  RESOLVED_FRAGMENT_MAP: '__resolvedFragmentMap__',
  RESOLVED_FRAGMENT_MAP_GENERATION: '__resolvedFragmentMapGeneration__',
  STATUS: '__status__'
};

var metadataKeyLookup = {};
_Object$keys(MetadataKey).forEach(function (name) {
  metadataKeyLookup[MetadataKey[name]] = true;
});

/**
 * Records are plain objects with special metadata properties.
 */
var RelayRecord = {

  MetadataKey: MetadataKey,

  create: function create(dataID) {
    return { __dataID__: dataID };
  },

  createWithFields: function createWithFields(dataID, fields) {
    return _extends({ __dataID__: dataID }, fields);
  },

  isRecord: function isRecord(maybeRecord) {
    return typeof maybeRecord === 'object' && maybeRecord != null && !Array.isArray(maybeRecord) && typeof maybeRecord.__dataID__ === 'string';
  },

  getRecord: function getRecord(maybeRecord) {
    if (RelayRecord.isRecord(maybeRecord)) {
      return maybeRecord;
    } else {
      return null;
    }
  },

  getDataID: function getDataID(record) {
    return record.__dataID__;
  },

  getDataIDForObject: function getDataIDForObject(maybeRecord) {
    return maybeRecord.__dataID__;
  },

  /**
   * Checks whether the given ID was created on the client, as opposed to an ID
   * that's understood by the server as well.
   */
  isClientID: function isClientID(dataID) {
    return dataID.substring(0, 7) === 'client:';
  },

  isMetadataKey: function isMetadataKey(key) {
    return metadataKeyLookup.hasOwnProperty(key);
  }
};

module.exports = RelayRecord;

/* $FlowIssue(>=0.23.0) #10620219 - After fixing some unsoundness in
 * dictionary types, we've come to realize we need a safer object supertype
 * than Object. */