# 字卡管家 — MVP 开发计划 v1.0

> 日期：2026-07-25 ｜ 依据：PRD v1.2 终稿 + 技术方案 v2.1 + 设计规范 v1.0
> 前置结论：云开发个人版（19.9 元/月）配额已核实够用；核心业务数据改为**云数据库权威、本地 Storage 缓存**；DeepSeek AI 拆解移出本计划（待立项）；getHistory 已删除

> **执行状态更新（2026-07-25 23:35）**：Day 0 的 0.1～0.5 已全部完成。Day 1、Day 2 的业务代码和 27 项自动测试已完成，QuickStart 前端残留已清理，微信开发者工具服务端口已开启并成功打开功能工作树。当前待完成：授权后执行官方预览上传、部署 `syncSettings` / `cardService`，再按“手动录入大 → 首页待复习 +1 → 字卡库可见及筛选正确”完成端到端验收。

---

## 一、起点盘点（写计划时的真实状态）

**已有**
- 文档三件套：PRD v1.2 / 技术方案 v2.1 / 设计规范 v1.0 + 线框稿
- 云环境：`cloud-space-d8gr80gd334789538`（个人版，有效期至 2027-01，配额已核实富余 20 倍）
- app.js 已配置 env；`cloudfunctions/askDeepSeek`（挂起不部署）；`utils/aiTask.js`（挂起）

**写计划时欠缺（当前完成状态见 Day 0 表格）**
- 业务骨架：当前仓库仍是 QuickStart 模板，5 页面 / 业务 utils / 6 个 MVP 云函数尚未落地
- 配置项：腾讯云 ASR 密钥、订阅消息模板 ID、云数据库 6 个核心集合

**明确不做（MVP 边界）**
- DeepSeek 任务拆解、广告、字卡总数限制、拍照 OCR、英文、多孩子（见 PRD 十一节）

---

## 二、Day 0 — 前置清障（0.5 天，必须最先做）

| # | 任务 | 谁做 | 产出 |
|---|------|------|------|
| 0.1 | ~~微信开发者工具导入项目，确认云环境绑定 `cloud-space-d8gr80gd334789538`~~ | 开发 | ✅ 已完成 07-25：控制台确认环境在线、个人版正常 |
| 0.2 | ~~腾讯云控制台开通「语音识别」服务（**不要开启后付费**，免费 5000 次/月耗尽即停服）→ 创建 SecretId/SecretKey~~ | 开发 | ✅ 已完成 07-25：ASR 已开通、大陆后付费已关闭；子用户 `zikaguanjia-asr`（仅 QcloudASRFullAccess，编程访问）已建密钥；罗老师.mp3（19s）实测识别通过 |
| 0.3 | ~~订阅消息模板申请（公共模板库，学习提醒类）~~ | PM（并行，长周期） | ✅ 已完成 07-25：选用公共模板“复习通知”（TID `29864`，服务类目“信息查询”）；私有模板 ID `38gNuA8j_S9YEP-incMBQnGnjVE6WxP1Lm8NRRPngkM`；字段为复习数量 `number1`、复习内容 `thing2`、开始学习时间 `time5`；场景“幼儿认字复习提醒” |
| 0.4 | ~~创建云数据库 6 个核心集合：`users` / `children` / `cards` / `review_sessions` / `subscription_events` / `reminder_logs`；权限统一为**仅创建者可读写**，业务读写全部走云函数~~ | 开发 | ✅ 已完成 07-25：6 个集合均已创建，权限均为 `[PRIVATE] 读取和修改本人数据`，当前均为 0 条文档；14 个业务索引已全部配置，含 3 个业务唯一索引。集合关系、字段、索引和数据流见下方“云数据库平衡型数据模型” |
| 0.5 | ~~词典数据落库：cnchar-words 裁剪版 3000 字（185KB）放进 `miniprogram/utils/dict-data.json`（**取消分包方案**，见技术方案 §6.6）~~ | 开发 | ✅ 已完成 07-25：185,986 字节、3000 字、JSON 结构校验通过、无空词条/重复词条；SHA-256 `cba7a9d34b3097da04cc38b5e27d3ee70caeb93fd06cfdb52fb6284b21b0dc75` |

