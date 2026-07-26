# 字卡管家 MVP — 技术方案文档 v2.1

> 作者：Tech Lead | 日期：2026-07-25
> 基于 PRD v1.1 + 全部决策确认
> v2.0 变更：① 主体类型确认=个人，语音走 Path B ② 广告移出 MVP ③ 字卡额度机制待 PM 最终确认（冻结中）④ 组词词典数据已完成 ⑤ 项目骨架已建成
> **v2.1 变更（2026-07-25 技术核查 + 新需求落地）**：
> ① DeepSeek AI 任务拆解已移出 MVP、待单独立项；Day 6 已从 MVP 仓库删除 askDeepSeek / aiTask 示例，getHistory 已删除
> ② 核查修正：分包词典被主包 require 会丧失分包意义（见 §6.6）
> ③ 核查修正：仓库当前仍是云开发 QuickStart 模板，v2.0 所述"骨架已建成（43 文件）"尚未合入仓库（见 §10.4）
> ④ 补充云函数超时/密钥环境变量等合规配置清单（见 §13）

---

## 一、架构总览

### 1.1 整体架构

```
┌─────────────────────────────────────────────┐
│              微信小程序前端                   │
│  ┌──────┬──────┬──────┬──────┬──────┐       │
│  │ 首页 │ 录入 │ 复习 │字卡库│ 设置 │       │
│  └──┬───┴──┬───┴──┬───┴──┬───┴──┬───┘       │
│     │      │      │      │      │           │
│  ┌──┴──────┴──────┴──────┴──────┴──┐        │
│  │        本地存储层 (Storage)      │        │
│  │  cards · settings · reviewLog    │        │
│  └──────────┬───────────────────────┘        │
│             │                                │
│  ┌──────────┴───────────────────┐            │
│  │     能力层                    │            │
│  │  ┌─────────┐ ┌─────────────┐  │            │
│  │  │语音识别  │ │组词词典主包  │  │            │
│  │  │(Path B) │ │(cnchar-words)│  │            │
│  │  │录音+ASR │ │3000字已落库  │  │            │
│  │  └─────────┘ └─────────────┘  │            │
│  └──────────┬───────────────────┘            │
└─────────────┼───────────────────────────────┘
              │ wx.cloud.callFunction
┌─────────────┼───────────────────────────────┐
│        微信云开发 (后端)                      │
│  ┌──────────┴───────────────────┐            │
│  │  云函数                       │            │
│  │  · sendReminder (定时触发)    │            │
│  │  · asrProxy (语音识别代理)    │            │
│  │  · syncSettings (设置同步)    │            │
│  └──────────┬───────────────────┘            │
│  ┌──────────┴───────────────────┐            │
│  │  云数据库                     │            │
│  │  · users (openid+设置+提醒额度)│           │
│  │  · tasks (AI拆解历史,随立项)  │ ← v2.1    │
│  │  · subscriptionQuota已确认    │           │
│  └──────────────────────────────┘            │
└──────────────────────────────────────────────┘
```

> 安全红线（v2.1 起强制执行）：前端 **禁止** 直接 `wx.request` 请求 DeepSeek 等外部大模型 API（密钥随包泄露 + 外部域名需备案白名单），一切大模型调用经云函数中转，密钥只存在于云函数环境变量。

### 1.2 技术栈选型

| 层 | 选型 | 理由 |
|---|------|------|
| 前端框架 | 微信小程序原生 (WXML/WXSS/JS) | PRD 指定，无跨端需求 |
| 后端 | 微信云开发 (Cloud Base) | 免运维，与小程序天然集成，免费额度够 MVP |
| 数据库 | 云开发 Cloud DB (文档型) | 用户设置 + 额度管理，极轻量 |
| 定时任务 | 云函数定时触发器 | 原生支持 cron 表达式 |
| 语音识别 | Path B：录音 + 云端 ASR（腾讯云） | **主体类型=个人，不能用插件** |
| 组词词典 | cnchar-words 裁剪数据（主包 `utils/`） | MIT 协议，离线数据；3000 字已落库，185,986 字节 |
| 本地存储 | wx.setStorageSync | 单用户 MVP，10MB 够用 |

### 1.3 为什么选云开发

- 订阅消息发送 (`subscribeMessage.send`) 必须在服务端调用
- 云开发免运维、免域名备案、与小程序同环境
- 免费额度：云函数 4 万次/月、云数据库 5GB 存储，MVP 单用户足够
- 后期用户量上来可平滑迁移到独立后端

### 1.4 已确认的关键决策

| 决策项 | 结论 | 确认人 | 日期 |
|--------|------|--------|------|
| 小程序主体类型 | **个人** | Xiao DouGan | 2026-07-25 |
| 语音识别路径 | Path B（录音+云端ASR） | PM + Tech Lead | 2026-07-25 |
| 提醒功能 | 能做，一次性订阅消息攒量 | Tech Lead | 2026-07-25 |
| 首页"打开即提醒" | 作为被动兜底，双重保障 | PM + Xiao DouGan | 2026-07-25 |
| 广告 | **移出 MVP** | Xiao DouGan | 2026-07-25 |
| 字卡额度机制 | ✅ MVP 不做字卡总数限制，保留提醒额度 | PM 分析 + Xiao DouGan | 2026-07-25 |
| 组词词典数据 | 已完成（3000字，185KB） | Tech Lead | 2026-07-25 |

