const assert = require('node:assert/strict');
const path = require('node:path');

module.exports = async function auditState(page, base, setup) {
  const finish = update => page.evaluate(update => h.ui.setStatus({ loading: false, saving: false, error: null, ...update }), update || {});
  const beforeUnload = () => page.evaluate(() => {
    const event = new Event('beforeunload', { cancelable: true });
    window.dispatchEvent(event); return event.defaultPrevented;
  });
  await page.goto(base);
  await setup();
  assert.equal(await beforeUnload(), false, 'A fresh page does not warn on leaving');
  await page.getByRole('checkbox', { name: '选择要素 -10', exact: true }).check();
  await page.evaluate(() => {
    h.events.dispatchEvent(new CustomEvent('map:draft-change', { detail: { kind: 'update', feature: h.fc.features[0] } }));
    h.ui.setStatus({ dirty: true });
  });
  assert.equal(await beforeUnload(), true, 'Dirty drafts warn before leaving');
  await page.locator('#layer-select').selectOption('-2');
  assert.equal(await page.locator('#draft-dialog').isVisible(), true);
  assert.equal(await page.evaluate(() => document.activeElement.value), 'cancel', 'The non-destructive option has initial focus');
  await page.screenshot({ path: path.resolve(__dirname, '../tmp/ui-tests/draft-dialog.png') });
  for (let index = 0; index < 5; index++) {
    await page.keyboard.press('Tab');
    assert.equal(await page.evaluate(() => document.getElementById('draft-dialog').contains(document.activeElement)), true, 'Dialog traps keyboard focus');
  }
  for (let index = 0; index < 5; index++) {
    await page.keyboard.press('Shift+Tab');
    assert.equal(await page.evaluate(() => document.getElementById('draft-dialog').contains(document.activeElement)), true, 'Dialog traps reverse keyboard focus');
  }
  await page.keyboard.press('Escape');
  await page.waitForFunction(() => !document.getElementById('draft-dialog').open);
  assert.equal(await page.evaluate(() => document.activeElement.id), 'layer-select');
  assert.equal(await page.locator('#layer-select').inputValue(), '-1', 'Escape retains original layer');

  await page.locator('#save-button').click();
  await page.evaluate(() => h.ui.setStatus({ loading: true, saving: true }));
  await page.evaluate(() => h.ui.setStatus({ saving: false }));
  assert.equal(await page.locator('#save-button').isDisabled(), true, 'One remaining loading flag keeps actions locked');
  await finish({ dirty: true, error: '测试失败：草稿仍保留，请重试。' });
  assert.equal(await page.locator('#editing-error').isVisible(), true, 'Editing errors are next to editing actions');
  assert.match(await page.locator('#editing-error').textContent(), /草稿仍保留/);
  await page.locator('#editing-panel').scrollIntoViewIfNeeded();
  await page.screenshot({ path: path.resolve(__dirname, '../tmp/ui-tests/editing-error.png') });
  assert.equal(await page.locator('#save-button').isEnabled(), true);
  assert.match(await page.locator('#properties-editor').textContent(), /<img src=x onerror=alert\(1\)>/, 'Failure does not lose properties');
  await page.locator('#save-button').click();
  assert.deepEqual(await page.evaluate(() => h.log.at(-1).detail.properties), await page.evaluate(() => h.fc.features[0].properties), 'Retry still sends the exact properties');
  await finish({ dirty: false });
  assert.equal(await page.locator('#editing-error').isVisible(), false);
  assert.equal(await beforeUnload(), true, 'Applied public edits still warn about refresh loss');
  await page.locator('#reset-button').click();
  await finish({ dirty: false });
  assert.equal(await beforeUnload(), false, 'Reset clears temporary-change warning');

  await setup();
  await page.evaluate(() => {
    h.ui.renderTable({ type: 'FeatureCollection', features: h.fc.features.map((feature, index) => ({ ...feature, id: index ? 'bad-id' : -10 })) }, [-10, -10, 777, 'bad-id']);
  });
  assert.match(await page.locator('#selection-count').textContent(), /1 个/);
  assert.equal(await page.getByRole('checkbox', { name: '选择要素 bad-id', exact: true }).isDisabled(), true, 'Malformed IDs cannot be selected');
  await page.evaluate(() => h.ui.renderLayers([], null));
  assert.equal(await page.locator('#layer-select').isDisabled(), true);
  assert.equal(await page.locator('[data-mode=drawPoint]').isDisabled(), true);
  assert.equal(await page.locator('#table-container tbody tr').count(), 0);
  assert.equal(await page.locator('#create-layer-button').isEnabled(), true, 'Empty data can recover by creating a layer');

  await setup();
  await page.locator('#create-layer-details').evaluate(node => { node.open = true; });
  await page.locator('#layer-name').fill('重试后创建的图层');
  await page.locator('#create-layer-button').click();
  await finish({ error: '创建失败，请稍后重试。' });
  assert.equal(await page.locator('#layer-action-error').isVisible(), true, 'Create failure is explained next to the form');
  assert.equal(await page.locator('#layer-name').inputValue(), '重试后创建的图层', 'Failure preserves entered name');
  assert.equal(await page.locator('#create-layer-details').getAttribute('open'), '');
  await page.locator('#create-layer-button').click();
  await finish();
  assert.equal(await page.locator('#layer-name').inputValue(), '', 'Confirmed success clears the form');
  assert.equal(await page.locator('#create-layer-details').getAttribute('open'), null);
  assert.equal(await page.evaluate(() => document.activeElement.id), 'layer-select', 'Create success returns focus to the layer selector');

  await setup();
  await page.locator('#feature-search').evaluate(node => {
    node.dispatchEvent(new CompositionEvent('compositionstart', { bubbles: true }));
    node.value = '不匹配'; node.dispatchEvent(new InputEvent('input', { bubbles: true, isComposing: true }));
  });
  assert.equal(await page.locator('#table-container tbody tr').count(), 2, 'IME intermediate text does not filter rows');
  await page.locator('#feature-search').evaluate(node => node.dispatchEvent(new CompositionEvent('compositionend', { bubbles: true })));
  assert.equal(await page.locator('#table-container tbody tr').count(), 0, 'Completed IME text applies the filter');
  const modelCheck = await page.evaluate(async () => {
    const { buildTableView } = await import('/js/table-model.js');
    const features = [2, 10, null, 1].map((value, index) => ({ id: index, properties: { value, tag: index % 2 ? false : true } }));
    const snapshot = JSON.stringify(features);
    const descending = buildTableView(features, { sort: { field: 'p:value', direction: 'desc' } });
    return { values: descending.features.map(feature => feature.properties.value), unchanged: JSON.stringify(features) === snapshot,
      empty: buildTableView(features, { query: 'missing', page: 99 }).page,
      booleans: buildTableView(features, { query: 'false' }).matchedCount };
  });
  assert.deepEqual(modelCheck, { values: [10, 2, 1, null], unchanged: true, empty: 1, booleans: 2 });

  await page.goto(base + '/?ui-preview=demo');
  await page.locator('#preview-log').waitFor({ state: 'attached' });
  await page.getByRole('button', { name: '选择示意要素：南门', exact: true }).click();
  await page.locator('#delete-button').click();
  assert.match(await page.locator('#app-status').textContent(), /模拟操作完成/);
  assert.doesNotMatch(await page.locator('#app-status').textContent(), /已从数据库删除/);
  await page.locator('#feature-search').fill('图书馆');
  assert.doesNotMatch(await page.locator('#app-status').textContent(), /已从数据库删除/, 'Later refresh does not restore a misleading success message');
  await page.getByRole('button', { name: '模拟修改草稿' }).click();
  await page.locator('#save-button').click();
  assert.match(await page.locator('#app-status').textContent(), /模拟/);
  await page.waitForFunction(() => document.getElementById('draft-status').textContent === '无草稿');
  await page.locator('#create-layer-details > summary').click();
  await page.locator('#layer-name').fill('预览新图层');
  await page.locator('#create-layer-button').click();
  assert.match(await page.locator('#app-status').textContent(), /模拟操作完成/);
  assert.match(await page.locator('.scene-empty').textContent(), /没有要素/);
  await page.getByRole('button', { name: '模拟新建草稿' }).click();
  await page.locator('#save-button').click();
  await page.waitForFunction(() => document.getElementById('draft-status').textContent === '无草稿');
  assert.equal(await page.locator('#table-container tbody tr').count(), 1, 'Empty preview layers can receive new features');
  console.log('PASS: draft keyboard loop, partial async states, error recovery, unload protection, invalid IDs, empty layers, IME, pure table model and honest preview messages.');
};
