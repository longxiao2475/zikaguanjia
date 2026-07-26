# Review Queue, Library Search, and Interaction Fixes Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 修复字卡详情、首页统计、认字日布局和首次复习缺陷，并交付汉字片段搜索与多选临时复习队列。

**Architecture:** 云数据库继续作为字卡与复习结果权威数据源；`cardService` 增加关键字过滤和按 ID 补查能力。手动选择只写入 30 分钟有效的一次性本地队列，复习页补查权威字卡后与今日计划合并去重，不新增数据库表或长期卡片状态。

**Tech Stack:** 微信小程序原生 WXML/WXSS/JavaScript、微信云开发、Node.js `node:test`、CloudBase 云函数。

---

## File map

- `miniprogram/utils/review.js`：前端复习调度规则。
- `cloudfunctions/cardService/review.js`：云端复习调度规则。
- `cloudfunctions/cardService/service.js`：字卡搜索、分页和按 ID 补查。
- `cloudfunctions/cardService/index.js`：公开 `getByIds` action。
- `miniprogram/utils/card.js`：前端字卡 API 封装。
- `miniprogram/utils/cache.js`：字卡库筛选意图与一次性复习队列缓存。
- `miniprogram/utils/review-queue.js`：选择 ID 处理和自动/手动字卡合并纯函数。
- `miniprogram/pages/index/*`：统计卡导航。
- `miniprogram/pages/library/*`：片段搜索、多选和开始复习操作栏。
- `miniprogram/pages/review/*`：读取临时队列、补查字卡并合并。
- `miniprogram/pages/settings/*`：七天 Flex 布局与开发文案清理。
- `tests/*.test.js`：调度、搜索、缓存、合并和页面结构回归测试。
- `ai_wiki/字卡管家-MVP开发计划-v1.0.md`：记录本轮完成状态与拼音搜索后续项。

---

### Task 1: 修复从未复习的历史字卡调度

**Files:**
- Modify: `tests/review.test.js`
- Modify: `tests/card-service.test.js`
- Modify: `miniprogram/utils/review.js`
- Modify: `cloudfunctions/cardService/review.js`

- [ ] **Step 1: 写前端调度失败测试**

在 `tests/review.test.js` 的首个调度测试后增加：

```js
test('从未复习的一般和熟练字卡也进入首次复习', () => {
  const cards = [
    { _id: 'normal-new', proficiency: 'normal', lastReviewAt: null },
    { _id: 'proficient-new', proficiency: 'proficient', lastReviewAt: null },
  ];

  assert.deepEqual(
    getTodayReviewCards(cards, TODAY).map((card) => card._id),
    ['normal-new', 'proficient-new'],
  );
});
```

- [ ] **Step 2: 写云端计划失败测试**

在 `tests/card-service.test.js` 增加：

```js
test('已学过但从未复习的字卡进入今日计划', async () => {
  const repository = createMemoryRepository({
    cards: [
      {
        _id: 'history-1',
        childId: 'child-1',
        normalizedContent: '合作',
        status: 'active',
        proficiency: 'normal',
        lastReviewAt: null,
      },
    ],
  });
  const service = createCardService(repository, {
    now: () => new Date('2026-07-25T04:00:00.000Z'),
  });

  const result = await service.getTodayPlan('openid-1', { childId: 'child-1' });

  assert.deepEqual(result.cards.map((card) => card._id), ['history-1']);
});
```

- [ ] **Step 3: 运行测试并确认正确失败**

Run:

```bash
node --test tests/review.test.js tests/card-service.test.js
```

Expected: 两个新测试 FAIL，因为 `lastReviewAt=null` 时当前逻辑只接受 `unfamiliar`。

- [ ] **Step 4: 最小修复前后端调度规则**

将 `miniprogram/utils/review.js` 和 `cloudfunctions/cardService/review.js` 的 `isDue` 开头统一为：

```js
function isDue(card, today = new Date()) {
  if (!card || card.status === 'deleted') return false;
  if (!card.lastReviewAt) return true;

  const elapsedDays = daysSince(card.lastReviewAt, today);
  if (card.proficiency === 'unfamiliar') return true;
  if (card.proficiency === 'normal') return elapsedDays >= 2;
  if (card.proficiency === 'proficient') return elapsedDays >= 7;
  return false;
}
```

云端文件保留它现有的 `dayNumber` / `toTimestamp` 命名，只将无 `lastReviewAt` 分支改为 `return true`；不要复制前端不存在的辅助函数。

- [ ] **Step 5: 运行调度测试并确认通过**

Run:

```bash
node --test tests/review.test.js tests/card-service.test.js
```

Expected: PASS，0 failures。

- [ ] **Step 6: 提交调度修复**

```bash
git add tests/review.test.js tests/card-service.test.js miniprogram/utils/review.js cloudfunctions/cardService/review.js
git commit -m "fix: schedule unreviewed cards for first review"
```

---

### Task 2: 增加汉字片段搜索和按 ID 补查接口

