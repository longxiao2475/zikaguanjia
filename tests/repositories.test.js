const test = require('node:test');
const assert = require('node:assert/strict');

const { createSyncSettingsRepository } = require('../cloudfunctions/syncSettings/repository');
const { createCardRepository } = require('../cloudfunctions/cardService/repository');
const { createCategoryRepository } = require('../cloudfunctions/categoryService/repository');
const { createReviewRepository } = require('../cloudfunctions/reviewService/repository');

function createFakeDb(seed = {}) {
  const tables = {
    users: [...(seed.users || [])],
    children: [...(seed.children || [])],
    cards: [...(seed.cards || [])],
    categories: [...(seed.categories || [])],
    families: [...(seed.families || [])],
    family_members: [...(seed.family_members || [])],
    family_invites: [...(seed.family_invites || [])],
    family_merge_jobs: [...(seed.family_merge_jobs || [])],
    review_sessions: [...(seed.review_sessions || [])],
    reminder_logs: [...(seed.reminder_logs || [])],
    review_assignments: [...(seed.review_assignments || [])],
  };

  function matches(item, query) {
    return Object.entries(query || {}).every(([key, value]) => item[key] === value);
  }

  function collection(name) {
    const state = { query: {}, skip: 0, limit: Infinity };
    const api = {
      where(query) {
        state.query = query;
        return api;
      },
      skip(value) {
        state.skip = value;
        return api;
      },
      limit(value) {
        state.limit = value;
        return api;
      },
      async get() {
        return {
          data: tables[name].filter((item) => matches(item, state.query)).slice(state.skip, state.skip + state.limit),
        };
      },
      async add({ data }) {
        const doc = { _id: `${name}-${tables[name].length + 1}`, ...data };
        tables[name].push(doc);
        return { _id: doc._id };
      },
      doc(id) {
        return {
          async get() {
            return { data: tables[name].find((item) => item._id === id) || null };
          },
          async update({ data }) {
            const doc = tables[name].find((item) => item._id === id);
            Object.assign(doc, data);
            return { stats: { updated: 1 } };
          },
        };
      },
    };
    return api;
  }

  return {
    tables,
    collection,
    serverDate: () => 'SERVER_DATE',
    command: { inc: (value) => ({ __inc: value }) },
    async runTransaction(handler) {
      return handler(this);
    },
  };
}

test('syncSettings 仓储写入服务端创建和更新时间', async () => {
  const db = createFakeDb();
  const repository = createSyncSettingsRepository(db);

  const user = await repository.createUser({ openid: 'o1', status: 'active' });
  const child = await repository.createChild({ ownerOpenid: 'o1', status: 'active' });
  const updated = await repository.updateUser(user._id, { defaultChildId: child._id });
  const updatedChild = await repository.updateChild(child._id, { reminderTime: '19:30' });

  assert.equal(user.createdAt, 'SERVER_DATE');
  assert.equal(child.updatedAt, 'SERVER_DATE');
  assert.equal(updated.defaultChildId, child._id);
  assert.equal(updatedChild.reminderTime, '19:30');
  assert.equal(updatedChild.updatedAt, 'SERVER_DATE');
});

