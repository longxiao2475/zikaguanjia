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
  cache.setFamily({ _id: 'f1' });
  cache.setMember({ _id: 'm1', familyId: 'f1' });
  cache.setChild({ _id: 'c1' });
  cache.setCards([{ _id: 'card1' }]);
  cache.setCategories([{ _id: 'category1', name: '植物' }]);
  cache.setTodayPlan({ cards: [{ _id: 'card1' }] });
  cache.setLastSyncAt(123);

  assert.deepEqual(cache.getUser(), { _id: 'u1' });
  assert.deepEqual(cache.getFamily(), { _id: 'f1' });
  assert.deepEqual(cache.getMember(), { _id: 'm1', familyId: 'f1' });
  assert.deepEqual(cache.getChild(), { _id: 'c1' });
  assert.deepEqual(cache.getCards(), [{ _id: 'card1' }]);
  assert.deepEqual(cache.getCategories(), [{ _id: 'category1', name: '植物' }]);
  assert.deepEqual(cache.getTodayPlan(), { cards: [{ _id: 'card1' }] });
  assert.equal(cache.getLastSyncAt(), 123);
});

test('家庭变化后不会读取上一家庭的字卡分类和今日计划', () => {
  cache.setFamily({ _id: 'family-1' });
  cache.setCards([{ _id: 'card-1' }]);
  cache.setCategories([{ _id: 'category-1' }]);
  cache.setTodayPlan({ cards: [{ _id: 'card-1' }] });

  cache.setFamily({ _id: 'family-2' });

  assert.deepEqual(cache.getCards(), []);
  assert.deepEqual(cache.getCategories(), []);
  assert.equal(cache.getTodayPlan(), null);
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
    mode: 'append',
    createdAt: 1000,
  });
  cache.clearManualReviewQueue();
  assert.equal(cache.getManualReviewQueue(1001), null);

  cache.setManualReviewQueue(['a'], 1000);
  assert.equal(cache.getManualReviewQueue(1000 + 31 * 60 * 1000), null);
});

test('临时复习队列保存 replace 模式并将旧队列兼容为 append', () => {
  cache.setManualReviewQueue(['a', 'b'], 1000, 'replace');
  assert.deepEqual(cache.getManualReviewQueue(1001), {
    cardIds: ['a', 'b'],
    mode: 'replace',
    createdAt: 1000,
  });

  storage.set(cache.KEYS.manualReviewQueue, { cardIds: ['old'], createdAt: 1000 });
  assert.equal(cache.getManualReviewQueue(1001).mode, 'append');
});

test('非法队列模式按 append 处理', () => {
  cache.setManualReviewQueue(['a'], 1000, 'unknown');
  assert.equal(cache.getManualReviewQueue(1001).mode, 'append');
});
