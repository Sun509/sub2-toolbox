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

  function getAccountDisplayName(account) {
    return String(
      account?.name ||
      account?.email ||
      account?.username ||
      account?.account ||
      account?.account_name ||
      account?.accountName ||
      account?.credentials?.email ||
      account?.credentials?.username ||
      account?.credentials?.account ||
      ''
    ).trim();
  }

  function getAccountCreatedTime(account) {
    const value =
      account?.created_at ??
      account?.createdAt ??
      account?.created_time ??
      account?.createdTime ??
      account?.create_time ??
      account?.createTime ??
      account?.created ??
      account?.create_at ??
      account?.createAt ??
      '';

    if (typeof value === 'number' && Number.isFinite(value)) {
      return value > 100000000000 ? value : value * 1000;
    }

    const text = String(value || '').trim();
    if (!text) return 0;

    const parsed = Date.parse(text);
    return Number.isFinite(parsed) ? parsed : 0;
  }

  function sortAccountsByCreatedTime(accounts, direction = 'desc') {
    const multiplier = direction === 'asc' ? 1 : -1;

    return accounts.slice().sort((a, b) => {
      const at = getAccountCreatedTime(a);
      const bt = getAccountCreatedTime(b);

      if (at !== bt) return (at - bt) * multiplier;

      return String(getAccountId(a)).localeCompare(String(getAccountId(b)));
    });
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

  function normalizeUsageKey(key) {
    return String(key || '').replace(/[^a-z0-9]/gi, '').toLowerCase();
  }

  function shouldSkipUsageScanKey(key) {
    const normalized = normalizeUsageKey(key);

    if (['token', 'tokens', 'inputtokens', 'outputtokens', 'totaltokens', 'usedtokens'].includes(normalized)) {
      return false;
    }

    return [
      'credential',
      'authorization',
      'password',
      'secret',
      'cookie',
      'proxy',
      'apikey',
      'accesskey',
      'refreshkey',
    ].some((item) => normalized.includes(item));
  }

  function getLooseUsageValue(obj, aliases) {
    if (!isPlainUsageObject(obj)) return undefined;

    const normalizedAliases = aliases.map(normalizeUsageKey);

    for (const [key, value] of Object.entries(obj)) {
      const normalized = normalizeUsageKey(key);
      if (normalizedAliases.includes(normalized)) return value;
    }

    for (const [key, value] of Object.entries(obj)) {
      const normalized = normalizeUsageKey(key);

      if (normalizedAliases.some((alias) => alias.length > 3 && normalized.includes(alias))) {
        return value;
      }
    }

    return undefined;
  }

  function formatUsagePercent(value) {
    const raw = String(value ?? '').trim();
    const n = Number(raw.replace(/%$/u, ''));

    if (!Number.isFinite(n)) return formatUsagePrimitive(value);

    const percent = n > 0 && n <= 1 ? n * 100 : n;
    const rounded = Math.round(percent * 10) / 10;

    return `${rounded}%`.replace('.0%', '%');
  }

  function hasUsageDisplayValue(value) {
    if (value === null || typeof value === 'undefined') return false;
    if (typeof value === 'string' && !value.trim()) return false;
    return true;
  }

  function normalizeUsageLabel(value, fallbackLabel) {
    if (typeof value === 'string' || typeof value === 'number') {
      const text = String(value).trim();
      if (text && text !== '[object Object]') return text;
    }

    return fallbackLabel || '窗口';
  }

  function looksLikeUsageWindowObject(value, path) {
    if (!isPlainUsageObject(value)) return false;

    const keysText = Object.keys(value).map(normalizeUsageKey).join(' ');
    const pathText = normalizeUsageKey(path);
    const hasWindowHint = /(window|period|duration|reset|ratelimit|usagelimit|quota|throttle)/u.test(keysText);
    const hasUsageField = /(percent|percentage|ratio|used|current|limit|quota|max|remaining|reset|request|token|cost)/u.test(keysText);

    return hasWindowHint && hasUsageField && !/(name|email|account)$/u.test(pathText);
  }

  function formatUsageWindowCandidate(value, fallbackLabel) {
    if (!isPlainUsageObject(value)) return '';

    const label = normalizeUsageLabel(
      getLooseUsageValue(value, ['window', 'window_name', 'windowLabel', 'duration', 'period', 'time_window', 'timeWindow', 'label', 'name', 'key', 'type']) ||
      fallbackLabel,
      fallbackLabel || '窗口'
    );
    const percent = getLooseUsageValue(value, ['percent', 'percentage', 'usage_percent', 'usagePercent', 'used_percent', 'usedPercent', 'ratio', 'usage_ratio', 'usageRate']);
    const used = getLooseUsageValue(value, ['used', 'current', 'count', 'request_count', 'requestCount', 'requests', 'token', 'tokens', 'used_tokens', 'usedTokens']);
    const limit = getLooseUsageValue(value, ['limit', 'max', 'quota', 'total', 'capacity']);
    const remaining = getLooseUsageValue(value, ['remaining', 'left', 'available']);
    const remainingTime = getLooseUsageValue(value, ['remaining_time', 'remainingTime', 'reset_in', 'resetIn', 'reset_after', 'resetAfter', 'ttl', 'next_reset_in', 'nextResetIn', 'time_left', 'timeLeft']);
    const resetAt = getLooseUsageValue(value, ['reset_at', 'resetAt', 'reset_time', 'resetTime', 'next_reset_at', 'nextResetAt', 'expires_at', 'expiresAt']);
    const status = getLooseUsageValue(value, ['status', 'state']);
    const parts = [];

    if (hasUsageDisplayValue(percent)) parts.push(formatUsagePercent(percent));

    if (hasUsageDisplayValue(used) && hasUsageDisplayValue(limit)) {
      parts.push(`${formatUsagePrimitive(used)}/${formatUsagePrimitive(limit)}`);
    } else if (hasUsageDisplayValue(used)) {
      parts.push(`已用 ${formatUsagePrimitive(used)}`);
    } else if (hasUsageDisplayValue(limit)) {
      parts.push(`上限 ${formatUsagePrimitive(limit)}`);
    }

    if (hasUsageDisplayValue(remaining) && !hasUsageDisplayValue(used)) {
      parts.push(`剩余 ${formatUsagePrimitive(remaining)}`);
    }

    if (hasUsageDisplayValue(remainingTime)) {
      parts.push(`剩余时间 ${formatUsagePrimitive(remainingTime)}`);
    } else if (hasUsageDisplayValue(resetAt)) {
      parts.push(`重置 ${formatUsagePrimitive(resetAt)}`);
    }

    if (hasUsageDisplayValue(status)) {
      parts.push(`状态 ${formatUsagePrimitive(status)}`);
    }

    if (!parts.length) return '';

    return `${formatUsagePrimitive(label)} ${parts.join(' / ')}`;
  }

  function collectUsageWindowSummaries(root, sourceLabel) {
    const output = [];
    const seenValues = new Set();
    const seenText = new Set();

    function push(text) {
      if (!text || seenText.has(text) || output.length >= 10) return;

      seenText.add(text);
      output.push(text);
    }

    function walk(value, path, depth) {
      if (output.length >= 10 || depth > 5 || !value) return;

      if (Array.isArray(value)) {
        value.forEach((item, index) => {
          if (isPlainUsageObject(item) && looksLikeUsageWindowObject(item, path)) {
            push(formatUsageWindowCandidate(item, `${sourceLabel || '窗口'} ${index + 1}`));
          }

          walk(item, `${path}.${index}`, depth + 1);
        });
        return;
      }

      if (!isPlainUsageObject(value) || seenValues.has(value)) return;

      seenValues.add(value);

      if (looksLikeUsageWindowObject(value, path)) {
        push(formatUsageWindowCandidate(value, sourceLabel || path.split('.').filter(Boolean).pop() || '窗口'));
      }

      for (const [key, child] of Object.entries(value)) {
        if (shouldSkipUsageScanKey(key)) continue;

        walk(child, path ? `${path}.${key}` : key, depth + 1);
      }
    }

    walk(root, sourceLabel || '', 0);

    return output;
  }

  function collectAccountIdentityTexts(account) {
    const values = [
      account?.name,
      account?.email,
      account?.username,
      account?.account,
      account?.account_name,
      account?.accountName,
      account?.credentials?.email,
      account?.credentials?.username,
      account?.credentials?.account,
    ];

    return Array.from(new Set(
      values
        .map((item) => String(item || '').trim())
        .filter((item) => item.length >= 4)
    ));
  }

  function extractUsageWindowFromText(text) {
    const clean = String(text || '').replace(/\s+/gu, ' ').trim();
    const parts = [];
    const seen = new Set();
    const pattern = /\b(\d+(?:\.\d+)?\s*[hdm])\s+(\d+(?:\.\d+)?%)\s*((?:现在)|(?:\d+\s*d\s*\d+\s*h)|(?:\d+\s*d)|(?:\d+\s*h)|-)?/giu;

    let match;

    while ((match = pattern.exec(clean)) && parts.length < 4) {
      const label = match[1].replace(/\s+/gu, '');
      const percent = match[2];
      const reset = String(match[3] || '').replace(/\s+/gu, ' ').trim();
      const item = `${label} ${percent}${reset ? ` ${reset}` : ''}`;

      if (!seen.has(item)) {
        seen.add(item);
        parts.push(item);
      }
    }

    return parts.join('；');
  }

  function parseUsageWindowsFromText(text) {
    const clean = String(text || '').replace(/\s+/gu, ' ').trim();
    const windows = [];
    const seen = new Set();
    const pattern = /\b(\d+(?:\.\d+)?\s*[hdm])\s+(\d+(?:\.\d+)?)%\s*((?:现在)|(?:\d+\s*d\s*\d+\s*h)|(?:\d+\s*d)|(?:\d+\s*h)|-)?/giu;

    let match;

    while ((match = pattern.exec(clean)) && windows.length < 6) {
      const label = match[1].replace(/\s+/gu, '');
      const percent = Math.max(0, Math.min(100, Number(match[2])));
      const reset = String(match[3] || '').replace(/\s+/gu, ' ').trim();
      const key = `${label}:${percent}:${reset}`;

      if (!seen.has(key) && Number.isFinite(percent)) {
        seen.add(key);
        windows.push({
          label,
          percent,
          reset: reset || '',
        });
      }
    }

    return windows;
  }

  function formatUsageRemainingSeconds(seconds) {
    const n = Math.max(0, Math.floor(Number(seconds) || 0));

    if (!n) return '现在';

    const days = Math.floor(n / 86400);
    const hours = Math.floor((n % 86400) / 3600);
    const minutes = Math.floor((n % 3600) / 60);

    if (days && hours) return `${days}d ${hours}h`;
    if (days) return `${days}d`;
    if (hours && minutes) return `${hours}h ${minutes}m`;
    if (hours) return `${hours}h`;
    if (minutes) return `${minutes}m`;

    return `${n}s`;
  }

  function normalizeUsageResponse(rawData) {
    const data = rawData?.data ?? rawData;

    if (!isPlainUsageObject(data)) return [];

    const configs = [
      ['five_hour', '5h'],
      ['fiveHour', '5h'],
      ['five_hours', '5h'],
      ['fiveHours', '5h'],
      ['seven_day', '7d'],
      ['sevenDay', '7d'],
      ['seven_days', '7d'],
      ['sevenDays', '7d'],
    ];
    const windows = [];
    const seen = new Set();

    for (const [key, label] of configs) {
      const item = data[key];

      if (!isPlainUsageObject(item) || seen.has(label)) continue;

      const percent = Math.max(0, Math.min(100, Number(item.utilization ?? item.percent ?? item.percentage ?? item.used_percent ?? 0)));
      const reset =
        typeof item.remaining_seconds !== 'undefined'
          ? formatUsageRemainingSeconds(item.remaining_seconds)
          : (item.resets_at || item.reset_at || item.resetAt || '');

      if (!Number.isFinite(percent)) continue;

      seen.add(label);
      windows.push({
        label,
        percent,
        reset: reset || '现在',
      });
    }

    return windows;
  }

  function getMaxUsagePercentFromText(text) {
    const matches = String(text || '').match(/(\d+(?:\.\d+)?)%/gu) || [];
    let max = 0;

    for (const item of matches) {
      const n = Number(item.replace('%', ''));
      if (Number.isFinite(n)) max = Math.max(max, n);
    }

    return max;
  }

  function extractVisibleAccountUsageWindowText(account) {
    const identities = collectAccountIdentityTexts(account);

    if (!identities.length) return '';

    const selectors = [
      'tr',
      '[role="row"]',
      '.ant-table-row',
      '.el-table__row',
      '.v-data-table__tr',
      '.arco-table-tr',
    ].join(',');
    const rows = Array.from(document.querySelectorAll(selectors));

    for (const row of rows) {
      if (
        row.closest('#sub2api-checker-shell') ||
        row.closest('#sub2api-importer-shell') ||
        row.closest('#sub2api-toolbox-shell')
      ) {
        continue;
      }

      const rowText = row.textContent || '';

      if (!identities.some((item) => rowText.includes(item))) continue;

      const usageText = extractUsageWindowFromText(row.innerText || rowText);

      if (usageText) return usageText;
    }

    return '';
  }

  function collectUsageHintFields(root, sourceLabel, output = [], depth = 0, path = '') {
    if (output.length >= 10 || depth > 4 || !isPlainUsageObject(root)) return output;

    const interestingPattern = /(usage|window|limit|quota|rate|reset|remaining|percent|request|token|cost|billing|charge)/iu;

    for (const [key, value] of Object.entries(root)) {
      if (output.length >= 10) break;
      if (shouldSkipUsageScanKey(key)) continue;

      const nextPath = path ? `${path}.${key}` : key;

      if (value === null || ['string', 'number', 'boolean'].includes(typeof value)) {
        if (interestingPattern.test(nextPath)) {
          output.push(`${sourceLabel}.${nextPath}: ${formatUsagePrimitive(value)}`);
        }
      } else if (isPlainUsageObject(value)) {
        collectUsageHintFields(value, sourceLabel, output, depth + 1, nextPath);
      }
    }

    return output;
  }

  function formatAccountUsageData(rawData, account) {
    const apiWindows = normalizeUsageResponse(rawData);

    if (apiWindows.length) {
      return `用量窗口：${apiWindows.map((item) => `${item.label} ${item.percent}% ${item.reset}`).join('；')}`;
    }

    const visibleWindow = extractVisibleAccountUsageWindowText(account);

    return visibleWindow ? `用量窗口：${visibleWindow}` : '未读取到用量窗口';
  }

  function getAccountUsageWindows(rawData, account) {
    const apiWindows = normalizeUsageResponse(rawData);

    return apiWindows.length ? apiWindows : parseUsageWindowsFromText(extractVisibleAccountUsageWindowText(account));
  }

  function getAccountUsageLevel(rawData, account) {
    const windows = getAccountUsageWindows(rawData, account);
    const percent = windows.length
      ? Math.max(...windows.map((item) => Number(item.percent) || 0))
      : getMaxUsagePercentFromText(extractVisibleAccountUsageWindowText(account));

    if (percent >= 90) {
      return {
        percent,
        level: 'critical',
        color: '#ff7875',
        border: '#ff4d4f',
        background: 'rgba(255, 77, 79, 0.12)',
      };
    }

    if (percent >= 80) {
      return {
        percent,
        level: 'warning',
        color: '#ffd666',
        border: '#fa8c16',
        background: 'rgba(250, 140, 22, 0.12)',
      };
    }

    return {
      percent,
      level: 'normal',
      color: '#d9d9d9',
      border: '#30363d',
      background: '#0b0f17',
    };
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
