const test = require('node:test');
const assert = require('node:assert/strict');

const {
  buildCompletePayload,
  createReviewState,
  markCurrent,
  reorderPendingCards,
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

test('重排只移动未完成后缀并让当前卡跟随新顺序', () => {
  let state = createReviewState([
    { _id: 'a', content: '大' },
    { _id: 'b', content: '人' },
    { _id: 'c', content: '小' },
    { _id: 'd', content: '山' },
  ]);
  state = markCurrent(state, 'normal');

  const reordered = reorderPendingCards(state, 2, 0);

  assert.deepEqual(reordered.cards.map((card) => card._id), ['a', 'd', 'b', 'c']);
  assert.deepEqual(reordered.results, [{ cardId: 'a', proficiency: 'normal' }]);
  assert.equal(reordered.currentIndex, 1);
  assert.equal(reordered.currentCard._id, 'd');
  assert.equal(reordered.progressPercent, 25);
});

test('重排后的标记顺序生成正确提交 payload', () => {
  let state = createReviewState([
    { _id: 'a', content: '大' },
    { _id: 'b', content: '人' },
    { _id: 'c', content: '小' },
    { _id: 'd', content: '山' },
  ]);
  state = markCurrent(state, 'normal');
  state = reorderPendingCards(state, 2, 0);
  state = markCurrent(state, 'unfamiliar');
  state = markCurrent(state, 'proficient');
  state = markCurrent(state, 'normal');

  assert.deepEqual(buildCompletePayload('child-1', state).items, [
    { cardId: 'a', proficiency: 'normal' },
    { cardId: 'd', proficiency: 'unfamiliar' },
    { cardId: 'b', proficiency: 'proficient' },
    { cardId: 'c', proficiency: 'normal' },
  ]);
});

test('越界或已完成轮次不能重排', () => {
  const state = createReviewState([{ _id: 'a' }, { _id: 'b' }]);
  assert.throws(() => reorderPendingCards(state, -1, 0), /REVIEW_REORDER_INDEX_INVALID/);
  assert.throws(() => reorderPendingCards(state, 0, 2), /REVIEW_REORDER_INDEX_INVALID/);
  const completed = markCurrent(markCurrent(state, 'normal'), 'proficient');
  assert.throws(() => reorderPendingCards(completed, 0, 0), /REVIEW_ALREADY_COMPLETE/);
});
