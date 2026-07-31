# 首页待复习字卡分批选择 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 在首页“今日待复习”区域展开全部待复习字卡并选择当前批次，复习页只加载本批所选字卡，同时保留字卡库现有追加复习行为。

**Architecture:** 为一次性复习队列增加 `append/replace` 显式模式，并由独立纯函数决定系统计划与手动字卡的组合方式。首页在页面会话中维护批次选择状态，管理模式展示全部待复习字卡；复习页根据队列模式建立本轮状态，批次队列失效时绝不回退到全部计划。

**Tech Stack:** 微信小程序 WXML/WXSS/JavaScript、CommonJS、Node.js `node:test`、微信开发者工具 CLI/自动化能力。

---

## 文件职责

- `miniprogram/utils/review-queue.js`：选择 ID、首页选择状态、复习队列组合模式的纯函数。
- `miniprogram/utils/cache.js`：一次性复习队列的模式校验、时效校验和向后兼容。
- `miniprogram/pages/review/index.js`：识别普通手动追加与首页批次替换入口，加载正确字卡集合。
- `miniprogram/pages/review/index.wxml`：为失效批次提供准确空状态文案。
- `miniprogram/pages/index/index.js`：维护首页管理模式、多选、全选和启动本批复习。
- `miniprogram/pages/index/index.wxml`：首页原地选择界面及本批操作区。
- `miniprogram/pages/index/index.wxss`：小程序风格选中态、窄屏不溢出的操作布局。
- `tests/review-queue.test.js`：队列模式和首页选择状态纯函数测试。
- `tests/cache.test.js`：队列模式持久化、缺省兼容和非法模式测试。
- `tests/review-page.test.js`：复习页 `replace/append` 与失效批次行为测试。
- `tests/home-page.test.js`：首页批次选择操作测试。
- `tests/project-structure.test.js`：首页选择界面和防溢出样式结构测试。

### Task 1: 增加复习队列模式和首页选择状态纯函数

**Files:**
- Modify: `tests/review-queue.test.js`
- Modify: `miniprogram/utils/review-queue.js`

- [ ] **Step 1: 写队列模式和选择状态失败测试**

在 `tests/review-queue.test.js` 增加：

```js
const {
  buildReviewSelectionState,
  mergeReviewCards,
  resolveReviewCards,
  toggleSelectedId,
} = require('../miniprogram/utils/review-queue');

test('replace 模式只使用所选字卡且保持手动顺序', () => {
  const cards = resolveReviewCards(
    [{ _id: 'today' }],
    [{ _id: 'b' }, { _id: 'a' }, { _id: 'b' }],
    'replace',
  );
  assert.deepEqual(cards.map((card) => card._id), ['b', 'a']);
});

test('append 和缺省模式保持系统计划在前的既有行为', () => {
  const autoCards = [{ _id: 'a' }, { _id: 'b' }];
  const manualCards = [{ _id: 'b' }, { _id: 'c' }];
  assert.deepEqual(
    resolveReviewCards(autoCards, manualCards, 'append').map((card) => card._id),
    ['a', 'b', 'c'],
  );
  assert.deepEqual(
    resolveReviewCards(autoCards, manualCards).map((card) => card._id),
    ['a', 'b', 'c'],
  );
});

test('首页管理模式展开全部待复习字卡并剔除失效选择', () => {
  const cards = Array.from({ length: 8 }, (_, index) => ({ _id: `card-${index + 1}` }));
  const managed = buildReviewSelectionState(cards, ['missing', 'card-2', 'card-7'], true);
  const preview = buildReviewSelectionState(cards, ['card-2'], false);

  assert.equal(managed.cards.length, 8);
  assert.deepEqual(managed.selectedIds, ['card-2', 'card-7']);
  assert.equal(managed.selectedCount, 2);
  assert.equal(managed.allSelected, false);
  assert.equal(managed.cards[1].selected, true);
  assert.equal(preview.cards.length, 6);
});
```

- [ ] **Step 2: 运行测试确认失败**

Run: `node --test tests/review-queue.test.js`

Expected: FAIL，提示 `resolveReviewCards` 或 `buildReviewSelectionState` 未定义。

- [ ] **Step 3: 实现最小纯函数**

