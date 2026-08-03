const test = require('node:test');
const assert = require('node:assert/strict');

const { createSyncSettingsService } = require('../cloudfunctions/syncSettings/service');

function createMemoryRepository(seed = {}) {
  const users = [...(seed.users || [])];
  const children = [...(seed.children || [])];
  const families = [...(seed.families || [])];
  const members = [...(seed.members || [])];
  const cards = [...(seed.cards || [])];
  const categories = [...(seed.categories || [])];
  const reviewSessions = [...(seed.reviewSessions || [])];
  const reminderLogs = [...(seed.reminderLogs || [])];
  const reviewAssignments = [...(seed.reviewAssignments || [])];

  return {
    users,
    children,
    families,
    members,
    cards,
    categories,
    reviewSessions,
    reminderLogs,
    reviewAssignments,
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
    async findFamilyById(id) {
      return families.find((item) => item._id === id) || null;
    },
    async findLegacyFamilyByCreator(openid) {
      return families.find((item) => item.createdByOpenid === openid && item.status === 'active') || null;
    },
    async createFamily(data) {
      const family = { _id: `family-${families.length + 1}`, ...data };
      families.push(family);
      return family;
    },
    async findActiveMember(familyId, openid) {
      return members.find((item) => (
        item.familyId === familyId && item.openid === openid && item.status === 'active'
      )) || null;
    },
    async createMember(data) {
      const member = { _id: `member-${members.length + 1}`, ...data };
      members.push(member);
      return member;
    },
    async updateMember(id, updates) {
      const member = members.find((item) => item._id === id);
      Object.assign(member, updates);
      return member;
    },
    async listActiveChildrenByOwner(openid) {
      return children.filter((item) => item.ownerOpenid === openid && item.status === 'active');
    },
    async listActiveChildrenByFamily(familyId) {
      return children.filter((item) => item.familyId === familyId && item.status === 'active');
    },
    async backfillChildrenFamily(openid, familyId) {
      children
        .filter((item) => item.ownerOpenid === openid && item.status === 'active')
        .forEach((item) => { item.familyId = familyId; });
    },
    async backfillCardsFamily(childIds, familyId) {
      cards
        .filter((item) => childIds.includes(item.childId))
        .forEach((item) => { item.familyId = familyId; });
    },
    async backfillCategoriesFamily(childIds, familyId) {
      categories
        .filter((item) => childIds.includes(item.childId))
        .forEach((item) => { item.familyId = familyId; });
    },
    async backfillReviewSessionsFamily(childIds, familyId) {
      reviewSessions
        .filter((item) => childIds.includes(item.childId))
        .forEach((item) => { item.familyId = familyId; });
    },
    async backfillReminderLogsFamily(childIds, familyId) {
      reminderLogs
        .filter((item) => childIds.includes(item.childId))
        .forEach((item) => { item.familyId = familyId; });
    },
    async backfillReviewAssignmentsFamily(childIds, familyId) {
      reviewAssignments
        .filter((item) => childIds.includes(item.childId))
        .forEach((item) => { item.familyId = familyId; });
    },
    async countActiveCards(childIds, familyId) {
      return cards.filter((item) => (
        childIds.includes(item.childId) && item.familyId === familyId && item.status === 'active'
      )).length;
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

test('bootstrap 原地迁移现有孩子和 69 张字卡并让原微信成为家庭 owner', async () => {
  const cards = Array.from({ length: 69 }, (_, index) => ({
    _id: `card-${index + 1}`,
    ownerOpenid: 'openid-owner',
    childId: 'child-existing',
    content: `字${index + 1}`,
    proficiency: index % 2 ? 'normal' : 'unfamiliar',
    reviewCount: index,
    status: 'active',
  }));
  const originalIds = cards.map((card) => card._id);
  const repository = createMemoryRepository({
    users: [{
      _id: 'user-existing', openid: 'openid-owner', defaultChildId: 'child-existing',
      subscriptionQuota: 2, status: 'active',
    }],
    children: [{
      _id: 'child-existing', ownerOpenid: 'openid-owner', name: '果果', status: 'active',
    }],
    cards,
  });
  const service = createSyncSettingsService(repository);

  const result = await service.bootstrap('openid-owner');

  assert.equal(result.child._id, 'child-existing');
  assert.equal(result.family.createdByOpenid, 'openid-owner');
  assert.equal(result.member.role, 'owner');
  assert.equal(result.member.openid, 'openid-owner');
  assert.equal(result.migration.activeCardCount, 69);
  assert.deepEqual(repository.cards.map((card) => card._id), originalIds);
  assert.ok(repository.cards.every((card) => card.familyId === result.family._id));
  assert.equal(result.user.activeFamilyId, result.family._id);
  assert.equal(result.user.familyMigrationVersion, 1);
});

test('重复 bootstrap 复用同一个家庭和成员且不会重复迁移字卡', async () => {
  const repository = createMemoryRepository({
    users: [{ _id: 'u1', openid: 'openid-1', defaultChildId: 'c1', status: 'active' }],
    children: [{ _id: 'c1', ownerOpenid: 'openid-1', status: 'active' }],
    cards: [{ _id: 'card-1', childId: 'c1', status: 'active', reviewCount: 3 }],
  });
  const service = createSyncSettingsService(repository);

  const first = await service.bootstrap('openid-1');
  const second = await service.bootstrap('openid-1');

  assert.equal(second.family._id, first.family._id);
  assert.equal(repository.families.length, 1);
  assert.equal(repository.members.length, 1);
  assert.equal(repository.cards.length, 1);
  assert.equal(repository.cards[0].reviewCount, 3);
});

test('加入家庭后的成员 bootstrap 使用目标家庭孩子而不再按 ownerOpenid 误判', async () => {
  const repository = createMemoryRepository({
    users: [{
      _id: 'joiner-user', openid: 'joiner-openid', activeFamilyId: 'target-family',
      defaultChildId: 'source-child', status: 'active',
    }],
    families: [{ _id: 'target-family', createdByOpenid: 'owner-openid', status: 'active' }],
    members: [{
      _id: 'joiner-member', familyId: 'target-family', openid: 'joiner-openid',
      role: 'member', status: 'active', reminderTime: '20:00', reminderEnabled: true,
    }],
    children: [
      {
        _id: 'target-child', familyId: 'target-family', ownerOpenid: 'owner-openid',
        name: '果果', status: 'active',
      },
      {
        _id: 'source-child', familyId: 'source-family', ownerOpenid: 'joiner-openid',
        status: 'merged', mergedIntoChildId: 'target-child',
      },
    ],
    cards: [{
      _id: 'target-card', familyId: 'target-family', childId: 'target-child', status: 'active',
    }],
  });
  const service = createSyncSettingsService(repository);

  const result = await service.bootstrap('joiner-openid');

  assert.equal(result.child._id, 'target-child');
  assert.equal(result.child.ownerOpenid, 'owner-openid');
  assert.equal(result.member.role, 'member');
  assert.equal(result.user.defaultChildId, 'target-child');
  assert.equal(repository.children.length, 2);
  assert.equal(repository.families.length, 1);
});

test('拒绝空 openid', async () => {
  const service = createSyncSettingsService(createMemoryRepository());
  await assert.rejects(() => service.bootstrap(''), /OPENID_REQUIRED/);
});

test('saveSettings 标准化昵称、认字日和提醒设置', async () => {
  const repository = createMemoryRepository({
    users: [{
      _id: 'u1', openid: 'openid-1', activeFamilyId: 'f1', defaultChildId: 'c1',
      subscriptionQuota: 2, status: 'active',
    }],
    families: [{ _id: 'f1', createdByOpenid: 'openid-1', status: 'active' }],
    members: [{
      _id: 'm1', familyId: 'f1', openid: 'openid-1', role: 'owner', status: 'active',
      reminderTime: '20:00', reminderEnabled: true,
    }],
    children: [{ _id: 'c1', familyId: 'f1', ownerOpenid: 'openid-1', name: '', status: 'active' }],
  });
  const service = createSyncSettingsService(repository);

  const result = await service.saveSettings('openid-1', {
    childId: 'c1',
    name: ' 果果 ',
    studyDays: [6, 2, 2],
    reminderTime: '19:00',
    reminderEnabled: false,
  });

  assert.equal(result.child.name, '果果');
  assert.deepEqual(result.child.studyDays, [2, 6]);
  assert.equal(result.member.reminderTime, '19:00');
  assert.equal(result.member.reminderEnabled, false);
  assert.equal(result.child.reminderTime, undefined);
});

test('saveSettings 拒绝空认字日、非法时间、过长昵称和越权孩子', async () => {
  const repository = createMemoryRepository({
    users: [{ _id: 'u1', openid: 'openid-1', activeFamilyId: 'f1', status: 'active' }],
    families: [{ _id: 'f1', createdByOpenid: 'openid-1', status: 'active' }],
    members: [{ _id: 'm1', familyId: 'f1', openid: 'openid-1', status: 'active' }],
    children: [{ _id: 'c1', familyId: 'f1', ownerOpenid: 'openid-1', status: 'active' }],
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
