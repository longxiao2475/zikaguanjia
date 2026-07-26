const cloud = require('wx-server-sdk');
const { createReviewRepository } = require('./repository');
const { createReviewService } = require('./service');

cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV });

const repository = createReviewRepository(cloud.database());
const service = createReviewService(repository);

exports.main = async (event = {}) => {
  try {
    if (event.action !== 'complete') {
      const error = new Error('不支持的操作');
      error.code = 'ACTION_NOT_SUPPORTED';
      throw error;
    }
    const openid = cloud.getWXContext().OPENID;
    return { ok: true, data: await service.complete(openid, event) };
  } catch (error) {
    console.error('reviewService failed', error);
    return {
      ok: false,
      error: {
        code: error.code || 'REVIEW_SERVICE_FAILED',
        message: error.code ? error.message : '复习提交失败，请稍后重试',
      },
    };
  }
};

