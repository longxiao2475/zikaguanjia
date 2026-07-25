// miniprogram/utils/aiTask.js
// AI 任务拆解 — 云函数调用封装
//
// 安全红线（与后端架构约定一致）：
//   前端绝不直接 wx.request 请求 DeepSeek 等外部大模型 API（密钥会随包泄露，
//   且外部域名需进 request 合法域名白名单）。一切大模型调用走 wx.cloud.callFunction。
//
// 用法：
//   const aiTask = require('../../utils/aiTask.js');
//   aiTask.ask('今天想带果果认识"大小多少"').then(data => ...);
//   aiTask.getHistory(1, 20).then(data => ...);   // 头像点击事件里调用

/**
 * 统一调用云函数并把 { code, message, data } 协议转成 Promise 风格
 */
function call(name, data) {
  return new Promise((resolve, reject) => {
    wx.cloud.callFunction({
      name,
      data,
      success: (res) => {
        const r = res.result || {};
        if (r.code === 0) {
          resolve(r.data);
        } else {
          // code=500 时 askDeepSeek 也可能带 data（拆解成功但落库失败），一并透出
          const err = new Error(r.message || '请求失败，请稍后重试');
          err.code = r.code;
          err.data = r.data;
          reject(err);
        }
      },
      fail: (err) => {
        const wrapped = new Error(err.errMsg || '网络异常，请检查网络后重试');
        wrapped.code = -1;
        reject(wrapped);
      },
    });
  });
}

/**
 * 提交认字任务，让 DeepSeek 拆解为 { encouragement, steps, tips }
 * 成功后云端会自动把记录写入 tasks 集合
 * @param {string} task 任务描述（200 字以内）
 * @returns {Promise<{_id, task, result}>}
 */
function ask(task) {
  const content = String(task || '').trim();
  if (!content) return Promise.reject(new Error('请先描述一个认字任务'));
  if (content.length > 200) return Promise.reject(new Error('任务描述请控制在 200 字以内'));
  return call('askDeepSeek', { task: content });
}

/**
 * 拉取当前用户的 AI 拆解历史（按时间倒序）
 * 供头像点击事件调用
 * @param {number} page 页码，从 1 开始
 * @param {number} pageSize 每页条数，最大 50
 * @returns {Promise<{list, total, page, pageSize, hasMore}>}
 */
function getHistory(page = 1, pageSize = 20) {
  return call('getHistory', { page, pageSize });
}

module.exports = { ask, getHistory };

/* ---------------- 头像点击接入示例（首页） ----------------
// pages/index/index.js
const aiTask = require('../../utils/aiTask.js');

Page({
  data: { historyList: [], showHistory: false },

  // 点头像 → 弹出历史记录
  async onTapAvatar() {
    this.setData({ showHistory: true });
    wx.showLoading({ title: '加载中' });
    try {
      const data = await aiTask.getHistory(1, 20);
      this.setData({ historyList: data.list });
    } catch (e) {
      wx.showToast({ title: e.message, icon: 'none' });
    } finally {
      wx.hideLoading();
    }
  },

  // 提交任务让 AI 拆解
  async onSubmitTask(e) {
    wx.showLoading({ title: 'AI 拆解中…' });
    try {
      const data = await aiTask.ask(e.detail.value.task);
      // data.result = { encouragement, steps, tips }
    } catch (e) {
      wx.showToast({ title: e.message, icon: 'none' });
    } finally {
      wx.hideLoading();
    }
  },
});
-------------------------------------------------------- */
