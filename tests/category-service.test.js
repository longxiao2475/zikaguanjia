const test = require('node:test');
const assert = require('node:assert/strict');

const {
  DEFAULT_CATEGORY_NAMES,
  createCategoryService,
  normalizeCategoryName,
} = require('../cloudfunctions/categoryService/service');

function createMemoryRepository(seed = {}) {
  const children = [...(seed.children || [{ _id: 'child-1', ownerOpenid: 'openid-1', status: 'active' }])];
  const categories = [...(seed.categories || [])];

  return {
    categories,
    async findChildById(id) {
      return children.find((item) => item._id === id) || null;
    },
    async listCategories(childId, includeInactive = false) {
      return categories
        .filter((item) => item.childId === childId && (includeInactive || item.status === 'active'))
        .sort((a, b) => a.sortOrder - b.sortOrder || a.name.localeCompare(b.name, 'zh-CN'));
    },
    async findByNormalized(childId, normalizedName, excludeId) {
      return categories.find((item) => (
        item.childId === childId
        && item.normalizedName === normalizedName
        && item._id !== excludeId
      )) || null;
    },
    async findById(id) {
      return categories.find((item) => item._id === id) || null;
    },
    async createCategory(data) {
      const category = { _id: `category-${categories.length + 1}`, ...data };
      categories.push(category);
      return category;
    },
    async updateCategory(id, updates) {
      const category = categories.find((item) => item._id === id);
      Object.assign(category, updates);
      return category;
    },
  };
}

test('分类名称执行 NFKC、去除首尾空白并限制长度', () => {
  assert.equal(normalizeCategoryName('  Ａ类  '), 'A类');
  assert.throws(
    () => normalizeCategoryName('这是一个超过十二个字符的分类名称'),
    (error) => error.code === 'CATEGORY_NAME_TOO_LONG',
  );
});

test('首次读取为孩子生成默认分类且后续读取不会重复生成', async () => {
  const repository = createMemoryRepository();
  const service = createCategoryService(repository);

  const first = await service.list('openid-1', { childId: 'child-1' });
  const second = await service.list('openid-1', { childId: 'child-1' });

  assert.equal(DEFAULT_CATEGORY_NAMES.length, 24);
  assert.deepEqual(first.map((item) => item.name), DEFAULT_CATEGORY_NAMES);
  assert.deepEqual(second.map((item) => item._id), first.map((item) => item._id));
  assert.equal(repository.categories.length, 24);
  assert.equal(first.every((item) => item.isDefault && item.status === 'active'), true);
});

test('可以新增分类并拒绝同一孩子下标准化后重名', async () => {
  const repository = createMemoryRepository({
    categories: [{
      _id: 'category-existing',
      childId: 'child-1',
      name: '交通工具',
      normalizedName: '交通工具',
      sortOrder: 0,
      status: 'active',
    }],
  });
  const service = createCategoryService(repository);

  const created = await service.create('openid-1', { childId: 'child-1', name: '  汽车  ' });
  assert.equal(created.name, '汽车');
  assert.equal(created.normalizedName, '汽车');
  assert.equal(created.sortOrder, 1);
  assert.equal(created.isDefault, false);

  await assert.rejects(
    () => service.create('openid-1', { childId: 'child-1', name: '汽车' }),
    (error) => error.code === 'CATEGORY_DUPLICATE',
  );
});

test('可以修改所属孩子的分类名称并阻止越权修改', async () => {
  const repository = createMemoryRepository({
    categories: [
      { _id: 'category-1', childId: 'child-1', name: '汽车', normalizedName: '汽车', sortOrder: 0, status: 'active' },
      { _id: 'category-2', childId: 'child-2', name: '食品', normalizedName: '食品', sortOrder: 0, status: 'active' },
    ],
    children: [
      { _id: 'child-1', ownerOpenid: 'openid-1', status: 'active' },
      { _id: 'child-2', ownerOpenid: 'openid-2', status: 'active' },
    ],
  });
  const service = createCategoryService(repository);

  const updated = await service.update('openid-1', {
    childId: 'child-1',
    categoryId: 'category-1',
    name: '交通工具',
  });
  assert.equal(updated.name, '交通工具');

  await assert.rejects(
    () => service.update('openid-1', {
      childId: 'child-1',
      categoryId: 'category-2',
      name: '零食',
    }),
    (error) => error.code === 'CATEGORY_NOT_FOUND',
  );
  await assert.rejects(
    () => service.list('openid-2', { childId: 'child-1' }),
    (error) => error.code === 'CHILD_FORBIDDEN',
  );
});
