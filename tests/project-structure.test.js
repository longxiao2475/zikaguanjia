const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.resolve(__dirname, '..');

function read(relativePath) {
  return fs.readFileSync(path.join(root, relativePath), 'utf8');
}

function readRule(wxss, selector) {
  const escapedSelector = selector.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const match = wxss.match(new RegExp(`${escapedSelector}\\s*\\{([^}]*)\\}`));
  assert.ok(match, `missing ${selector}`);
  return match[1];
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

test('分类选择组件文件完整并在录入页和字卡库注册', () => {
  for (const extension of ['js', 'json', 'wxml', 'wxss']) {
    assert.equal(
      fs.existsSync(path.join(root, `miniprogram/components/category-picker/index.${extension}`)),
      true,
      `category-picker/index.${extension} should exist`,
    );
  }
  for (const page of ['add', 'library']) {
    const config = JSON.parse(read(`miniprogram/pages/${page}/index.json`));
    assert.equal(config.usingComponents['category-picker'], '/components/category-picker/index');
  }
  const pickerWxml = read('miniprogram/components/category-picker/index.wxml');
  assert.equal(pickerWxml.includes('.indexOf('), false);
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

test('录入方式和单字详情添加按钮的文字垂直居中', () => {
  const addWxss = read('miniprogram/pages/add/index.wxss');
  const libraryWxss = read('miniprogram/pages/library/index.wxss');
  const reviewWxss = read('miniprogram/pages/review/index.wxss');

  for (const rule of [
    readRule(addWxss, 'button.mode-tab'),
    readRule(libraryWxss, 'button.word-detail__save'),
    readRule(reviewWxss, 'button.word-detail__save'),
  ]) {
    assert.match(rule, /display:\s*flex;/);
    assert.match(rule, /align-items:\s*center;/);
    assert.match(rule, /justify-content:\s*center;/);
  }
});

test('原生按钮网格允许列收缩且不会横向溢出', () => {
  const addWxss = read('miniprogram/pages/add/index.wxss');
  const libraryWxss = read('miniprogram/pages/library/index.wxss');

  assert.match(readRule(addWxss, '.mode-tabs'), /grid-template-columns:\s*repeat\(2,\s*minmax\(0,\s*1fr\)\);/);
  assert.match(readRule(addWxss, '.source-switch'), /grid-template-columns:\s*repeat\(2,\s*minmax\(0,\s*1fr\)\);/);
  assert.match(readRule(libraryWxss, '.filter-tabs'), /grid-template-columns:\s*repeat\(3,\s*minmax\(0,\s*1fr\)\);/);
  assert.match(readRule(libraryWxss, '.edit-sheet__proficiencies'), /grid-template-columns:\s*repeat\(3,\s*minmax\(0,\s*1fr\)\);/);
  assert.match(readRule(libraryWxss, '.edit-sheet__actions'), /grid-template-columns:\s*minmax\(0,\s*1fr\)\s+minmax\(0,\s*1\.5fr\);/);

  for (const rule of [
    readRule(addWxss, 'button.mode-tab'),
    readRule(addWxss, 'button.source-option'),
    readRule(libraryWxss, 'button.filter-tab'),
    readRule(libraryWxss, 'button.edit-sheet__proficiency'),
  ]) {
    assert.match(rule, /width:\s*100%;/);
    assert.match(rule, /min-width:\s*0;/);
    assert.match(rule, /max-width:\s*100%;/);
  }

  const categorySelectRule = readRule(addWxss, 'button.category-select');
  assert.match(categorySelectRule, /width:\s*100%;/);
  assert.match(categorySelectRule, /max-width:\s*100%;/);

  const pickerWxss = read('miniprogram/components/category-picker/index.wxss');
  for (const selector of [
    'button.category-picker__header-button',
    'button.category-picker__chip',
    'button.category-picker__rename',
    'button.category-picker__add',
  ]) {
    assert.match(readRule(pickerWxss, selector), /max-width:\s*100%;/);
  }
});

test('所有选择按钮使用足够优先级的可见选中态', () => {
  const addWxss = read('miniprogram/pages/add/index.wxss');
  const pickerWxss = read('miniprogram/components/category-picker/index.wxss');
  const libraryWxss = read('miniprogram/pages/library/index.wxss');

  for (const [stylesheet, selector] of [
    [addWxss, 'button.mode-tab--active'],
    [addWxss, 'button.source-option--active'],
    [pickerWxss, 'button.category-picker__chip--selected'],
    [pickerWxss, 'button.category-picker__header-button--primary'],
    [libraryWxss, 'button.category-filter-button--active'],
    [libraryWxss, 'button.filter-tab--active'],
  ]) {
    const rule = readRule(stylesheet, selector);
    assert.match(rule, /color:/, `${selector} should change text color`);
    assert.match(rule, /background:/, `${selector} should change background`);
  }
});

test('编辑字卡完整显示三个熟练度且按钮文字垂直居中', () => {
  const libraryWxml = read('miniprogram/pages/library/index.wxml');
  const libraryWxss = read('miniprogram/pages/library/index.wxss');

  for (const value of ['unfamiliar', 'normal', 'proficient']) {
    assert.equal(libraryWxml.includes(`data-value="${value}"`), true, `missing ${value}`);
  }

  assert.match(readRule(libraryWxss, 'button.edit-sheet__proficiency'), /display:\s*flex;/);
  assert.match(readRule(libraryWxss, 'button.edit-sheet__proficiency'), /align-items:\s*center;/);
  assert.match(readRule(libraryWxss, 'button.edit-sheet__proficiency'), /justify-content:\s*center;/);
  assert.match(libraryWxss, /button\.edit-sheet__delete,\s*button\.edit-sheet__save\s*\{[^}]*display:\s*flex;[^}]*align-items:\s*center;[^}]*justify-content:\s*center;/s);
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
  assert.equal(libraryWxml.includes('category-filter-button'), true);
  assert.equal(libraryWxml.includes('word-card__category'), true);
  assert.equal(libraryWxml.includes('showCategoryFilterPicker'), true);
  assert.equal(libraryWxml.includes('word-card-swipe'), true);
  assert.equal(libraryWxml.includes('onCardTouchStart'), true);
  assert.equal(libraryWxml.includes('onSwipeDelete'), true);
  assert.equal(libraryWxml.includes('编辑字卡'), true);
  assert.equal(libraryWxml.includes('删除字卡'), true);
  assert.equal(libraryWxml.includes('class="word-card__edit"'), true);
  assert.equal(libraryWxml.includes('<button\n        wx:if="{{!selectionMode}}"\n        class="word-card__edit"'), false);
  assert.equal(libraryWxss.includes('color: var(--color-text);'), true);
  assert.equal(libraryWxss.includes('caret-color: var(--color-primary-dark);'), true);
  assert.equal(libraryWxss.includes('width: 38rpx;'), true);
});

test('录入和编辑字卡都提供分类选择入口', () => {
  const addWxml = read('miniprogram/pages/add/index.wxml');
  const libraryWxml = read('miniprogram/pages/library/index.wxml');
  assert.equal(addWxml.includes('所属分类'), true);
  assert.equal(addWxml.includes('showCategoryPicker'), true);
  assert.equal(libraryWxml.includes('editCategorySummary'), true);
  assert.equal(libraryWxml.includes('showEditCategoryPicker'), true);
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
  assert.equal(reviewWxml.includes('order-sheet__item-content'), true);
  assert.equal(reviewWxml.includes('bindtouchstart="onOrderDragStart"'), true);
  assert.equal(reviewWxml.includes('bindtouchend="onOrderDragEnd"'), true);
  assert.equal(reviewWxml.includes('animation="{{item.animate}}"'), true);
  assert.equal(reviewWxml.includes('order-sheet__item--dragging'), true);
  assert.equal(reviewWxml.includes('order-sheet__item-content--dragging'), true);
  assert.equal(reviewWxss.includes('.order-sheet__item'), true);
  assert.equal(reviewWxss.includes('transition: transform 160ms ease-out'), true);
  assert.equal(reviewWxss.includes('z-index: 10'), true);
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

test('设置页只提供整点小时选择', () => {
  const settingsJs = read('miniprogram/pages/settings/index.js');
  const settingsWxml = read('miniprogram/pages/settings/index.wxml');

  assert.equal(settingsJs.includes('Array.from({ length: 24 }'), true);
  assert.equal(settingsWxml.includes('mode="time"'), false);
  assert.equal(settingsWxml.includes('mode="selector"'), true);
  assert.equal(settingsWxml.includes('range="{{hourOptions}}"'), true);
  assert.equal(settingsWxml.includes('value="{{reminderHourIndex}}"'), true);
});
