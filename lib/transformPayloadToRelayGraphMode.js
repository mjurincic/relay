/**
 * Copyright (c) 2013-present, Facebook, Inc.
 * All rights reserved.
 *
 * This source code is licensed under the BSD-style license found in the
 * LICENSE file in the root directory of this source tree. An additional grant
 * of patent rights can be found in the PATENTS file in the same directory.
 *
 * @providesModule transformPayloadToRelayGraphMode
 * 
 * @typechecks
 */

'use strict';

var _inherits = require('babel-runtime/helpers/inherits')['default'];

var _classCallCheck = require('babel-runtime/helpers/class-call-check')['default'];

var _defineProperty = require('babel-runtime/helpers/define-property')['default'];

var _toConsumableArray = require('babel-runtime/helpers/to-consumable-array')['default'];

var _Object$keys = require('babel-runtime/core-js/object/keys')['default'];

var RelayConnectionInterface = require('./RelayConnectionInterface');
var RelayGraphModeInterface = require('./RelayGraphModeInterface');

var RelayNodeInterface = require('./RelayNodeInterface');
var RelayQuery = require('./RelayQuery');
var RelayQueryPath = require('./RelayQueryPath');

var RelayQueryVisitor = require('./RelayQueryVisitor');

var base62 = require('fbjs/lib/base62');
var invariant = require('fbjs/lib/invariant');
var isCompatibleRelayFragmentType = require('./isCompatibleRelayFragmentType');

var EDGES = RelayConnectionInterface.EDGES;
var PAGE_INFO = RelayConnectionInterface.PAGE_INFO;
var CACHE_KEY = RelayGraphModeInterface.CACHE_KEY;
var REF_KEY = RelayGraphModeInterface.REF_KEY;
var ID = RelayNodeInterface.ID;
var TYPENAME = RelayNodeInterface.TYPENAME;

// $FlowIssue: disjoint unions don't seem to be working to import this type.
// Should be:
//   import type {GraphOperation} from 'RelayGraphModeInterface';

/**
 * @internal
 *
 * Transforms a query and "tree" payload into a GraphMode payload.
 */
function transformPayloadToRelayGraphMode(store, queryTracker, root, payload, options) {
  var transformer = new RelayPayloadTransformer(store, queryTracker, options);
  transformer.transform(root, payload);
  return transformer.getPayload();
}

