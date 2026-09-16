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
    assert.equal(await page.locator('#delete-button').isEnabled(), true);
    await page.getByRole('checkbox', { name: '选择要素 -11', exact: true }).click();
    assert.deepEqual((await last()).detail.ids, [-10, -11]);
    assert.equal(await page.locator('#delete-button').isDisabled(), true);
    const beforeRender = await count();
    await page.evaluate(() => h.ui.renderTable(h.fc, [-10]));
    assert.equal(await count(), beforeRender, 'Map-to-table update must be silent');
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
    await page.locator('summary').click();
    await page.locator('#layer-name').fill('   ');
    await page.locator('#create-layer-button').click();
    assert.equal(await count(), 0, 'Whitespace layer names must be rejected');
    await page.locator('#layer-name').fill(' 校园 ');
    await page.locator('#create-layer-button').click();
    assert.deepEqual(await last(), { name: 'ui:create-layer', detail: { name: '校园', geometry_family: 'point' } });
    await finish();
    await page.locator('#reset-button').click();
    assert.equal((await last()).name, 'ui:reset');
    await finish({ dirty: false });

    await setup('demo');
    assert.equal(await page.locator('#file-panel').isVisible(), true);
    assert.equal(await page.locator('#reset-panel').isVisible(), false);
    assert.equal(await page.locator('#save-button').textContent(), '保存到数据库');
    await page.locator('#import-file').setInputFiles({ name: 'bad.txt', mimeType: 'text/plain', buffer: Buffer.from('x') });
    assert.equal(await page.locator('#import-button').isDisabled(), true);
    await page.locator('#import-file').setInputFiles({ name: 'large.zip', mimeType: 'application/zip', buffer: Buffer.alloc(20 * 1024 * 1024 + 1) });
    assert.equal(await page.locator('#import-button').isDisabled(), true);
    await page.locator('#import-file').setInputFiles({ name: 'campus.zip', mimeType: 'application/zip', buffer: Buffer.from('PK test') });
    await page.locator('#import-button').click();
    assert.equal(await page.evaluate(() => h.log.at(-1).detail.file instanceof File), true);
    await finish();
    await page.locator('#export-button').click();
    assert.deepEqual(await last(), { name: 'ui:export', detail: { layerId: -1 } });
    await finish();

    await setup();
    await page.evaluate(() => { h.ui.initUI({ events: h.events, appMode: 'public' }); h.ui.renderLayers(h.layers, -1); });
    await page.locator('[data-mode=select]').click();
    assert.equal(await count(), 1, 'Repeated initialization must not duplicate listeners');
    await page.goto(base + '/?ui-preview=public');
    await page.locator('#preview-log').waitFor();
    await page.getByRole('button', { name: '模拟修改草稿' }).click();
    await page.locator('#save-button').click();
    assert.match(await page.locator('#preview-log').textContent(), /ui:save/);
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true, 'Desktop page must not overflow');
    await fs.mkdir(path.join(root, 'tmp', 'ui-tests'), { recursive: true });
    await page.screenshot({ path: path.join(root, 'tmp', 'ui-tests', 'desktop.png'), fullPage: true });
    await page.setViewportSize({ width: 390, height: 844 });
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true, 'Mobile page must not overflow');
    await page.screenshot({ path: path.join(root, 'tmp', 'ui-tests', 'mobile.png'), fullPage: true });
    assert.deepEqual(backendRequests, [], 'UI and preview must not request backend');
    assert.deepEqual(errors, [], 'No uncaught browser errors');
    console.log('PASS: UI rendering, selection, property safety, draft guards, async failures, request locks, modes, files, reinit, preview and mobile layout.');
  } finally {
    await browser?.close();
    await new Promise(resolve => server.close(resolve));
  }
})().catch(error => { console.error(error); process.exitCode = 1; });
