const test = require('node:test');
const assert = require('node:assert/strict');
const Module = require('node:module');
const path = require('node:path');

const pagePath = path.join(__dirname, '../miniprogram/pages/library/index.js');

function loadLibraryPage({ cardApi, wxApi } = {}) {
  const originalLoad = Module._load;
  let definition;
  const resolvedCardApi = cardApi || {};
  global.Page = (config) => { definition = config; };
  global.wx = wxApi || { showToast() {}, showModal() {}, stopPullDownRefresh() {} };
  Module._load = function mockLoad(request, parent, isMain) {
    if (request === '../../utils/cache') {
      return {
        consumeLibraryFilterIntent: () => null,
        setManualReviewQueue() {},
      };
    }
    if (request === '../../utils/card') return resolvedCardApi;
    if (request === '../../utils/session') {
      return {
        getCachedSession: () => ({ child: { _id: 'child-1' } }),
        bootstrap: async () => ({ child: { _id: 'child-1' } }),
      };
    }
    if (request === '../../utils/review-queue') {
      return { toggleSelectedId: (ids, id) => (ids.includes(id) ? ids.filter((item) => item !== id) : [...ids, id]) };
    }
    if (request === '../../utils/view') return { decorateCard: (card) => card };
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
      items: [],
      selectedIds: [],
      selectedCount: 0,
      wordSheetCard: null,
      showEditSheet: true,
      editingCard: null,
      editContent: '',
      editProficiency: 'unfamiliar',
      editSaving: false,
      selectedFilter: 'all',
      keyword: '',
      totalResults: 0,
      tabs: [
        { value: 'all', count: 0 },
        { value: 'due', count: 0 },
        { value: 'mastered', count: 0 },
      ],
      ...data,
    },
    setData(update) {
      this.data = { ...this.data, ...update };
    },
  };
}

test('修改字卡内容时清空旧自定义组词并关闭编辑层', async () => {
  let payload;
  const lastReviewAt = new Date().toISOString();
  const definition = loadLibraryPage({
    cardApi: {
      updateCard: async (value) => {
        payload = value;
        return { _id: 'card-1', content: '小', proficiency: 'normal', customWords: [], lastReviewAt, status: 'active' };
      },
    },
  });
  const context = createContext(definition, {
    items: [{ _id: 'card-1', content: '大', proficiency: 'unfamiliar', customWords: ['大象'], lastReviewAt, status: 'active' }],
    editingCard: { _id: 'card-1', content: '大', proficiency: 'unfamiliar', customWords: ['大象'], lastReviewAt, status: 'active' },
    editContent: '小',
    editProficiency: 'normal',
    keyword: '大',
    totalResults: 1,
    tabs: [
      { value: 'all', count: 1 },
      { value: 'due', count: 1 },
      { value: 'mastered', count: 0 },
    ],
  });
  context.loadCards = async () => false;

  await definition.onSaveEdit.call(context);

  assert.deepEqual(payload, {
    childId: 'child-1',
    cardId: 'card-1',
    content: '小',
    proficiency: 'normal',
    customWords: [],
  });
  assert.equal(context.data.showEditSheet, false);
  assert.equal(context.data.editingCard, null);
  assert.equal(context.data.editSaving, false);
  assert.deepEqual(context.data.items, []);
  assert.equal(context.data.totalResults, 0);
  assert.deepEqual(context.data.tabs.map((tab) => tab.count), [1, 0, 0]);
});

test('只修改熟练度时保留自定义组词，保存失败时保留编辑现场', async () => {
  let payload;
  const toasts = [];
  const definition = loadLibraryPage({
    cardApi: {
      updateCard: async (value) => {
        payload = value;
        throw new Error('保存失败');
      },
    },
    wxApi: { showToast: (options) => toasts.push(options), stopPullDownRefresh() {} },
  });
  const editingCard = { _id: 'card-1', content: '大', proficiency: 'unfamiliar', customWords: ['大象'] };
  const context = createContext(definition, {
    items: [editingCard],
    editingCard,
    editContent: '大',
    editProficiency: 'proficient',
  });
  context.loadCards = async () => false;

  await definition.onSaveEdit.call(context);

  assert.equal(Object.hasOwn(payload, 'customWords'), false);
  assert.equal(context.data.showEditSheet, true);
  assert.equal(context.data.editingCard, editingCard);
  assert.equal(context.data.editSaving, false);
  assert.equal(toasts.at(-1).title, '保存失败');
});

test('确认删除会移除列表和选择状态，保存中不会重复弹确认框', async () => {
  let modalOptions;
  let deletePayload;
  const definition = loadLibraryPage({
    cardApi: {
      deleteCard: async (value) => { deletePayload = value; },
    },
    wxApi: {
      showModal: (options) => { modalOptions = options; },
      showToast() {},
      stopPullDownRefresh() {},
    },
  });
  const editingCard = { _id: 'card-1', content: '大' };
  const context = createContext(definition, {
    items: [editingCard, { _id: 'card-2', content: '小' }],
    selectedIds: ['card-1', 'card-2'],
    selectedCount: 2,
    editingCard,
    totalResults: 2,
    tabs: [
      { value: 'all', count: 2 },
      { value: 'due', count: 2 },
      { value: 'mastered', count: 0 },
    ],
  });
  context.loadCards = async () => false;

  definition.onDeleteCard.call(context);
  await modalOptions.success({ confirm: true });

  assert.deepEqual(deletePayload, { childId: 'child-1', cardId: 'card-1' });
  assert.deepEqual(context.data.items.map((item) => item._id), ['card-2']);
  assert.deepEqual(context.data.selectedIds, ['card-2']);
  assert.equal(context.data.selectedCount, 1);
  assert.equal(context.data.showEditSheet, false);
  assert.equal(context.data.totalResults, 1);
  assert.deepEqual(context.data.tabs.map((tab) => tab.count), [1, 1, 0]);

  modalOptions = null;
  context.data.editSaving = true;
  context.data.editingCard = editingCard;
  definition.onDeleteCard.call(context);
  assert.equal(modalOptions, null);
});

test('编辑保存期间忽略输入和熟练度变更', () => {
  const definition = loadLibraryPage();
  const context = createContext(definition, {
    editSaving: true,
    editContent: '大',
    editProficiency: 'unfamiliar',
  });

  definition.onEditContentInput.call(context, { detail: { value: '小' } });
  definition.onSelectEditProficiency.call(context, { currentTarget: { dataset: { value: 'proficient' } } });

  assert.equal(context.data.editContent, '大');
  assert.equal(context.data.editProficiency, 'unfamiliar');
});
