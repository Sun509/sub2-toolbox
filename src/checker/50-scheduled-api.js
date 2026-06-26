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
