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
    async markSkipped(logId, reason) {
      const log = logs.find((item) => item._id === logId);
      Object.assign(log, { status: 'skipped', skipReason: reason });
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
        Object.assign(log, { status: 'skipped', skipReason: 'quota_empty' });
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

test('上海业务时间和提醒小时判断稳定', () => {
  const context = getShanghaiContext(new Date('2026-07-26T12:05:00.000Z'));
  assert.deepEqual(context, {
    bizDate: '2026-07-26', dayOfWeek: 0, hour: 20, dateTime: '2026-07-26 20:05',
  });
  assert.equal(shouldRemindChild({ studyDays: [0], reminderTime: '20:30' }, context), true);
  assert.equal(shouldRemindChild({ studyDays: [1], reminderTime: '20:00' }, context), false);
});

test('到认字日和提醒小时发送真实待复习数并成功扣额度', async () => {
  const repository = createMemoryRepository();
  const sender = createSender();
  const service = createReminderService({ repository, sender, templateId: TEMPLATE_ID });

  const result = await service.run(new Date('2026-07-26T12:05:00.000Z'));

  assert.deepEqual(result, { matched: 1, sent: 1, skipped: 0, failed: 0, duplicate: 0 });
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
});

test('发送失败不扣额度，重复业务键不重发', async () => {
  const repository = createMemoryRepository();
  const sender = createSender();
  sender.fail = true;
  const service = createReminderService({ repository, sender, templateId: TEMPLATE_ID });
  const now = new Date('2026-07-26T12:05:00.000Z');

  const first = await service.run(now);
  sender.fail = false;
  const second = await service.run(now);

  assert.equal(first.failed, 1);
  assert.equal(second.duplicate, 1);
  assert.equal(sender.calls.length, 1);
  assert.equal(repository.users[0].subscriptionQuota, 2);
  assert.equal(repository.events.length, 0);
  assert.equal(repository.logs[0].status, 'failed');
});

test('无待复习字卡或额度为零时记录 skipped 且不发送', async () => {
  const noDueRepository = createMemoryRepository({
    cards: [{
      _id: 'p1', ownerOpenid: 'openid-1', childId: 'child-1', content: '天',
      proficiency: 'proficient', lastReviewAt: '2026-07-25T04:00:00.000Z', status: 'active',
    }],
  });
  const noDueSender = createSender();
  await createReminderService({ repository: noDueRepository, sender: noDueSender }).run(
    new Date('2026-07-26T12:05:00.000Z'),
  );
  assert.equal(noDueRepository.logs[0].skipReason, 'no_due_cards');
  assert.equal(noDueSender.calls.length, 0);

  const noQuotaRepository = createMemoryRepository({
    users: [{ _id: 'u1', openid: 'openid-1', subscriptionQuota: 0, status: 'active' }],
  });
  const noQuotaSender = createSender();
  await createReminderService({ repository: noQuotaRepository, sender: noQuotaSender }).run(
    new Date('2026-07-26T12:05:00.000Z'),
  );
  assert.equal(noQuotaRepository.logs[0].skipReason, 'quota_empty');
  assert.equal(noQuotaSender.calls.length, 0);
});

test('模板内容限制为 20 个字符', () => {
  const cards = Array.from({ length: 20 }, (_, index) => ({ content: `字${index}` }));
  const data = buildTemplateData(cards, '2026-07-26', '20:00');
  assert.equal(Array.from(data.thing2.value).length <= 20, true);
});
