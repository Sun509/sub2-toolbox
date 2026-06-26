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