> ✅ Day 0 前置项已全部解除。进入 Day 1 后仍需把 ASR 密钥配置到云函数环境变量，并在实现中使用上述私有模板 ID 与实际字段键。

---

## 三、云数据库平衡型数据模型（2026-07-25 修订）

### 3.1 数据权威与访问原则

- **云数据库是唯一权威数据源**：字卡、设置、复习历史、订阅额度和提醒结果均以云端为准。
- **本地 Storage 只做缓存**：用于页面秒开和短时离线展示，不再作为业务主数据；缓存可随时清空并从云端恢复。
- **前端不直连数据库**：所有读写通过云函数完成；`ownerOpenid` 只能取自 `cloud.getWXContext().OPENID`，不接受前端传入。
- **MVP 不支持离线写入**：网络失败时保留表单/操作结果并提示重试，避免双向同步冲突。
- **时间统一**：云端写入使用 `db.serverDate()`；业务日期 `bizDate` 按 `Asia/Shanghai` 生成 `YYYY-MM-DD`。
- **删除采用软删除**：字卡设置 `status=deleted`，保留历史复习快照和审计链路。

### 3.2 集合与关系

```text
users
├── 1:N children
├── 1:N subscription_events
└── 1:N reminder_logs

children
├── 1:N cards
├── 1:N review_sessions
└── 1:N reminder_logs

review_sessions.items[] ──引用──> cards
reminder_logs ──发送成功后关联──> subscription_events(type=consume)
```

| 集合 | 职责 | MVP 关系 |
|------|------|----------|
| `users` | 微信用户、默认孩子、当前订阅额度 | 1 个用户对应 1 个孩子；结构预留 1:N |
| `children` | 孩子资料及认字日、提醒时间、提醒开关 | 属于 `users` |
| `cards` | 字卡当前状态、调度字段、自定义组词 | 属于 `children` |
| `review_sessions` | 每次复习及字卡结果快照 | 属于 `children`，明细引用 `cards` |
| `subscription_events` | 订阅额度增加、消费、退回、人工修正流水 | 属于 `users` |
| `reminder_logs` | 提醒计划、待复习快照、发送结果和幂等记录 | 同时关联 `users`、`children` |

> `tasks` 是 DeepSeek 待立项集合，不属于当前 MVP，不在本轮创建。

### 3.3 字段定义

**`users` — 用户账户与订阅余额**

```json
{
  "openid": "oxxxx",
  "defaultChildId": "child_xxx",
  "subscriptionQuota": 3,
  "status": "active",
  "createdAt": "serverDate",
  "updatedAt": "serverDate"
}
```

- `openid` 业务唯一；`subscriptionQuota` 只允许通过 `subscriptionService` 事务更新。
- 已配置索引：唯一索引 `uniq_openid(openid)`；普通索引 `idx_status_updatedAt(status + updatedAt)`。

**`children` — 孩子与学习设置**

```json
{
  "ownerOpenid": "oxxxx",
  "name": "果果",
  "studyDays": [2, 4, 6],
  "reminderTime": "20:00",
  "reminderEnabled": true,
  "timezone": "Asia/Shanghai",
  "status": "active",
  "createdAt": "serverDate",
  "updatedAt": "serverDate"
}
```

- 已配置索引：`idx_owner_status(ownerOpenid + status)`；`idx_reminder_status_time(reminderEnabled + status + reminderTime)`。

**`cards` — 字卡当前状态**

```json
{
  "ownerOpenid": "oxxxx",
  "childId": "child_xxx",
  "content": "大",
  "normalizedContent": "大",
  "type": "char",
  "language": "zh",
  "proficiency": "unfamiliar",
  "source": "new",
  "lastReviewAt": null,
  "reviewCount": 0,
  "customWords": [],
  "status": "active",
  "createdAt": "serverDate",
  "updatedAt": "serverDate",
  "deletedAt": null
}
```