---

## 二、数据结构设计

### 2.1 前端本地存储 (wx.setStorageSync)

**Key: `cards` — 字卡数组**
```json
[
  {
    "id": "c_1700000000001",
    "content": "大",
    "type": "char",
    "language": "zh",
    "proficiency": "unfamiliar",
    "source": "new",
    "createdAt": 1700000000001,
    "lastReviewAt": null,
    "reviewCount": 0,
    "customWords": []
  }
]
```

| 字段 | 类型 | 说明 |
|------|------|------|
| id | string | 唯一 ID，时间戳 + 随机数 |
| content | string | 字/词内容，如 "大" 或 "大小" |
| type | string | "char" 单字 / "word" 词语 |
| language | string | "zh" (MVP) / "en" (P2) |
| proficiency | string | "unfamiliar" 不熟 / "normal" 一般 / "proficient" 熟练 |
| source | string | "new" 新学 / "reviewed" 历史卡补录 |
| createdAt | number | 录入时间戳 |
| lastReviewAt | number/null | 上次复习时间戳，初始 null |
| reviewCount | number | 累计复习次数 |
| customWords | string[] | 方案 B：家长自填组词，默认空 |

**Key: `settings` — 用户设置**
```json
{
  "studyDays": [2, 4, 6],
  "reminderTime": "20:00",
  "reminderEnabled": true,
  "childName": ""
}
```

| 字段 | 类型 | 说明 |
|------|------|------|
| studyDays | number[] | 认字日，0=周日 ~ 6=周六 |
| reminderTime | string | 提醒时间 "HH:mm" |
| reminderEnabled | boolean | 提醒开关 |
| childName | string | 孩子名（可选，MVP 单孩子） |

**Key: `reviewLog` — 复习日志（P1 统计用，MVP 可选）**
```json
[
  {
    "date": "2026-07-25",
    "reviewedCount": 5,
    "cards": ["c_1700000000001", "c_1700000000002"]
  }
]
```

### 2.2 云数据库集合

**集合: `users` — 用户设置 + 额度管理（后端用）**

> PM 已确认：MVP 不做字卡总数限制，subscriptionQuota（提醒额度）保留不变。

```json
{
  "_id": "auto",
  "openid": "oxxxx",
  "studyDays": [2, 4, 6],
  "reminderTime": "20:00",
  "reminderEnabled": true,
  "subscriptionQuota": 3,
  "lastReminderSentDate": "2026-07-25",
  "updatedAt": "2026-07-25T12:00:00Z"
}
```

| 字段 | 类型 | 说明 | 状态 |
|------|------|------|------|
| openid | string | 微信用户唯一标识 | ✅ 确定 |
| studyDays | number[] | 同步自前端 | ✅ 确定 |
| reminderTime | string | 同步自前端 | ✅ 确定 |
| reminderEnabled | boolean | 同步自前端 | ✅ 确定 |
| subscriptionQuota | number | 剩余可发送提醒次数 | ✅ 确认保留 |
| lastReminderSentDate | string | 上次发提醒日期，防重复 | ✅ 确定 |

**集合: `tasks` — AI 任务拆解历史（v2.1 新增）**

```json
{
  "_id": "auto",
  "openid": "oxxxx",
  "task": "今天想带果果认识大小多少",
  "result": {
    "encouragement": "每天10分钟，孩子的进步看得见",
    "steps": ["步骤1", "步骤2", "步骤3"],
    "tips": ["提示1", "提示2"]
  },
  "createdAt": "serverDate"
}
```

| 字段 | 类型 | 说明 |
|------|------|------|
| openid | string | 取自云函数 wxContext.OPENID（微信注入不可伪造），不信任前端传参 |
| task | string | 家长描述的任务原文，前端限制 ≤200 字 |
| result.encouragement | string | AI 给的鼓励语（DeepSeek 严格 JSON 输出） |
| result.steps | string[] | 拆解步骤 3-5 条 |
| result.tips | string[] | 教学提示 2-3 条 |
| createdAt | serverDate | 服务端时间，倒序索引字段 |

- 权限：集合权限设 **"仅创建者可读写"**（纵深防御）；实际读写全部走云函数（管理员权限），前端不直连数据库
- 索引：`openid + createdAt` 联合索引（历史记录按时间倒序查询）
- 数据量大时（单用户预计 <1k 条/年）无需分片

---

## 三、复习调度逻辑（前端纯计算）

### 3.1 今日待复习判定

