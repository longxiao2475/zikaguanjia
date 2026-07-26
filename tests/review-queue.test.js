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

test('手动补查部分失效时只合并有效字卡', () => {
  const merged = mergeReviewCards(
    [{ _id: 'today', content: '礼' }],
    [{ _id: 'manual', content: '物' }],
  );
  assert.deepEqual(merged.map((card) => card._id), ['today', 'manual']);
});
