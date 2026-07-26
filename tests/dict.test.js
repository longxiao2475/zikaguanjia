const test = require('node:test');
const assert = require('node:assert/strict');

const {
  getWordDetail,
  mergeWords,
  normalizeWord,
  validateCustomWord,
} = require('../miniprogram/utils/dict');

test('大按幼儿常用顺序返回组词和拼音', () => {
  const detail = getWordDetail({ content: '大', customWords: [] });

  assert.equal(detail.content, '大');
  assert.equal(detail.pinyin, 'dà');
  assert.deepEqual(detail.words.slice(0, 3), ['大小', '大人', '大家']);
});

test('自定义组词优先展示并与内置词去重', () => {
  const words = mergeWords('大', [' 大象 ', '大小', '大象']);

  assert.deepEqual(words.slice(0, 4), ['大象', '大小', '大人', '大家']);
  assert.equal(words.filter((word) => word === '大象').length, 1);
  assert.equal(words.filter((word) => word === '大小').length, 1);
});

test('自定义组词执行标准化和输入约束', () => {
  assert.equal(normalizeWord('  大 象  '), '大象');
  assert.deepEqual(validateCustomWord('大', ' 大象 '), { ok: true, word: '大象' });
  assert.equal(validateCustomWord('大', '').code, 'CUSTOM_WORD_REQUIRED');
  assert.equal(validateCustomWord('大', '小象').code, 'CUSTOM_WORD_MISMATCH');
  assert.equal(validateCustomWord('大', '大一二三四五六七八九十一二').code, 'CUSTOM_WORD_TOO_LONG');
});

test('词语字卡不查询单字词典但保留自定义组词', () => {
  assert.deepEqual(getWordDetail({ content: '大小', customWords: ['大小不同'] }), {
    content: '大小',
    pinyin: '',
    words: ['大小不同'],
    customWords: ['大小不同'],
    dictionaryWords: [],
  });
});