**Files:**
- Modify: `tests/card-service.test.js`
- Modify: `tests/frontend-api.test.js`
- Modify: `cloudfunctions/cardService/service.js`
- Modify: `cloudfunctions/cardService/index.js`
- Modify: `miniprogram/utils/card.js`

- [ ] **Step 1: 写服务端搜索失败测试**

在 `tests/card-service.test.js` 增加：

```js
test('列表按标准化后的汉字片段搜索并叠加筛选', async () => {
  const repository = createMemoryRepository({
    cards: [
      { _id: 'a', childId: 'child-1', content: '礼物', normalizedContent: '礼物', status: 'active', proficiency: 'unfamiliar', lastReviewAt: null },
      { _id: 'b', childId: 'child-1', content: '合作', normalizedContent: '合作', status: 'active', proficiency: 'normal', lastReviewAt: '2026-07-23T04:00:00.000Z' },
      { _id: 'c', childId: 'child-1', content: '吃饭', normalizedContent: '吃饭', status: 'active', proficiency: 'proficient', lastReviewAt: '2026-07-24T04:00:00.000Z' },
    ],
  });
  const service = createCardService(repository, {
    now: () => new Date('2026-07-25T04:00:00.000Z'),
  });

  const result = await service.list('openid-1', {
    childId: 'child-1',
    filter: 'due',
    keyword: ' 礼 ',
    page: 1,
    pageSize: 20,
  });

  assert.deepEqual(result.items.map((card) => card._id), ['a']);
  assert.equal(result.total, 1);
  assert.deepEqual(result.counts, { all: 3, due: 2, mastered: 1 });
});
```

- [ ] **Step 2: 写按 ID 补查失败测试**

在同一测试文件增加：

```js
test('按 ID 补查只返回当前孩子的活动字卡并保持请求顺序', async () => {
  const repository = createMemoryRepository({
    cards: [
      { _id: 'a', ownerOpenid: 'openid-1', childId: 'child-1', status: 'active', content: '礼' },
      { _id: 'b', ownerOpenid: 'openid-1', childId: 'child-1', status: 'deleted', content: '物' },
      { _id: 'c', ownerOpenid: 'openid-1', childId: 'other-child', status: 'active', content: '吃' },
      { _id: 'd', ownerOpenid: 'openid-1', childId: 'child-1', status: 'active', content: '饭' },
    ],
  });
  const service = createCardService(repository);

  const result = await service.getByIds('openid-1', {
    childId: 'child-1',
    cardIds: ['d', 'b', 'a', 'a', 'c'],
  });

  assert.deepEqual(result.map((card) => card._id), ['d', 'a']);
  await assert.rejects(
    () => service.getByIds('openid-1', {
      childId: 'child-1',
      cardIds: Array.from({ length: 51 }, (_, index) => `card-${index}`),
    }),
    (error) => error.code === 'CARD_IDS_TOO_MANY',
  );
});
```

- [ ] **Step 3: 写前端 API 失败测试**

在 `tests/frontend-api.test.js` 增加：

```js
test('搜索列表透传 keyword，按 ID 补查调用 getByIds', async () => {
  cache.setCards([{ _id: 'keep' }]);
  global.__cloudResponse = { result: { ok: true, data: { items: [] } } };
  await cardApi.listCards({ childId: 'c1', filter: 'all', keyword: '礼', page: 1 });
  assert.equal(calls[0].data.keyword, '礼');
  assert.deepEqual(cache.getCards(), [{ _id: 'keep' }]);

  global.__cloudResponse = { result: { ok: true, data: [{ _id: 'a' }] } };
  const cards = await cardApi.getCardsByIds('c1', ['a']);
  assert.deepEqual(calls[1].data, {
    action: 'getByIds',
    childId: 'c1',
    cardIds: ['a'],
  });
  assert.deepEqual(cards, [{ _id: 'a' }]);
});
```

- [ ] **Step 4: 运行测试并确认缺少功能**

Run:

```bash
node --test tests/card-service.test.js tests/frontend-api.test.js
```

Expected: FAIL，搜索仍返回未过滤列表，`service.getByIds` 和 `cardApi.getCardsByIds` 尚不存在。

- [ ] **Step 5: 实现服务端搜索**

在 `cloudfunctions/cardService/service.js` 中复用 `normalizeContent`，将 `list` 的筛选部分改为：

```js
const todayCards = getTodayReviewCards(allCards, now());
const masteredCards = allCards.filter((card) => card.proficiency === 'proficient');
const filter = ['all', 'due', 'mastered'].includes(payload.filter) ? payload.filter : 'all';
const byFilter = filter === 'due' ? todayCards : filter === 'mastered' ? masteredCards : allCards;
const keyword = normalizeContent(payload.keyword || '');
const filtered = keyword
  ? byFilter.filter((card) => normalizeContent(card.normalizedContent || card.content).includes(keyword))
  : byFilter;
```

保留分页逻辑，并继续从未应用关键字的集合计算：

