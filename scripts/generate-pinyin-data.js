const fs = require('node:fs');
const path = require('node:path');
const { pinyin } = require('pinyin-pro');

const root = path.resolve(__dirname, '..');
const dictPath = path.join(root, 'miniprogram/utils/dict-data.json');
const outputPath = path.join(root, 'miniprogram/utils/pinyin-data.json');
const dict = JSON.parse(fs.readFileSync(dictPath, 'utf8'));

const pinyinData = Object.fromEntries(
  Object.keys(dict).map((character) => {
    const result = pinyin(character, { toneType: 'symbol', type: 'array' });
    return [character, result.join(' ')];
  }),
);

fs.writeFileSync(outputPath, `${JSON.stringify(pinyinData)}\n`);

