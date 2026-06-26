// ==UserScript==
// @name         Sub2API 工具箱 - 批量导入与账号巡检
// @namespace    https://sinry.example
// @version      0.5.4
// @description  融合批量导入多 JSON 文件、账号模型巡检自动下线、批量设置隐私、批量查询用量功能
// @match        http://49.51.253.129:8080/admin/accounts*
// @match        https://sub.pbopenai.cloud/*
// @updateURL    https://raw.githubusercontent.com/Sun509/sub2-toolbox/main/dist/sub2-toolbox.user.js
// @downloadURL  https://raw.githubusercontent.com/Sun509/sub2-toolbox/main/dist/sub2-toolbox.user.js
// @run-at       document-start
// @grant        none
// ==/UserScript==

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

  function sleep(ms) {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }

  function normalizeGroupName(group) {
    return String(group || '').trim().replace(/^\/+/, '');
  }

  function log(msg, type = 'info') {
    const time = new Date().toLocaleTimeString();
    const line = `[${time}] ${msg}`;

    console[type === 'error' ? 'error' : 'log'](`[sub2api-importer] ${line}`);

    const box = document.querySelector('#sub2api-importer-log');
    if (!box) return;

    const color =
      type === 'error' ? '#ff7875' :
      type === 'warn' ? '#ffd666' :
      type === 'success' ? '#95de64' : '#d9d9d9';

    const row = document.createElement('div');
    row.style.color = color;
    row.textContent = line;
    box.appendChild(row);
    box.scrollTop = box.scrollHeight;
  }

  function saveAuth(auth) {
    if (!auth || typeof auth !== 'string') return;

    const normalized = auth.startsWith('Bearer ') ? auth : `Bearer ${auth}`;

    state.authHeader = normalized;
    localStorage.setItem(CONFIG.authStorageKey, normalized);

    const input = document.querySelector('#sub2api-importer-auth');
    if (input && !input.value) input.value = normalized;

    log('已捕获 Authorization', 'success');
  }

  function saveTargetGroup(group) {
    const normalized = normalizeGroupName(group);

    state.targetGroup = normalized;
    localStorage.setItem(CONFIG.importGroupStorageKey, normalized);

    const input = document.querySelector('#sub2api-importer-target-group');
    if (input) input.value = normalized;

    return true;
  }

  function updateStats() {
    const el = document.querySelector('#sub2api-importer-stats');
    if (!el) return;

    const s = state.stats;
    el.textContent = `总数 ${s.total} | 已导入 ${s.imported} | 批次数 ${s.batches} | 失败 ${s.failed}`;
  }

  function resetStats(total = 0) {
    state.stats = {
      total,
      imported: 0,
      failed: 0,
      batches: 0,
    };

    updateStats();

    const logBox = document.querySelector('#sub2api-importer-log');
    if (logBox) logBox.innerHTML = '';
  }

  function injectAuthSniffer() {
    const script = document.createElement('script');

    script.textContent = `
      (() => {
        const emit = (auth) => {
          if (!auth) return;
          document.dispatchEvent(new CustomEvent('__sub2api_importer_auth__', { detail: auth }));
        };

        const pickAuth = (headersLike) => {
          try {
            if (!headersLike) return '';

            if (headersLike instanceof Headers) {
              return headersLike.get('Authorization') || headersLike.get('authorization') || '';
            }

            if (Array.isArray(headersLike)) {
              for (const [k, v] of headersLike) {
                if (String(k).toLowerCase() === 'authorization') return v || '';
              }
              return '';
            }

            if (typeof headersLike === 'object') {
              for (const key of Object.keys(headersLike)) {
                if (key.toLowerCase() === 'authorization') return headersLike[key] || '';
              }
            }
          } catch (_) {}

          return '';
        };

        const origFetch = window.fetch;

        if (origFetch) {
          window.fetch = function(input, init) {
            const auth =
              pickAuth(init && init.headers) ||
              pickAuth(input && input.headers);

            if (auth) emit(auth);

            return origFetch.apply(this, arguments);
          };
        }

        const origOpen = XMLHttpRequest.prototype.open;
        const origSetHeader = XMLHttpRequest.prototype.setRequestHeader;

        XMLHttpRequest.prototype.open = function() {
          this.__sub2apiAuth = '';
          return origOpen.apply(this, arguments);
        };

        XMLHttpRequest.prototype.setRequestHeader = function(name, value) {
          if (String(name).toLowerCase() === 'authorization' && value) {
            this.__sub2apiAuth = value;
            emit(value);
          }

          return origSetHeader.apply(this, arguments);
        };
      })();
    `;

    document.documentElement.appendChild(script);
    script.remove();

    document.addEventListener('__sub2api_importer_auth__', (event) => {
      saveAuth(event.detail);
    });
  }

  async function waitDomReady() {
    if (document.body) return;

    await new Promise((resolve) => {
      const timer = setInterval(() => {
        if (document.body) {
          clearInterval(timer);
          resolve();
        }
      }, 50);
    });
  }

  async function apiFetch(url, options = {}) {
    const headers = new Headers(options.headers || {});

    if (state.authHeader && !headers.has('Authorization')) {
      headers.set('Authorization', state.authHeader);
    }

    return fetch(url, {
      ...options,
      headers,
      credentials: 'include',
    });
  }

  async function ensureAuth() {
    const raw =
      localStorage.getItem(CONFIG.pageAuthTokenKey) ||
      sessionStorage.getItem(CONFIG.pageAuthTokenKey) ||
      localStorage.getItem(CONFIG.authStorageKey) ||
      '';

    if (raw) {
      saveAuth(raw);
      return true;
    }

    if (state.authHeader) return true;

    const fromInput = document.querySelector('#sub2api-importer-auth')?.value?.trim();

    if (fromInput) {
      saveAuth(fromInput);
      return true;
    }

    const manual = prompt('没有自动捕获到 Authorization，请粘贴 Bearer token');

    if (!manual) return false;

    saveAuth(manual.trim());

    return true;
  }

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

  function updatePanelCollapsed() {
    const shell = document.querySelector('#sub2api-importer-shell');
    const root = document.querySelector('#sub2api-importer-panel');
    const toggle = document.querySelector('#sub2api-importer-toggle');

    if (!root || !toggle || !shell) return;

    root.style.width = state.collapsed ? '0px' : '540px';
    root.style.opacity = state.collapsed ? '0' : '1';
    root.style.marginRight = state.collapsed ? '0px' : '12px';
    root.style.pointerEvents = state.collapsed ? 'none' : 'auto';
    root.style.transform = state.collapsed ? 'translateX(12px)' : 'translateX(0)';

    toggle.textContent = state.collapsed ? '批量导入' : '收起';
    toggle.style.borderRadius = state.collapsed ? '10px 0 0 10px' : '10px';
  }

  function ensurePanel() {
    if (state.panelReady) return;
    state.panelReady = true;

    document.querySelector('#sub2api-checker-shell')?.remove();

    const shell = document.createElement('div');
    shell.id = 'sub2api-importer-shell';
    shell.style.cssText = `
      position: fixed;
      right: 0;
      top: 220px;
      z-index: 1000001;
      display: flex;
      flex-direction: row;
      align-items: flex-start;
      pointer-events: auto;
    `;
    document.body.appendChild(shell);

    const toggle = document.createElement('button');
    toggle.id = 'sub2api-importer-toggle';
    toggle.style.cssText = `
      padding: 10px 8px;
      border: 0;
      border-radius: 10px 0 0 10px;
      background: #722ed1;
      color: #fff;
      cursor: pointer;
      writing-mode: vertical-rl;
      text-orientation: mixed;
      box-shadow: 0 8px 24px rgba(0,0,0,.25);
      font: 12px/1.2 -apple-system,BlinkMacSystemFont,Segoe UI,Roboto,Helvetica,Arial,PingFang SC,Microsoft YaHei,sans-serif;
    `;

    toggle.addEventListener('click', () => {
      state.collapsed = !state.collapsed;
      updatePanelCollapsed();
    });

    shell.appendChild(toggle);

    const root = document.createElement('div');
    root.id = 'sub2api-importer-panel';
    root.style.cssText = `
      width: 0;
      opacity: 0;
      overflow: hidden;
      transition: width .28s ease, opacity .22s ease, margin-right .28s ease, transform .28s ease;
      transform: translateX(12px);
    `;

    root.innerHTML = `
      <div style="
        width:540px;
        background:rgba(16, 18, 27, 0.96);
        color:#fff;
        border:1px solid #30363d;
        border-radius:12px;
        box-shadow:0 8px 24px rgba(0,0,0,.35);
        font:12px/1.5 -apple-system,BlinkMacSystemFont,Segoe UI,Roboto,Helvetica,Arial,PingFang SC,Microsoft YaHei,sans-serif;
        overflow:hidden;
      ">
        <div style="padding:12px 14px;border-bottom:1px solid #30363d;font-weight:700;">
          Sub2API 批量导入账号 - 多 JSON 文件版
        </div>

        <div style="padding:12px 14px;display:flex;flex-direction:column;gap:8px;">
          <label style="display:flex;flex-direction:column;gap:4px;">
            <span>Authorization，优先自动捕获</span>
            <input id="sub2api-importer-auth" type="text" placeholder="Bearer xxxxxx"
              style="width:100%;box-sizing:border-box;padding:8px;border-radius:8px;border:1px solid #434a57;background:#111723;color:#fff;" />
          </label>

          <div style="display:flex;gap:8px;">
            <label style="display:flex;flex-direction:column;gap:4px;flex:1;">
              <span>每批导入数量</span>
              <input id="sub2api-importer-batch-size" type="number" min="1" step="1"
                style="width:100%;box-sizing:border-box;padding:8px;border-radius:8px;border:1px solid #434a57;background:#111723;color:#fff;" />
            </label>

            <label style="display:flex;align-items:center;gap:6px;flex:1;margin-top:22px;">
              <input id="sub2api-importer-skip-default-group-bind" type="checkbox" />
              <span>skip_default_group_bind</span>
            </label>
          </div>

          <label style="display:flex;flex-direction:column;gap:4px;">
            <span>导入目标分组（可填分组名或 ID，留空则按原数据导入）</span>
            <input id="sub2api-importer-target-group" type="text" placeholder="例如 default 或 group_id"
              style="width:100%;box-sizing:border-box;padding:8px;border-radius:8px;border:1px solid #434a57;background:#111723;color:#fff;" />
          </label>

          <div style="color:#ffd666;">
            支持上传多个 JSON 文件；如果选择文件，将优先使用文件，忽略下方文本框。
          </div>

          <label style="display:flex;flex-direction:column;gap:4px;">
            <span>上传 JSON 文件，可多选</span>
            <input id="sub2api-importer-files" type="file" accept=".json,application/json" multiple
              style="width:100%;box-sizing:border-box;padding:8px;border-radius:8px;border:1px solid #434a57;background:#111723;color:#fff;" />
          </label>

          <div id="sub2api-importer-files-info" style="color:#bfbfbf;">
            未选择文件；如果选择文件，将优先使用文件导入。
          </div>

          <textarea id="sub2api-importer-text" placeholder='未选择文件时，也可以在这里粘贴 JSON。

支持格式一：完整请求体
{
  "data": {
    "exported_at": "2026-05-10T14:01:17.802Z",
    "proxies": [],
    "accounts": []
  },
  "skip_default_group_bind": true
}

支持格式二：只粘贴 accounts 数组
[
  {
    "name": "xxx@example.com",
    "platform": "openai",
    "type": "oauth",
    "concurrency": 10,
    "priority": 1,
    "credentials": {},
    "extra": {}
  }
]'
            style="width:100%;height:220px;box-sizing:border-box;padding:8px;border-radius:8px;border:1px solid #434a57;background:#111723;color:#fff;resize:vertical;font-family:ui-monospace,SFMono-Regular,Menlo,Monaco,Consolas,monospace;"></textarea>

          <div style="display:flex;gap:8px;">
            <button id="sub2api-importer-preview"
              style="flex:1;padding:8px 10px;border:0;border-radius:8px;background:#13c2c2;color:#fff;cursor:pointer;">
              解析预览
            </button>

            <button id="sub2api-importer-start"
              style="flex:1;padding:8px 10px;border:0;border-radius:8px;background:#1677ff;color:#fff;cursor:pointer;">
              开始导入
            </button>

            <button id="sub2api-importer-stop"
              style="flex:1;padding:8px 10px;border:0;border-radius:8px;background:#fa541c;color:#fff;cursor:pointer;">
              停止
            </button>
          </div>

          <div id="sub2api-importer-stats" style="color:#bfbfbf;">
            总数 0 | 已导入 0 | 批次数 0 | 失败 0
          </div>

          <div id="sub2api-importer-log"
            style="height:280px;overflow:auto;background:#0b0f17;border:1px solid #30363d;border-radius:8px;padding:8px;">
          </div>
        </div>
      </div>
    `;

    shell.appendChild(root);

    const authInput = root.querySelector('#sub2api-importer-auth');
    authInput.value = state.authHeader;

    authInput.addEventListener('change', () => {
      const v = authInput.value.trim();
      if (v) saveAuth(v);
    });

    const batchSizeInput = root.querySelector('#sub2api-importer-batch-size');
    batchSizeInput.value = String(state.batchSize);

    batchSizeInput.addEventListener('change', () => {
      const n = Number(batchSizeInput.value || 0);

      if (!Number.isFinite(n) || n < 1) {
        batchSizeInput.value = String(state.batchSize);
        log('每批导入数量必须大于等于 1', 'error');
        return;
      }

      state.batchSize = Math.floor(n);
      localStorage.setItem(CONFIG.batchSizeStorageKey, String(state.batchSize));
      log(`已设置每批导入数量：${state.batchSize}`, 'success');
    });

    const skipCheckbox = root.querySelector('#sub2api-importer-skip-default-group-bind');
    skipCheckbox.checked = state.skipDefaultGroupBind;

    skipCheckbox.addEventListener('change', () => {
      state.skipDefaultGroupBind = !!skipCheckbox.checked;
      localStorage.setItem(CONFIG.skipDefaultGroupBindStorageKey, String(state.skipDefaultGroupBind));
      log(`skip_default_group_bind = ${state.skipDefaultGroupBind}`, 'success');
    });

    const targetGroupInput = root.querySelector('#sub2api-importer-target-group');
    targetGroupInput.value = state.targetGroup;
    targetGroupInput.addEventListener('change', () => {
      saveTargetGroup(targetGroupInput.value);

      if (state.targetGroup) {
        log(`已设置导入目标分组：${state.targetGroup}`, 'success');
      } else {
        log('已清空导入目标分组，将按原数据导入', 'warn');
      }
    });

    const filesInput = root.querySelector('#sub2api-importer-files');
    const filesInfo = root.querySelector('#sub2api-importer-files-info');

    filesInput.addEventListener('change', () => {
      const files = Array.from(filesInput.files || []);

      if (!files.length) {
        filesInfo.textContent = '未选择文件；如果选择文件，将优先使用文件导入。';
        log('已清空上传文件', 'warn');
        return;
      }

      const totalSize = files.reduce((sum, file) => sum + file.size, 0);
      const names = files.slice(0, 5).map((file) => file.name);

      filesInfo.textContent =
        `已选择 ${files.length} 个文件，总大小 ${(totalSize / 1024).toFixed(2)} KB：` +
        `${names.join(', ')}${files.length > 5 ? ' ...' : ''}`;

      log(`已选择 ${files.length} 个 JSON 文件`, 'success');
    });

    root.querySelector('#sub2api-importer-preview').addEventListener('click', async () => {
      try {
        const payload = await getImportPayloadFromUI();

        const accounts = payload.data.accounts;
        const errors = [];

        accounts.forEach((account, index) => {
          const err = validateAccount(account, index);
          if (err) errors.push(err);
        });

        log(`解析成功，共 ${accounts.length} 个账号`, 'success');
        log(`skip_default_group_bind = ${payload.skip_default_group_bind}`, 'info');

        if (payload.fileResults) {
          const okFiles = payload.fileResults.filter((x) => x.ok);
          const badFiles = payload.fileResults.filter((x) => !x.ok);

          log(`成功解析文件 ${okFiles.length} 个`, 'success');

          for (const item of okFiles.slice(0, 10)) {
            log(`文件 ${item.fileName}：${item.count} 个账号`, 'info');
          }

          if (badFiles.length) {
            log(`解析失败文件 ${badFiles.length} 个`, 'warn');

            for (const item of badFiles.slice(0, 10)) {
              log(`文件 ${item.fileName} 失败：${item.reason}`, 'error');
            }
          }
        }

        const names = accounts.slice(0, 10).map((x) => x.name || '(无名称)');
        log(`前 ${names.length} 个账号：${names.join(', ')}`, 'info');

        if (errors.length) {
          log(`发现 ${errors.length} 个格式问题，前 10 个：${errors.slice(0, 10).join('；')}`, 'warn');
        }
      } catch (err) {
        log(`解析失败：${err.message}`, 'error');
      }
    });

    root.querySelector('#sub2api-importer-start').addEventListener('click', () => {
      runImport().catch((err) => {
        log(`导入异常：${err.message}`, 'error');
        state.running = false;
      });
    });

    root.querySelector('#sub2api-importer-stop').addEventListener('click', () => {
      state.stopRequested = true;
      log('已请求停止，当前批次完成后退出', 'warn');
    });

    updatePanelCollapsed();
  }

  async function runImport() {
    if (state.running) {
      log('已有导入任务在运行', 'warn');
      return;
    }

    if (!(await ensureAuth())) {
      log('缺少 Authorization，已取消', 'error');
      return;
    }

    let payload;

    try {
      payload = await getImportPayloadFromUI();
    } catch (err) {
      log(`导入内容错误：${err.message}`, 'error');
      return;
    }

    const accounts = payload.data.accounts;

    const errors = [];
    accounts.forEach((account, index) => {
      const err = validateAccount(account, index);
      if (err) errors.push(err);
    });

    if (errors.length) {
      log(`检测到 ${errors.length} 个账号格式异常，已取消导入`, 'error');
      log(errors.slice(0, 20).join('；'), 'error');
      return;
    }

    state.running = true;
    state.stopRequested = false;
    state.collapsed = false;

    resetStats(accounts.length);
    updatePanelCollapsed();

    const batchSize = Math.max(1, Math.floor(state.batchSize || CONFIG.defaultBatchSize));
    const batches = chunkArray(accounts, batchSize);

    log(`开始导入，共 ${accounts.length} 个账号，分 ${batches.length} 批，每批 ${batchSize} 个`);
    log(`接口：${CONFIG.importApi}`);
    log(`skip_default_group_bind = ${payload.skip_default_group_bind}`);

    if (payload.fileResults) {
      const okFiles = payload.fileResults.filter((x) => x.ok);
      const badFiles = payload.fileResults.filter((x) => !x.ok);

      log(`本次使用文件导入，成功解析 ${okFiles.length} 个文件，失败 ${badFiles.length} 个文件`);

      if (badFiles.length) {
        for (const item of badFiles.slice(0, 10)) {
          log(`文件 ${item.fileName} 解析失败，已跳过：${item.reason}`, 'warn');
        }
      }
    }

    try {
      for (let i = 0; i < batches.length; i++) {
        if (state.stopRequested) {
          log('任务已按要求停止', 'warn');
          break;
        }

        const batchAccounts = batches[i];

        const batchPayload = {
          data: {
            exported_at: payload.data.exported_at || new Date().toISOString(),
            proxies: payload.data.proxies || [],
            accounts: batchAccounts,
          },
          skip_default_group_bind: payload.skip_default_group_bind,
        };

        const start = i * batchSize + 1;
        const end = start + batchAccounts.length - 1;

        log(`开始导入第 ${i + 1}/${batches.length} 批，账号 ${start}-${end}`);

        const result = await importAccountsPayload(batchPayload);

        state.stats.batches += 1;

        if (result.ok) {
          state.stats.imported += batchAccounts.length;
          log(`第 ${i + 1} 批导入成功，数量：${batchAccounts.length}`, 'success');
        } else {
          state.stats.failed += batchAccounts.length;
          log(`第 ${i + 1} 批导入失败：${result.reason}`, 'error');
        }

        updateStats();

        await sleep(CONFIG.requestIntervalMs);
      }

      if (state.stopRequested) {
        log('导入任务已停止', 'warn');
      } else {
        log('批量导入完成', 'success');
      }
    } finally {
      state.running = false;
      updateStats();
    }
  }

  injectAuthSniffer();

  waitDomReady().then(() => {
    ensurePanel();

    if (state.authHeader) {
      log('脚本已就绪，已读取 Authorization', 'success');
    } else {
      log('脚本已就绪，未发现 Authorization，可刷新页面自动捕获或手动粘贴');
    }
  });
})();