```js
counts: {
  all: allCards.length,
  due: todayCards.length,
  mastered: masteredCards.length,
},
```

- [ ] **Step 6: 实现 `getByIds` 服务方法**

在 `createCardService` 内增加：

```js
async function getByIds(openid, payload = {}) {
  await assertChildOwnership(openid, payload.childId);
  const rawIds = Array.isArray(payload.cardIds) ? payload.cardIds : [];
  if (rawIds.length > 50) {
    throw businessError('CARD_IDS_TOO_MANY', '一次最多选择 50 张字卡');
  }
  const cardIds = [...new Set(rawIds.filter((id) => typeof id === 'string' && id.trim()).map((id) => id.trim()))];
  const cards = await Promise.all(cardIds.map((id) => repository.findCardById(id)));
  return cards.filter((card) => (
    card
    && card.childId === payload.childId
    && card.ownerOpenid === openid
    && card.status === 'active'
  ));
}
```

将它加入返回对象：

```js
return {
  create,
  getByIds,
  getTodayPlan,
  list,
  remove,
  update,
};
```

- [ ] **Step 7: 暴露云函数 action 和前端封装**

在 `cloudfunctions/cardService/index.js` 的 `actions` 增加：

```js
getByIds: service.getByIds,
```

在 `miniprogram/utils/card.js` 增加：

```js
async function getCardsByIds(childId, cardIds) {
  return callFunction('cardService', {
    action: 'getByIds',
    childId,
    cardIds,
  });
}
```

并在 `module.exports` 增加 `getCardsByIds`。

同时把 `listCards` 的缓存覆盖条件收紧为无关键字的全部列表首页：

```js
if ((payload.filter || 'all') === 'all'
  && !String(payload.keyword || '').trim()
  && Number(payload.page || 1) === 1) {
  cache.setCards(result.items || []);
  cache.setLastSyncAt(Date.now());
}
```

- [ ] **Step 8: 运行搜索和 API 测试**

Run:

```bash
node --test tests/card-service.test.js tests/frontend-api.test.js
```

Expected: PASS，0 failures。

- [ ] **Step 9: 提交搜索和补查接口**

```bash
git add tests/card-service.test.js tests/frontend-api.test.js cloudfunctions/cardService/service.js cloudfunctions/cardService/index.js miniprogram/utils/card.js
git commit -m "feat: add card search and selected card lookup"
```

---

### Task 3: 增加临时筛选意图、复习队列和合并纯函数

**Files:**
- Create: `miniprogram/utils/review-queue.js`
- Create: `tests/review-queue.test.js`
- Modify: `miniprogram/utils/cache.js`
- Modify: `tests/cache.test.js`

- [ ] **Step 1: 写合并与选择失败测试**

创建 `tests/review-queue.test.js`：

```js
const test = require('node:test');
const assert = require('node:assert/strict');

const {
  mergeReviewCards,
  toggleSelectedId,
} = require('../miniprogram/utils/review-queue');

test('自动计划在前、手动选择在后并按 id 去重', () => {
  const merged = mergeReviewCards(
    [{ _id: 'a' }, { _id: 'b' }],
    [{ _id: 'b' }, { _id: 'c' }, null],
  );
  assert.deepEqual(merged.map((card) => card._id), ['a', 'b', 'c']);
});

test('切换选择保持顺序并支持取消', () => {
  assert.deepEqual(toggleSelectedId(['a'], 'b'), ['a', 'b']);
  assert.deepEqual(toggleSelectedId(['a', 'b'], 'a'), ['b']);
  assert.deepEqual(toggleSelectedId(['a'], ''), ['a']);
});
```

- [ ] **Step 2: 写缓存时效和消费失败测试**

在 `tests/cache.test.js` 增加：

```js
test('字卡库筛选意图只消费一次', () => {
  cache.setLibraryFilterIntent('due');
  assert.equal(cache.consumeLibraryFilterIntent(), 'due');
  assert.equal(cache.consumeLibraryFilterIntent(), null);
  cache.setLibraryFilterIntent('invalid');
  assert.equal(cache.consumeLibraryFilterIntent(), null);
});

test('临时复习队列校验时效并由调用方成功后清除', () => {
  cache.setManualReviewQueue(['a', 'a', 'b'], 1000);
  assert.deepEqual(cache.getManualReviewQueue(1000 + 29 * 60 * 1000), {
    cardIds: ['a', 'b'],
    createdAt: 1000,
  });
  cache.clearManualReviewQueue();
  assert.equal(cache.getManualReviewQueue(1001), null);

  cache.setManualReviewQueue(['a'], 1000);
  assert.equal(cache.getManualReviewQueue(1000 + 31 * 60 * 1000), null);
});
```

- [ ] **Step 3: 运行测试并确认模块和方法缺失**

Run:

```bash
node --test tests/review-queue.test.js tests/cache.test.js
```

Expected: FAIL，`review-queue` 模块和新缓存 API 不存在。

- [ ] **Step 4: 实现纯函数模块**

