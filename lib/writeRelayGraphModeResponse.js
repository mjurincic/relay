/**
 * Copyright (c) 2013-present, Facebook, Inc.
 * All rights reserved.
 *
 * This source code is licensed under the BSD-style license found in the
 * LICENSE file in the root directory of this source tree. An additional grant
 * of patent rights can be found in the PATENTS file in the same directory.
 *
 * @providesModule writeRelayGraphModeResponse
 * 
 * @typechecks
 */

'use strict';

var _classCallCheck = require('babel-runtime/helpers/class-call-check')['default'];

var _extends = require('babel-runtime/helpers/extends')['default'];

var _defineProperty = require('babel-runtime/helpers/define-property')['default'];

var Map = require('fbjs/lib/Map');
var RelayChangeTracker = require('./RelayChangeTracker');
var RelayConnectionInterface = require('./RelayConnectionInterface');
var RelayGraphModeInterface = require('./RelayGraphModeInterface');

var RelayNodeInterface = require('./RelayNodeInterface');
var RelayRecord = require('./RelayRecord');
var RelayRecordState = require('./RelayRecordState');

var forEachObject = require('fbjs/lib/forEachObject');
var generateClientEdgeID = require('./generateClientEdgeID');
var generateClientID = require('./generateClientID');
var invariant = require('fbjs/lib/invariant');
var stableStringify = require('./stableStringify');

var ID = RelayConnectionInterface.ID;
var NODE = RelayConnectionInterface.NODE;
var TYPENAME = RelayNodeInterface.TYPENAME;
var EXISTENT = RelayRecordState.EXISTENT;
var NONEXISTENT = RelayRecordState.NONEXISTENT;
var CACHE_KEY = RelayGraphModeInterface.CACHE_KEY;
var REF_KEY = RelayGraphModeInterface.REF_KEY;
var PUT_EDGES = RelayGraphModeInterface.PUT_EDGES;
var PUT_NODES = RelayGraphModeInterface.PUT_NODES;
var PUT_ROOT = RelayGraphModeInterface.PUT_ROOT;

/**
 * Writes a GraphMode payload into a Relay store.
 */
function writeRelayGraphModeResponse(store, writer, payload, options) {
  var graphWriter = new RelayGraphModeWriter(store, writer, options);
  graphWriter.write(payload);
  return graphWriter.getChangeTracker();
}

