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