创建 `miniprogram/utils/review-queue.js`：

```js
function normalizeIds(ids) {
  return [...new Set((Array.isArray(ids) ? ids : [])
    .filter((id) => typeof id === 'string' && id.trim())
    .map((id) => id.trim()))];
}

function toggleSelectedId(ids, targetId) {
  const selected = normalizeIds(ids);
  const id = typeof targetId === 'string' ? targetId.trim() : '';
  if (!id) return selected;
  return selected.includes(id)
    ? selected.filter((item) => item !== id)
    : [...selected, id];
}

function mergeReviewCards(autoCards, manualCards) {
  const merged = [];
  const seen = new Set();
  for (const card of [...(autoCards || []), ...(manualCards || [])]) {
    if (!card || !card._id || seen.has(card._id)) continue;
    seen.add(card._id);
    merged.push(card);
  }
  return merged;
}

module.exports = {
  mergeReviewCards,
  normalizeIds,
  toggleSelectedId,
};
```

- [ ] **Step 5: 扩展缓存模块**

在 `miniprogram/utils/cache.js` 的 `KEYS` 增加：

```js
libraryFilterIntent: 'zkg:libraryFilterIntent',
manualReviewQueue: 'zkg:manualReviewQueue',
```

在模块顶部增加：

```js
const MANUAL_REVIEW_QUEUE_TTL_MS = 30 * 60 * 1000;
const LIBRARY_FILTERS = new Set(['all', 'due', 'mastered']);

function normalizeIds(ids) {
  return [...new Set((Array.isArray(ids) ? ids : [])
    .filter((id) => typeof id === 'string' && id.trim())
    .map((id) => id.trim()))];
}
```

在 `module.exports` 增加：

```js
setLibraryFilterIntent(filter) {
  if (!LIBRARY_FILTERS.has(filter)) {
    wx.removeStorageSync(KEYS.libraryFilterIntent);
    return null;
  }
  return write(KEYS.libraryFilterIntent, filter);
},
consumeLibraryFilterIntent() {
  const filter = read(KEYS.libraryFilterIntent, null);
  wx.removeStorageSync(KEYS.libraryFilterIntent);
  return LIBRARY_FILTERS.has(filter) ? filter : null;
},
setManualReviewQueue(cardIds, createdAt = Date.now()) {
  const ids = normalizeIds(cardIds).slice(0, 50);
  if (!ids.length) {
    wx.removeStorageSync(KEYS.manualReviewQueue);
    return null;
  }
  return write(KEYS.manualReviewQueue, { cardIds: ids, createdAt });
},
getManualReviewQueue(now = Date.now()) {
  const queue = read(KEYS.manualReviewQueue, null);
  if (!queue || !Array.isArray(queue.cardIds) || typeof queue.createdAt !== 'number'
    || now - queue.createdAt > MANUAL_REVIEW_QUEUE_TTL_MS) {
    wx.removeStorageSync(KEYS.manualReviewQueue);
    return null;
  }
  return { cardIds: normalizeIds(queue.cardIds).slice(0, 50), createdAt: queue.createdAt };
},
clearManualReviewQueue() {
  wx.removeStorageSync(KEYS.manualReviewQueue);
},
```

保留 `clearBusinessCache` 对全部 `KEYS` 的清除能力。

- [ ] **Step 6: 运行缓存和合并测试**

Run:

```bash
node --test tests/review-queue.test.js tests/cache.test.js
```

Expected: PASS，0 failures。

- [ ] **Step 7: 提交临时状态基础设施**

```bash
git add miniprogram/utils/review-queue.js tests/review-queue.test.js miniprogram/utils/cache.js tests/cache.test.js
git commit -m "feat: add temporary review queue state"
```

---

### Task 4: 首页统计导航与字卡库搜索、多选界面

**Files:**
- Modify: `tests/project-structure.test.js`
- Modify: `miniprogram/pages/index/index.js`
- Modify: `miniprogram/pages/index/index.wxml`
- Modify: `miniprogram/pages/index/index.wxss`
- Modify: `miniprogram/pages/library/index.js`
- Modify: `miniprogram/pages/library/index.wxml`
- Modify: `miniprogram/pages/library/index.wxss`

- [ ] **Step 1: 写页面结构失败测试**

在 `tests/project-structure.test.js` 增加：

```js
test('首页统计卡可导航到字卡库筛选', () => {
  const indexJs = read('miniprogram/pages/index/index.js');
  const indexWxml = read('miniprogram/pages/index/index.wxml');
  assert.equal(indexJs.includes('setLibraryFilterIntent'), true);
  for (const filter of ['all', 'mastered', 'due']) {
    assert.equal(indexWxml.includes(`data-filter="${filter}"`), true);
  }
  assert.equal(indexWxml.includes('bindtap="onOpenLibrary"'), true);
});

test('字卡库包含搜索、多选和开始复习入口', () => {
  const libraryJs = read('miniprogram/pages/library/index.js');
  const libraryWxml = read('miniprogram/pages/library/index.wxml');
  for (const token of [
    'onKeywordInput',
    'onClearKeyword',
    'onToggleSelectionMode',
    'onToggleCardSelection',
    'onStartSelectedReview',
  ]) {
    assert.equal(libraryJs.includes(token), true, `missing ${token}`);
  }
  assert.equal(libraryWxml.includes('placeholder="搜索字或词"'), true);
  assert.equal(libraryWxml.includes('已选 {{selectedCount}} 张'), true);
  assert.equal(libraryWxml.includes('开始复习'), true);
});
```

