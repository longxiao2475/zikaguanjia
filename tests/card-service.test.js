const test = require('node:test');
const assert = require('node:assert/strict');

const {
  createCardService,
  normalizeContent,
} = require('../cloudfunctions/cardService/service');

function createMemoryRepository(seed = {}) {
  const children = [...(seed.children || [{
    _id: 'child-1', ownerOpenid: 'openid-1', familyId: 'family-1', status: 'active',
  }])];
  const members = [...(seed.members || [{
    _id: 'member-1', familyId: 'family-1', openid: 'openid-1', status: 'active',
  }])];
  const getChildFamily = (childId) => (
    children.find((child) => child._id === childId) || {}
  ).familyId;
  const cards = (seed.cards || []).map((card) => ({
    familyId: getChildFamily(card.childId),
    ...card,
  }));
  const categories = (seed.categories || []).map((category) => ({
    familyId: getChildFamily(category.childId),
    ...category,
  }));
  const assignments = [...(seed.assignments || [])];

  return {
    cards,
    assignments,
    async findFamilyAccess(openid, childId) {
      const child = children.find((item) => item._id === childId) || null;
      const member = child && members.find((item) => (
        item.familyId === child.familyId && item.openid === openid && item.status === 'active'
      ));
      return child && member ? { child, member, familyId: child.familyId } : null;
    },
    async findChildById(id) {
      return children.find((item) => item._id === id) || null;
    },
    async findActiveByNormalized(familyId, childId, normalizedContent, excludeId) {
      return cards.find((item) => (
        item.familyId === familyId
        && item.childId === childId
        && item.normalizedContent === normalizedContent
        && item.status === 'active'
        && item._id !== excludeId
      )) || null;
    },
    async createCard(data) {
      const card = { _id: `card-${cards.length + 1}`, ...data };
      cards.push(card);
      return card;
    },
    async listActiveCards(familyId, childId) {
      return cards.filter((item) => (
        item.familyId === familyId && item.childId === childId && item.status === 'active'
      ));
    },
    async findCardById(id) {
      return cards.find((item) => item._id === id) || null;
    },
    async updateCard(id, updates) {
      const card = cards.find((item) => item._id === id);
      Object.assign(card, updates);
      return card;
    },
    async findCategoriesByIds(ids) {
      return ids.map((id) => categories.find((item) => item._id === id) || null).filter(Boolean);
    },
    async addReviewAssignments(data) {
      let addedCount = 0;
      let existingCount = 0;
      for (const cardId of data.cardIds) {
        const existing = assignments.find((item) => (
          item.familyId === data.familyId
          && item.childId === data.childId
          && item.cardId === cardId
          && item.scheduledDate === data.scheduledDate
          && item.status === 'pending'
        ));
        if (existing) {
          existingCount += 1;
          continue;
        }
        assignments.push({
          _id: `assignment-${assignments.length + 1}`,
          ...data,
          cardIds: undefined,
          cardId,
          source: 'manual',
          status: 'pending',
        });
        addedCount += 1;
      }
      return { addedCount, existingCount };
    },
    async listPendingReviewAssignments(familyId, childId, scheduledDate) {
      return assignments.filter((item) => (
        item.familyId === familyId
        && item.childId === childId
        && item.status === 'pending'
        && item.scheduledDate <= scheduledDate
      ));
    },
  };
}

test('标准化内容会执行 NFKC、trim 并移除空白', () => {
  assert.equal(normalizeContent('  大 小  '), '大小');
  assert.equal(normalizeContent('Ａ'), 'A');
});

