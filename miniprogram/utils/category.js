const cache = require('./cache');
const { callFunction } = require('./cloud');

async function listCategories(childId) {
  const categories = await callFunction('categoryService', { action: 'list', childId });
  cache.setCategories(categories);
  return categories;
}

async function createCategory(payload) {
  const category = await callFunction('categoryService', { action: 'create', ...payload });
  const categories = cache.getCategories().filter((item) => item._id !== category._id);
  cache.setCategories([...categories, category].sort(
    (a, b) => Number(a.sortOrder || 0) - Number(b.sortOrder || 0),
  ));
  return category;
}

async function updateCategory(payload) {
  const category = await callFunction('categoryService', { action: 'update', ...payload });
  cache.setCategories(cache.getCategories().map((item) => (
    item._id === category._id ? category : item
  )));
  return category;
}

module.exports = {
  createCategory,
  listCategories,
  updateCategory,
};
