# Library Unified Filters and Review Age Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a WeChat Mini Program-style unified library filter card, add 7-day/30-day review-age filtering including never-reviewed cards, align the two library actions to the same right edge, and explicitly label last-review information on home and library cards.

**Architecture:** Add a shared review-age predicate to both the cloud card service and Mini Program review utilities, then pass `reviewAgeDays` through the existing card list API. Keep library filter state in the page, combine keyword/status/category/review-age with AND semantics, and render all controls inside one native Mini Program surface card. Preserve the existing category picker, paging, sorting, selection mode, and review scheduling rules.

**Tech Stack:** WeChat Mini Program WXML/WXSS/CommonJS JavaScript, WeChat Cloud Functions, Node.js `node:test`, `miniprogram-automator`, WeChat Developer Tools CLI.

---

### Task 1: Add cloud review-age filtering and scoped counts

**Files:**
- Modify: `cloudfunctions/cardService/review.js`
- Modify: `cloudfunctions/cardService/service.js`
- Test: `tests/card-service.test.js`

- [ ] **Step 1: Write failing service tests**

Add tests that seed never-reviewed, 6-day, 7-day, 29-day, and 30-day cards at a fixed Shanghai business date. Assert that `reviewAgeDays: 7` returns never/7/29/30, `reviewAgeDays: 30` returns never/30, and invalid values behave as no time filter. Add a combined keyword/category/status test and assert that `counts` are computed after keyword/category/review-age but before the selected status.

```js
test('列表按未复习天数筛选并包含从未复习字卡', async () => {
  const repository = createMemoryRepository({ cards: [
    { _id: 'never', childId: 'child-1', content: '青蛙', normalizedContent: '青蛙', status: 'active', proficiency: 'unfamiliar', lastReviewAt: null },
    { _id: 'day-6', childId: 'child-1', content: '六天', normalizedContent: '六天', status: 'active', proficiency: 'normal', lastReviewAt: '2026-07-24T04:00:00.000Z' },
    { _id: 'day-7', childId: 'child-1', content: '七天', normalizedContent: '七天', status: 'active', proficiency: 'normal', lastReviewAt: '2026-07-23T04:00:00.000Z' },
    { _id: 'day-30', childId: 'child-1', content: '三十天', normalizedContent: '三十天', status: 'active', proficiency: 'proficient', lastReviewAt: '2026-06-30T04:00:00.000Z' },
  ] });
  const service = createCardService(repository, { now: () => new Date('2026-07-30T04:00:00.000Z') });

  assert.deepEqual((await service.list('openid-1', { childId: 'child-1', reviewAgeDays: 7 })).items.map((card) => card._id), ['never', 'day-7', 'day-30']);
  assert.deepEqual((await service.list('openid-1', { childId: 'child-1', reviewAgeDays: 30 })).items.map((card) => card._id), ['never', 'day-30']);
});
```

- [ ] **Step 2: Run the focused test and verify RED**

Run: `node --test tests/card-service.test.js`

Expected: FAIL because `reviewAgeDays` is ignored and recent cards remain in the result.

- [ ] **Step 3: Implement the cloud predicate**

In `cloudfunctions/cardService/review.js`, add and export:

```js
function daysSince(value, today) {
  if (!value) return Infinity;
  return dayNumber(today) - dayNumber(value);
}

function matchesReviewAge(card, reviewAgeDays, today) {
  const threshold = [7, 30].includes(Number(reviewAgeDays)) ? Number(reviewAgeDays) : 0;
  return threshold === 0 || daysSince(card && card.lastReviewAt, today) >= threshold;
}
```

Refactor `isDue` to use `daysSince` without changing its thresholds.

- [ ] **Step 4: Apply filtering in the service**

In `cloudfunctions/cardService/service.js`, normalize `reviewAgeDays`, then process list data in this order:

```js
const keywordCards = keyword
  ? categoryCards.filter((card) => normalizeContent(card.normalizedContent || card.content).includes(keyword))
  : categoryCards;
const reviewAgeDays = [7, 30].includes(Number(payload.reviewAgeDays))
  ? Number(payload.reviewAgeDays)
  : 0;
const scopedCards = keywordCards.filter((card) => matchesReviewAge(card, reviewAgeDays, now()));
const todayCards = getTodayReviewCards(scopedCards, now());
const masteredCards = scopedCards.filter((card) => card.proficiency === 'proficient');
const filtered = filter === 'due' ? todayCards : filter === 'mastered' ? masteredCards : scopedCards;
```