test('不同家庭可以拥有同名字卡且复习状态彼此独立', async () => {
  const repository = createMemoryRepository({
    children: [
      { _id: 'child-1', familyId: 'family-1', status: 'active' },
      { _id: 'child-2', familyId: 'family-2', status: 'active' },
    ],
    members: [
      { familyId: 'family-1', openid: 'openid-1', status: 'active' },
      { familyId: 'family-2', openid: 'openid-2', status: 'active' },
    ],
  });
  const service = createCardService(repository);

  const familyOne = await service.create('openid-1', {
    childId: 'child-1', content: '苹果', source: 'new',
  });
  const familyTwo = await service.create('openid-2', {
    childId: 'child-2', content: '苹果', source: 'reviewed',
  });

  assert.notEqual(familyOne._id, familyTwo._id);
  assert.equal(familyOne.familyId, 'family-1');
  assert.equal(familyTwo.familyId, 'family-2');
  assert.equal(familyOne.proficiency, 'unfamiliar');
  assert.equal(familyTwo.proficiency, 'normal');
});

test('家庭成员不能按 id 读取另一个家庭的字卡', async () => {
  const repository = createMemoryRepository({
    children: [
      { _id: 'child-1', familyId: 'family-1', status: 'active' },
      { _id: 'child-2', familyId: 'family-2', status: 'active' },
    ],
    members: [
      { familyId: 'family-1', openid: 'openid-1', status: 'active' },
      { familyId: 'family-2', openid: 'openid-2', status: 'active' },
    ],
    cards: [
      { _id: 'family-1-card', familyId: 'family-1', childId: 'child-1', status: 'active' },
      { _id: 'family-2-card', familyId: 'family-2', childId: 'child-2', status: 'active' },
    ],
  });
  const service = createCardService(repository);

  const cards = await service.getByIds('openid-2', {
    childId: 'child-2', cardIds: ['family-1-card', 'family-2-card'],
  });

  assert.deepEqual(cards.map((card) => card._id), ['family-2-card']);
});

test('新学字卡默认不熟，已学过字卡默认一般', async () => {
  const repository = createMemoryRepository();
  const service = createCardService(repository, { now: () => new Date('2026-07-25T04:00:00.000Z') });

  const learned = await service.create('openid-1', { childId: 'child-1', content: '大', source: 'new' });
  const reviewed = await service.create('openid-1', { childId: 'child-1', content: '小', source: 'reviewed' });

  assert.equal(learned.proficiency, 'unfamiliar');
  assert.equal(reviewed.proficiency, 'normal');
  assert.equal(learned.type, 'char');
  assert.deepEqual(learned.categoryIds, []);
});

test('创建和更新字卡会保存去重后的分类并校验归属', async () => {
  const repository = createMemoryRepository({
    categories: [
      { _id: 'category-1', childId: 'child-1', status: 'active' },
      { _id: 'category-2', childId: 'child-1', status: 'active' },
      { _id: 'category-foreign', childId: 'child-2', status: 'active' },
      { _id: 'category-inactive', childId: 'child-1', status: 'inactive' },
    ],
  });
  const service = createCardService(repository);

  const created = await service.create('openid-1', {
    childId: 'child-1',
    content: '汽车',
    source: 'new',
    categoryIds: ['category-1', 'category-1', 'category-2'],
  });
  assert.deepEqual(created.categoryIds, ['category-1', 'category-2']);

  const updated = await service.update('openid-1', {
    childId: 'child-1',
    cardId: created._id,
    categoryIds: ['category-2'],
  });
  assert.deepEqual(updated.categoryIds, ['category-2']);

  await assert.rejects(
    () => service.create('openid-1', {
      childId: 'child-1',
      content: '公交车',
      categoryIds: ['category-foreign'],
    }),
    (error) => error.code === 'CATEGORY_INVALID',
  );
  await assert.rejects(
    () => service.update('openid-1', {
      childId: 'child-1',
      cardId: created._id,
      categoryIds: ['category-inactive'],
    }),
    (error) => error.code === 'CATEGORY_INVALID',
  );
});