```javascript
function getTodayReviewCards(cards, today = new Date()) {
  return cards
    .filter(card => {
      if (!card.lastReviewAt) return card.proficiency === 'unfamiliar';
      const daysSince = Math.floor((today.getTime() - card.lastReviewAt) / 86400000);
      switch (card.proficiency) {
        case 'unfamiliar': return true;           // 每个认字日都进
        case 'normal':     return daysSince >= 2;  // ≥2天
        case 'proficient': return daysSince >= 7;  // ≥7天
        default: return false;
      }
    })
    .sort((a, b) => {
      const order = { unfamiliar: 0, normal: 1, proficient: 2 };
      if (order[a.proficiency] !== order[b.proficiency]) {
        return order[a.proficiency] - order[b.proficiency];
      }
      return (a.lastReviewAt || 0) - (b.lastReviewAt || 0);
    });
}
```

### 3.2 判定今天是否认字日

```javascript
function isStudyDay(settings, today = new Date()) {
  const dayOfWeek = today.getDay(); // 0=日 ~ 6=六
  return settings.studyDays.includes(dayOfWeek);
}
```

### 3.3 统计分布

```javascript
function getReviewStats(todayCards) {
  return {
    total: todayCards.length,
    unfamiliar: todayCards.filter(c => c.proficiency === 'unfamiliar').length,
    normal: todayCards.filter(c => c.proficiency === 'normal').length,
    proficient: todayCards.filter(c => c.proficiency === 'proficient').length,
  };
}
```

---

## 四、语音识别 — Path B（录音 + 云端 ASR）

### 4.1 确认结论

小程序主体类型 = **个人**，不能使用微信同声传译插件（仅企业/个体户可用）。
确认走 Path B：前端录音 + 云函数调云端 ASR API。

### 4.2 抽象层设计

前端封装统一接口 `voice.js`，调用方无感知。当前 `STRATEGY = 'cloud'`。
如后续主体升级为企业，改一行 `STRATEGY = 'plugin'` 即可切回插件方案，无需改业务代码。

```javascript
// utils/voice.js
const STRATEGY = 'cloud'; // 'cloud' (Path B) | 'plugin' (Path A)

function recognizeVoice(opts = {}) {
  if (STRATEGY === 'plugin') {
    return recognizeByPlugin(opts);  // 企业主体时启用
  }
  return recognizeByCloud(opts);     // 当前使用
}
```

### 4.3 Path B 实现

**前端**：`wx.getRecorderManager()` 录 mp3 → 上传云存储 → 调 `asrProxy` 云函数 → 返回文本

```javascript
function recognizeByCloud(opts) {
  const recorderManager = wx.getRecorderManager();

  recorderManager.onStop = (res) => {
    const { tempFilePath } = res;
    wx.cloud.uploadFile({
      cloudPath: `voice/${Date.now()}.mp3`,
      filePath: tempFilePath,
      success: (uploadRes) => {
        wx.cloud.callFunction({
          name: 'asrProxy',
          data: { fileID: uploadRes.fileID },
          success: (cfRes) => {
            if (cfRes.result && cfRes.result.text) {
              if (opts.onResult) opts.onResult(cfRes.result.text);
            } else {
              if (opts.onError) opts.onError(new Error('识别结果为空'));
            }
          },
          fail: (err) => { if (opts.onError) opts.onError(err); },
        });
      },
      fail: (err) => { if (opts.onError) opts.onError(err); },
    });
  };

  if (opts.onStart) opts.onStart();
  recorderManager.start({
    duration: 5000,
    format: 'mp3',
    sampleRate: 16000,
    numberOfChannels: 1,
  });
}
```

**云函数 asrProxy**：接收音频 fileID → 下载 → 调腾讯云 ASR → 返回文本

```javascript
// cloudfunctions/asrProxy/index.js
const cloud = require('wx-server-sdk');
cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV });

exports.main = async (event) => {
  const { fileID } = event;
  if (!fileID) return { text: '', error: 'missing fileID' };

  try {
    const fileRes = await cloud.downloadFile({ fileID });
    const buffer = fileRes.fileContent;

    // 腾讯云 ASR 一句话识别
    // npm install tencentcloud-sdk-nodejs-asr
    // const AsrClient = require('tencentcloud-sdk-nodejs-asr').AsrClient;
    // const client = new AsrClient({
    //   credential: { secretId: process.env.TENCENT_SECRET_ID, secretKey: process.env.TENCENT_SECRET_KEY },
    //   region: 'ap-shanghai'
    // });
    // const result = await client.SentenceRecognition({
    //   EngSerViceType: 'zh', SourceType: 1, VoiceFormat: 'mp3',
    //   Data: buffer.toString('base64'), DataLen: buffer.length, SubServiceType: 2,
    // });
    // return { text: result.ResultText };

    return { text: '', note: 'ASR SDK 待配置腾讯云密钥' };
  } catch (err) {
    return { text: '', error: err.message };
  }
};
```

### 4.4 ASR 选型

