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
          Sub2API 账号模型巡检 v0.4.9 并发版
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

          <div style="display:flex;gap:8px;align-items:center;">
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

    root.querySelector('#sub2api-checker-start').addEventListener('click', () => {
      run().catch((err) => {
        log(`运行异常：${err.message}`, 'error');
        state.running = false;
      });
    });

    root.querySelector('#sub2api-checker-stop').addEventListener('click', () => {
      state.stopRequested = true;
      log('已请求停止，当前请求结束后退出', 'warn');
    });

    updatePanelCollapsed();
  }
