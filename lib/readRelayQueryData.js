/**
 * Copyright (c) 2013-present, Facebook, Inc.
 * All rights reserved.
 *
 * This source code is licensed under the BSD-style license found in the
 * LICENSE file in the root directory of this source tree. An additional grant
 * of patent rights can be found in the PATENTS file in the same directory.
 *
 * @providesModule readRelayQueryData
 * 
 * @typechecks
 */

'use strict';

var _inherits = require('babel-runtime/helpers/inherits')['default'];

var _classCallCheck = require('babel-runtime/helpers/class-call-check')['default'];

Object.defineProperty(exports, '__esModule', {
  value: true
});
var RelayFragmentPointer = require('./RelayFragmentPointer');

var RelayConnectionInterface = require('./RelayConnectionInterface');

var RelayProfiler = require('./RelayProfiler');
var RelayQuery = require('./RelayQuery');
var RelayQueryVisitor = require('./RelayQueryVisitor');
var RelayRecord = require('./RelayRecord');
var RelayRecordState = require('./RelayRecordState');
var RelayRecordStatusMap = require('./RelayRecordStatusMap');

var callsFromGraphQL = require('./callsFromGraphQL');
var callsToGraphQL = require('./callsToGraphQL');
var invariant = require('fbjs/lib/invariant');
var isCompatibleRelayFragmentType = require('./isCompatibleRelayFragmentType');
var validateRelayReadQuery = require('./validateRelayReadQuery');

var EDGES = RelayConnectionInterface.EDGES;
var PAGE_INFO = RelayConnectionInterface.PAGE_INFO;

var METADATA_KEYS = ['__status__', '__resolvedFragmentMapGeneration__'];

/**
 * @internal
 *
 * Retrieves data from the `RelayStore`.
 */
function readRelayQueryData(storeData, queryNode, dataID, options) {
  var reader = new RelayStoreReader(storeData, options);
  var data = reader.retrieveData(queryNode, dataID);

  // We validate only after retrieving the data, to give our `invariant`
  // checks below a chance to fail fast.
  validateRelayReadQuery(queryNode, options);

  return data;
}

