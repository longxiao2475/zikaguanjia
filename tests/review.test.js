const test = require('node:test');
const assert = require('node:assert/strict');

const {
  getTodayReviewCards,
  getReviewStats,
  isStudyDay,
  sortCards,
} = require('../miniprogram/utils/review');

const TODAY = new Date('2026-07-25T04:00:00.000Z');

test('新录入的不熟字卡立即进入今日复习', () => {
  const cards = [{ _id: '1', proficiency: 'unfamiliar', lastReviewAt: null }];
  assert.deepEqual(getTodayReviewCards(cards, TODAY).map((card) => card._id), ['1']);
});

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

test('一般字卡满两天、熟练字卡满七天才进入复习', () => {
  const cards = [
    { _id: 'normal-1', proficiency: 'normal', lastReviewAt: '2026-07-24T04:00:00.000Z' },
    { _id: 'normal-2', proficiency: 'normal', lastReviewAt: '2026-07-23T04:00:00.000Z' },
    { _id: 'proficient-6', proficiency: 'proficient', lastReviewAt: '2026-07-19T04:00:00.000Z' },
    { _id: 'proficient-7', proficiency: 'proficient', lastReviewAt: '2026-07-18T04:00:00.000Z' },
  ];

  assert.deepEqual(
    getTodayReviewCards(cards, TODAY).map((card) => card._id),
    ['normal-2', 'proficient-7'],
  );
});

test('排序按不熟、一般、熟练，同档按最久未复习优先', () => {
  const cards = [
    { _id: 'p', proficiency: 'proficient', lastReviewAt: '2026-07-01T00:00:00.000Z' },
    { _id: 'u-new', proficiency: 'unfamiliar', lastReviewAt: null },
    { _id: 'n-new', proficiency: 'normal', lastReviewAt: '2026-07-23T00:00:00.000Z' },
    { _id: 'u-old', proficiency: 'unfamiliar', lastReviewAt: '2026-07-10T00:00:00.000Z' },
  ];

  assert.deepEqual(sortCards(cards).map((card) => card._id), ['u-new', 'u-old', 'n-new', 'p']);
});

test('统计三档分布并判断认字日', () => {
  const cards = [
    { proficiency: 'unfamiliar' },
    { proficiency: 'normal' },
    { proficiency: 'normal' },
  ];

  assert.deepEqual(getReviewStats(cards), {
    total: 3,
    unfamiliar: 1,
    normal: 2,
    proficient: 0,
  });
  assert.equal(isStudyDay({ studyDays: [2, 4, 6] }, TODAY), true);
  assert.equal(isStudyDay({ studyDays: [1, 3, 5] }, TODAY), false);
});
