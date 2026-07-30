# Card Categories and Swipe Delete Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add editable per-child categories to card creation, editing, display and multi-select filtering, then add accessible swipe-to-delete behavior to library cards.

**Architecture:** A new `categoryService` owns category defaults and mutations. Cards store validated `categoryIds`; the existing card list performs category OR filtering before proficiency filtering. A reusable category picker component serves add/edit/filter flows, while a small pure swipe utility keeps gesture decisions testable and the library page owns single-open-card state.

**Tech Stack:** WeChat Mini Program WXML/WXSS/JavaScript, WeChat Cloud Functions, Node.js built-in test runner.

---

### Task 1: Category domain and cloud service

**Files:**
- Create: `cloudfunctions/categoryService/service.js`
- Create: `cloudfunctions/categoryService/repository.js`
- Create: `cloudfunctions/categoryService/index.js`
- Create: `cloudfunctions/categoryService/package.json`
- Create: `cloudfunctions/categoryService/config.json`
- Create: `tests/category-service.test.js`
- Modify: `tests/repositories.test.js`

- [ ] **Step 1: Write failing category service tests**

Cover default seeding exactly once, normalized duplicate rejection, add, rename, and child ownership. Use an in-memory repository implementing `findChildById`, `listCategories`, `findByNormalized`, `findById`, `createCategory`, and `updateCategory`.

- [ ] **Step 2: Run the focused tests and verify RED**

Run: `node --test tests/category-service.test.js`

Expected: FAIL because `cloudfunctions/categoryService/service.js` does not exist.

- [ ] **Step 3: Implement the category service**

Export `DEFAULT_CATEGORY_NAMES`, `normalizeCategoryName`, and `createCategoryService`. Implement `list`, `create`, and `update`; seed the 24 approved defaults only when `listCategories(childId, true)` returns no records.

- [ ] **Step 4: Implement repository and cloud entrypoint**

Use `categories` and `children` collections, server timestamps, action mapping `{ list, create, update }`, and the existing `{ ok, data }` / `{ ok: false, error }` response contract.

- [ ] **Step 5: Run focused and repository tests**

Run: `node --test tests/category-service.test.js tests/repositories.test.js`

Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add cloudfunctions/categoryService tests/category-service.test.js tests/repositories.test.js
git commit -m "feat: add editable card categories service"
```

### Task 2: Add categories to card contracts and filtering

**Files:**
- Modify: `cloudfunctions/cardService/service.js`
- Modify: `cloudfunctions/cardService/repository.js`
- Modify: `tests/card-service.test.js`
- Modify: `tests/repositories.test.js`

- [ ] **Step 1: Write failing card category tests**

Add tests proving create/update store unique category IDs, reject foreign or inactive IDs, treat missing IDs as uncategorized, and list with selected category IDs plus `includeUncategorized` using OR semantics.

- [ ] **Step 2: Run focused tests and verify RED**

Run: `node --test tests/card-service.test.js`

Expected: FAIL because category validation and filtering are absent.

- [ ] **Step 3: Implement category validation and storage**

Add `normalizeCategoryIds(value)` capped at 10. Add repository `findCategoriesByIds(ids)`. During create/update, verify every ID belongs to `payload.childId` and has `status === 'active'`; store `categoryIds` and default missing legacy values to `[]` when evaluating.

- [ ] **Step 4: Implement list filtering**

Normalize requested filter IDs, match cards having any requested category, optionally include cards with no categories, then calculate proficiency tabs from the category-scoped set. Preserve existing keyword and pagination behavior.

- [ ] **Step 5: Run focused tests**

Run: `node --test tests/card-service.test.js tests/repositories.test.js`

Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add cloudfunctions/cardService tests/card-service.test.js tests/repositories.test.js
git commit -m "feat: attach categories to cards and filters"
```

### Task 3: Frontend category API, cache, view helpers and picker

**Files:**
- Create: `miniprogram/utils/category.js`
- Create: `miniprogram/utils/category-view.js`
- Create: `miniprogram/components/category-picker/index.js`
- Create: `miniprogram/components/category-picker/index.wxml`
- Create: `miniprogram/components/category-picker/index.wxss`
- Create: `miniprogram/components/category-picker/index.json`
- Create: `tests/category-view.test.js`
- Modify: `miniprogram/utils/cache.js`
- Modify: `tests/cache.test.js`
- Modify: `tests/frontend-api.test.js`
- Modify: `tests/project-structure.test.js`

- [ ] **Step 1: Write failing frontend tests**

Test category cache read/write, category API cloud payloads, selection labels, card label decoration, component files, and component registration tokens.

- [ ] **Step 2: Run focused tests and verify RED**

Run: `node --test tests/cache.test.js tests/frontend-api.test.js tests/category-view.test.js tests/project-structure.test.js`

Expected: FAIL because category frontend modules and component do not exist.

- [ ] **Step 3: Implement cache and API**

Add `zkg:categories`, `getCategories`, and `setCategories`. Implement `listCategories`, `createCategory`, and `updateCategory` with cache replacement after mutations.

- [ ] **Step 4: Implement view helpers**

Export the uncategorized sentinel, selection normalization, selected-name summaries, and card decoration that exposes at most two visible labels plus an overflow count.

- [ ] **Step 5: Implement picker component**

Render a bottom sheet with selectable category chips, optional “未分类”, Cancel/Done controls, and a management view. Use editable `wx.showModal` prompts and emit `change`, `confirm`, `close`, `create`, and `rename` events. Keep every touch target at least `88rpx`.

- [ ] **Step 6: Run focused tests**

