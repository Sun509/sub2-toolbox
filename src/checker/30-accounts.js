  function getAccountGroups(account) {
    const groups = [];

    if (Array.isArray(account?.account_groups)) {
      for (const item of account.account_groups) {
        const name = item?.group?.name;
        if (name) groups.push(normalizeGroupName(name));
      }
    }

    if (Array.isArray(account?.groups)) {
      for (const item of account.groups) {
        const name = item?.name;
        if (name) groups.push(normalizeGroupName(name));
      }
    }

    if (typeof account?.group === 'string') {
      groups.push(normalizeGroupName(account.group));
    }

    if (typeof account?.group_name === 'string') {
      groups.push(normalizeGroupName(account.group_name));
    }

    return Array.from(new Set(groups.filter(Boolean)));
  }

  function accountInTargetGroup(account, targetGroup) {
    const group = normalizeGroupName(targetGroup);

    if (!group) return true;

    const accountGroups = getAccountGroups(account);

    if (group === '未分配分组') {
      return accountGroups.length === 0;
    }

    return accountGroups.includes(group);
  }

  function normalizeStatusText(status) {
    if (status && typeof status === 'object') {
      return normalizeStatusText(status.value ?? status.name ?? status.status ?? status.label ?? '');
    }

    return String(status ?? '').trim().toLowerCase();
  }

  function getAccountStatus(account) {
    const candidates = [
      account?.status,
      account?.state,
      account?.health_status,
      account?.healthStatus,
      account?.check_status,
      account?.checkStatus,
      account?.test_status,
      account?.testStatus,
      account?.last_test_status,
      account?.lastTestStatus,
      account?.availability_status,
      account?.availabilityStatus,
    ];

    for (const item of candidates) {
      const normalized = normalizeStatusText(item);
      if (normalized) return normalized;
    }

    return '';
  }

  function isAccountStatusMatch(account, targetStatus) {
    const status = getAccountStatus(account);
    const target = normalizeStatusText(targetStatus);

    if (!target) return true;

    if (target === 'error') {
      return [
        'error',
        'errored',
        'failed',
        'failure',
        'invalid',
        'unavailable',
        'abnormal',
        '错误',
        '异常',
        '失败',
        '不可用',
        '无效',
      ].includes(status);
    }

    if (target === 'disabled') {
      return status === 'disabled' || status === 'inactive' || status === 'off' || status === '已停用' || status === '关闭';
    }

    if (target === 'active') {
      return status === 'active' || status === 'enabled' || status === 'ok' || status === 'normal' || status === '正常' || status === '可用';
    }

    if (target === 'limited' || target === 'rate_limited' || target === 'throttled' || target === '限流') {
      return [
        'limited',
        'rate_limited',
        'ratelimited',
        'rate limited',
        'throttled',
        'quota_exceeded',
        'quota exceeded',
        'too_many_requests',
        'too many requests',
        '429',
        '限流',
        '被限流',
        '频率限制',
        '额度不足',
      ].includes(status);
    }

    return status === target;
  }

  function filterAccountsByStatus(accounts, targetStatus) {
    const status = normalizeStatusText(targetStatus);

    if (!status) return accounts;

    return accounts.filter((account) => isAccountStatusMatch(account, status));
  }

  function extractModelsFromAccount(account) {
    const models = [];

    const mapping = account?.credentials?.model_mapping;
    if (mapping && typeof mapping === 'object') {
      models.push(...Object.keys(mapping).filter(Boolean));
    }

    const candidates = [
      account?.models,
      account?.model_ids,
      account?.modelIds,
      account?.supported_models,
      account?.supportedModels,

      account?.credentials?.models,
      account?.credentials?.model_ids,
      account?.credentials?.modelIds,
      account?.credentials?.supported_models,
      account?.credentials?.supportedModels,

      account?.config?.models,
      account?.config?.model_ids,
      account?.config?.supported_models,
    ];

    for (const item of candidates) {
      if (!item) continue;

      if (Array.isArray(item)) {
        for (const x of item) {
          if (typeof x === 'string') {
            models.push(x);
          } else if (x && typeof x === 'object') {
            const name = x.id || x.name || x.model || x.value;
            if (name) models.push(String(name));
          }
        }
      } else if (typeof item === 'object') {
        models.push(...Object.keys(item).filter(Boolean));
      } else if (typeof item === 'string') {
        models.push(item);
      }
    }

    return models.map((x) => String(x).trim()).filter(Boolean);
  }

  async function fetchAllAccountsRaw() {
    let page = 1;
    const items = [];

    while (true) {
      const url = new URL('/api/v1/admin/accounts', CONFIG.apiBase);

      url.searchParams.set('page', String(page));
      url.searchParams.set('page_size', String(CONFIG.pageSize));
      url.searchParams.set('platform', '');
      url.searchParams.set('type', '');
      url.searchParams.set('status', '');
      url.searchParams.set('privacy_mode', '');
      url.searchParams.set('group', '');
      url.searchParams.set('search', '');
      url.searchParams.set('timezone', Intl.DateTimeFormat().resolvedOptions().timeZone || 'Asia/Shanghai');

      const resp = await apiFetch(url.toString(), {
        headers: {
          Accept: 'application/json, text/plain, */*',
        },
      });

      if (!resp.ok) {
        throw new Error(`账号列表请求失败：HTTP ${resp.status}`);
      }

      const json = await resp.json();

      if (json.code !== 0) {
        throw new Error(`账号列表返回异常：${json.message || json.code}`);
      }

      const pageItems = json?.data?.items || [];
      items.push(...pageItems);

      const pages = Number(json?.data?.pages || 1);

      if (page >= pages || pageItems.length === 0) break;

      page += 1;
    }

    return items;
  }

  async function fetchAccounts() {
    const allItems = await fetchAllAccountsRaw();

    const targetGroup = normalizeGroupName(state.targetGroup);

    if (!targetGroup) {
      return allItems;
    }

    const filtered = allItems.filter((account) => accountInTargetGroup(account, targetGroup));

    log(`已按分组 ${targetGroup} 本地过滤：${filtered.length} / ${allItems.length} 个账号`, 'success');

    if (!filtered.length && allItems.length) {
      const sample = allItems[0];

      log(`警告：没有匹配到分组 ${targetGroup}`, 'warn');
      log(`第一个账号可识别分组：${getAccountGroups(sample).join(', ') || '无'}`, 'warn');

      try {
        console.log('[sub2api-checker] 第一个账号对象，用于排查分组字段：', sample);
      } catch (_) {}
    }

    return filtered;
  }

  async function fetchGroupsFromAccounts() {
    const groupMap = new Map();

    const accounts = await fetchAllAccountsRaw();

    let hasUngrouped = false;

    for (const account of accounts) {
      const accountGroups = getAccountGroups(account);

      if (!accountGroups.length) {
        hasUngrouped = true;
      }

      if (Array.isArray(account?.account_groups)) {
        for (const item of account.account_groups) {
          const groupObj = item?.group;

          if (groupObj?.name) {
            const name = normalizeGroupName(groupObj.name);

            groupMap.set(name, {
              name,
              id: groupObj.id,
              status: groupObj.status || '',
            });
          }
        }
      }

      if (Array.isArray(account?.groups)) {
        for (const groupObj of account.groups) {
          if (groupObj?.name) {
            const name = normalizeGroupName(groupObj.name);

            groupMap.set(name, {
              name,
              id: groupObj.id,
              status: groupObj.status || '',
            });
          }
        }
      }
    }

    const result = [];

    if (hasUngrouped) {
      result.push({
        name: '未分配分组',
        id: '',
        status: '',
      });
    }

    result.push(...Array.from(groupMap.values()));

    result.sort((a, b) => {
      if (a.name === '未分配分组') return -1;
      if (b.name === '未分配分组') return 1;
      return a.name.localeCompare(b.name);
    });

    return result;
  }

  async function loadGroups() {
    try {
      log('开始从账号列表读取分组');

      const groups = await fetchGroupsFromAccounts();

      state.groups = groups;

      renderGroupSelect();

      const names = groups.map((x) => typeof x === 'string' ? x : x.name);

      log(`已读取到 ${groups.length} 个分组：${names.join(', ') || '无'}`, 'success');

      if (!groups.length) {
        log('未读取到分组，请确认账号列表接口返回 account_groups 或 groups 字段', 'warn');
      }
    } catch (err) {
      log(`读取分组失败：${err.message}`, 'error');
      throw err;
    }
  }

  async function loadModels() {
    try {
      log('开始自动读取模型列表');

      const accounts = await fetchAllAccountsRaw();

      const models = [];

      for (const account of accounts) {
        models.push(...extractModelsFromAccount(account));
      }

      state.modelOptions = sortModels([
        ...(CONFIG.defaultModelOptions || []),
        ...models,
      ]);

      renderModelSelect();

      log(`已读取到 ${state.modelOptions.length} 个模型`, 'success');
    } catch (err) {
      log(`读取模型失败：${err.message}`, 'error');
      throw err;
    }
  }

  async function autoLoadMetaWithRetry(maxRetry = 8) {
    if (state.metaLoading) {
      log('分组/模型正在读取中，本次自动刷新跳过', 'warn');
      return;
    }

    state.metaLoading = true;

    try {
      for (let i = 1; i <= maxRetry; i++) {
        try {
          const cached = getCachedAuthToken();

          if (cached) {
            state.authHeader = cached;

            const input = document.querySelector('#sub2api-checker-auth');
            if (input && !input.value) input.value = cached;
          }

          if (!state.authHeader) {
            log(`自动读取分组/模型等待 Authorization，第 ${i}/${maxRetry} 次`, 'warn');
            await sleep(800);
            continue;
          }

          log('开始自动读取分组和模型');

          await loadGroups();
          await loadModels();

          log('分组和模型自动读取完成', 'success');
          return;
        } catch (err) {
          log(`自动读取分组/模型失败，第 ${i}/${maxRetry} 次：${err.message}`, 'warn');
          await sleep(1000);
        }
      }

      log('自动读取分组/模型最终失败，请点刷新按钮或刷新页面重试', 'error');
    } finally {
      state.metaLoading = false;
    }
  }
