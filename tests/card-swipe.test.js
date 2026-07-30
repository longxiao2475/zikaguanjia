const test = require('node:test');
const assert = require('node:assert/strict');

const {
  SWIPE_THRESHOLD_PX,
  getSwipeIntent,
  setOpenSwipeCard,
} = require('../miniprogram/utils/card-swipe');

test('只有超过阈值的水平手势才展开或关闭', () => {
  assert.equal(SWIPE_THRESHOLD_PX, 36);
  assert.equal(getSwipeIntent({ x: 100, y: 20 }, { x: 50, y: 24 }), 'open');
  assert.equal(getSwipeIntent({ x: 50, y: 20 }, { x: 100, y: 24 }), 'close');
  assert.equal(getSwipeIntent({ x: 100, y: 20 }, { x: 75, y: 22 }), 'none');
  assert.equal(getSwipeIntent({ x: 100, y: 20 }, { x: 50, y: 90 }), 'none');
});

test('同一时间只展开一张字卡', () => {
  const items = [
    { _id: 'a', swipeOpen: true },
    { _id: 'b', swipeOpen: false },
  ];
  assert.deepEqual(setOpenSwipeCard(items, 'b').map((item) => item.swipeOpen), [false, true]);
  assert.deepEqual(setOpenSwipeCard(items, null).map((item) => item.swipeOpen), [false, false]);
});