在 `miniprogram/utils/review-queue.js` 增加并导出：

```js
function uniqueCards(cards) {
  const unique = [];
  const seen = new Set();
  for (const card of Array.isArray(cards) ? cards : []) {
    if (!card || !card._id || seen.has(card._id)) continue;
    seen.add(card._id);
    unique.push(card);
  }
  return unique;
}

function mergeReviewCards(autoCards, manualCards) {
  return uniqueCards([...(autoCards || []), ...(manualCards || [])]);
}

function resolveReviewCards(autoCards, manualCards, mode = 'append') {
  return mode === 'replace'
    ? uniqueCards(manualCards)
    : mergeReviewCards(autoCards, manualCards);
}

function buildReviewSelectionState(cards, selectedIds, expanded = false) {
  const safeCards = uniqueCards(cards);
  const selectedSet = new Set(normalizeIds(selectedIds));
  const orderedSelectedIds = safeCards
    .map((card) => card._id)
    .filter((id) => selectedSet.has(id));
  const validSelectedSet = new Set(orderedSelectedIds);
  const visibleCards = (expanded ? safeCards : safeCards.slice(0, 6))
    .map((card) => ({ ...card, selected: validSelectedSet.has(card._id) }));
  return {
    cards: visibleCards,
    selectedIds: orderedSelectedIds,
    selectedCount: orderedSelectedIds.length,
    allSelected: safeCards.length > 0 && orderedSelectedIds.length === safeCards.length,
  };
}
```

- [ ] **Step 4: 运行队列测试确认通过**

Run: `node --test tests/review-queue.test.js`

Expected: PASS，原有追加和切换选择测试继续通过。

- [ ] **Step 5: 提交纯函数改动**

```bash
git add tests/review-queue.test.js miniprogram/utils/review-queue.js
git commit -m "feat: support review queue modes"
```

### Task 2: 缓存显式保存 append/replace 模式

**Files:**
- Modify: `tests/cache.test.js`
- Modify: `miniprogram/utils/cache.js`

- [ ] **Step 1: 写缓存模式失败测试**

把现有临时队列期望增加 `mode: 'append'`，并增加：

```js
test('临时复习队列保存 replace 模式并将旧队列兼容为 append', () => {
  cache.setManualReviewQueue(['a', 'b'], 1000, 'replace');
  assert.deepEqual(cache.getManualReviewQueue(1001), {
    cardIds: ['a', 'b'],
    mode: 'replace',
    createdAt: 1000,
  });

  storage.set(cache.KEYS.manualReviewQueue, { cardIds: ['old'], createdAt: 1000 });
  assert.equal(cache.getManualReviewQueue(1001).mode, 'append');
});

test('非法队列模式按 append 处理', () => {
  cache.setManualReviewQueue(['a'], 1000, 'unknown');
  assert.equal(cache.getManualReviewQueue(1001).mode, 'append');
});
```

- [ ] **Step 2: 运行缓存测试确认失败**

Run: `node --test tests/cache.test.js`

Expected: FAIL，返回队列缺少 `mode`。

- [ ] **Step 3: 实现缓存模式校验**

在 `miniprogram/utils/cache.js` 增加：

```js
const REVIEW_QUEUE_MODES = new Set(['append', 'replace']);

function normalizeReviewQueueMode(mode) {
  return REVIEW_QUEUE_MODES.has(mode) ? mode : 'append';
}
```

并将队列读写改为：

```js
setManualReviewQueue(cardIds, createdAt = Date.now(), mode = 'append') {
  const ids = normalizeIds(cardIds).slice(0, 50);
  if (!ids.length) {
    wx.removeStorageSync(KEYS.manualReviewQueue);
    return null;
  }
  return write(KEYS.manualReviewQueue, {
    cardIds: ids,
    mode: normalizeReviewQueueMode(mode),
    createdAt,
  });
},
getManualReviewQueue(now = Date.now()) {
  const queue = read(KEYS.manualReviewQueue, null);
  const ids = normalizeIds(queue && queue.cardIds).slice(0, 50);
  if (!queue || !ids.length || typeof queue.createdAt !== 'number'
    || now - queue.createdAt > MANUAL_REVIEW_QUEUE_TTL_MS) {
    wx.removeStorageSync(KEYS.manualReviewQueue);
    return null;
  }
  return {
    cardIds: ids,
    mode: normalizeReviewQueueMode(queue.mode),
    createdAt: queue.createdAt,
  };
},
```

