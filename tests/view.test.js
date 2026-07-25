const test = require('node:test');
const assert = require('node:assert/strict');

const {
  formatDisplayDate,
  formatLastReview,
  getGreeting,
  getProficiencyMeta,
} = require('../miniprogram/utils/view');

test('日期和问候语适合首页展示', () => {
  const morning = new Date('2026-07-25T00:30:00.000Z');
  assert.equal(formatDisplayDate(morning), '7月25日 星期六');
  assert.equal(getGreeting(morning), '上午好');
});

test('熟练度元信息和复习时间文本稳定', () => {
  assert.deepEqual(getProficiencyMeta('normal'), {
    label: '一般',
    className: 'normal',
  });
  assert.equal(formatLastReview(null), '还没复习过');
  assert.equal(
    formatLastReview('2026-07-23T04:00:00.000Z', new Date('2026-07-25T04:00:00.000Z')),
    '2 天前复习',
  );
});
