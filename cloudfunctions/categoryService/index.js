const cloud = require('wx-server-sdk');
const { createCategoryRepository } = require('./repository');
const { createCategoryService } = require('./service');

cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV });

const repository = createCategoryRepository(cloud.database());
const service = createCategoryService(repository);

const actions = {
  list: service.list,
  create: service.create,
  update: service.update,
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
    console.error('categoryService failed', error);
    return {
      ok: false,
      error: {
        code: error.code || 'CATEGORY_SERVICE_FAILED',
        message: error.code ? error.message : '分类操作失败，请稍后重试',
      },
    };
  }
};
