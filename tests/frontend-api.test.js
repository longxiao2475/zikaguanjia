const test = require('node:test');
const assert = require('node:assert/strict');

const storage = new Map();
const calls = [];

global.wx = {
  getStorageSync(key) {
    return storage.get(key);
  },
  setStorageSync(key, value) {
    storage.set(key, value);
  },
  removeStorageSync(key) {
    storage.delete(key);
  },
  cloud: {
    async callFunction(options) {
      calls.push(options);
      return global.__cloudResponse;
    },
  },
};

const cache = require('../miniprogram/utils/cache');
const { callFunction } = require('../miniprogram/utils/cloud');
const session = require('../miniprogram/utils/session');
const cardApi = require('../miniprogram/utils/card');
const categoryApi = require('../miniprogram/utils/category');
const reviewApi = require('../miniprogram/utils/review-api');

test.beforeEach(() => {
  storage.clear();
  calls.length = 0;
  global.__cloudResponse = { result: { ok: true, data: {} } };
});

test('统一云调用返回 data 并保留业务错误码', async () => {
  global.__cloudResponse = { result: { ok: true, data: { value: 1 } } };
  assert.deepEqual(await callFunction('demo', { action: 'read' }), { value: 1 });

  global.__cloudResponse = { result: { ok: false, error: { code: 'DEMO_ERROR', message: '失败' } } };
  await assert.rejects(
    () => callFunction('demo', {}),
    (error) => error.code === 'DEMO_ERROR' && error.message === '失败',
  );
});

test('bootstrap 缓存用户、孩子和同步时间', async () => {
  global.__cloudResponse = {
    result: {
      ok: true,
      data: { user: { _id: 'u1' }, child: { _id: 'c1' } },
    },
  };

  const result = await session.bootstrap();

  assert.equal(calls[0].name, 'syncSettings');
  assert.deepEqual(calls[0].data, { action: 'bootstrap' });
  assert.deepEqual(cache.getUser(), { _id: 'u1' });
  assert.deepEqual(cache.getChild(), { _id: 'c1' });
  assert.equal(typeof cache.getLastSyncAt(), 'number');
  assert.deepEqual(result.child, { _id: 'c1' });
});

test('创建字卡后追加本地缓存，获取今日计划后覆盖计划缓存', async () => {
  cache.setCards([{ _id: 'old' }]);
  global.__cloudResponse = { result: { ok: true, data: { _id: 'new', content: '大' } } };

  await cardApi.createCard({ childId: 'c1', content: '大', source: 'new' });
  assert.deepEqual(cache.getCards().map((item) => item._id), ['old', 'new']);

  global.__cloudResponse = {
    result: { ok: true, data: { cards: [{ _id: 'new' }], overview: { total: 1, mastered: 0, due: 1 } } },
  };
  const plan = await cardApi.getTodayPlan('c1');
  assert.deepEqual(cache.getTodayPlan(), plan);
});

test('首页第一页全部列表会覆盖字卡缓存', async () => {
  global.__cloudResponse = {
    result: { ok: true, data: { items: [{ _id: 'a' }], page: 1, hasMore: false } },
  };

  await cardApi.listCards({ childId: 'c1', filter: 'all', page: 1 });
  assert.deepEqual(cache.getCards(), [{ _id: 'a' }]);
});

test('分类 API 列出、新增和改名后更新本地缓存', async () => {
  global.__cloudResponse = {
    result: { ok: true, data: [{ _id: 'category-1', name: '植物' }] },
  };
  const listed = await categoryApi.listCategories('c1');
  assert.deepEqual(calls[0], {
    name: 'categoryService',
    data: { action: 'list', childId: 'c1' },
  });
  assert.deepEqual(cache.getCategories(), listed);

  global.__cloudResponse = {
    result: { ok: true, data: { _id: 'category-2', name: '汽车' } },
  };
  await categoryApi.createCategory({ childId: 'c1', name: '汽车' });
  assert.deepEqual(cache.getCategories().map((item) => item._id), ['category-1', 'category-2']);

  global.__cloudResponse = {
    result: { ok: true, data: { _id: 'category-2', name: '交通工具' } },
  };
  await categoryApi.updateCategory({ childId: 'c1', categoryId: 'category-2', name: '交通工具' });
  assert.equal(cache.getCategories()[1].name, '交通工具');
});

test('搜索列表透传 keyword，按 ID 补查调用 getByIds', async () => {
  cache.setCards([{ _id: 'keep' }]);
  global.__cloudResponse = { result: { ok: true, data: { items: [] } } };
  await cardApi.listCards({ childId: 'c1', filter: 'all', keyword: '礼', page: 1 });
  assert.equal(calls[0].data.keyword, '礼');
  assert.deepEqual(cache.getCards(), [{ _id: 'keep' }]);

  global.__cloudResponse = { result: { ok: true, data: [{ _id: 'a' }] } };
  const cards = await cardApi.getCardsByIds('c1', ['a']);
  assert.deepEqual(calls[1].data, {
    action: 'getByIds',
    childId: 'c1',
    cardIds: ['a'],
  });
  assert.deepEqual(cards, [{ _id: 'a' }]);
});

test('完成复习后合并返回字卡并废弃今日计划缓存', async () => {
  cache.setCards([
    { _id: 'a', proficiency: 'unfamiliar' },
    { _id: 'b', proficiency: 'normal' },
  ]);
  cache.setTodayPlan({ cards: [{ _id: 'a' }] });
  global.__cloudResponse = {
    result: {
      ok: true,
      data: {
        session: { _id: 's1' },
        cards: [{ _id: 'a', proficiency: 'proficient', reviewCount: 1 }],
      },
    },
  };

  const result = await reviewApi.completeReview({
    childId: 'c1',
    items: [{ cardId: 'a', proficiency: 'proficient' }],
  });

  assert.equal(calls[0].name, 'reviewService');
  assert.deepEqual(calls[0].data, {
    action: 'complete',
    childId: 'c1',
    items: [{ cardId: 'a', proficiency: 'proficient' }],
  });
  assert.deepEqual(cache.getCards(), [
    { _id: 'a', proficiency: 'proficient', reviewCount: 1 },
    { _id: 'b', proficiency: 'normal' },
  ]);
  assert.equal(cache.getTodayPlan(), null);
  assert.equal(result.session._id, 's1');
});

test('保存孩子设置后只用云端返回值更新缓存', async () => {
  cache.setChild({ _id: 'c1', reminderTime: '20:00' });
  global.__cloudResponse = {
    result: {
      ok: true,
      data: { _id: 'c1', name: '果果', studyDays: [2, 6], reminderTime: '19:30', reminderEnabled: false },
    },
  };

  const child = await session.saveSettings({
    childId: 'c1', name: '果果', studyDays: [2, 6], reminderTime: '19:30', reminderEnabled: false,
  });

  assert.equal(calls[0].name, 'syncSettings');
  assert.equal(calls[0].data.action, 'saveSettings');
  assert.deepEqual(cache.getChild(), child);
});