var RelayStoreReader = (function (_RelayQueryVisitor) {
  _inherits(RelayStoreReader, _RelayQueryVisitor);

  function RelayStoreReader(storeData, options) {
    _classCallCheck(this, RelayStoreReader);

    _RelayQueryVisitor.call(this);
    this._rangeData = storeData.getRangeData();
    this._recordStore = storeData.getQueuedStore();
    this._storeData = storeData;
    this._traverseFragmentReferences = options && options.traverseFragmentReferences || false;
    this._traverseGeneratedFields = options && options.traverseGeneratedFields || false;
  }

  /**
   * Checks that `parent` either has range calls on it or does not contain either
   * `page_info` or `edges` fields. This enforcement intentionally transcends
   * traverseFragmentReferences boundaries.
   */

  /**
   * Runs `queryNode` against the data in `dataID` and returns the result.
   */

  RelayStoreReader.prototype.retrieveData = function retrieveData(queryNode, dataID) {
    var result = {
      data: undefined,
      dataIDs: {}
    };
    var rangeData = this._rangeData.parseRangeClientID(dataID);
    var status = this._recordStore.getRecordState(rangeData ? rangeData.dataID : dataID);
    if (status === RelayRecordState.EXISTENT) {
      var state = this._createState({
        componentDataID: null,
        data: undefined,
        isPartial: false,
        parent: null,
        rangeInfo: null,
        seenDataIDs: result.dataIDs,
        storeDataID: dataID
      });
      this.visit(queryNode, state);
      result.data = state.data;
    } else if (status === RelayRecordState.NONEXISTENT) {
      result.data = null;
    }
    return result;
  };

  RelayStoreReader.prototype.visit = function visit(node, state) {
    var result = _RelayQueryVisitor.prototype.visit.call(this, node, state);
    this._updateMetadataFields(state);
    return result;
  };

  RelayStoreReader.prototype.visitField = function visitField(node, state) {
    // Check for range client IDs (eg. `someID_first(25)`) and unpack if
    // present, overriding `state`.
    this._handleRangeInfo(node, state);

    if (node.canHaveSubselections() || node.isGenerated()) {
      // Make sure we return at least the __dataID__.
      getDataObject(state);
    }

    if (node.isGenerated() && !this._traverseGeneratedFields) {
      return;
    }
    var rangeInfo = state.rangeInfo;
    if (rangeInfo && node.getSchemaName() === EDGES) {
      this._readEdges(node, rangeInfo, state);
    } else if (rangeInfo && node.getSchemaName() === PAGE_INFO) {
      this._readPageInfo(node, rangeInfo, state);
    } else if (!node.canHaveSubselections()) {
      this._readScalar(node, state);
    } else if (node.isPlural()) {
      this._readPlural(node, state);
    } else if (node.isConnection()) {
      this._readConnection(node, state);
    } else {
      this._readLinkedField(node, state);
    }
    state.seenDataIDs[state.storeDataID] = true;
  };

  RelayStoreReader.prototype.visitFragment = function visitFragment(node, state) {
    var dataID = getComponentDataID(state);
    if (node.isContainerFragment() && !this._traverseFragmentReferences) {
      state.seenDataIDs[dataID] = true;
      var _data = getDataObject(state);
      RelayFragmentPointer.addFragment(_data, node, dataID);
    } else if (isCompatibleRelayFragmentType(node, this._recordStore.getType(dataID))) {
      this.traverse(node, state);
    }
  };

  RelayStoreReader.prototype._createState = function _createState(state) {
    // If we have a valid `dataID`, ensure that a record is created for it even
    // if we do not actually end up populating it with fields.
    var status = this._recordStore.getRecordState(state.storeDataID);
    if (status === RelayRecordState.EXISTENT) {
      getDataObject(state);
    }
    return state;
  };

  RelayStoreReader.prototype._readScalar = function _readScalar(node, state) {
    var storageKey = node.getStorageKey();
    var field = this._recordStore.getField(state.storeDataID, storageKey);
    if (field === undefined) {
      state.isPartial = true;
    } else if (field === null && !state.data) {
      state.data = null;
    } else {
      this._setDataValue(state, node.getApplicationName(), Array.isArray(field) ? field.slice() : field);
    }
  };

  RelayStoreReader.prototype._readPlural = function _readPlural(node, state) {
    var _this = this;

    var storageKey = node.getStorageKey();
    var dataIDs = this._recordStore.getLinkedRecordIDs(state.storeDataID, storageKey);
    if (dataIDs) {
      (function () {
        var applicationName = node.getApplicationName();
        var previousData = getDataValue(state, applicationName);
        var nextData = dataIDs.map(function (dataID, ii) {
          var data = undefined;
          if (previousData instanceof Object) {
            data = previousData[ii];
          }
          var nextState = _this._createState({
            componentDataID: null,
            data: data,
            isPartial: false,
            parent: node,
            rangeInfo: null,
            seenDataIDs: state.seenDataIDs,
            storeDataID: dataID
          });
          node.getChildren().forEach(function (child) {
            return _this.visit(child, nextState);
          });
          if (nextState.isPartial) {
            state.isPartial = true;
          }
          return nextState.data;
        });
        _this._setDataValue(state, applicationName, nextData);
      })();
    }
  };

  RelayStoreReader.prototype._readConnection = function _readConnection(node, state) {
    var applicationName = node.getApplicationName();
    var storageKey = node.getStorageKey();
    var calls = node.getCallsWithValues();
    var dataID = this._recordStore.getLinkedRecordID(state.storeDataID, storageKey);
    if (!dataID) {
      state.isPartial = true;
      return;
    }
    enforceRangeCalls(node);
    var metadata = this._recordStore.getRangeMetadata(dataID, calls);
    var nextState = this._createState({
      componentDataID: this._getConnectionClientID(node, dataID),
      data: getDataValue(state, applicationName),
      isPartial: false,
      parent: node,
      rangeInfo: metadata && calls.length ? metadata : null,
      seenDataIDs: state.seenDataIDs,
      storeDataID: dataID
    });
    this.traverse(node, nextState);
    if (nextState.isPartial) {
      state.isPartial = true;
    }
    this._setDataValue(state, applicationName, nextState.data);
  };

  RelayStoreReader.prototype._readEdges = function _readEdges(node, rangeInfo, state) {
    var _this2 = this;

    if (rangeInfo.diffCalls.length) {
      state.isPartial = true;
    }
    var previousData = getDataValue(state, EDGES);
    // Include null-filtered edges as "seen" so that they will be subscribed.
    rangeInfo.requestedEdgeIDs.forEach(function (edgeID) {
      state.seenDataIDs[edgeID] = true;
    });
    var edges = rangeInfo.filteredEdges.map(function (edgeData, ii) {
      var data = undefined;
      if (previousData instanceof Object) {
        data = previousData[ii];
      }
      var nextState = _this2._createState({
        componentDataID: null,
        data: data,
        isPartial: false,
        parent: node,
        rangeInfo: null,
        seenDataIDs: state.seenDataIDs,
        storeDataID: edgeData.edgeID
      });
      _this2.traverse(node, nextState);
      if (nextState.isPartial) {
        state.isPartial = true;
      }
      return nextState.data;
    });
    this._setDataValue(state, EDGES, edges);
  };

  RelayStoreReader.prototype._readPageInfo = function _readPageInfo(node, rangeInfo, state) {
    var _this3 = this;

    var pageInfo = rangeInfo.pageInfo;

    !pageInfo ? process.env.NODE_ENV !== 'production' ? invariant(false, 'readRelayQueryData(): Missing field, `%s`.', PAGE_INFO) : invariant(false) : undefined;
    if (rangeInfo.diffCalls.length) {
      state.isPartial = true;
    }
    var info = pageInfo; // for Flow
    var nextData = undefined;

    // Page info comes from the range metadata, so we do a custom traversal here
    // which is simpler than passing through page-info-related state as a hint
    // for the normal traversal.
    var read = function read(child) {
      if (child instanceof RelayQuery.Fragment) {
        if (child.isContainerFragment() && !_this3._traverseFragmentReferences) {
          var dataID = getComponentDataID(state);
          nextData = nextData || {};
          RelayFragmentPointer.addFragment(nextData, child, dataID);
        } else {
          child.getChildren().forEach(read);
        }
      } else {
        var field = child;
        if (!field.isGenerated() || _this3._traverseGeneratedFields) {
          nextData = nextData || {};
          nextData[field.getApplicationName()] = info[field.getStorageKey()];
        }
      }
    };
    node.getChildren().forEach(read);

    this._setDataValue(state, PAGE_INFO, nextData);
  };

  RelayStoreReader.prototype._readLinkedField = function _readLinkedField(node, state) {
    var storageKey = node.getStorageKey();
    var applicationName = node.getApplicationName();
    var dataID = this._recordStore.getLinkedRecordID(state.storeDataID, storageKey);
    if (dataID == null) {
      if (dataID === undefined) {
        state.isPartial = true;
      }
      this._setDataValue(state, applicationName, dataID);
      return;
    }
    var nextState = this._createState({
      componentDataID: null,
      data: getDataValue(state, applicationName),
      isPartial: false,
      parent: node,
      rangeInfo: null,
      seenDataIDs: state.seenDataIDs,
      storeDataID: dataID
    });
    this.traverse(node, nextState);
    if (nextState.isPartial) {
      state.isPartial = true;
    }
    this._setDataValue(state, applicationName, nextState.data);
  };

  /**
   * Assigns `value` to the property of `state.data` identified by `key`.
   *
   * Pre-populates `state` with a suitable `data` object if needed, and copies
   * over any metadata fields, if present.
   */

  RelayStoreReader.prototype._setDataValue = function _setDataValue(state, key, value) {
    var data = getDataObject(state); // ensure __dataID__
    if (value === undefined) {
      return;
    }
    data[key] = value;
  };

  RelayStoreReader.prototype._updateMetadataFields = function _updateMetadataFields(state) {
    var _this4 = this;

    var data = state.data;
    if (!(data instanceof Object)) {
      return;
    }
    var dataID = state.storeDataID;
    // Copy metadata that is necessary to dirty records when recycling objects.
    METADATA_KEYS.forEach(function (metadataKey) {
      var metadataValue = _this4._recordStore.getField(dataID, metadataKey);
      if (metadataValue != null) {
        data[metadataKey] = metadataValue;
      }
    });
    // Set the partial bit after metadata has been copied over.
    if (state.isPartial) {
      data.__status__ = RelayRecordStatusMap.setPartialStatus(data.__status__, true);
    }
    // Hash any pending mutation transactions.
    var mutationIDs = this._storeData.getClientMutationIDs(dataID);
    if (mutationIDs) {
      (function () {
        var mutationQueue = _this4._storeData.getMutationQueue();
        data.__mutationStatus__ = mutationIDs.map(function (mutationID) {
          return mutationQueue.getTransaction(mutationID).getHash();
        }).join(',');
      })();
    }
  };

  /**
   * Obtains a client ID (eg. `someDataID_first(10)`) for the connection
   * identified by `connectionID`. If there are no range calls on the supplied
   * `node`, then a call-less connection ID (eg. `someDataID`) will be returned
   * instead.
   */

  RelayStoreReader.prototype._getConnectionClientID = function _getConnectionClientID(node, connectionID) {
    var calls = node.getCallsWithValues();
    if (!RelayConnectionInterface.hasRangeCalls(calls)) {
      return connectionID;
    }
    return this._rangeData.getClientIDForRangeWithID(callsToGraphQL(calls), {}, connectionID);
  };

  /**
   * Checks to see if we have a range client ID (eg. `someID_first(25)`), and if
   * so, unpacks the range metadata, stashing it into (and overriding) `state`.
   */

  RelayStoreReader.prototype._handleRangeInfo = function _handleRangeInfo(node, state) {
    var rangeData = this._rangeData.parseRangeClientID(state.storeDataID);
    if (rangeData != null) {
      state.componentDataID = state.storeDataID;
      state.storeDataID = rangeData.dataID;
      state.rangeInfo = this._recordStore.getRangeMetadata(state.storeDataID, callsFromGraphQL(rangeData.calls, rangeData.callValues));
    }
  };

  return RelayStoreReader;
})(RelayQueryVisitor);

