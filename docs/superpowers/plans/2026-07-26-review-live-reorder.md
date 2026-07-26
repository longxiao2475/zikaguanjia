# Review Live Reorder Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 让复习排序弹层在拖动过程中实时平滑让位，并在松手后才提交真实顺序和更新序号。

**Architecture:** 在 `review-order.js` 中增加纯函数，负责把原始索引、预览索引和行间距转换成每张卡的预览 `y` 坐标。页面层仅在跨越新卡位中点时 `setData`，不在每个像素重建列表；松手时再调用现有 `reorderPendingCards`。

**Tech Stack:** 微信小程序 WXML/WXSS/JavaScript、`movable-area`/`movable-view`、Node.js `node:test`、`miniprogram-automator`。

**Status:** 已于 2026-07-26 完成实现与验证。自动化测试 100 项通过；微信模拟器已验证向上、向下、跨多行、原位松手和真实页面恢复，运行时无异常。

---

### Task 1: 实时让位纯函数

**Files:**
- Modify: `miniprogram/utils/review-order.js`
- Create: `tests/review-order.test.js`

- [ ] **Step 1: Write the failing tests**

```js
const test = require('node:test');
const assert = require('node:assert/strict');

const {
  buildOrderPreviewItems,
  getOrderPreviewIndex,
} = require('../miniprogram/utils/review-order');

const items = ['a', 'b', 'c', 'd'].map((_id, index) => ({
  _id,
  y: index * 60,
  orderNumber: index + 1,
}));

test('预览索引在跨越行中点后变化并限制在列表内', () => {
  assert.equal(getOrderPreviewIndex(89, 60, 4), 1);
  assert.equal(getOrderPreviewIndex(91, 60, 4), 2);
  assert.equal(getOrderPreviewIndex(-100, 60, 4), 0);
  assert.equal(getOrderPreviewIndex(999, 60, 4), 3);
});

test('向上拖动时中间卡片实时向下让位且序号不变', () => {
  const preview = buildOrderPreviewItems(items, 3, 1, 60);
  assert.deepEqual(preview.map((item) => item.y), [0, 120, 180, 180]);
  assert.deepEqual(preview.map((item) => item.orderNumber), [1, 2, 3, 4]);
  assert.deepEqual(preview.map((item) => item.dragging), [false, false, false, true]);
});

test('向下拖动时中间卡片实时向上让位', () => {
  const preview = buildOrderPreviewItems(items, 1, 3, 60);
  assert.deepEqual(preview.map((item) => item.y), [0, 60, 60, 120]);
});
```

- [ ] **Step 2: Run tests and verify RED**

Run: `node --test tests/review-order.test.js`

Expected: FAIL because `getOrderPreviewIndex` and `buildOrderPreviewItems` are not exported.

- [ ] **Step 3: Implement the pure preview helpers**

Add to `miniprogram/utils/review-order.js`:

```js
function getOrderPreviewIndex(y, rowPitch, itemCount) {
  if (!Number.isFinite(rowPitch) || rowPitch <= 0 || !Number.isInteger(itemCount) || itemCount <= 0) {
    return 0;
  }
  const rawIndex = Math.round((Number(y) || 0) / rowPitch);
  return Math.max(0, Math.min(itemCount - 1, rawIndex));
}

function getPreviewY(index, fromIndex, previewIndex, rowPitch) {
  if (index === fromIndex) return fromIndex * rowPitch;
  if (fromIndex < previewIndex && index > fromIndex && index <= previewIndex) {
    return (index - 1) * rowPitch;
  }
  if (fromIndex > previewIndex && index >= previewIndex && index < fromIndex) {
    return (index + 1) * rowPitch;
  }
  return index * rowPitch;
}

function buildOrderPreviewItems(items, fromIndex, previewIndex, rowPitch) {
  return (items || []).map((item, index) => ({
    ...item,
    y: getPreviewY(index, fromIndex, previewIndex, rowPitch),
    dragging: index === fromIndex,
    animate: index !== fromIndex,
  }));
}
```

Export both public helpers. Keep `getPreviewY` private.

- [ ] **Step 4: Run tests and verify GREEN**

Run: `node --test tests/review-order.test.js tests/review-flow.test.js`

Expected: all preview and existing reorder tests PASS.

### Task 2: 页面实时卡位预览

**Files:**
- Modify: `miniprogram/pages/review/index.js`
- Modify: `tests/review-page.test.js`

- [ ] **Step 1: Write failing page tests**

Add tests that:

```js
test('跨越新卡位时其他字卡实时让位但真实顺序和序号不变', () => {
  // apply four cards and open order sheet
  // drag index 3 to y = one row pitch
  // pendingOrderItems y values become [0, 2p, 3p, 3p]
  // _reviewState cards remain [a, b, c, d]
  // orderNumber remains [1, 2, 3, 4]
});

test('同一预览卡位内移动不重复 setData', () => {
  // count setData calls after drag start
  // emit two touch changes that both resolve to preview index 1
  // assert only the first slot change updates pendingOrderItems
});

test('松手后才提交预览顺序并更新下一张', () => {
  // preview index 3 -> 1
  // before end real state stays [a, b, c, d]
  // after end real state and list become [a, d, b, c]
});
```

- [ ] **Step 2: Run tests and verify RED**

Run: `node --test --test-name-pattern='实时让位|预览卡位|松手后才' tests/review-page.test.js`

Expected: FAIL because `onOrderDragChange` currently only stores `_orderDragY`.

- [ ] **Step 3: Implement preview state transitions**

Update the import:

```js
const {
  buildOrderPreviewItems,
  getOrderPreviewIndex,
  reorderPendingCards,
} = require('../../utils/review-order');
```

