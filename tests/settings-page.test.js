const test = require('node:test');
const assert = require('node:assert/strict');
const Module = require('node:module');
const path = require('node:path');

const pagePath = path.join(__dirname, '../miniprogram/pages/settings/index.js');

function loadSettingsPage() {
  const originalLoad = Module._load;
  let definition;
  global.Page = (config) => { definition = config; };
  global.wx = { showToast() {} };
  Module._load = function mockLoad(request, parent, isMain) {
    if (request === '../../utils/session') return {};
    if (request === '../../utils/subscribe') return {};
    return originalLoad(request, parent, isMain);
  };
  delete require.cache[pagePath];
  try {
    require(pagePath);
  } finally {
    Module._load = originalLoad;
    delete global.Page;
    delete global.wx;
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
  );

  assert.equal(context.data.hourOptions.length, 24);
  assert.equal(context.data.hourOptions[0], '00:00');
  assert.equal(context.data.hourOptions[23], '23:00');
  assert.equal(context.data.reminderHourIndex, 13);
  assert.equal(context.data.reminderTime, '13:00');
});

test('设置页选择小时后只产生整点提醒值', () => {
  const definition = loadSettingsPage();
  const context = createContext(definition);

  definition.onTimeChange.call(context, { detail: { value: '7' } });

  assert.equal(context.data.reminderHourIndex, 7);
  assert.equal(context.data.reminderTime, '07:00');
});