| 服务商 | 免费额度 | 识别精度 | 接入难度 | 推荐 |
|--------|---------|---------|---------|------|
| 腾讯云 ASR | 一句话识别 5000次/月免费（官方计费文档，v2.1 已核实） | 高 | 低（与微信生态近） | ✅ 推荐 |
| 百度智能云 ASR | 15万次/天 | 高 | 中 | 备选 |
| 讯飞 ASR | 500次/日 | 很高 | 中 | 备选 |

MVP 单用户免费额度内足够。

### 4.5 Path A 参考（未来主体升级时启用）

微信同声传译插件（WechatSI，AppID: `wx069ba97219f66d99`），免费，无需后端，实时流式识别。
个人主体不可用，企业/个体户主体可用。代码已写在 `voice.js` 的 `recognizeByPlugin` 函数中，切换 `STRATEGY` 即可启用。

---

## 五、订阅消息提醒机制（攒量 + 引导 + 被动兜底）

### 5.1 双重提醒保障

| 类型 | 方式 | 特点 |
|------|------|------|
| 主动推送 | 订阅消息到点提醒 | 不打开也能收到，但额度可能断 |
| 被动展示 | 打开小程序首页即见"今天该认字啦 + 今日重点 N 个字" | 永远不断，只要打开就看到 |

逻辑：订阅消息攒到额度就主动推（不打开也提醒）；额度断了，首页仍然醒目提示。两条腿走路。

### 5.2 主动推送 — 攒量机制

```
用户打开小程序 / 完成复习打卡
        ↓
  弹出订阅授权 (wx.requestSubscribeMessage)
        ↓
  用户同意 → 云数据库 subscriptionQuota += N
  用户拒绝 → 额度不变，下次自然时机再弹
        ↓
  ===== 定时触发器 (每小时扫描) =====
        ↓
  今天是用户的认字日 + quota > 0？
    → 是：发送提醒，quota -= 1
    → 否：跳过
```

### 5.3 引导机制（P0）

**三个触点**：

1. **复习打卡后弹订阅**（最自然时机）
   - 用户刚完成复习，体验正向，最愿意授权
   - 提示文案："开启提醒，下次认字日准时提醒你"

2. **首页显示剩余提醒次数**
   - 首页状态栏显示 "剩余提醒 N 次"
   - 点击可主动补充订阅

3. **额度 ≤2 时醒目提示**
   - 首页顶部 banner："提醒额度不足，打开即续订"

> PM 已确认：保留提醒额度引导，不做字卡总数限制。触点 2 和 3 原样保留。

### 5.4 被动兜底 — 首页"打开即提醒"

认字日 + 有待复习字卡时，首页顶部显示醒目渐变橙色 banner：
- 标题："今天该认字啦！"
- 副标题："今日待复习 N 个字，其中 M 个不熟需重点关注"
- 按钮："去复习"

这个被动展示不依赖任何额度机制，**永远有效**，是核心兜底保障。

### 5.5 订阅模板申请（前置长周期项）

- ✅ 已于 2026-07-25 在微信公众平台 → 订阅消息 → 公共模板库完成配置
- 小程序：`幼儿认字记录`（AppID `wxdf9f0b64f5365a7f`）
- 公共模板：`复习通知`，TID `29864`，服务类目“信息查询”
- 私有模板 ID：`38gNuA8j_S9YEP-incMBQnGnjVE6WxP1Lm8NRRPngkM`
- 场景说明：`幼儿认字复习提醒`
- 实际字段映射：复习数量 → `number1`；复习内容 → `thing2`；开始学习时间 → `time5`
- 前端 `subscribe.js` 的 `wx.requestSubscribeMessage({ tmplIds })` 与云函数 `sendReminder` 必须使用私有模板 ID；公共 TID `29864` 仅用于标识模板库条目，不能用于发送

### 5.6 云函数 sendReminder（定时触发）

```javascript
// cloudfunctions/sendReminder/index.js
const cloud = require('wx-server-sdk');
cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV });
const db = cloud.database();
const _ = db.command;

const TMPL_ID = '38gNuA8j_S9YEP-incMBQnGnjVE6WxP1Lm8NRRPngkM';

exports.main = async () => {
  const now = new Date();
  const dayOfWeek = now.getDay();
  const todayStr = now.toISOString().slice(0, 10);

  const users = await db.collection('users')
    .where({
      reminderEnabled: true,
      subscriptionQuota: _.gt(0),
      studyDays: dayOfWeek,
    })
    .get();

  const results = [];
  for (const user of users.data) {
    if (user.lastReminderSentDate === todayStr) continue;

    try {
      await cloud.openapi.subscribeMessage.send({
        touser: user.openid,
        templateId: TMPL_ID,
        page: 'pages/index/index',
        data: {
          number1: { value: 5 }, // TODO: 接入今日实际待复习数量
          thing2: { value: '今天该认字啦' },
          time5: { value: `${todayStr} ${user.reminderTime}` },
        },
      });

      await db.collection('users').doc(user._id).update({
        data: {
          subscriptionQuota: _.inc(-1),
          lastReminderSentDate: todayStr,
        },
      });
      results.push({ openid: user.openid, status: 'sent' });
    } catch (err) {
      results.push({ openid: user.openid, status: 'failed', error: err.errCode });
    }
  }
  return { date: todayStr, sent: results.filter(r => r.status === 'sent').length, details: results };
};
```

