const {
  buildTemplateData,
  getDueCards,
  getShanghaiContext,
  shouldRemindChild,
} = require('./schedule');

const TEMPLATE_ID = '38gNuA8j_S9YEP-incMBQnGnjVE6WxP1Lm8NRRPngkM';

function createReminderService({ repository, sender, templateId = TEMPLATE_ID } = {}) {
  if (!repository) throw new Error('REPOSITORY_REQUIRED');
  if (!sender || typeof sender.send !== 'function') throw new Error('SENDER_REQUIRED');

  async function run(now = new Date()) {
    const context = getShanghaiContext(now);
    const children = await repository.listReminderChildren();
    const summary = { matched: 0, sent: 0, skipped: 0, failed: 0, alreadySent: 0 };

    for (const child of children) {
      if (!shouldRemindChild(child, context)) continue;
      summary.matched += 1;
      let log = await repository.findReminderLog({
        childId: child._id,
        bizDate: context.bizDate,
        templateId,
      });
      if (log && log.status === 'sent') {
        summary.alreadySent += 1;
        continue;
      }

      const dueCards = getDueCards(await repository.listActiveCards(child._id), now);
      if (!log) {
        const logResult = await repository.createReminderLog({
          ownerOpenid: child.ownerOpenid,
          childId: child._id,
          bizDate: context.bizDate,
          templateId,
          plannedAt: `${context.bizDate} ${child.reminderTime}`,
          dueCardCount: 0,
          dueCards: [],
          status: 'pending',
          attemptCount: 0,
          lastAttemptAt: null,
          skipReason: null,
          errorCode: null,
          errorMessage: null,
          sentAt: null,
          subscriptionEventId: null,
        });
        log = logResult.log || await repository.findReminderLog({
          childId: child._id,
          bizDate: context.bizDate,
          templateId,
        });
      }
      if (!log) throw new Error('REMINDER_LOG_CREATE_FAILED');
      if (log.status === 'sent') {
        summary.alreadySent += 1;
        continue;
      }

      await repository.beginAttempt(log._id, {
        dueCardCount: dueCards.length,
        dueCards: dueCards.slice(0, 20).map((card) => ({
          cardId: card._id,
          contentSnapshot: card.content,
        })),
      });
      if (dueCards.length === 0) {
        await repository.markNoDueCards(log._id);
        summary.skipped += 1;
        continue;
      }

      const user = await repository.findUserByOpenid(child.ownerOpenid);
      if (!user || Number(user.subscriptionQuota || 0) <= 0) {
        await repository.markQuotaEmpty(log._id);
        summary.skipped += 1;
        continue;
      }

      try {
        await sender.send({
          touser: child.ownerOpenid,
          templateId,
          page: 'pages/review/index',
          data: buildTemplateData(dueCards, context.bizDate, child.reminderTime),
        });
        const consumed = await repository.consumeAndMarkSent({
          logId: log._id,
          openid: child.ownerOpenid,
          templateId,
        });
        if (consumed.sent) summary.sent += 1;
        else if (consumed.alreadySent) summary.alreadySent += 1;
        else summary.skipped += 1;
      } catch (error) {
        await repository.markFailed(log._id, error);
        summary.failed += 1;
      }
    }

    return summary;
  }

  async function getStatus(openid, now = new Date()) {
    if (!openid || typeof openid !== 'string') throw new Error('OPENID_REQUIRED');
    const context = getShanghaiContext(now);
    const logs = await repository.listReminderLogsByOwner(openid, context.bizDate);
    return { bizDate: context.bizDate, logs };
  }

  return { getStatus, run };
}

module.exports = {
  TEMPLATE_ID,
  createReminderService,
};