- [ ] **Step 2: 运行结构测试并确认失败**

Run:

```bash
node --test tests/project-structure.test.js
```

Expected: FAIL，因为页面还没有统计导航、搜索和多选事件。

- [ ] **Step 3: 实现首页筛选导航**

将 `miniprogram/pages/index/index.js` 的 `onOpenLibrary` 改为：

```js
onOpenLibrary(event = {}) {
  const filter = event.currentTarget && event.currentTarget.dataset
    ? event.currentTarget.dataset.filter
    : 'all';
  cache.setLibraryFilterIntent(filter || 'all');
  wx.switchTab({ url: '/pages/library/index' });
},
```

将三个 `overview-item` 改为带 `tap-card`、筛选数据和事件的节点：

```xml
<view class="overview-item surface-card tap-card" data-filter="all" bindtap="onOpenLibrary">
  <view class="overview-item__value">{{plan.overview.total}}</view>
  <view class="overview-item__label">总字数</view>
</view>
<view class="overview-item surface-card tap-card" data-filter="mastered" bindtap="onOpenLibrary">
  <view class="overview-item__value overview-item__value--green">{{plan.overview.mastered}}</view>
  <view class="overview-item__label">已掌握</view>
</view>
<view class="overview-item surface-card tap-card" data-filter="due" bindtap="onOpenLibrary">
  <view class="overview-item__value overview-item__value--orange">{{plan.overview.due}}</view>
  <view class="overview-item__label">待复习</view>
</view>
```

给“全部字卡”按钮增加 `data-filter="all"`。

- [ ] **Step 4: 扩展字卡库页面状态和加载参数**

在 `miniprogram/pages/library/index.js` 顶部增加：

```js
const cache = require('../../utils/cache');
const { toggleSelectedId } = require('../../utils/review-queue');
```

在 `data` 增加：

```js
keyword: '',
selectionMode: false,
selectedIds: [],
selectedCount: 0,
```

将 `onShow` 改为：

```js
onShow() {
  const intendedFilter = cache.consumeLibraryFilterIntent();
  if (intendedFilter && intendedFilter !== this.data.selectedFilter) {
    this.setData({ selectedFilter: intendedFilter, items: [], page: 1, hasMore: false });
  }
  this.loadCards(true);
},
```

将 `loadCards` 开头改为：

```js
async loadCards(reset = false) {
  if (this._loading) {
    if (reset) this._reloadAfterCurrent = true;
    return;
  }
  this._loading = true;
```

在它的 `finally` 完成 loading 状态恢复后增加：

```js
const shouldReload = this._reloadAfterCurrent;
this._reloadAfterCurrent = false;
if (shouldReload) this.loadCards(true);
```

这样慢请求期间触发的搜索或筛选刷新不会被直接丢弃。

在 `cardApi.listCards` 请求中加入：

```js
keyword: this.data.keyword,
```

映射列表时增加选中态：

```js
const incoming = (result.items || []).map((card) => ({
  ...decorateCard(card),
  selected: this.data.selectedIds.includes(card._id),
}));
```

- [ ] **Step 5: 实现搜索和多选事件**

在页面对象中增加：

```js
onKeywordInput(event) {
  const keyword = event.detail.value;
  this.setData({ keyword });
  clearTimeout(this._searchTimer);
  this._searchTimer = setTimeout(() => this.loadCards(true), 300);
},

onClearKeyword() {
  clearTimeout(this._searchTimer);
  this.setData({ keyword: '' });
  this.loadCards(true);
},

onToggleSelectionMode() {
  const selectionMode = !this.data.selectionMode;
  const selectedIds = selectionMode ? this.data.selectedIds : [];
  this.setData({
    selectionMode,
    selectedIds,
    selectedCount: selectedIds.length,
    items: this.data.items.map((item) => ({
      ...item,
      selected: selectedIds.includes(item._id),
    })),
  });
},

onToggleCardSelection(event) {
  const targetId = event.currentTarget.dataset.id;
  if (!this.data.selectedIds.includes(targetId) && this.data.selectedIds.length >= 50) {
    wx.showToast({ title: '一次最多选择 50 张', icon: 'none' });
    return;
  }
  const selectedIds = toggleSelectedId(this.data.selectedIds, targetId);
  this.setData({
    selectedIds,
    selectedCount: selectedIds.length,
    items: this.data.items.map((item) => ({
      ...item,
      selected: selectedIds.includes(item._id),
    })),
  });
},

onStartSelectedReview() {
  if (!this.data.selectedIds.length) return;
  cache.setManualReviewQueue(this.data.selectedIds);
  this.setData({ selectionMode: false, selectedIds: [], selectedCount: 0 });
  wx.navigateTo({ url: '/pages/review/index?source=manual' });
},
```

