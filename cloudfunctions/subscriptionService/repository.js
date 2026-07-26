function businessError(code, message) {
  const error = new Error(message || code);
  error.code = code;
  return error;
}

function createSubscriptionRepository(db) {
  async function findActiveUser(collection, openid) {
    const result = await collection.where({ openid, status: 'active' }).limit(1).get();
    return result.data[0] || null;
  }

  return {
    async getQuota(openid) {
      const user = await findActiveUser(db.collection('users'), openid);
      if (!user) throw businessError('USER_NOT_FOUND', '用户不存在，请重新进入小程序');
      return Number(user.subscriptionQuota || 0);
    },

    async grant({ openid, requestId, source, templateId }) {
      return db.runTransaction(async (transaction) => {
        const eventResult = await transaction.collection('subscription_events')
          .where({ ownerOpenid: openid, requestId })
          .limit(1)
          .get();
        const existing = eventResult.data[0] || null;
        if (existing) {
          return { quota: existing.balanceAfter, event: existing, idempotent: true };
        }

        const user = await findActiveUser(transaction.collection('users'), openid);
        if (!user) throw businessError('USER_NOT_FOUND', '用户不存在，请重新进入小程序');
        const quota = Number(user.subscriptionQuota || 0) + 1;
        const createdAt = db.serverDate();
        await transaction.collection('users').doc(user._id).update({
          data: { subscriptionQuota: quota, updatedAt: createdAt },
        });
        const eventData = {
          ownerOpenid: openid,
          type: 'grant',
          delta: 1,
          balanceAfter: quota,
          templateId,
          source,
          requestId,
          reminderLogId: null,
          createdAt,
        };
        const created = await transaction.collection('subscription_events').add({ data: eventData });
        return {
          quota,
          event: { _id: created._id, ...eventData },
          idempotent: false,
        };
      });
    },
  };
}

module.exports = {
  createSubscriptionRepository,
};