test('同一孩子不能重复创建活动字卡', async () => {
  const repository = createMemoryRepository();
  const service = createCardService(repository);

  await service.create('openid-1', { childId: 'child-1', content: '大', source: 'new' });
  await assert.rejects(
    () => service.create('openid-1', { childId: 'child-1', content: ' 大 ', source: 'new' }),
    (error) => error.code === 'CARD_DUPLICATE',
  );
});

test('今日计划按调度规则返回统计和总览', async () => {
  const repository = createMemoryRepository({
    cards: [
      { _id: 'u1', childId: 'child-1', normalizedContent: '大', status: 'active', proficiency: 'unfamiliar', lastReviewAt: null },
      { _id: 'n1', childId: 'child-1', normalizedContent: '小', status: 'active', proficiency: 'normal', lastReviewAt: '2026-07-23T04:00:00.000Z' },
      { _id: 'p1', childId: 'child-1', normalizedContent: '人', status: 'active', proficiency: 'proficient', lastReviewAt: '2026-07-24T04:00:00.000Z' },
    ],
  });
  const service = createCardService(repository, { now: () => new Date('2026-07-25T04:00:00.000Z') });

  const result = await service.getTodayPlan('openid-1', { childId: 'child-1' });

  assert.deepEqual(result.cards.map((card) => card._id), ['u1', 'n1']);
  assert.deepEqual(result.stats, { total: 2, unfamiliar: 1, normal: 1, proficient: 0 });
  assert.deepEqual(result.overview, { total: 3, mastered: 1, due: 2 });
});

test('选择字卡会加入家庭孩子维度的今日任务且重复添加保持幂等', async () => {
  const repository = createMemoryRepository({
    cards: [
      { _id: 'recent', childId: 'child-1', status: 'active', proficiency: 'proficient', lastReviewAt: '2026-07-25T03:00:00.000Z' },
      { _id: 'other-family', familyId: 'family-2', childId: 'child-2', status: 'active', proficiency: 'normal' },
    ],
  });
  const service = createCardService(repository, {
    now: () => new Date('2026-07-25T04:00:00.000Z'),
  });

  const first = await service.addReviewAssignments('openid-1', {
    childId: 'child-1', cardIds: ['recent'],
  });
  const second = await service.addReviewAssignments('openid-1', {
    childId: 'child-1', cardIds: ['recent'],
  });

  assert.deepEqual(first, { addedCount: 1, existingCount: 0, scheduledDate: '2026-07-25' });
  assert.deepEqual(second, { addedCount: 0, existingCount: 1, scheduledDate: '2026-07-25' });
  assert.equal(repository.assignments[0].familyId, 'family-1');
  assert.equal(repository.assignments[0].addedByOpenid, 'openid-1');
  await assert.rejects(
    () => service.addReviewAssignments('openid-1', {
      childId: 'child-1', cardIds: ['other-family'],
    }),
    (error) => error.code === 'CARD_NOT_FOUND',
  );
});

test('今日计划合并自动到期和手动任务并按字卡 id 去重', async () => {
  const repository = createMemoryRepository({
    cards: [
      { _id: 'automatic', childId: 'child-1', status: 'active', proficiency: 'unfamiliar', lastReviewAt: null },
      { _id: 'manual-only', childId: 'child-1', status: 'active', proficiency: 'proficient', lastReviewAt: '2026-07-25T03:00:00.000Z' },
    ],
    assignments: [
      { _id: 'a1', familyId: 'family-1', childId: 'child-1', cardId: 'automatic', scheduledDate: '2026-07-25', status: 'pending' },
      { _id: 'a2', familyId: 'family-1', childId: 'child-1', cardId: 'manual-only', scheduledDate: '2026-07-25', status: 'pending' },
    ],
  });
  const service = createCardService(repository, {
    now: () => new Date('2026-07-25T04:00:00.000Z'),
  });

  const result = await service.getTodayPlan('openid-1', { childId: 'child-1' });

  assert.deepEqual(result.cards.map((card) => card._id), ['automatic', 'manual-only']);
  assert.equal(result.cards[0].reviewSource, 'automatic');
  assert.equal(result.cards[1].reviewSource, 'manual');
  assert.equal(result.overview.due, 2);
});

