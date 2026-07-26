const cloud = require('wx-server-sdk');
const { createSubscriptionRepository } = require('./repository');
const { createSubscriptionService } = require('./service');

cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV });

const repository = createSubscriptionRepository(cloud.database());
const service = createSubscriptionService(repository);

exports.main = async (event = {}) => {
  try {
    const action = service[event.action];
    if (!['getQuota', 'grant'].includes(event.action) || typeof action !== 'function') {
      const error = new Error('不支持的操作');
      error.code = 'ACTION_NOT_SUPPORTED';
      throw error;
    }
    const openid = cloud.getWXContext().OPENID;
    return { ok: true, data: await action(openid, event) };
  } catch (error) {
    console.error('subscriptionService failed', error);
    return {
      ok: false,
      error: {
        code: error.code || 'SUBSCRIPTION_SERVICE_FAILED',
        message: error.code ? error.message : '提醒额度更新失败，请稍后重试',
      },
    };
  }
};