定时触发器配置（每小时检查一次，支持个性化提醒时间）：
```json
{
  "triggers": [
    {
      "name": "reminderCheck",
      "type": "timer",
      "config": "0 0 * * * * *"
    }
  ]
}
```

---

## 六、组词词典集成（已完成）

### 6.1 数据来源

- 来源：cnchar-words（theajack/cnchar, MIT 协议）
- 原始数据：19,914 个词语，覆盖 3,134 个汉字
- 裁剪后：3,000 字 × 每字最多 10 词 = 185KB（gzip 后 75KB）

### 6.2 数据文件

| 文件 | 大小 | 用途 |
|------|------|------|
| `miniprogram/utils/dict-data.json` | 185,986 字节 | MVP 用，3000 字裁剪版；已完成 JSON、空词条、重复词条校验 |

文件 SHA-256：`cba7a9d34b3097da04cc38b5e27d3ee70caeb93fd06cfdb52fb6284b21b0dc75`。

### 6.3 主包配置（MVP 最终方案）

取消 `packageDict` 分包，不在 `app.json` 中声明词典子包。数据文件直接随主包发布，由 `utils/dict.js` 同步 `require('./dict-data.json')`；185KB 体积在主包预算内。

### 6.4 查询逻辑

```javascript
// miniprogram/utils/dict.js — 主包内同步加载，无分包异步状态
const dictData = require('./dict-data.json');

function getAllWords(char, cardObj) {
  const dictWords = dictData[char] || [];
  const customWords = (cardObj && cardObj.customWords) || [];
  return [...new Set([...dictWords, ...customWords])];
}
```

### 6.5 方案 B：家长自填组词

字卡 `customWords` 字段存自填组词，查询时与词典组词去重合并。
支持 `addCustomWord(cardId, word)` 添加。

### 6.6 ⚠️ v2.1 核查修正：分包词典被主包 require 的问题

v2.0 方案中 `utils/dict.js`（主包）`require('../packageDict/dict-data.json')`（分包）存在一个坑：

- **构建期行为**：主包模块 require 分包内的 JSON 时，开发者工具构建会把这个文件**计入主包体积**（主包引用分包资源不被允许，构建器会就近拷贝进主包），分包配置形同虚设。
- **结论与落地状态**：已取消分包，`dict-data.json` 已放到 `miniprogram/utils/` 下，后续由 `dict.js` 同步 require。主包预算 2MB，185KB（gzip 后 ~75KB）可接受，加载逻辑简单且无异步坑。
- 保留分包的替代方案（仅当词典未来膨胀到 500KB+ 再考虑）：改走**分包异步化**（基础库 ≥2.11.0，分包暴露 exports 后主包 `require.async`），复杂度明显上升，MVP 不值得。

---

## 七、AI 任务拆解 — DeepSeek 集成（v2.1 新增）

> 需求来源：Xiao DouGan 2026-07-25。家长输入一句认字任务/困惑，AI 拆解为 鼓励语 + 执行步骤 + 教学提示；点头像可看历史。PRD 待补对应章节，本节为技术终稿。

### 7A.1 安全架构（红线）

| 约束 | 落地 |
|------|------|
| 前端禁止直连大模型 API | 前端只 `wx.cloud.callFunction`，代码库中不得出现 DeepSeek 域名/Key |
| 密钥不出服务端 | 未来立项时将 `DEEPSEEK_API_KEY` 配置在 **云开发控制台 → 云函数 → askDeepSeek → 环境变量**，代码仅允许读取 `process.env.DEEPSEEK_API_KEY`，严禁硬编码 |
| 身份可信 | openid 一律取 `cloud.getWXContext().OPENID`（微信注入），不信任前端传参 |
| 防刷 | 入参 ≤200 字 + 云函数内校验；后续可加单用户日调用上限 |

### 7A.2 云函数 askDeepSeek（方案留档，代码已从 MVP 仓库清理）

流程：校验入参 → 原生 https 调 `https://api.deepseek.com/chat/completions`（`model=deepseek-chat`，`response_format={type:'json_object'}` 强制 JSON，system prompt 约束字段）→ 解析并校验 `encouragement/steps/tips` → 写 `tasks` 集合 → 返回。

关键配置：
- **超时**：`config.json` 设 `timeout: 60`（云函数默认 3s，DeepSeek 响应 5-30s，**不改必超时**）；HTTP 层再设 45s 请求超时兜底
- **零外部依赖**：用 Node 原生 `https`，无需"云端安装依赖"，上传即跑
- **解析兜底**：兼容 markdown 代码块包裹的 JSON；字段缺失返回 502 让前端提示重试
- **写库失败降级**：拆解成功但落库失败时结果照常返回前端，仅提示历史未保存

### 7A.3 ~~云函数 getHistory~~（已于 v2.1 当日删除）

