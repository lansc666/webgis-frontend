// Run: node tests/ui.test.cjs [absolute path to playwright package]
const { chromium } = require(process.argv[2] || 'playwright');
const assert = require('node:assert/strict');
const http = require('node:http');
const fs = require('node:fs/promises');
const path = require('node:path');
const root = path.resolve(__dirname, '..');
const server = http.createServer(async (req, res) => {
  try {
    const pathname = new URL(req.url, 'http://localhost').pathname;
    const relative = pathname === '/' ? 'index.html' : decodeURIComponent(pathname.slice(1));
    const target = path.resolve(root, relative);
    if (!target.startsWith(root + path.sep)) { res.writeHead(403).end(); return; }
    const types = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css' };
    res.setHeader('Content-Type', (types[path.extname(target)] || 'text/plain') + '; charset=utf-8');
    res.end(await fs.readFile(target));
  } catch { res.writeHead(404).end(); }
});

(async () => {
  let browser;
  try {
    await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
    const base = 'http://127.0.0.1:' + server.address().port;
    browser = await chromium.launch({ channel: 'msedge', headless: true });
    const page = await browser.newPage({ viewport: { width: 1365, height: 900 } });
    const errors = [], backendRequests = [];
    page.on('pageerror', error => errors.push(error.message));
    page.on('request', request => {
      if (/\/api\/|\/health/.test(request.url())) backendRequests.push(request.url());
    });
    page.on('dialog', dialog => dialog.accept());
    await page.route('https://**/*', route => route.abort());
    await page.goto(base);
    await fs.mkdir(path.join(root, 'tmp', 'ui-tests'), { recursive: true });
    assert.equal(await page.locator('#map-placeholder').isVisible(), true, 'Normal entry explains pending integration');
    assert.equal(await page.locator('#preview-log').count(), 0, 'Normal entry never initializes mock data');
    await page.setViewportSize({ width: 320, height: 640 });
    const entryFits = await page.locator('#map-placeholder').evaluate(node => {
      const stage = node.closest('.map-stage').getBoundingClientRect();
      return [...node.children].every(child => {
        const box = child.getBoundingClientRect(); return box.top >= stage.top && box.bottom <= stage.bottom;
      });
    });
    assert.equal(entryFits, true, 'All normal-entry instructions and links fit within their map placeholder on narrow screens');
    assert.equal(await page.locator('.placeholder-symbol').evaluate(node => node.getBoundingClientRect().width === node.getBoundingClientRect().height), true, 'Placeholder artwork is not squashed by narrow-screen content');
    await page.screenshot({ path: path.join(root, 'tmp', 'ui-tests', 'entry-mobile.png'), fullPage: true });
    await page.getByRole('link', { name: '体验临时编辑界面', exact: true }).click();
    await page.locator('#preview-log').waitFor({ state: 'attached' });
    await page.goto(base + '/?ui-preview=invalid');
    assert.equal(await page.locator('#preview-log').count(), 0, 'Invalid preview parameters do not activate test data');
    await page.goto(base);
    await page.setViewportSize({ width: 1365, height: 900 });
    async function setup(mode = 'public') {
      await page.evaluate(async mode => {
        const ui = await import('/js/ui.js');
        const events = new EventTarget(), log = [];
        const layers = [{ id: -1, name: '设施', geometry_family: 'point' }, { id: -2, name: '道路', geometry_family: 'line' }];
        const fc = { type: 'FeatureCollection', features: [
          { type: 'Feature', id: -10, layer_id: -1, properties: { name: '<img src=x onerror=alert(1)>', open: true, count: 0, note: null }, geometry: { type: 'Point', coordinates: [116, 39] } },
          { type: 'Feature', id: -11, layer_id: -1, properties: { name: '入口', extra: '中文' }, geometry: { type: 'Point', coordinates: [117, 40] } }
        ] };
        for (const name of ['selection', 'mode', 'layer', 'save', 'cancel', 'delete', 'create-layer', 'import', 'export', 'reset']) {
          events.addEventListener('ui:' + name, event => log.push({ name: event.type, detail: event.detail }));
        }
        ui.initUI({ events, appMode: mode });
        ui.renderLayers(layers, -1); ui.renderTable(fc, []);
        window.h = { ui, events, log, layers, fc };
      }, mode);
    }
    const count = () => page.evaluate(() => h.log.length);
    const last = () => page.evaluate(() => h.log.at(-1));
    const finish = update => page.evaluate(update => h.ui.setStatus({ saving: false, loading: false, error: null, ...update }), update || {});
    const draft = () => page.evaluate(() => {
      h.events.dispatchEvent(new CustomEvent('map:draft-change', { detail: { kind: 'update', feature: h.fc.features[0] } }));
      h.ui.setStatus({ dirty: true });
    });
    await setup();
    assert.equal(await count(), 0, 'Rendering must not emit user events');
    assert.equal(await page.locator('#file-panel').isVisible(), false);
    assert.equal(await page.locator('#reset-panel').isVisible(), true);
    assert.equal(await page.locator('#table-container img').count(), 0, 'Properties must render as text');
    assert.equal(await page.locator('[data-mode=drawPoint]').isEnabled(), true);
    assert.equal(await page.locator('[data-mode=drawLine]').isDisabled(), true);
    await page.getByRole('checkbox', { name: '选择要素 -10', exact: true }).click();
    assert.deepEqual(await last(), { name: 'ui:selection', detail: { ids: [-10] } });
    assert.equal(await page.evaluate(() => document.activeElement.dataset.featureId), '-10', 'Selection must retain keyboard focus');
    assert.equal(await page.locator('#delete-button').isEnabled(), true);
    await page.getByRole('checkbox', { name: '选择要素 -11', exact: true }).click();
    assert.deepEqual((await last()).detail.ids, [-10, -11]);
    assert.equal(await page.locator('#delete-button').isDisabled(), true);
    const beforeRender = await count();
    await page.evaluate(() => h.ui.renderTable(h.fc, [-10]));
    assert.equal(await count(), beforeRender, 'Map-to-table update must be silent');
    assert.equal(await page.evaluate(() => document.activeElement.dataset.featureId), '-11', 'App render must restore the same focused checkbox');
    await draft();
    await page.locator('#save-button').click();
    assert.deepEqual((await last()).detail.properties, { name: '<img src=x onerror=alert(1)>', open: true, count: 0, note: null });
    const afterSave = await count();
    await page.evaluate(() => document.getElementById('save-button').click());
    assert.equal(await count(), afterSave, 'Save must be locked before async handler starts');
    await finish({ dirty: true, error: '保存失败' });
    assert.equal(await page.locator('#save-button').isEnabled(), true);
    assert.equal(await page.locator('#app-error').textContent(), '保存失败');

    await page.locator('#layer-select').selectOption('-2');
    await page.locator('#draft-dialog').waitFor({ state: 'visible' });
    await page.locator('#draft-dialog [value=cancel]').click();
    await page.locator('#draft-dialog').waitFor({ state: 'hidden' });
    assert.equal(await page.evaluate(() => document.activeElement.id), 'layer-select', 'Dialog cancel returns focus to the trigger');
    assert.equal(await count(), afterSave, 'Cancel navigation must preserve layer and draft');
    assert.equal(await page.locator('#layer-select').inputValue(), '-1');
    await page.locator('#layer-select').selectOption('-2');
    await page.locator('#draft-dialog [value=submit]').click();
    await page.waitForFunction(() => h.log.at(-1).name === 'ui:save' && h.log.length > 3);
    await finish({ dirty: true, error: '数据库断开' });
    assert.equal((await last()).name, 'ui:save', 'Failed save must not continue layer change');
    await page.locator('#layer-select').selectOption('-2');
    await page.locator('#draft-dialog [value=discard]').click();
    await page.waitForFunction(() => h.log.at(-1).name === 'ui:cancel');
    await finish({ dirty: false });
    assert.deepEqual(await last(), { name: 'ui:layer', detail: { layerId: -2 } });
    await page.evaluate(() => h.ui.renderLayers(h.layers, -2));
    await finish();
    assert.equal(await page.locator('#table-container tbody tr').count(), 0, 'Old layer data must clear');
    assert.equal(await page.locator('[data-mode=drawLine]').isEnabled(), true);

    await setup();
    await page.locator('#create-layer-details > summary').click();
    await page.locator('#layer-name').fill('   ');
    await page.locator('#create-layer-button').click();
    assert.equal(await count(), 0, 'Whitespace layer names must be rejected');
    assert.equal(await page.locator('#layer-name').getAttribute('aria-invalid'), 'true');
    assert.equal(await page.locator('#layer-name-error').isVisible(), true);
    assert.equal(await page.evaluate(() => document.activeElement.id), 'layer-name', 'Invalid submit focuses the field');
    await page.locator('#layer-name').fill(' 校园 ');
    await page.locator('#create-layer-button').click();
    assert.deepEqual(await last(), { name: 'ui:create-layer', detail: { name: '校园', geometry_family: 'point' } });
    await finish();
    assert.match(await page.locator('#app-status').textContent(), /图层已创建/);
    await page.locator('#reset-button').click();
    assert.equal((await last()).name, 'ui:reset');
    await finish({ dirty: false });

    await setup('demo');
    assert.equal(await page.locator('#file-panel').isVisible(), true);
    assert.equal(await page.locator('#reset-panel').isVisible(), false);
    assert.equal(await page.locator('#save-button').textContent(), '保存到数据库');
    await page.locator('#import-file').setInputFiles({ name: 'bad.txt', mimeType: 'text/plain', buffer: Buffer.from('x') });
    assert.equal(await page.locator('#import-button').isDisabled(), true);
    assert.equal(await page.locator('#import-error').isVisible(), true);
    await page.locator('#import-file').setInputFiles({ name: 'large.zip', mimeType: 'application/zip', buffer: Buffer.alloc(20 * 1024 * 1024 + 1) });
    assert.equal(await page.locator('#import-button').isDisabled(), true);
    await page.locator('#import-file').setInputFiles({ name: 'campus.zip', mimeType: 'application/zip', buffer: Buffer.from('PK test') });
    assert.match(await page.locator('#import-file-info').textContent(), /campus.zip/);
    assert.equal(await page.locator('#import-file').getAttribute('aria-invalid'), 'false');
    await page.locator('#import-button').click();
    assert.equal(await page.evaluate(() => h.log.at(-1).detail.file instanceof File), true);
    await finish();
    await page.locator('#export-button').click();
    assert.deepEqual(await last(), { name: 'ui:export', detail: { layerId: -1 } });
    await finish();

    await setup();
    const keyboardBox = page.getByRole('checkbox', { name: '选择要素 -10', exact: true });
    await keyboardBox.focus();
    await page.keyboard.press('Space');
    assert.deepEqual((await last()).detail.ids, [-10]);
    await page.keyboard.press('Space');
    assert.deepEqual((await last()).detail.ids, [], 'Repeated keyboard activation must work without refocusing');
    await setup();
    await page.evaluate(() => { h.ui.initUI({ events: h.events, appMode: 'public' }); h.ui.renderLayers(h.layers, -1); });
    await page.locator('[data-mode=select]').click();
    assert.equal(await count(), 1, 'Repeated initialization must not duplicate listeners');
    await setup();
    const renderDuration = await page.evaluate(() => {
      h.large = { type: 'FeatureCollection', features: Array.from({ length: 5000 }, (_, index) => ({
        type: 'Feature', id: index + 1, layer_id: -1,
        properties: { name: '校园设施 ' + (index + 1), category: index % 2 ? '教学' : '公共', score: index + 1, note: index % 3 ? null : '备注' },
        geometry: { type: 'Point', coordinates: [116.3, 39.9] }
      })) };
      const start = performance.now(); h.ui.renderTable(h.large, []); return performance.now() - start;
    });
    console.log('5000-feature UI render: ' + Math.round(renderDuration) + ' ms');
    assert.ok(renderDuration < 2000, 'Rendering 5000 features should remain bounded');
    assert.equal(await page.locator('#table-container tbody tr').count(), 50, 'Only the current local page is rendered');
    assert.match(await page.locator('#feature-count').textContent(), /5,000/);
    await page.locator('#table-container').evaluate(node => { node.scrollTop = 700; });
    await page.evaluate(() => h.ui.renderTable(h.large, []));
    assert.equal(await page.locator('#table-container').evaluate(node => node.scrollTop), 700, 'App-driven table refresh preserves reading position');
    await page.locator('#table-container').evaluate(node => { node.scrollTop = 0; });
    await page.getByRole('checkbox', { name: '选择要素 1', exact: true }).click();
    await page.locator('#table-container').evaluate(node => { node.scrollTop = 700; });
    await page.locator('#table-next').click();
    assert.equal(await page.locator('#table-page').textContent(), '2 / 100');
    assert.equal(await page.locator('#table-container').evaluate(node => node.scrollTop), 0, 'A new page starts at its first row');
    await page.getByRole('checkbox', { name: '选择要素 51', exact: true }).click();
    assert.deepEqual((await last()).detail.ids, [1, 51], 'Selections persist across pages');
    const tableEventCount = await count();
    await page.locator('#selected-only').check();
    assert.equal(await page.locator('#table-container tbody tr').count(), 2);
    await page.locator('#feature-search').fill('设施 51');
    assert.equal(await page.locator('#table-container tbody tr').count(), 1);
    assert.equal(await count(), tableEventCount, 'Filters must not emit data-selection events');
    await page.locator('#clear-filters').click();
    assert.equal(await page.locator('#table-container tbody tr').count(), 50);
    await page.locator('[data-sort-field="p:score"]').click();
    await page.locator('[data-sort-field="p:score"]').click();
    assert.equal(await page.locator('#table-container tbody tr').first().getAttribute('data-feature-id'), '5000', 'Numeric sorting must not be lexicographic');
    assert.equal(await page.locator('[data-sort-field="p:score"]').evaluate(node => node.closest('th').getAttribute('aria-sort')), 'descending');
    assert.equal(await page.evaluate(() => document.activeElement.dataset.sortField), 'p:score');
    await page.locator('#selected-only').check();
    await page.getByRole('checkbox', { name: '选择要素 51', exact: true }).click();
    await page.getByRole('checkbox', { name: '选择要素 1', exact: true }).click();
    assert.equal(await page.locator('#table-container tbody tr').count(), 0);
    assert.equal(await page.evaluate(() => document.activeElement.id), 'table-container', 'Removing last filtered row keeps focus in the table');
    await page.locator('#clear-filters').click();
    await page.locator('#feature-search').fill('不存在的校园设施');
    assert.match(await page.locator('#table-container').textContent(), /没有找到匹配项/);
    await page.locator('#layer-select').selectOption('-2');
    await page.evaluate(() => h.ui.renderLayers(h.layers, -2));
    await finish();
    assert.equal(await page.locator('#feature-search').inputValue(), '', 'Layer changes reset table filters');
    await page.goto(base + '/?ui-preview=public');
    await page.locator('#preview-log').waitFor({ state: 'attached' });
    await page.getByRole('button', { name: '模拟修改草稿' }).click();
    await page.locator('#save-button').click();
    assert.match(await page.locator('#preview-log').textContent(), /ui:save/);
    await page.waitForFunction(() => document.getElementById('draft-status').textContent === '无草稿');
    assert.equal(await page.getByRole('button', { name: '选择示意要素：南门', exact: true }).isEnabled(), true, 'Preview markers unlock after save');
    await page.getByRole('button', { name: '选择示意要素：南门', exact: true }).click();
    assert.equal(await page.getByRole('checkbox', { name: '选择要素 -11', exact: true }).isChecked(), true, 'Preview-to-table selection works');
    await page.getByRole('button', { name: '模拟新建草稿' }).click();
    assert.match(await page.locator('#properties-editor').textContent(), /新建示例/);
    await page.locator('#save-button').click();
    await page.waitForFunction(() => document.getElementById('draft-status').textContent === '无草稿');
    assert.equal(await page.locator('#table-container tbody tr').count(), 4, 'Preview creation applies a new feature');
    await page.locator('#reset-button').click();
    assert.equal(await page.locator('#table-container tbody tr').count(), 3, 'Preview reset restores all original features');
    await page.locator('#layer-select').selectOption('-2');
    assert.equal(await page.locator('#table-container tbody tr').count(), 2, 'Line layer has test data');
    assert.equal(await page.locator('[data-mode=drawLine]').isEnabled(), true);
    await page.locator('#layer-select').selectOption('-1');
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true, 'Desktop page must not overflow');
    await fs.mkdir(path.join(root, 'tmp', 'ui-tests'), { recursive: true });
    await page.screenshot({ path: path.join(root, 'tmp', 'ui-tests', 'desktop.png'), fullPage: true });
    await page.setViewportSize({ width: 390, height: 844 });
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true, 'Mobile page must not overflow');
    await page.screenshot({ path: path.join(root, 'tmp', 'ui-tests', 'mobile.png'), fullPage: true });
    await page.goto(base + '/?ui-preview=demo');
    await page.locator('#preview-log').waitFor({ state: 'attached' });
    assert.equal(await page.locator('#file-panel').isVisible(), true);
    assert.equal(await page.locator('#reset-panel').isVisible(), false);
    await page.getByRole('button', { name: '模拟修改草稿' }).click();
    await page.locator('#save-button').click();
    await page.waitForFunction(() => document.getElementById('draft-status').textContent === '无草稿');
    assert.match(await page.locator('#app-status').textContent(), /模拟操作完成/);
    assert.doesNotMatch(await page.locator('#app-status').textContent(), /已保存到数据库/);
    await require('./accessibility-audit.cjs')(page, base, root, setup);
    await require('./state-audit.cjs')(page, base, setup);
    assert.deepEqual(backendRequests, [], 'UI and preview must not request backend');
    assert.deepEqual(errors, [], 'No uncaught browser errors');
    console.log('PASS: UI rendering, selection, property safety, draft guards, async failures, request locks, modes, files, reinit, preview and mobile layout.');
  } finally {
    await browser?.close();
    await new Promise(resolve => server.close(resolve));
  }
})().catch(error => { console.error(error); process.exitCode = 1; });
