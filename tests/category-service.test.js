const test = require('node:test');
const assert = require('node:assert/strict');

const {
  DEFAULT_CATEGORY_NAMES,
  createCategoryService,
  normalizeCategoryName,
} = require('../cloudfunctions/categoryService/service');

function createMemoryRepository(seed = {}) {
  const children = (seed.children || [{
    _id: 'child-1', ownerOpenid: 'openid-1', familyId: 'family-1', status: 'active',
  }]).map((child) => ({
    familyId: child.ownerOpenid === 'openid-2' ? 'family-2' : 'family-1',
    ...child,
  }));
  const members = [...(seed.members || [
    { familyId: 'family-1', openid: 'openid-1', status: 'active' },
  ])];
  const categories = (seed.categories || []).map((category) => ({
    familyId: (children.find((child) => child._id === category.childId) || {}).familyId,
    ...category,
  }));
  const cards = (seed.cards || []).map((card) => ({
    familyId: (children.find((child) => child._id === card.childId) || {}).familyId,
    ...card,
  }));

  return {
    categories,
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
    async listCategories(familyId, childId, includeInactive = false) {
      return categories
        .filter((item) => (
          item.familyId === familyId
          && item.childId === childId
          && (includeInactive || item.status === 'active')
        ))
        .sort((a, b) => a.sortOrder - b.sortOrder || a.name.localeCompare(b.name, 'zh-CN'));
    },
    async findByNormalized(familyId, childId, normalizedName, excludeId) {
      return categories.find((item) => (
        item.familyId === familyId
        && item.childId === childId
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
    async countActiveCardReferences(familyId, childId, categoryId) {
      return cards.filter((card) => (
        card.familyId === familyId
        && card.childId === childId
        && card.status === 'active'
        && Array.isArray(card.categoryIds)
        && card.categoryIds.includes(categoryId)
      )).length;
    },
    async updateCategoryStatus(id, status) {
      const category = categories.find((item) => item._id === id);
      category.status = status;
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

  assert.deepEqual(DEFAULT_CATEGORY_NAMES, [
    '交通工具', '食品', '身体部位', '家具',
    '植物', '动物', '学习用品', '日常用品',
  ]);
  assert.deepEqual(first.map((item) => item.name), DEFAULT_CATEGORY_NAMES);
  assert.deepEqual(second.map((item) => item._id), first.map((item) => item._id));
  assert.equal(repository.categories.length, 8);
  assert.equal(first.every((item) => item.isDefault && item.status === 'active'), true);
});

test('同一家庭的其他成员可以读取和维护共享分类', async () => {
  const repository = createMemoryRepository({
    children: [{
      _id: 'child-1', ownerOpenid: 'owner-openid', familyId: 'family-1', status: 'active',
    }],
    members: [
      { familyId: 'family-1', openid: 'owner-openid', status: 'active' },
      { familyId: 'family-1', openid: 'member-openid', status: 'active' },
    ],
  });
  const service = createCategoryService(repository);

  const categories = await service.list('member-openid', { childId: 'child-1' });

  assert.equal(categories.length, DEFAULT_CATEGORY_NAMES.length);
  assert.ok(categories.every((category) => category.familyId === 'family-1'));
});

test('分类校准停用未引用旧默认分类和汽车别名并保留其他自定义分类', async () => {
  const repository = createMemoryRepository({
    categories: [
      {
        _id: 'traffic', childId: 'child-1', name: '交通工具', normalizedName: '交通工具',
        sortOrder: 0, isDefault: true, status: 'active',
      },
      {
        _id: 'fruit', childId: 'child-1', name: '水果', normalizedName: '水果',
        sortOrder: 6, isDefault: true, status: 'active',
      },
      {
        _id: 'toy', childId: 'child-1', name: '玩具', normalizedName: '玩具',
        sortOrder: 10, isDefault: true, status: 'active',
      },
      {
        _id: 'car', childId: 'child-1', name: '汽车', normalizedName: '汽车',
        sortOrder: 24, isDefault: false, status: 'active',
      },
      {
        _id: 'sport', childId: 'child-1', name: '运动', normalizedName: '运动',
        sortOrder: 25, isDefault: false, status: 'active',
      },
    ],
    cards: [{
      _id: 'card-1', childId: 'child-1', categoryIds: ['fruit'], status: 'active',
    }],
  });
  const service = createCategoryService(repository);

  const first = await service.list('openid-1', { childId: 'child-1' });
  const countAfterFirst = repository.categories.length;
  const second = await service.list('openid-1', { childId: 'child-1' });

  assert.deepEqual(first.slice(0, 8).map((item) => item.name), DEFAULT_CATEGORY_NAMES);
  assert.equal(first.some((item) => item.name === '水果'), true);
  assert.equal(first.some((item) => item.name === '汽车'), false);
  assert.equal(first.some((item) => item.name === '运动'), true);
  assert.equal(first.some((item) => item.name === '玩具'), false);
  assert.equal(repository.categories.find((item) => item._id === 'toy').status, 'inactive');
  assert.equal(repository.categories.find((item) => item._id === 'fruit').status, 'active');
  assert.equal(repository.categories.find((item) => item._id === 'car').status, 'inactive');
  assert.equal(repository.categories.find((item) => item._id === 'sport').status, 'active');
  assert.equal(repository.categories.length, countAfterFirst);
  assert.deepEqual(second.map((item) => item._id), first.map((item) => item._id));
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

test('重新新增已停用分类会恢复原记录并显示在管理列表', async () => {
  const repository = createMemoryRepository({
    categories: [
      {
        _id: 'traffic', childId: 'child-1', name: '交通工具', normalizedName: '交通工具',
        sortOrder: 0, isDefault: true, status: 'active',
      },
      {
        _id: 'fruit', childId: 'child-1', name: '水果', normalizedName: '水果',
        sortOrder: 10, isDefault: true, status: 'inactive',
      },
    ],
  });
  const service = createCategoryService(repository);

  const restored = await service.create('openid-1', {
    childId: 'child-1',
    name: '水果',
  });
  const listed = await service.list('openid-1', { childId: 'child-1' });

  assert.equal(restored._id, 'fruit');
  assert.equal(restored.status, 'active');
  assert.equal(restored.isDefault, false);
  assert.equal(repository.categories.filter((item) => item.normalizedName === '水果').length, 1);
  assert.equal(listed.some((item) => item.name === '水果'), true);
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
