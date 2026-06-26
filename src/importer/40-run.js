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
