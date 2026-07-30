const test = require('node:test');
const assert = require('node:assert/strict');
const Module = require('node:module');
const path = require('node:path');

const pagePath = path.join(__dirname, '../miniprogram/pages/library/index.js');

function loadLibraryPage({ cardApi, categoryApi, cacheApi, wxApi } = {}) {
  const originalLoad = Module._load;
  let definition;
  const resolvedCardApi = cardApi || {};
  global.Page = (config) => { definition = config; };
  global.wx = wxApi || { showToast() {}, showModal() {}, stopPullDownRefresh() {} };
  Module._load = function mockLoad(request, parent, isMain) {
    if (request === '../../utils/cache') {
      return cacheApi || {
        consumeLibraryFilterIntent: () => null,
        getCategories: () => [],
        setManualReviewQueue() {},
      };
    }
    if (request === '../../utils/card') return resolvedCardApi;
    if (request === '../../utils/category') return categoryApi || {};
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
      selectionMode: false,
      selectedIds: [],
      selectedCount: 0,
      showWordDetail: false,
      wordDetailCard: null,
      wordDetail: { content: '', characters: [] },
      showEditSheet: true,
      editingCard: null,
      editContent: '',
      editProficiency: 'unfamiliar',
      editCategoryIds: [],
      pendingEditCategoryIds: [],
      editSaving: false,
      categories: [],
      selectedCategoryFilterIds: [],
      pendingCategoryFilterIds: [],
      showCategoryFilterPicker: false,
      showEditCategoryPicker: false,
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
    categoryIds: [],
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

test('打开编辑会复制字卡分类并在保存时提交修改后的分类', async () => {
  let payload;
  const card = {
    _id: 'card-1',
    content: '汽车',
    proficiency: 'unfamiliar',
    categoryIds: ['traffic'],
    customWords: [],
    status: 'active',
  };
  const definition = loadLibraryPage({
    cardApi: {
      updateCard: async (value) => {
        payload = value;
        return { ...card, categoryIds: value.categoryIds };
      },
    },
  });
  const context = createContext(definition, {
    items: [card],
    categories: [
      { _id: 'traffic', name: '交通工具' },
      { _id: 'food', name: '食品' },
    ],
  });
  context.loadCards = async () => true;

  definition.onOpenEdit.call(context, { currentTarget: { dataset: { id: 'card-1' } } });
  assert.deepEqual(context.data.editCategoryIds, ['traffic']);
  definition.onOpenEditCategoryPicker.call(context);
  definition.onPendingEditCategoryChange.call(context, { detail: { selectedIds: ['food'] } });
  definition.onConfirmEditCategoryPicker.call(context, { detail: { selectedIds: ['food'] } });
  await definition.onSaveEdit.call(context);

  assert.deepEqual(payload, {
    childId: 'child-1',
    cardId: 'card-1',
    content: '汽车',
    proficiency: 'unfamiliar',
    categoryIds: ['food'],
  });
});

test('分类筛选确认后重置分页并发送多分类和未分类参数', async () => {
  let listPayload;
  const definition = loadLibraryPage({
    cardApi: {
      listCards: async (value) => {
        listPayload = value;
        return { items: [], total: 0, page: 1, hasMore: false, counts: {} };
      },
    },
  });
  const context = createContext(definition, {
    categories: [{ _id: 'traffic', name: '交通工具' }],
    page: 3,
    items: [{ _id: 'old' }],
  });

  definition.onOpenCategoryFilter.call(context);
  definition.onPendingCategoryFilterChange.call(context, {
    detail: { selectedIds: ['traffic', '__uncategorized__'] },
  });
  await definition.onConfirmCategoryFilter.call(context, {
    detail: { selectedIds: ['traffic', '__uncategorized__'] },
  });

  assert.deepEqual(context.data.selectedCategoryFilterIds, ['traffic', '__uncategorized__']);
  assert.deepEqual(listPayload.categoryIds, ['traffic']);
  assert.equal(listPayload.includeUncategorized, true);
  assert.equal(listPayload.page, 1);
});

test('普通模式点击整行打开按不重复单字拆分的详情', () => {
  const definition = loadLibraryPage();
  const card = { _id: 'card-1', content: '礼物礼', customWords: ['礼貌'] };
  const context = createContext(definition, { items: [card] });

  definition.onCardTap.call(context, { currentTarget: { dataset: { id: 'card-1' } } });

  assert.equal(context.data.showWordDetail, true);
  assert.equal(context.data.wordDetailCard, card);
  assert.deepEqual(context.data.wordDetail.characters.map((item) => item.character), ['礼', '物']);
  assert.equal(context.data.wordDetail.characters[0].pinyin, 'lǐ');
  assert.equal(context.data.wordDetail.characters[1].pinyin, 'wù');
});

test('选择模式点击整行只切换选择，不打开详情', () => {
  const definition = loadLibraryPage();
  const card = { _id: 'card-1', content: '礼物', customWords: [] };
  const context = createContext(definition, { items: [card], selectionMode: true });
  const event = { currentTarget: { dataset: { id: 'card-1' } } };

  definition.onCardTap.call(context, event);
  assert.deepEqual(context.data.selectedIds, ['card-1']);
  assert.equal(context.data.items[0].selected, true);
  assert.equal(context.data.showWordDetail, false);

  definition.onCardTap.call(context, event);
  assert.deepEqual(context.data.selectedIds, []);
  assert.equal(context.data.items[0].selected, false);
});

test('详情中按目标单字校验并保存补充组词', async () => {
  let payload;
  const card = { _id: 'card-1', content: '礼物', customWords: [] };
  const definition = loadLibraryPage({
    cardApi: {
      updateCard: async (value) => {
        payload = value;
        return { ...card, customWords: value.customWords };
      },
    },
  });
  const context = createContext(definition, { items: [card] });
  definition.onCardTap.call(context, { currentTarget: { dataset: { id: 'card-1' } } });
  definition.onDetailWordInput.call(context, {
    currentTarget: { dataset: { index: 0 } },
    detail: { value: '礼貌' },
  });
  definition.onDetailWordInput.call(context, {
    currentTarget: { dataset: { index: 1 } },
    detail: { value: '物体草稿' },
  });

  await definition.onSaveDetailWord.call(context, { currentTarget: { dataset: { index: 0 } } });

  assert.deepEqual(payload, {
    childId: 'child-1',
    cardId: 'card-1',
    customWords: ['礼貌'],
  });
  assert.deepEqual(context.data.items[0].customWords, ['礼貌']);
  assert.equal(context.data.wordDetail.characters[0].words.includes('礼貌'), true);
  assert.equal(context.data.wordDetail.characters[0].inputValue, '');
  assert.equal(context.data.wordDetail.characters[1].inputValue, '物体草稿');
});