test('人工加入且已自动到期的字卡优先显示且不重复', async () => {
  const cards = Array.from({ length: 8 }, (_, index) => ({
    _id: `automatic-${index + 1}`,
    childId: 'child-1',
    status: 'active',
    proficiency: 'unfamiliar',
    lastReviewAt: null,
  }));
  const repository = createMemoryRepository({
    cards,
    assignments: [{
      _id: 'assignment-1',
      familyId: 'family-1',
      childId: 'child-1',
      cardId: 'automatic-8',
      scheduledDate: '2026-07-25',
      status: 'pending',
    }],
  });
  const service = createCardService(repository, {
    now: () => new Date('2026-07-25T04:00:00.000Z'),
  });

  const result = await service.getTodayPlan('openid-1', { childId: 'child-1' });

  assert.equal(result.cards[0]._id, 'automatic-8');
  assert.equal(result.cards[0].reviewSource, 'automatic');
  assert.equal(result.cards.length, 8);
});

test('已学过但从未复习的字卡进入今日计划', async () => {
  const repository = createMemoryRepository({
    cards: [
      {
        _id: 'history-1',
        childId: 'child-1',
        normalizedContent: '合作',
        status: 'active',
        proficiency: 'normal',
        lastReviewAt: null,
      },
    ],
  });
  const service = createCardService(repository, {
    now: () => new Date('2026-07-25T04:00:00.000Z'),
  });

  const result = await service.getTodayPlan('openid-1', { childId: 'child-1' });

  assert.deepEqual(result.cards.map((card) => card._id), ['history-1']);
});

test('列表支持待复习和已掌握筛选并返回数量', async () => {
  const repository = createMemoryRepository({
    cards: [
      { _id: 'u1', childId: 'child-1', status: 'active', proficiency: 'unfamiliar', lastReviewAt: null },
      { _id: 'p1', childId: 'child-1', status: 'active', proficiency: 'proficient', lastReviewAt: '2026-07-24T04:00:00.000Z' },
    ],
  });
  const service = createCardService(repository, { now: () => new Date('2026-07-25T04:00:00.000Z') });

  const due = await service.list('openid-1', { childId: 'child-1', filter: 'due' });
  const mastered = await service.list('openid-1', { childId: 'child-1', filter: 'mastered' });

  assert.deepEqual(due.items.map((card) => card._id), ['u1']);
  assert.deepEqual(mastered.items.map((card) => card._id), ['p1']);
  assert.deepEqual(due.counts, { all: 2, due: 1, mastered: 1 });
});

test('列表按标准化后的汉字片段搜索并叠加筛选', async () => {
  const repository = createMemoryRepository({
    cards: [
      { _id: 'a', childId: 'child-1', content: '礼物', normalizedContent: '礼物', status: 'active', proficiency: 'unfamiliar', lastReviewAt: null },
      { _id: 'b', childId: 'child-1', content: '合作', normalizedContent: '合作', status: 'active', proficiency: 'normal', lastReviewAt: '2026-07-23T04:00:00.000Z' },
      { _id: 'c', childId: 'child-1', content: '吃饭', normalizedContent: '吃饭', status: 'active', proficiency: 'proficient', lastReviewAt: '2026-07-24T04:00:00.000Z' },
    ],
  });
  const service = createCardService(repository, {
    now: () => new Date('2026-07-25T04:00:00.000Z'),
  });

  const result = await service.list('openid-1', {
    childId: 'child-1',
    filter: 'due',
    keyword: ' 礼 ',
    page: 1,
    pageSize: 20,
  });

  assert.deepEqual(result.items.map((card) => card._id), ['a']);
  assert.equal(result.total, 1);
  assert.deepEqual(result.counts, { all: 1, due: 1, mastered: 0 });
});