var RelayGraphModeWriter = (function () {
  function RelayGraphModeWriter(store, writer, options) {
    _classCallCheck(this, RelayGraphModeWriter);

    this._cacheKeyMap = new Map();
    this._changeTracker = new RelayChangeTracker();
    this._forceIndex = options && options.forceIndex || null;
    this._store = store;
    this._writer = writer;
  }

  RelayGraphModeWriter.prototype.getChangeTracker = function getChangeTracker() {
    return this._changeTracker;
  };

  RelayGraphModeWriter.prototype.write = function write(payload) {
    var _this = this;

    payload.forEach(function (operation) {
      if (operation.op === PUT_ROOT) {
        _this._writeRoot(operation);
      } else if (operation.op === PUT_NODES) {
        _this._writeNodes(operation);
      } else if (operation.op === PUT_EDGES) {
        _this._writeEdges(operation);
      } else {
        !false ? process.env.NODE_ENV !== 'production' ? invariant(false, 'writeRelayGraphModeResponse(): Invalid operation type `%s`, ' + 'expected `root`, `nodes`, or `edges`.', operation.op) : invariant(false) : undefined;
      }
    });
  };

  RelayGraphModeWriter.prototype._writeRoot = function _writeRoot(operation) {
    var field = operation.field;
    var identifier = operation.identifier;
    var root = operation.root;

    var identifyingArgKey = getIdentifyingArgKey(identifier);
    var prevID = this._store.getDataID(field, identifyingArgKey);
    var nextID = getID(root, prevID);
    if (RelayRecord.isClientID(nextID)) {
      this._writeRecord(nextID, root);
    }
    this._writer.putDataID(field, identifyingArgKey, nextID);
  };

  RelayGraphModeWriter.prototype._writeNodes = function _writeNodes(operation) {
    var _this2 = this;

    var nodes = operation.nodes;

    forEachObject(nodes, function (record, dataID) {
      _this2._writeRecord(dataID, record);
    });
  };

  RelayGraphModeWriter.prototype._writeEdges = function _writeEdges(operation) {
    var _this3 = this;

    var range = operation.range;
    var args = operation.args;
    var edges = operation.edges;
    var pageInfo = operation.pageInfo;

    var rangeID = this._cacheKeyMap.get(range[CACHE_KEY]);
    !rangeID ? process.env.NODE_ENV !== 'production' ? invariant(false, 'writeRelayGraphModeResponse(): Cannot find a record for cache key ' + '`%s`.', range) : invariant(false) : undefined;
    if (!this._writer.hasRange(rangeID)) {
      this._changeTracker.updateID(rangeID);
      this._writer.putRange(rangeID, args, this._forceIndex);
    }
    var rangeInfo = this._store.getRangeMetadata(rangeID, args);
    var filteredEdges = rangeInfo && rangeInfo.filteredEdges || [];
    var fetchedEdgeIDs = [];
    var isUpdate = false;
    var nextIndex = 0;
    edges.forEach(function (edgeData) {
      if (edgeData == null) {
        return;
      }
      var nodeData = edgeData[NODE];
      if (nodeData == null) {
        return;
      }
      !(typeof nodeData === 'object') ? process.env.NODE_ENV !== 'production' ? invariant(false, 'RelayQueryWriter: Expected node to be an object for `%s`.', edgeData) : invariant(false) : undefined;

      // For consistency, edge IDs are calculated from the connection & node ID.
      // A node ID is only generated if the node does not have an id and
      // there is no existing edge.
      var prevEdge = filteredEdges[nextIndex++];
      var prevNodeID = prevEdge && _this3._store.getLinkedRecordID(prevEdge.edgeID, NODE);
      var nextNodeID = getID(nodeData, prevNodeID);
      var edgeID = generateClientEdgeID(rangeID, nextNodeID);
      fetchedEdgeIDs.push(edgeID);

      _this3._writeRecord(edgeID, _extends({}, edgeData, _defineProperty({}, NODE, _defineProperty({}, REF_KEY, nextNodeID))));
      if (RelayRecord.isClientID(nextNodeID)) {
        _this3._writeRecord(nextNodeID, nodeData);
      }
      if (nextNodeID !== prevNodeID) {
        _this3._changeTracker.updateID(edgeID);
      }
      isUpdate = isUpdate || !prevEdge || edgeID !== prevEdge.edgeID;
    });

    this._writer.putRangeEdges(rangeID, args, pageInfo || RelayConnectionInterface.getDefaultPageInfo(), fetchedEdgeIDs);

    if (isUpdate) {
      this._changeTracker.updateID(rangeID);
    }
  };

  RelayGraphModeWriter.prototype._writeRecord = function _writeRecord(dataID, record) {
    var _this4 = this;

    var recordState = this._store.getRecordState(dataID);
    if (record === undefined) {
      return;
    } else if (record === null) {
      if (recordState === NONEXISTENT) {
        this._changeTracker.updateID(dataID);
      }
      this._writer.deleteRecord(dataID);
      return;
    }
    var cacheKey = getCacheKey(record);
    if (cacheKey) {
      this._cacheKeyMap.set(cacheKey, dataID);
    }
    if (recordState !== EXISTENT) {
      this._changeTracker.createID(dataID);
    }
    var typeName = record[TYPENAME];
    this._writer.putRecord(dataID, typeName);

    forEachObject(record, function (nextValue, storageKey) {
      if (storageKey === REF_KEY || storageKey === CACHE_KEY) {
        return;
      } else if (nextValue === undefined) {
        return;
      } else if (nextValue === null) {
        _this4._writeScalar(dataID, storageKey, nextValue);
      } else if (Array.isArray(nextValue)) {
        _this4._writePlural(dataID, storageKey, nextValue);
      } else if (typeof nextValue === 'object') {
        _this4._writeLinkedRecord(dataID, storageKey, nextValue);
      } else {
        _this4._writeScalar(dataID, storageKey, nextValue);
      }
    });
  };

  RelayGraphModeWriter.prototype._writeScalar = function _writeScalar(dataID, storageKey, nextValue) {
    var prevValue = this._store.getField(dataID, storageKey);
    if (prevValue !== nextValue) {
      this._changeTracker.updateID(dataID);
    }
    this._writer.putField(dataID, storageKey, nextValue);
  };

  RelayGraphModeWriter.prototype._writePlural = function _writePlural(dataID, storageKey, nextValue) {
    var _this5 = this;

    var prevValue = this._store.getField(dataID, storageKey);
    var prevArray = Array.isArray(prevValue) ? prevValue : [];
    var nextIDs = null;
    var nextScalars = null;
    var isUpdate = false;
    var nextIndex = 0;
    nextValue.forEach(function (nextItem) {
      if (nextItem == null) {
        return;
      } else if (typeof nextItem === 'object') {
        !!nextScalars ? process.env.NODE_ENV !== 'production' ? invariant(false, 'writeRelayGraphModeResponse(): Expected items for field `%s` to ' + 'all be objects or all be scalars, got both.', storageKey) : invariant(false) : undefined;
        var prevItem = prevArray[nextIndex++];
        var prevID = typeof prevItem === 'object' && prevItem != null ? RelayRecord.getDataIDForObject(prevItem) : null;
        var nextID = getID(nextItem, prevID);

        if (RelayRecord.isClientID(nextID)) {
          _this5._writeRecord(nextID, nextItem);
        }
        isUpdate = isUpdate || nextID !== prevID;
        nextIDs = nextIDs || [];
        nextIDs.push(nextID);
      } else {
        // array of scalars
        !!nextIDs ? process.env.NODE_ENV !== 'production' ? invariant(false, 'writeRelayGraphModeResponse(): Expected items for field `%s` to ' + 'all be objects or all be scalars, got both.', storageKey) : invariant(false) : undefined;
        var prevItem = prevArray[nextIndex++];
        isUpdate = isUpdate || nextItem !== prevItem;
        nextScalars = nextScalars || [];
        nextScalars.push(nextItem);
      }
    });
    var nextArray = nextIDs || nextScalars;
    if (isUpdate || !prevArray || !nextArray || // for flow
    nextArray.length !== prevArray.length) {
      this._changeTracker.updateID(dataID);
    }
    if (nextIDs) {
      this._writer.putLinkedRecordIDs(dataID, storageKey, nextIDs);
    } else {
      this._writer.putField(dataID, storageKey, nextScalars || []);
    }
  };

  RelayGraphModeWriter.prototype._writeLinkedRecord = function _writeLinkedRecord(dataID, storageKey, nextValue) {
    var prevID = this._store.getLinkedRecordID(dataID, storageKey);
    var nextID = getID(nextValue, prevID);

    if (RelayRecord.isClientID(nextID)) {
      this._writeRecord(nextID, nextValue);
    }
    if (nextID !== prevID) {
      this._changeTracker.updateID(dataID);
    }
    this._writer.putLinkedRecordID(dataID, storageKey, nextID);
  };

  return RelayGraphModeWriter;
})();

function getCacheKey(record) {
  if (record.hasOwnProperty(CACHE_KEY) && typeof record[CACHE_KEY] === 'string') {
    return record[CACHE_KEY];
  }
  return null;
}

function getID(record, prevID) {
  if (prevID != null) {
    return prevID;
  } else if (record.hasOwnProperty(REF_KEY) && typeof record[REF_KEY] === 'string') {
    return record[REF_KEY];
  } else if (record.hasOwnProperty(ID) && typeof record[ID] === 'string') {
    return record[ID];
  } else {
    return generateClientID();
  }
}

function getIdentifyingArgKey(value) {
  if (value == null) {
    return null;
  } else {
    return typeof value === 'string' ? value : stableStringify(value);
  }
}

module.exports = writeRelayGraphModeResponse;