- `normalizedContent` 用于去空格、统一全半角后的去重；同一 `childId` 下活动字卡不得重复。
- 已配置索引：`idx_child_status_updatedAt(childId + status + updatedAt)`；`idx_child_content_status(childId + normalizedContent + status)`；`idx_child_status_prof_last(childId + status + proficiency + lastReviewAt)`。

**`review_sessions` — 一次复习及结果快照**

```json
{
  "ownerOpenid": "oxxxx",
  "childId": "child_xxx",
  "bizDate": "2026-07-25",
  "status": "completed",
  "startedAt": "serverDate",
  "completedAt": "serverDate",
  "summary": {
    "plannedCount": 3,
    "reviewedCount": 3,
    "unfamiliarCount": 1,
    "normalCount": 1,
    "proficientCount": 1
  },
  "items": [
    {
      "cardId": "card_xxx",
      "contentSnapshot": "大",
      "beforeProficiency": "unfamiliar",
      "afterProficiency": "normal",
      "reviewedAt": "serverDate"
    }
  ]
}
```

- 复习明细嵌入 session，减少小规模 MVP 的跨集合查询；内容快照保证字卡编辑/删除后历史仍可读。
- 已配置索引：`idx_child_completedAt(childId + completedAt)`；`idx_owner_bizDate(ownerOpenid + bizDate)`。

**`subscription_events` — 订阅额度流水**

```json
{
  "ownerOpenid": "oxxxx",
  "type": "grant",
  "delta": 1,
  "balanceAfter": 4,
  "templateId": "38gNuA8j_S9YEP-incMBQnGnjVE6WxP1Lm8NRRPngkM",
  "source": "review_complete",
  "requestId": "sub_xxx",
  "reminderLogId": null,
  "createdAt": "serverDate"
}
```

- `type`：`grant` / `consume` / `refund` / `adjust`；`requestId` 用于重复请求幂等。
- 已配置索引：`idx_owner_createdAt(ownerOpenid + createdAt)`；唯一索引 `uniq_owner_request(ownerOpenid + requestId)`。

**`reminder_logs` — 提醒任务和发送结果**

```json
{
  "ownerOpenid": "oxxxx",
  "childId": "child_xxx",
  "bizDate": "2026-07-25",
  "templateId": "38gNuA8j_S9YEP-incMBQnGnjVE6WxP1Lm8NRRPngkM",
  "plannedAt": "2026-07-25 20:00",
  "dueCardCount": 5,
  "dueCards": [{ "cardId": "card_xxx", "contentSnapshot": "大" }],
  "status": "sent",
  "skipReason": null,
  "errorCode": null,
  "errorMessage": null,
  "sentAt": "serverDate",
  "subscriptionEventId": "event_xxx",
  "createdAt": "serverDate",
  "updatedAt": "serverDate"
}
```

- `status`：`pending` / `sending` / `sent` / `skipped` / `failed`。
- `childId + bizDate + templateId` 作为业务幂等键，替代 `users.lastReminderSentDate`。
- 已配置索引：唯一索引 `uniq_child_biz_template(childId + bizDate + templateId)`；普通索引 `idx_status_plannedAt(status + plannedAt)`；`idx_owner_createdAt(ownerOpenid + createdAt)`。

### 3.4 完整业务数据流

1. **首次进入**：`syncSettings.bootstrap` 通过 openid 查找/创建 `users`，再创建默认 `children`，将 `defaultChildId` 回写用户；返回用户、孩子、设置和额度供本地缓存。
2. **录入字卡**：语音先经 `asrProxy` 识别并删除临时音频；确认后由 `cardService.create` 标准化内容、校验同孩子去重、写入 `cards`；成功结果覆盖本地缓存。
3. **首页/今日计划**：`cardService.getTodayPlan` 从云端活动字卡计算真实待复习清单，前端缓存结果；定时提醒也调用同一调度规则，保证页面数字与消息数字一致。
4. **复习打卡**：前端收集本轮所有标记，`reviewService.complete` 在一次事务中创建 `review_sessions`、批量更新 `cards.proficiency/lastReviewAt/reviewCount`；成功后刷新本地缓存。
5. **补充提醒额度**：前端 `wx.requestSubscribeMessage` 返回 accept 后调用 `subscriptionService.grant`；事务内写 `subscription_events(type=grant)` 并增加 `users.subscriptionQuota`，`requestId` 防重复增加。
6. **定时提醒**：`sendReminder` 每小时扫描启用提醒的 `children`，按云端 `cards` 算出真实 `dueCardCount`，先创建幂等 `reminder_logs`，发送成功后事务扣减用户额度、写 `subscription_events(type=consume)` 并标记日志 `sent`；失败不扣额度。
7. **编辑与删除**：`cardService.update/delete` 在云端执行；删除只改 `status/deletedAt`，历史 session 快照不受影响；客户端按 `updatedAt` 增量刷新缓存。
8. **缓存恢复**：Storage 保存 `user/child/cards/todayPlan/lastSyncAt`；缓存缺失或换机时直接从云端重建，不再发生“清缓存丢字卡”。