test('列表按未复习天数筛选并包含从未复习字卡', async () => {
  const repository = createMemoryRepository({
    cards: [
      { _id: 'never', childId: 'child-1', content: '从未', normalizedContent: '从未', status: 'active', proficiency: 'normal', lastReviewAt: null },
      { _id: 'day-6', childId: 'child-1', content: '六天', normalizedContent: '六天', status: 'active', proficiency: 'normal', lastReviewAt: '2026-07-24T04:00:00.000Z' },
      { _id: 'day-7', childId: 'child-1', content: '七天', normalizedContent: '七天', status: 'active', proficiency: 'normal', lastReviewAt: '2026-07-23T04:00:00.000Z' },
      { _id: 'day-29', childId: 'child-1', content: '二十九天', normalizedContent: '二十九天', status: 'active', proficiency: 'normal', lastReviewAt: '2026-07-01T04:00:00.000Z' },
      { _id: 'day-30', childId: 'child-1', content: '三十天', normalizedContent: '三十天', status: 'active', proficiency: 'normal', lastReviewAt: '2026-06-30T04:00:00.000Z' },
    ],
  });
  const service = createCardService(repository, {
    now: () => new Date('2026-07-30T04:00:00.000Z'),
  });

  const sevenDays = await service.list('openid-1', {
    childId: 'child-1',
    reviewAgeDays: 7,
  });
  const thirtyDays = await service.list('openid-1', {
    childId: 'child-1',
    reviewAgeDays: 30,
  });
  const invalid = await service.list('openid-1', {
    childId: 'child-1',
    reviewAgeDays: 14,
  });

  assert.deepEqual(sevenDays.items.map((card) => card._id), [
    'never', 'day-30', 'day-29', 'day-7',
  ]);
  assert.deepEqual(thirtyDays.items.map((card) => card._id), ['never', 'day-30']);
  assert.equal(invalid.total, 5);
});

test('状态数量随名称分类和未复习时间范围动态计算', async () => {
  const repository = createMemoryRepository({
    cards: [
      { _id: 'never-apple', childId: 'child-1', content: '苹果', normalizedContent: '苹果', categoryIds: ['food'], status: 'active', proficiency: 'proficient', lastReviewAt: null },
      { _id: 'old-juice', childId: 'child-1', content: '果汁', normalizedContent: '果汁', categoryIds: ['food'], status: 'active', proficiency: 'normal', lastReviewAt: '2026-07-20T04:00:00.000Z' },
      { _id: 'recent-apple', childId: 'child-1', content: '苹果树', normalizedContent: '苹果树', categoryIds: ['food'], status: 'active', proficiency: 'proficient', lastReviewAt: '2026-07-24T04:00:00.000Z' },
      { _id: 'plant-banana', childId: 'child-1', content: '香蕉', normalizedContent: '香蕉', categoryIds: ['plant'], status: 'active', proficiency: 'proficient', lastReviewAt: '2026-07-01T04:00:00.000Z' },
    ],
  });
  const service = createCardService(repository, {
    now: () => new Date('2026-07-30T04:00:00.000Z'),
  });

  const result = await service.list('openid-1', {
    childId: 'child-1',
    filter: 'mastered',
    keyword: '果',
    categoryIds: ['food'],
    reviewAgeDays: 7,
  });

  assert.deepEqual(result.items.map((card) => card._id), ['never-apple']);
  assert.deepEqual(result.counts, { all: 2, due: 2, mastered: 1 });
});

