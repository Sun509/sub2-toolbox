  function normalizeImportObject(parsed) {
    let data;
    let skipDefaultGroupBind = state.skipDefaultGroupBind;
    let targetGroup = state.targetGroup;

    if (parsed && parsed.data && Array.isArray(parsed.data.accounts)) {
      data = parsed.data;

      if (typeof parsed.skip_default_group_bind === 'boolean') {
        skipDefaultGroupBind = parsed.skip_default_group_bind;
      }

      targetGroup = normalizeGroupName(
        parsed.target_group ||
        parsed.target_group_name ||
        parsed.group ||
        parsed.group_name ||
        data.target_group ||
        data.target_group_name ||
        data.group ||
        data.group_name ||
        targetGroup
      );
    }

    else if (parsed && Array.isArray(parsed.accounts)) {
      data = parsed;

      targetGroup = normalizeGroupName(
        parsed.target_group ||
        parsed.target_group_name ||
        parsed.group ||
        parsed.group_name ||
        targetGroup
      );
    }

    else if (Array.isArray(parsed)) {
      data = {
        exported_at: new Date().toISOString(),
        proxies: [],
        accounts: parsed,
      };
    }

    else {
      throw new Error('无法识别导入格式，需要包含 accounts 数组');
    }

    if (!Array.isArray(data.accounts)) {
      throw new Error('data.accounts 不是数组');
    }

    const accounts = data.accounts.filter(Boolean);

    if (!accounts.length) {
      throw new Error('accounts 数组为空');
    }

    return {
      data: {
        exported_at: data.exported_at || new Date().toISOString(),
        proxies: Array.isArray(data.proxies) ? data.proxies : [],
        accounts,
      },
      skip_default_group_bind: skipDefaultGroupBind,
      target_group: targetGroup,
    };
  }

  function normalizeImportData(inputText) {
    const text = String(inputText || '').trim();

    if (!text) {
      throw new Error('导入内容为空');
    }

    let parsed;

    try {
      parsed = JSON.parse(text);
    } catch (err) {
      throw new Error(`JSON 解析失败：${err.message}`);
    }

    return normalizeImportObject(parsed);
  }

  function readFileAsText(file) {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();

      reader.onload = () => resolve(String(reader.result || ''));
      reader.onerror = () => reject(reader.error || new Error('读取文件失败'));

      reader.readAsText(file, 'utf-8');
    });
  }

  async function normalizeImportFiles(files) {
    const fileList = Array.from(files || []);

    if (!fileList.length) {
      throw new Error('没有选择 JSON 文件');
    }

    const mergedAccounts = [];
    const mergedProxies = [];
    const fileResults = [];

    let finalSkipDefaultGroupBind = state.skipDefaultGroupBind;
    let finalTargetGroup = state.targetGroup;

    for (const file of fileList) {
      const fileName = file.name || 'unknown.json';

      if (!fileName.toLowerCase().endsWith('.json')) {
        fileResults.push({
          fileName,
          ok: false,
          reason: '不是 .json 文件',
        });
        continue;
      }

      try {
        const text = await readFileAsText(file);
        const parsed = JSON.parse(text);
        const payload = normalizeImportObject(parsed);

        mergedAccounts.push(...payload.data.accounts);

        if (Array.isArray(payload.data.proxies)) {
          mergedProxies.push(...payload.data.proxies);
        }

        if (typeof payload.skip_default_group_bind === 'boolean') {
          finalSkipDefaultGroupBind = payload.skip_default_group_bind;
        }

        if (payload.target_group) {
          finalTargetGroup = payload.target_group;
        }

        fileResults.push({
          fileName,
          ok: true,
          count: payload.data.accounts.length,
        });
      } catch (err) {
        fileResults.push({
          fileName,
          ok: false,
          reason: err.message,
        });
      }
    }

    const successFiles = fileResults.filter((x) => x.ok);
    const failedFiles = fileResults.filter((x) => !x.ok);

    if (!successFiles.length) {
      throw new Error(`所有文件解析失败：${failedFiles.map((x) => `${x.fileName}: ${x.reason}`).join('；')}`);
    }

    if (!mergedAccounts.length) {
      throw new Error('所有 JSON 文件中都没有可导入账号');
    }

    return {
      data: {
        exported_at: new Date().toISOString(),
        proxies: mergedProxies,
        accounts: mergedAccounts,
      },
      skip_default_group_bind: finalSkipDefaultGroupBind,
      target_group: finalTargetGroup,
      fileResults,
    };
  }

  async function getImportPayloadFromUI() {
    const targetGroupInput = document.querySelector('#sub2api-importer-target-group');
    if (targetGroupInput) saveTargetGroup(targetGroupInput.value);

    const fileInput = document.querySelector('#sub2api-importer-files');
    const files = fileInput?.files || [];

    if (files.length > 0) {
      return await normalizeImportFiles(files);
    }

    const text = document.querySelector('#sub2api-importer-text')?.value || '';
    return normalizeImportData(text);
  }

  function validateAccount(account, index) {
    if (!account || typeof account !== 'object') {
      return `第 ${index + 1} 个账号不是对象`;
    }

    if (!account.name) {
      return `第 ${index + 1} 个账号缺少 name`;
    }

    if (!account.platform) {
      return `第 ${index + 1} 个账号缺少 platform`;
    }

    if (!account.type) {
      return `第 ${index + 1} 个账号缺少 type`;
    }

    if (!account.credentials || typeof account.credentials !== 'object') {
      return `第 ${index + 1} 个账号缺少 credentials`;
    }

    return '';
  }

  function chunkArray(arr, size) {
    const result = [];

    for (let i = 0; i < arr.length; i += size) {
      result.push(arr.slice(i, i + size));
    }

    return result;
  }

  function applyTargetGroupToPayload(payload) {
    const targetGroup = normalizeGroupName(payload?.target_group || state.targetGroup);

    if (!targetGroup) return payload;

    const accounts = Array.isArray(payload?.data?.accounts) ? payload.data.accounts : [];

    for (const account of accounts) {
      if (!account || typeof account !== 'object') continue;

      account.group = account.group || targetGroup;
      account.group_name = account.group_name || targetGroup;

      const groups = Array.isArray(account.groups) ? account.groups.slice() : [];
      const hasGroup = groups.some((item) => {
        if (typeof item === 'string') return normalizeGroupName(item) === targetGroup;
        return normalizeGroupName(item?.name || item?.group_name || item?.group) === targetGroup;
      });

      if (!hasGroup) groups.push({ name: targetGroup });

      account.groups = groups;
    }

    payload.target_group = targetGroup;
    payload.target_group_name = targetGroup;
    payload.group = targetGroup;
    payload.group_name = targetGroup;

    if (payload.data && typeof payload.data === 'object') {
      payload.data.target_group = targetGroup;
      payload.data.target_group_name = targetGroup;
      payload.data.group = targetGroup;
      payload.data.group_name = targetGroup;
    }

    return payload;
  }

  async function importAccountsPayload(payload) {
    applyTargetGroupToPayload(payload);

    const resp = await apiFetch(`${CONFIG.apiBase}${CONFIG.importApi}`, {
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

    if (!resp.ok) {
      return {
        ok: false,
        reason: `HTTP ${resp.status}: ${text.slice(0, 500)}`,
      };
    }

    if (json && typeof json.code !== 'undefined' && json.code !== 0) {
      return {
        ok: false,
        reason: json.message || `code=${json.code}`,
        data: json,
      };
    }

    return {
      ok: true,
      data: json || text,
    };
  }
