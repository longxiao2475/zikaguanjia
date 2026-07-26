# Inline Word Detail and Review Reorder Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 让字卡库和复习页稳定展示字卡中不重复单字的拼音与组词，支持字卡库整行选择，并允许拖拽调整本轮尚未复习字卡的顺序。

**Architecture:** 移除无法被开发者工具稳定解析的 `word-sheet` 自定义组件，在两个页面内联相同的 bottom sheet 视图，公共字典规则继续集中在 `utils/dict.js`。复习顺序由 `utils/review-flow.js` 的纯函数重排未完成后缀，页面只负责把拖拽坐标转换为目标索引。

**Tech Stack:** 微信小程序原生 JavaScript/WXML/WXSS、`movable-area`/`movable-view`、本地 JSON 字典、Node.js `node:test`。

---

## File map

- `miniprogram/utils/dict.js`：按原顺序去重汉字，生成每个字的拼音和组词详情。
- `miniprogram/utils/review-flow.js`：只重排未完成字卡后缀。
- `miniprogram/pages/library/index.*`：整行点击分流、内联详情和补充组词。
- `miniprogram/pages/review/index.*`：内联详情、排序弹层和拖拽事件。
- `tests/dict.test.js`：多字卡拆字与分组规则。
- `tests/library-page.test.js`：普通/选择模式整行点击与详情保存。
- `tests/review-flow.test.js`：未完成后缀重排及最终 payload。
- `tests/review-page.test.js`：复习详情和拖拽事件到状态流的连接。
- `tests/project-structure.test.js`：组件依赖移除和页面结构回归。
- `ai_wiki/字卡管家-MVP开发计划-v1.0.md`：记录本轮真实完成状态。

---

### Task 1: 按不重复单字生成拼音和组词详情

**Files:**
- Modify: `tests/dict.test.js`
- Modify: `miniprogram/utils/dict.js`

- [ ] **Step 1: 写失败测试**

把旧“词语不查询单字组词”用例替换为：

```js
test('词语字卡按原顺序展示不重复单字的拼音和各自组词', () => {
  const detail = getWordDetail({ content: '礼物礼', customWords: ['礼物盒', '物品'] });

  assert.equal(detail.content, '礼物礼');
  assert.deepEqual(detail.characters.map((item) => item.character), ['礼', '物']);
  assert.equal(detail.characters[0].pinyin, 'lǐ');
  assert.equal(detail.characters[1].pinyin, 'wù');
  assert.equal(detail.characters[0].words.includes('礼貌'), true);
  assert.equal(detail.characters[1].words.includes('物品'), true);
  assert.equal(detail.characters[0].words.filter((word) => word === '礼物盒').length, 1);
});
```

- [ ] **Step 2: 运行并确认失败**

Run: `node --test tests/dict.test.js`

Expected: FAIL，因为 `getWordDetail` 尚无 `characters`。

- [ ] **Step 3: 实现最小字典模型**

在 `dict.js` 增加按顺序去重和单字详情：

```js
function uniqueCharacters(content) {
  return [...new Set(Array.from(normalizeWord(content)))];
}

function getCharacterDetail(character, customWords) {
  const matchingCustomWords = uniqueWords(customWords).filter((word) => word.includes(character));
  const dictionaryWords = getDictionaryWords(character);
  return {
    character,
    pinyin: getPinyin(character),
    words: uniqueWords([...matchingCustomWords, ...dictionaryWords]),
    customWords: matchingCustomWords,
    dictionaryWords,
    inputValue: '',
  };
}
```

`getWordDetail` 返回 `{ content, characters, customWords }`，并导出 `uniqueCharacters`。

- [ ] **Step 4: 运行测试**

Run: `node --test tests/dict.test.js`

Expected: PASS，0 failures。

---

### Task 2: 字卡库整行点击与内联详情

**Files:**
- Modify: `tests/library-page.test.js`
- Modify: `miniprogram/pages/library/index.js`
- Modify: `miniprogram/pages/library/index.wxml`
- Modify: `miniprogram/pages/library/index.wxss`
- Modify: `miniprogram/pages/library/index.json`

- [ ] **Step 1: 写整行点击失败测试**

新增两个用例：普通模式调用 `onCardTap` 后打开正确详情；选择模式调用同一事件后只切换 `selectedIds`，不打开详情。测试字卡为 `{ _id: 'card-1', content: '礼物', customWords: [] }`。

- [ ] **Step 2: 写详情补词失败测试**

打开“礼物”后给“礼”输入“礼貌”，调用保存事件，断言 `cardApi.updateCard` 收到：

```js
{
  childId: 'child-1',
  cardId: 'card-1',
  customWords: ['礼貌'],
}
```

- [ ] **Step 3: 运行并确认失败**

Run: `node --test tests/library-page.test.js`

Expected: FAIL，因为没有统一 `onCardTap` 和页面内联详情状态。

- [ ] **Step 4: 实现页面逻辑**

引入 `getWordDetail`、`uniqueWords`、`validateCustomWord`；新增 `showWordDetail`、`wordDetailCard`、`wordDetail`。`onCardTap` 在选择模式调用选择切换，否则生成详情。输入事件按 `data-index` 更新 `wordDetail.characters[index].inputValue`，保存时以当前 `character` 校验并更新卡片。

- [ ] **Step 5: 内联 WXML/WXSS**

字卡根节点绑定 `data-id` 与 `bindtap="onCardTap"`。选择圆圈仅显示状态；编辑继续 `catchtap`。bottom sheet 遍历 `wordDetail.characters`，每个分组显示单字、拼音、组词标签、输入框和添加按钮。

