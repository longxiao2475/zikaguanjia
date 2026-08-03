const BATCH_SIZE = 100;

function isDuplicateError(error) {
  const text = `${error && error.errCode || ''} ${error && error.code || ''} ${error && error.message || ''}`;
  return /duplicate|E11000|-502001/i.test(text);
}

function createReminderRepository(db) {
  const reminderLogs = db.collection('reminder_logs');

  async function listAll(collection, query) {
    const items = [];
    let offset = 0;
    while (true) {
      const result = await collection.where(query).skip(offset).limit(BATCH_SIZE).get();
      items.push(...result.data);
      if (result.data.length < BATCH_SIZE) break;
      offset += BATCH_SIZE;
    }
    return items;
  }

  async function readReminderLog(logId) {
    const result = await reminderLogs.doc(logId).get();
    return result.data || null;
  }

  async function findExactReminderLog(query) {
    const result = await reminderLogs.where(query).limit(1).get();
    return result.data[0] || null;
  }

  async function findReminderLog(query) {
    const log = await findExactReminderLog(query);
    if (log || !query.recipientOpenid) return log;
    return findExactReminderLog({
      ownerOpenid: query.recipientOpenid,
      childId: query.childId,
      bizDate: query.bizDate,
      templateId: query.templateId,
    });
  }

  async function updateReminderLog(logId, data) {
    await reminderLogs.doc(logId).update({
      data: { ...data, updatedAt: db.serverDate() },
    });
    return readReminderLog(logId);
  }

  return {
    async listReminderTargets() {
      const [members, children] = await Promise.all([
        listAll(db.collection('family_members'), { status: 'active' }),
        listAll(db.collection('children'), { status: 'active' }),
      ]);
      return members
        .filter((member) => member.reminderEnabled !== false)
        .flatMap((member) => children
          .filter((child) => child.familyId === member.familyId)
          .map((child) => ({
            ...child,
            recipientOpenid: member.openid,
            memberId: member._id,
            reminderEnabled: member.reminderEnabled !== false,
            reminderTime: member.reminderTime || '20:00',
          })));
    },

    async listActiveCards(familyId, childId) {
      return listAll(db.collection('cards'), { familyId, childId, status: 'active' });
    },

    async findUserByOpenid(openid) {
      const result = await db.collection('users').where({ openid, status: 'active' }).limit(1).get();
      return result.data[0] || null;
    },

    findReminderLog,

    async listReminderLogsByRecipient(recipientOpenid, bizDate) {
      const [current, legacy] = await Promise.all([
        listAll(reminderLogs, { recipientOpenid, bizDate }),
        listAll(reminderLogs, { ownerOpenid: recipientOpenid, bizDate }),
      ]);
      return [...new Map([...current, ...legacy].map((item) => [item._id, item])).values()];
    },

    async createReminderLog(data) {
      try {
        const createdAt = db.serverDate();
        const result = await reminderLogs.add({
          data: { ...data, createdAt, updatedAt: createdAt },
        });
        return { duplicate: false, log: { _id: result._id, ...data } };
      } catch (error) {
        if (!isDuplicateError(error)) throw error;
        return {
          duplicate: true,
          log: await findReminderLog({
            familyId: data.familyId,
            childId: data.childId,
            recipientOpenid: data.recipientOpenid,
            bizDate: data.bizDate,
            templateId: data.templateId,
          }),
        };
      }
    },

    async beginAttempt(logId, snapshot) {
      await reminderLogs.doc(logId).update({
        data: {
          ...snapshot,
          status: 'pending',
          attemptCount: db.command.inc(1),
          lastAttemptAt: db.serverDate(),
          skipReason: null,
          errorCode: null,
          errorMessage: null,
          updatedAt: db.serverDate(),
        },
      });
      return readReminderLog(logId);
    },

    async markNoDueCards(logId) {
      return updateReminderLog(logId, {
        status: 'no_due_cards',
        skipReason: 'no_due_cards',
      });
    },

    async markQuotaEmpty(logId) {
      return updateReminderLog(logId, {
        status: 'quota_empty',
        skipReason: 'quota_empty',
      });
    },

    async markFailed(logId, error) {
      return updateReminderLog(logId, {
        status: 'failed',
        errorCode: String(error.code || error.errCode || 'SEND_FAILED'),
        errorMessage: String(error.message || '订阅消息发送失败').slice(0, 200),
      });
    },

    async consumeAndMarkSent({ logId, openid, templateId }) {
      return db.runTransaction(async (transaction) => {
        const logResult = await transaction.collection('reminder_logs').doc(logId).get();
        const log = logResult.data || null;
        if (log && log.status === 'sent') {
          return { sent: false, alreadySent: true };
        }
        const userResult = await transaction.collection('users')
          .where({ openid, status: 'active' })
          .limit(1)
          .get();
        const user = userResult.data[0] || null;
        if (!user || Number(user.subscriptionQuota || 0) <= 0) {
          await transaction.collection('reminder_logs').doc(logId).update({
            data: {
              status: 'quota_empty',
              skipReason: 'quota_empty',
              updatedAt: db.serverDate(),
            },
          });
          return { sent: false, quota: 0 };
        }

        const quota = Number(user.subscriptionQuota) - 1;
        const sentAt = db.serverDate();
        await transaction.collection('users').doc(user._id).update({
          data: { subscriptionQuota: quota, updatedAt: sentAt },
        });
        const eventData = {
          ownerOpenid: openid,
          type: 'consume',
          delta: -1,
          balanceAfter: quota,
          templateId,
          source: 'scheduled_reminder',
          requestId: `consume_${logId}`,
          reminderLogId: logId,
          createdAt: sentAt,
        };
        const eventResult = await transaction.collection('subscription_events').add({ data: eventData });
        await transaction.collection('reminder_logs').doc(logId).update({
          data: {
            status: 'sent',
            skipReason: null,
            errorCode: null,
            errorMessage: null,
            sentAt,
            subscriptionEventId: eventResult._id,
            updatedAt: sentAt,
          },
        });
        return {
          sent: true,
          quota,
          event: { _id: eventResult._id, ...eventData },
        };
      });
    },
  };
}

module.exports = {
  BATCH_SIZE,
  createReminderRepository,
  isDuplicateError,
};
