const BATCH_SIZE = 100;

function isDuplicateError(error) {
  const text = `${error && error.errCode || ''} ${error && error.code || ''} ${error && error.message || ''}`;
  return /duplicate|E11000|-502001/i.test(text);
}

function createReminderRepository(db) {
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

  return {
    async listReminderChildren() {
      return listAll(db.collection('children'), { reminderEnabled: true, status: 'active' });
    },

    async listActiveCards(childId) {
      return listAll(db.collection('cards'), { childId, status: 'active' });
    },

    async findUserByOpenid(openid) {
      const result = await db.collection('users').where({ openid, status: 'active' }).limit(1).get();
      return result.data[0] || null;
    },

    async createReminderLog(data) {
      try {
        const createdAt = db.serverDate();
        const result = await db.collection('reminder_logs').add({
          data: { ...data, createdAt, updatedAt: createdAt },
        });
        return { duplicate: false, log: { _id: result._id, ...data } };
      } catch (error) {
        if (!isDuplicateError(error)) throw error;
        return { duplicate: true, log: null };
      }
    },

    async markSkipped(logId, reason) {
      await db.collection('reminder_logs').doc(logId).update({
        data: { status: 'skipped', skipReason: reason, updatedAt: db.serverDate() },
      });
      return { _id: logId, status: 'skipped', skipReason: reason };
    },

    async markFailed(logId, error) {
      await db.collection('reminder_logs').doc(logId).update({
        data: {
          status: 'failed',
          errorCode: String(error.code || error.errCode || 'SEND_FAILED'),
          errorMessage: String(error.message || '订阅消息发送失败').slice(0, 200),
          updatedAt: db.serverDate(),
        },
      });
      return { _id: logId, status: 'failed' };
    },

    async consumeAndMarkSent({ logId, openid, templateId }) {
      return db.runTransaction(async (transaction) => {
        const userResult = await transaction.collection('users')
          .where({ openid, status: 'active' })
          .limit(1)
          .get();
        const user = userResult.data[0] || null;
        if (!user || Number(user.subscriptionQuota || 0) <= 0) {
          await transaction.collection('reminder_logs').doc(logId).update({
            data: { status: 'skipped', skipReason: 'quota_empty', updatedAt: db.serverDate() },
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

