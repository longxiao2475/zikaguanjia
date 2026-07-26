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

test('词语字卡按原顺序展示不重复单字的拼音和各自组词', () => {
  const detail = getWordDetail({ content: '礼物礼', customWords: ['礼物盒', '物品', '礼物盒'] });

  assert.equal(detail.content, '礼物礼');
  assert.deepEqual(detail.characters.map((item) => item.character), ['礼', '物']);
  assert.equal(detail.characters[0].pinyin, 'lǐ');
  assert.equal(detail.characters[1].pinyin, 'wù');
  assert.equal(detail.characters[0].words.includes('礼貌'), true);
  assert.equal(detail.characters[1].words.includes('物品'), true);
  assert.equal(detail.characters[0].words.filter((word) => word === '礼物盒').length, 1);
  assert.equal(detail.characters[1].words.filter((word) => word === '礼物盒').length, 1);
});

test('重复字卡只生成一个单字分组', () => {
  const detail = getWordDetail({ content: '妈妈', customWords: ['妈妈'] });

  assert.deepEqual(detail.characters.map((item) => item.character), ['妈']);
  assert.equal(detail.characters[0].pinyin, 'mā');
  assert.equal(detail.characters[0].words.includes('妈妈'), true);
});

test('单字分组忽略字母标点和 emoji，只保留汉字', () => {
  assert.deepEqual(
    getWordDetail({ content: 'A大·小😀大' }).characters.map((item) => item.character),
    ['大', '小'],
  );
  assert.deepEqual(getWordDetail({ content: 'ABC·😀' }).characters, []);
});