在 `onUnload` 增加 `clearTimeout(this._searchTimer);`。

- [ ] **Step 6: 实现字卡库 WXML**

在标题区后加入：

```xml
<view class="library-tools">
  <view class="library-search surface-card">
    <input
      class="library-search__input"
      value="{{keyword}}"
      placeholder="搜索字或词"
      confirm-type="search"
      bindinput="onKeywordInput"
    />
    <button wx:if="{{keyword}}" class="library-search__clear" bindtap="onClearKeyword">清除</button>
  </view>
  <button class="secondary-button library-select" bindtap="onToggleSelectionMode">
    {{selectionMode ? '取消选择' : '选择复习'}}
  </button>
</view>
```

将列表项改为分离选择区和详情区：

```xml
<view class="word-card surface-card" wx:for="{{items}}" wx:key="_id">
  <button
    wx:if="{{selectionMode}}"
    class="word-card__selector {{item.selected ? 'word-card__selector--selected' : ''}}"
    data-id="{{item._id}}"
    bindtap="onToggleCardSelection"
    aria-label="{{item.selected ? '取消选择' : '选择'}}{{item.content}}"
  >{{item.selected ? '✓' : ''}}</button>
  <view wx:else class="proficiency-dot proficiency-dot--{{item.proficiencyClass}}"></view>
  <view class="word-card__main" data-id="{{item._id}}" bindtap="onOpenWordSheet">
    <view class="word-card__topline">
      <view class="word-card__content">{{item.content}}</view>
      <view class="word-card__type">{{item.typeLabel}}</view>
    </view>
    <view class="word-card__meta">{{item.proficiencyLabel}} · {{item.lastReviewLabel}} · 复习 {{item.reviewCount || 0}} 次</view>
  </view>
</view>
```

在 `word-sheet` 前加入底部操作栏：

```xml
<view wx:if="{{selectionMode}}" class="selection-bar">
  <view class="selection-bar__count">已选 {{selectedCount}} 张</view>
  <button
    class="primary-button selection-bar__button"
    bindtap="onStartSelectedReview"
    disabled="{{selectedCount === 0}}"
  >开始复习</button>
</view>
```

无结果标题在有关键字时使用“没有找到相关字卡”，并提供调用 `onClearKeyword` 的“清空搜索”按钮。

- [ ] **Step 7: 增加搜索、多选和点击反馈样式**

在 `miniprogram/pages/index/index.wxss` 增加：

```css
.overview-item {
  transition: opacity 180ms ease, transform 180ms ease;
}
```

在 `miniprogram/pages/library/index.wxss` 增加：

```css
.library-page {
  padding-bottom: calc(170rpx + env(safe-area-inset-bottom));
}

.library-tools {
  display: flex;
  gap: 14rpx;
  align-items: center;
  margin-bottom: 18rpx;
}

.library-search {
  min-width: 0;
  min-height: 82rpx;
  padding: 0 18rpx 0 24rpx;
  display: flex;
  align-items: center;
  flex: 1;
}

.library-search__input {
  min-width: 0;
  flex: 1;
  font-size: 27rpx;
}

.library-search__clear {
  min-width: 80rpx;
  color: var(--color-primary-dark);
  font-size: 23rpx;
}

.library-select {
  width: 160rpx;
  min-height: 82rpx;
  flex: 0 0 auto;
  font-size: 24rpx;
}

.word-card__selector {
  width: 44rpx;
  height: 44rpx;
  border: 2rpx solid #D7D1CB;
  border-radius: 22rpx;
  color: #FFFFFF;
  display: flex;
  align-items: center;
  justify-content: center;
  flex: 0 0 auto;
  font-size: 26rpx;
}

.word-card__selector--selected {
  border-color: var(--color-primary);
  background: var(--color-primary);
}

.selection-bar {
  position: fixed;
  left: 24rpx;
  right: 24rpx;
  bottom: calc(22rpx + env(safe-area-inset-bottom));
  z-index: 20;
  padding: 18rpx 20rpx;
  border-radius: 30rpx;
  background: #FFFFFF;
  box-shadow: 0 14rpx 38rpx rgba(83, 58, 42, 0.18);
  display: flex;
  align-items: center;
  gap: 20rpx;
}

.selection-bar__count {
  flex: 1;
  font-size: 27rpx;
  font-weight: 650;
}

.selection-bar__button {
  width: 240rpx;
}
```

- [ ] **Step 8: 运行结构测试和相关回归测试**

Run:

```bash
node --test tests/project-structure.test.js tests/cache.test.js tests/review-queue.test.js
```

Expected: PASS，0 failures。

