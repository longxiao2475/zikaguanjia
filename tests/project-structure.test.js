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

test('复习页和字卡库共用 word-sheet 组件', () => {
  for (const extension of ['js', 'json', 'wxml', 'wxss']) {
    assert.equal(
      fs.existsSync(path.join(root, `miniprogram/components/word-sheet/index.${extension}`)),
      true,
      `word-sheet/index.${extension} should exist`,
    );
  }

  const reviewConfig = JSON.parse(read('miniprogram/pages/review/index.json'));
  const libraryConfig = JSON.parse(read('miniprogram/pages/library/index.json'));
  assert.equal(reviewConfig.usingComponents['word-sheet'], '/components/word-sheet/index');
  assert.equal(libraryConfig.usingComponents['word-sheet'], '/components/word-sheet/index');
});

test('复习完成页和设置页接入订阅额度入口', () => {
  const reviewJs = read('miniprogram/pages/review/index.js');
  const reviewWxml = read('miniprogram/pages/review/index.wxml');
  const settingsJs = read('miniprogram/pages/settings/index.js');
  const settingsWxml = read('miniprogram/pages/settings/index.wxml');

  assert.equal(reviewJs.includes("subscribe.requestGrant('review_complete')"), true);
  assert.equal(reviewWxml.includes('开启提醒'), true);
  assert.equal(reviewWxml.includes('以后再说'), true);
  assert.equal(settingsJs.includes("subscribe.requestGrant('settings')"), true);
  assert.equal(settingsWxml.includes('补充提醒次数'), true);
});

test('Day 4 和 Day 5 云函数结构与消息字段齐全', () => {
  for (const name of ['reviewService', 'subscriptionService', 'sendReminder']) {
    for (const file of ['index.js', 'service.js', 'repository.js', 'package.json', 'config.json']) {
      assert.equal(
        fs.existsSync(path.join(root, `cloudfunctions/${name}/${file}`)),
        true,
        `${name}/${file} should exist`,
      );
    }
  }

  const reminderIndex = read('cloudfunctions/sendReminder/index.js');
  const reminderSchedule = read('cloudfunctions/sendReminder/schedule.js');
  const subscriptionService = read('cloudfunctions/subscriptionService/service.js');
  for (const token of ['number1', 'thing2', 'time5']) {
    assert.equal(reminderSchedule.includes(token), true, `missing ${token}`);
  }
  assert.equal(reminderIndex.includes('cloud.openapi.subscribeMessage.send'), true);
  assert.equal(subscriptionService.includes('38gNuA8j_S9YEP-incMBQnGnjVE6WxP1Lm8NRRPngkM'), true);
});

test('首页同时包含认字日兜底和额度预警入口', () => {
  const indexJs = read('miniprogram/pages/index/index.js');
  const indexWxml = read('miniprogram/pages/index/index.wxml');
  assert.equal(indexJs.includes('getHomeBanners'), true);
  assert.equal(indexJs.includes("subscribe.requestGrant('home_quota_banner')"), true);
  assert.equal(indexWxml.includes('今天该认字啦'), true);
  assert.equal(indexWxml.includes('提醒次数不足'), true);
});

test('首页统计卡可导航到字卡库筛选', () => {
  const indexJs = read('miniprogram/pages/index/index.js');
  const indexWxml = read('miniprogram/pages/index/index.wxml');
  assert.equal(indexJs.includes('setLibraryFilterIntent'), true);
  for (const filter of ['all', 'mastered', 'due']) {
    assert.equal(indexWxml.includes(`data-filter="${filter}"`), true);
  }
  assert.equal(indexWxml.includes('bindtap="onOpenLibrary"'), true);
});

test('字卡库包含搜索、多选和开始复习入口', () => {
  const libraryJs = read('miniprogram/pages/library/index.js');
  const libraryWxml = read('miniprogram/pages/library/index.wxml');
  for (const token of [
    'onKeywordInput',
    'onClearKeyword',
    'onToggleSelectionMode',
    'onToggleCardSelection',
    'onStartSelectedReview',
  ]) {
    assert.equal(libraryJs.includes(token), true, `missing ${token}`);
  }
  assert.equal(libraryWxml.includes('placeholder="搜索字或词"'), true);
  assert.equal(libraryWxml.includes('已选 {{selectedCount}} 张'), true);
  assert.equal(libraryWxml.includes('开始复习'), true);
});