Return `counts.all` from `scopedCards.length` so status counts reflect keyword, category, and review-age scope.

- [ ] **Step 5: Run backend tests and verify GREEN**

Run: `node --test tests/card-service.test.js tests/review.test.js`

Expected: all tests pass.

- [ ] **Step 6: Commit backend filtering**

```bash
git add cloudfunctions/cardService/review.js cloudfunctions/cardService/service.js tests/card-service.test.js
git commit -m "feat: filter cards by review age"
```

### Task 2: Pass review age through the Mini Program API and local predicate

**Files:**
- Modify: `miniprogram/utils/review.js`
- Modify: `miniprogram/utils/card.js`
- Test: `tests/review.test.js`
- Test: `tests/frontend-api.test.js`

- [ ] **Step 1: Write failing utility and API tests**

Add assertions for the Shanghai-day predicate and for API payload/cache behavior:

```js
test('未复习天数筛选包含从未复习并按上海自然日计算', () => {
  const today = new Date('2026-07-30T04:00:00.000Z');
  assert.equal(matchesReviewAge({ lastReviewAt: null }, 30, today), true);
  assert.equal(matchesReviewAge({ lastReviewAt: '2026-07-23T04:00:00.000Z' }, 7, today), true);
  assert.equal(matchesReviewAge({ lastReviewAt: '2026-07-24T04:00:00.000Z' }, 7, today), false);
});

test('列表透传未复习天数且筛选列表不覆盖全部缓存', async () => {
  cache.setCards([{ _id: 'keep' }]);
  global.__cloudResponse = { result: { ok: true, data: { items: [{ _id: 'old' }] } } };
  await cardApi.listCards({ childId: 'c1', filter: 'all', reviewAgeDays: 7, page: 1 });
  assert.equal(calls[0].data.reviewAgeDays, 7);
  assert.deepEqual(cache.getCards(), [{ _id: 'keep' }]);
});
```

- [ ] **Step 2: Run focused tests and verify RED**

Run: `node --test tests/review.test.js tests/frontend-api.test.js`

Expected: FAIL because `matchesReviewAge` is not exported and the cache condition ignores review age.

- [ ] **Step 3: Implement the Mini Program predicate**

Add to `miniprogram/utils/review.js`:

```js
function matchesReviewAge(card, reviewAgeDays, today = new Date()) {
  const threshold = [7, 30].includes(Number(reviewAgeDays)) ? Number(reviewAgeDays) : 0;
  return threshold === 0 || daysSince(card && card.lastReviewAt, today) >= threshold;
}
```

Export it without changing `isDue` or sorting behavior.

- [ ] **Step 4: Tighten the list cache condition**

In `miniprogram/utils/card.js`, require `Number(payload.reviewAgeDays || 0) === 0` before replacing the cached full card list. The `callFunction` payload already spreads the input and therefore needs no extra transport layer.

- [ ] **Step 5: Run utility and API tests and verify GREEN**

Run: `node --test tests/review.test.js tests/frontend-api.test.js`

Expected: all tests pass.

- [ ] **Step 6: Commit API and utility support**

```bash
git add miniprogram/utils/review.js miniprogram/utils/card.js tests/review.test.js tests/frontend-api.test.js
git commit -m "feat: pass library review age filter"
```

### Task 3: Add unified filter state and behavior to the library page

**Files:**
- Modify: `miniprogram/pages/library/index.js`
- Test: `tests/library-page.test.js`

- [ ] **Step 1: Write failing page behavior tests**

Extend the test context with `reviewAgeDays: 0` and `hasActiveFilters: false`. Add tests that switch to 7 days, send the combined request, and clear all filters exactly once:

```js
test('未复习时间筛选与名称分类状态组合发送', async () => {
  let payload;
  const definition = loadLibraryPage({
    cardApi: { listCards: async (value) => {
      payload = value;
      return { items: [], total: 0, page: 1, hasMore: false, counts: {} };
    } },
  });
  const context = createContext(definition, {
    selectedFilter: 'mastered',
    keyword: '蛙',
    selectedCategoryFilterIds: ['animal'],
  });

  await definition.onSelectReviewAge.call(context, { currentTarget: { dataset: { days: 7 } } });

  assert.equal(context.data.reviewAgeDays, 7);
  assert.equal(payload.reviewAgeDays, 7);
  assert.equal(payload.filter, 'mastered');
  assert.equal(payload.keyword, '蛙');
  assert.deepEqual(payload.categoryIds, ['animal']);
});
```

