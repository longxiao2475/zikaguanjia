const test = require('node:test');
const assert = require('node:assert/strict');

const storage = new Map();
const calls = [];

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
  cloud: {
    async callFunction(options) {
      calls.push(options);
      return global.__cloudResponse;
    },
  },
};

const cache = require('../miniprogram/utils/cache');
const { callFunction } = require('../miniprogram/utils/cloud');
const session = require('../miniprogram/utils/session');
const cardApi = require('../miniprogram/utils/card');
const categoryApi = require('../miniprogram/utils/category');
const reviewApi = require('../miniprogram/utils/review-api');

test.beforeEach(() => {
  storage.clear();
  calls.length = 0;
  global.__cloudResponse = { result: { ok: true, data: {} } };
});

test('统一云调用返回 data 并保留业务错误码', async () => {
  global.__cloudResponse = { result: { ok: true, data: { value: 1 } } };
  assert.deepEqual(await callFunction('demo', { action: 'read' }), { value: 1 });

  global.__cloudResponse = { result: { ok: false, error: { code: 'DEMO_ERROR', message: '失败' } } };
  await assert.rejects(
    () => callFunction('demo', {}),
    (error) => error.code === 'DEMO_ERROR' && error.message === '失败',
  );
});

test('bootstrap 缓存用户、孩子和同步时间', async () => {
  global.__cloudResponse = {
    result: {
      ok: true,
      data: {
        user: { _id: 'u1', activeFamilyId: 'f1' },
        family: { _id: 'f1' },
        member: { _id: 'm1', familyId: 'f1' },
        child: { _id: 'c1', familyId: 'f1' },
      },
    },
  };

  const result = await session.bootstrap();

  assert.equal(calls[0].name, 'syncSettings');
  assert.deepEqual(calls[0].data, { action: 'bootstrap' });
  assert.deepEqual(cache.getUser(), { _id: 'u1', activeFamilyId: 'f1' });
  assert.deepEqual(cache.getFamily(), { _id: 'f1' });
  assert.deepEqual(cache.getMember(), { _id: 'm1', familyId: 'f1' });
  assert.deepEqual(cache.getChild(), { _id: 'c1', familyId: 'f1' });
  assert.equal(typeof cache.getLastSyncAt(), 'number');
  assert.deepEqual(result.child, { _id: 'c1', familyId: 'f1' });
});

test('bootstrap 切换家庭时清理上一家庭业务缓存', async () => {
  cache.setFamily({ _id: 'family-1' });
  cache.setCards([{ _id: 'old-card' }]);
  cache.setCategories([{ _id: 'old-category' }]);
  cache.setTodayPlan({ cards: [{ _id: 'old-card' }] });
  global.__cloudResponse = {
    result: {
      ok: true,
      data: {
        user: { _id: 'u1', activeFamilyId: 'family-2' },
        family: { _id: 'family-2' },
        member: { _id: 'member-2', familyId: 'family-2' },
        child: { _id: 'child-2', familyId: 'family-2' },
      },
    },
  };

  await session.bootstrap();

  assert.deepEqual(cache.getCards(), []);
  assert.deepEqual(cache.getCategories(), []);
  assert.equal(cache.getTodayPlan(), null);
  assert.equal(cache.getFamily()._id, 'family-2');
});

test('创建字卡后追加本地缓存，获取今日计划后覆盖计划缓存', async () => {
  cache.setCards([{ _id: 'old' }]);
  global.__cloudResponse = { result: { ok: true, data: { _id: 'new', content: '大' } } };

  await cardApi.createCard({ childId: 'c1', content: '大', source: 'new' });
  assert.deepEqual(cache.getCards().map((item) => item._id), ['old', 'new']);

  global.__cloudResponse = {
    result: { ok: true, data: { cards: [{ _id: 'new' }], overview: { total: 1, mastered: 0, due: 1 } } },
  };
  const plan = await cardApi.getTodayPlan('c1');
  assert.deepEqual(cache.getTodayPlan(), plan);
});

test('首页第一页全部列表会覆盖字卡缓存', async () => {
  global.__cloudResponse = {
    result: { ok: true, data: { items: [{ _id: 'a' }], page: 1, hasMore: false } },
  };

  await cardApi.listCards({ childId: 'c1', filter: 'all', page: 1 });
  assert.deepEqual(cache.getCards(), [{ _id: 'a' }]);

  cache.setCards([{ _id: 'keep' }]);
  global.__cloudResponse = {
    result: { ok: true, data: { items: [{ _id: 'filtered' }], page: 1, hasMore: false } },
  };
  await cardApi.listCards({ childId: 'c1', filter: 'all', categoryIds: ['traffic'], page: 1 });
  assert.deepEqual(cache.getCards(), [{ _id: 'keep' }]);

  global.__cloudResponse = {
    result: { ok: true, data: { items: [{ _id: 'old' }], page: 1, hasMore: false } },
  };
  await cardApi.listCards({ childId: 'c1', filter: 'all', reviewAgeDays: 7, page: 1 });
  assert.equal(calls.at(-1).data.reviewAgeDays, 7);
  assert.deepEqual(cache.getCards(), [{ _id: 'keep' }]);
});

