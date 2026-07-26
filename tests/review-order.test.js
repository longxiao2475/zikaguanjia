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
