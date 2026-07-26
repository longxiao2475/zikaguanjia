# 字卡管家 Day 4–Day 5 设计规格

> 日期：2026-07-26  
> 范围：Day 4 复习打卡与组词、Day 5 设置与提醒体系  
> 交付方式：完成代码和自动测试；不上传云函数、不创建定时触发器、不做真实订阅消息验收

## 1. 方案选择

采用“按业务边界拆分云函数”的方案：

- `reviewService` 只负责复习完成事务。
- `subscriptionService` 只负责提醒额度查询、授权入账和流水幂等。
- `sendReminder` 只负责定时扫描、生成提醒日志、发送消息及成功后的额度消费。
- `syncSettings` 在现有初始化职责上增加孩子设置保存。

未选择把上述逻辑继续塞入 `cardService` / `syncSettings`，因为这会混合字卡、设置、额度、消息发送四类事务。也不引入消息队列，因为单用户 MVP 的提醒量不需要额外基础设施。

## 2. Day 4：复习打卡

### 2.1 页面状态

复习页包含五种状态：加载中、无待复习字卡、逐张复习、提交失败、完成庆祝。

- 页面从 `cardService.getTodayPlan` 读取权威计划，缓存只用于首屏展示。
- 当前字卡显示为 400×400rpx 白卡，大字约 120rpx。
- 顶部显示 `当前序号 / 总数` 与进度条。
- 三个熟练度按钮为“不熟 / 一般 / 熟练”，颜色分别为 `#EF5350 / #FFA726 / #66BB6A`。
- 点击熟练度后只把结果暂存在页面内存并自动切到下一张，不立即写云端。
- 最后一张标记后调用一次 `reviewService.complete`。提交期间锁定按钮，避免重复提交。
- 提交失败时保留全部已标记结果，显示重试入口；成功后才清除今日计划缓存并进入完成庆祝状态。

### 2.2 云函数接口

请求：

```json
{
  "action": "complete",
  "childId": "child_xxx",
  "items": [
    { "cardId": "card_xxx", "proficiency": "normal" }
  ]
}
```

`reviewService` 必须从 `cloud.getWXContext().OPENID` 获取 openid，并在事务前后执行以下校验：

- 孩子存在、状态为 active、属于当前 openid。
- `items` 非空，cardId 不重复，熟练度只允许 `unfamiliar / normal / proficient`。
- 每张字卡存在、状态为 active、属于指定孩子和当前 openid。

同一数据库事务内：

1. 读取全部目标字卡快照。
2. 创建一条 `review_sessions` completed 记录。
3. 为每张字卡更新 `proficiency`、`lastReviewAt`、`updatedAt`，并执行 `reviewCount + 1`。
4. session 的 `items[]` 保存 content、变更前后熟练度和 reviewedAt 快照，`summary` 保存三档计数。

返回 session 与更新后的字卡列表，前端用返回值更新字卡缓存并废弃今日计划缓存。

## 3. Day 4：组词 Bottom Sheet

新增可复用组件 `components/word-sheet`，在复习页点击大字、字卡库点击字卡内容时打开。

组件属性：

- `visible`：是否显示。
- `card`：当前字卡，至少含 `_id / content / customWords`。

组件事件：

- `close`：关闭面板。
- `savecustomword`：提交 `{ cardId, word }`，由页面调用 `cardService.update` 保存，成功后把新 card 回填组件。

`utils/dict.js` 提供纯函数：

- 仅对单汉字查询内置 `dict-data.json`；词语字卡显示空内置词组状态。
- 内置词组与 `card.customWords` 合并、标准化、去重，自定义词优先显示。
- 自填词不能为空、不得超过 12 个汉字、必须包含当前单字；重复输入视为成功但不重复展示。
- 拼音从与 3000 字词典键一致的静态 `pinyin-data.json` 同步读取。该文件在开发期由拼音库机械生成，运行时不依赖小程序 npm 构建。

为了满足验收样例，`大` 的推荐展示顺序固定包含“大小 / 大人 / 大家”，随后再补充词典中的其他词；自填“大象”后合并在自定义词区域。

## 4. Day 5：设置保存

设置页支持：

- 孩子昵称输入，可空，最多 12 个字符。
- 周一至周日圆形多选，至少选择一天；数据库继续使用 `0=周日 ... 6=周六`。
- 时间 picker，保存 `HH:mm`。
- 提醒总开关。
- 当前提醒额度展示与“补充提醒”入口。