function enforceRangeCalls(parent) {
  if (!parent.__hasValidatedConnectionCalls__) {
    var calls = parent.getCallsWithValues();
    if (!RelayConnectionInterface.hasRangeCalls(calls)) {
      rangeCallEnforcer.traverse(parent, parent);
    }
    parent.__hasValidatedConnectionCalls__ = true;
  }
}

var RelayRangeCallEnforcer = (function (_RelayQueryVisitor2) {
  _inherits(RelayRangeCallEnforcer, _RelayQueryVisitor2);

  function RelayRangeCallEnforcer() {
    _classCallCheck(this, RelayRangeCallEnforcer);

    _RelayQueryVisitor2.apply(this, arguments);
  }

  RelayRangeCallEnforcer.prototype.visitField = function visitField(node, parent) {
    var schemaName = node.getSchemaName();
    !(schemaName !== EDGES && schemaName !== PAGE_INFO) ? process.env.NODE_ENV !== 'production' ? invariant(false, 'readRelayQueryData(): The field `%s` is a connection. Fields `%s` and ' + '`%s` cannot be fetched without a `first`, `last` or `find` argument.', parent.getApplicationName(), EDGES, PAGE_INFO) : invariant(false) : undefined;
  };

  return RelayRangeCallEnforcer;
})(RelayQueryVisitor);

