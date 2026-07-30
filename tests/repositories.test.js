const test = require('node:test');
const assert = require('node:assert/strict');

const { createSyncSettingsRepository } = require('../cloudfunctions/syncSettings/repository');
const { createCardRepository } = require('../cloudfunctions/cardService/repository');
const { createCategoryRepository } = require('../cloudfunctions/categoryService/repository');

function createFakeDb(seed = {}) {
  const tables = {
    users: [...(seed.users || [])],
    children: [...(seed.children || [])],
    cards: [...(seed.cards || [])],
    categories: [...(seed.categories || [])],
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
  const updatedChild = await repository.updateChild(child._id, { reminderTime: '19:30' });

  assert.equal(user.createdAt, 'SERVER_DATE');
  assert.equal(child.updatedAt, 'SERVER_DATE');
  assert.equal(updated.defaultChildId, child._id);
  assert.equal(updatedChild.reminderTime, '19:30');
  assert.equal(updatedChild.updatedAt, 'SERVER_DATE');
});

test('cardService 仓储只列出活动字卡并写入更新时间', async () => {
  const db = createFakeDb({
    cards: [
      { _id: 'a', childId: 'c1', status: 'active' },
      { _id: 'b', childId: 'c1', status: 'deleted' },
    ],
    categories: [
      { _id: 'category-a', childId: 'c1', status: 'active' },
      { _id: 'category-b', childId: 'c1', status: 'active' },
    ],
  });
  const repository = createCardRepository(db);

  const listed = await repository.listActiveCards('c1');
  const categories = await repository.findCategoriesByIds(['category-b', 'missing', 'category-a']);
  const created = await repository.createCard({ childId: 'c1', status: 'active' });
  const updated = await repository.updateCard(created._id, { proficiency: 'normal' });

  assert.deepEqual(listed.map((item) => item._id), ['a']);
  assert.deepEqual(categories.map((item) => item._id), ['category-b', 'category-a']);
  assert.equal(created.createdAt, 'SERVER_DATE');
  assert.equal(updated.updatedAt, 'SERVER_DATE');
  assert.equal(updated.proficiency, 'normal');
});

test('categoryService 仓储按孩子排序分类并写入更新时间', async () => {
  const db = createFakeDb({
    categories: [
      { _id: 'b', childId: 'c1', name: '食品', sortOrder: 2, status: 'active' },
      { _id: 'a', childId: 'c1', name: '植物', sortOrder: 1, status: 'active' },
      { _id: 'x', childId: 'c1', name: '旧分类', sortOrder: 0, status: 'inactive' },
    ],
  });
  const repository = createCategoryRepository(db);

  const listed = await repository.listCategories('c1');
  const all = await repository.listCategories('c1', true);
  const created = await repository.createCategory({ childId: 'c1', name: '家具', normalizedName: '家具', sortOrder: 3, status: 'active' });
  const updated = await repository.updateCategory(created._id, { name: '家居', normalizedName: '家居' });

  assert.deepEqual(listed.map((item) => item._id), ['a', 'b']);
  assert.deepEqual(all.map((item) => item._id), ['x', 'a', 'b']);
  assert.equal(created.createdAt, 'SERVER_DATE');
  assert.equal(updated.name, '家居');
  assert.equal(updated.updatedAt, 'SERVER_DATE');
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

  const listed = await repository.listCategories('c1');
  const created = await repository.createCategory({
    childId: 'c1',
    name: '汽车',
    normalizedName: '汽车',
    sortOrder: 0,
    status: 'active',
  });

  assert.deepEqual(listed, []);
  assert.equal(created.name, '汽车');
  assert.equal(createCollectionCalls, 1);
});