Add a clear test asserting keyword `''`, filter `'all'`, review age `0`, empty category IDs, summary `'全部分类'`, `hasActiveFilters === false`, and one `listCards` call.

- [ ] **Step 2: Run page tests and verify RED**

Run: `node --test tests/library-page.test.js`

Expected: FAIL because the time handlers and combined state do not exist.

- [ ] **Step 3: Add page constants and filter state**

Add:

```js
const REVIEW_AGE_OPTIONS = [
  { value: 0, label: '不限' },
  { value: 7, label: '7天未复习' },
  { value: 30, label: '30天未复习' },
];

function hasActiveFilters({ selectedFilter, keyword, selectedCategoryFilterIds, reviewAgeDays }) {
  return selectedFilter !== 'all'
    || Boolean(normalizeEditableContent(keyword))
    || normalizeSelectionIds(selectedCategoryFilterIds).length > 0
    || Number(reviewAgeDays) > 0;
}
```

Add `reviewAgeOptions`, `reviewAgeDays`, and `hasActiveFilters` to page data.

- [ ] **Step 4: Send and locally evaluate the time condition**

Import `matchesReviewAge`. Pass `reviewAgeDays` in `loadCards`. Extend `cardMatchesView` to accept `reviewAgeDays` and reject cards that do not match. Pass the page's current time filter from `onSaveEdit`.

- [ ] **Step 5: Implement filter handlers**

Implement `onSelectReviewAge` and `onClearAllFilters`. Every filter-changing handler must update `hasActiveFilters`, reset paging, close open swipe cards, and call `loadCards(true)` once. Keyword input keeps its 300ms debounce; clear-all cancels that timer.

- [ ] **Step 6: Run page tests and verify GREEN**

Run: `node --test tests/library-page.test.js`

Expected: all tests pass.

- [ ] **Step 7: Commit page behavior**

```bash
git add miniprogram/pages/library/index.js tests/library-page.test.js
git commit -m "feat: combine library filter behavior"
```

### Task 4: Build the Mini Program-style unified filter card and align actions

**Files:**
- Modify: `miniprogram/pages/library/index.wxml`
- Modify: `miniprogram/pages/library/index.wxss`
- Modify: `tests/project-structure.test.js`

- [ ] **Step 1: Write failing structure tests**

Assert that the library uses one `library-filter-card`, contains status and review-age sections, binds `onSelectReviewAge` and `onClearAllFilters`, has three `review-age-option` buttons, and no longer renders separate `library-search surface-card`, `category-filter-bar`, and `filter-tabs surface-card` blocks. Assert both action classes explicitly use zero right margin.

- [ ] **Step 2: Run structure tests and verify RED**

Run: `node --test tests/project-structure.test.js`

Expected: FAIL because the unified container and time controls are missing.

- [ ] **Step 3: Replace the fragmented controls with one card**

Use this hierarchy in `index.wxml`:

```xml
<view class="library-filter-card surface-card">
  <view class="library-filter-search">...</view>
  <view class="library-filter-section">
    <view class="library-filter-section__label">状态</view>
    <view class="filter-tabs">...</view>
  </view>
  <view class="library-filter-section">
    <view class="library-filter-section__label">未复习</view>
    <view class="review-age-options">
      <button wx:for="{{reviewAgeOptions}}" class="review-age-option {{reviewAgeDays === item.value ? 'review-age-option--active' : ''}}" data-days="{{item.value}}" bindtap="onSelectReviewAge">{{item.label}}</button>
    </view>
  </view>
  <button class="library-filter-category" bindtap="onOpenCategoryFilter">...</button>
  <view wx:if="{{hasActiveFilters}}" class="library-filter-actions">...</view>
</view>
```

Keep the existing `category-picker` component unchanged.

- [ ] **Step 4: Implement native Mini Program styling**

Use vertical sections, light `2rpx` dividers, `88rpx` minimum touch targets, three-column grids, visible selected borders/backgrounds, and no horizontal scrolling. Set:

```css
button.library-header__add,
button.library-select {
  margin-left: auto;
  margin-right: 0;
}
```

Remove obsolete standalone filter margins and keep the page free of horizontal overflow at 320px logical width.