Update drag lifecycle:

```js
onOrderDragStart(event) {
  // validate index
  this._orderDraggingIndex = index;
  this._orderPreviewIndex = index;
  this._orderDragY = index * this.getOrderRowPitchPx();
  this.setData({
    pendingOrderItems: buildOrderPreviewItems(
      this.data.pendingOrderItems,
      index,
      index,
      this.getOrderRowPitchPx(),
    ),
  });
},

onOrderDragChange(event) {
  if (event.detail.source !== 'touch' || !Number.isInteger(this._orderDraggingIndex)) return;
  const dragY = Number(event.detail.y) || 0;
  const previewIndex = getOrderPreviewIndex(
    dragY,
    this.getOrderRowPitchPx(),
    this.data.pendingOrderItems.length,
  );
  this._orderDragY = dragY;
  if (previewIndex === this._orderPreviewIndex) return;
  this._orderPreviewIndex = previewIndex;
  this.setData({
    pendingOrderItems: buildOrderPreviewItems(
      this.data.pendingOrderItems,
      this._orderDraggingIndex,
      previewIndex,
      this.getOrderRowPitchPx(),
    ),
  });
},
```

At drag end, prefer `_orderPreviewIndex`, clear all temporary fields, then call `reorderPendingCards`. On close and failure, clear `_orderPreviewIndex` and rebuild from `_reviewState`.

- [ ] **Step 4: Run page tests and verify GREEN**

Run: `node --test tests/review-page.test.js tests/review-order.test.js tests/review-flow.test.js`

Expected: all reorder page and helper tests PASS.

### Task 3: 拖动态和让位动效

**Files:**
- Modify: `miniprogram/pages/review/index.wxml`
- Modify: `miniprogram/pages/review/index.wxss`
- Modify: `tests/project-structure.test.js`

- [ ] **Step 1: Write failing structure tests**

Require the review WXML/WXSS to contain:

```js
assert.equal(reviewWxml.includes('animation="{{item.animate}}"'), true);
assert.equal(reviewWxml.includes('order-sheet__item--dragging'), true);
assert.equal(reviewWxml.includes('order-sheet__item-content--dragging'), true);
assert.equal(reviewWxss.includes('transition: transform 160ms ease-out'), true);
assert.equal(reviewWxss.includes('z-index: 10'), true);
```

- [ ] **Step 2: Run structure test and verify RED**

Run: `node --test --test-name-pattern='内联详情关闭控件和复习拖拽结构齐全' tests/project-structure.test.js`

Expected: FAIL because drag animation bindings and classes do not exist.

- [ ] **Step 3: Add WXML motion bindings**

Set the movable item to:

```xml
class="order-sheet__item {{item.dragging ? 'order-sheet__item--dragging' : ''}}"
animation="{{item.animate}}"
damping="40"
```

Set the content class to:

```xml
class="order-sheet__item-content {{item.dragging ? 'order-sheet__item-content--dragging' : ''}}"
```

- [ ] **Step 4: Add focused WXSS feedback**

```css
.order-sheet__item {
  z-index: 1;
}

.order-sheet__item--dragging {
  z-index: 10;
  border-color: rgba(230, 112, 74, 0.42);
  box-shadow: 0 18rpx 38rpx rgba(83, 58, 42, 0.18);
}

.order-sheet__item-content {
  transition: transform 160ms ease-out, background-color 160ms ease-out;
}

.order-sheet__item-content--dragging {
  background: #FFF9F6;
  transform: scale(1.015);
}
```

Do not put `transform` on the outer `movable-view`, because it would conflict with the native translation transform.

- [ ] **Step 5: Run structure and page tests**

Run: `node --test tests/project-structure.test.js tests/review-page.test.js tests/review-order.test.js`

Expected: PASS.

### Task 4: 回归与微信手势验证

**Files:**
- Modify if required by test evidence: files from Tasks 1–3 only

- [ ] **Step 1: Run complete automated verification**

Run:

```bash
npm test
find miniprogram cloudfunctions tests -type f -name '*.js' -print0 | xargs -0 -n1 node --check
find miniprogram cloudfunctions -type f -name '*.json' -print0 | xargs -0 -n1 node -e 'JSON.parse(require("node:fs").readFileSync(process.argv[1],"utf8"))'
git diff --check
```

Expected: all tests pass, syntax checks exit 0, JSON checks exit 0, no whitespace errors.

- [ ] **Step 2: Verify in WeChat simulator**

Use `miniprogram-automator` to load four in-memory diagnostic cards without database writes, open the order sheet, and listen for console exceptions. Manually verify:

1. Drag the fourth card upward across one row: the crossed row moves down before release.
2. Continue across multiple rows: each newly crossed row moves immediately.
3. Drag the first card downward: crossed rows move up before release.
4. Release without crossing a midpoint: order remains unchanged.
5. During drag, numbers and the “下一张” label do not change; after release they match the committed order.

- [ ] **Step 3: Restore real review data**

Re-launch `/pages/review/index` without injected cards and verify `showOrderSheet` is false and console error count is zero.

- [ ] **Step 4: Commit the complete implementation**

```bash
git add docs/superpowers/plans/2026-07-26-review-live-reorder.md \
  miniprogram/utils/review-order.js \
  miniprogram/pages/review/index.js \
  miniprogram/pages/review/index.wxml \
  miniprogram/pages/review/index.wxss \
  tests/review-order.test.js \
  tests/review-page.test.js \
  tests/project-structure.test.js
git commit -m "feat: add live review reorder preview"
```

Expected: working tree clean and the new commit at `HEAD`.