test('分类 API 列出、新增和改名后更新本地缓存', async () => {
  global.__cloudResponse = {
    result: { ok: true, data: [{ _id: 'category-1', name: '植物' }] },
  };
  const listed = await categoryApi.listCategories('c1');
  assert.deepEqual(calls[0], {
    name: 'categoryService',
    data: { action: 'list', childId: 'c1' },
  });
  assert.deepEqual(cache.getCategories(), listed);

  global.__cloudResponse = {
    result: { ok: true, data: { _id: 'category-2', name: '汽车' } },
  };
  await categoryApi.createCategory({ childId: 'c1', name: '汽车' });
  assert.deepEqual(cache.getCategories().map((item) => item._id), ['category-1', 'category-2']);

  global.__cloudResponse = {
    result: { ok: true, data: { _id: 'category-2', name: '交通工具' } },
  };
  await categoryApi.updateCategory({ childId: 'c1', categoryId: 'category-2', name: '交通工具' });
  assert.equal(cache.getCategories()[1].name, '交通工具');
});

test('搜索列表透传 keyword，按 ID 补查调用 getByIds', async () => {
  cache.setCards([{ _id: 'keep' }]);
  global.__cloudResponse = { result: { ok: true, data: { items: [] } } };
  await cardApi.listCards({ childId: 'c1', filter: 'all', keyword: '礼', page: 1 });
  assert.equal(calls[0].data.keyword, '礼');
  assert.deepEqual(cache.getCards(), [{ _id: 'keep' }]);

  global.__cloudResponse = { result: { ok: true, data: [{ _id: 'a' }] } };
  const cards = await cardApi.getCardsByIds('c1', ['a']);
  assert.deepEqual(calls[1].data, {
    action: 'getByIds',
    childId: 'c1',
    cardIds: ['a'],
  });
  assert.deepEqual(cards, [{ _id: 'a' }]);
});

test('完成复习后合并返回字卡并废弃今日计划缓存', async () => {
  cache.setCards([
    { _id: 'a', proficiency: 'unfamiliar' },
    { _id: 'b', proficiency: 'normal' },
  ]);
  cache.setTodayPlan({ cards: [{ _id: 'a' }] });
  global.__cloudResponse = {
    result: {
      ok: true,
      data: {
        session: { _id: 's1' },
        cards: [{ _id: 'a', proficiency: 'proficient', reviewCount: 1 }],
      },
    },
  };

  const result = await reviewApi.completeReview({
    childId: 'c1',
    items: [{ cardId: 'a', proficiency: 'proficient' }],
  });

  assert.equal(calls[0].name, 'reviewService');
  assert.deepEqual(calls[0].data, {
    action: 'complete',
    childId: 'c1',
    items: [{ cardId: 'a', proficiency: 'proficient' }],
  });
  assert.deepEqual(cache.getCards(), [
    { _id: 'a', proficiency: 'proficient', reviewCount: 1 },
    { _id: 'b', proficiency: 'normal' },
  ]);
  assert.equal(cache.getTodayPlan(), null);
  assert.equal(result.session._id, 's1');
});

test('保存共享孩子设置和个人提醒后分别更新缓存', async () => {
  cache.setChild({ _id: 'c1', reminderTime: '20:00' });
  global.__cloudResponse = {
    result: {
      ok: true,
      data: {
        child: { _id: 'c1', familyId: 'f1', name: '果果', studyDays: [2, 6] },
        member: {
          _id: 'm1', familyId: 'f1', reminderTime: '19:00', reminderEnabled: false,
        },
      },
    },
  };

  const result = await session.saveSettings({
    childId: 'c1', name: '果果', studyDays: [2, 6], reminderTime: '19:00', reminderEnabled: false,
  });

  assert.equal(calls[0].name, 'syncSettings');
  assert.equal(calls[0].data.action, 'saveSettings');
  assert.deepEqual(cache.getChild(), result.child);
  assert.deepEqual(cache.getMember(), result.member);
});

test('家庭 API 生成邀请码并获取加入预览', async () => {
  global.__cloudResponse = {
    result: { ok: true, data: { code: 'ABCD2345', expiresAt: '2026-08-04T00:00:00.000Z' } },
  };
  const invite = await session.createFamilyInvite();
  assert.equal(invite.code, 'ABCD2345');
  assert.deepEqual(calls[0].data, { action: 'createFamilyInvite' });

  global.__cloudResponse = {
    result: { ok: true, data: { familyName: '果果家庭', duplicateCardCount: 2 } },
  };
  const preview = await session.previewFamilyJoin(' abcd-2345 ');
  assert.equal(preview.familyName, '果果家庭');
  assert.deepEqual(calls[1].data, {
    action: 'previewFamilyJoin',
    code: ' abcd-2345 ',
  });
});
