const test = require('node:test');
const assert = require('node:assert/strict');

const {
  UNCATEGORIZED_ID,
  decorateCardCategories,
  getCategorySelectionLabel,
  normalizeSelectionIds,
  splitCategoryFilter,
} = require('../miniprogram/utils/category-view');

const categories = [
  { _id: 'traffic', name: '交通工具' },
  { _id: 'food', name: '食品' },
  { _id: 'plant', name: '植物' },
];

test('分类选择去重并允许筛选使用未分类哨兵', () => {
  assert.deepEqual(normalizeSelectionIds(['traffic', 'traffic', '', null, 'food']), ['traffic', 'food']);
  assert.deepEqual(splitCategoryFilter(['traffic', UNCATEGORIZED_ID, 'traffic']), {
    categoryIds: ['traffic'],
    includeUncategorized: true,
  });
});

test('分类摘要显示名称、数量和未分类状态', () => {
  assert.equal(getCategorySelectionLabel(categories, []), '未分类');
  assert.equal(getCategorySelectionLabel(categories, ['traffic']), '交通工具');
  assert.equal(getCategorySelectionLabel(categories, ['traffic', 'food', 'plant']), '交通工具、食品等 3 类');
  assert.equal(getCategorySelectionLabel(categories, [UNCATEGORIZED_ID], { filterMode: true }), '未分类');
});

test('字卡最多展示两个分类标签并计算剩余数量', () => {
  assert.deepEqual(decorateCardCategories({ _id: 'a', categoryIds: ['traffic', 'food', 'plant'] }, categories), {
    _id: 'a',
    categoryIds: ['traffic', 'food', 'plant'],
    categoryLabels: ['交通工具', '食品'],
    categoryOverflowCount: 1,
    categorySummary: '交通工具、食品等 3 类',
  });
  assert.equal(decorateCardCategories({ _id: 'b' }, categories).categorySummary, '未分类');
});
