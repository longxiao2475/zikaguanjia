const test = require('node:test');
const assert = require('node:assert/strict');

const { createSubscriptionService } = require('../cloudfunctions/subscriptionService/service');

function codedError(code) {
  const error = new Error(code);
  error.code = code;
  return error;
}

function createMemoryRepository(seed = {}) {
  const users = [...(seed.users || [
    { _id: 'user-1', openid: 'openid-1', subscriptionQuota: 0, status: 'active' },
  ])];
  const events = [...(seed.events || [])];

  return {
    users,
    events,
    async getQuota(openid) {
      const user = users.find((item) => item.openid === openid && item.status === 'active');
      if (!user) throw codedError('USER_NOT_FOUND');
      return Number(user.subscriptionQuota || 0);
    },
    async grant({ openid, requestId, source, templateId }) {
      const existing = events.find((item) => item.ownerOpenid === openid && item.requestId === requestId);
      if (existing) {
        return { quota: existing.balanceAfter, event: existing, idempotent: true };
      }
      const user = users.find((item) => item.openid === openid && item.status === 'active');
      if (!user) throw codedError('USER_NOT_FOUND');
      user.subscriptionQuota = Number(user.subscriptionQuota || 0) + 1;
      const event = {
        _id: `event-${events.length + 1}`,
        ownerOpenid: openid,
        type: 'grant',
        delta: 1,
        balanceAfter: user.subscriptionQuota,
        templateId,
        source,
        requestId,
        reminderLogId: null,
      };
      events.push(event);
      return { quota: user.subscriptionQuota, event, idempotent: false };
    },
  };
}

test('getQuota 返回当前用户额度', async () => {
  const service = createSubscriptionService(createMemoryRepository({
    users: [{ _id: 'u1', openid: 'openid-1', subscriptionQuota: 3, status: 'active' }],
  }));

  assert.deepEqual(await service.getQuota('openid-1'), { quota: 3 });
});

test('grant 使用 requestId 幂等增加一次额度并写流水', async () => {
  const repository = createMemoryRepository();
  const service = createSubscriptionService(repository);

  const first = await service.grant('openid-1', { requestId: 'request-1', source: 'review_complete' });
  const second = await service.grant('openid-1', { requestId: 'request-1', source: 'review_complete' });

  assert.equal(first.quota, 1);
  assert.equal(first.idempotent, false);
  assert.equal(second.quota, 1);
  assert.equal(second.idempotent, true);
  assert.equal(repository.users[0].subscriptionQuota, 1);
  assert.equal(repository.events.length, 1);
  assert.equal(repository.events[0].type, 'grant');
  assert.equal(repository.events[0].delta, 1);
});

test('grant 拒绝空 requestId 和空 openid', async () => {
  const service = createSubscriptionService(createMemoryRepository());
  await assert.rejects(
    () => service.grant('openid-1', { requestId: '', source: 'settings' }),
    (error) => error.code === 'REQUEST_ID_REQUIRED',
  );
  await assert.rejects(
    () => service.getQuota(''),
    (error) => error.code === 'OPENID_REQUIRED',
  );
});