// 单入口工具箱启动器
(function () {
  'use strict';

  const TOOLS = {
    checker: {
      label: '账号巡检',
      toggleId: 'sub2api-checker-toggle',
      panelWidth: 440,
    },
    importer: {
      label: '批量导入',
      toggleId: 'sub2api-importer-toggle',
      panelWidth: 540,
    },
  };

  function waitDomReady() {
    if (document.body) return Promise.resolve();

    return new Promise((resolve) => {
      const timer = setInterval(() => {
        if (document.body) {
          clearInterval(timer);
          resolve();
        }
      }, 50);
    });
  }

  function injectStyle() {
    if (document.querySelector('#sub2api-toolbox-style')) return;

    const style = document.createElement('style');
    style.id = 'sub2api-toolbox-style';
    style.textContent = `
      #sub2api-checker-toggle,
      #sub2api-importer-toggle {
        display: none !important;
      }

      #sub2api-checker-shell,
      #sub2api-importer-shell {
        top: 80px !important;
        right: 42px !important;
      }
    `;

    document.documentElement.appendChild(style);
  }

  function getToggle(kind) {
    return document.querySelector(`#${TOOLS[kind].toggleId}`);
  }

  function isOpen(kind) {
    const toggle = getToggle(kind);
    return !!toggle && toggle.textContent.trim() === '收起';
  }

  function setOpen(kind, open) {
    const toggle = getToggle(kind);
    if (!toggle) return false;

    if (isOpen(kind) !== open) {
      toggle.click();
    }

    return true;
  }

  function closeAll() {
    setOpen('checker', false);
    setOpen('importer', false);
  }

  function getOpenKind() {
    if (isOpen('checker')) return 'checker';
    if (isOpen('importer')) return 'importer';
    return '';
  }

  function refreshLauncher() {
    const launcher = document.querySelector('#sub2api-toolbox-launcher');
    const menu = document.querySelector('#sub2api-toolbox-menu');
    if (!launcher || !menu) return;

    const openKind = getOpenKind();

    launcher.textContent = openKind ? '收起' : '工具箱';
    launcher.style.background = openKind ? '#fa541c' : '#1677ff';

    for (const key of Object.keys(TOOLS)) {
      const button = menu.querySelector(`[data-sub2api-tool="${key}"]`);
      if (!button) continue;

      button.style.background = openKind === key ? '#13c2c2' : '#1677ff';
    }
  }

  function toggleMenu(force) {
    const menu = document.querySelector('#sub2api-toolbox-menu');
    if (!menu) return;

    const visible = menu.style.display !== 'none';
    const nextVisible = typeof force === 'boolean' ? force : !visible;

    menu.style.display = nextVisible ? 'flex' : 'none';
  }

  function openTool(kind) {
    closeAll();

    setOpen(kind, true);
    toggleMenu(false);
    refreshLauncher();
  }

  function ensureLauncher() {
    if (document.querySelector('#sub2api-toolbox-shell')) return;

    const shell = document.createElement('div');
    shell.id = 'sub2api-toolbox-shell';
    shell.style.cssText = `
      position: fixed;
      right: 0;
      top: 80px;
      z-index: 1000002;
      display: flex;
      flex-direction: row;
      align-items: flex-start;
      gap: 8px;
      font: 12px/1.4 -apple-system,BlinkMacSystemFont,Segoe UI,Roboto,Helvetica,Arial,PingFang SC,Microsoft YaHei,sans-serif;
    `;

    const menu = document.createElement('div');
    menu.id = 'sub2api-toolbox-menu';
    menu.style.cssText = `
      display: none;
      flex-direction: column;
      gap: 8px;
      width: 112px;
      padding: 10px;
      margin-top: 0;
      background: rgba(16, 18, 27, 0.96);
      border: 1px solid #30363d;
      border-radius: 10px;
      box-shadow: 0 8px 24px rgba(0,0,0,.35);
    `;

    for (const [kind, tool] of Object.entries(TOOLS)) {
      const button = document.createElement('button');
      button.type = 'button';
      button.dataset.sub2apiTool = kind;
      button.textContent = tool.label;
      button.style.cssText = `
        width: 100%;
        padding: 8px 10px;
        border: 0;
        border-radius: 8px;
        background: #1677ff;
        color: #fff;
        cursor: pointer;
      `;
      button.addEventListener('click', () => openTool(kind));
      menu.appendChild(button);
    }

    const closeButton = document.createElement('button');
    closeButton.type = 'button';
    closeButton.textContent = '全部收起';
    closeButton.style.cssText = `
      width: 100%;
      padding: 8px 10px;
      border: 0;
      border-radius: 8px;
      background: #434a57;
      color: #fff;
      cursor: pointer;
    `;
    closeButton.addEventListener('click', () => {
      closeAll();
      toggleMenu(false);
      refreshLauncher();
    });
    menu.appendChild(closeButton);

    const launcher = document.createElement('button');
    launcher.id = 'sub2api-toolbox-launcher';
    launcher.type = 'button';
    launcher.textContent = '工具箱';
    launcher.style.cssText = `
      padding: 10px 8px;
      border: 0;
      border-radius: 10px 0 0 10px;
      background: #1677ff;
      color: #fff;
      cursor: pointer;
      writing-mode: vertical-rl;
      text-orientation: mixed;
      box-shadow: 0 8px 24px rgba(0,0,0,.25);
      font: inherit;
    `;

    launcher.addEventListener('click', () => {
      if (getOpenKind()) {
        closeAll();
        toggleMenu(false);
        refreshLauncher();
        return;
      }

      toggleMenu();
      refreshLauncher();
    });

    shell.appendChild(menu);
    shell.appendChild(launcher);
    document.body.appendChild(shell);

    refreshLauncher();
    setInterval(refreshLauncher, 500);
  }

  waitDomReady().then(() => {
    injectStyle();
    ensureLauncher();

    setTimeout(() => {
      injectStyle();
      refreshLauncher();
    }, 500);
  });
})();

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

  function log(msg, type = 'info') {
    const time = new Date().toLocaleTimeString();
    const line = `[${time}] ${msg}`;

    console[type === 'error' ? 'error' : 'log'](`[sub2api-checker] ${line}`);

    const box = document.querySelector('#sub2api-checker-log');
    if (!box) return;

    const color =
      type === 'error' ? '#ff7875' :
      type === 'warn' ? '#ffd666' :
      type === 'success' ? '#95de64' : '#d9d9d9';

    const row = document.createElement('div');
    row.style.color = color;
    row.textContent = line;
    box.appendChild(row);
    box.scrollTop = box.scrollHeight;
  }

  function requestAutoLoadMeta(delay = 500) {
    setTimeout(() => {
      autoLoadMetaWithRetry().catch((err) => {
        log(`自动读取分组/模型异常：${err.message}`, 'error');
      });
    }, delay);
  }

  function saveAuth(auth) {
    if (!auth || typeof auth !== 'string') return;

    const normalized = auth.startsWith('Bearer ') ? auth : `Bearer ${auth}`;
    const changed = state.authHeader !== normalized;

    state.authHeader = normalized;
    localStorage.setItem(CONFIG.authStorageKey, normalized);

    const input = document.querySelector('#sub2api-checker-auth');
    if (input && !input.value) input.value = normalized;

    log('已捕获 Authorization', 'success');

    if (changed) {
      requestAutoLoadMeta(500);
      requestAutoLoadMeta(2500);
    }
  }

  function saveTimeoutMs(timeoutMs) {
    const n = Number(timeoutMs);
    if (!Number.isFinite(n) || n < 1000) return false;

    state.timeoutMs = n;
    localStorage.setItem(CONFIG.timeoutStorageKey, String(n));

    const input = document.querySelector('#sub2api-checker-timeout');
    if (input) input.value = String(Math.floor(n / 1000));

    return true;
  }

  function normalizeConcurrency(value) {
    const n = Math.floor(Number(value));

    if (!Number.isFinite(n) || n < 1) return 0;

    return Math.min(n, CONFIG.maxConcurrency);
  }

  function saveConcurrency(value) {
    const n = normalizeConcurrency(value);

    if (!n) return false;

    state.concurrency = n;
    localStorage.setItem(CONFIG.concurrencyStorageKey, String(n));

    const input = document.querySelector('#sub2api-checker-concurrency');
    if (input) input.value = String(n);

    return true;
  }

  function saveTestModel(model) {
    const normalized = String(model || '').trim();
    if (!normalized) return false;

    state.testModel = normalized;
    localStorage.setItem(CONFIG.testModelStorageKey, normalized);

    const input = document.querySelector('#sub2api-checker-test-model');
    if (input) input.value = normalized;

    return true;
  }

  function saveTargetGroup(group) {
    const normalized = normalizeGroupName(group);

    state.targetGroup = normalized;
    localStorage.setItem(CONFIG.groupStorageKey, normalized);

    const input = document.querySelector('#sub2api-checker-group');
    if (input) input.value = normalized;

    return true;
  }

  function injectAuthSniffer() {
    const script = document.createElement('script');

    script.textContent = `
      (() => {
        const emit = (auth) => {
          if (!auth) return;
          document.dispatchEvent(new CustomEvent('__sub2api_checker_auth__', { detail: auth }));
        };

        const pickAuth = (headersLike) => {
          try {
            if (!headersLike) return '';

            if (headersLike instanceof Headers) {
              return headersLike.get('Authorization') || headersLike.get('authorization') || '';
            }

            if (Array.isArray(headersLike)) {
              for (const [k, v] of headersLike) {
                if (String(k).toLowerCase() === 'authorization') return v || '';
              }
              return '';
            }

            if (typeof headersLike === 'object') {
              for (const key of Object.keys(headersLike)) {
                if (key.toLowerCase() === 'authorization') return headersLike[key] || '';
              }
            }
          } catch (_) {}

          return '';
        };

        const origFetch = window.fetch;

        if (origFetch) {
          window.fetch = function(input, init) {
            const auth =
              pickAuth(init && init.headers) ||
              pickAuth(input && input.headers);

            if (auth) emit(auth);

            return origFetch.apply(this, arguments);
          };
        }

        const origOpen = XMLHttpRequest.prototype.open;
        const origSetHeader = XMLHttpRequest.prototype.setRequestHeader;

        XMLHttpRequest.prototype.open = function() {
          this.__sub2apiAuth = '';
          return origOpen.apply(this, arguments);
        };

        XMLHttpRequest.prototype.setRequestHeader = function(name, value) {
          if (String(name).toLowerCase() === 'authorization' && value) {
            this.__sub2apiAuth = value;
            emit(value);
          }

          return origSetHeader.apply(this, arguments);
        };
      })();
    `;

    document.documentElement.appendChild(script);
    script.remove();

    document.addEventListener('__sub2api_checker_auth__', (event) => {
      saveAuth(event.detail);
    });
  }

  async function waitDomReady() {
    if (document.body) return;

    await new Promise((resolve) => {
      const timer = setInterval(() => {
        if (document.body) {
          clearInterval(timer);
          resolve();
        }
      }, 50);
    });
  }

  async function apiFetch(url, options = {}) {
    const headers = new Headers(options.headers || {});

    if (state.authHeader && !headers.has('Authorization')) {
      headers.set('Authorization', state.authHeader);
    }

    return fetch(url, {
      ...options,
      headers,
      credentials: 'include',
    });
  }

  async function ensureAuth() {
    const cached = getCachedAuthToken();

    if (cached) {
      saveAuth(cached);
      return true;
    }

    if (state.authHeader) return true;

    const fromInput = document.querySelector('#sub2api-checker-auth')?.value?.trim();

    if (fromInput) {
      saveAuth(fromInput);
      return true;
    }

    const manual = prompt('没有自动捕获到 Authorization，请粘贴 Bearer token');

    if (!manual) return false;

    saveAuth(manual.trim());

    return true;
  }

  function updateStats() {
    const el = document.querySelector('#sub2api-checker-stats');
    if (!el) return;

    const s = state.stats;

    el.textContent = `总数 ${s.total} | 已处理 ${s.checked} | 正常 ${s.ok} | 已启用 ${s.enabled} | 已关闭 ${s.disabled} | 跳过 ${s.skipped} | 异常 ${s.failed}`;
  }

  function resetStats() {
    state.stats = {
      total: 0,
      checked: 0,
      ok: 0,
      enabled: 0,
      disabled: 0,
      skipped: 0,
      failed: 0,
    };

    updateStats();

    const logBox = document.querySelector('#sub2api-checker-log');
    if (logBox) logBox.innerHTML = '';
  }

  function updatePanelCollapsed() {
    const shell = document.querySelector('#sub2api-checker-shell');
    const root = document.querySelector('#sub2api-checker-panel');
    const toggle = document.querySelector('#sub2api-checker-toggle');

    if (!root || !toggle || !shell) return;

    root.style.width = state.collapsed ? '0px' : '480px';
    root.style.opacity = state.collapsed ? '0' : '1';
    root.style.marginRight = state.collapsed ? '0px' : '12px';
    root.style.pointerEvents = state.collapsed ? 'none' : 'auto';
    root.style.transform = state.collapsed ? 'translateX(12px)' : 'translateX(0)';

    toggle.textContent = state.collapsed ? '账号巡检' : '收起';
    toggle.style.borderRadius = state.collapsed ? '10px 0 0 10px' : '10px';
  }

  function renderGroupSelect() {
    const select = document.querySelector('#sub2api-checker-group');
    const targetList = document.querySelector('#sub2api-checker-group-options');
    if (!select && !targetList) return;

    const current = normalizeGroupName(state.targetGroup);

    if (select) select.innerHTML = '';
    if (targetList) targetList.innerHTML = '';

    const allOption = document.createElement('option');
    allOption.value = '';
    allOption.textContent = '全部分组';
    if (select) select.appendChild(allOption);

    const groups = Array.isArray(state.groups) ? state.groups : [];

    for (const item of groups) {
      const name = typeof item === 'string' ? item : item.name;
      const status = typeof item === 'object' ? item.status : '';

      if (!name) continue;

      const option = document.createElement('option');
      option.value = name;
      option.textContent = status ? `${name} (${status})` : name;
      if (select) select.appendChild(option);

      if (targetList) {
        const targetOption = document.createElement('option');
        targetOption.value = name;
        targetList.appendChild(targetOption);
      }
    }

    const exists = groups.some((item) => {
      const name = typeof item === 'string' ? item : item.name;
      return name === current;
    });

    if (current && !exists) {
      const option = document.createElement('option');
      option.value = current;
      option.textContent = `${current}（已保存）`;
      if (select) select.appendChild(option);
    }

    if (select) select.value = current;
  }

  function sortModels(models) {
    const unique = Array.from(new Set(models.filter(Boolean)));

    const preferred = [];

    for (const model of CONFIG.preferredModels) {
      if (unique.includes(model)) preferred.push(model);
    }

    const rest = unique
      .filter((x) => !preferred.includes(x))
      .sort((a, b) => a.localeCompare(b));

    return [...preferred, ...rest];
  }

  function renderModelSelect() {
    const select = document.querySelector('#sub2api-checker-test-model');
    if (!select) return;

    const current = String(state.testModel || '').trim();

    select.innerHTML = '';

    const models = sortModels([
      ...(CONFIG.defaultModelOptions || []),
      ...(state.modelOptions || []),
      current,
    ]);

    for (const model of models) {
      if (!model) continue;

      const option = document.createElement('option');
      option.value = model;
      option.textContent = model;
      select.appendChild(option);
    }

    if (current) select.value = current;
  }

  function ensurePanel() {
    if (state.panelReady) return;
    state.panelReady = true;

    const shell = document.createElement('div');
    shell.id = 'sub2api-checker-shell';
    shell.style.cssText = `
      position: fixed;
      right: 0;
      top: 80px;
      z-index: 1000000;
      display: flex;
      flex-direction: row;
      align-items: flex-start;
      pointer-events: auto;
    `;
    document.body.appendChild(shell);

    const toggle = document.createElement('button');
    toggle.id = 'sub2api-checker-toggle';
    toggle.style.cssText = `
      padding: 10px 8px;
      border: 0;
      border-radius: 10px 0 0 10px;
      background: #1677ff;
      color: #fff;
      cursor: pointer;
      writing-mode: vertical-rl;
      text-orientation: mixed;
      box-shadow: 0 8px 24px rgba(0,0,0,.25);
      font: 12px/1.2 -apple-system,BlinkMacSystemFont,Segoe UI,Roboto,Helvetica,Arial,PingFang SC,Microsoft YaHei,sans-serif;
    `;

    toggle.addEventListener('click', () => {
      state.collapsed = !state.collapsed;
      updatePanelCollapsed();
    });

    shell.appendChild(toggle);

    const root = document.createElement('div');
    root.id = 'sub2api-checker-panel';
    root.style.cssText = `
      width: 0;
      opacity: 0;
      overflow: hidden;
      transition: width .28s ease, opacity .22s ease, margin-right .28s ease, transform .28s ease;
      transform: translateX(12px);
    `;

    root.innerHTML = `
      <div id="sub2api-checker-panel-inner" style="
        width:480px;
        background:rgba(16, 18, 27, 0.96);
        color:#fff;
        border:1px solid #30363d;
        border-radius:12px;
        box-shadow:0 8px 24px rgba(0,0,0,.35);
        font:12px/1.5 -apple-system,BlinkMacSystemFont,Segoe UI,Roboto,Helvetica,Arial,PingFang SC,Microsoft YaHei,sans-serif;
        max-height:calc(100vh - 96px);
        overflow:auto;
      ">
        <div style="padding:12px 14px;border-bottom:1px solid #30363d;font-weight:700;">
          Sub2API 账号模型巡检 v0.5.4 并发版
        </div>

        <div style="padding:12px 14px;display:flex;flex-direction:column;gap:8px;">
          <label style="display:flex;flex-direction:column;gap:4px;">
            <span>Authorization（优先自动捕获，抓不到再手填）</span>
            <input id="sub2api-checker-auth" type="text" placeholder="Bearer xxxxxx"
              style="width:100%;box-sizing:border-box;padding:8px;border-radius:8px;border:1px solid #434a57;background:#111723;color:#fff;" />
          </label>

          <label style="display:flex;flex-direction:column;gap:4px;">
            <span>单模型超时时间（秒）</span>
            <input id="sub2api-checker-timeout" type="number" min="1" step="1" placeholder="45"
              style="width:100%;box-sizing:border-box;padding:8px;border-radius:8px;border:1px solid #434a57;background:#111723;color:#fff;" />
          </label>

          <label style="display:flex;flex-direction:column;gap:4px;">
            <span>并发账号数（同时巡检多少个账号）</span>
            <input id="sub2api-checker-concurrency" type="number" min="1" max="20" step="1" placeholder="3"
              style="width:100%;box-sizing:border-box;padding:8px;border-radius:8px;border:1px solid #434a57;background:#111723;color:#fff;" />
          </label>

          <label style="display:flex;flex-direction:column;gap:4px;">
            <span>测试模型</span>
            <div style="display:flex;gap:6px;">
              <select id="sub2api-checker-test-model"
                style="flex:1;width:100%;box-sizing:border-box;padding:8px;border-radius:8px;border:1px solid #434a57;background:#111723;color:#fff;">
              </select>

              <button id="sub2api-checker-refresh-models" type="button"
                style="padding:8px 10px;border:0;border-radius:8px;background:#13c2c2;color:#fff;cursor:pointer;">
                刷新
              </button>
            </div>
          </label>

          <label style="display:flex;flex-direction:column;gap:4px;">
            <span>巡检分组</span>
            <div style="display:flex;gap:6px;">
              <select id="sub2api-checker-group"
                style="flex:1;width:100%;box-sizing:border-box;padding:8px;border-radius:8px;border:1px solid #434a57;background:#111723;color:#fff;">
                <option value="">全部分组</option>
              </select>

              <button id="sub2api-checker-refresh-groups" type="button"
                style="padding:8px 10px;border:0;border-radius:8px;background:#13c2c2;color:#fff;cursor:pointer;">
                刷新
              </button>
            </div>
          </label>

          <div style="display:flex;gap:8px;align-items:center;">
            <button id="sub2api-checker-start-top" type="button"
              style="flex:1;padding:8px 10px;border:0;border-radius:8px;background:#1677ff;color:#fff;cursor:pointer;">
              开始巡检
            </button>

            <button id="sub2api-checker-stop-top" type="button"
              style="flex:1;padding:8px 10px;border:0;border-radius:8px;background:#fa541c;color:#fff;cursor:pointer;">
              停止
            </button>
          </div>

          <div style="display:flex;flex-direction:column;gap:9px;border:1px solid #30363d;border-radius:8px;padding:10px;background:#111723;">
            <div style="display:flex;align-items:center;justify-content:space-between;gap:8px;">
              <div style="font-weight:700;">批量操作</div>
              <div style="color:#8c98a9;">作用于当前分组，并发使用上方设置</div>
            </div>

            <div style="display:grid;grid-template-columns:86px minmax(0,1fr) 82px;gap:6px;align-items:center;">
              <div style="color:#bfbfbf;">隐私</div>
              <select id="sub2api-checker-privacy-mode"
                style="width:100%;box-sizing:border-box;padding:8px;border-radius:8px;border:1px solid #434a57;background:#0b0f17;color:#fff;">
                <option value="private">private / 私有</option>
                <option value="public">public / 公开</option>
                <option value="inherit">inherit / 默认</option>
              </select>

              <button id="sub2api-checker-set-privacy" type="button"
                style="height:34px;padding:0 10px;border:0;border-radius:8px;background:#722ed1;color:#fff;cursor:pointer;">
                设置
              </button>

              <div style="color:#bfbfbf;">账号状态</div>
              <select id="sub2api-checker-account-status"
                style="width:100%;box-sizing:border-box;padding:8px;border-radius:8px;border:1px solid #434a57;background:#0b0f17;color:#fff;">
                <option value="active">active / 正常</option>
                <option value="disabled">disabled / 停用</option>
                <option value="error">error / 错误</option>
                <option value="failed">failed / 失败</option>
                <option value="invalid">invalid / 无效</option>
              </select>

              <button id="sub2api-checker-set-account-status" type="button"
                style="height:34px;padding:0 10px;border:0;border-radius:8px;background:#fa8c16;color:#fff;cursor:pointer;">
                修改
              </button>

              <div style="color:#bfbfbf;">删除状态</div>
              <select id="sub2api-checker-delete-status"
                style="width:100%;box-sizing:border-box;padding:8px;border-radius:8px;border:1px solid #434a57;background:#0b0f17;color:#fff;">
                <option value="error">error / 错误</option>
                <option value="disabled">disabled / 停用</option>
                <option value="active">active / 正常</option>
                <option value="failed">failed / 失败</option>
                <option value="invalid">invalid / 无效</option>
              </select>

              <button id="sub2api-checker-delete-accounts" type="button"
                style="height:34px;padding:0 10px;border:0;border-radius:8px;background:#ff4d4f;color:#fff;cursor:pointer;">
                删除
              </button>

              <div style="color:#bfbfbf;">移动分组</div>
              <div style="display:grid;grid-template-columns:minmax(0,120px) minmax(0,1fr);gap:6px;">
                <select id="sub2api-checker-move-status"
                  style="width:100%;box-sizing:border-box;padding:8px;border-radius:8px;border:1px solid #434a57;background:#0b0f17;color:#fff;">
                  <option value="limited">limited / 限流</option>
                  <option value="error">error / 错误</option>
                  <option value="disabled">disabled / 停用</option>
                  <option value="active">active / 正常</option>
                  <option value="failed">failed / 失败</option>
                  <option value="invalid">invalid / 无效</option>
                </select>

                <input id="sub2api-checker-move-target-group" list="sub2api-checker-group-options" type="text" placeholder="目标分组"
                  style="width:100%;box-sizing:border-box;padding:8px;border-radius:8px;border:1px solid #434a57;background:#0b0f17;color:#fff;" />
              </div>

              <button id="sub2api-checker-move-accounts" type="button"
                style="height:34px;padding:0 10px;border:0;border-radius:8px;background:#13c2c2;color:#fff;cursor:pointer;">
                移动
              </button>

              <div style="color:#bfbfbf;">用量</div>
              <div style="color:#8c98a9;">查询当前分组账号，source=active</div>
              <button id="sub2api-checker-query-usage" type="button"
                style="height:34px;padding:0 10px;border:0;border-radius:8px;background:#1677ff;color:#fff;cursor:pointer;">
                查询
              </button>
            </div>

            <datalist id="sub2api-checker-group-options"></datalist>

            <div id="sub2api-checker-batch-progress" style="display:none;flex-direction:column;gap:6px;border-top:1px solid #30363d;padding-top:8px;">
              <div style="display:flex;align-items:center;justify-content:space-between;gap:8px;">
                <span id="sub2api-checker-batch-progress-title" style="font-weight:700;">批量任务</span>
                <span id="sub2api-checker-batch-progress-summary" style="color:#d9d9d9;">0/0 (0%)</span>
              </div>

              <div style="height:7px;background:#0b0f17;border-radius:999px;overflow:hidden;border:1px solid #30363d;">
                <div id="sub2api-checker-batch-progress-bar" style="width:0%;height:100%;background:#13c2c2;transition:width .18s ease;"></div>
              </div>

              <div id="sub2api-checker-batch-progress-detail" style="color:#8c98a9;">
                并发 0 | 成功 0 | 失败 0 | 跳过 0
              </div>
            </div>

            <div id="sub2api-checker-usage-results" style="display:none;flex-direction:column;gap:7px;border-top:1px solid #30363d;padding-top:8px;">
              <div style="display:flex;align-items:center;justify-content:space-between;gap:8px;">
                <span id="sub2api-checker-usage-title" style="font-weight:700;">账号用量</span>
                <button id="sub2api-checker-clear-usage" type="button"
                  style="height:26px;padding:0 8px;border:0;border-radius:6px;background:#434a57;color:#fff;cursor:pointer;">
                  清空
                </button>
              </div>

              <div id="sub2api-checker-usage-list" style="display:flex;flex-direction:column;gap:6px;max-height:420px;overflow:auto;"></div>
            </div>
          </div>

          <div style="display:flex;flex-direction:column;gap:8px;border:1px solid #30363d;border-radius:8px;padding:10px;background:rgba(255,255,255,.03);">
            <div style="font-weight:700;">批量添加定时测试计划</div>
            <div style="color:#bfbfbf;">作用于当前选择分组，模型使用上方“测试模型”。</div>

            <div style="display:flex;gap:6px;">
              <label style="display:flex;flex-direction:column;gap:4px;flex:1;">
                <span>Cron 表达式</span>
                <input id="sub2api-checker-scheduled-cron" type="text" placeholder="*/30 * * * *"
                  style="width:100%;box-sizing:border-box;padding:8px;border-radius:8px;border:1px solid #434a57;background:#111723;color:#fff;" />
              </label>

              <label style="display:flex;flex-direction:column;gap:4px;width:110px;">
                <span>最大结果数</span>
                <input id="sub2api-checker-scheduled-max-results" type="number" min="1" step="1" placeholder="100"
                  style="width:100%;box-sizing:border-box;padding:8px;border-radius:8px;border:1px solid #434a57;background:#111723;color:#fff;" />
              </label>
            </div>

            <div style="display:grid;grid-template-columns:1fr 1fr;gap:6px;">
              <label style="display:flex;align-items:center;gap:6px;">
                <input id="sub2api-checker-scheduled-enabled" type="checkbox" />
                <span>启用</span>
              </label>

              <label style="display:flex;align-items:center;gap:6px;">
                <input id="sub2api-checker-scheduled-auto-recover" type="checkbox" />
                <span>自动恢复</span>
              </label>

              <label style="display:flex;align-items:center;gap:6px;grid-column:1 / 3;">
                <input id="sub2api-checker-scheduled-update-existing" type="checkbox" />
                <span>已有同模型计划则更新</span>
              </label>
            </div>

            <button id="sub2api-checker-add-scheduled-tests" type="button"
              style="padding:8px 10px;border:0;border-radius:8px;background:#13c2c2;color:#fff;cursor:pointer;">
              批量添加计划
            </button>
          </div>

          <div style="display:flex;gap:8px;align-items:center;position:sticky;bottom:0;z-index:2;background:rgba(16, 18, 27, 0.96);padding-top:4px;">
            <button id="sub2api-checker-start"
              style="flex:1;padding:8px 10px;border:0;border-radius:8px;background:#1677ff;color:#fff;cursor:pointer;">
              开始巡检
            </button>

            <button id="sub2api-checker-stop"
              style="flex:1;padding:8px 10px;border:0;border-radius:8px;background:#fa541c;color:#fff;cursor:pointer;">
              停止
            </button>
          </div>

          <div id="sub2api-checker-stats" style="color:#bfbfbf;">
            总数 0 | 已处理 0 | 正常 0 | 已启用 0 | 已关闭 0 | 跳过 0 | 异常 0
          </div>

          <div style="display:flex;align-items:center;justify-content:space-between;gap:8px;">
            <div style="font-weight:700;">日志</div>
            <button id="sub2api-checker-clear-log" type="button"
              style="height:26px;padding:0 8px;border:0;border-radius:6px;background:#434a57;color:#fff;cursor:pointer;">
              清空日志
            </button>
          </div>

          <div id="sub2api-checker-log"
            style="height:320px;overflow:auto;background:#0b0f17;border:1px solid #30363d;border-radius:8px;padding:8px;">
          </div>
        </div>
      </div>
    `;

    shell.appendChild(root);

    const authInput = root.querySelector('#sub2api-checker-auth');
    authInput.value = state.authHeader;
    authInput.addEventListener('change', () => {
      const v = authInput.value.trim();
      if (v) saveAuth(v);
    });

    const timeoutInput = root.querySelector('#sub2api-checker-timeout');
    timeoutInput.value = String(Math.floor(state.timeoutMs / 1000));
    timeoutInput.addEventListener('change', () => {
      const sec = Number(timeoutInput.value || 0);
      if (!saveTimeoutMs(sec * 1000)) {
        timeoutInput.value = String(Math.floor(state.timeoutMs / 1000));
        log('超时时间无效，需大于等于 1 秒', 'error');
        return;
      }
      log(`已设置单模型超时 ${sec} 秒`, 'success');
    });

    const concurrencyInput = root.querySelector('#sub2api-checker-concurrency');
    concurrencyInput.value = String(state.concurrency || CONFIG.defaultConcurrency);
    concurrencyInput.addEventListener('change', () => {
      if (!saveConcurrency(concurrencyInput.value)) {
        concurrencyInput.value = String(state.concurrency || CONFIG.defaultConcurrency);
        log('并发账号数无效，需大于等于 1', 'error');
        return;
      }

      log(`已设置并发账号数 ${state.concurrency}`, 'success');
    });

    const testModelInput = root.querySelector('#sub2api-checker-test-model');
    renderModelSelect();
    testModelInput.addEventListener('change', () => {
      const model = testModelInput.value.trim();
      if (!saveTestModel(model)) {
        testModelInput.value = state.testModel;
        log('测试模型不能为空', 'error');
        return;
      }
      log(`已设置测试模型 ${state.testModel}`, 'success');
    });

    root.querySelector('#sub2api-checker-refresh-models').addEventListener('click', () => {
      loadModels().catch((err) => log(`刷新模型失败：${err.message}`, 'error'));
    });

    const groupInput = root.querySelector('#sub2api-checker-group');
    renderGroupSelect();
    groupInput.addEventListener('change', () => {
      saveTargetGroup(groupInput.value);

      if (state.targetGroup) {
        log(`已设置巡检分组：${state.targetGroup}`, 'success');
      } else {
        log('已选择全部分组', 'warn');
      }
    });

    root.querySelector('#sub2api-checker-refresh-groups').addEventListener('click', () => {
      loadGroups().catch((err) => log(`刷新分组失败：${err.message}`, 'error'));
    });

    const privacyModeSelect = root.querySelector('#sub2api-checker-privacy-mode');
    privacyModeSelect.value = state.privacyMode || 'private';
    privacyModeSelect.addEventListener('change', () => {
      state.privacyMode = privacyModeSelect.value;
      localStorage.setItem(CONFIG.privacyModeStorageKey, state.privacyMode);
      log(`已选择隐私模式：${state.privacyMode}`, 'success');
    });

    root.querySelector('#sub2api-checker-set-privacy').addEventListener('click', () => {
      batchSetPrivacy().catch((err) => {
        log(`批量设置隐私异常：${err.message}`, 'error');
        state.running = false;
      });
    });

    const accountStatusSelect = root.querySelector('#sub2api-checker-account-status');
    accountStatusSelect.value = state.accountStatus || 'active';
    accountStatusSelect.addEventListener('change', () => {
      state.accountStatus = accountStatusSelect.value || 'active';
      localStorage.setItem(CONFIG.accountStatusStorageKey, state.accountStatus);
      log(`已选择目标账号状态：${state.accountStatus}`, 'success');
    });

    root.querySelector('#sub2api-checker-set-account-status').addEventListener('click', () => {
      batchSetAccountStatus().catch((err) => {
        log(`批量修改账号状态异常：${err.message}`, 'error');
        state.running = false;
      });
    });

    const deleteStatusSelect = root.querySelector('#sub2api-checker-delete-status');
    deleteStatusSelect.value = state.deleteStatus || 'error';
    deleteStatusSelect.addEventListener('change', () => {
      state.deleteStatus = deleteStatusSelect.value || 'error';
      localStorage.setItem(CONFIG.deleteStatusStorageKey, state.deleteStatus);
      log(`已选择待删除状态：${state.deleteStatus}`, 'success');
    });

    root.querySelector('#sub2api-checker-delete-accounts').addEventListener('click', () => {
      batchDeleteAccounts().catch((err) => {
        log(`批量删除账号异常：${err.message}`, 'error');
        state.running = false;
      });
    });

    const moveStatusSelect = root.querySelector('#sub2api-checker-move-status');
    moveStatusSelect.value = state.moveStatus || 'limited';
    moveStatusSelect.addEventListener('change', () => {
      state.moveStatus = moveStatusSelect.value || 'limited';
      localStorage.setItem(CONFIG.moveStatusStorageKey, state.moveStatus);
      log(`已选择待移动状态：${state.moveStatus}`, 'success');
    });

    const moveTargetGroupInput = root.querySelector('#sub2api-checker-move-target-group');
    moveTargetGroupInput.value = state.moveTargetGroup || '';
    moveTargetGroupInput.addEventListener('change', () => {
      state.moveTargetGroup = normalizeGroupName(moveTargetGroupInput.value);
      localStorage.setItem(CONFIG.moveTargetGroupStorageKey, state.moveTargetGroup);
      moveTargetGroupInput.value = state.moveTargetGroup;
      log(state.moveTargetGroup ? `已设置移动目标分组：${state.moveTargetGroup}` : '已清空移动目标分组', state.moveTargetGroup ? 'success' : 'warn');
    });

    root.querySelector('#sub2api-checker-move-accounts').addEventListener('click', () => {
      batchMoveAccounts().catch((err) => {
        log(`批量移动分组异常：${err.message}`, 'error');
        state.running = false;
      });
    });

    root.querySelector('#sub2api-checker-query-usage').addEventListener('click', () => {
      batchQueryUsage().catch((err) => {
        log(`批量查询用量异常：${err.message}`, 'error');
        state.running = false;
      });
    });

    root.querySelector('#sub2api-checker-clear-usage').addEventListener('click', () => {
      const box = root.querySelector('#sub2api-checker-usage-results');
      const list = root.querySelector('#sub2api-checker-usage-list');
      if (list) list.innerHTML = '';
      if (box) box.style.display = 'none';
      log('已清空账号用量结果', 'warn');
    });

    const scheduledCronInput = root.querySelector('#sub2api-checker-scheduled-cron');
    scheduledCronInput.value = state.scheduledCron;
    scheduledCronInput.addEventListener('change', () => {
      state.scheduledCron = scheduledCronInput.value.trim() || '*/30 * * * *';
      localStorage.setItem(CONFIG.scheduledCronStorageKey, state.scheduledCron);
      scheduledCronInput.value = state.scheduledCron;
      log(`已设置定时测试 Cron：${state.scheduledCron}`, 'success');
    });

    const scheduledMaxResultsInput = root.querySelector('#sub2api-checker-scheduled-max-results');
    scheduledMaxResultsInput.value = String(state.scheduledMaxResults);
    scheduledMaxResultsInput.addEventListener('change', () => {
      const n = Number(scheduledMaxResultsInput.value || 0);

      if (!Number.isFinite(n) || n < 1) {
        scheduledMaxResultsInput.value = String(state.scheduledMaxResults);
        log('最大结果数必须大于等于 1', 'error');
        return;
      }

      state.scheduledMaxResults = Math.floor(n);
      localStorage.setItem(CONFIG.scheduledMaxResultsStorageKey, String(state.scheduledMaxResults));
      scheduledMaxResultsInput.value = String(state.scheduledMaxResults);
      log(`已设置最大结果数：${state.scheduledMaxResults}`, 'success');
    });

    const scheduledEnabledInput = root.querySelector('#sub2api-checker-scheduled-enabled');
    scheduledEnabledInput.checked = state.scheduledEnabled;
    scheduledEnabledInput.addEventListener('change', () => {
      state.scheduledEnabled = !!scheduledEnabledInput.checked;
      localStorage.setItem(CONFIG.scheduledEnabledStorageKey, String(state.scheduledEnabled));
      log(`定时测试启用 = ${state.scheduledEnabled}`, 'success');
    });

    const scheduledAutoRecoverInput = root.querySelector('#sub2api-checker-scheduled-auto-recover');
    scheduledAutoRecoverInput.checked = state.scheduledAutoRecover;
    scheduledAutoRecoverInput.addEventListener('change', () => {
      state.scheduledAutoRecover = !!scheduledAutoRecoverInput.checked;
      localStorage.setItem(CONFIG.scheduledAutoRecoverStorageKey, String(state.scheduledAutoRecover));
      log(`定时测试自动恢复 = ${state.scheduledAutoRecover}`, 'success');
    });

    const scheduledUpdateExistingInput = root.querySelector('#sub2api-checker-scheduled-update-existing');
    scheduledUpdateExistingInput.checked = state.scheduledUpdateExisting;
    scheduledUpdateExistingInput.addEventListener('change', () => {
      state.scheduledUpdateExisting = !!scheduledUpdateExistingInput.checked;
      localStorage.setItem(CONFIG.scheduledUpdateExistingStorageKey, String(state.scheduledUpdateExisting));
      log(`已有同模型计划则更新 = ${state.scheduledUpdateExisting}`, 'success');
    });

    root.querySelector('#sub2api-checker-add-scheduled-tests').addEventListener('click', () => {
      batchAddScheduledTests().catch((err) => {
        log(`批量添加定时测试计划异常：${err.message}`, 'error');
        state.running = false;
      });
    });

    const startCheck = () => {
      run().catch((err) => {
        log(`运行异常：${err.message}`, 'error');
        state.running = false;
      });
    };

    const stopCheck = () => {
      state.stopRequested = true;
      log('已请求停止，当前请求结束后退出', 'warn');
    };

    root.querySelector('#sub2api-checker-start').addEventListener('click', startCheck);
    root.querySelector('#sub2api-checker-start-top').addEventListener('click', startCheck);
    root.querySelector('#sub2api-checker-stop').addEventListener('click', stopCheck);
    root.querySelector('#sub2api-checker-stop-top').addEventListener('click', stopCheck);

    root.querySelector('#sub2api-checker-clear-log').addEventListener('click', () => {
      const logBox = root.querySelector('#sub2api-checker-log');
      if (logBox) logBox.innerHTML = '';
    });

    updatePanelCollapsed();
  }

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

  function normalizeScheduledTestConfig() {
    const cronInput = document.querySelector('#sub2api-checker-scheduled-cron');
    const maxResultsInput = document.querySelector('#sub2api-checker-scheduled-max-results');
    const enabledInput = document.querySelector('#sub2api-checker-scheduled-enabled');
    const autoRecoverInput = document.querySelector('#sub2api-checker-scheduled-auto-recover');
    const updateExistingInput = document.querySelector('#sub2api-checker-scheduled-update-existing');

    const modelId = String(state.testModel || '').trim();
    const cronExpression = String(cronInput?.value || state.scheduledCron || '').trim();
    const maxResults = Math.floor(Number(maxResultsInput?.value || state.scheduledMaxResults || 0));
    const enabled = !!(enabledInput ? enabledInput.checked : state.scheduledEnabled);
    const autoRecover = !!(autoRecoverInput ? autoRecoverInput.checked : state.scheduledAutoRecover);
    const updateExisting = !!(updateExistingInput ? updateExistingInput.checked : state.scheduledUpdateExisting);

    if (!modelId) {
      throw new Error('请先选择上方测试模型');
    }

    if (!cronExpression) {
      throw new Error('Cron 表达式不能为空');
    }

    const fields = cronExpression.split(/\s+/).filter(Boolean);
    if (fields.length !== 5) {
      throw new Error('Cron 表达式需要是标准 5 字段格式，例如 */30 * * * *');
    }

    if (!Number.isFinite(maxResults) || maxResults < 1) {
      throw new Error('最大结果数必须大于等于 1');
    }

    state.scheduledCron = cronExpression;
    state.scheduledMaxResults = maxResults;
    state.scheduledEnabled = enabled;
    state.scheduledAutoRecover = autoRecover;
    state.scheduledUpdateExisting = updateExisting;

    localStorage.setItem(CONFIG.scheduledCronStorageKey, cronExpression);
    localStorage.setItem(CONFIG.scheduledMaxResultsStorageKey, String(maxResults));
    localStorage.setItem(CONFIG.scheduledEnabledStorageKey, String(enabled));
    localStorage.setItem(CONFIG.scheduledAutoRecoverStorageKey, String(autoRecover));
    localStorage.setItem(CONFIG.scheduledUpdateExistingStorageKey, String(updateExisting));

    return {
      model_id: modelId,
      cron_expression: cronExpression,
      max_results: maxResults,
      enabled,
      auto_recover: autoRecover,
      updateExisting,
    };
  }

  function getPlanId(plan) {
    return plan?.id ?? plan?.ID ?? plan?.plan_id ?? plan?.planId ?? '';
  }

  function getPlanModelId(plan) {
    return String(plan?.model_id ?? plan?.modelId ?? plan?.model ?? '').trim();
  }

  function getPlanCronExpression(plan) {
    return String(plan?.cron_expression ?? plan?.cronExpression ?? '').trim();
  }

  async function parseJsonResponse(resp) {
    const text = await resp.text();

    let json = null;
    try {
      json = JSON.parse(text);
    } catch (_) {}

    if (!resp.ok) {
      return {
        ok: false,
        reason: `HTTP ${resp.status}: ${text.slice(0, 300)}`,
        data: json || text,
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

  async function fetchScheduledTestPlans(accountId) {
    const url = new URL(`/api/v1/admin/accounts/${accountId}/scheduled-test-plans`, CONFIG.apiBase);
    url.searchParams.set('timezone', Intl.DateTimeFormat().resolvedOptions().timeZone || 'Asia/Shanghai');

    const resp = await apiFetch(url.toString(), {
      headers: {
        Accept: 'application/json, text/plain, */*',
      },
    });

    const result = await parseJsonResponse(resp);

    if (!result.ok) return result;

    const data = result.data?.data ?? result.data;
    const plans = Array.isArray(data) ? data : (Array.isArray(data?.items) ? data.items : []);

    return {
      ok: true,
      data: plans,
    };
  }

  async function createScheduledTestPlan(accountId, config) {
    const payload = {
      account_id: accountId,
      model_id: config.model_id,
      cron_expression: config.cron_expression,
      enabled: config.enabled,
      max_results: config.max_results,
      auto_recover: config.auto_recover,
    };

    const resp = await apiFetch(`${CONFIG.apiBase}/api/v1/admin/scheduled-test-plans`, {
      method: 'POST',
      headers: {
        Accept: 'application/json, text/plain, */*',
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(payload),
    });

    return parseJsonResponse(resp);
  }

  async function updateScheduledTestPlan(planId, config) {
    const payload = {
      model_id: config.model_id,
      cron_expression: config.cron_expression,
      enabled: config.enabled,
      max_results: config.max_results,
      auto_recover: config.auto_recover,
    };

    const resp = await apiFetch(`${CONFIG.apiBase}/api/v1/admin/scheduled-test-plans/${planId}`, {
      method: 'PUT',
      headers: {
        Accept: 'application/json, text/plain, */*',
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(payload),
    });

    return parseJsonResponse(resp);
  }

  async function upsertScheduledTestPlan(account, config) {
    if (config.updateExisting) {
      const existing = await fetchScheduledTestPlans(account.id);

      if (!existing.ok) {
        return {
          ok: false,
          action: 'list',
          reason: existing.reason,
        };
      }

      const sameModelPlan = existing.data.find((plan) => getPlanModelId(plan) === config.model_id);

      if (sameModelPlan) {
        const planId = getPlanId(sameModelPlan);

        if (!planId) {
          return {
            ok: false,
            action: 'update',
            reason: '找到同模型计划，但无法识别计划 ID',
          };
        }

        const updated = await updateScheduledTestPlan(planId, config);

        return {
          ...updated,
          action: 'update',
          plan: sameModelPlan,
        };
      }
    }

    const created = await createScheduledTestPlan(account.id, config);

    return {
      ...created,
      action: 'create',
    };
  }

  function getBatchConcurrency(total) {
    const input = document.querySelector('#sub2api-checker-concurrency');

    if (input && !saveConcurrency(input.value)) {
      log('并发账号数无效，已取消批量任务', 'error');
      return 0;
    }

    return Math.min(
      Math.max(1, state.concurrency || CONFIG.defaultConcurrency),
      Math.max(1, total)
    );
  }

  function updateBatchProgress(progress) {
    const box = document.querySelector('#sub2api-checker-batch-progress');
    if (!box) return;

    const total = Math.max(0, progress.total || 0);
    const processed = Math.min(total, Math.max(0, progress.processed || 0));
    const percent = total ? Math.round((processed / total) * 100) : 0;

    box.style.display = 'flex';

    const title = box.querySelector('#sub2api-checker-batch-progress-title');
    const summary = box.querySelector('#sub2api-checker-batch-progress-summary');
    const bar = box.querySelector('#sub2api-checker-batch-progress-bar');
    const detail = box.querySelector('#sub2api-checker-batch-progress-detail');

    if (title) title.textContent = progress.title || '批量任务';
    if (summary) summary.textContent = `${processed}/${total} (${percent}%)`;
    if (bar) bar.style.width = `${percent}%`;
    if (detail) {
      detail.textContent =
        `并发 ${progress.concurrency || 1} | 成功 ${progress.success || 0} | 失败 ${progress.failed || 0} | 跳过 ${progress.skipped || 0}`;
    }
  }

  function resetBatchProgress(title, total, concurrency) {
    updateBatchProgress({
      title,
      total,
      concurrency,
      processed: 0,
      success: 0,
      failed: 0,
      skipped: 0,
    });
  }

  async function copyTextToClipboard(text) {
    const value = String(text || '').trim();
    if (!value) return false;

    try {
      await navigator.clipboard.writeText(value);
      return true;
    } catch (_) {}

    const textarea = document.createElement('textarea');
    textarea.value = value;
    textarea.style.cssText = 'position:fixed;left:-9999px;top:-9999px;';
    document.body.appendChild(textarea);
    textarea.focus();
    textarea.select();

    let ok = false;
    try {
      ok = document.execCommand('copy');
    } catch (_) {}

    textarea.remove();
    return ok;
  }

  function getUsageBarColor(percent) {
    if (percent >= 90) return '#ff4d4f';
    if (percent >= 80) return '#fa8c16';
    return '#20c7a7';
  }

  function renderUsageBars(rawData, account, ok) {
    const wrapper = document.createElement('div');
    wrapper.style.cssText = 'display:flex;flex-direction:column;gap:8px;';

    if (!ok) return wrapper;

    const windows = getAccountUsageWindows(rawData, account);

    if (!windows.length) {
      const empty = document.createElement('div');
      empty.style.cssText = 'color:#8c98a9;';
      empty.textContent = '未读取到用量窗口';
      wrapper.appendChild(empty);
      return wrapper;
    }

    for (const item of windows) {
      const row = document.createElement('div');
      row.style.cssText = 'display:grid;grid-template-columns:36px minmax(0,1fr);gap:8px;align-items:center;';

      const label = document.createElement('div');
      label.style.cssText = 'font-weight:700;color:#fff;';
      label.textContent = item.label;

      const right = document.createElement('div');
      right.style.cssText = 'display:flex;flex-direction:column;gap:4px;min-width:0;';

      const meta = document.createElement('div');
      meta.style.cssText = 'display:flex;align-items:center;gap:10px;color:#d9d9d9;font-size:11px;';

      const percent = document.createElement('span');
      percent.style.cssText = `font-weight:700;color:${getUsageBarColor(item.percent)};`;
      percent.textContent = `${item.percent}%`;

      const reset = document.createElement('span');
      reset.style.cssText = 'color:#8c98a9;';
      reset.textContent = item.reset || '现在';

      meta.appendChild(percent);
      meta.appendChild(reset);

      const track = document.createElement('div');
      track.style.cssText = 'height:7px;background:#26303d;border-radius:999px;overflow:hidden;';

      const fill = document.createElement('div');
      fill.style.cssText = `width:${item.percent}%;height:100%;background:${getUsageBarColor(item.percent)};border-radius:999px;`;

      track.appendChild(fill);
      right.appendChild(meta);
      right.appendChild(track);
      row.appendChild(label);
      row.appendChild(right);
      wrapper.appendChild(row);
    }

    return wrapper;
  }

  function resetUsageResults(total, scopeText) {
    const box = document.querySelector('#sub2api-checker-usage-results');
    const title = document.querySelector('#sub2api-checker-usage-title');
    const list = document.querySelector('#sub2api-checker-usage-list');

    if (!box || !list) return;

    box.style.display = 'flex';
    list.innerHTML = '';

    if (title) {
      title.textContent = `账号用量 - ${scopeText}，共 ${total} 个`;
    }

    setTimeout(() => {
      box.scrollIntoView({ block: 'nearest' });
    }, 50);
  }

  function appendUsageResult(account, result) {
    const list = document.querySelector('#sub2api-checker-usage-list');
    if (!list) return;

    const accountId = getAccountId(account) || '?';
    const accountName = getAccountDisplayName(account) || '(未命名)';
    const status = getAccountStatus(account) || '无状态';
    const usageLevel = getAccountUsageLevel(result?.data, account);
    const row = document.createElement('div');

    row.style.cssText = `
      display:flex;
      flex-direction:column;
      gap:4px;
      padding:7px 8px;
      border:1px solid ${usageLevel.border};
      border-radius:8px;
      background:${usageLevel.background};
    `;

    const header = document.createElement('div');
    header.style.cssText = 'display:flex;align-items:center;justify-content:space-between;gap:8px;';

    const name = document.createElement('span');
    name.style.cssText = 'font-weight:700;color:#fff;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;min-width:0;';
    name.textContent = `#${accountId} ${accountName}`;

    const actions = document.createElement('div');
    actions.style.cssText = 'display:flex;align-items:center;gap:6px;flex:0 0 auto;';

    const copyButton = document.createElement('button');
    copyButton.type = 'button';
    copyButton.textContent = '复制';
    copyButton.title = '复制账号';
    copyButton.style.cssText = 'height:24px;padding:0 7px;border:0;border-radius:6px;background:#434a57;color:#fff;cursor:pointer;font:inherit;';
    copyButton.addEventListener('click', async () => {
      const ok = await copyTextToClipboard(accountName);
      copyButton.textContent = ok ? '已复制' : '失败';
      setTimeout(() => {
        copyButton.textContent = '复制';
      }, 1200);
    });

    const badge = document.createElement('span');
    badge.style.cssText = `color:${result?.ok ? '#95de64' : '#ff7875'};`;
    badge.textContent = result?.ok ? '成功' : '失败';

    actions.appendChild(copyButton);
    actions.appendChild(badge);

    const detail = result?.ok ? renderUsageBars(result.data, account, true) : document.createElement('div');

    if (!result?.ok) {
      detail.style.cssText = 'color:#ffccc7;word-break:break-all;';
      detail.textContent = result?.reason || '未知错误';
    }

    const meta = document.createElement('div');
    meta.style.cssText = 'color:#8c98a9;';
    meta.textContent = `状态：${status}`;

    header.appendChild(name);
    header.appendChild(actions);
    row.appendChild(header);
    row.appendChild(detail);
    row.appendChild(meta);
    list.appendChild(row);
  }

  async function runConcurrentAccountBatch(accounts, concurrency, workerName, action) {
    let cursor = 0;

    const progress = {
      title: workerName,
      total: accounts.length,
      concurrency,
      processed: 0,
      success: 0,
      failed: 0,
      skipped: 0,
    };

    updateBatchProgress(progress);

    const workerCount = Math.min(Math.max(1, concurrency), Math.max(1, accounts.length));

    const workers = Array.from({ length: workerCount }, async (_, workerIndex) => {
      while (!state.stopRequested) {
        const index = cursor;
        cursor += 1;

        if (index >= accounts.length) break;

        let result;

        try {
          result = await action(accounts[index], index, workerIndex);
        } catch (err) {
          const account = accounts[index];
          const title = `#${getAccountId(account) || '?'} ${account?.name || '(未命名)'}`;

          result = {
            ok: false,
            reason: err?.message || String(err),
          };

          log(`${title} ${workerName}异常：${result.reason}`, 'error');
        }

        if (result?.skipped) {
          progress.skipped += 1;
        } else if (result?.ok) {
          progress.success += 1;
        } else {
          progress.failed += 1;
        }

        progress.processed += 1;
        updateBatchProgress(progress);

        if (!state.stopRequested) {
          await sleep(80 + workerIndex * 20);
        }
      }
    });

    await Promise.all(workers);

    return progress;
  }

  async function batchAddScheduledTests() {
    if (state.running) {
      log('当前有任务在运行，请先停止或等待完成', 'warn');
      return;
    }

    if (!(await ensureAuth())) {
      log('缺少 Authorization，已取消批量添加定时测试计划', 'error');
      return;
    }

    let config;

    try {
      config = normalizeScheduledTestConfig();
    } catch (err) {
      log(`定时测试计划配置错误：${err.message}`, 'error');
      return;
    }

    const targetGroupText = state.targetGroup ? `分组「${state.targetGroup}」` : '全部分组';
    const ok = confirm(
      `确定要给 ${targetGroupText} 的账号批量添加定时测试计划吗？\n\n` +
      `模型：${config.model_id}\n` +
      `Cron：${config.cron_expression}\n` +
      `自动恢复：${config.auto_recover ? '开启' : '关闭'}`
    );

    if (!ok) {
      log('已取消批量添加定时测试计划', 'warn');
      return;
    }

    state.running = true;
    state.stopRequested = false;

    try {
      log(`开始拉取账号，准备批量添加定时测试计划，范围：${targetGroupText}`);
      log(`计划参数：模型 ${config.model_id}，Cron ${config.cron_expression}，最大结果数 ${config.max_results}，启用 ${config.enabled}，自动恢复 ${config.auto_recover}`);

      const accounts = await fetchAccounts();

      log(`本次需要处理账号数：${accounts.length}`);

      let created = 0;
      let updated = 0;
      let failed = 0;

      for (const account of accounts) {
        if (state.stopRequested) {
          log('批量添加定时测试计划已按要求停止', 'warn');
          break;
        }

        const title = `#${account.id} ${account.name || '(未命名)'}`;

        log(`${title} 处理定时测试计划`);

        const result = await upsertScheduledTestPlan(account, config);

        if (result.ok) {
          if (result.action === 'update') {
            updated += 1;
            log(`${title} 已更新同模型计划`, 'success');
          } else {
            created += 1;
            log(`${title} 已添加计划`, 'success');
          }
        } else {
          failed += 1;
          log(`${title} 计划处理失败：${result.reason}`, 'error');
        }

        await sleep(200);
      }

      log(`批量添加定时测试计划完成：新增 ${created}，更新 ${updated}，失败 ${failed}`, failed ? 'warn' : 'success');
    } finally {
      state.running = false;
    }
  }

  async function batchSetPrivacy() {
    if (state.running) {
      log('当前有巡检任务在运行，请先停止或等待完成', 'warn');
      return;
    }

    if (!(await ensureAuth())) {
      log('缺少 Authorization，已取消批量设置隐私', 'error');
      return;
    }

    const select = document.querySelector('#sub2api-checker-privacy-mode');
    const privacyMode = select?.value || state.privacyMode || 'private';

    state.privacyMode = privacyMode;
    localStorage.setItem(CONFIG.privacyModeStorageKey, privacyMode);

    const targetGroupText = state.targetGroup ? `分组「${state.targetGroup}」` : '全部分组';

    const ok = confirm(`确定要把 ${targetGroupText} 的账号批量设置为 ${privacyMode} 吗？`);

    if (!ok) {
      log('已取消批量设置隐私', 'warn');
      return;
    }

    state.running = true;
    state.stopRequested = false;

    try {
      log(`开始拉取账号，准备批量设置隐私：${privacyMode}，范围：${targetGroupText}`);

      const accounts = await fetchAccounts();

      log(`本次需要设置隐私的账号数：${accounts.length}`);

      let success = 0;
      let failed = 0;

      for (const account of accounts) {
        if (state.stopRequested) {
          log('批量设置隐私已按要求停止', 'warn');
          break;
        }

        const title = `#${account.id} ${account.name || '(未命名)'}`;

        log(`${title} 设置隐私为 ${privacyMode}`);

        const result = await setAccountPrivacy(account.id, privacyMode);

        if (result.ok) {
          success += 1;
          log(`${title} 设置隐私成功`, 'success');
        } else {
          failed += 1;
          log(`${title} 设置隐私失败：${result.reason}`, 'error');
        }

        await sleep(200);
      }

      log(`批量设置隐私完成：成功 ${success}，失败 ${failed}`, failed ? 'warn' : 'success');
    } finally {
      state.running = false;
    }
  }

  async function batchSetAccountStatus() {
    if (state.running) {
      log('当前有任务在运行，请先停止或等待完成', 'warn');
      return;
    }

    if (!(await ensureAuth())) {
      log('缺少 Authorization，已取消批量修改账号状态', 'error');
      return;
    }

    const targetGroup = normalizeGroupName(state.targetGroup);
    if (!targetGroup) {
      log('批量修改账号状态需要先选择一个具体分组，不能直接作用于全部分组', 'error');
      return;
    }

    const select = document.querySelector('#sub2api-checker-account-status');
    const accountStatus = normalizeStatusText(select?.value || state.accountStatus || 'active');

    if (!accountStatus) {
      log('目标账号状态不能为空', 'error');
      return;
    }

    state.accountStatus = accountStatus;
    localStorage.setItem(CONFIG.accountStatusStorageKey, accountStatus);

    state.running = true;
    state.stopRequested = false;

    try {
      log(`开始拉取账号，准备批量修改账号状态：分组 ${targetGroup}，目标状态 ${accountStatus}`);

      const accounts = await fetchAccounts();

      log(`本次需要修改状态的账号数：${accounts.length}`);

      if (!accounts.length) {
        log('当前分组没有账号，无需修改', 'success');
        return;
      }

      const preview = accounts
        .slice(0, 10)
        .map((account) => `#${getAccountId(account) || '?'} ${account.name || '(未命名)'} [当前：${getAccountStatus(account) || '无状态'}]`)
        .join('\n');

      const ok = confirm(
        `确定要把分组「${targetGroup}」中的账号批量修改为状态「${accountStatus}」吗？\n\n` +
        `账号数量：${accounts.length}\n` +
        `前 ${Math.min(accounts.length, 10)} 个账号：\n${preview}`
      );

      if (!ok) {
        log('已取消批量修改账号状态', 'warn');
        return;
      }

      const concurrency = getBatchConcurrency(accounts.length);
      if (!concurrency) return;

      resetBatchProgress('批量修改账号状态', accounts.length, concurrency);
      log(`本次批量修改状态并发账号数：${concurrency}`, 'success');

      const progress = await runConcurrentAccountBatch(accounts, concurrency, '修改状态', async (account) => {
        const accountId = getAccountId(account);
        const title = `#${accountId || '?'} ${account.name || '(未命名)'}`;

        if (!accountId) {
          log(`${title} 无法识别账号 ID，已跳过`, 'error');
          return { skipped: true };
        }

        log(`${title} 修改状态：${getAccountStatus(account) || '无状态'} -> ${accountStatus}`);

        const result = await setAccountStatus(accountId, accountStatus);

        if (result.ok) {
          log(`${title} 修改状态成功`, 'success');
        } else {
          log(`${title} 修改状态失败：${result.reason}`, 'error');
        }

        return result;
      });

      if (state.stopRequested) {
        log('批量修改账号状态已按要求停止', 'warn');
      }

      log(
        `批量修改账号状态完成：已处理 ${progress.processed}/${progress.total}，成功 ${progress.success}，失败 ${progress.failed}，跳过 ${progress.skipped}`,
        progress.failed || progress.skipped ? 'warn' : 'success'
      );

      loadGroups().catch((err) => log(`修改状态后刷新分组失败：${err.message}`, 'warn'));
    } finally {
      state.running = false;
    }
  }

  async function batchDeleteAccounts() {
    if (state.running) {
      log('当前有任务在运行，请先停止或等待完成', 'warn');
      return;
    }

    if (!(await ensureAuth())) {
      log('缺少 Authorization，已取消批量删除账号', 'error');
      return;
    }

    const targetGroup = normalizeGroupName(state.targetGroup);
    if (!targetGroup) {
      log('批量删除需要先选择一个具体分组，不能直接作用于全部分组', 'error');
      return;
    }

    const select = document.querySelector('#sub2api-checker-delete-status');
    const deleteStatus = normalizeStatusText(select?.value || state.deleteStatus || 'error');

    if (!deleteStatus) {
      log('待删除状态不能为空', 'error');
      return;
    }

    state.deleteStatus = deleteStatus;
    localStorage.setItem(CONFIG.deleteStatusStorageKey, deleteStatus);

    state.running = true;
    state.stopRequested = false;

    try {
      log(`开始拉取账号，准备批量删除：分组 ${targetGroup}，状态 ${deleteStatus}`);

      const groupedAccounts = await fetchAccounts();
      const accounts = filterAccountsByStatus(groupedAccounts, deleteStatus);

      log(`当前分组账号数：${groupedAccounts.length}，匹配状态 ${deleteStatus} 的账号数：${accounts.length}`, accounts.length ? 'warn' : 'success');

      if (!accounts.length) {
        log('没有匹配条件的账号，无需删除', 'success');
        return;
      }

      const preview = accounts
        .slice(0, 10)
        .map((account) => `#${getAccountId(account) || '?'} ${account.name || '(未命名)'} [${getAccountStatus(account) || '无状态'}]`)
        .join('\n');

      const ok = confirm(
        `确定要删除分组「${targetGroup}」中状态为「${deleteStatus}」的账号吗？\n\n` +
        `匹配数量：${accounts.length}\n` +
        `前 ${Math.min(accounts.length, 10)} 个账号：\n${preview}\n\n` +
        '删除后不可恢复，请确认。'
      );

      if (!ok) {
        log('已取消批量删除账号', 'warn');
        return;
      }

      const concurrency = getBatchConcurrency(accounts.length);
      if (!concurrency) return;

      resetBatchProgress('批量删除账号', accounts.length, concurrency);
      log(`本次批量删除并发账号数：${concurrency}`, 'success');

      const progress = await runConcurrentAccountBatch(accounts, concurrency, '删除账号', async (account) => {
        const accountId = getAccountId(account);
        const title = `#${accountId || '?'} ${account.name || '(未命名)'}`;

        if (!accountId) {
          log(`${title} 无法识别账号 ID，已跳过`, 'error');
          return { skipped: true };
        }

        log(`${title} 删除账号，状态：${getAccountStatus(account) || '无状态'}`);

        const result = await deleteAccount(accountId);

        if (result.ok) {
          log(`${title} 删除成功`, 'success');
        } else {
          log(`${title} 删除失败：${result.reason}`, 'error');
        }

        return result;
      });

      if (state.stopRequested) {
        log('批量删除账号已按要求停止', 'warn');
      }

      log(
        `批量删除账号完成：已处理 ${progress.processed}/${progress.total}，成功 ${progress.success}，失败 ${progress.failed}，跳过 ${progress.skipped}`,
        progress.failed || progress.skipped ? 'warn' : 'success'
      );

      loadGroups().catch((err) => log(`删除后刷新分组失败：${err.message}`, 'warn'));
    } finally {
      state.running = false;
    }
  }

  async function batchMoveAccounts() {
    if (state.running) {
      log('当前有任务在运行，请先停止或等待完成', 'warn');
      return;
    }

    if (!(await ensureAuth())) {
      log('缺少 Authorization，已取消批量移动分组', 'error');
      return;
    }

    const sourceGroup = normalizeGroupName(state.targetGroup);
    if (!sourceGroup) {
      log('批量移动分组需要先选择一个具体来源分组，不能直接作用于全部分组', 'error');
      return;
    }

    const statusSelect = document.querySelector('#sub2api-checker-move-status');
    const targetInput = document.querySelector('#sub2api-checker-move-target-group');
    const moveStatus = normalizeStatusText(statusSelect?.value || state.moveStatus || 'limited');
    const targetGroup = normalizeGroupName(targetInput?.value || state.moveTargetGroup || '');

    if (!moveStatus) {
      log('待移动状态不能为空', 'error');
      return;
    }

    if (!targetGroup) {
      log('目标分组不能为空', 'error');
      return;
    }

    if (targetGroup === sourceGroup) {
      log('目标分组不能和来源分组相同', 'error');
      return;
    }

    state.moveStatus = moveStatus;
    state.moveTargetGroup = targetGroup;
    localStorage.setItem(CONFIG.moveStatusStorageKey, moveStatus);
    localStorage.setItem(CONFIG.moveTargetGroupStorageKey, targetGroup);

    if (targetInput) targetInput.value = targetGroup;

    state.running = true;
    state.stopRequested = false;

    try {
      log(`开始拉取账号，准备批量移动分组：${sourceGroup} -> ${targetGroup}，状态 ${moveStatus}`);

      const groupedAccounts = await fetchAccounts();
      const accounts = filterAccountsByStatus(groupedAccounts, moveStatus);

      log(`来源分组账号数：${groupedAccounts.length}，匹配状态 ${moveStatus} 的账号数：${accounts.length}`, accounts.length ? 'warn' : 'success');

      if (!accounts.length) {
        log('没有匹配条件的账号，无需移动', 'success');
        return;
      }

      const preview = accounts
        .slice(0, 10)
        .map((account) => `#${getAccountId(account) || '?'} ${account.name || '(未命名)'} [${getAccountStatus(account) || '无状态'}]`)
        .join('\n');

      const ok = confirm(
        `确定要把分组「${sourceGroup}」中状态为「${moveStatus}」的账号移动到「${targetGroup}」吗？\n\n` +
        `匹配数量：${accounts.length}\n` +
        `前 ${Math.min(accounts.length, 10)} 个账号：\n${preview}`
      );

      if (!ok) {
        log('已取消批量移动分组', 'warn');
        return;
      }

      const concurrency = getBatchConcurrency(accounts.length);
      if (!concurrency) return;

      resetBatchProgress('批量移动分组', accounts.length, concurrency);
      log(`本次批量移动分组并发账号数：${concurrency}`, 'success');

      const progress = await runConcurrentAccountBatch(accounts, concurrency, '移动分组', async (account) => {
        const accountId = getAccountId(account);
        const title = `#${accountId || '?'} ${account.name || '(未命名)'}`;

        if (!accountId) {
          log(`${title} 无法识别账号 ID，已跳过`, 'error');
          return { skipped: true };
        }

        log(`${title} 移动分组：${sourceGroup} -> ${targetGroup}，状态：${getAccountStatus(account) || '无状态'}`);

        const result = await moveAccountToGroup(account, targetGroup);

        if (result.ok) {
          log(`${title} 移动分组成功`, 'success');
        } else {
          log(`${title} 移动分组失败：${result.reason}`, 'error');
        }

        return result;
      });

      if (state.stopRequested) {
        log('批量移动分组已按要求停止', 'warn');
      }

      log(
        `批量移动分组完成：已处理 ${progress.processed}/${progress.total}，成功 ${progress.success}，失败 ${progress.failed}，跳过 ${progress.skipped}`,
        progress.failed || progress.skipped ? 'warn' : 'success'
      );

      loadGroups().catch((err) => log(`移动分组后刷新分组失败：${err.message}`, 'warn'));
    } finally {
      state.running = false;
    }
  }

  async function batchQueryUsage() {
    if (state.running) {
      log('当前有任务在运行，请先停止或等待完成', 'warn');
      return;
    }

    if (!(await ensureAuth())) {
      log('缺少 Authorization，已取消批量查询用量', 'error');
      return;
    }

    const targetGroupText = state.targetGroup ? `分组「${state.targetGroup}」` : '全部分组';

    state.running = true;
    state.stopRequested = false;

    try {
      log(`开始拉取账号，准备批量查询用量，范围：${targetGroupText}`);

      const accounts = sortAccountsByCreatedTime(await fetchAccounts(), 'desc');

      log(`本次需要查询用量的账号数：${accounts.length}`);
      resetUsageResults(accounts.length, targetGroupText);

      if (!accounts.length) {
        log('当前范围没有账号，无需查询用量', 'success');
        return;
      }

      const concurrency = getBatchConcurrency(accounts.length);
      if (!concurrency) return;

      resetBatchProgress('批量查询用量', accounts.length, concurrency);
      log(`本次批量查询用量并发账号数：${concurrency}`, 'success');

      const progress = await runConcurrentAccountBatch(accounts, concurrency, '查询用量', async (account) => {
        const accountId = getAccountId(account);
        const title = `#${accountId || '?'} ${account.name || '(未命名)'}`;

        if (!accountId) {
          const result = {
            skipped: true,
            reason: '无法识别账号 ID',
          };

          appendUsageResult(account, result);
          log(`${title} 无法识别账号 ID，已跳过`, 'error');
          return result;
        }

        log(`${title} 查询用量`);

        const result = await fetchAccountUsage(accountId);

        appendUsageResult(account, result);

        if (result.ok) {
          log(`${title} 用量：${formatAccountUsageData(result.data, account)}`, 'success');
        } else {
          log(`${title} 查询用量失败：${result.reason}`, 'error');
        }

        return result;
      });

      if (state.stopRequested) {
        log('批量查询用量已按要求停止', 'warn');
      }

      log(
        `批量查询用量完成：已处理 ${progress.processed}/${progress.total}，成功 ${progress.success}，失败 ${progress.failed}，跳过 ${progress.skipped}`,
        progress.failed || progress.skipped ? 'warn' : 'success'
      );
    } finally {
      state.running = false;
    }
  }

  async function processAccountForCheck(account) {
    const title = `#${account.id} ${account.name || '(未命名)'}`;

    if (CONFIG.onlyCheckSchedulable && !account.schedulable) {
      state.stats.checked += 1;
      state.stats.skipped += 1;
      updateStats();
      log(`${title} 已是关闭状态，跳过`, 'warn');
      return;
    }

    const models = getModels(account);

    if (!models.length) {
      state.stats.failed += 1;
      log(`${title} 没有 model_mapping，准备关闭`, 'error');

      const off = await setAccountSchedulable(account.id, false);

      state.stats.checked += 1;

      if (off.ok) {
        state.stats.disabled += 1;
        log(`${title} 已关闭 schedulable`, 'success');
      } else {
        log(`${title} 关闭失败：${off.reason}`, 'error');
      }

      updateStats();
      return;
    }

    const accountGroups = getAccountGroups(account);
    const groupText = accountGroups.length ? `，分组：${accountGroups.join(', ')}` : '，分组：未分配';

    log(`${title}${groupText} 开始测试 ${models.length} 个模型`);

    let accountOk = true;
    let failReason = '';

    for (const model of models) {
      if (state.stopRequested) break;

      log(`${title} 测试模型 ${model}`);

      const result = await testModel(account.id, model);

      if (!result.ok) {
        accountOk = false;
        failReason = `模型 ${model} 异常：${result.reason}`;

        log(`${title} ${failReason}`, 'error');

        if (CONFIG.stopOnFirstModelFailure) break;
      } else {
        log(`${title} 模型 ${model} 正常`, 'success');
      }
    }

    state.stats.checked += 1;

    if (accountOk && !state.stopRequested) {
      state.stats.ok += 1;

      if (!account.schedulable) {
        const on = await setAccountSchedulable(account.id, true);

        if (on.ok) {
          state.stats.enabled += 1;
          log(`${title} 全部模型正常，已重新启用 schedulable`, 'success');
        } else {
          log(`${title} 模型正常但重新启用失败：${on.reason}`, 'error');
        }
      } else {
        log(`${title} 全部模型正常`, 'success');
      }
    } else if (!accountOk) {
      state.stats.failed += 1;

      const off = await setAccountSchedulable(account.id, false);

      if (off.ok) {
        state.stats.disabled += 1;
        log(`${title} 已关闭 schedulable（原因：${failReason}）`, 'success');
      } else {
        log(`${title} 关闭失败：${off.reason}`, 'error');
      }
    } else {
      log(`${title} 已按停止请求中断，未调整 schedulable`, 'warn');
    }

    updateStats();
  }

  async function runAccountCheckWorkers(accounts, concurrency) {
    let cursor = 0;

    const workerCount = Math.min(Math.max(1, concurrency), Math.max(1, accounts.length));

    const workers = Array.from({ length: workerCount }, async (_, workerIndex) => {
      while (!state.stopRequested) {
        const index = cursor;
        cursor += 1;

        if (index >= accounts.length) break;

        try {
          await processAccountForCheck(accounts[index]);
        } catch (err) {
          const account = accounts[index];
          const title = `#${account?.id || '?'} ${account?.name || '(未命名)'}`;

          state.stats.checked += 1;
          state.stats.failed += 1;
          updateStats();

          log(`${title} 巡检异常：${err.message || String(err)}`, 'error');
        }

        if (!state.stopRequested) {
          await sleep(80 + workerIndex * 20);
        }
      }
    });

    await Promise.all(workers);
  }

  async function run() {
    if (state.running) {
      log('已有任务在运行', 'warn');
      return;
    }

    if (!(await ensureAuth())) {
      log('缺少 Authorization，已取消', 'error');
      return;
    }

    const concurrencyInput = document.querySelector('#sub2api-checker-concurrency');
    if (concurrencyInput && !saveConcurrency(concurrencyInput.value)) {
      log('并发账号数无效，已取消', 'error');
      return;
    }

    state.running = true;
    state.stopRequested = false;

    resetStats();

    try {
      state.collapsed = false;
      updatePanelCollapsed();

      if (state.targetGroup) {
        log(`开始拉取账号列表，巡检分组：${state.targetGroup}`);
      } else {
        log('开始拉取账号列表，巡检分组：全部');
      }

      const accounts = await fetchAccounts();

      state.stats.total = accounts.length;
      updateStats();

      log(`本次实际巡检账号数：${accounts.length}`, 'success');
      log(`本次并发账号数：${state.concurrency}`, 'success');

      await runAccountCheckWorkers(accounts, state.concurrency);

      if (state.stopRequested) {
        log('任务已按要求停止', 'warn');
      } else {
        log('巡检完成', 'success');
      }
    } finally {
      state.running = false;
      updateStats();
    }
  }

  injectAuthSniffer();

  waitDomReady().then(() => {
    ensurePanel();

    if (state.authHeader) {
      log('脚本已就绪，已从本地缓存 auth_token 读取 Authorization', 'success');
    } else {
      log('脚本已就绪，未发现 auth_token；等待页面请求自动捕获或手动粘贴');
    }

    if (state.targetGroup) {
      log(`当前巡检分组：${state.targetGroup}`, 'success');
    } else {
      log('当前巡检分组：全部');
    }

    renderModelSelect();
    renderGroupSelect();

    requestAutoLoadMeta(800);
    requestAutoLoadMeta(2500);
    requestAutoLoadMeta(5000);
  });
})();