test('syncSettings 仓储原地补齐家庭归属且不改变现有记录 id', async () => {
  const db = createFakeDb({
    users: [{ _id: 'user-1', openid: 'openid-1', status: 'active' }],
    children: [{ _id: 'child-1', ownerOpenid: 'openid-1', status: 'active' }],
    cards: [
      { _id: 'card-1', childId: 'child-1', status: 'active', reviewCount: 4 },
      { _id: 'card-2', childId: 'child-1', status: 'deleted' },
    ],
    categories: [{ _id: 'category-1', childId: 'child-1', status: 'active' }],
    review_sessions: [{ _id: 'review-1', childId: 'child-1', status: 'completed' }],
    reminder_logs: [{ _id: 'reminder-1', childId: 'child-1', status: 'sent' }],
  });
  const repository = createSyncSettingsRepository(db);

  const family = await repository.createFamily({
    name: '我的家庭', createdByOpenid: 'openid-1', status: 'active',
  });
  const member = await repository.createMember({
    familyId: family._id, openid: 'openid-1', role: 'owner', status: 'active',
  });
  const updatedMember = await repository.updateMember(member._id, {
    reminderTime: '19:00', reminderEnabled: false,
  });
  await repository.backfillChildrenFamily('openid-1', family._id);
  await repository.backfillCardsFamily(['child-1'], family._id);
  await repository.backfillCategoriesFamily(['child-1'], family._id);
  await repository.backfillReviewSessionsFamily(['child-1'], family._id);
  await repository.backfillReminderLogsFamily(['child-1'], family._id);

  assert.equal(member.createdAt, 'SERVER_DATE');
  assert.equal(updatedMember.reminderTime, '19:00');
  assert.equal(updatedMember.reminderEnabled, false);
  assert.equal(updatedMember.updatedAt, 'SERVER_DATE');
  assert.equal(db.tables.children[0]._id, 'child-1');
  assert.equal(db.tables.children[0].familyId, family._id);
  assert.equal(db.tables.cards[0]._id, 'card-1');
  assert.equal(db.tables.cards[0].reviewCount, 4);
  assert.equal(db.tables.cards[0].familyId, family._id);
  assert.equal(db.tables.categories[0].familyId, family._id);
  assert.equal(db.tables.review_sessions[0].familyId, family._id);
  assert.equal(db.tables.reminder_logs[0].familyId, family._id);
  assert.equal(await repository.countActiveCards(['child-1'], family._id), 1);
  assert.equal((await repository.findActiveMember(family._id, 'openid-1')).role, 'owner');
});

test('syncSettings 仓储管理家庭邀请码和家庭数据摘要', async () => {
  const db = createFakeDb({
    families: [{ _id: 'family-1', status: 'active' }],
    family_members: [
      { _id: 'member-1', familyId: 'family-1', openid: 'openid-1', status: 'active' },
      { _id: 'member-old', familyId: 'family-1', openid: 'openid-old', status: 'inactive' },
    ],
    children: [{ _id: 'child-1', familyId: 'family-1', status: 'active' }],
    cards: [{ _id: 'card-1', familyId: 'family-1', childId: 'child-1', status: 'active' }],
    categories: [{ _id: 'category-1', familyId: 'family-1', childId: 'child-1', status: 'active' }],
    family_invites: [{
      _id: 'invite-old', familyId: 'family-1', codeDigest: 'old', status: 'active',
    }],
  });
  const repository = createSyncSettingsRepository(db);

  await repository.expireActiveInvites('family-1');
  const invite = await repository.createInvite({
    familyId: 'family-1', codeDigest: 'new', status: 'active', maxUses: 1, usedCount: 0,
  });

  assert.equal(db.tables.family_invites[0].status, 'expired');
  assert.equal((await repository.findInviteByDigest('new'))._id, invite._id);
  assert.equal(await repository.countActiveMembers('family-1'), 1);
  assert.deepEqual((await repository.listActiveChildrenByFamily('family-1')).map((item) => item._id), ['child-1']);
  assert.deepEqual((await repository.listActiveCardsByFamily('family-1')).map((item) => item._id), ['card-1']);
  assert.deepEqual((await repository.listActiveCategoriesByFamily('family-1')).map((item) => item._id), ['category-1']);
});

