const test = require('node:test');
const assert = require('node:assert/strict');

const {
  buildReviewSelectionState,
  mergeReviewCards,
  resolveReviewCards,
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
