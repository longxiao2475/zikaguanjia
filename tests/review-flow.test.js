const test = require('node:test');
const assert = require('node:assert/strict');

const {
  buildCompletePayload,
  createReviewState,
  markCurrent,
} = require('../miniprogram/utils/review-flow');

test('标记后自动前进，最后一张生成一次完整提交 payload', () => {
  let state = createReviewState([
    { _id: 'a', content: '大' },
    { _id: 'b', content: '人' },
  ]);

  assert.equal(state.currentIndex, 0);
  assert.equal(state.progressPercent, 0);
  state = markCurrent(state, 'normal');
  assert.equal(state.currentIndex, 1);
  assert.equal(state.readyToSubmit, false);
  assert.equal(state.progressPercent, 50);
  state = markCurrent(state, 'proficient');

  assert.equal(state.currentIndex, 1);
  assert.equal(state.readyToSubmit, true);
  assert.equal(state.progressPercent, 100);
  assert.deepEqual(buildCompletePayload('child-1', state), {
    childId: 'child-1',
    items: [
      { cardId: 'a', proficiency: 'normal' },
      { cardId: 'b', proficiency: 'proficient' },
    ],
  });
});

test('非法熟练度和重复标记已完成轮次会被拒绝', () => {
  const state = createReviewState([{ _id: 'a', content: '大' }]);
  assert.throws(() => markCurrent(state, 'mastered'), /PROFICIENCY_INVALID/);
  const completed = markCurrent(state, 'normal');
  assert.throws(() => markCurrent(completed, 'proficient'), /REVIEW_ALREADY_COMPLETE/);
});

test('空计划保持零进度且不能构造提交 payload', () => {
  const state = createReviewState([]);
  assert.equal(state.currentCard, null);
  assert.equal(state.progressPercent, 0);
  assert.throws(() => buildCompletePayload('child-1', state), /REVIEW_NOT_READY/);
});