test('syncSettings 仓储幂等合并家庭并保留目标进度和来源独有字卡 id', async () => {
  const db = createFakeDb({
    users: [{
      _id: 'joining-user', openid: 'joining-openid', activeFamilyId: 'source-family',
      defaultChildId: 'source-child', status: 'active',
    }],
    families: [
      { _id: 'source-family', status: 'active' },
      { _id: 'target-family', status: 'active' },
    ],
    family_members: [{
      _id: 'source-member', familyId: 'source-family', openid: 'joining-openid',
      role: 'owner', reminderTime: '19:00', reminderEnabled: true, status: 'active',
    }],
    children: [
      { _id: 'source-child', familyId: 'source-family', status: 'active' },
      { _id: 'target-child', familyId: 'target-family', status: 'active' },
    ],
    categories: [
      { _id: 'source-food', familyId: 'source-family', childId: 'source-child', normalizedName: '食品', status: 'active' },
      { _id: 'source-fruit', familyId: 'source-family', childId: 'source-child', normalizedName: '水果', status: 'active' },
      { _id: 'target-food', familyId: 'target-family', childId: 'target-child', normalizedName: '食品', status: 'active' },
    ],
    cards: [
      {
        _id: 'source-apple', familyId: 'source-family', childId: 'source-child',
        normalizedContent: '苹果', proficiency: 'unfamiliar', reviewCount: 1,
        customWords: ['苹果树'], categoryIds: ['source-food'], status: 'active',
      },
      {
        _id: 'source-banana', familyId: 'source-family', childId: 'source-child',
        normalizedContent: '香蕉', proficiency: 'normal', reviewCount: 2,
        categoryIds: ['source-fruit'], status: 'active',
      },
      {
        _id: 'target-apple', familyId: 'target-family', childId: 'target-child',
        normalizedContent: '苹果', proficiency: 'proficient', reviewCount: 9,
        customWords: ['苹果汁'], categoryIds: ['target-food'], status: 'active',
      },
    ],
    review_sessions: [{
      _id: 'source-session', familyId: 'source-family', childId: 'source-child', status: 'completed',
      items: [{ cardId: 'source-apple' }, { cardId: 'source-banana' }],
    }],
    review_assignments: [
      {
        _id: 'source-assignment-apple', familyId: 'source-family', childId: 'source-child',
        cardId: 'source-apple', scheduledDate: '2026-08-03', status: 'pending',
      },
      {
        _id: 'source-assignment-banana', familyId: 'source-family', childId: 'source-child',
        cardId: 'source-banana', scheduledDate: '2026-08-03', status: 'pending',
      },
      {
        _id: 'target-assignment-apple', familyId: 'target-family', childId: 'target-child',
        cardId: 'target-apple', scheduledDate: '2026-08-03', status: 'pending',
      },
    ],
    family_invites: [{
      _id: 'invite-1', familyId: 'target-family', status: 'active', maxUses: 1, usedCount: 0,
    }],
  });
  const repository = createSyncSettingsRepository(db);
  const payload = {
    requestId: 'request-1',
    requestedByOpenid: 'joining-openid',
    sourceFamilyId: 'source-family',
    targetFamilyId: 'target-family',
    sourceChildId: 'source-child',
    targetChildId: 'target-child',
    inviteId: 'invite-1',
  };

  const first = await repository.mergeFamilies(payload);
  const second = await repository.mergeFamilies(payload);

  assert.deepEqual(second, first);
  assert.equal(db.tables.cards.find((card) => card._id === 'target-apple').proficiency, 'proficient');
  assert.equal(db.tables.cards.find((card) => card._id === 'target-apple').reviewCount, 9);
  assert.deepEqual(
    db.tables.cards.find((card) => card._id === 'target-apple').customWords.sort(),
    ['苹果树', '苹果汁'].sort(),
  );
  assert.equal(db.tables.cards.find((card) => card._id === 'source-apple').status, 'merged');
  assert.equal(db.tables.cards.find((card) => card._id === 'source-banana').familyId, 'target-family');
  assert.equal(db.tables.cards.find((card) => card._id === 'source-banana')._id, 'source-banana');
  assert.deepEqual(db.tables.review_sessions[0].items.map((item) => item.cardId), [
    'target-apple', 'source-banana',
  ]);
  assert.equal(db.tables.review_assignments.find((item) => (
    item._id === 'source-assignment-apple'
  )).status, 'merged');
  assert.equal(db.tables.review_assignments.find((item) => (
    item._id === 'source-assignment-banana'
  )).familyId, 'target-family');
  assert.equal(db.tables.review_assignments.find((item) => (
    item._id === 'source-assignment-banana'
  )).cardId, 'source-banana');
  assert.equal(db.tables.users[0].activeFamilyId, 'target-family');
  assert.equal(db.tables.users[0].defaultChildId, 'target-child');
  assert.equal(db.tables.children.find((child) => child._id === 'source-child').status, 'merged');
  assert.equal(
    db.tables.children.find((child) => child._id === 'source-child').mergedIntoChildId,
    'target-child',
  );
  assert.equal(db.tables.family_members.filter((item) => item.status === 'active').length, 1);
  assert.equal(db.tables.family_invites[0].status, 'used');
  assert.equal((await repository.findMergeResult('joining-openid', 'request-1')).familyId, 'target-family');
});