test('列表分类多选使用 OR 并可同时包含未分类字卡', async () => {
  const repository = createMemoryRepository({
    cards: [
      { _id: 'a', childId: 'child-1', content: '汽车', normalizedContent: '汽车', categoryIds: ['traffic'], status: 'active', proficiency: 'unfamiliar', lastReviewAt: null },
      { _id: 'b', childId: 'child-1', content: '苹果', normalizedContent: '苹果', categoryIds: ['food', 'plant'], status: 'active', proficiency: 'normal', lastReviewAt: null },
      { _id: 'c', childId: 'child-1', content: '桌子', normalizedContent: '桌子', categoryIds: ['furniture'], status: 'active', proficiency: 'proficient', lastReviewAt: null },
      { _id: 'd', childId: 'child-1', content: '测试', normalizedContent: '测试', status: 'active', proficiency: 'unfamiliar', lastReviewAt: null },
    ],
  });
  const service = createCardService(repository);

  const selected = await service.list('openid-1', {
    childId: 'child-1',
    categoryIds: ['traffic', 'plant'],
  });
  assert.deepEqual(selected.items.map((card) => card._id), ['a', 'b']);
  assert.deepEqual(selected.counts, { all: 2, due: 2, mastered: 0 });

  const withUncategorized = await service.list('openid-1', {
    childId: 'child-1',
    categoryIds: ['furniture'],
    includeUncategorized: true,
  });
  assert.deepEqual(withUncategorized.items.map((card) => card._id), ['d', 'c']);
  assert.deepEqual(withUncategorized.counts, { all: 2, due: 2, mastered: 1 });
});

test('分类筛选允许覆盖全部默认分类而不受字卡分类数量上限影响', async () => {
  const selectedCategoryIds = Array.from({ length: 12 }, (_, index) => `category-${index + 1}`);
  const repository = createMemoryRepository({
    cards: [
      { _id: 'target', childId: 'child-1', categoryIds: ['category-12'], status: 'active', proficiency: 'unfamiliar', lastReviewAt: null },
      { _id: 'other', childId: 'child-1', categoryIds: ['other'], status: 'active', proficiency: 'unfamiliar', lastReviewAt: null },
    ],
  });
  const service = createCardService(repository);

  const result = await service.list('openid-1', {
    childId: 'child-1',
    categoryIds: selectedCategoryIds,
  });

  assert.deepEqual(result.items.map((card) => card._id), ['target']);
});

test('按 ID 补查只返回当前孩子的活动字卡并保持请求顺序', async () => {
  const repository = createMemoryRepository({
    cards: [
      { _id: 'a', ownerOpenid: 'openid-1', childId: 'child-1', status: 'active', content: '礼' },
      { _id: 'b', ownerOpenid: 'openid-1', childId: 'child-1', status: 'deleted', content: '物' },
      { _id: 'c', ownerOpenid: 'openid-1', childId: 'other-child', status: 'active', content: '吃' },
      { _id: 'd', ownerOpenid: 'openid-1', childId: 'child-1', status: 'active', content: '饭' },
    ],
  });
  const service = createCardService(repository);

  const result = await service.getByIds('openid-1', {
    childId: 'child-1',
    cardIds: ['d', 'b', 'a', 'a', 'c'],
  });

  assert.deepEqual(result.map((card) => card._id), ['d', 'a']);
  await assert.rejects(
    () => service.getByIds('openid-1', {
      childId: 'child-1',
      cardIds: Array.from({ length: 51 }, (_, index) => `card-${index}`),
    }),
    (error) => error.code === 'CARD_IDS_TOO_MANY',
  );
});

test('删除字卡采用软删除并校验归属', async () => {
  const repository = createMemoryRepository({
    cards: [{ _id: 'card-1', ownerOpenid: 'openid-1', childId: 'child-1', status: 'active', proficiency: 'unfamiliar' }],
  });
  const service = createCardService(repository);

  const deleted = await service.remove('openid-1', { childId: 'child-1', cardId: 'card-1' });
  assert.equal(deleted.status, 'deleted');

  const otherService = createCardService(createMemoryRepository());
  await assert.rejects(
    () => otherService.create('another-openid', { childId: 'child-1', content: '大', source: 'new' }),
    (error) => error.code === 'CHILD_FORBIDDEN',
  );
});
