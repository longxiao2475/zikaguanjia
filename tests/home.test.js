const test = require('node:test');
const assert = require('node:assert/strict');

const { getHomeBanners } = require('../miniprogram/utils/home');

test('认字日兜底和低额度预警可以同时显示', () => {
  assert.deepEqual(getHomeBanners({ studyDay: true, due: 3, quota: 2 }), {
    showStudyBanner: true,
    showQuotaBanner: true,
  });
});

test('非认字日或无待复习不显示学习兜底', () => {
  assert.equal(getHomeBanners({ studyDay: false, due: 3, quota: 3 }).showStudyBanner, false);
  assert.equal(getHomeBanners({ studyDay: true, due: 0, quota: 3 }).showStudyBanner, false);
});

test('额度只在小于等于 2 时预警', () => {
  assert.equal(getHomeBanners({ studyDay: false, due: 0, quota: 0 }).showQuotaBanner, true);
  assert.equal(getHomeBanners({ studyDay: false, due: 0, quota: 2 }).showQuotaBanner, true);
  assert.equal(getHomeBanners({ studyDay: false, due: 0, quota: 3 }).showQuotaBanner, false);
  assert.equal(getHomeBanners({ studyDay: false, due: 0, quota: undefined }).showQuotaBanner, false);
});

