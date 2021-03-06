/**
 * Copyright (c) 2013-present, Facebook, Inc.
 * All rights reserved.
 *
 * This source code is licensed under the BSD-style license found in the
 * LICENSE file in the root directory of this source tree. An additional grant
 * of patent rights can be found in the PATENTS file in the same directory.
 *
 * @providesModule RelayStoreData
 * 
 * @typechecks
 */

'use strict';

var _classCallCheck = require('babel-runtime/helpers/class-call-check')['default'];

var _Object$keys = require('babel-runtime/core-js/object/keys')['default'];

var GraphQLQueryRunner = require('./GraphQLQueryRunner');
var GraphQLStoreChangeEmitter = require('./GraphQLStoreChangeEmitter');
var GraphQLStoreRangeUtils = require('./GraphQLStoreRangeUtils');
var RelayChangeTracker = require('./RelayChangeTracker');

var RelayConnectionInterface = require('./RelayConnectionInterface');
var RelayDiskCacheReader = require('./RelayDiskCacheReader');
var RelayFragmentTracker = require('./RelayFragmentTracker');

var RelayGarbageCollector = require('./RelayGarbageCollector');
var RelayMutationQueue = require('./RelayMutationQueue');

var RelayNetworkLayer = require('./RelayNetworkLayer');
var RelayNodeInterface = require('./RelayNodeInterface');
var RelayPendingQueryTracker = require('./RelayPendingQueryTracker');
var RelayProfiler = require('./RelayProfiler');
var RelayQuery = require('./RelayQuery');

var RelayQueryPath = require('./RelayQueryPath');
var RelayQueryTracker = require('./RelayQueryTracker');
var RelayQueryWriter = require('./RelayQueryWriter');
var RelayRecord = require('./RelayRecord');

var RelayRecordStore = require('./RelayRecordStore');
var RelayRecordWriter = require('./RelayRecordWriter');
var RelayTaskQueue = require('./RelayTaskQueue');

var forEachObject = require('fbjs/lib/forEachObject');
var invariant = require('fbjs/lib/invariant');
var generateForceIndex = require('./generateForceIndex');
var warning = require('fbjs/lib/warning');
var writeRelayQueryPayload = require('./writeRelayQueryPayload');
var writeRelayUpdatePayload = require('./writeRelayUpdatePayload');

var CLIENT_MUTATION_ID = RelayConnectionInterface.CLIENT_MUTATION_ID;
var ID = RelayNodeInterface.ID;
var ID_TYPE = RelayNodeInterface.ID_TYPE;
var NODE = RelayNodeInterface.NODE;
var NODE_TYPE = RelayNodeInterface.NODE_TYPE;
var TYPENAME = RelayNodeInterface.TYPENAME;

var idField = RelayQuery.Field.build({
  fieldName: ID,
  type: 'String'
});
var typeField = RelayQuery.Field.build({
  fieldName: TYPENAME,
  type: 'String'
});

/**
 * @internal
 *
 * Wraps the data caches and associated metadata tracking objects used by
 * GraphQLStore/RelayStore.
 */

