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