### 3.5 MVP 云函数边界

| 云函数 | 职责 |
|--------|------|
| `syncSettings` | 用户/默认孩子初始化，孩子设置读写 |
| `cardService` | 字卡列表、录入、去重、编辑、软删除、今日计划 |
| `reviewService` | 创建/完成复习 session，事务更新字卡 |
| `subscriptionService` | 额度查询、授权增加、流水和幂等 |
| `sendReminder` | 定时计算待复习字卡、发送消息、扣额度和记录日志 |
| `asrProxy` | 腾讯云 ASR 代理 |

---

## 四、开发阶段（6 个工作日）

### 阶段 1（Day 1）：骨架重置 —— 把模板变成字卡管家

> **当前状态（2026-07-25 23:35）**：✅ 代码与自动测试已完成。5 个页面、3 个原生 tab、全局设计 token、本地业务缓存与 `syncSettings.bootstrap` 均已落地；微信开发者工具已成功打开当前功能工作树。官方预览上传仍待用户明确授权，云函数部署与模拟器交互复核归入下方 Day 2 联调收尾。

**任务**
1. 清理 QuickStart 残留：删 `pages/example`、`components/cloudTipModal`、首页模板逻辑（`cloudfunctions/quickstartFunctions` 保留到最后，验收前删）
2. `app.json`：注册 5 页面 + tabBar（首页/字卡库/设置，3 tab）+ 导航配色按设计规范（米白 `#FAF8F5`）
3. `app.wxss`：全局设计变量（主色 `#FF8A65`、文字/背景/圆角/间距 token，对照设计规范 §五）
4. `utils/cache.js`：本地缓存封装（user/child/cards/todayPlan/lastSyncAt），缓存可被云端完整重建
5. 云函数 `syncSettings.bootstrap`：首次进入创建/加载 `users + children`，返回设置和额度
6. 5 个空页面跑通 tabBar 切换

**验收点**：模拟器里 3 个 tab 可切换、风格底色正确、无模板残留

### 阶段 2（Day 2）：字卡核心 —— 手动录入先行

> **当前状态（2026-07-25 23:35）**：🟡 代码与自动测试已完成，云端部署及端到端验收待完成。已实现 `cardService` 分层云函数、前端 API、手动录入、首页缓存优先刷新、今日计划、字卡库三筛选与分页；待授权上传并部署 `syncSettings` / `cardService` 后，验证“录入大 → 首页待复习 +1 → 字卡库可见及筛选正确”。

**任务**
1. 云函数 `cardService`：字卡 CRUD、标准化去重、软删除、今日计划查询
2. `utils/card.js`：封装 `cardService` 调用并刷新本地缓存；前端不直连数据库
3. `utils/review.js`：保留纯函数用于展示校验，但云端 `getTodayPlan` 是权威结果
4. 录入页（手动模式）：输入框 + 新学/已学过开关（新学→不熟，已学过→一般）+ 云端去重提示 + 保存
5. 首页：加载云端今日计划和统计，缓存用于秒开
6. 字卡库：云端分页列表 + 三 tab 筛选（全部/待复习/已掌握）+ 排序（熟练度→上次复习时间）

**验收点**：手动录入"大"→ 首页待复习+1（红点）→ 字卡库可见 → 标记后各筛选 tab 数量正确