删除原因：AI 拆解功能不在 PRD v1.2 MVP 范围，且设计稿中不存在"头像点击查历史"入口（需求提示词为通用模板未适配）。若 AI 功能后续正式立项，历史查询随 PRD 重新设计，不必保留旧实现。

### 7A.4 成本估算

DeepSeek 输入 ~300 tokens + 输出 ~400 tokens/次，单价约 ¥2/百万输出 tokens，**单次 < ¥0.001**。MVP 单用户日 10 次，月成本 < ¥1，可忽略。

### 7A.5 接口定义

**askDeepSeek**（待立项；以下仅为历史方案，不在当前仓库部署）
```
入参: { "task": "今天想带果果认识大小多少" }   // ≤200字
出参: { "code": 0, "data": { "_id", "task", "result": { "encouragement", "steps", "tips" } } }
异常: code 400 参数错 / 502 AI 调用失败 / 500 落库失败(data 仍带结果)
```

**~~getHistory~~**（已删除，接口作废，立项后重新设计）

---

## 七、后端服务设计

### 7.1 云函数清单

| 云函数 | 触发方式 | 用途 | 必须? | 状态 |
|--------|---------|------|-------|------|
| syncSettings | 前端调用 | 同步设置 + 提醒额度管理 | 必须 | ✅ 已确认 |
| sendReminder | 定时触发器 | 扫描认字日用户发提醒 | 必须 | ✅ 不受额度重构影响 |
| asrProxy | 前端调用 | 语音识别代理 | 必须 | ✅ 已就绪 |
| askDeepSeek | 前端调用 | DeepSeek 任务拆解 + 写 tasks 集合 | 待立项 | ❌ Day 6 已从 MVP 仓库清理，立项后恢复 |
| ~~getHistory~~ | — | AI 历史查询 | 否 | ❌ 已删除（16:51，产品无头像入口） |

### 7.2 云开发资源估算（MVP 单用户）

| 资源 | 用量 | 免费额度 | 是否够 |
|------|------|---------|--------|
| 云函数调用 | ~30次/月 | 4万次/月 | 够 |
| 云数据库读写 | ~100次/月 | 5万次/月 | 够 |
| 云存储 | 语音文件临时存储 | 5GB | 够 |

### 7.3 个性化提醒时间

cron 触发器每小时跑一次，云函数内检查每个用户的 `reminderTime`，只在对应时段发送。

---

## 八、接口定义

### 8.1 前端 → 云函数

**syncSettings**
```
入参:
{
  "studyDays": [2, 4, 6],      // optional
  "reminderTime": "20:00",     // optional
  "reminderEnabled": true,     // optional
  "addQuota": 1                // optional ✅ 额度已确认
}
出参:
{
  "subscriptionQuota": 5       // ✅ 额度已确认
}
```

**asrProxy**
```
入参: { "fileID": "cloud://xxx/xxx.mp3" }
出参: { "text": "大" }
```

### 8.2 前端内部接口

| 接口 | 模块 | 说明 |
|------|------|------|
| recognizeVoice(opts) → Promise<string> | voice.js | 语音识别（Path B） |
| getTodayReviewCards(cards) → Card[] | review.js | 今日待复习清单 |
| isStudyDay(settings) → boolean | review.js | 是否认字日 |
| getReviewStats(cards) → object | review.js | 统计分布 |
| addCard(content, type, source) → Card | card.js | 新增字卡 |
| updateProficiency(cardId, level) → void | card.js | 更新熟练度 |
| editCard(cardId, updates) → void | card.js | 编辑字卡 |
| deleteCard(cardId) → void | card.js | 删除字卡 |
| addCustomWord(cardId, word) → void | card.js/dict.js | 自填组词 |
| getWords(char) → Promise<string[]> | dict.js | 查词典组词 |
| getAllWords(char, card) → Promise<string[]> | dict.js | 查全部组词（词典+自填） |
| requestSubscription() → Promise<boolean> | subscribe.js | 请求订阅授权 |
| getQuota() → Promise<number> | subscribe.js | 查剩余提醒配额 | |
| syncSettings(settings) → Promise | subscribe.js | 同步设置到云端 |

> 额度字段已确认：subscriptionQuota 为提醒额度，保留不变。MVP 不做字卡总数限制。

---

## 九、页面技术拆解

### 9.1 首页 (pages/index)

- **被动兜底 banner**：认字日 + 有待复习 → 顶部渐变橙色 banner "今天该认字啦 + 今日重点 N 个字"
- **今日状态卡**：认字日/非认字日 + 待复习数/不熟/一般/熟练分布 + 字卡库总数
- **配额预警**：提醒额度≤2时显示黄色预警 banner
- **快捷入口**：开始复习 / 快速录入
- onShow 加载（tabBar 页面每次切回都刷新）

### 9.2 录入页 (pages/add)

