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