### 阶段 3（Day 3）：语音录入 —— Path B 全链路

**任务**
1. 云函数 `asrProxy`：`tencentcloud-sdk-nodejs-asr`，一句话识别（SentenceRecognition，zh，mp3），密钥读 `process.env.TENCENT_SECRET_ID/KEY`；config.json timeout 20s
2. `utils/voice.js`：STRATEGY='cloud' 抽象层（技术方案 §4 代码已定型）——录音（5s/mp3/16kHz）→ 上传云存储 → 调 asrProxy → **识别完成后删除云存储临时文件**（容量卫生，防 3GB 上限）
3. 录入页语音模式：120px 渐变主色大圆按钮、按住说话松开识别、识别结果确认框、失败兜底提示（可切手动）
4. 部署 asrProxy + 配环境变量 + 联调

**验收点**：按住说"大"→ 显示"大"→ 确认入库；说词语"大小"识别为 word 类型；识别失败有友好提示；云存储无残留文件

### 阶段 4（Day 4）：复习打卡 + 组词

**任务**
1. 复习页：进度条（N/M）、400×400rpx 白卡大字、三档熟练度大按钮（不熟红/一般黄/熟练绿）、标完自动跳下一张
2. 云函数 `reviewService.complete`：事务创建 `review_sessions` 并批量更新 `cards.lastReviewAt/reviewCount/proficiency`
3. `components/word-sheet`：bottom sheet 组词弹层（字+拼音+组词标签流式排列）+ 自填组词入口（方案 B）
4. `utils/dict.js`：词典查询 + 自填合并去重（同步 require 主包词典）
5. 全部标完 → 🎉 完成庆祝（订阅授权卡片留接口，阶段 5 接上）

**验收点**：复习 3 张卡 → 数据更新正确 → 明日清单按新熟练度重新排序；点"大"弹出"大小/大人/大家"；自填"大象"后合并展示

### 阶段 5（Day 5）：提醒体系 —— 双保险

**任务**
1. 设置页：认字日圆形按钮多选、提醒时间 picker、总开关、孩子昵称（可选），保存到云端 `children` 后刷新缓存
2. `utils/subscribe.js`：复习完成后弹订阅授权卡片（"开启提醒/以后再说"）+ 额度查询
3. 云函数 `subscriptionService`：授权成功后用 `requestId` 幂等增加额度并写 `subscription_events`
4. 云函数 `sendReminder`：每小时扫描 `children`，从云端 `cards` 计算真实重点字数，写幂等 `reminder_logs`；发送成功后事务扣额度并写消费流水
5. 首页两条 banner：被动兜底（认字日+有待复习 → 渐变橙"今天该认字啦"）+ 额度预警（quota≤2）

**验收点**：设今天为认字日 → 首页出现兜底 banner；完成复习 → 弹订阅卡片 → 授权后云端 quota+1；quota≤2 时预警 banner 出现；到点收到订阅消息且含重点字数

### 阶段 6（Day 6）：收尾联调 + 验收

**任务**
1. 字卡库补全：✎ 编辑弹层（改内容/熟练度）、🗑 删除二次确认、点字弹 word-sheet
2. 三态补全：空状态（无卡引导录入）、加载态、错误 toast
3. 对照 PRD 验收标准逐条过（见下方清单）
4. 对照线框稿/设计规范校验视觉一致性（字号/圆角/配色/单手可达）
5. 真机体验：家长单手操作主路径（录入→复习→标记→设置）
6. 清理：删 `quickstartFunctions`、移除示例代码、检查无密钥硬编码

**验收点**：PRD 十条验收标准全过（见下）

---

## 五、验收标准（PRD 十二节原样）