Run: `node --test tests/cache.test.js tests/frontend-api.test.js tests/category-view.test.js tests/project-structure.test.js`

Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add miniprogram/utils miniprogram/components/category-picker tests
git commit -m "feat: add reusable category picker"
```

### Task 4: Add and edit card category flows

**Files:**
- Modify: `miniprogram/pages/add/index.js`
- Modify: `miniprogram/pages/add/index.wxml`
- Modify: `miniprogram/pages/add/index.wxss`
- Modify: `miniprogram/pages/add/index.json`
- Modify: `miniprogram/pages/library/index.js`
- Modify: `miniprogram/pages/library/index.wxml`
- Modify: `miniprogram/pages/library/index.wxss`
- Modify: `miniprogram/pages/library/index.json`
- Create: `tests/add-page.test.js`
- Modify: `tests/library-page.test.js`
- Modify: `tests/project-structure.test.js`

- [ ] **Step 1: Write failing add/edit tests**

Verify add-page save sends `categoryIds`, category choice survives a successful save, edit opening copies existing IDs, and edit save sends modified IDs without clearing custom words unless content changed.

- [ ] **Step 2: Run focused tests and verify RED**

Run: `node --test tests/add-page.test.js tests/library-page.test.js tests/project-structure.test.js`

Expected: FAIL because pages do not load or save categories.

- [ ] **Step 3: Implement add-page flow**

Load cached/remote categories, display a category selector after source, manage picker state, handle add/rename events, and include `categoryIds` in create payload.

- [ ] **Step 4: Implement edit flow**

Load categories in the library, copy card category IDs into edit state, render selected labels and picker, save category IDs in the update payload, and make the edit sheet vertically scrollable within the safe area.

- [ ] **Step 5: Run focused tests**

Run: `node --test tests/add-page.test.js tests/library-page.test.js tests/project-structure.test.js`

Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add miniprogram/pages/add miniprogram/pages/library tests
git commit -m "feat: choose categories when saving cards"
```

### Task 5: Library category display and multi-select query

**Files:**
- Modify: `miniprogram/pages/library/index.js`
- Modify: `miniprogram/pages/library/index.wxml`
- Modify: `miniprogram/pages/library/index.wxss`
- Modify: `miniprogram/utils/card.js`
- Modify: `tests/library-page.test.js`
- Modify: `tests/frontend-api.test.js`
- Modify: `tests/project-structure.test.js`

- [ ] **Step 1: Write failing filter tests**

Verify pending filter selection is not applied until confirm, confirm sends real IDs and `includeUncategorized`, category filters reset pagination, decorated cards expose labels, and unfiltered first-page caching only occurs without category filters.

- [ ] **Step 2: Run focused tests and verify RED**

Run: `node --test tests/library-page.test.js tests/frontend-api.test.js tests/project-structure.test.js`

Expected: FAIL because library category filtering is absent.

- [ ] **Step 3: Implement filtering and display**

Add category filter state, filter summary bar, picker instance, query serialization, category label decoration, and visible category tags on cards. Use OR within categories and retain existing search/proficiency combination.

- [ ] **Step 4: Run focused tests**

Run: `node --test tests/library-page.test.js tests/frontend-api.test.js tests/project-structure.test.js`

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add miniprogram/pages/library miniprogram/utils/card.js tests
git commit -m "feat: filter library by multiple categories"
```

### Task 6: Swipe-to-delete library cards

**Files:**
- Create: `miniprogram/utils/card-swipe.js`
- Create: `tests/card-swipe.test.js`
- Modify: `miniprogram/pages/library/index.js`
- Modify: `miniprogram/pages/library/index.wxml`
- Modify: `miniprogram/pages/library/index.wxss`
- Modify: `tests/library-page.test.js`
- Modify: `tests/project-structure.test.js`

- [ ] **Step 1: Write failing gesture tests**

Test that horizontal left movement beyond 36px opens, right movement closes, short or vertical movement does nothing, and opening one item closes all others.

- [ ] **Step 2: Run focused tests and verify RED**

Run: `node --test tests/card-swipe.test.js tests/library-page.test.js tests/project-structure.test.js`

Expected: FAIL because swipe helpers and page handlers are absent.

- [ ] **Step 3: Implement pure swipe helpers**

Export `SWIPE_THRESHOLD_PX`, `getSwipeIntent(start, end)`, and `setOpenSwipeCard(items, cardId)` without platform dependencies.

- [ ] **Step 4: Implement card gesture and delete reuse**

Wrap each card with an absolute delete action, track touch start/end, disable gestures during selection mode, enforce one open card, suppress detail opening after a gesture, and refactor deletion into one method shared by edit and swipe entrypoints.

- [ ] **Step 5: Run focused tests**

Run: `node --test tests/card-swipe.test.js tests/library-page.test.js tests/project-structure.test.js`

Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add miniprogram/utils/card-swipe.js miniprogram/pages/library tests
git commit -m "feat: swipe library cards to delete"
```

### Task 7: Full verification

**Files:**
- Modify only files required by verification findings.

- [ ] **Step 1: Run the complete suite**

Run: `npm test`

Expected: all tests pass with zero failures.

- [ ] **Step 2: Check patch hygiene**

Run: `git diff --check` and `git status --short`.

Expected: no whitespace errors; only intended feature files are modified.

- [ ] **Step 3: Review requirements**

Confirm defaults, add/rename, add/edit selection, multi-select OR filter, uncategorized compatibility, single-open swipe, selection-mode disablement, confirmation, and soft delete are all covered by code and tests.