- [ ] **Step 4: 运行缓存和字卡库测试**

Run: `node --test tests/cache.test.js tests/library-page.test.js`

Expected: PASS，字卡库不传模式时继续得到 `append`。

- [ ] **Step 5: 提交缓存改动**

```bash
git add tests/cache.test.js miniprogram/utils/cache.js
git commit -m "feat: persist review queue mode"
```

### Task 3: 复习页只加载首页所选批次

**Files:**
- Modify: `tests/review-page.test.js`
- Modify: `miniprogram/pages/review/index.js`
- Modify: `miniprogram/pages/review/index.wxml`

- [ ] **Step 1: 写 replace 和失效批次失败测试**

扩展 `loadReviewPage` 允许注入 `cacheApi`，并让 `../../utils/review-queue` 使用真实模块。增加：

```js
test('首页批次入口只加载 replace 队列中的有效字卡', async () => {
  let cleared = 0;
  const definition = loadReviewPage({
    cacheApi: {
      getTodayPlan: () => null,
      getManualReviewQueue: () => ({ cardIds: ['picked'], mode: 'replace', createdAt: 1 }),
      clearManualReviewQueue: () => { cleared += 1; },
    },
    cardApi: {
      getTodayPlan: async () => ({ cards: [{ _id: 'auto' }] }),
      getCardsByIds: async () => [{ _id: 'picked' }],
    },
  });
  const context = createContext(definition);
  context._manualSource = true;
  context._batchSource = true;

  await definition.loadPlan.call(context);

  assert.deepEqual(context.data.cards.map((card) => card._id), ['picked']);
  assert.equal(cleared, 1);
});

test('首页批次队列失效时不回退到全部待复习', async () => {
  const definition = loadReviewPage({
    cacheApi: {
      getTodayPlan: () => null,
      getManualReviewQueue: () => null,
      clearManualReviewQueue() {},
    },
    cardApi: { getTodayPlan: async () => ({ cards: [{ _id: 'auto' }] }) },
  });
  const context = createContext(definition);
  context._manualSource = true;
  context._batchSource = true;

  await definition.loadPlan.call(context);

  assert.deepEqual(context.data.cards, []);
  assert.equal(context.data.emptyTitle, '本批字卡已不可用');
});
```

- [ ] **Step 2: 运行复习页测试确认失败**

Run: `node --test tests/review-page.test.js`

Expected: FAIL，当前逻辑把 `auto` 与 `picked` 合并，失效队列回退到 `auto`。

- [ ] **Step 3: 实现入口和模式分流**

将导入改为：

```js
const { resolveReviewCards } = require('../../utils/review-queue');
```

在页面数据中增加：

```js
emptyTitle: '今天没有待复习字卡',
emptyText: '录入新字后，系统会根据熟练度自动安排复习。',
```

`onLoad` 记录：

```js
this._manualSource = options.source === 'manual' || options.source === 'batch';
this._batchSource = options.source === 'batch';
```

`loadPlan` 的手动队列分支改为：

```js
if (this._manualSource) {
  const queue = cache.getManualReviewQueue();
  if (queue && queue.cardIds.length) {
    const manualCards = await cardApi.getCardsByIds(child._id, queue.cardIds);
    cards = resolveReviewCards(cards, manualCards, queue.mode);
    if (manualCards.length < queue.cardIds.length) {
      wx.showToast({ title: '部分字卡已不可用', icon: 'none' });
    }
    cache.clearManualReviewQueue();
  } else if (this._batchSource) {
    cards = [];
    this.setData({
      emptyTitle: '本批字卡已不可用',
      emptyText: '请返回首页，重新选择本批要复习的字卡。',
    });
  }
  this._manualSource = false;
  this._batchSource = false;
}
```

把 WXML 空状态文案改为 `{{emptyTitle}}` 和 `{{emptyText}}`。

- [ ] **Step 4: 运行复习队列和复习页测试**

Run: `node --test tests/review-queue.test.js tests/review-page.test.js`