- [ ] **Step 9: 提交首页和字卡库交互**

```bash
git add tests/project-structure.test.js miniprogram/pages/index miniprogram/pages/library
git commit -m "feat: add library search and multi-select review"
```

---

### Task 5: 复习页消费临时队列并修复组词组件路径

**Files:**
- Modify: `tests/review-queue.test.js`
- Modify: `tests/project-structure.test.js`
- Modify: `miniprogram/pages/review/index.js`
- Modify: `miniprogram/pages/review/index.json`
- Modify: `miniprogram/pages/library/index.json`

- [ ] **Step 1: 写相对组件路径解析失败测试**

将 `tests/project-structure.test.js` 的组件测试改为真实路径解析：

```js
test('复习页和字卡库的 word-sheet 相对路径可解析', () => {
  for (const page of ['review', 'library']) {
    const configPath = `miniprogram/pages/${page}/index.json`;
    const config = JSON.parse(read(configPath));
    const componentPath = config.usingComponents['word-sheet'];
    assert.equal(componentPath.startsWith('../../components/'), true);
    const resolved = path.resolve(
      root,
      `miniprogram/pages/${page}`,
      `${componentPath}.json`,
    );
    assert.equal(fs.existsSync(resolved), true, `${page} word-sheet should resolve`);
  }
});
```

- [ ] **Step 2: 补充合并场景测试**

在 `tests/review-queue.test.js` 增加：

```js
test('手动补查部分失效时只合并有效字卡', () => {
  const merged = mergeReviewCards(
    [{ _id: 'today', content: '礼' }],
    [{ _id: 'manual', content: '物' }],
  );
  assert.deepEqual(merged.map((card) => card._id), ['today', 'manual']);
});
```

- [ ] **Step 3: 运行测试并确认绝对路径不符合设计**

Run:

```bash
node --test tests/project-structure.test.js tests/review-queue.test.js
```

Expected: FAIL，因为两个页面仍使用 `/components/word-sheet/index`。

- [ ] **Step 4: 修改组件引用为相对路径**

将 `miniprogram/pages/review/index.json` 和 `miniprogram/pages/library/index.json` 中的引用统一改为：

```json
"word-sheet": "../../components/word-sheet/index"
```

- [ ] **Step 5: 复习页读取、补查并合并手动队列**

在 `miniprogram/pages/review/index.js` 顶部增加：

```js
const { mergeReviewCards } = require('../../utils/review-queue');
```

将 `onLoad` 改为：

```js
onLoad(options = {}) {
  this._manualSource = options.source === 'manual';
  const cached = cache.getTodayPlan();
  if (cached && !this._manualSource) this.applyPlan(cached);
  this.loadPlan();
},
```

将 `loadPlan` 改为：

```js
async loadPlan() {
  this.setData({ loading: !this.data.cards.length, errorMessage: '' });
  try {
    let { child } = session.getCachedSession();
    if (!child) ({ child } = await session.bootstrap());
    const plan = await cardApi.getTodayPlan(child._id);
    let cards = plan.cards || [];

    if (this._manualSource) {
      const queue = cache.getManualReviewQueue();
      if (queue && queue.cardIds.length) {
        const manualCards = await cardApi.getCardsByIds(child._id, queue.cardIds);
        cards = mergeReviewCards(cards, manualCards);
        if (manualCards.length < queue.cardIds.length) {
          wx.showToast({ title: '部分字卡已不可用', icon: 'none' });
        }
        cache.clearManualReviewQueue();
      }
      this._manualSource = false;
    }

    this.applyPlan({ ...plan, cards });
  } catch (error) {
    this.setData({ errorMessage: error.message || '复习计划加载失败' });
  } finally {
    this.setData({ loading: false });
  }
},
```

队列只在补查和合并成功后清除；请求失败时保留，用户重试仍能恢复选择。

- [ ] **Step 6: 运行组件和队列测试**

Run:

```bash
node --test tests/project-structure.test.js tests/review-queue.test.js tests/frontend-api.test.js
```

Expected: PASS，0 failures。

- [ ] **Step 7: 提交复习队列集成和组件路径修复**

```bash
git add tests/review-queue.test.js tests/project-structure.test.js miniprogram/pages/review/index.js miniprogram/pages/review/index.json miniprogram/pages/library/index.json
git commit -m "fix: load manual review queue and word sheet component"
```

---

### Task 6: 修复认字日布局并清理 Day 5 文案

**Files:**
- Modify: `tests/project-structure.test.js`
- Modify: `miniprogram/pages/settings/index.wxml`
- Modify: `miniprogram/pages/settings/index.wxss`

- [ ] **Step 1: 写设置页失败测试**

在 `tests/project-structure.test.js` 增加：