- [ ] **Step 5: Run structure tests and verify GREEN**

Run: `node --test tests/project-structure.test.js`

Expected: all tests pass.

- [ ] **Step 6: Commit the unified UI**

```bash
git add miniprogram/pages/library/index.wxml miniprogram/pages/library/index.wxss tests/project-structure.test.js
git commit -m "feat: unify library filter interface"
```

### Task 5: Explicitly label last-review information on home and library cards

**Files:**
- Modify: `miniprogram/utils/view.js`
- Modify: `miniprogram/pages/index/index.wxml`
- Modify: `miniprogram/pages/library/index.wxml`
- Modify: `miniprogram/pages/library/index.wxss`
- Test: `tests/view.test.js`
- Test: `tests/project-structure.test.js`

- [ ] **Step 1: Write failing display tests**

Change view expectations to concise values and add structure assertions for the explicit label:

```js
assert.equal(formatLastReview(null), '从未复习');
assert.equal(formatLastReview(today, today), '今天');
assert.equal(formatLastReview(yesterday, today), '昨天');
assert.equal(formatLastReview(sevenDaysAgo, today), '7天前');
```

Assert both WXML files contain `上次复习：{{item.lastReviewLabel}}` and library uses `已复习 {{item.reviewCount || 0}} 次`.

- [ ] **Step 2: Run display tests and verify RED**

Run: `node --test tests/view.test.js tests/project-structure.test.js`

Expected: FAIL because the existing formatter includes “复习” inside the value and pages lack the explicit label.

- [ ] **Step 3: Shorten the formatter values**

Update `formatLastReview` to return `从未复习`, `今天`, `昨天`, or `${elapsed}天前`. Keep `decorateCard.lastReviewLabel` unchanged as the property name.

- [ ] **Step 4: Update card metadata**

Home:

```xml
<view class="review-row__meta">{{item.proficiencyLabel}} · 上次复习：{{item.lastReviewLabel}}</view>
```

Library:

```xml
<view class="word-card__meta">{{item.proficiencyLabel}} · 上次复习：{{item.lastReviewLabel}} · 已复习 {{item.reviewCount || 0}} 次</view>
```

Apply single-line ellipsis to `.word-card__meta` so narrow screens do not overflow.

- [ ] **Step 5: Run display tests and verify GREEN**

Run: `node --test tests/view.test.js tests/project-structure.test.js`

Expected: all tests pass.

- [ ] **Step 6: Commit last-review labels**

```bash
git add miniprogram/utils/view.js miniprogram/pages/index/index.wxml miniprogram/pages/library/index.wxml miniprogram/pages/library/index.wxss tests/view.test.js tests/project-structure.test.js
git commit -m "feat: label card last review time"
```

### Task 6: Full verification, deployment, and Developer Tools interaction tests

**Files:**
- Modify only if verification exposes a defect in files already listed above.

- [ ] **Step 1: Run all automated tests**

Run: `npm test`

Expected: exit code 0 with zero failures.

- [ ] **Step 2: Run syntax and diff checks**

Run: `find miniprogram cloudfunctions tests -name '*.js' -print0 | xargs -0 -n1 node --check`

Expected: exit code 0.

Run: `git diff --check`

Expected: no output and exit code 0.

- [ ] **Step 3: Deploy the changed card service**

Run:

```bash
/Applications/wechatwebdevtools.app/Contents/MacOS/cli cloud functions deploy \
  --env cloud-space-d8gr80gd334789538 \
  --names cardService \
  --remote-npm-install \
  --project /Users/longxiao/repository/project/WeChatProjects/zikaguanjia
```

Expected: `cardService` deploy succeeds in the specified environment.

- [ ] **Step 4: Test the unified filter in WeChat Developer Tools**

Open the library and operate these flows: enter a keyword; switch status; select 7 days; switch to 30 days; open category picker and select multiple categories; verify combined results; clear all filters; enter and exit selection mode. Confirm the two top actions share one right edge, all selected states are visible, the filter card has no horizontal overflow, and cards show explicit last-review labels.

- [ ] **Step 5: Verify home card labels**

Open home and confirm every preview card displays `上次复习：...`, including `从未复习` when applicable, without clipping the card or chevron.

- [ ] **Step 6: Final repository verification**

Run: `npm test`

Run: `git diff --check`

Run: `git status -sb`

Expected: all tests pass, diff check is clean, and only intended commits are ahead of `origin/main`.
