const test = require('node:test');
const assert = require('node:assert/strict');
const Module = require('node:module');
const path = require('node:path');

const pagePath = path.join(__dirname, '../miniprogram/pages/add/index.js');

function loadAddPage({ cardApi, categoryApi, cacheApi, wxApi } = {}) {
  const originalLoad = Module._load;
  let definition;
  global.Page = (config) => { definition = config; };
  global.wx = wxApi || { showToast() {}, showModal() {}, switchTab() {} };
  Module._load = function mockLoad(request, parent, isMain) {
    if (request === '../../utils/card') return cardApi || {};
    if (request === '../../utils/category') return categoryApi || {};
    if (request === '../../utils/cache') return cacheApi || { getCategories: () => [] };
    if (request === '../../utils/session') {
      return {
        getCachedSession: () => ({ child: { _id: 'child-1' } }),
        bootstrap: async () => ({ child: { _id: 'child-1' } }),
      };
    }
    return originalLoad(request, parent, isMain);
  };
  delete require.cache[pagePath];
  try {
    require(pagePath);
  } finally {
    Module._load = originalLoad;
    delete global.Page;
  }
  return definition;
}

function createContext(definition, data = {}) {
  return {
    ...definition,
    data: {
      content: '',
      source: 'new',
      saving: false,
      errorMessage: '',
      savedCard: null,
      categories: [],
      selectedCategoryIds: [],
      pendingCategoryIds: [],
      showCategoryPicker: false,
      categorySummary: '未分类',
      ...data,
    },
    setData(update) {
      this.data = { ...this.data, ...update };
    },
  };
}

test('录入字卡保存分类且成功后保留分类选择', async () => {
  let payload;
  const definition = loadAddPage({
    cardApi: {
      createCard: async (value) => {
        payload = value;
        return { _id: 'card-1', content: value.content, categoryIds: value.categoryIds };
      },
    },
  });
  const context = createContext(definition, {
    content: '汽车',
    categories: [{ _id: 'traffic', name: '交通工具' }],
    selectedCategoryIds: ['traffic'],
    categorySummary: '交通工具',
  });

  await definition.onSave.call(context);

  assert.deepEqual(payload, {
    childId: 'child-1',
    content: '汽车',
    source: 'new',
    categoryIds: ['traffic'],
  });
  assert.equal(context.data.content, '');
  assert.deepEqual(context.data.selectedCategoryIds, ['traffic']);
  assert.equal(context.data.categorySummary, '交通工具');
});

test('录入页分类选择先暂存，确认后才应用', () => {
  const definition = loadAddPage();
  const context = createContext(definition, {
    categories: [
      { _id: 'traffic', name: '交通工具' },
      { _id: 'food', name: '食品' },
    ],
    selectedCategoryIds: ['traffic'],
    categorySummary: '交通工具',
  });

  definition.onOpenCategoryPicker.call(context);
  definition.onPendingCategoryChange.call(context, { detail: { selectedIds: ['food'] } });
  assert.deepEqual(context.data.selectedCategoryIds, ['traffic']);

  definition.onConfirmCategoryPicker.call(context, { detail: { selectedIds: ['food'] } });
  assert.deepEqual(context.data.selectedCategoryIds, ['food']);
  assert.equal(context.data.categorySummary, '食品');
  assert.equal(context.data.showCategoryPicker, false);
});
