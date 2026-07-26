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
    const summary = { matched: 0, sent: 0, skipped: 0, failed: 0, duplicate: 0 };

    for (const child of children) {
      if (!shouldRemindChild(child, context)) continue;
      summary.matched += 1;
      const dueCards = getDueCards(await repository.listActiveCards(child._id), now);
      const logResult = await repository.createReminderLog({
        ownerOpenid: child.ownerOpenid,
        childId: child._id,
        bizDate: context.bizDate,
        templateId,
        plannedAt: `${context.bizDate} ${child.reminderTime}`,
        dueCardCount: dueCards.length,
        dueCards: dueCards.slice(0, 20).map((card) => ({
          cardId: card._id,
          contentSnapshot: card.content,
        })),
        status: 'pending',
        skipReason: null,
        errorCode: null,
        errorMessage: null,
        sentAt: null,
        subscriptionEventId: null,
      });

      if (logResult.duplicate) {
        summary.duplicate += 1;
        continue;
      }
      const log = logResult.log;
      if (dueCards.length === 0) {
        await repository.markSkipped(log._id, 'no_due_cards');
        summary.skipped += 1;
        continue;
      }

      const user = await repository.findUserByOpenid(child.ownerOpenid);
      if (!user || Number(user.subscriptionQuota || 0) <= 0) {
        await repository.markSkipped(log._id, 'quota_empty');
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
        else summary.skipped += 1;
      } catch (error) {
        await repository.markFailed(log._id, error);
        summary.failed += 1;
      }
    }

    return summary;
  }

  return { run };
}

module.exports = {
  TEMPLATE_ID,
  createReminderService,
};

