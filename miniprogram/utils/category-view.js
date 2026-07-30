const UNCATEGORIZED_ID = '__uncategorized__';

function normalizeSelectionIds(value, limit = 25) {
  if (!Array.isArray(value)) return [];
  return [...new Set(value
    .filter((id) => typeof id === 'string' && id.trim())
    .map((id) => id.trim()))].slice(0, limit);
}

function splitCategoryFilter(value) {
  const selectedIds = normalizeSelectionIds(value);
  return {
    categoryIds: selectedIds.filter((id) => id !== UNCATEGORIZED_ID),
    includeUncategorized: selectedIds.includes(UNCATEGORIZED_ID),
  };
}

function getCategorySelectionLabel(categories, selectedIds, options = {}) {
  const categoryMap = new Map((categories || []).map((item) => [item._id, item.name]));
  const selected = normalizeSelectionIds(selectedIds);
  const labels = selected
    .map((id) => (id === UNCATEGORIZED_ID ? '未分类' : categoryMap.get(id)))
    .filter(Boolean);
  if (!labels.length) return options.filterMode ? '全部分类' : '未分类';
  if (labels.length <= 2) return labels.join('、');
  return `${labels.slice(0, 2).join('、')}等 ${labels.length} 类`;
}

function decorateCardCategories(card = {}, categories = []) {
  const categoryIds = normalizeSelectionIds(card.categoryIds, 10)
    .filter((id) => id !== UNCATEGORIZED_ID);
  const categoryMap = new Map((categories || []).map((item) => [item._id, item.name]));
  const labels = categoryIds.map((id) => categoryMap.get(id)).filter(Boolean);
  return {
    ...card,
    categoryIds,
    categoryLabels: labels.slice(0, 2),
    categoryOverflowCount: Math.max(0, labels.length - 2),
    categorySummary: getCategorySelectionLabel(categories, categoryIds),
  };
}

module.exports = {
  UNCATEGORIZED_ID,
  decorateCardCategories,
  getCategorySelectionLabel,
  normalizeSelectionIds,
  splitCategoryFilter,
};