`syncSettings.saveSettings` 请求包含 `childId / name / studyDays / reminderTime / reminderEnabled`。云函数验证孩子归属和字段格式后更新 `children`，返回最新 child；前端成功后更新 child 缓存。保存失败时保留表单，不写入权威缓存。

## 5. Day 5：订阅额度

私有模板 ID 固定为：

`38gNuA8j_S9YEP-incMBQnGnjVE6WxP1Lm8NRRPngkM`

`utils/subscribe.js` 封装：

- `requestGrant(source)`：生成 requestId，调用 `wx.requestSubscribeMessage`；只有模板结果为 `accept` 才调用 `subscriptionService.grant`。
- `getQuota()`：调用 `subscriptionService.getQuota`。
- 用户拒绝或关闭授权面板不作为异常，不增加额度。

`subscriptionService.grant` 在事务中：

1. 用 `ownerOpenid + requestId` 查询既有 `subscription_events`。
2. 已存在则返回当时结果，不重复增加额度。
3. 不存在则读取 user、执行 `subscriptionQuota + 1`、写一条 `type=grant / delta=1 / balanceAfter` 流水。

`getQuota` 只返回当前用户的 `subscriptionQuota`。所有额度写入都只能通过事务完成。

复习完成页展示内嵌授权卡片“开启提醒 / 以后再说”；设置页和首页额度预警均可再次触发同一封装。

## 6. Day 5：定时提醒

`sendReminder` 由部署后每小时触发一次，本轮只交付可部署代码和测试。

执行流程：

1. 以 Asia/Shanghai 计算业务日期、星期和当前小时。
2. 扫描 `reminderEnabled=true` 且 active 的孩子，在内存中过滤认字日与提醒小时。
3. 从云端读取该孩子全部 active cards，并用与 `cardService` 相同的规则计算真实待复习清单。
4. 以 `childId + bizDate + templateId` 创建 `reminder_logs`；唯一索引冲突表示本日已处理，直接跳过。
5. 无待复习字卡时记录 `skipped/no_due_cards`；额度为 0 时记录 `skipped/quota_empty`。
6. 有字卡且有额度时发送订阅消息：
   - `number1`：待复习数量。
   - `thing2`：按优先级截取并拼接的字卡内容，限制在模板字段长度内。
   - `time5`：计划学习时间。
7. 发送成功后，在事务中再次读取用户余额，扣减 1，写 `subscription_events(type=consume)`，并把 reminder log 标为 sent。
8. 发送失败只把 log 标为 failed，记录错误码和消息，不扣额度、不写 consume 流水。

消息发送器通过依赖注入进入 service，自动测试使用内存仓库和假发送器，不请求微信网络。

## 7. 首页双 Banner

首页保留现有认字日兜底 Banner：认字日且 `due > 0` 时显示“今天该认字啦”。

新增额度预警 Banner：`subscriptionQuota <= 2` 时显示剩余次数和“补充提醒”按钮。首页每次 `bootstrap` 后从最新 user 计算显示状态；授权成功后立即刷新缓存和 Banner。

两个 Banner 可以同时出现，学习提醒优先显示，额度预警紧随其后，不互相覆盖。

## 8. 错误与一致性策略

- 前端不直接访问数据库，ownerOpenid 不接受前端传入。
- 页面写操作均以后端成功响应为准；失败时不伪造成功缓存。
- 复习提交、授权入账、提醒消费分别使用数据库事务。
- 复习提交锁、订阅 requestId 和 reminder log 唯一键分别防止三条链路的重复操作。
- 云函数返回现有 `{ ok, data } / { ok:false, error }` 协议，未知异常只向前端暴露友好文案。
- 所有云端时间写入使用 `db.serverDate()`；业务日期和星期使用 Asia/Shanghai。

## 9. 测试范围

自动测试至少覆盖：

- 词典查询、推荐词顺序、自定义词校验、合并去重和拼音读取。
- 复习 payload 校验、归属校验、session 快照/summary、全部字卡批量更新、任一失败时不产生半成品。
- 设置字段标准化、非法日期/时间/昵称拒绝、归属校验与缓存更新 API。
- 订阅 accept/拒绝分支、requestId 幂等、余额和 grant 流水一致。
- 提醒日期/小时筛选、真实待复习数量、日志幂等、成功扣额度、失败不扣额度、模板字段映射。
- 首页 Banner 判定与前端云函数调用协议。
- 项目结构、页面 JSON 组件注册及全部既有回归测试。

本轮不声称完成的验收项：云函数上传、数据库真实事务联调、定时触发器创建、真机订阅授权及真实消息送达。

