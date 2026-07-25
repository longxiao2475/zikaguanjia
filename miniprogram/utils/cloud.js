function createCloudError(code, message) {
  const error = new Error(message || '请求失败，请稍后重试');
  error.code = code || 'CLOUD_FUNCTION_ERROR';
  return error;
}

async function callFunction(name, data = {}) {
  let response;
  try {
    response = await wx.cloud.callFunction({ name, data });
  } catch (error) {
    const cloudError = createCloudError('NETWORK_ERROR', '网络开小差了，请重试');
    cloudError.cause = error;
    throw cloudError;
  }

  const result = response && response.result;
  if (!result || result.ok !== true) {
    const detail = result && result.error;
    throw createCloudError(detail && detail.code, detail && detail.message);
  }
  return result.data;
}

module.exports = {
  callFunction,
  createCloudError,
};
