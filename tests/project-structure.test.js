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

test('复习页和字卡库内联字卡详情且不再依赖 word-sheet 组件', () => {
  for (const page of ['review', 'library']) {
    const configPath = `miniprogram/pages/${page}/index.json`;
    const config = JSON.parse(read(configPath));
    const wxml = read(`miniprogram/pages/${page}/index.wxml`);
    assert.equal(config.usingComponents && config.usingComponents['word-sheet'], undefined);
    assert.equal(wxml.includes('<word-sheet'), false);
    assert.equal(wxml.includes('class="word-detail-mask"'), true);
    assert.equal(wxml.includes('wordDetail.characters'), true);
  }
  assert.equal(fs.existsSync(path.join(root, 'miniprogram/components/word-sheet')), false);
});

test('字典数据使用小程序可加载的 JavaScript 模块', () => {
  const dictJs = read('miniprogram/utils/dict.js');

  assert.equal(dictJs.includes("require('./dict-data.json')"), false);
  assert.equal(dictJs.includes("require('./pinyin-data.json')"), false);
  assert.equal(fs.existsSync(path.join(root, 'miniprogram/utils/dict-data.js')), true);
  assert.equal(fs.existsSync(path.join(root, 'miniprogram/utils/pinyin-data.js')), true);
});

test('复习页补查并消费临时复习队列', () => {
  const reviewJs = read('miniprogram/pages/review/index.js');
  for (const token of [
    'getManualReviewQueue',
    'getCardsByIds',
    'mergeReviewCards',
    'clearManualReviewQueue',
  ]) {
    assert.equal(reviewJs.includes(token), true, `missing ${token}`);
  }
});

test('复习顺序使用独立模块路径避免小程序旧模块缓存', () => {
  const reviewJs = read('miniprogram/pages/review/index.js');

  assert.equal(reviewJs.includes("require('../../utils/review-order')"), true);
  assert.equal(fs.existsSync(path.join(root, 'miniprogram/utils/review-order.js')), true);
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
  assert.equal(indexWxml.includes('class="floating-add"'), true);
  assert.equal(indexWxml.includes('<button class="floating-add"'), false);
});

test('字卡库包含搜索、多选和开始复习入口', () => {
  const libraryJs = read('miniprogram/pages/library/index.js');
  const libraryWxml = read('miniprogram/pages/library/index.wxml');
  const libraryWxss = read('miniprogram/pages/library/index.wxss');
  for (const token of [
    'onKeywordInput',
    'onClearKeyword',
    'onToggleSelectionMode',
    'onToggleCardSelection',
    'onCardTap',
    'onStartSelectedReview',
    'onOpenEdit',
    'onSaveEdit',
    'onDeleteCard',
  ]) {
    assert.equal(libraryJs.includes(token), true, `missing ${token}`);
  }
  assert.equal(libraryWxml.includes('placeholder="搜索字或词"'), true);
  assert.equal(libraryWxml.includes('bindtap="onCardTap"'), true);
  assert.equal(libraryWxml.includes('word-card__selector-hit'), true);
  assert.equal(libraryWxml.includes('<button\n        wx:if="{{selectionMode}}"\n        class="word-card__selector'), false);
  assert.equal(libraryWxml.includes('已选 {{selectedCount}} 张'), true);
  assert.equal(libraryWxml.includes('开始复习'), true);
  assert.equal(libraryWxml.includes('编辑字卡'), true);
  assert.equal(libraryWxml.includes('删除字卡'), true);
  assert.equal(libraryWxml.includes('class="word-card__edit"'), true);
  assert.equal(libraryWxml.includes('<button\n        wx:if="{{!selectionMode}}"\n        class="word-card__edit"'), false);
  assert.equal(libraryWxss.includes('color: var(--color-text);'), true);
  assert.equal(libraryWxss.includes('caret-color: var(--color-primary-dark);'), true);
  assert.equal(libraryWxss.includes('width: 38rpx;'), true);
});

test('内联详情关闭控件和复习拖拽结构齐全', () => {
  const libraryWxml = read('miniprogram/pages/library/index.wxml');
  const reviewWxml = read('miniprogram/pages/review/index.wxml');
  const reviewWxss = read('miniprogram/pages/review/index.wxss');
  const movableViewTag = reviewWxml.match(/<movable-view[\s\S]*?>/)[0];
  assert.equal(libraryWxml.includes('class="word-detail__close"'), true);
  assert.equal(libraryWxml.includes('<button\n        class="word-detail__close"'), false);
  assert.equal(libraryWxml.includes('cursor-color="#E6704A"'), true);
  assert.equal(reviewWxml.includes('<movable-area'), true);
  assert.equal(reviewWxml.includes('<movable-view'), true);
  assert.equal(movableViewTag.includes('bindtouchstart='), false);
  assert.equal(movableViewTag.includes('bindtouchend='), false);
  assert.equal(reviewWxml.includes('class="order-sheet__item-content"'), true);
  assert.equal(reviewWxml.includes('bindtouchstart="onOrderDragStart"'), true);
  assert.equal(reviewWxml.includes('bindtouchend="onOrderDragEnd"'), true);
  assert.equal(reviewWxss.includes('.order-sheet__item'), true);
  assert.equal(reviewWxss.includes('width: 88rpx;'), true);
});

test('Day 6 已移除 QuickStart 云函数残留', () => {
  assert.equal(fs.existsSync(path.join(root, 'cloudfunctions/quickstartFunctions')), false);
  assert.equal(fs.existsSync(path.join(root, 'cloudfunctions/askDeepSeek')), false);
  assert.equal(fs.existsSync(path.join(root, 'miniprogram/utils/aiTask.js')), false);
});

test('设置页完整保留七天选择并移除开发阶段文案', () => {
  const settingsJs = read('miniprogram/pages/settings/index.js');
  const settingsWxml = read('miniprogram/pages/settings/index.wxml');
  const settingsWxss = read('miniprogram/pages/settings/index.wxss');
  assert.equal((settingsJs.match(/label: '[一二三四五六日]'/g) || []).length, 7);
  assert.equal(settingsWxml.includes('字卡管家 MVP · Day 5'), false);
  assert.equal(settingsWxss.includes('grid-template-columns: repeat(7'), false);
  assert.equal(settingsWxss.includes('display: flex'), true);
  assert.equal(settingsWxss.includes('flex-wrap: wrap'), true);
});
