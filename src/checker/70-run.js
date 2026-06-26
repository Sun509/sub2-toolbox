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