- **120px 大圆按钮**：渐变主色 + 阴影，底部单手可达，按住说话
- **语音流程**：touchstart 开始录音 → onRecognize 实时回显 → onStop 返回文本 → 确认弹窗 → 入库
- **新学/已学过开关**：默认新学，决定默认 proficiency（新学=不熟，已学过=一般）
- **自动判断类型**：text.length === 1 → char，否则 word
- **去重检查**：同 content 已存在 → 弹窗提示
- **手动输入兜底**：小入口切换到手动模式

### 9.3 复习页 (pages/review)

- **进度条**：当前第 N / 总 M 个，已复习 X 个
- **字卡展示**：400×400rpx 白卡，120rpx 大字
- **组词弹层**：点字或"查看组词" → bottom sheet 弹出（不跳页），展示组词列表 + 自填入口
- **熟练度按钮**：3 个 200×200rpx 圆角按钮（不熟红/一般黄/熟练绿），一键标记
- **自动流转**：标完一张自动到下一张
- **完成庆祝**：全部标完 → 🎉 庆祝页 → 自动弹订阅授权
- **组词组件复用**：word-sheet 组件，复习页 + 字卡库共用

### 9.4 字卡库 (pages/library)

- **筛选 tab**：全部 / 待复习 / 已掌握
- **排序**：熟练度 → 上次复习时间
- **列表项**：字/词 + 类型 + 熟练度标签 + 复习次数 + 删除按钮
- **点字看组词**：复用 word-sheet bottom sheet
- **删除**：二次确认弹窗
- **编辑**：修改熟练度

### 9.5 设置页 (pages/settings)

- **认字日选择**：周一~周日，多选，选中变橙色
- **提醒时间**：picker 选择 HH:mm
- **提醒开关**：switch
- **额度状态**：显示剩余提醒次数 + 补充按钮
- **孩子信息**：可选输入
- **保存**：本地 + 云端同步

---

## 十、项目骨架（已建成）

### 10.1 项目结构（43 文件）

```
zikaguanjia/
├── app.js / app.json / app.wxss       # 全局入口 + 配置 + 样式
├── sitemap.json / project.config.json
├── pages/                              # 5 个页面
│   ├── index/                          # 首页（含"打开即提醒"被动兜底）
│   ├── add/                            # 录入页（120px 大圆按钮 + 语音/手动）
│   ├── review/                         # 复习页（标熟练度 + 组词弹层 + 完成弹订阅）
│   ├── library/                        # 字卡库（筛选 + 编辑/删除 + 组词弹层）
│   └── settings/                       # 设置页（认字日 + 提醒 + 云端同步）
├── utils/                              # 6 个核心模块
│   ├── storage.js                      # 本地存储封装
│   ├── card.js                         # 字卡 CRUD + 去重 + 自填组词
│   ├── review.js                       # 复习调度（纯前端计算）
│   ├── voice.js                        # 语音识别抽象层（STRATEGY='cloud'）
│   ├── dict.js                         # 组词词典查询（主包同步加载）
│   ├── dict-data.json                  # 组词词典（3000字，185,986字节）
│   └── subscribe.js                    # 订阅授权 + 提醒额度管理
├── components/word-sheet/              # 组词弹层组件（复习页+字卡库共用）
└── cloudfunctions/                     # 3 个云函数
    ├── syncSettings/                   # 同步设置 + 提醒额度管理
    ├── sendReminder/                   # 定时触发发订阅消息
    └── asrProxy/                       # 语音识别代理（腾讯云ASR）
```

> 额度机制已确认：subscriptionQuota 为提醒额度，保留不变；MVP 不做字卡总数限制。骨架代码原样可用。

### 10.2 已实现的关键决策

- ✅ 语音识别：voice.js STRATEGY='cloud'，走 Path B 录音+云端ASR
- ✅ 首页被动兜底：认字日 + 有待复习 → 顶部渐变橙色 banner
- ✅ 配额引导：复习完成后自动弹订阅授权
- ✅ 组词弹层：bottom sheet 组件，复习页+字卡库共用，支持方案B自填
- ✅ 复习调度：纯前端计算，不熟每认字日进/一般≥2天/熟练≥7天
- ✅ 数据结构：cards/settings/reviewLog 本地存储
- ✅ 组词词典：3000 字数据已落到主包 `miniprogram/utils/dict-data.json`，同步加载
- ✅ 额度相关：syncSettings的subscriptionQuota字段 / subscribe.js配额管理 / 首页配额banner — PM已确认保留不变

### 10.3 MVP 开工前还需做的

1. ~~替换云开发环境 ID~~（app.js 已配置 `cloud-space-d8gr80gd334789538`）
2. ~~替换订阅消息模板 ID~~（已确认私有模板 ID，并同步 `number1 / thing2 / time5` 字段映射；实现 `subscribe.js` 时使用同一 ID）
3. **配置腾讯云 ASR 密钥**（asrProxy 云函数环境变量 `TENCENT_SECRET_ID` / `TENCENT_SECRET_KEY`，不要硬编码）
4. 额度机制已确认：subscriptionQuota 保留不变，4 处冻结已解除