test('cardService 仓储只列出活动字卡并写入更新时间', async () => {
  const db = createFakeDb({
    users: [{ _id: 'user-1', openid: 'openid-1', activeFamilyId: 'family-1', status: 'active' }],
    children: [{ _id: 'c1', familyId: 'family-1', status: 'active' }],
    family_members: [{
      _id: 'member-1', familyId: 'family-1', openid: 'openid-1', status: 'active',
    }],
    cards: [
      { _id: 'a', familyId: 'family-1', childId: 'c1', status: 'active' },
      { _id: 'b', familyId: 'family-1', childId: 'c1', status: 'deleted' },
      { _id: 'foreign', familyId: 'family-2', childId: 'c1', status: 'active' },
    ],
    categories: [
      { _id: 'category-a', childId: 'c1', status: 'active' },
      { _id: 'category-b', childId: 'c1', status: 'active' },
    ],
  });
  const repository = createCardRepository(db);

  const access = await repository.findFamilyAccess('openid-1', 'c1');
  const listed = await repository.listActiveCards('family-1', 'c1');
  const categories = await repository.findCategoriesByIds(['category-b', 'missing', 'category-a']);
  const created = await repository.createCard({ familyId: 'family-1', childId: 'c1', status: 'active' });
  const updated = await repository.updateCard(created._id, { proficiency: 'normal' });

  assert.equal(access.familyId, 'family-1');
  assert.deepEqual(listed.map((item) => item._id), ['a']);
  assert.deepEqual(categories.map((item) => item._id), ['category-b', 'category-a']);
  assert.equal(created.createdAt, 'SERVER_DATE');
  assert.equal(updated.updatedAt, 'SERVER_DATE');
  assert.equal(updated.proficiency, 'normal');
});

test('reviewService 仓储在复习事务中完成到期的手动任务', async () => {
  const db = createFakeDb({
    users: [{ _id: 'user-1', openid: 'openid-1', activeFamilyId: 'family-1', status: 'active' }],
    children: [{ _id: 'child-1', familyId: 'family-1', status: 'active' }],
    family_members: [{ _id: 'member-1', familyId: 'family-1', openid: 'openid-1', status: 'active' }],
    cards: [{
      _id: 'card-1', familyId: 'family-1', childId: 'child-1', content: '大',
      proficiency: 'unfamiliar', reviewCount: 0, status: 'active',
    }],
    review_assignments: [{
      _id: 'assignment-1', familyId: 'family-1', childId: 'child-1', cardId: 'card-1',
      scheduledDate: '2026-07-26', source: 'manual', status: 'pending',
    }],
  });
  const repository = createReviewRepository(db);

  const result = await repository.completeReview({
    openid: 'openid-1', childId: 'child-1', bizDate: '2026-07-26',
    items: [{ cardId: 'card-1', proficiency: 'normal' }],
  });

  assert.equal(result.session.familyId, 'family-1');
  assert.equal(db.tables.review_assignments[0].status, 'completed');
  assert.equal(db.tables.review_assignments[0].completedByOpenid, 'openid-1');
  assert.equal(db.tables.review_assignments[0].completedSessionId, result.session._id);
});

