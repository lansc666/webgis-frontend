# webgis-frontend
Haiyuan Ding &amp; Zhisheng Liao

## 前端 B：UI 独立预览

用 VS Code 打开整个项目文件夹，再用 Live Server 启动 index.html。
在浏览器地址末尾添加 `?ui-preview=public`，可测试工具栏、图层、表格和草稿操作；
添加 `?ui-preview=demo` 可检查数据库模式文案和文件入口。

预览仅使用模拟数据，不连接地图或数据库。正常页面仍等待 app.js 集成。
接口及联调步骤见 [UI 接入说明](docs/ui-integration.md)。

自动浏览器测试：安装或使用已有 Playwright，运行 `node tests/ui.test.cjs`（使用本机 Edge）。
也可传入 Playwright 包的绝对路径：`node tests/ui.test.cjs <playwright-package-path>`。
测试覆盖事件、草稿处理、重复点击、文件校验及桌面/手机布局。