var RelayPayloadTransformer = (function (_RelayQueryVisitor) {
  _inherits(RelayPayloadTransformer, _RelayQueryVisitor);

  function RelayPayloadTransformer(store, queryTracker, options) {
    _classCallCheck(this, RelayPayloadTransformer);

    _RelayQueryVisitor.call(this);
    this._nextKey = 0;
    this._nodes = {};
    this._operations = [];
    this._queryTracker = queryTracker;
    this._store = store;
    this._updateTrackedQueries = !!(options && options.updateTrackedQueries);
  }

  RelayPayloadTransformer.prototype.getPayload = function getPayload() {
    var nodes = this._nodes;
    if (!_Object$keys(nodes).length) {
      return this._operations;
    }
    return [{ op: 'putNodes', nodes: nodes }].concat(_toConsumableArray(this._operations));
  };

  RelayPayloadTransformer.prototype.transform = function transform(root, payload) {
    var _this = this;

    RelayNodeInterface.getResultsFromPayload(this._store, root, payload).forEach(function (_ref3) {
      var result = _ref3.result;
      var rootCallInfo = _ref3.rootCallInfo;

      if (!rootCallInfo) {
        return;
      }
      var storageKey = rootCallInfo.storageKey;
      var identifyingArgValue = rootCallInfo.identifyingArgValue;

      var record = _this._writeRecord(root, result);
      // TODO #10481948: Make `putRoot` take a nullable record.
      if (record) {
        _this._operations.unshift({
          op: 'putRoot',
          field: storageKey,
          identifier: identifyingArgValue,
          root: record
        });
      }
    });
  };

  RelayPayloadTransformer.prototype._writeRecord = function _writeRecord(node, payloadRecord, clientRecord) {
    if (payloadRecord == null) {
      return payloadRecord;
    }
    var id = payloadRecord[ID];
    if (id != null) {
      var typeName = getRecordTypeName(node, payloadRecord);
      var _currentRecord = this._getOrCreateRecord(id, typeName);
      this._recordTrackedQueries(id, node);
      this.traverse(node, {
        currentRecord: _currentRecord,
        key: null,
        payloadRecord: payloadRecord
      });
      return _defineProperty({}, REF_KEY, id);
    } else {
      var _currentRecord2 = clientRecord || {};
      var typeName = getRecordTypeName(node, payloadRecord);
      if (typeName != null) {
        _currentRecord2[TYPENAME] = typeName;
      }
      this.traverse(node, {
        currentRecord: _currentRecord2,
        key: null,
        payloadRecord: payloadRecord
      });
      return _currentRecord2;
    }
  };

  RelayPayloadTransformer.prototype._getOrCreateRecord = function _getOrCreateRecord(dataID, typeName) {
    var record = this._nodes[dataID];
    if (!record) {
      var _ref2;

      // $FlowIssue: This is a valid `GraphRecord` but is being type-checked as
      // a `GraphReference` for some reason.
      record = this._nodes[dataID] = (_ref2 = {}, _defineProperty(_ref2, ID, dataID), _defineProperty(_ref2, TYPENAME, typeName), _ref2);
    }
    return record;
  };

  RelayPayloadTransformer.prototype._recordTrackedQueries = function _recordTrackedQueries(dataID, node) {
    if (this._updateTrackedQueries || this._store.getRecordState(dataID) !== 'EXISTENT') {
      var path = node instanceof RelayQuery.Root ? RelayQueryPath.create(node) : null;
      this._queryTracker.trackNodeForID(node, dataID, path);
    }
  };

  RelayPayloadTransformer.prototype._getNextKey = function _getNextKey() {
    return base62(this._nextKey++);
  };

  RelayPayloadTransformer.prototype.visitFragment = function visitFragment(fragment, state) {
    var typeName = state.currentRecord[TYPENAME];
    if (isCompatibleRelayFragmentType(fragment, typeName)) {
      this.traverse(fragment, state);
    }
  };

  RelayPayloadTransformer.prototype.visitField = function visitField(field, state) {
    var currentRecord = state.currentRecord;
    var payloadRecord = state.payloadRecord;

    var fieldData = payloadRecord[field.getSerializationKey()];
    if (fieldData == null) {
      // Treat undefined as null
      currentRecord[field.getStorageKey()] = null;
    } else if (!field.canHaveSubselections()) {
      !(typeof fieldData !== 'object' || Array.isArray(fieldData)) ? process.env.NODE_ENV !== 'production' ? invariant(false, 'transformPayloadToRelayGraphMode(): Expected a scalar for field ' + '`%s`, got `%s`.', field.getSchemaName(), fieldData) : invariant(false) : undefined;
      currentRecord[field.getStorageKey()] = fieldData;
    } else if (field.isConnection()) {
      !(typeof fieldData === 'object' && !Array.isArray(fieldData)) ? process.env.NODE_ENV !== 'production' ? invariant(false, 'transformPayloadToRelayGraphMode(): Expected data for connection ' + '`%s` to be an object, got `%s`.', field.getSchemaName(), fieldData) : invariant(false) : undefined;
      this._transformConnection(field, state, fieldData);
    } else if (field.isPlural()) {
      !Array.isArray(fieldData) ? process.env.NODE_ENV !== 'production' ? invariant(false, 'transformPayloadToRelayGraphMode(): Expected data for plural field ' + 'to be an array, got `%s`.', field.getSchemaName(), fieldData) : invariant(false) : undefined;
      this._transformPluralLink(field, state, fieldData);
    } else {
      !(typeof fieldData === 'object' && !Array.isArray(fieldData)) ? process.env.NODE_ENV !== 'production' ? invariant(false, 'transformPayloadToRelayGraphMode(): Expected data for field ' + '`%s` to be an object, got `%s`.', field.getSchemaName(), fieldData) : invariant(false) : undefined;
      this._transformLink(field, state, fieldData);
    }
  };

  RelayPayloadTransformer.prototype._transformConnection = function _transformConnection(field, state, fieldData) {
    var currentRecord = state.currentRecord;

    var storageKey = field.getStorageKey();
    var clientRecord = currentRecord[storageKey] = currentRecord[storageKey] || {};
    !(clientRecord == null || typeof clientRecord === 'object' && !Array.isArray(clientRecord)) ? process.env.NODE_ENV !== 'production' ? invariant(false, 'transformPayloadToRelayGraphMode(): Expected data for field ' + '`%s` to be an objects, got `%s`.', field.getSchemaName(), clientRecord) : invariant(false) : undefined;
    var key = this._getNextKey();
    clientRecord[CACHE_KEY] = key;
    this._traverseConnection(field, field, {
      currentRecord: clientRecord,
      key: key,
      payloadRecord: fieldData
    });
  };

  RelayPayloadTransformer.prototype._traverseConnection = function _traverseConnection(connectionField, // the parent connection
  parentNode, // the connection or an intermediary fragment
  state) {
    var _this2 = this;

    parentNode.getChildren().forEach(function (child) {
      if (child instanceof RelayQuery.Field) {
        if (child.getSchemaName() === EDGES) {
          _this2._transformEdges(connectionField, child, state);
        } else if (child.getSchemaName() !== PAGE_INFO) {
          // Page info is handled by the range
          // Otherwise, write metadata fields normally (ex: `count`)
          _this2.visit(child, state);
        }
      } else {
        // Fragment case, recurse keeping track of parent connection
        _this2._traverseConnection(connectionField, child, state);
      }
    });
  };

  RelayPayloadTransformer.prototype._transformEdges = function _transformEdges(connectionField, edgesField, state) {
    var _this3 = this;

    var key = state.key;
    var payloadRecord = state.payloadRecord;

    var edgesData = payloadRecord[EDGES];
    var pageInfo = payloadRecord[PAGE_INFO];

    !(key != null) ? process.env.NODE_ENV !== 'production' ? invariant(false, 'transformPayloadToRelayGraphMode(): Expected a key for connection ' + 'field `%s`.', connectionField.getSchemaName()) : invariant(false) : undefined;
    !(edgesData == null || Array.isArray(edgesData)) ? process.env.NODE_ENV !== 'production' ? invariant(false, 'transformPayloadToRelayGraphMode(): Expected edges for field `%s` to ' + 'be an array, got `%s`.', connectionField.getSchemaName(), edgesData) : invariant(false) : undefined;
    !(pageInfo == null || typeof pageInfo === 'object' && !Array.isArray(pageInfo)) ? process.env.NODE_ENV !== 'production' ? invariant(false, 'transformPayloadToRelayGraphMode(): Expected %s for field `%s` to be ' + 'an object, got `%s`.', PAGE_INFO, connectionField.getSchemaName(), pageInfo) : invariant(false) : undefined;
    var edgeRecords = edgesData.map(function (edgeItem) {
      return _this3._writeRecord(edgesField, edgeItem);
    });
    // Inner ranges may reference cache keys defined in their parents. Using
    // `unshift` here ensures that parent edges are processed before children.
    this._operations.unshift({
      op: 'putEdges',
      args: connectionField.getCallsWithValues(),
      edges: edgeRecords,
      pageInfo: pageInfo,
      range: _defineProperty({}, CACHE_KEY, key)
    });
  };

  RelayPayloadTransformer.prototype._transformPluralLink = function _transformPluralLink(field, state, fieldData) {
    var _this4 = this;

    var currentRecord = state.currentRecord;

    var storageKey = field.getStorageKey();

    var linkedRecords = currentRecord[storageKey];
    !(linkedRecords == null || Array.isArray(linkedRecords)) ? process.env.NODE_ENV !== 'production' ? invariant(false, 'transformPayloadToRelayGraphMode(): Expected data for field `%s` to ' + 'always have array data, got `%s`.', field.getSchemaName(), linkedRecords) : invariant(false) : undefined;
    var records = fieldData.map(function (fieldItem, ii) {
      var clientRecord = linkedRecords && linkedRecords[ii];
      !(clientRecord == null || typeof clientRecord === 'object') ? process.env.NODE_ENV !== 'production' ? invariant(false, 'transformPayloadToRelayGraphMode(): Expected array items for field ' + '`%s` to be objects, got `%s` at index `%s`.', field.getSchemaName(), clientRecord, ii) : invariant(false) : undefined;
      !(fieldItem == null || typeof fieldItem === 'object' && !Array.isArray(fieldItem)) ? process.env.NODE_ENV !== 'production' ? invariant(false, 'transformPayloadToRelayGraphMode(): Expected array items for field ' + '`%s` to be objects, got `%s` at index `%s`.', field.getSchemaName(), fieldItem, ii) : invariant(false) : undefined;
      return _this4._writeRecord(field, fieldItem, clientRecord);
    });
    currentRecord[storageKey] = records;
  };

  RelayPayloadTransformer.prototype._transformLink = function _transformLink(field, state, fieldData) {
    var currentRecord = state.currentRecord;

    var storageKey = field.getStorageKey();
    var clientRecord = currentRecord[storageKey];
    !(clientRecord == null || typeof clientRecord === 'object' && !Array.isArray(clientRecord)) ? process.env.NODE_ENV !== 'production' ? invariant(false, 'transformPayloadToRelayGraphMode(): Expected data for field ' + '`%s` to be an objects, got `%s`.', field.getSchemaName(), clientRecord) : invariant(false) : undefined;
    var record = this._writeRecord(field, fieldData, clientRecord);
    currentRecord[storageKey] = record;
  };

  return RelayPayloadTransformer;
})(RelayQueryVisitor);

function getRecordTypeName(node, payload) {
  var typeName = payload[TYPENAME];
  if (typeName == null && !node.isAbstract()) {
    return node.getType();
  }
  return typeName;
}

module.exports = transformPayloadToRelayGraphMode;