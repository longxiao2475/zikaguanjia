const test = require('node:test');
const assert = require('node:assert/strict');

const {
  TEMPLATE_ID,
  createReminderService,
} = require('../cloudfunctions/sendReminder/service');
const {
  buildTemplateData,
  getShanghaiContext,
  shouldRemindChild,
} = require('../cloudfunctions/sendReminder/schedule');

function createMemoryRepository(seed = {}) {
  const children = [...(seed.children || [
    {
      _id: 'child-1', ownerOpenid: 'openid-1', name: '果果', status: 'active',
      reminderEnabled: true, reminderTime: '20:00', studyDays: [0],
    },
  ])];
  const users = [...(seed.users || [
    { _id: 'user-1', openid: 'openid-1', subscriptionQuota: 2, status: 'active' },
  ])];
  const cards = [...(seed.cards || [
    {
      _id: 'card-1', ownerOpenid: 'openid-1', childId: 'child-1', content: '大',
      proficiency: 'unfamiliar', lastReviewAt: null, status: 'active',
    },
    {
      _id: 'card-2', ownerOpenid: 'openid-1', childId: 'child-1', content: '人',
      proficiency: 'normal', lastReviewAt: '2026-07-24T04:00:00.000Z', status: 'active',
    },
    {
      _id: 'card-3', ownerOpenid: 'openid-1', childId: 'child-1', content: '天',
      proficiency: 'proficient', lastReviewAt: '2026-07-25T04:00:00.000Z', status: 'active',
    },
  ])];
  const logs = [];
  const events = [];

  return {
    children,
    users,
    cards,
    logs,
    events,
    async listReminderChildren() {
      return children.filter((child) => child.reminderEnabled && child.status === 'active');
    },
    async listActiveCards(childId) {
      return cards.filter((card) => card.childId === childId && card.status === 'active');
    },
    async findUserByOpenid(openid) {
      return users.find((user) => user.openid === openid && user.status === 'active') || null;
    },
    async findReminderLog({ childId, bizDate, templateId }) {
      return logs.find((log) => (
        log.childId === childId
        && log.bizDate === bizDate
        && log.templateId === templateId
      )) || null;
    },
    async listReminderLogsByOwner(ownerOpenid, bizDate) {
      return logs.filter((log) => (
        log.ownerOpenid === ownerOpenid && log.bizDate === bizDate
      ));
    },
    async createReminderLog(data) {
      const existing = logs.find((log) => (
        log.childId === data.childId
        && log.bizDate === data.bizDate
        && log.templateId === data.templateId
      ));
      if (existing) return { duplicate: true, log: existing };
      const log = { _id: `log-${logs.length + 1}`, ...data };
      logs.push(log);
      return { duplicate: false, log };
    },
    async beginAttempt(logId, snapshot) {
      const log = logs.find((item) => item._id === logId);
      Object.assign(log, {
        ...snapshot,
        status: 'pending',
        attemptCount: Number(log.attemptCount || 0) + 1,
        lastAttemptAt: 'SERVER_DATE',
        skipReason: null,
        errorCode: null,
        errorMessage: null,
      });
      return log;
    },
    async markNoDueCards(logId) {
      const log = logs.find((item) => item._id === logId);
      Object.assign(log, { status: 'no_due_cards', skipReason: 'no_due_cards' });
      return log;
    },
    async markQuotaEmpty(logId) {
      const log = logs.find((item) => item._id === logId);
      Object.assign(log, { status: 'quota_empty', skipReason: 'quota_empty' });
      return log;
    },
    async markFailed(logId, error) {
      const log = logs.find((item) => item._id === logId);
      Object.assign(log, {
        status: 'failed',
        errorCode: error.code || 'SEND_FAILED',
        errorMessage: error.message,
      });
      return log;
    },
    async consumeAndMarkSent({ logId, openid, templateId }) {
      const user = users.find((item) => item.openid === openid && item.status === 'active');
      const log = logs.find((item) => item._id === logId);
      if (!user || Number(user.subscriptionQuota || 0) <= 0) {
        Object.assign(log, { status: 'quota_empty', skipReason: 'quota_empty' });
        return { sent: false, quota: 0 };
      }
      user.subscriptionQuota -= 1;
      const event = {
        _id: `event-${events.length + 1}`,
        ownerOpenid: openid,
        type: 'consume',
        delta: -1,
        balanceAfter: user.subscriptionQuota,
        templateId,
        requestId: `consume_${logId}`,
        reminderLogId: logId,
      };
      events.push(event);
      Object.assign(log, { status: 'sent', subscriptionEventId: event._id, sentAt: 'SERVER_DATE' });
      return { sent: true, quota: user.subscriptionQuota, event };
    },
  };
}

function createSender() {
  return {
    calls: [],
    fail: false,
    async send(message) {
      this.calls.push(message);
      if (this.fail) {
        const error = new Error('微信接口失败');
        error.code = 'WECHAT_SEND_FAILED';
        throw error;
      }
      return { errCode: 0 };
    },
  };
}

test('上海业务时间和到点后提醒判断稳定', () => {
  const context = getShanghaiContext(new Date('2026-07-26T12:05:00.000Z'));
  assert.deepEqual(context, {
    bizDate: '2026-07-26', dayOfWeek: 0, hour: 20, dateTime: '2026-07-26 20:05',
  });
  assert.equal(shouldRemindChild({ studyDays: [0], reminderTime: '20:00' }, context), true);
  assert.equal(shouldRemindChild({ studyDays: [0], reminderTime: '19:00' }, context), true);
  assert.equal(shouldRemindChild({ studyDays: [0], reminderTime: '21:00' }, context), false);
  assert.equal(shouldRemindChild({ studyDays: [1], reminderTime: '20:00' }, context), false);
});