var RelayStoreData = (function () {
  function RelayStoreData() {
    _classCallCheck(this, RelayStoreData);

    var cachedRecords = {};
    var cachedRootCallMap = {};
    var queuedRecords = {};
    var records = {};
    var rootCallMap = {};
    var nodeRangeMap = {};
    var rangeData = new GraphQLStoreRangeUtils();

    this._cacheManager = null;
    this._cachedRecords = cachedRecords;
    this._cachedRootCallMap = cachedRootCallMap;
    this._cachedStore = new RelayRecordStore({ cachedRecords: cachedRecords, records: records }, { cachedRootCallMap: cachedRootCallMap, rootCallMap: rootCallMap }, nodeRangeMap);
    this._changeEmitter = new GraphQLStoreChangeEmitter(rangeData);
    this._mutationQueue = new RelayMutationQueue(this);
    this._networkLayer = new RelayNetworkLayer();
    this._nodeRangeMap = nodeRangeMap;
    this._pendingQueryTracker = new RelayPendingQueryTracker(this);
    this._queryRunner = new GraphQLQueryRunner(this);
    this._queryTracker = new RelayQueryTracker();
    this._queuedRecords = queuedRecords;
    this._queuedStore = new RelayRecordStore({ cachedRecords: cachedRecords, queuedRecords: queuedRecords, records: records }, { cachedRootCallMap: cachedRootCallMap, rootCallMap: rootCallMap }, nodeRangeMap);
    this._records = records;
    this._recordStore = new RelayRecordStore({ records: records }, { rootCallMap: rootCallMap }, nodeRangeMap);
    this._rangeData = rangeData;
    this._rootCallMap = rootCallMap;
    this._taskQueue = new RelayTaskQueue();
    this._fragmentTracker = new RelayFragmentTracker();
  }

  /**
   * Creates a garbage collector for this instance. After initialization all
   * newly added DataIDs will be registered in the created garbage collector.
   * This will show a warning if data has already been added to the instance.
   */

  RelayStoreData.prototype.initializeGarbageCollector = function initializeGarbageCollector(scheduler) {
    !!this._garbageCollector ? process.env.NODE_ENV !== 'production' ? invariant(false, 'RelayStoreData: Garbage collector is already initialized.') : invariant(false) : undefined;
    var shouldInitialize = this._isStoreDataEmpty();
    process.env.NODE_ENV !== 'production' ? warning(shouldInitialize, 'RelayStoreData: Garbage collection can only be initialized when no ' + 'data is present.') : undefined;
    if (shouldInitialize) {
      this._garbageCollector = new RelayGarbageCollector(this, scheduler);
    }
  };

  /**
   * Sets/clears the scheduling function used by the internal task queue to
   * schedule units of work for execution.
   */

  RelayStoreData.prototype.injectTaskScheduler = function injectTaskScheduler(scheduler) {
    this._taskQueue.injectScheduler(scheduler);
  };

  /**
   * Sets/clears the cache manager that is used to cache changes written to
   * the store.
   */

  RelayStoreData.prototype.injectCacheManager = function injectCacheManager(cacheManager) {
    this._cacheManager = cacheManager;
  };

  RelayStoreData.prototype.clearCacheManager = function clearCacheManager() {
    this._cacheManager = null;
  };

  RelayStoreData.prototype.hasCacheManager = function hasCacheManager() {
    return !!this._cacheManager;
  };

  /**
   * Returns whether a given record is affected by an optimistic update.
   */

  RelayStoreData.prototype.hasOptimisticUpdate = function hasOptimisticUpdate(dataID) {
    dataID = this.getRangeData().getCanonicalClientID(dataID);
    return this.getQueuedStore().hasOptimisticUpdate(dataID);
  };

  /**
   * Returns a list of client mutation IDs for queued mutations whose optimistic
   * updates are affecting the record corresponding the given dataID. Returns
   * null if the record isn't affected by any optimistic updates.
   */

  RelayStoreData.prototype.getClientMutationIDs = function getClientMutationIDs(dataID) {
    dataID = this.getRangeData().getCanonicalClientID(dataID);
    return this.getQueuedStore().getClientMutationIDs(dataID);
  };

  /**
   * Reads data for queries incrementally from disk cache.
   * It calls onSuccess when all the data has been loaded into memory.
   * It calls onFailure when some data is unabled to be satisfied from disk.
   */

  RelayStoreData.prototype.readFromDiskCache = function readFromDiskCache(queries, callbacks) {
    var _this = this;

    var cacheManager = this._cacheManager;
    !cacheManager ? process.env.NODE_ENV !== 'production' ? invariant(false, 'RelayStoreData: `readFromDiskCache` should only be called when cache ' + 'manager is available.') : invariant(false) : undefined;
    var changeTracker = new RelayChangeTracker();
    var profile = RelayProfiler.profile('RelayStoreData.readFromDiskCache');
    RelayDiskCacheReader.readQueries(queries, this._queuedStore, this._cachedRecords, this._cachedRootCallMap, this._garbageCollector, cacheManager, changeTracker, {
      onSuccess: function onSuccess() {
        _this._handleChangedAndNewDataIDs(changeTracker.getChangeSet());
        profile.stop();
        callbacks.onSuccess && callbacks.onSuccess();
      },
      onFailure: function onFailure() {
        _this._handleChangedAndNewDataIDs(changeTracker.getChangeSet());
        profile.stop();
        callbacks.onFailure && callbacks.onFailure();
      }
    });
  };

  /**
   * Reads data for a fragment incrementally from disk cache.
   * It calls onSuccess when all the data has been loaded into memory.
   * It calls onFailure when some data is unabled to be satisfied from disk.
   */

  RelayStoreData.prototype.readFragmentFromDiskCache = function readFragmentFromDiskCache(dataID, fragment, path, callbacks) {
    var _this2 = this;

    var cacheManager = this._cacheManager;
    !cacheManager ? process.env.NODE_ENV !== 'production' ? invariant(false, 'RelayStoreData: `readFragmentFromDiskCache` should only be called ' + 'when cache manager is available.') : invariant(false) : undefined;
    var changeTracker = new RelayChangeTracker();
    var profile = RelayProfiler.profile('RelayStoreData.readFragmentFromDiskCache');
    RelayDiskCacheReader.readFragment(dataID, fragment, path, this._queuedStore, this._cachedRecords, this._cachedRootCallMap, this._garbageCollector, cacheManager, changeTracker, {
      onSuccess: function onSuccess() {
        _this2._handleChangedAndNewDataIDs(changeTracker.getChangeSet());
        profile.stop();
        callbacks.onSuccess && callbacks.onSuccess();
      },
      onFailure: function onFailure() {
        _this2._handleChangedAndNewDataIDs(changeTracker.getChangeSet());
        profile.stop();
        callbacks.onFailure && callbacks.onFailure();
      }
    });
  };

  /**
   * Write the results of a query into the base record store.
   */

  RelayStoreData.prototype.handleQueryPayload = function handleQueryPayload(query, response, forceIndex) {
    var profiler = RelayProfiler.profile('RelayStoreData.handleQueryPayload');
    var changeTracker = new RelayChangeTracker();
    var writer = new RelayQueryWriter(this._queuedStore, this.getRecordWriter(), this._queryTracker, changeTracker, this._fragmentTracker, {
      forceIndex: forceIndex,
      updateTrackedQueries: true
    });
    writeRelayQueryPayload(writer, query, response);
    this._handleChangedAndNewDataIDs(changeTracker.getChangeSet());
    profiler.stop();
  };

  /**
   * Write the results of an update into the base record store.
   */

  RelayStoreData.prototype.handleUpdatePayload = function handleUpdatePayload(operation, payload, _ref) {
    var configs = _ref.configs;
    var isOptimisticUpdate = _ref.isOptimisticUpdate;

    var profiler = RelayProfiler.profile('RelayStoreData.handleUpdatePayload');
    var changeTracker = new RelayChangeTracker();
    var recordWriter = undefined;
    if (isOptimisticUpdate) {
      var clientMutationID = payload[CLIENT_MUTATION_ID];
      !(typeof clientMutationID === 'string') ? process.env.NODE_ENV !== 'production' ? invariant(false, 'RelayStoreData.handleUpdatePayload(): Expected optimistic payload ' + 'to have a valid `%s`.', CLIENT_MUTATION_ID) : invariant(false) : undefined;
      recordWriter = this.getRecordWriterForOptimisticMutation(clientMutationID);
    } else {
      recordWriter = this._getRecordWriterForMutation();
    }
    var writer = new RelayQueryWriter(this._queuedStore, recordWriter, this._queryTracker, changeTracker, this._fragmentTracker, {
      forceIndex: generateForceIndex(),
      isOptimisticUpdate: isOptimisticUpdate,
      updateTrackedQueries: false
    });
    writeRelayUpdatePayload(writer, operation, payload, { configs: configs, isOptimisticUpdate: isOptimisticUpdate });
    this._handleChangedAndNewDataIDs(changeTracker.getChangeSet());
    profiler.stop();
  };

  /**
   * Given a query fragment and a data ID, returns a root query that applies
   * the fragment to the object specified by the data ID.
   */

  RelayStoreData.prototype.buildFragmentQueryForDataID = function buildFragmentQueryForDataID(fragment, dataID) {
    if (RelayRecord.isClientID(dataID)) {
      var path = this._queuedStore.getPathToRecord(this._rangeData.getCanonicalClientID(dataID));
      !path ? process.env.NODE_ENV !== 'production' ? invariant(false, 'RelayStoreData.buildFragmentQueryForDataID(): Cannot refetch ' + 'record `%s` without a path.', dataID) : invariant(false) : undefined;
      return RelayQueryPath.getQuery(this._cachedStore, path, fragment);
    }
    // Fragment fields cannot be spread directly into the root because they
    // may not exist on the `Node` type.
    return RelayQuery.Root.build(fragment.getDebugName() || 'UnknownQuery', NODE, dataID, [idField, typeField, fragment], {
      identifyingArgName: ID,
      identifyingArgType: ID_TYPE,
      isAbstract: true,
      isDeferred: false,
      isPlural: false
    }, NODE_TYPE);
  };

  RelayStoreData.prototype.getNodeData = function getNodeData() {
    return this._records;
  };

  RelayStoreData.prototype.getQueuedData = function getQueuedData() {
    return this._queuedRecords;
  };

  RelayStoreData.prototype.clearQueuedData = function clearQueuedData() {
    var _this3 = this;

    forEachObject(this._queuedRecords, function (_, key) {
      delete _this3._queuedRecords[key];
      _this3._changeEmitter.broadcastChangeForID(key);
    });
  };

  RelayStoreData.prototype.getCachedData = function getCachedData() {
    return this._cachedRecords;
  };

  RelayStoreData.prototype.getFragmentTracker = function getFragmentTracker() {
    return this._fragmentTracker;
  };

  RelayStoreData.prototype.getGarbageCollector = function getGarbageCollector() {
    return this._garbageCollector;
  };

  RelayStoreData.prototype.getMutationQueue = function getMutationQueue() {
    return this._mutationQueue;
  };

  RelayStoreData.prototype.getNetworkLayer = function getNetworkLayer() {
    return this._networkLayer;
  };

  /**
   * Get the record store with only the cached and base data (no queued data).
   */

  RelayStoreData.prototype.getCachedStore = function getCachedStore() {
    return this._cachedStore;
  };

  /**
   * Get the record store with full data (cached, base, queued).
   */

  RelayStoreData.prototype.getQueuedStore = function getQueuedStore() {
    return this._queuedStore;
  };

  /**
   * Get the record store with only the base data (no queued/cached data).
   */

  RelayStoreData.prototype.getRecordStore = function getRecordStore() {
    return this._recordStore;
  };

  /**
   * Get the record writer for the base data.
   */

  RelayStoreData.prototype.getRecordWriter = function getRecordWriter() {
    return new RelayRecordWriter(this._records, this._rootCallMap, false, // isOptimistic
    this._nodeRangeMap, this._cacheManager ? this._cacheManager.getQueryWriter() : null);
  };

  RelayStoreData.prototype.getQueryTracker = function getQueryTracker() {
    return this._queryTracker;
  };

  RelayStoreData.prototype.getQueryRunner = function getQueryRunner() {
    return this._queryRunner;
  };

  RelayStoreData.prototype.getChangeEmitter = function getChangeEmitter() {
    return this._changeEmitter;
  };

  RelayStoreData.prototype.getRangeData = function getRangeData() {
    return this._rangeData;
  };

  RelayStoreData.prototype.getPendingQueryTracker = function getPendingQueryTracker() {
    return this._pendingQueryTracker;
  };

  RelayStoreData.prototype.getTaskQueue = function getTaskQueue() {
    return this._taskQueue;
  };

  /**
   * @deprecated
   *
   * Used temporarily by GraphQLStore, but all updates to this object are now
   * handled through a `RelayRecordStore` instance.
   */

  RelayStoreData.prototype.getRootCallData = function getRootCallData() {
    return this._rootCallMap;
  };

  RelayStoreData.prototype._isStoreDataEmpty = function _isStoreDataEmpty() {
    return _Object$keys(this._records).length === 0 && _Object$keys(this._queuedRecords).length === 0 && _Object$keys(this._cachedRecords).length === 0;
  };

  /**
   * Given a ChangeSet, broadcasts changes for updated DataIDs
   * and registers new DataIDs with the garbage collector.
   */

  RelayStoreData.prototype._handleChangedAndNewDataIDs = function _handleChangedAndNewDataIDs(changeSet) {
    var _this4 = this;

    var updatedDataIDs = _Object$keys(changeSet.updated);
    var createdDataIDs = _Object$keys(changeSet.created);
    var gc = this._garbageCollector;
    updatedDataIDs.forEach(function (id) {
      return _this4._changeEmitter.broadcastChangeForID(id);
    });
    // Containers may be subscribed to "new" records in the case where they
    // were previously garbage collected or where the link was incrementally
    // loaded from cache prior to the linked record.
    createdDataIDs.forEach(function (id) {
      gc && gc.register(id);
      _this4._changeEmitter.broadcastChangeForID(id);
    });
  };

  RelayStoreData.prototype._getRecordWriterForMutation = function _getRecordWriterForMutation() {
    return new RelayRecordWriter(this._records, this._rootCallMap, false, // isOptimistic
    this._nodeRangeMap, this._cacheManager ? this._cacheManager.getMutationWriter() : null);
  };

  RelayStoreData.prototype.getRecordWriterForOptimisticMutation = function getRecordWriterForOptimisticMutation(clientMutationID) {
    return new RelayRecordWriter(this._queuedRecords, this._rootCallMap, true, // isOptimistic
    this._nodeRangeMap, null, // don't cache optimistic data
    clientMutationID);
  };

  return RelayStoreData;
})();

RelayProfiler.instrumentMethods(RelayStoreData.prototype, {
  handleQueryPayload: 'RelayStoreData.prototype.handleQueryPayload',
  handleUpdatePayload: 'RelayStoreData.prototype.handleUpdatePayload'
});

module.exports = RelayStoreData;