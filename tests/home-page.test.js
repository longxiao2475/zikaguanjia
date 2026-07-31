const test = require('node:test');
const assert = require('node:assert/strict');
const Module = require('node:module');
const path = require('node:path');

const pagePath = path.join(__dirname, '../miniprogram/pages/index/index.js');

function loadHomePage({ cacheApi, wxApi } = {}) {
  const originalLoad = Module._load;
  let definition;
  global.Page = (config) => { definition = config; };
  global.getApp = () => ({ globalData: {} });
  global.wx = {
    navigateTo() {},
    switchTab() {},
    showToast() {},
    stopPullDownRefresh() {},
    ...wxApi,
  };
  Module._load = function mockLoad(request, parent, isMain) {
    if (request === '../../utils/cache') {
      return cacheApi || {
        getTodayPlan: () => null,
        setLibraryFilterIntent() {},
        setManualReviewQueue: (cardIds, createdAt, mode) => ({ cardIds, createdAt, mode }),
        clearManualReviewQueue() {},
      };
    }
    if (request === '../../utils/card') return {};
    if (request === '../../utils/session') {
      return {
        getCachedSession: () => ({ user: null, child: null }),
        bootstrap: async () => ({ user: null, child: { _id: 'child-1' } }),
      };
    }
    if (request === '../../utils/subscribe') return { requestGrant: async () => ({ accepted: false }) };
    if (request === '../../utils/home') {
      return { getHomeBanners: () => ({ showStudyBanner: false, showQuotaBanner: false }) };
    }
    if (request === '../../utils/review') return { isStudyDay: () => false };
    if (request === '../../utils/view') {
      return {
        decorateCard: (card) => card,
        formatDisplayDate: () => '7月31日 星期五',
        getGreeting: () => '上午好',
      };
    }
    return originalLoad(request, parent, isMain);
  };
  delete require.cache[pagePath];
  try {
    require(pagePath);
  } finally {
    Module._load = originalLoad;
    delete global.Page;
    delete global.getApp;
  }
  return definition;
}

function createHomePage({
  cards = [],
  setManualReviewQueue,
  clearManualReviewQueue,
  navigateTo,
  showToast,
} = {}) {
  const cacheApi = {
    getTodayPlan: () => null,
    setLibraryFilterIntent() {},
    setManualReviewQueue: setManualReviewQueue
      || ((cardIds, createdAt, mode) => ({ cardIds, createdAt, mode })),
    clearManualReviewQueue: clearManualReviewQueue || (() => {}),
  };
  const definition = loadHomePage({
    cacheApi,
    wxApi: {
      navigateTo: navigateTo || ((options) => options.success && options.success()),
      showToast: showToast || (() => {}),
    },
  });
  const context = {
    ...definition,
    data: { ...definition.data },
    setData(update) {
      this.data = { ...this.data, ...update };
    },
  };
  definition.applyState.call(context, null, null, {
    cards,
    stats: { total: cards.length, unfamiliar: 0, normal: 0, proficient: 0 },
    overview: { total: cards.length, mastered: 0, due: cards.length },
  }, new Date('2026-07-31T00:00:00.000Z'));
  return { definition, context };
}

test('管理模式默认不选中并展开全部待复习字卡', () => {
  const cards = Array.from({ length: 8 }, (_, index) => ({ _id: `card-${index + 1}` }));
  const { definition, context } = createHomePage({ cards });

  definition.onToggleReviewSelectionMode.call(context);

  assert.equal(context.data.reviewSelectionMode, true);
  assert.equal(context.data.previewCards.length, 8);
  assert.equal(context.data.selectedReviewCount, 0);
  assert.equal(context.data.allReviewCardsSelected, false);

  definition.onToggleReviewSelectionMode.call(context);
  assert.equal(context.data.reviewSelectionMode, false);
  assert.equal(context.data.previewCards.length, 6);
});

test('选择和全选会同步卡片选中态及数量', () => {
  const { definition, context } = createHomePage({
    cards: [{ _id: 'a' }, { _id: 'b' }, { _id: 'c' }],
  });
  definition.onToggleReviewSelectionMode.call(context);

  definition.onToggleReviewCard.call(context, { currentTarget: { dataset: { id: 'b' } } });
  assert.deepEqual(context.data.selectedReviewIds, ['b']);
  assert.equal(context.data.previewCards[1].selected, true);
  assert.equal(context.data.selectedReviewCount, 1);

  definition.onToggleAllReviewCards.call(context);
  assert.deepEqual(context.data.selectedReviewIds, ['a', 'b', 'c']);
  assert.equal(context.data.allReviewCardsSelected, true);

  definition.onToggleAllReviewCards.call(context);
  assert.deepEqual(context.data.selectedReviewIds, []);
});

test('选择本批后写入 replace 队列并跳转批次入口', () => {
  const calls = [];
  const { definition, context } = createHomePage({
    cards: [{ _id: 'a' }, { _id: 'b' }],
    setManualReviewQueue: (...args) => {
      calls.push(args);
      return { cardIds: args[0], createdAt: args[1], mode: args[2] };
    },
    navigateTo: (options) => {
      assert.equal(options.url, '/pages/review/index?source=batch');
      options.success();
    },
  });
  definition.onToggleReviewSelectionMode.call(context);
  definition.onToggleReviewCard.call(context, { currentTarget: { dataset: { id: 'b' } } });

  definition.onStartSelectedReview.call(context);

  assert.deepEqual(calls[0][0], ['b']);
  assert.equal(calls[0][2], 'replace');
  assert.equal(context.data.reviewSelectionMode, false);
  assert.equal(context.data.selectedReviewCount, 0);
});

test('进入复习失败时清理临时队列并保留当前选择', () => {
  let cleared = 0;
  const toasts = [];
  const { definition, context } = createHomePage({
    cards: [{ _id: 'a' }],
    clearManualReviewQueue: () => { cleared += 1; },
    navigateTo: (options) => options.fail(),
    showToast: (options) => toasts.push(options),
  });
  definition.onToggleReviewSelectionMode.call(context);
  definition.onToggleReviewCard.call(context, { currentTarget: { dataset: { id: 'a' } } });

  definition.onStartSelectedReview.call(context);

  assert.equal(cleared, 1);
  assert.deepEqual(context.data.selectedReviewIds, ['a']);
  assert.equal(context.data.reviewSelectionMode, true);
  assert.equal(toasts.at(-1).title, '进入复习失败，请重试');
});

test('单批最多选择五十张且不会静默丢失更多选择', () => {
  const toasts = [];
  const cards = Array.from({ length: 51 }, (_, index) => ({ _id: `card-${index + 1}` }));
  const { definition, context } = createHomePage({
    cards,
    showToast: (options) => toasts.push(options),
  });
  definition.onToggleReviewSelectionMode.call(context);

  definition.onToggleAllReviewCards.call(context);
  assert.equal(context.data.selectedReviewCount, 50);
  assert.equal(context.data.previewCards[50].selected, false);
  assert.equal(context.data.allReviewCardsSelected, true);

  definition.applyState.call(
    context,
    null,
    null,
    context.data.plan,
    new Date('2026-07-31T00:00:00.000Z'),
  );
  assert.equal(context.data.allReviewCardsSelected, true);

  definition.onToggleReviewCard.call(context, {
    currentTarget: { dataset: { id: 'card-51' } },
  });

  assert.equal(context.data.selectedReviewCount, 50);
  assert.equal(context.data.previewCards[50].selected, false);
  assert.equal(toasts.at(-1).title, '每批最多选择50张');
});