Expected: PASS，append 兼容性和 replace 隔离性同时成立。

- [ ] **Step 5: 提交复习页改动**

```bash
git add tests/review-page.test.js miniprogram/pages/review/index.js miniprogram/pages/review/index.wxml
git commit -m "feat: load selected home review batch"
```

### Task 4: 首页原地展开并管理当前复习批次

**Files:**
- Create: `tests/home-page.test.js`
- Modify: `tests/project-structure.test.js`
- Modify: `miniprogram/pages/index/index.js`
- Modify: `miniprogram/pages/index/index.wxml`
- Modify: `miniprogram/pages/index/index.wxss`

- [ ] **Step 1: 写首页操作和结构失败测试**

`tests/home-page.test.js` 加载 Page 定义并注入缓存、页面跳转和装饰函数，覆盖：

```js
test('管理模式默认不选中并展开全部待复习字卡', () => {
  const cards = Array.from({ length: 8 }, (_, index) => ({ _id: `card-${index + 1}` }));
  const { definition, context } = createHomePage({ cards });

  definition.onToggleReviewSelectionMode.call(context);

  assert.equal(context.data.reviewSelectionMode, true);
  assert.equal(context.data.previewCards.length, 8);
  assert.equal(context.data.selectedReviewCount, 0);
});

test('选择本批后写入 replace 队列并跳转批次入口', () => {
  const calls = [];
  const { definition, context } = createHomePage({
    cards: [{ _id: 'a' }, { _id: 'b' }],
    setManualReviewQueue: (...args) => calls.push(args),
    navigateTo: (options) => {
      assert.equal(options.url, '/pages/review/index?source=batch');
      options.success();
    },
  });
  definition.onToggleReviewSelectionMode.call(context);
  definition.onToggleReviewCard.call(context, { currentTarget: { dataset: { id: 'b' } } });
  definition.onStartSelectedReview.call(context);

  assert.equal(calls[0][0][0], 'b');
  assert.equal(calls[0][2], 'replace');
  assert.equal(context.data.reviewSelectionMode, false);
});
```

在 `tests/project-structure.test.js` 增加结构断言：存在 `onToggleReviewSelectionMode`、`onToggleAllReviewCards`、`onStartSelectedReview`、`review-row__selector`、`review-batch-panel`；选择按钮使用 Flex 居中且批次操作区使用单列/可收缩布局，不出现固定宽度横排溢出。

- [ ] **Step 2: 运行首页测试确认失败**

Run: `node --test tests/home-page.test.js tests/project-structure.test.js`

Expected: FAIL，首页尚无批次管理事件和选择界面。

- [ ] **Step 3: 实现首页状态与事件**

从队列工具导入：

```js
const {
  buildReviewSelectionState,
  toggleSelectedId,
} = require('../../utils/review-queue');
```

页面数据增加：

```js
reviewSelectionMode: false,
selectedReviewIds: [],
selectedReviewCount: 0,
allReviewCardsSelected: false,
```

增加统一状态方法和事件：

```js
updateReviewSelection(selectedIds, reviewSelectionMode = this.data.reviewSelectionMode) {
  const selection = buildReviewSelectionState(
    this.data.plan.cards,
    selectedIds,
    reviewSelectionMode,
  );
  this.setData({
    reviewSelectionMode,
    previewCards: selection.cards.map((card) => decorateCard(card)),
    selectedReviewIds: selection.selectedIds,
    selectedReviewCount: selection.selectedCount,
    allReviewCardsSelected: selection.allSelected,
  });
},

onToggleReviewSelectionMode() {
  this.updateReviewSelection([], !this.data.reviewSelectionMode);
},

onToggleReviewCard(event) {
  const cardId = event.currentTarget.dataset.id;
  if (!this.data.reviewSelectionMode) {
    this.onReview();
    return;
  }
  this.updateReviewSelection(toggleSelectedId(this.data.selectedReviewIds, cardId), true);
},

onToggleAllReviewCards() {
  const nextIds = this.data.allReviewCardsSelected
    ? []
    : this.data.plan.cards.map((card) => card._id);
  this.updateReviewSelection(nextIds, true);
},

onStartSelectedReview() {
  if (!this.data.selectedReviewIds.length) return;
  try {
    const queue = cache.setManualReviewQueue(
      this.data.selectedReviewIds,
      Date.now(),
      'replace',
    );
    if (!queue) throw new Error('本批字卡保存失败');
    wx.navigateTo({
      url: '/pages/review/index?source=batch',
      success: () => this.updateReviewSelection([], false),
      fail: () => {
        cache.clearManualReviewQueue();
        wx.showToast({ title: '进入复习失败，请重试', icon: 'none' });
      },
    });
  } catch (error) {
    wx.showToast({ title: error.message || '本批字卡保存失败', icon: 'none' });
  }
},
```

