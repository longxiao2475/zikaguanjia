const test = require('node:test');
const assert = require('node:assert/strict');
const Module = require('node:module');
const path = require('node:path');

const { markCurrent } = require('../miniprogram/utils/review-flow');

const pagePath = path.join(__dirname, '../miniprogram/pages/review/index.js');

function loadReviewPage({ cardApi, wxApi } = {}) {
  const originalLoad = Module._load;
  let definition;
  global.Page = (config) => { definition = config; };
  global.wx = wxApi || {
    getWindowInfo: () => ({ windowWidth: 375 }),
    showToast() {},
  };
  Module._load = function mockLoad(request, parent, isMain) {
    if (request === '../../utils/cache') {
      return {
        getTodayPlan: () => null,
        getManualReviewQueue: () => null,
        clearManualReviewQueue() {},
      };
    }
    if (request === '../../utils/card') return cardApi || {};
    if (request === '../../utils/review-api') return { completeReview: async () => ({}) };
    if (request === '../../utils/session') {
      return {
        getCachedSession: () => ({ child: { _id: 'child-1' } }),
        bootstrap: async () => ({ child: { _id: 'child-1' } }),
      };
    }
    if (request === '../../utils/subscribe') return { requestGrant: async () => ({ accepted: false }) };
    if (request === '../../utils/review-queue') return { mergeReviewCards: (left, right) => [...left, ...right] };
    if (request === '../../utils/view') return { decorateCard: (card) => card };
    return originalLoad(request, parent, isMain);
  };
  delete require.cache[pagePath];
  try {
    require(pagePath);
  } finally {
    Module._load = originalLoad;
    delete global.Page;
  }
  return definition;
}

function createContext(definition, data = {}) {
  return {
    ...definition,
    data: {
      cards: [],
      total: 0,
      currentCard: null,
      currentPosition: 0,
      completedCount: 0,
      progressPercent: 0,
      submitting: false,
      completed: false,
      showWordDetail: false,
      wordDetailCard: null,
      wordDetail: { content: '', characters: [] },
      wordDetailSaving: false,
      showOrderSheet: false,
      pendingOrderItems: [],
      orderAreaHeight: 0,
      ...data,
    },
    setData(update) {
      this.data = { ...this.data, ...update };
    },
  };
}

test('点击复习字卡按不重复单字打开拼音和组词详情', () => {
  const definition = loadReviewPage();
  const context = createContext(definition);
  definition.applyPlan.call(context, {
    cards: [{ _id: 'card-1', content: '礼物礼', customWords: ['礼貌'] }],
  });

  definition.onOpenWords.call(context);

  assert.equal(context.data.showWordDetail, true);
  assert.equal(context.data.wordDetailCard._id, 'card-1');
  assert.deepEqual(context.data.wordDetail.characters.map((item) => item.character), ['礼', '物']);
  assert.equal(context.data.wordDetail.characters[0].words.includes('礼貌'), true);
});

test('排序弹层只列出未完成字卡，拖拽后当前卡跟随新顺序', () => {
  const definition = loadReviewPage();
  const context = createContext(definition);
  definition.applyPlan.call(context, {
    cards: [
      { _id: 'a', content: '大' },
      { _id: 'b', content: '人' },
      { _id: 'c', content: '小' },
    ],
  });
  context._reviewState = markCurrent(context._reviewState, 'normal');
  definition.applyReviewState.call(context);

  definition.onOpenOrderSheet.call(context);

  assert.equal(context.data.showOrderSheet, true);
  assert.deepEqual(context.data.pendingOrderItems.map((item) => item._id), ['b', 'c']);
  assert.equal(context.data.pendingOrderItems[0].orderNumber, 2);

  definition.onOrderDragStart.call(context, { currentTarget: { dataset: { index: 1 } } });
  definition.onOrderDragChange.call(context, {
    currentTarget: { dataset: { index: 1 } },
    detail: { source: 'touch', y: 0 },
  });
  definition.onOrderDragEnd.call(context, { currentTarget: { dataset: { index: 1 } } });

  assert.deepEqual(context._reviewState.cards.map((card) => card._id), ['a', 'c', 'b']);
  assert.equal(context._reviewState.currentCard._id, 'c');
  assert.deepEqual(context._reviewState.results, [{ cardId: 'a', proficiency: 'normal' }]);
  assert.deepEqual(context.data.pendingOrderItems.map((item) => item._id), ['c', 'b']);
});

test('原生 movable-view 事件缺少 dataset 时仍按已记录的起点完成拖拽', () => {
  const definition = loadReviewPage();
  const context = createContext(definition);
  definition.applyPlan.call(context, {
    cards: [
      { _id: 'a', content: '大' },
      { _id: 'b', content: '人' },
      { _id: 'c', content: '小' },
    ],
  });
  definition.onOpenOrderSheet.call(context);

  definition.onOrderDragStart.call(context, { currentTarget: { dataset: { index: 1 } } });
  definition.onOrderDragChange.call(context, {
    currentTarget: { dataset: {} },
    detail: { source: 'touch', y: 0 },
  });
  definition.onOrderDragEnd.call(context, { currentTarget: { dataset: {} } });

  assert.deepEqual(context._reviewState.cards.map((card) => card._id), ['b', 'a', 'c']);
  assert.equal(context._reviewState.currentCard._id, 'b');
});

test('复习详情保存补充组词后同步当前卡和详情', async () => {
  let payload;
  const originalCard = { _id: 'card-1', content: '礼物', customWords: [] };
  const definition = loadReviewPage({
    cardApi: {
      updateCard: async (value) => {
        payload = value;
        return { ...originalCard, customWords: value.customWords };
      },
    },
  });
  const context = createContext(definition);
  definition.applyPlan.call(context, { cards: [originalCard] });
  definition.onOpenWords.call(context);
  definition.onDetailWordInput.call(context, {
    currentTarget: { dataset: { index: 0 } },
    detail: { value: '礼貌草稿' },
  });
  definition.onDetailWordInput.call(context, {
    currentTarget: { dataset: { index: 1 } },
    detail: { value: '物品' },
  });

  await definition.onSaveDetailWord.call(context, { currentTarget: { dataset: { index: 1 } } });

  assert.deepEqual(payload, {
    childId: 'child-1',
    cardId: 'card-1',
    customWords: ['物品'],
  });
  assert.deepEqual(context._reviewState.currentCard.customWords, ['物品']);
  assert.equal(context.data.wordDetail.characters[1].words.includes('物品'), true);
  assert.equal(context.data.wordDetail.characters[0].inputValue, '礼貌草稿');
  assert.equal(context.data.wordDetail.characters[1].inputValue, '');
});