var rangeCallEnforcer = new RelayRangeCallEnforcer();

/**
 * Returns the component-specific DataID stored in `state`, falling back to the
 * generic "store" DataID.
 *
 * For most nodes, the generic "store" DataID can be used for both reading out
 * of the store and writing into the result object that will be passed back to
 * the component. For connections with range calls on them the "store" and
 * "component" ID will be different because the component needs a special
 * client-ID that encodes the range calls.
 */
function getComponentDataID(state) {
  if (state.componentDataID != null) {
    return state.componentDataID;
  } else {
    return state.storeDataID;
  }
}

/**
 * Retrieves `state.data`, initializing it if necessary.
 */
function getDataObject(state) {
  var data = state.data;
  if (!data) {
    data = state.data = RelayRecord.create(getComponentDataID(state));
  }
  !(data instanceof Object) ? process.env.NODE_ENV !== 'production' ? invariant(false, 'readRelayQueryData(): Unable to read field on non-object.') : invariant(false) : undefined;
  return data;
}

/**
 * Looks up the value identified by `key` in `state.data`.
 *
 * Pre-populates `state` with a suitable `data` objects if needed.
 */
function getDataValue(state, key) {
  var data = getDataObject(state);
  return data[key];
}

module.exports = RelayProfiler.instrument('readRelayQueryData', readRelayQueryData);