# webgis-frontend
Haiyuan Ding &amp; Zhisheng Liao

## 前端 B：UI 独立预览

用 VS Code 打开整个项目文件夹，再用 Live Server 启动 index.html。
点击页面中央“体验临时编辑界面”，即可查看优化后的工作台，无需手动修改地址。
也可直接访问 `index.html?ui-preview=public`；`index.html?ui-preview=demo` 用于检查数据库模式的文件入口和模拟流程。

预览仅使用模拟数据，不连接地图或数据库。正常页面仍等待 app.js 集成。
接口及联调步骤见 [UI 接入说明](docs/ui-integration.md)。

自动浏览器测试：安装或使用已有 Playwright，运行 `node tests/ui.test.cjs`（使用本机 Edge）。
也可传入 Playwright 包的绝对路径：`node tests/ui.test.cjs <playwright-package-path>`。
测试覆盖事件、草稿处理、失败重试、重复点击、文件校验、5000要素表格、键盘焦点、语义色对比度和320–1440px布局。
会在 `tmp/ui-tests/` 生成截图（已忽略，不纳入版本控制）。当前测试使用本机 Edge，并阻断外部 CDN，不代替真实 OpenLayers / API 联调。

## 本地优化内容

地图与宽属性表组成主工作区，图层和编辑位于侧栏；小屏提供快速导航。
属性表支持搜索、排序、仅看已选、每页50条及跨页选择；所有过滤都在本地展示层处理，不修改完整数据集合。
独立体验包含点、线、面示例，可模拟选择、新建、修改、删除、恢复和失败；不等于真实地图或数据库操作。

逐轮改动、检查结果和待联调范围见 [本地优化记录](docs/local-optimization-log.md)。
