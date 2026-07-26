const test = require('node:test');
const assert = require('node:assert/strict');

const storage = new Map();
const cloudCalls = [];
let subscribeResult = 'accept';

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
  async requestSubscribeMessage({ tmplIds }) {
    return { [tmplIds[0]]: subscribeResult };
  },
  cloud: {
    async callFunction(options) {
      cloudCalls.push(options);
      return global.__cloudResponse;
    },
  },
};

const cache = require('../miniprogram/utils/cache');
const subscribe = require('../miniprogram/utils/subscribe');

test.beforeEach(() => {
  storage.clear();
  cloudCalls.length = 0;
  subscribeResult = 'accept';
  global.__cloudResponse = { result: { ok: true, data: { quota: 1, idempotent: false } } };
});

test('用户接受订阅后调用 grant 并更新用户缓存', async () => {
  cache.setUser({ _id: 'u1', subscriptionQuota: 0 });

  const result = await subscribe.requestGrant('settings', { requestId: 'request-1' });

  assert.deepEqual(result, { accepted: true, quota: 1, idempotent: false });
  assert.equal(cloudCalls[0].name, 'subscriptionService');
  assert.deepEqual(cloudCalls[0].data, {
    action: 'grant', requestId: 'request-1', source: 'settings',
  });
  assert.equal(cache.getUser().subscriptionQuota, 1);
});

test('用户拒绝订阅时不调用 grant', async () => {
  subscribeResult = 'reject';

  const result = await subscribe.requestGrant('review_complete', { requestId: 'request-2' });

  assert.deepEqual(result, { accepted: false, quota: null, idempotent: false });
  assert.equal(cloudCalls.length, 0);
});

test('getQuota 查询云端并刷新用户缓存', async () => {
  cache.setUser({ _id: 'u1', subscriptionQuota: 0 });
  global.__cloudResponse = { result: { ok: true, data: { quota: 4 } } };

  assert.equal(await subscribe.getQuota(), 4);
  assert.equal(cache.getUser().subscriptionQuota, 4);
  assert.deepEqual(cloudCalls[0].data, { action: 'getQuota' });
});
