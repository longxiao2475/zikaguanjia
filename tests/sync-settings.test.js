const test = require('node:test');
const assert = require('node:assert/strict');

const { createSyncSettingsService } = require('../cloudfunctions/syncSettings/service');

function createMemoryRepository(seed = {}) {
  const users = [...(seed.users || [])];
  const children = [...(seed.children || [])];

  return {
    users,
    children,
    async findUserByOpenid(openid) {
      return users.find((item) => item.openid === openid) || null;
    },
    async createUser(data) {
      const user = { _id: `user-${users.length + 1}`, ...data };
      users.push(user);
      return user;
    },
    async findChildById(id) {
      return children.find((item) => item._id === id) || null;
    },
    async findActiveChildByOwner(openid) {
      return children.find((item) => item.ownerOpenid === openid && item.status === 'active') || null;
    },
    async createChild(data) {
      const child = { _id: `child-${children.length + 1}`, ...data };
      children.push(child);
      return child;
    },
    async updateUser(id, updates) {
      const user = users.find((item) => item._id === id);
      Object.assign(user, updates);
      return user;
    },
  };
}

test('首次 bootstrap 创建用户和默认孩子并建立关联', async () => {
  const repository = createMemoryRepository();
  const service = createSyncSettingsService(repository);

  const result = await service.bootstrap('openid-1');

  assert.equal(result.user.openid, 'openid-1');
  assert.equal(result.user.defaultChildId, result.child._id);
  assert.equal(result.user.subscriptionQuota, 0);
  assert.deepEqual(result.child.studyDays, [2, 4, 6]);
  assert.equal(result.child.reminderTime, '20:00');
  assert.equal(result.child.ownerOpenid, 'openid-1');
});

test('重复 bootstrap 复用已存在用户和孩子', async () => {
  const repository = createMemoryRepository({
    users: [{ _id: 'u1', openid: 'openid-1', defaultChildId: 'c1', subscriptionQuota: 2, status: 'active' }],
    children: [{ _id: 'c1', ownerOpenid: 'openid-1', name: '果果', status: 'active' }],
  });
  const service = createSyncSettingsService(repository);

  const result = await service.bootstrap('openid-1');

  assert.equal(repository.users.length, 1);
  assert.equal(repository.children.length, 1);
  assert.equal(result.child.name, '果果');
});

test('拒绝空 openid', async () => {
  const service = createSyncSettingsService(createMemoryRepository());
  await assert.rejects(() => service.bootstrap(''), /OPENID_REQUIRED/);
});
