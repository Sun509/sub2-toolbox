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