`applyState` 使用 `buildReviewSelectionState` 重建 `previewCards`，刷新时剔除失效选择并在管理模式展示全部字卡。

- [ ] **Step 4: 实现 WXML 和 WXSS**

标题右侧普通状态显示“管理本次”和“全部字卡”，管理状态只显示“退出管理”。卡片绑定 `onToggleReviewCard`，选择模式显示圆形勾选器；列表下增加：

```xml
<view wx:if="{{reviewSelectionMode && previewCards.length}}" class="review-batch-panel surface-card">
  <view class="review-batch-panel__summary">
    <view>
      <view class="review-batch-panel__title">已选 {{selectedReviewCount}} 张</view>
      <view class="review-batch-panel__hint">本批完成后，其余字卡仍会留在待复习中</view>
    </view>
    <button class="text-button review-batch-panel__select-all" bindtap="onToggleAllReviewCards">
      {{allReviewCardsSelected ? '取消全选' : '全选'}}
    </button>
  </view>
  <button
    class="primary-button review-batch-panel__start"
    bindtap="onStartSelectedReview"
    disabled="{{selectedReviewCount === 0}}"
  >开始本批复习</button>
</view>
```

样式要求：标题操作组允许收缩和换行；圆形选择器使用 `display:flex; align-items:center; justify-content:center`；批次面板摘要使用 Flex，开始按钮单独占满一行；小于等于 360px 时标题操作区字号和间距缩小，不设置可能超过容器的固定总宽度。管理模式下隐藏普通快捷操作和浮动录入按钮。

- [ ] **Step 5: 运行首页和结构测试**

Run: `node --test tests/home-page.test.js tests/project-structure.test.js`

Expected: PASS，管理状态展开 8 张、选中效果及 replace 跳转均正确。

- [ ] **Step 6: 提交首页改动**

```bash
git add tests/home-page.test.js tests/project-structure.test.js miniprogram/pages/index/index.js miniprogram/pages/index/index.wxml miniprogram/pages/index/index.wxss
git commit -m "feat: manage review batches on home"
```

### Task 5: 回归验证和微信开发者工具操作测试

**Files:**
- Modify only if verification exposes a scoped defect.

- [ ] **Step 1: 运行完整自动测试**

Run: `npm test`

Expected: 所有测试 PASS，无失败和未处理异常。

- [ ] **Step 2: 检查工作区和差异质量**

Run: `git diff --check && git status --short --branch`

Expected: 无空白错误；只包含本功能相关提交或明确的测试修复。

- [ ] **Step 3: 微信开发者工具构建并执行首页操作测试**

在微信开发者工具打开本项目并逐条操作：

1. 首页非管理状态仍只预览前 6 张，按钮无溢出。
2. 点击“管理本次”，列表原地展开全部待复习字卡，默认无选中。
3. 点击不同字卡，验证整卡可选择、勾选态清晰、数量同步。
4. 验证全选、取消全选、退出管理和再次进入。
5. 选择第一批后开始复习，复习页只包含所选字卡。
6. 完成第一批返回首页，其余待复习字卡仍在，可继续选择第二批。
7. 点击普通“开始复习”，验证仍加载全部系统待复习字卡。
8. 进入字卡库使用“选择复习”，验证仍采用追加模式。
9. 切换至少两种设备宽度，确认标题、选择器和批次操作区不溢出。

Expected: 构建无错误，九项操作全部符合设计。

- [ ] **Step 4: 记录最终验证证据并准备合并**

Run: `git log --oneline --decorate -6`

Expected: 设计、计划、队列模式、复习页和首页实现提交清晰可追溯。
