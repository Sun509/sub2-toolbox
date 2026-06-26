  function getModels(account) {
    const targetModel = String(state.testModel || '').trim();

    if (targetModel) return [targetModel];

    const mapping = account?.credentials?.model_mapping || {};
    const keys = Object.keys(mapping).filter(Boolean);

    if (keys.length <= 1) return keys;

    const preferred = [];

    for (const model of CONFIG.preferredModels) {
      if (keys.includes(model)) preferred.push(model);
    }

    const rest = keys.filter((k) => !preferred.includes(k)).sort();

    return [...preferred, ...rest];
  }

  async function testModel(accountId, modelId) {
    const controller = new AbortController();
    let timer = null;

    const resetTimer = () => {
      clearTimeout(timer);
      timer = setTimeout(() => controller.abort(new Error(`模型 ${modelId} 流式超时`)), state.timeoutMs);
    };

    try {
      resetTimer();

      const resp = await apiFetch(`${CONFIG.apiBase}/api/v1/admin/accounts/${accountId}/test`, {
        method: 'POST',
        headers: {
          Accept: '*/*',
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          model_id: modelId,
          prompt: CONFIG.prompt,
        }),
        signal: controller.signal,
      });

      if (!resp.ok) {
        clearTimeout(timer);
        return {
          ok: false,
          reason: `HTTP ${resp.status}`,
        };
      }

      const reader = resp.body?.getReader();

      if (!reader) {
        clearTimeout(timer);

        const text = await resp.text();

        return {
          ok: false,
          reason: `无响应流：${text.slice(0, 200)}`,
        };
      }

      const decoder = new TextDecoder();
      let buffer = '';

      while (true) {
        resetTimer();

        const { value, done } = await reader.read();

        if (done) break;

        buffer += decoder.decode(value, { stream: true }).replace(/\r/g, '');

        let splitIndex;

        while ((splitIndex = buffer.indexOf('\n\n')) >= 0) {
          const chunk = buffer.slice(0, splitIndex);
          buffer = buffer.slice(splitIndex + 2);

          const dataLines = chunk
            .split('\n')
            .map((line) => line.trim())
            .filter((line) => line.startsWith('data:'))
            .map((line) => line.slice(5).trim());

          for (const line of dataLines) {
            if (!line) continue;

            let event;

            try {
              event = JSON.parse(line);
            } catch (_) {
              continue;
            }

            if (event.type === 'error') {
              clearTimeout(timer);

              return {
                ok: false,
                reason: event.error || '未知错误',
              };
            }

            if (event.type === 'test_complete') {
              clearTimeout(timer);

              return {
                ok: !!event.success,
                reason: event.success ? 'success' : 'test_complete=false',
              };
            }
          }
        }
      }

      clearTimeout(timer);

      return {
        ok: false,
        reason: '响应流结束但没有 test_complete',
      };
    } catch (err) {
      clearTimeout(timer);

      return {
        ok: false,
        reason: err?.name === 'AbortError' ? '请求超时' : (err?.message || String(err)),
      };
    }
  }

  async function setAccountSchedulable(accountId, schedulable) {
    const resp = await apiFetch(`${CONFIG.apiBase}/api/v1/admin/accounts/${accountId}/schedulable`, {
      method: 'POST',
      headers: {
        Accept: 'application/json, text/plain, */*',
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        schedulable: !!schedulable,
      }),
    });

    if (!resp.ok) {
      return {
        ok: false,
        reason: `HTTP ${resp.status}`,
      };
    }

    const json = await resp.json();

    if (json.code !== 0) {
      return {
        ok: false,
        reason: json.message || `code=${json.code}`,
      };
    }

    return {
      ok: true,
      data: json.data,
    };
  }

  async function postJsonTryPayloads(url, payloads) {
    let lastResult = null;

    for (const payload of payloads) {
      const resp = await apiFetch(url, {
        method: 'POST',
        headers: {
          Accept: 'application/json, text/plain, */*',
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(payload),
      });

      const text = await resp.text();

      let json = null;
      try {
        json = JSON.parse(text);
      } catch (_) {}

      if (resp.ok && (!json || typeof json.code === 'undefined' || json.code === 0)) {
        return {
          ok: true,
          data: json || text,
          usedPayload: payload,
        };
      }

      lastResult = {
        ok: false,
        reason: `HTTP ${resp.status}: ${text.slice(0, 300)}`,
        payload,
      };

      if (![400, 422].includes(resp.status)) {
        break;
      }
    }

    return lastResult || {
      ok: false,
      reason: '未知错误',
    };
  }

  async function setAccountPrivacy(accountId, privacyMode) {
    const mode = String(privacyMode || 'private');

    const isPrivate = mode === 'private';
    const isPublic = mode === 'public';

    const payloads = [
      { privacy_mode: mode },
      { privacy: mode },
      { mode },
      { value: mode },
      { is_private: isPrivate },
      { private: isPrivate },
      { privacy_mode: isPrivate },
      { enabled: isPrivate },
    ];

    if (mode === 'inherit' || mode === 'default') {
      payloads.unshift(
        { privacy_mode: '' },
        { privacy_mode: null },
        { privacy: '' },
        { privacy: null }
      );
    }

    if (isPublic) {
      payloads.push(
        { is_public: true },
        { public: true }
      );
    }

    return postJsonTryPayloads(
      `${CONFIG.apiBase}/api/v1/admin/accounts/${accountId}/set-privacy`,
      payloads
    );
  }

  async function requestJson(method, url, payload) {
    const resp = await apiFetch(url, {
      method,
      headers: {
        Accept: 'application/json, text/plain, */*',
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(payload || {}),
    });

    const text = await resp.text();

    let json = null;
    try {
      json = JSON.parse(text);
    } catch (_) {}

    if (resp.ok && (!json || typeof json.code === 'undefined' || json.code === 0)) {
      return {
        ok: true,
        data: json || text,
        usedMethod: method,
        usedUrl: url,
        usedPayload: payload,
      };
    }

    return {
      ok: false,
      reason: `HTTP ${resp.status}: ${text.slice(0, 300)}`,
      status: resp.status,
      data: json || text,
      usedMethod: method,
      usedUrl: url,
      usedPayload: payload,
    };
  }

  async function tryJsonRequests(requests) {
    let lastResult = null;

    for (const request of requests) {
      const result = await requestJson(request.method, request.url, request.payload);

      if (result.ok) return result;

      lastResult = result;

      if (![400, 404, 405, 422].includes(result.status)) {
        break;
      }
    }

    return lastResult || {
      ok: false,
      reason: '未知错误',
    };
  }

  async function setAccountStatus(accountId, status) {
    const normalized = normalizeStatusText(status || 'active');

    if (normalized === 'active') {
      const schedulable = await setAccountSchedulable(accountId, true);
      if (schedulable.ok) return schedulable;
    }

    if (normalized === 'disabled' || normalized === 'inactive' || normalized === 'off') {
      const schedulable = await setAccountSchedulable(accountId, false);
      if (schedulable.ok) return schedulable;
    }

    const base = `${CONFIG.apiBase}/api/v1/admin/accounts/${accountId}`;
    const payloads = [
      { status: normalized },
      { state: normalized },
      { value: normalized },
      { account_status: normalized },
      { accountStatus: normalized },
      { enabled: normalized === 'active' },
      { active: normalized === 'active' },
      { disabled: normalized === 'disabled' },
    ];

    const requests = [];

    for (const payload of payloads) {
      requests.push(
        { method: 'POST', url: `${base}/status`, payload },
        { method: 'PUT', url: `${base}/status`, payload },
        { method: 'PATCH', url: base, payload },
        { method: 'PUT', url: base, payload }
      );
    }

    return tryJsonRequests(requests);
  }

  function getGroupIdByName(groupName) {
    const normalized = normalizeGroupName(groupName);

    if (!normalized) return '';

    const group = (state.groups || []).find((item) => {
      const name = typeof item === 'string' ? item : item?.name;
      return normalizeGroupName(name) === normalized;
    });

    return typeof group === 'object' ? (group.id || group.group_id || group.groupId || '') : '';
  }

  function buildAccountGroupPayloads(account, targetGroup) {
    const groupName = normalizeGroupName(targetGroup);
    const groupId = getGroupIdByName(groupName);
    const accountId = getAccountId(account);
    const payloads = [
      { group: groupName },
      { group_name: groupName },
      { target_group: groupName },
      { target_group_name: groupName },
      { account_id: accountId, group: groupName },
      { account_id: accountId, group_name: groupName },
      { account_id: accountId, target_group: groupName },
      { account_id: accountId, target_group_name: groupName },
      { groups: [groupName] },
      { account_ids: [accountId], group: groupName },
      { account_ids: [accountId], group_name: groupName },
      { account_ids: [accountId], target_group: groupName },
      { account_ids: [accountId], target_group_name: groupName },
    ];

    if (groupId) {
      payloads.unshift(
        { group_id: groupId },
        { target_group_id: groupId },
        { account_id: accountId, group_id: groupId },
        { account_id: accountId, target_group_id: groupId },
        { group_ids: [groupId] },
        { account_ids: [accountId], group_id: groupId },
        { account_ids: [accountId], target_group_id: groupId }
      );
    }

    return payloads;
  }

  async function moveAccountToGroup(account, targetGroup) {
    const accountId = getAccountId(account);
    const groupName = normalizeGroupName(targetGroup);
    const base = `${CONFIG.apiBase}/api/v1/admin/accounts/${accountId}`;
    const payloads = buildAccountGroupPayloads(account, groupName);
    const requests = [];

    for (const payload of payloads) {
      requests.push(
        { method: 'POST', url: `${base}/move-group`, payload },
        { method: 'POST', url: `${base}/set-group`, payload },
        { method: 'POST', url: `${base}/group`, payload },
        { method: 'PUT', url: `${base}/group`, payload },
        { method: 'POST', url: `${base}/groups`, payload },
        { method: 'PUT', url: `${base}/groups`, payload },
        { method: 'PATCH', url: base, payload },
        { method: 'PUT', url: base, payload },
        { method: 'POST', url: `${CONFIG.apiBase}/api/v1/admin/accounts/move-group`, payload },
        { method: 'POST', url: `${CONFIG.apiBase}/api/v1/admin/accounts/set-group`, payload },
        { method: 'POST', url: `${CONFIG.apiBase}/api/v1/admin/accounts/group`, payload },
        { method: 'POST', url: `${CONFIG.apiBase}/api/v1/admin/accounts/groups`, payload }
      );
    }

    return tryJsonRequests(requests);
  }

  function getAccountId(account) {
    return account?.id ?? account?.ID ?? account?.account_id ?? account?.accountId ?? '';
  }

  async function fetchAccountUsage(accountId) {
    const url = new URL(`/api/v1/admin/accounts/${accountId}/usage`, CONFIG.apiBase);

    url.searchParams.set('source', 'active');
    url.searchParams.set('force', 'true');
    url.searchParams.set('timezone', Intl.DateTimeFormat().resolvedOptions().timeZone || 'Asia/Shanghai');

    const resp = await apiFetch(url.toString(), {
      headers: {
        Accept: 'application/json, text/plain, */*',
      },
    });

    return parseJsonResponse(resp);
  }

  function isPlainUsageObject(value) {
    return !!value && typeof value === 'object' && !Array.isArray(value);
  }

  function formatUsagePrimitive(value) {
    if (typeof value === 'number' && Number.isFinite(value)) {
      return new Intl.NumberFormat().format(value);
    }

    if (typeof value === 'boolean') {
      return value ? 'true' : 'false';
    }

    if (value === null) return 'null';
    if (typeof value === 'undefined') return '';

    return String(value);
  }

  function findUsageValue(root, keys) {
    const queue = [{ value: root, depth: 0 }];
    const seen = new Set();

    while (queue.length) {
      const item = queue.shift();
      const value = item.value;

      if (!isPlainUsageObject(value) || seen.has(value) || item.depth > 4) continue;

      seen.add(value);

      for (const key of keys) {
        if (Object.prototype.hasOwnProperty.call(value, key)) {
          const found = value[key];
          if (found !== null && typeof found !== 'undefined' && typeof found !== 'object') return found;
        }
      }

      for (const child of Object.values(value)) {
        if (isPlainUsageObject(child)) {
          queue.push({ value: child, depth: item.depth + 1 });
        }
      }
    }

    return undefined;
  }

  function flattenUsagePrimitives(value, prefix = '', output = [], depth = 0) {
    if (output.length >= 8 || depth > 3 || !isPlainUsageObject(value)) return output;

    for (const [key, child] of Object.entries(value)) {
      if (output.length >= 8) break;

      const label = prefix ? `${prefix}.${key}` : key;

      if (child === null || ['string', 'number', 'boolean'].includes(typeof child)) {
        output.push([label, child]);
      } else if (isPlainUsageObject(child)) {
        flattenUsagePrimitives(child, label, output, depth + 1);
      }
    }

    return output;
  }

  function formatAccountUsageData(rawData) {
    const data = rawData?.data ?? rawData;

    if (!isPlainUsageObject(data)) {
      return formatUsagePrimitive(data || '无用量数据');
    }

    const metrics = [
      ['请求', ['request_count', 'requestCount', 'requests', 'total_requests', 'totalRequests', 'count']],
      ['输入 tokens', ['prompt_tokens', 'promptTokens', 'input_tokens', 'inputTokens', 'total_prompt_tokens', 'totalPromptTokens']],
      ['输出 tokens', ['completion_tokens', 'completionTokens', 'output_tokens', 'outputTokens', 'total_completion_tokens', 'totalCompletionTokens']],
      ['总 tokens', ['total_tokens', 'totalTokens', 'tokens', 'used_tokens', 'usedTokens']],
      ['费用', ['cost', 'total_cost', 'totalCost', 'amount', 'usage_cost', 'usageCost']],
      ['余额', ['balance', 'remaining', 'remaining_quota', 'remainingQuota', 'credit', 'quota']],
    ];

    const parts = [];

    for (const [label, keys] of metrics) {
      const value = findUsageValue(data, keys);
      if (typeof value !== 'undefined') {
        parts.push(`${label} ${formatUsagePrimitive(value)}`);
      }
    }

    if (parts.length) return parts.join(' | ');

    const flattened = flattenUsagePrimitives(data);
    if (flattened.length) {
      return flattened
        .map(([key, value]) => `${key}: ${formatUsagePrimitive(value)}`)
        .join(' | ');
    }

    try {
      return JSON.stringify(data).slice(0, 500);
    } catch (_) {
      return '无法显示用量数据';
    }
  }

  async function deleteAccount(accountId) {
    const resp = await apiFetch(`${CONFIG.apiBase}/api/v1/admin/accounts/${accountId}`, {
      method: 'DELETE',
      headers: {
        Accept: 'application/json, text/plain, */*',
      },
    });

    return parseJsonResponse(resp);
  }
