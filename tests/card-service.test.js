const test = require('node:test');
const assert = require('node:assert/strict');

const {
  createCardService,
  normalizeContent,
} = require('../cloudfunctions/cardService/service');

function createMemoryRepository(seed = {}) {
  const children = [...(seed.children || [{ _id: 'child-1', ownerOpenid: 'openid-1', status: 'active' }])];
  const cards = [...(seed.cards || [])];
  const categories = [...(seed.categories || [])];

  return {
    cards,
    async findChildById(id) {
      return children.find((item) => item._id === id) || null;
    },
    async findActiveByNormalized(childId, normalizedContent, excludeId) {
      return cards.find((item) => (
        item.childId === childId
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
    async listActiveCards(childId) {
      return cards.filter((item) => item.childId === childId && item.status === 'active');
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
  };
}

test('标准化内容会执行 NFKC、trim 并移除空白', () => {
  assert.equal(normalizeContent('  大 小  '), '大小');
  assert.equal(normalizeContent('Ａ'), 'A');
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
  assert.deepEqual(result.counts, { all: 3, due: 2, mastered: 1 });
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
