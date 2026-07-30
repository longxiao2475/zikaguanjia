const DEFAULT_CATEGORY_NAMES = Object.freeze([
  '交通工具',
  '食品',
  '身体部位',
  '家具',
  '植物',
  '动物',
  '学习用品',
  '日常用品',
]);

const LEGACY_CATEGORY_ALIASES = Object.freeze({
  汽车: '交通工具',
});

function businessError(code, message) {
  const error = new Error(message || code);
  error.code = code;
  return error;
}

function normalizeCategoryName(value) {
  const name = typeof value === 'string'
    ? value.normalize('NFKC').trim().replace(/\s+/g, '')
    : '';
  if (!name) throw businessError('CATEGORY_NAME_REQUIRED', '请输入分类名称');
  if (Array.from(name).length > 12) {
    throw businessError('CATEGORY_NAME_TOO_LONG', '分类名称不能超过 12 个字符');
  }
  return name;
}

function createCategoryService(repository) {
  if (!repository) throw new Error('REPOSITORY_REQUIRED');

  async function assertChildOwnership(openid, childId) {
    if (!childId) throw businessError('CHILD_ID_REQUIRED', '请选择孩子');
    const child = await repository.findChildById(childId);
    if (!child || child.ownerOpenid !== openid || child.status !== 'active') {
      throw businessError('CHILD_FORBIDDEN', '无权访问该孩子');
    }
    return child;
  }

  async function list(openid, payload = {}) {
    await assertChildOwnership(openid, payload.childId);
    let allCategories = await repository.listCategories(payload.childId, true);

    for (let index = 0; index < DEFAULT_CATEGORY_NAMES.length; index += 1) {
      const name = DEFAULT_CATEGORY_NAMES[index];
      const existing = allCategories.find((item) => item.normalizedName === name);
      if (!existing) {
        await repository.createCategory({
          ownerOpenid: openid,
          childId: payload.childId,
          name,
          normalizedName: name,
          sortOrder: index,
          isDefault: true,
          status: 'active',
        });
        continue;
      }
      if (
        existing.sortOrder !== index
        || existing.status !== 'active'
        || existing.isDefault !== true
      ) {
        await repository.updateCategory(existing._id, {
          sortOrder: index,
          isDefault: true,
          status: 'active',
        });
      }
    }

    allCategories = await repository.listCategories(payload.childId, true);
    let nextSortOrder = DEFAULT_CATEGORY_NAMES.length;
    for (const category of allCategories) {
      if (DEFAULT_CATEGORY_NAMES.includes(category.normalizedName)) continue;
      const aliasTarget = LEGACY_CATEGORY_ALIASES[category.normalizedName];
      const shouldRetireWhenUnused = category.isDefault
        || DEFAULT_CATEGORY_NAMES.includes(aliasTarget);
      if (shouldRetireWhenUnused) {
        const references = await repository.countActiveCardReferences(
          payload.childId,
          category._id,
        );
        if (references === 0) {
          if (category.status === 'active') {
            await repository.updateCategoryStatus(category._id, 'inactive');
          }
          continue;
        }
        if (category.status !== 'active') {
          await repository.updateCategoryStatus(category._id, 'active');
        }
      } else if (category.status !== 'active') {
        continue;
      }
      if (category.sortOrder !== nextSortOrder) {
        await repository.updateCategory(category._id, { sortOrder: nextSortOrder });
      }
      nextSortOrder += 1;
    }

    return repository.listCategories(payload.childId, false);
  }

  async function create(openid, payload = {}) {
    await assertChildOwnership(openid, payload.childId);
    const name = normalizeCategoryName(payload.name);
    const duplicate = await repository.findByNormalized(payload.childId, name);
    const categories = await repository.listCategories(payload.childId, true);
    const sortOrder = categories.reduce(
      (maximum, item) => Math.max(maximum, Number(item.sortOrder) || 0),
      -1,
    ) + 1;
    if (duplicate) {
      if (duplicate.status === 'inactive') {
        return repository.updateCategory(duplicate._id, {
          name,
          normalizedName: name,
          sortOrder,
          isDefault: false,
          status: 'active',
        });
      }
      throw businessError('CATEGORY_DUPLICATE', '这个分类已经存在');
    }
    return repository.createCategory({
      ownerOpenid: openid,
      childId: payload.childId,
      name,
      normalizedName: name,
      sortOrder,
      isDefault: false,
      status: 'active',
    });
  }

  async function update(openid, payload = {}) {
    await assertChildOwnership(openid, payload.childId);
    const category = await repository.findById(payload.categoryId);
    if (!category || category.childId !== payload.childId || category.status !== 'active') {
      throw businessError('CATEGORY_NOT_FOUND', '分类不存在');
    }
    const name = normalizeCategoryName(payload.name);
    const duplicate = await repository.findByNormalized(payload.childId, name, category._id);
    if (duplicate) throw businessError('CATEGORY_DUPLICATE', '这个分类已经存在');
    return repository.updateCategory(category._id, { name, normalizedName: name });
  }

  return { create, list, update };
}

module.exports = {
  DEFAULT_CATEGORY_NAMES,
  LEGACY_CATEGORY_ALIASES,
  businessError,
  createCategoryService,
  normalizeCategoryName,
};
