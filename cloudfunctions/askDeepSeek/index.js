// cloudfunctions/askDeepSeek/index.js
// 职责：接收前端传来的认字任务 → 携带环境变量中的 Key 调用 DeepSeek API
//       → 解析严格 JSON（encouragement / steps / tips）→ 写入 tasks 集合 → 返回结果
//
// 安全约束（必须遵守）：
//   1. API Key 只从 process.env.DEEPSEEK_API_KEY 读取，严禁硬编码明文 Key
//   2. Key 配置路径：微信云开发控制台 → 云函数 → askDeepSeek → 配置 → 环境变量
//   3. 前端禁止直接 wx.request 请求 DeepSeek（密钥会随包泄露），一律走本云函数
const cloud = require('wx-server-sdk');
const https = require('https');

cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV });
const db = cloud.database();

const DEEPSEEK_HOST = 'api.deepseek.com';
const DEEPSEEK_PATH = '/chat/completions';
const DEEPSEEK_MODEL = 'deepseek-chat';
const REQUEST_TIMEOUT_MS = 45000; // 单次 HTTP 请求超时（须小于云函数 60s 超时）

// 输入校验上限，防止超长 prompt 刷接口费用
const MAX_TASK_LENGTH = 200;

const SYSTEM_PROMPT = [
  '你是一位幼儿识字教育专家，服务对象是 3-6 岁孩子的家长。',
  '家长会用一句话描述一个认字任务或教学困惑，你需要把它拆解成具体可执行的步骤。',
  '',
  '请严格输出一个 JSON 对象，不要输出 JSON 以外的任何文字，字段如下：',
  '{',
  '  "encouragement": "一句给家长的温暖鼓励，30字以内",',
  '  "steps": ["步骤1", "步骤2", "..."],',
  '  "tips": ["提示1", "提示2", "..."]',
  '}',
  '',
  '要求：',
  '- steps 给 3-5 步，每步具体可执行，遵循"孩子不看屏幕、家长拿实体字卡陪练"的原则',
  '- tips 给 2-3 条，是幼儿识字教学的实用技巧',
  '- 语气温暖、口语化，避免专业术语',
].join('\n');

/**
 * 调用 DeepSeek Chat Completions（原生 https，零外部依赖）
 * 使用 response_format=json_object 强制模型输出 JSON
 */
function callDeepSeek(task) {
  const apiKey = process.env.DEEPSEEK_API_KEY;
  if (!apiKey) {
    return Promise.reject(new Error('云函数未配置环境变量 DEEPSEEK_API_KEY'));
  }

  const body = JSON.stringify({
    model: DEEPSEEK_MODEL,
    messages: [
      { role: 'system', content: SYSTEM_PROMPT },
      { role: 'user', content: task },
    ],
    response_format: { type: 'json_object' },
    temperature: 0.7,
    max_tokens: 1024,
  });

  return new Promise((resolve, reject) => {
    const req = https.request(
      {
        hostname: DEEPSEEK_HOST,
        path: DEEPSEEK_PATH,
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${apiKey}`,
          'Content-Length': Buffer.byteLength(body),
        },
        timeout: REQUEST_TIMEOUT_MS,
      },
      (res) => {
        let raw = '';
        res.on('data', (chunk) => (raw += chunk));
        res.on('end', () => {
          let json;
          try {
            json = JSON.parse(raw);
          } catch (e) {
            return reject(new Error(`DeepSeek 响应非 JSON：HTTP ${res.statusCode}`));
          }
          if (res.statusCode !== 200) {
            const msg = (json.error && json.error.message) || raw.slice(0, 200);
            return reject(new Error(`DeepSeek HTTP ${res.statusCode}: ${msg}`));
          }
          const content =
            json.choices && json.choices[0] && json.choices[0].message
              ? json.choices[0].message.content
              : '';
          if (!content) return reject(new Error('DeepSeek 返回内容为空'));
          resolve(content);
        });
      }
    );
    req.on('timeout', () => req.destroy(new Error('DeepSeek 请求超时')));
    req.on('error', reject);
    req.write(body);
    req.end();
  });
}

/**
 * 解析模型输出为 { encouragement, steps, tips }
 * 兜底：即使模型输出了 markdown 代码块包裹的 JSON 也能提取
 */
function parseAiResult(content) {
  let text = content.trim();
  const fenced = text.match(/```(?:json)?\s*([\s\S]*?)```/);
  if (fenced) text = fenced[1].trim();

  let obj;
  try {
    obj = JSON.parse(text);
  } catch (e) {
    throw new Error('AI 返回内容不是合法 JSON');
  }

  const encouragement = typeof obj.encouragement === 'string' ? obj.encouragement.trim() : '';
  const steps = Array.isArray(obj.steps) ? obj.steps.filter((s) => typeof s === 'string' && s.trim()) : [];
  const tips = Array.isArray(obj.tips) ? obj.tips.filter((s) => typeof s === 'string' && s.trim()) : [];

  if (!encouragement || steps.length === 0 || tips.length === 0) {
    throw new Error('AI 返回 JSON 字段不完整（需含 encouragement / steps / tips）');
  }
  return { encouragement, steps, tips };
}

exports.main = async (event) => {
  const { OPENID } = cloud.getWXContext();
  const task = String((event && event.task) || '').trim();

  // ---- 入参校验 ----
  if (!task) {
    return { code: 400, message: '任务内容不能为空' };
  }
  if (task.length > MAX_TASK_LENGTH) {
    return { code: 400, message: `任务内容过长，请控制在 ${MAX_TASK_LENGTH} 字以内` };
  }

  // ---- 调用 DeepSeek 并解析 ----
  let aiResult;
  try {
    const content = await callDeepSeek(task);
    aiResult = parseAiResult(content);
  } catch (err) {
    console.error('[askDeepSeek] 调用失败', err);
    return { code: 502, message: err.message || 'AI 拆解失败，请稍后重试' };
  }

  // ---- 写入 tasks 集合（openid + 任务 + AI 结果 + 创建时间）----
  try {
    const addRes = await db.collection('tasks').add({
      data: {
        openid: OPENID,
        task,
        result: aiResult,
        createdAt: db.serverDate(),
      },
    });
    return {
      code: 0,
      message: 'ok',
      data: {
        _id: addRes._id,
        task,
        result: aiResult,
      },
    };
  } catch (err) {
    console.error('[askDeepSeek] 写库失败', err);
    // 拆解已成功但落库失败：把结果照样返回给前端，同时告知未保存
    return {
      code: 500,
      message: 'AI 拆解成功，但历史记录保存失败',
      data: { task, result: aiResult },
    };
  }
};
