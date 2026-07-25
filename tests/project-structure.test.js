const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.resolve(__dirname, '..');

function read(relativePath) {
  return fs.readFileSync(path.join(root, relativePath), 'utf8');
}

test('app.json 注册五个页面和三个顶层 tab', () => {
  const config = JSON.parse(read('miniprogram/app.json'));
  assert.deepEqual(config.pages, [
    'pages/index/index',
    'pages/library/index',
    'pages/settings/index',
    'pages/add/index',
    'pages/review/index',
  ]);
  assert.deepEqual(config.tabBar.list.map((item) => item.pagePath), [
    'pages/index/index',
    'pages/library/index',
    'pages/settings/index',
  ]);
});

test('五个页面的 js/json/wxml/wxss 文件全部存在', () => {
  const pages = ['index', 'library', 'settings', 'add', 'review'];
  for (const page of pages) {
    for (const extension of ['js', 'json', 'wxml', 'wxss']) {
      assert.equal(
        fs.existsSync(path.join(root, `miniprogram/pages/${page}/index.${extension}`)),
        true,
        `${page}/index.${extension} should exist`,
      );
    }
  }
});

test('前端不再引用 QuickStart 页面和提示组件', () => {
  const appJson = read('miniprogram/app.json');
  const indexWxml = read('miniprogram/pages/index/index.wxml');
  const projectConfig = JSON.parse(read('project.config.json'));
  assert.equal(appJson.includes('pages/example'), false);
  assert.equal(indexWxml.includes('cloud-tip-modal'), false);
  assert.equal(fs.existsSync(path.join(root, 'miniprogram/pages/example')), false);
  assert.equal(fs.existsSync(path.join(root, 'miniprogram/components/cloudTipModal')), false);
  assert.equal(fs.existsSync(path.join(root, 'miniprogram/envList.js')), false);
  assert.deepEqual(projectConfig.condition, {});
});

test('全局样式包含项目语义色和触控尺寸 token', () => {
  const wxss = read('miniprogram/app.wxss');
  for (const token of [
    '--color-primary: #FF8A65',
    '--color-background: #FAF8F5',
    '--color-unfamiliar: #EF5350',
    '--color-normal: #FFA726',
    '--color-proficient: #66BB6A',
    '--touch-target: 88rpx',
  ]) {
    assert.equal(wxss.includes(token), true, `missing ${token}`);
  }
});