- [ ] **Step 6: 移除页面组件声明并运行测试**

`index.json` 删除 `usingComponents.word-sheet`。

Run: `node --test tests/library-page.test.js tests/dict.test.js`

Expected: PASS，0 failures。

---

### Task 3: 复习状态流重排未完成后缀

**Files:**
- Modify: `tests/review-flow.test.js`
- Modify: `miniprogram/utils/review-flow.js`

- [ ] **Step 1: 写重排失败测试**

创建 `[a,b,c,d]`，先标记 `a`，再调用 `reorderPendingCards(state, 2, 0)`，断言 cards 为 `[a,d,b,c]`、results 仍只含 `a`、currentCard 为 `d`。

- [ ] **Step 2: 写最终 payload 对应关系测试**

重排后依次给 `d/b/c` 标记不同熟练度，断言 payload 的 cardId 与实际标记顺序一致。

- [ ] **Step 3: 运行并确认失败**

Run: `node --test tests/review-flow.test.js`

Expected: FAIL，因为 `reorderPendingCards` 尚不存在。

- [ ] **Step 4: 实现纯函数**

`reorderPendingCards(state, fromIndex, toIndex)` 验证未完成轮次与索引范围，保留 `results.length` 之前的 cards，移动后缀单项，更新 `currentIndex` 和 `currentCard`，其他状态不变。相同索引返回原状态。

- [ ] **Step 5: 运行测试**

Run: `node --test tests/review-flow.test.js`

Expected: PASS，0 failures。

---

### Task 4: 复习页内联详情与拖拽排序

**Files:**
- Create: `tests/review-page.test.js`
- Modify: `miniprogram/pages/review/index.js`
- Modify: `miniprogram/pages/review/index.wxml`
- Modify: `miniprogram/pages/review/index.wxss`
- Modify: `miniprogram/pages/review/index.json`

- [ ] **Step 1: 写页面事件失败测试**

加载 Page 定义后验证：打开当前“礼物”卡能生成 `礼/物` 两组详情；打开排序弹层只列出未完成 cards；拖动结束从索引 1 到 0 后 `_reviewState.currentCard` 改为原第二张待复习卡。

- [ ] **Step 2: 运行并确认失败**

Run: `node --test tests/review-page.test.js`

Expected: FAIL，因为页面没有内联详情和排序事件。

- [ ] **Step 3: 实现详情事件**

复用 Task 2 相同字典接口，补词成功后同步 `_reviewState.cards/currentCard`、详情卡和 `wordDetail`。

- [ ] **Step 4: 实现排序数据与事件**

新增 `showOrderSheet`、`pendingOrderItems`、`orderAreaHeight`。打开时根据 `windowWidth / 750` 把固定行高换算成 px；`bindchange` 记录当前 y，`bindtouchend` 将 `Math.round(y / rowHeightPx)` 限制到有效范围后调用 `reorderPendingCards` 并刷新页面状态。

- [ ] **Step 5: 内联 WXML/WXSS**

进度区增加“调整顺序”；排序弹层使用纵向 `movable-area`/`movable-view`，每行显示序号、字卡内容和拖拽把手。详情弹层按不重复单字分组显示。删除页面 `word-sheet` 组件声明。

- [ ] **Step 6: 运行页面和状态流测试**

Run: `node --test tests/review-page.test.js tests/review-flow.test.js tests/dict.test.js`

Expected: PASS，0 failures。

---

### Task 5: 删除旧组件并更新结构测试与开发计划

**Files:**
- Delete: `miniprogram/components/word-sheet/index.js`
- Delete: `miniprogram/components/word-sheet/index.json`
- Delete: `miniprogram/components/word-sheet/index.wxml`
- Delete: `miniprogram/components/word-sheet/index.wxss`
- Modify: `tests/project-structure.test.js`
- Modify: `ai_wiki/字卡管家-MVP开发计划-v1.0.md`

- [ ] **Step 1: 先修改结构测试并确认失败**

结构测试要求两个页面 JSON 都没有 `word-sheet`，WXML 不含 `<word-sheet`，包含内联详情；复习 WXML 包含 `movable-area` 和 `movable-view`；旧组件目录不存在。

Run: `node --test tests/project-structure.test.js`

Expected: FAIL，因为旧组件目录仍存在。

- [ ] **Step 2: 删除旧组件并更新计划**

删除四个旧组件文件；在 MVP 计划顶部增加本轮状态，明确多字卡按不重复单字展示、整行选择、仅本轮拖拽排序和无需重新部署云函数。

- [ ] **Step 3: 运行结构测试**

Run: `node --test tests/project-structure.test.js`

Expected: PASS，0 failures。

---

### Task 6: 全量验证与交付

**Files:**
- Verify all modified files

- [ ] **Step 1: 运行全量测试**

Run: `npm test`

Expected: 全部测试 PASS，0 failures。

- [ ] **Step 2: 运行静态检查**

Run: `find miniprogram/pages miniprogram/utils -name '*.js' -print0 | xargs -0 -n1 node --check`

Run: `find miniprogram/pages -name '*.json' -print0 | xargs -0 -n1 node -e "JSON.parse(require('fs').readFileSync(process.argv[1], 'utf8'))"`

Expected: 两个命令 exit 0。

- [ ] **Step 3: 检查需求与差异**

确认三个用户需求逐项有实现和测试，运行 `git diff --check`，检查没有意外修改或残留 `word-sheet` 页面引用。

- [ ] **Step 4: 提交并推送**

```bash
git add ai_wiki docs miniprogram tests
git commit -m "feat: add inline word details and review reorder"
git push origin main
```
