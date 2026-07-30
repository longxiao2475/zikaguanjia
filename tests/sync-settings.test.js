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
    async updateChild(id, updates) {
      const child = children.find((item) => item._id === id);
      Object.assign(child, updates);
      return child;
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

test('saveSettings 标准化昵称、认字日和提醒设置', async () => {
  const repository = createMemoryRepository({
    users: [{ _id: 'u1', openid: 'openid-1', defaultChildId: 'c1', subscriptionQuota: 2, status: 'active' }],
    children: [{ _id: 'c1', ownerOpenid: 'openid-1', name: '', status: 'active' }],
  });
  const service = createSyncSettingsService(repository);

  const child = await service.saveSettings('openid-1', {
    childId: 'c1',
    name: ' 果果 ',
    studyDays: [6, 2, 2],
    reminderTime: '19:00',
    reminderEnabled: false,
  });

  assert.equal(child.name, '果果');
  assert.deepEqual(child.studyDays, [2, 6]);
  assert.equal(child.reminderTime, '19:00');
  assert.equal(child.reminderEnabled, false);
});

test('saveSettings 拒绝空认字日、非法时间、过长昵称和越权孩子', async () => {
  const repository = createMemoryRepository({
    children: [{ _id: 'c1', ownerOpenid: 'openid-1', status: 'active' }],
  });
  const service = createSyncSettingsService(repository);
  const valid = {
    childId: 'c1', name: '', studyDays: [2], reminderTime: '20:00', reminderEnabled: true,
  };

  await assert.rejects(
    () => service.saveSettings('openid-1', { ...valid, studyDays: [] }),
    (error) => error.code === 'STUDY_DAYS_REQUIRED',
  );
  await assert.rejects(
    () => service.saveSettings('openid-1', { ...valid, reminderTime: '25:00' }),
    (error) => error.code === 'REMINDER_TIME_INVALID',
  );
  await assert.rejects(
    () => service.saveSettings('openid-1', { ...valid, reminderTime: '19:30' }),
    (error) => error.code === 'REMINDER_TIME_INVALID',
  );
  await assert.rejects(
    () => service.saveSettings('openid-1', { ...valid, name: '一二三四五六七八九十一二三' }),
    (error) => error.code === 'CHILD_NAME_TOO_LONG',
  );
  await assert.rejects(
    () => service.saveSettings('other-openid', valid),
    (error) => error.code === 'CHILD_FORBIDDEN',
  );
});