- [ ] 语音录入一个字/词→录音→云端识别→确认→入库，默认熟练度按新学/已学过正确赋值
- [ ] 手动输入增改字卡可用
- [ ] 字卡库可筛选全部/待复习/已掌握、可编辑（弹层改内容/熟练度）、可删除（带二次确认）
- [ ] 设认字日+提醒时间→到点收到订阅消息且含今日重点数
- [ ] 首页认字日+有待复习时显示醒目提醒 banner（被动兜底）
- [ ] 今日待复习清单按优先级正确排序（不熟>一般>熟练，同档越久越靠前）
- [ ] 复习后批量标熟练度→上次复习时间/累计次数正确更新
- [ ] 点击单字→展示内置词典的常用组词（弹层不跳页）
- [ ] 提醒额度≤2 时首页显示预警 banner 引导续订
- [ ] 全程孩子不看屏幕，家长单手可完成主流程
- [ ] 清空本地 Storage 或换机后，登录同一微信可从云端恢复孩子设置、字卡和复习历史
- [ ] 订阅消息中的复习数量与云端今日待复习清单一致，不再使用硬编码数量
- [ ] 同一提醒任务重复触发不会重复发送或重复扣减额度

---

## 六、依赖与并行项（不阻塞开发主线）

| 依赖 | 影响 | 对策 |
|------|------|------|
| 订阅消息模板 ID | 已解除 | 私有模板 ID 与 `number1 / thing2 / time5` 字段映射已确认并同步到技术方案 |
| 腾讯云 ASR 密钥 | 阻塞阶段 3 联调 | Day 0 办理，最坏情况手动输入先行 |
| DeepSeek 立项决策 | 与本计划无关 | 立项后单独立项开发，不动 MVP 代码 |
| 词典 3000 字数据 | 已解除 | 已落到 `miniprogram/utils/dict-data.json` 并通过结构校验 |
| 云数据库 6 个核心集合 | 已解除 | 6 个集合、统一 `[PRIVATE]` 权限、14 个业务索引均已配置并复核 |

---

## 七、风险与对策

| 风险 | 等级 | 对策 |
|------|------|------|
| 订阅模板审核不通过 | 中 | 用公共模板库已有模板；被动兜底 banner 永远在线，不受审核影响 |
| 语音权限/隐私协议被驳回 | 中 | 发布前在《用户隐私保护协议》声明"麦克风-用于语音录入字卡"；个人主体类目选工具类 |
| ASR 免费额度耗尽 | 低 | 5000 次/月免费，月用量约 300 次；不开后付费，耗尽即停服不扣钱，手动输入兜底 |
| 云端写入失败导致前端假成功 | 中 | 所有写操作以后端成功结果为准；失败保留输入并允许重试，不先改权威缓存 |
| 重复请求导致重复字卡/额度 | 中 | 字卡用 childId+normalizedContent 业务去重；额度使用 requestId；提醒使用 childId+bizDate+templateId 幂等 |
| 本地缓存与云端不一致 | 低 | 云端权威；页面 onShow 按 updatedAt 增量刷新，异常时全量重建缓存 |
| 个人版配额超限 | 极低 | 已核实用量 <5% 配额；sendReminder 每小时触发是最大头（720 次/月） |

---

## 八、发布前检查清单（阶段 6 完成后执行）

- [ ] 删除 quickstartFunctions 与全部模板残留
- [ ] 全仓库搜索确认无密钥/模板 ID 以外的硬编码敏感信息
- [ ] 6 个核心集合、权限和索引全部配置完成
- [ ] 云函数全部部署最新版（asrProxy / syncSettings / cardService / reviewService / subscriptionService / sendReminder）+ 环境变量就位
- [ ] sendReminder 定时触发器已在控制台开启
- [ ] 小程序《用户隐私保护协议》已配置（含麦克风用途）
- [ ] 体验版真机回归 → 提交审核（类目：工具）
- [ ] ASR 后付费保持关闭

---

## 九、工期估算

| 阶段 | 内容 | 工时 |
|------|------|------|
| Day 0 | 前置清障 | 0.5 天 |
| Day 1-2 | 骨架 + 云端数据服务 + 字卡核心 | 2.5 天 |
| Day 3-4 | 语音 + 复习组词 | 2 天 |
| Day 5-6 | 提醒 + 收尾验收 | 2 天 |
| **合计** | | **约 7 天（全职）/ 10 天（含缓冲）** |

相较原计划增加约 1 天，用于云端 CRUD、事务、幂等和缓存恢复；换来真实提醒数量、换机恢复、完整复习历史以及未来多孩子扩展能力。
