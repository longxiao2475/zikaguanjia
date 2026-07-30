const test = require('node:test');
const assert = require('node:assert/strict');

const storage = new Map();

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
};

const cache = require('../miniprogram/utils/cache');

test.beforeEach(() => {
  storage.clear();
});

test('读写用户、孩子、字卡、分类和今日计划缓存', () => {
  cache.setUser({ _id: 'u1' });
  cache.setChild({ _id: 'c1' });
  cache.setCards([{ _id: 'card1' }]);
  cache.setCategories([{ _id: 'category1', name: '植物' }]);
  cache.setTodayPlan({ cards: [{ _id: 'card1' }] });
  cache.setLastSyncAt(123);

  assert.deepEqual(cache.getUser(), { _id: 'u1' });
  assert.deepEqual(cache.getChild(), { _id: 'c1' });
  assert.deepEqual(cache.getCards(), [{ _id: 'card1' }]);
  assert.deepEqual(cache.getCategories(), [{ _id: 'category1', name: '植物' }]);
  assert.deepEqual(cache.getTodayPlan(), { cards: [{ _id: 'card1' }] });
  assert.equal(cache.getLastSyncAt(), 123);
});

test('清理业务缓存不会删除其他 Storage', () => {
  storage.set('unrelated:key', 'keep');
  cache.setUser({ _id: 'u1' });
  cache.setCards([{ _id: 'card1' }]);
  cache.setCategories([{ _id: 'category1' }]);

  cache.clearBusinessCache();

  assert.equal(storage.get('unrelated:key'), 'keep');
  assert.equal(cache.getUser(), null);
  assert.deepEqual(cache.getCards(), []);
  assert.deepEqual(cache.getCategories(), []);
});

test('字卡库筛选意图只消费一次', () => {
  cache.setLibraryFilterIntent('due');
  assert.equal(cache.consumeLibraryFilterIntent(), 'due');
  assert.equal(cache.consumeLibraryFilterIntent(), null);
  cache.setLibraryFilterIntent('invalid');
  assert.equal(cache.consumeLibraryFilterIntent(), null);
});

test('临时复习队列校验时效并由调用方成功后清除', () => {
  cache.setManualReviewQueue(['a', 'a', 'b'], 1000);
  assert.deepEqual(cache.getManualReviewQueue(1000 + 29 * 60 * 1000), {
    cardIds: ['a', 'b'],
    createdAt: 1000,
  });
  cache.clearManualReviewQueue();
  assert.equal(cache.getManualReviewQueue(1001), null);

  cache.setManualReviewQueue(['a'], 1000);
  assert.equal(cache.getManualReviewQueue(1000 + 31 * 60 * 1000), null);
});
