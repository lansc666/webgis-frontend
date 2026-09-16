// Targeted UI checks, not a substitute for a complete assistive-technology audit.
const assert = require('node:assert/strict');
const path = require('node:path');

module.exports = async function audit(page, base, root, setup) {
  await page.goto(base + '/?ui-preview=public');
  await page.locator('#preview-log').waitFor({ state: 'attached' });
  for (const [width, height] of [[320, 640], [375, 812], [390, 844], [768, 1024], [812, 375], [1024, 768], [1440, 900]]) {
    await page.setViewportSize({ width, height });
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true, `No horizontal page overflow at ${width}x${height}`);
    if (width <= 600) {
      const undersized = await page.evaluate(() => [...document.querySelectorAll('button, summary, a')]
        .filter(node => node.getClientRects().length && !node.disabled && !node.classList.contains('skip-link'))
        .filter(node => node.getBoundingClientRect().height < 43.9)
        .map(node => node.textContent.trim()));
      assert.deepEqual(undersized, [], 'Mobile buttons, links and summaries have 44px targets');
    }
  }
  await page.setViewportSize({ width: 375, height: 812 });
  await page.locator('.section-nav a[href="#editing-panel"]').click();
  assert.equal(await page.evaluate(() => document.activeElement.id), 'editing-panel', 'Section navigation moves keyboard focus');
  assert.ok(await page.locator('#editing-panel').evaluate(node => node.getBoundingClientRect().top >= document.querySelector('.section-nav').getBoundingClientRect().bottom), 'Sticky navigation does not cover destination');
  await page.screenshot({ path: path.join(root, 'tmp/ui-tests/mobile-editing.png'), fullPage: true });

  const semantics = await page.evaluate(() => {
    const visible = node => Boolean(node.getClientRects().length);
    const unnamed = [...document.querySelectorAll('input, select, button, a, summary')].filter(visible).filter(node => {
      if (node.getAttribute('aria-label')?.trim() || node.getAttribute('aria-labelledby')) return false;
      if (node.labels?.length) return false;
      return !node.textContent.trim();
    }).map(node => node.id || node.tagName);
    const broken = [...document.querySelectorAll('[aria-describedby], [aria-labelledby]')].flatMap(node =>
      ['aria-describedby', 'aria-labelledby'].flatMap(attribute => (node.getAttribute(attribute) || '').split(/\s+/)
        .filter(id => id && !document.getElementById(id))));
    const ids = [...document.querySelectorAll('[id]')].map(node => node.id);
    return { unnamed, broken, duplicates: ids.filter((id, index) => ids.indexOf(id) !== index) };
  });
  assert.deepEqual(semantics, { unnamed: [], broken: [], duplicates: [] });

  const ratios = await page.evaluate(() => {
    const style = getComputedStyle(document.documentElement);
    const lum = token => {
      const hex = style.getPropertyValue(token).trim().slice(1);
      const rgb = hex.match(/../g).map(value => parseInt(value, 16) / 255).map(value => value <= .04045 ? value / 12.92 : ((value + .055) / 1.055) ** 2.4);
      return rgb[0] * .2126 + rgb[1] * .7152 + rgb[2] * .0722;
    };
    return [
      ['--ink', '--paper-raised', 4.5], ['--ink-secondary', '--paper-inset', 4.5],
      ['--ink-muted', '--paper-inset', 4.5], ['--terrain', '--paper-raised', 4.5],
      ['--warning-ink', '--warning-paper', 4.5], ['--danger-ink', '--danger-paper', 4.5],
      ['--water-ink', '--water-paper', 4.5], ['--control-border', '--control-bg', 3]
    ].map(([foreground, background, minimum]) => ({ foreground, background, minimum,
      ratio: (Math.max(lum(foreground), lum(background)) + .05) / (Math.min(lum(foreground), lum(background)) + .05) }));
  });
  for (const check of ratios) assert.ok(check.ratio >= check.minimum, `${check.foreground} / ${check.background}: ${check.ratio.toFixed(2)}`);
  console.log('Contrast checks: ' + ratios.map(check => check.foreground + ' ' + check.ratio.toFixed(2)).join(', '));

  await page.emulateMedia({ reducedMotion: 'reduce' });
  assert.equal(await page.locator('#save-button').evaluate(node => getComputedStyle(node).transitionDuration), '0s');
  await page.getByRole('button', { name: '模拟修改草稿' }).click();
  await page.locator('#save-button').click();
  assert.equal(await page.locator('#app-status').evaluate(node => getComputedStyle(node, '::before').animationName), 'none');
  await page.waitForFunction(() => document.getElementById('draft-status').textContent === '无草稿');
  await page.emulateMedia({ forcedColors: 'active' });
  assert.notEqual(await page.locator('.sample-marker[aria-pressed="true"]').evaluate(node => getComputedStyle(node).outlineStyle), 'none');
  await page.emulateMedia({ forcedColors: 'none', reducedMotion: 'no-preference', colorScheme: 'dark' });
  assert.equal(await page.locator('html').evaluate(node => getComputedStyle(node).colorScheme), 'light', 'Explicit light scheme keeps native fields readable');
  await page.emulateMedia({ colorScheme: 'light' });

  await page.goto(base);
  await setup();
  await page.evaluate(() => {
    h.layers[0].name = '超长图层名称测试'.repeat(12);
    h.fc.features[0].properties.name = 'Long-unbroken-property-'.repeat(30);
    h.fc.features[0].properties['字段'.repeat(40)] = '很长的中文属性内容'.repeat(50);
    h.ui.renderLayers(h.layers, -1); h.ui.renderTable(h.fc, [-10]);
  });
  for (const width of [320, 768, 1440]) {
    await page.setViewportSize({ width, height: 900 });
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true, `Long user content stays within page at ${width}px`);
    const tableLayout = await page.locator('#table-container').evaluate(node => {
      node.scrollLeft = 400;
      const choice = node.querySelector('tbody td');
      const longCell = [...node.querySelectorAll('tbody td')].find(cell => cell.textContent.startsWith('Long-unbroken'));
      return { stickyOffset: Math.abs(choice.getBoundingClientRect().left - node.getBoundingClientRect().left),
        cellWidth: longCell.getBoundingClientRect().width, fullValue: longCell.title === longCell.textContent };
    });
    assert.ok(tableLayout.stickyOffset <= 2, 'Selection column remains available while scrolling horizontally');
    assert.ok(tableLayout.cellWidth <= 281, 'Long values cannot create excessively wide columns');
    assert.equal(tableLayout.fullValue, true, 'Ellipsized values retain their full text');
  }
  // Double text sizes without altering spacing or media queries: a stronger wrapping stress test than screenshots alone.
  await page.setViewportSize({ width: 768, height: 1024 });
  await page.evaluate(() => {
    const nodes = [...document.querySelectorAll('body, body *')].filter(node => node instanceof HTMLElement);
    const sizes = nodes.map(node => parseFloat(getComputedStyle(node).fontSize));
    nodes.forEach((node, index) => { node.style.fontSize = sizes[index] * 2 + 'px'; });
  });
  assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true, '200% text does not cause whole-page horizontal overflow');
  assert.ok(await page.locator('#properties-editor').evaluate(node => node.clientHeight <= 320 && node.scrollHeight > node.clientHeight), 'Long attributes scroll locally instead of pushing actions thousands of pixels away');
  await page.locator('#properties-editor').focus();
  await page.keyboard.press('End');
  await page.waitForFunction(() => document.getElementById('properties-editor').scrollTop > 0);
  await page.evaluate(() => h.ui.setStatus({ loading: false }));
  assert.ok(await page.locator('#properties-editor').evaluate(node => node.scrollTop > 0), 'Status refresh preserves the property reading position');
  await page.screenshot({ path: path.join(root, 'tmp/ui-tests/large-text.png'), fullPage: true });
  await page.goto(base);
  await page.keyboard.press('Tab');
  assert.equal(await page.evaluate(() => document.activeElement.className), 'skip-link');
  await page.keyboard.press('Enter');
  assert.equal(await page.evaluate(() => document.activeElement.id), 'workspace');
  assert.notEqual(await page.locator('#workspace').evaluate(node => getComputedStyle(node).outlineStyle), 'none');
  console.log('PASS: viewport matrix, 44px targets, navigation focus, labels, references, color contrast, motion, forced colors, long content and enlarged text.');
};
