const test = require('node:test');
const assert = require('node:assert/strict');
const Module = require('node:module');
const path = require('node:path');

const pagePath = path.join(__dirname, '../miniprogram/pages/settings/index.js');

function loadSettingsPage({ sessionApi, wxApi } = {}) {
  const originalLoad = Module._load;
  let definition;
  global.Page = (config) => { definition = config; };
  global.wx = { showToast() {}, setClipboardData() {}, ...wxApi };
  Module._load = function mockLoad(request, parent, isMain) {
    if (request === '../../utils/session') return sessionApi || {};
    if (request === '../../utils/subscribe') return {};
    return originalLoad(request, parent, isMain);
  };
  delete require.cache[pagePath];
  try {
    require(pagePath);
  } finally {
    Module._load = originalLoad;
    delete global.Page;
  }
  return definition;
}

function createContext(definition) {
  return {
    ...definition,
    data: { ...definition.data },
    setData(update) {
      this.data = { ...this.data, ...update };
    },
  };
}

test('设置页提供 24 个整点并把旧分钟设置归一到同一小时', () => {
  const definition = loadSettingsPage();
  const context = createContext(definition);

  definition.applySession.call(
    context,
    { subscriptionQuota: 4 },
    {
      _id: 'child-1', name: '果果', studyDays: [4], reminderTime: '13:35',
      reminderEnabled: true,
    },
    { reminderTime: '07:35', reminderEnabled: false },
  );

  assert.equal(context.data.hourOptions.length, 24);
  assert.equal(context.data.hourOptions[0], '00:00');
  assert.equal(context.data.hourOptions[23], '23:00');
  assert.equal(context.data.reminderHourIndex, 7);
  assert.equal(context.data.reminderTime, '07:00');
  assert.equal(context.data.reminderEnabled, false);
});

test('设置页选择小时后只产生整点提醒值', () => {
  const definition = loadSettingsPage();
  const context = createContext(definition);

  definition.onTimeChange.call(context, { detail: { value: '7' } });

  assert.equal(context.data.reminderHourIndex, 7);
  assert.equal(context.data.reminderTime, '07:00');
});

test('家庭 owner 可以生成并复制家庭码', async () => {
  let copiedText = '';
  const definition = loadSettingsPage({
    sessionApi: {
      createFamilyInvite: async () => ({ code: 'ABCD2345' }),
    },
    wxApi: {
      setClipboardData: ({ data, success }) => {
        copiedText = data;
        if (success) success();
      },
    },
  });
  const context = createContext(definition);
  context.data.memberRole = 'owner';

  await definition.onGenerateFamilyCode.call(context);
  definition.onCopyFamilyCode.call(context);

  assert.equal(context.data.familyInviteCode, 'ABCD2345');
  assert.equal(copiedText, 'ABCD2345');
});

test('加入家庭先展示合并预览再确认并刷新家庭信息', async () => {
  const calls = [];
  const definition = loadSettingsPage({
    sessionApi: {
      previewFamilyJoin: async (code) => {
        calls.push(['preview', code]);
        return {
          familyName: '果果家庭', memberCount: 1, sourceCardCount: 12,
          targetCardCount: 69, duplicateCardCount: 3, uniqueCardCount: 9,
          categoryConflictCount: 2,
        };
      },
      confirmFamilyJoin: async (code, requestId) => {
        calls.push(['confirm', code, requestId]);
        return { familyId: 'family-target' };
      },
      getFamilySummary: async () => ({
        family: { _id: 'family-target', name: '果果家庭' },
        member: { role: 'member' },
        memberCount: 2,
      }),
    },
  });
  const context = createContext(definition);
  context.data.familyCodeInput = 'ABCD2345';

  await definition.onPreviewFamilyJoin.call(context);
  assert.equal(context.data.showJoinPreview, true);
  assert.equal(context.data.joinPreview.duplicateCardCount, 3);

  await definition.onConfirmFamilyJoin.call(context);
  assert.equal(calls[0][0], 'preview');
  assert.equal(calls[1][0], 'confirm');
  assert.match(calls[1][2], /^join_/);
  assert.equal(context.data.familyName, '果果家庭');
  assert.equal(context.data.familyMemberCount, 2);
  assert.equal(context.data.memberRole, 'member');
  assert.equal(context.data.showJoinPreview, false);
});