test('到认字日和提醒小时发送真实待复习数并成功扣额度', async () => {
  const repository = createMemoryRepository();
  const sender = createSender();
  const service = createReminderService({ repository, sender, templateId: TEMPLATE_ID });

  const result = await service.run(new Date('2026-07-26T12:05:00.000Z'));

  assert.deepEqual(result, {
    matched: 1, sent: 1, skipped: 0, failed: 0, alreadySent: 0,
  });
  assert.equal(sender.calls.length, 1);
  assert.equal(sender.calls[0].touser, 'openid-1');
  assert.equal(sender.calls[0].templateId, TEMPLATE_ID);
  assert.deepEqual(sender.calls[0].data, {
    number1: { value: '2' },
    thing2: { value: '大、人' },
    time5: { value: '2026-07-26 20:00' },
  });
  assert.equal(repository.users[0].subscriptionQuota, 1);
  assert.equal(repository.events[0].type, 'consume');
  assert.equal(repository.logs[0].status, 'sent');
  assert.equal(repository.logs[0].dueCardCount, 2);
  assert.equal(repository.logs[0].attemptCount, 1);
});

test('发送失败不扣额度并在下一小时补发，成功后当天不再发送', async () => {
  const repository = createMemoryRepository();
  const sender = createSender();
  sender.fail = true;
  const service = createReminderService({ repository, sender, templateId: TEMPLATE_ID });

  const first = await service.run(new Date('2026-07-26T12:05:00.000Z'));
  sender.fail = false;
  const second = await service.run(new Date('2026-07-26T13:05:00.000Z'));
  const third = await service.run(new Date('2026-07-26T14:05:00.000Z'));

  assert.equal(first.failed, 1);
  assert.equal(second.sent, 1);
  assert.equal(third.alreadySent, 1);
  assert.equal(sender.calls.length, 2);
  assert.equal(repository.users[0].subscriptionQuota, 1);
  assert.equal(repository.events.length, 1);
  assert.equal(repository.logs.length, 1);
  assert.equal(repository.logs[0].status, 'sent');
  assert.equal(repository.logs[0].attemptCount, 2);
});

test('无待复习字卡时下一小时重新计算并补发', async () => {
  const repository = createMemoryRepository({
    cards: [{
      _id: 'p1', ownerOpenid: 'openid-1', childId: 'child-1', content: '天',
      proficiency: 'proficient', lastReviewAt: '2026-07-25T04:00:00.000Z', status: 'active',
    }],
  });
  const sender = createSender();
  const service = createReminderService({ repository, sender });

  await service.run(new Date('2026-07-26T12:05:00.000Z'));
  assert.equal(repository.logs[0].skipReason, 'no_due_cards');
  assert.equal(sender.calls.length, 0);

  repository.cards.push({
    _id: 'new-card', ownerOpenid: 'openid-1', childId: 'child-1', content: '新',
    proficiency: 'unfamiliar', lastReviewAt: null, status: 'active',
  });
  const retried = await service.run(new Date('2026-07-26T13:05:00.000Z'));

  assert.equal(retried.sent, 1);
  assert.equal(sender.calls.length, 1);
  assert.equal(repository.logs[0].attemptCount, 2);
});

test('额度为零时补充额度后下一小时发送', async () => {
  const repository = createMemoryRepository({
    users: [{ _id: 'u1', openid: 'openid-1', subscriptionQuota: 0, status: 'active' }],
  });
  const sender = createSender();
  const service = createReminderService({ repository, sender });

  await service.run(new Date('2026-07-26T12:05:00.000Z'));
  assert.equal(repository.logs[0].skipReason, 'quota_empty');
  assert.equal(sender.calls.length, 0);

  repository.users[0].subscriptionQuota = 1;
  const retried = await service.run(new Date('2026-07-26T13:05:00.000Z'));

  assert.equal(retried.sent, 1);
  assert.equal(sender.calls.length, 1);
  assert.equal(repository.users[0].subscriptionQuota, 0);
  assert.equal(repository.logs[0].attemptCount, 2);
});

test('次日重新建立日志并允许再次发送', async () => {
  const repository = createMemoryRepository({
    children: [{
      _id: 'child-1', ownerOpenid: 'openid-1', status: 'active', reminderEnabled: true,
      reminderTime: '20:00', studyDays: [0, 1],
    }],
  });
  const sender = createSender();
  const service = createReminderService({ repository, sender });

  await service.run(new Date('2026-07-26T12:05:00.000Z'));
  const nextDay = await service.run(new Date('2026-07-27T12:05:00.000Z'));

  assert.equal(nextDay.sent, 1);
  assert.equal(repository.logs.length, 2);
  assert.equal(sender.calls.length, 2);
});

test('当前用户可以只读查询当天提醒失败详情', async () => {
  const repository = createMemoryRepository();
  const sender = createSender();
  sender.fail = true;
  const service = createReminderService({ repository, sender });
  const now = new Date('2026-07-26T12:05:00.000Z');

  await service.run(now);
  const status = await service.getStatus('openid-1', now);

  assert.equal(status.bizDate, '2026-07-26');
  assert.equal(status.logs.length, 1);
  assert.equal(status.logs[0].status, 'failed');
  assert.equal(status.logs[0].errorCode, 'WECHAT_SEND_FAILED');
});

test('模板内容限制为 20 个字符', () => {
  const cards = Array.from({ length: 20 }, (_, index) => ({ content: `字${index}` }));
  const data = buildTemplateData(cards, '2026-07-26', '20:00');
  assert.equal(Array.from(data.thing2.value).length <= 20, true);
});
