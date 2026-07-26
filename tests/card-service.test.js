const test = require('node:test');
const assert = require('node:assert/strict');

const {
  createCardService,
  normalizeContent,
} = require('../cloudfunctions/cardService/service');

function createMemoryRepository(seed = {}) {
  const children = [...(seed.children || [{ _id: 'child-1', ownerOpenid: 'openid-1', status: 'active' }])];
  const cards = [...(seed.cards || [])];

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