```js
test('设置页完整保留七天选择并移除开发阶段文案', () => {
  const settingsJs = read('miniprogram/pages/settings/index.js');
  const settingsWxml = read('miniprogram/pages/settings/index.wxml');
  const settingsWxss = read('miniprogram/pages/settings/index.wxss');
  assert.equal((settingsJs.match(/label: '[一二三四五六日]'/g) || []).length, 7);
  assert.equal(settingsWxml.includes('字卡管家 MVP · Day 5'), false);
  assert.equal(settingsWxss.includes('grid-template-columns: repeat(7'), false);
  assert.equal(settingsWxss.includes('display: flex'), true);
  assert.equal(settingsWxss.includes('flex-wrap: wrap'), true);
});
```

- [ ] **Step 2: 运行结构测试并确认失败**

Run:

```bash
node --test tests/project-structure.test.js
```

Expected: FAIL，因为设置页仍使用七列 Grid 且仍包含 Day 5 文案。

- [ ] **Step 3: 删除开发阶段文案**

从 `miniprogram/pages/settings/index.wxml` 删除：

```xml
<view class="version-text">字卡管家 MVP · Day 5</view>
```

- [ ] **Step 4: 改用兼容性更好的 Flex 七天布局**

将 `miniprogram/pages/settings/index.wxss` 的 `.day-picker` 和 `.day-picker__item` 改为：

```css
.day-picker {
  margin-top: 20rpx;
  display: flex;
  flex-wrap: wrap;
  gap: 14rpx;
}

.day-picker__item {
  width: 68rpx;
  height: 68rpx;
  border-radius: 34rpx;
  color: var(--color-text-secondary);
  background: #F4F1ED;
  display: flex;
  align-items: center;
  justify-content: center;
  flex: 0 0 68rpx;
  font-size: 25rpx;
}
```

删除不再使用的 `.version-text` 样式块。

- [ ] **Step 5: 运行设置和同步测试**

Run:

```bash
node --test tests/project-structure.test.js tests/sync-settings.test.js
```

Expected: PASS，0 failures。

- [ ] **Step 6: 提交设置页修复**

```bash
git add tests/project-structure.test.js miniprogram/pages/settings/index.wxml miniprogram/pages/settings/index.wxss
git commit -m "fix: show all study days and remove day label"
```

---

### Task 7: 更新开发计划并完成全量验证

**Files:**
- Modify: `ai_wiki/字卡管家-MVP开发计划-v1.0.md`
- Verify: all changed files

- [ ] **Step 1: 更新项目执行状态**

在 `ai_wiki/字卡管家-MVP开发计划-v1.0.md` 顶部最新状态后增加一段日期为 2026-07-26 的联调修复记录，明确写入：

```markdown
> **Day 4 / Day 5 联调修复（2026-07-26）**：已修复 `word-sheet` 组件路径导致的拼音/组词点击无响应、首页统计卡无跳转、已学过且从未复习字卡不进入首次计划、认字日仅显示部分按钮和 Day 5 开发提示等问题；字卡库新增汉字/词语片段搜索、多选临时复习队列，选中字卡与今日计划合并去重后复习。拼音搜索延期到后续阶段，不纳入当前 MVP。
```

同时把 Day 4、Day 5 状态中的“待真实联调”描述改为准确现状：云函数已由用户上传部署，`sendReminder` 每小时触发器已创建；本轮修改后的 `cardService` 仍需重新上传部署并在开发者工具验收。

- [ ] **Step 2: 运行完整自动测试**

Run:

```bash
npm test
```

Expected: 全部测试 PASS，0 failures，测试数量高于修改前的 60 项。

- [ ] **Step 3: 检查格式、残留文案和组件路径**

Run:

```bash
git diff --check
rg -n "MVP · Day 5|/components/word-sheet/index|grid-template-columns: repeat\(7" miniprogram
```

Expected: `git diff --check` 无输出；`rg` 无匹配。

- [ ] **Step 4: 检查最终变更范围**

Run:

```bash
git status --short
git diff --stat HEAD
```

Expected: 仅包含本计划列出的代码、测试和开发计划文件，没有无关文件。

- [ ] **Step 5: 提交文档和最终整合**

```bash
git add ai_wiki/字卡管家-MVP开发计划-v1.0.md
git commit -m "docs: record review queue and interaction fixes"
```

- [ ] **Step 6: 微信开发者工具人工验收清单**

打开当前项目根目录并重新编译，逐项验证：

1. Console 不再出现 `Component is not found in path "components/word-sheet/index"`。
2. 复习页点击字卡可看到拼音和组词。
3. 字卡库点击内容可看到相同弹层。
4. 搜索“礼”只显示包含“礼”的字卡，清空恢复列表。
5. 多选“合作”和“吃饭”，开始后与今日计划合并且不重复。
6. 完成复习后两张卡的复习次数与熟练度更新。
7. 首页总字数、已掌握、待复习分别进入正确筛选。
8. 设置页完整显示周一至周日并能保存三天以上组合。
9. 页面不再显示“字卡管家 MVP · Day 5”。

本轮会修改 `cardService`，自动测试完成后需要用户在微信开发者工具重新上传并部署该云函数，之后执行上述端到端验收。