test('categoryService 仓储按孩子排序分类并写入更新时间', async () => {
  const db = createFakeDb({
    users: [{ _id: 'user-1', openid: 'openid-1', activeFamilyId: 'family-1', status: 'active' }],
    children: [{ _id: 'c1', familyId: 'family-1', status: 'active' }],
    family_members: [{ familyId: 'family-1', openid: 'openid-1', status: 'active' }],
    categories: [
      { _id: 'b', familyId: 'family-1', childId: 'c1', name: '食品', sortOrder: 2, status: 'active' },
      { _id: 'a', familyId: 'family-1', childId: 'c1', name: '植物', sortOrder: 1, status: 'active' },
      { _id: 'x', familyId: 'family-1', childId: 'c1', name: '旧分类', sortOrder: 0, status: 'inactive' },
    ],
    cards: [
      { _id: 'card-a', familyId: 'family-1', childId: 'c1', categoryIds: ['a'], status: 'active' },
      { _id: 'card-b', familyId: 'family-1', childId: 'c1', categoryIds: ['a'], status: 'deleted' },
    ],
  });
  const repository = createCategoryRepository(db);

  const access = await repository.findFamilyAccess('openid-1', 'c1');
  const listed = await repository.listCategories('family-1', 'c1');
  const all = await repository.listCategories('family-1', 'c1', true);
  const created = await repository.createCategory({ familyId: 'family-1', childId: 'c1', name: '家具', normalizedName: '家具', sortOrder: 3, status: 'active' });
  const updated = await repository.updateCategory(created._id, { name: '家居', normalizedName: '家居' });
  const references = await repository.countActiveCardReferences('family-1', 'c1', 'a');
  const inactive = await repository.updateCategoryStatus(created._id, 'inactive');

  assert.equal(access.familyId, 'family-1');
  assert.deepEqual(listed.map((item) => item._id), ['a', 'b']);
  assert.deepEqual(all.map((item) => item._id), ['x', 'a', 'b']);
  assert.equal(created.createdAt, 'SERVER_DATE');
  assert.equal(updated.name, '家居');
  assert.equal(updated.updatedAt, 'SERVER_DATE');
  assert.equal(references, 1);
  assert.equal(inactive.status, 'inactive');
});

test('categoryService 仓储首次访问时自动创建缺失的 categories 集合', async () => {
  let categoriesExists = false;
  let createCollectionCalls = 0;
  const categories = [];
  const missingCollectionError = () => {
    const error = new Error('database collection not exists: categories');
    error.errCode = -502005;
    return error;
  };
  const db = {
    collection(name) {
      if (name === 'children') {
        return {
          doc() {
            return { async get() { return { data: null }; } };
          },
        };
      }
      const state = { query: {}, skip: 0, limit: Infinity };
      const api = {
        where(query) {
          state.query = query;
          return api;
        },
        skip(value) {
          state.skip = value;
          return api;
        },
        limit(value) {
          state.limit = value;
          return api;
        },
        async get() {
          if (!categoriesExists) throw missingCollectionError();
          return {
            data: categories
              .filter((item) => item.childId === state.query.childId)
              .slice(state.skip, state.skip + state.limit),
          };
        },
        async add({ data }) {
          if (!categoriesExists) throw missingCollectionError();
          const category = { _id: `category-${categories.length + 1}`, ...data };
          categories.push(category);
          return { _id: category._id };
        },
        doc(id) {
          return {
            async get() {
              if (!categoriesExists) throw missingCollectionError();
              return { data: categories.find((item) => item._id === id) || null };
            },
          };
        },
      };
      return api;
    },
    async createCollection(name) {
      assert.equal(name, 'categories');
      createCollectionCalls += 1;
      categoriesExists = true;
    },
    serverDate: () => 'SERVER_DATE',
  };
  const repository = createCategoryRepository(db);

  const listed = await repository.listCategories('family-1', 'c1');
  const created = await repository.createCategory({
    familyId: 'family-1', childId: 'c1',
    name: '汽车',
    normalizedName: '汽车',
    sortOrder: 0,
    status: 'active',
  });

  assert.deepEqual(listed, []);
  assert.equal(created.name, '汽车');
  assert.equal(createCollectionCalls, 1);
});
