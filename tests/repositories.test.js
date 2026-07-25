const test = require('node:test');
const assert = require('node:assert/strict');

const { createSyncSettingsRepository } = require('../cloudfunctions/syncSettings/repository');
const { createCardRepository } = require('../cloudfunctions/cardService/repository');

function createFakeDb(seed = {}) {
  const tables = {
    users: [...(seed.users || [])],
    children: [...(seed.children || [])],
    cards: [...(seed.cards || [])],
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
  };
}

test('syncSettings 仓储写入服务端创建和更新时间', async () => {
  const db = createFakeDb();
  const repository = createSyncSettingsRepository(db);

  const user = await repository.createUser({ openid: 'o1', status: 'active' });
  const child = await repository.createChild({ ownerOpenid: 'o1', status: 'active' });
  const updated = await repository.updateUser(user._id, { defaultChildId: child._id });

  assert.equal(user.createdAt, 'SERVER_DATE');
  assert.equal(child.updatedAt, 'SERVER_DATE');
  assert.equal(updated.defaultChildId, child._id);
});

test('cardService 仓储只列出活动字卡并写入更新时间', async () => {
  const db = createFakeDb({
    cards: [
      { _id: 'a', childId: 'c1', status: 'active' },
      { _id: 'b', childId: 'c1', status: 'deleted' },
    ],
  });
  const repository = createCardRepository(db);

  const listed = await repository.listActiveCards('c1');
  const created = await repository.createCard({ childId: 'c1', status: 'active' });
  const updated = await repository.updateCard(created._id, { proficiency: 'normal' });

  assert.deepEqual(listed.map((item) => item._id), ['a']);
  assert.equal(created.createdAt, 'SERVER_DATE');
  assert.equal(updated.updatedAt, 'SERVER_DATE');
  assert.equal(updated.proficiency, 'normal');
});
