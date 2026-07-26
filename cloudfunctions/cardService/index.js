const cloud = require('wx-server-sdk');
const { createCardRepository } = require('./repository');
const { createCardService } = require('./service');

cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV });

const repository = createCardRepository(cloud.database());
const service = createCardService(repository);

const actions = {
  create: service.create,
  getByIds: service.getByIds,
  list: service.list,
  getTodayPlan: service.getTodayPlan,
  update: service.update,
  delete: service.remove,
};

exports.main = async (event = {}) => {
  try {
    const action = actions[event.action];
    if (!action) {
      const error = new Error('不支持的操作');
      error.code = 'ACTION_NOT_SUPPORTED';
      throw error;
    }
    const openid = cloud.getWXContext().OPENID;
    const data = await action(openid, event);
    return { ok: true, data };
  } catch (error) {
    console.error('cardService failed', error);
    return {
      ok: false,
      error: {
        code: error.code || 'CARD_SERVICE_FAILED',
        message: error.code ? error.message : '字卡操作失败，请稍后重试',
      },
    };
  }
};
