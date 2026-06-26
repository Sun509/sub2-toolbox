# Sub2API Toolbox

这是 Sub2API 工具箱的模块化源码。

## 目录

- `src/userscript.meta.js`: UserScript 元信息。
- `src/importer/`: 批量导入账号功能。
- `src/checker/`: 账号巡检、批量设置隐私、批量删除、定时测试计划功能。
- `src/launcher/`: 右侧工具箱入口。
- `scripts/build-userscript.js`: 构建脚本。
- `dist/sub2-toolbox.user.js`: 可上传服务器或安装到 Tampermonkey 的成品脚本。
- `sub2工具箱.txt`: 兼容旧文件名的同步成品。

## 常用命令

```powershell
node scripts/build-userscript.js
node --check dist\sub2-toolbox.user.js
```

`npm run build` 也可以用；如果 PowerShell 拦截 `npm.ps1`，直接使用上面的 `node` 命令。

## 修改流程

1. 在 `src/` 里改对应功能的小文件。
2. 运行 `node scripts/build-userscript.js`。
3. 上传 `dist/sub2-toolbox.user.js` 到服务器。

批量删除账号功能在 `src/checker/60-batch-actions.js`，账号列表和状态筛选在 `src/checker/30-accounts.js`。
