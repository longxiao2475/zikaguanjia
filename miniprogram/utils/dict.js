const dictData = require('./dict-data.json');
const pinyinData = require('./pinyin-data.json');

const RECOMMENDED_WORDS = Object.freeze({
  大: ['大小', '大人', '大家'],
});

function normalizeWord(value) {
  if (typeof value !== 'string') return '';
  return value.normalize('NFKC').trim().replace(/\s+/g, '');
}

function uniqueWords(words) {
  return [...new Set((words || []).map(normalizeWord).filter(Boolean))];
}

function getDictionaryWords(content) {
  const normalizedContent = normalizeWord(content);
  if (Array.from(normalizedContent).length !== 1) return [];
  return uniqueWords([
    ...(RECOMMENDED_WORDS[normalizedContent] || []),
    ...(dictData[normalizedContent] || []),
  ]);
}

function mergeWords(content, customWords) {
  return uniqueWords([
    ...uniqueWords(customWords),
    ...getDictionaryWords(content),
  ]);
}

function getPinyin(content) {
  const characters = Array.from(normalizeWord(content));
  if (!characters.length) return '';
  const syllables = characters.map((character) => pinyinData[character] || '');
  return syllables.every(Boolean) ? syllables.join(' ') : '';
}

function validateCustomWord(content, input) {
  const normalizedContent = normalizeWord(content);
  const word = normalizeWord(input);
  if (!word) {
    return { ok: false, code: 'CUSTOM_WORD_REQUIRED', message: '请输入组词' };
  }
  if (Array.from(word).length > 12) {
    return { ok: false, code: 'CUSTOM_WORD_TOO_LONG', message: '组词不能超过 12 个字' };
  }
  if (Array.from(normalizedContent).length === 1 && !word.includes(normalizedContent)) {
    return {
      ok: false,
      code: 'CUSTOM_WORD_MISMATCH',
      message: `组词需要包含“${normalizedContent}”`,
    };
  }
  return { ok: true, word };
}

function getWordDetail(card = {}) {
  const content = normalizeWord(card.content);
  const customWords = uniqueWords(card.customWords);
  const dictionaryWords = getDictionaryWords(content);
  return {
    content,
    pinyin: getPinyin(content),
    words: uniqueWords([...customWords, ...dictionaryWords]),
    customWords,
    dictionaryWords,
  };
}

module.exports = {
  RECOMMENDED_WORDS,
  getDictionaryWords,
  getPinyin,
  getWordDetail,
  mergeWords,
  normalizeWord,
  uniqueWords,
  validateCustomWord,
};
