// 批量导入账号模块
(function () {
  'use strict';

  const CONFIG = {
    apiBase: location.origin,
    importApi: '/api/v1/admin/accounts/data',

    pageAuthTokenKey: 'auth_token',
    authStorageKey: '__sub2api_importer_auth__',
    batchSizeStorageKey: '__sub2api_importer_batch_size__',
    skipDefaultGroupBindStorageKey: '__sub2api_importer_skip_default_group_bind__',
    importGroupStorageKey: '__sub2api_importer_target_group__',

    defaultBatchSize: 20,
    defaultSkipDefaultGroupBind: true,
    defaultImportGroup: '',
    requestIntervalMs: 300,
  };

  function getCachedAuthToken() {
    const raw =
      localStorage.getItem(CONFIG.pageAuthTokenKey) ||
      sessionStorage.getItem(CONFIG.pageAuthTokenKey) ||
      localStorage.getItem(CONFIG.authStorageKey) ||
      '';

    return raw ? (raw.startsWith('Bearer ') ? raw : `Bearer ${raw}`) : '';
  }

  const state = {
    authHeader: getCachedAuthToken(),
    running: false,
    stopRequested: false,
    panelReady: false,
    collapsed: true,

    batchSize: Number(localStorage.getItem(CONFIG.batchSizeStorageKey) || CONFIG.defaultBatchSize),
    targetGroup: normalizeGroupName(localStorage.getItem(CONFIG.importGroupStorageKey) || CONFIG.defaultImportGroup),

    skipDefaultGroupBind:
      localStorage.getItem(CONFIG.skipDefaultGroupBindStorageKey) === null
        ? CONFIG.defaultSkipDefaultGroupBind
        : localStorage.getItem(CONFIG.skipDefaultGroupBindStorageKey) === 'true',

    stats: {
      total: 0,
      imported: 0,
      failed: 0,
      batches: 0,
    },
  };