> DeepSeek 密钥、`tasks` 集合及 askDeepSeek 部署不属于 MVP 开工项；Day 6 已清理对应示例代码，仅在重新立项并补齐 PRD/设计后从 Git 历史恢复或重新实现。getHistory 已删除，不再部署。

### 10.4 ⚠️ v2.1 核查：仓库现状与骨架的差距

以下是 v2.1 / Day 0 当时的仓库快照；当前 Day 6 已完成业务骨架并清理 QuickStart 与未立项 AI 示例：

```
cloudfunctions/            # Day 6 已移除 quickstartFunctions 与 askDeepSeek
miniprogram/
└── utils/
    └── dict-data.json     # Day 0 落库，3000 字裁剪词典
```

后续若重新立项 AI 任务拆解，再按新 PRD 新增 `aiTask.js` 与 askDeepSeek；当前 MVP 不保留占位代码。

---

## 十三、环境变量与密钥合规清单（v2.1 新增）

| 密钥 | 存放位置 | 读取方式 | 用途 |
|------|---------|---------|------|
| DEEPSEEK_API_KEY | 未来 askDeepSeek 云函数环境变量 | `process.env.DEEPSEEK_API_KEY` | DeepSeek 任务拆解（未立项） |
| TENCENT_SECRET_ID / SECRET_KEY | 云函数 asrProxy 环境变量 | `process.env.TENCENT_*` | 云端 ASR |
| 订阅消息模板 ID | 前端 subscribe.js + sendReminder 常量 | 配置项（非密钥） | 订阅消息 |

红线：任何 API Key 不得出现在前端代码、Git 仓库、文档截图中；前端不得 `wx.request` 外部大模型域名（也无须配置 request 合法域名，因为根本不直连）。

---

## 十一、风险与对策

| 风险 | 等级 | 对策 |
|------|------|------|
| 订阅消息额度耗尽提醒断 | 高 | 双重保障：主动推送攒量 + 首页被动兜底（永远不断） |
| 用户清缓存数据丢失 | 低 | MVP 本地存储；P1 加导出/导入；P2 云同步 |
| 组词数据体积过大 | 低 | 已裁剪 3000 字、185,986 字节并直接放主包；gzip 后约 75KB，仍在主包预算内 |
| 订阅消息模板审核不通过 | 低 | 用公共模板库已有模板 |
| 云开发免费额度超限 | 极低 | MVP 单用户用量极小 |
| 腾讯云 ASR 免费额度超限 | 极低 | 一句话识别 5000次/月免费，MVP 月用量约 300 次，远够（v2.1 已核实官方计费文档） |
| 字卡额度机制重构影响范围 | 中 | 已冻结4处，等PM确认后统一改，不阻塞其余部分 |

---

## 十二、开发任务拆解

### 阶段 1：基础设施（1-2 天）
- [x] 创建小程序项目 + 目录结构（当前为 QuickStart 模板，业务骨架待合入，见 §10.4）
- [x] 定义数据结构 + Storage 工具层
- [x] 创建云函数骨架 (syncSettings / sendReminder / asrProxy)
- [x] 组词词典数据提取（3000字）
- [x] **Day 6：askDeepSeek 与 aiTask.js 示例已从 MVP 仓库清理；getHistory 已删除，立项后从 Git 历史恢复或重建**
- [x] 申请订阅消息模板（“复习通知”，私有模板 ID 与字段映射已确认）
- [x] 替换云开发环境 ID（app.js 已配置）
- [ ] 配置腾讯云 ASR 密钥（环境变量）
- [ ] （MVP 外、待立项）配置 DeepSeek 密钥 + 创建 tasks 集合 + 部署 askDeepSeek

### 阶段 2：核心功能（3-4 天）
- [x] 录入页：语音识别 UI + 手动输入 + 去重（骨架已就绪）
- [x] 首页：今日状态 + 待复习数 + 快捷入口 + 被动兜底 banner（骨架已就绪）
- [x] 复习页：今日清单 + 批量标熟练度 + 组词弹层（骨架已就绪）
- [x] 字卡库：列表 + 筛选 + 排序 + 编辑/删除（骨架已就绪）
- [ ] 联调语音识别（需腾讯云 ASR 密钥）
- [x] 额度机制已确认，首页配额展示原样保留

### 阶段 3：提醒与设置（1-2 天）
- [x] 设置页：认字日 + 提醒时间 + 开关 + 云端同步（骨架已就绪）
- [x] 订阅消息：授权弹窗 + 提醒额度管理（骨架已就绪，已确认保留）
- [x] 云函数 sendReminder 定时触发（骨架已就绪）
- [x] 额度机制已确认，syncSettings + subscribe.js 原样保留
- [ ] 部署云函数 + 联调订阅消息发送

### 阶段 4：联调与验收（1-2 天）
- [ ] 全流程联调：录入→复习→提醒→打卡
- [ ] 对照 PRD 验收标准逐项验证
- [ ] 体验打磨：对照 Designer 线框稿校验视觉一致性

**预估总工期：6-10 天**（骨架已建成，实际开发从联调开始）
