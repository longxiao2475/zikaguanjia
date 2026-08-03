const test = require('node:test');
const assert = require('node:assert/strict');

const { createReminderRepository } = require('../cloudfunctions/sendReminder/repository');

function createFakeDb(seed = {}) {
  const tables = {
    reminder_logs: [...(seed.reminder_logs || [])],
    users: [...(seed.users || [])],
    subscription_events: [...(seed.subscription_events || [])],
    children: [...(seed.children || [])],
    cards: [...(seed.cards || [])],
    family_members: [...(seed.family_members || [])],
  };

  function matches(item, query) {
    return Object.entries(query || {}).every(([key, value]) => item[key] === value);
  }

  function applyUpdates(item, updates) {
    for (const [key, value] of Object.entries(updates)) {
      if (value && value.__op === 'inc') item[key] = Number(item[key] || 0) + value.value;
      else item[key] = value;
    }
  }

  function collection(name) {
    const state = { query: {}, skip: 0, limit: Infinity };
    const api = {
      where(query) {
        state.query = query;
        return api;
      },
      skip(value) {
        state.skip = value;
        return api;
      },
      limit(value) {
        state.limit = value;
        return api;
      },
      async get() {
        return {
          data: tables[name]
            .filter((item) => matches(item, state.query))
            .slice(state.skip, state.skip + state.limit),
        };
      },
      async add({ data }) {
        const doc = { _id: `${name}-${tables[name].length + 1}`, ...data };
        tables[name].push(doc);
        return { _id: doc._id };
      },
      doc(id) {
        return {
          async get() {
            return { data: tables[name].find((item) => item._id === id) || null };
          },
          async update({ data }) {
            const item = tables[name].find((entry) => entry._id === id);
            applyUpdates(item, data);
            return { stats: { updated: 1 } };
          },
        };
      },
    };
    return api;
  }

  return {
    tables,
    collection,
    command: { inc: (value) => ({ __op: 'inc', value }) },
    serverDate: () => 'SERVER_DATE',
    async runTransaction(handler) {
      return handler({ collection });
    },
  };
}

test('提醒仓储复用每日日志并累计尝试次数和状态', async () => {
  const db = createFakeDb({
    reminder_logs: [{
      _id: 'log-1', ownerOpenid: 'openid-1', recipientOpenid: 'openid-1', familyId: 'family-1',
      childId: 'child-1', bizDate: '2026-07-30', templateId: 'tpl',
      status: 'failed', attemptCount: 1,
    }],
  });
  const repository = createReminderRepository(db);

  const found = await repository.findReminderLog({
    familyId: 'family-1', childId: 'child-1', recipientOpenid: 'openid-1',
    bizDate: '2026-07-30', templateId: 'tpl',
  });
  const owned = await repository.listReminderLogsByRecipient('openid-1', '2026-07-30');
  const attempted = await repository.beginAttempt(found._id, {
    dueCardCount: 2,
    dueCards: [{ cardId: 'card-1', contentSnapshot: '大' }],
  });
  const attemptedSnapshot = { ...attempted };
  const noDue = await repository.markNoDueCards(found._id);
  const noDueStatus = noDue.status;
  const quotaEmpty = await repository.markQuotaEmpty(found._id);
  const quotaEmptyStatus = quotaEmpty.status;
  const failed = await repository.markFailed(found._id, Object.assign(new Error('失败'), { code: 'WX_FAIL' }));

  assert.equal(attemptedSnapshot.attemptCount, 2);
  assert.equal(owned.length, 1);
  assert.equal(attemptedSnapshot.dueCardCount, 2);
  assert.equal(noDueStatus, 'no_due_cards');
  assert.equal(quotaEmptyStatus, 'quota_empty');
  assert.equal(failed.status, 'failed');
  assert.equal(failed.errorCode, 'WX_FAIL');
});

test('提醒仓储按家庭成员生成接收目标并隔离每个接收人的日志', async () => {
  const db = createFakeDb({
    children: [
      { _id: 'child-1', familyId: 'family-1', status: 'active', studyDays: [0] },
      { _id: 'child-2', familyId: 'family-2', status: 'active', studyDays: [0] },
    ],
    family_members: [
      {
        _id: 'member-1', familyId: 'family-1', openid: 'openid-1', status: 'active',
        reminderEnabled: true, reminderTime: '20:00',
      },
      {
        _id: 'member-2', familyId: 'family-1', openid: 'openid-2', status: 'active',
        reminderEnabled: false, reminderTime: '20:00',
      },
      {
        _id: 'member-3', familyId: 'family-2', openid: 'openid-3', status: 'active',
        reminderEnabled: true, reminderTime: '19:00',
      },
    ],
    cards: [
      { _id: 'card-1', familyId: 'family-1', childId: 'child-1', status: 'active' },
      { _id: 'foreign', familyId: 'family-2', childId: 'child-1', status: 'active' },
    ],
  });
  const repository = createReminderRepository(db);

  const targets = await repository.listReminderTargets();
  const cards = await repository.listActiveCards('family-1', 'child-1');
  await repository.createReminderLog({
    familyId: 'family-1', childId: 'child-1', recipientOpenid: 'openid-1',
    ownerOpenid: 'openid-1', bizDate: '2026-07-30', templateId: 'tpl', status: 'pending',
  });
  await repository.createReminderLog({
    familyId: 'family-1', childId: 'child-1', recipientOpenid: 'openid-2',
    ownerOpenid: 'openid-2', bizDate: '2026-07-30', templateId: 'tpl', status: 'pending',
  });

  assert.deepEqual(targets.map((item) => [item._id, item.recipientOpenid]), [
    ['child-1', 'openid-1'],
    ['child-2', 'openid-3'],
  ]);
  assert.deepEqual(cards.map((item) => item._id), ['card-1']);
  assert.equal(db.tables.reminder_logs.length, 2);
});

test('提醒发送成功后事务扣一次额度并写入 sent 日志', async () => {
  const db = createFakeDb({
    reminder_logs: [{
      _id: 'log-1', childId: 'child-1', bizDate: '2026-07-30', templateId: 'tpl',
      status: 'pending', attemptCount: 1,
    }],
    users: [{ _id: 'user-1', openid: 'openid-1', status: 'active', subscriptionQuota: 2 }],
  });
  const repository = createReminderRepository(db);

  const result = await repository.consumeAndMarkSent({
    logId: 'log-1', openid: 'openid-1', templateId: 'tpl',
  });

  assert.equal(result.sent, true);
  assert.equal(result.quota, 1);
  assert.equal(db.tables.users[0].subscriptionQuota, 1);
  assert.equal(db.tables.reminder_logs[0].status, 'sent');
  assert.equal(db.tables.subscription_events.length, 1);
  assert.equal(db.tables.subscription_events[0].source, 'scheduled_reminder');
});
