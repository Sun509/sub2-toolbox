// 账号模型巡检模块
(function () {
  'use strict';

  const CONFIG = {
    apiBase: location.origin,
    pageSize: 100,
    defaultTimeoutMs: 45000,
    defaultConcurrency: 3,
    maxConcurrency: 20,
    prompt: 'hi',

    onlyCheckSchedulable: false,
    stopOnFirstModelFailure: true,

    preferredModels: [
      'gpt-5.5',
      'gpt-5.4',
      'gpt-5.4-mini',
      'gpt-5.3-codex',
      'gpt-5.3-codex-spark',
      'gpt-5.2',
      'gpt-4o-mini',
      'gpt-4o',
      'gpt-4.1',
      'gpt-4.1-mini',
      'gpt-image-1',
      'gpt-image-1.5',
      'gpt-image-2',
    ],

    defaultTestModel: 'gpt-5.2',

    defaultModelOptions: [
      'gpt-5.5',
      'gpt-5.4',
      'gpt-5.4-mini',
      'gpt-5.3-codex',
      'gpt-5.3-codex-spark',
      'gpt-5.2',
      'gpt-4o-mini',
      'gpt-4o',
      'gpt-4.1',
      'gpt-4.1-mini',
      'gpt-image-1',
      'gpt-image-1.5',
      'gpt-image-2',
    ],

    defaultGroup: '',

    pageAuthTokenKey: 'auth_token',
    authStorageKey: '__sub2api_checker_auth__',
    timeoutStorageKey: '__sub2api_checker_timeout_ms__',
    concurrencyStorageKey: '__sub2api_checker_concurrency__',
    testModelStorageKey: '__sub2api_checker_test_model__',
    groupStorageKey: '__sub2api_checker_group__',
    privacyModeStorageKey: '__sub2api_checker_privacy_mode__',
    accountStatusStorageKey: '__sub2api_checker_account_status__',
    deleteStatusStorageKey: '__sub2api_checker_delete_status__',
    moveStatusStorageKey: '__sub2api_checker_move_status__',
    moveTargetGroupStorageKey: '__sub2api_checker_move_target_group__',
    scheduledCronStorageKey: '__sub2api_checker_scheduled_cron__',
    scheduledMaxResultsStorageKey: '__sub2api_checker_scheduled_max_results__',
    scheduledEnabledStorageKey: '__sub2api_checker_scheduled_enabled__',
    scheduledAutoRecoverStorageKey: '__sub2api_checker_scheduled_auto_recover__',
    scheduledUpdateExistingStorageKey: '__sub2api_checker_scheduled_update_existing__',
  };

  function sleep(ms) {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }

  function normalizeGroupName(group) {
    return String(group || '').trim().replace(/^\/+/, '');
  }

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

    timeoutMs: Number(localStorage.getItem(CONFIG.timeoutStorageKey) || CONFIG.defaultTimeoutMs),
    concurrency: Number(localStorage.getItem(CONFIG.concurrencyStorageKey) || CONFIG.defaultConcurrency),
    testModel: localStorage.getItem(CONFIG.testModelStorageKey) || CONFIG.defaultTestModel,
    targetGroup: normalizeGroupName(localStorage.getItem(CONFIG.groupStorageKey) || CONFIG.defaultGroup),

    groups: [],
    modelOptions: Array.from(new Set(CONFIG.defaultModelOptions || [])),

    privacyMode: localStorage.getItem(CONFIG.privacyModeStorageKey) || 'private',
    accountStatus: localStorage.getItem(CONFIG.accountStatusStorageKey) || 'active',
    deleteStatus: localStorage.getItem(CONFIG.deleteStatusStorageKey) || 'error',
    moveStatus: localStorage.getItem(CONFIG.moveStatusStorageKey) || 'limited',
    moveTargetGroup: normalizeGroupName(localStorage.getItem(CONFIG.moveTargetGroupStorageKey) || ''),
    scheduledCron: localStorage.getItem(CONFIG.scheduledCronStorageKey) || '*/30 * * * *',
    scheduledMaxResults: Number(localStorage.getItem(CONFIG.scheduledMaxResultsStorageKey) || 100),
    scheduledEnabled:
      localStorage.getItem(CONFIG.scheduledEnabledStorageKey) === null
        ? true
        : localStorage.getItem(CONFIG.scheduledEnabledStorageKey) === 'true',
    scheduledAutoRecover:
      localStorage.getItem(CONFIG.scheduledAutoRecoverStorageKey) === null
        ? true
        : localStorage.getItem(CONFIG.scheduledAutoRecoverStorageKey) === 'true',
    scheduledUpdateExisting:
      localStorage.getItem(CONFIG.scheduledUpdateExistingStorageKey) === null
        ? true
        : localStorage.getItem(CONFIG.scheduledUpdateExistingStorageKey) === 'true',

    running: false,
    stopRequested: false,
    panelReady: false,
    collapsed: true,
    metaLoading: false,

    stats: {
      total: 0,
      checked: 0,
      ok: 0,
      enabled: 0,
      disabled: 0,
      skipped: 0,
      failed: 0,
    },
  };
