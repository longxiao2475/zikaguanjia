# 字卡管家

## 产品定位

字卡管家是一款面向幼儿园阶段孩子家长的微信小程序，用于记录孩子学过的字词，并根据熟练度和遗忘周期生成每日复习清单。

它解决的核心问题不是“保存字卡”，而是替家长安排复习节奏：今天该复习哪些字、哪些字需要重点关注，以及何时提醒家长开始复习。

## 核心功能

- 语音或手动录入字卡、词卡
- 按不熟、一般、熟练三个等级管理熟练度
- 根据复习周期生成今日待复习清单
- 从字卡库把选中字卡加入持久化的今日待复习清单
- 通过一次性家庭码共享同一孩子、字卡、分类和复习进度
- 订阅消息提醒与首页被动提醒双重保障
- 内置 3000 字组词词典，支持家长补充自定义组词
- 全流程由家长单手操作，孩子专注实体字卡互动

## 当前状态

- 现有微信数据会在首次 `bootstrap` 时原地归入新家庭，原微信成为家庭创建人和 owner
- 家庭共享以 `familyId + childId` 隔离，跨家庭不会复用同一条字卡记录
- 家庭成员共享孩子与学习数据；提醒时间、提醒开关和订阅额度仍按微信成员独立管理

## 项目结构

```text
ai_wiki/          产品需求、设计规范、技术方案和开发计划
miniprogram/      微信小程序前端
cloudfunctions/   微信云开发云函数
```

关键文档：

- `ai_wiki/字卡管家-PRD-v1.2-终稿.md`
- `ai_wiki/zikaguanjia-design-spec-v1.0.md`
- `ai_wiki/tech-solution-v2.md`
- `ai_wiki/字卡管家-MVP开发计划-v1.0.md`

## 本地开发

1. 使用微信开发者工具导入仓库根目录。
2. 确认 AppID 与云开发环境配置正确。
3. 腾讯云 ASR 密钥只配置在云函数环境变量中，禁止写入代码或 Git。
4. 按 MVP 开发计划从 Day 1 开始实现业务骨架。

## 家庭功能部署

部署或更新以下云函数：

- `syncSettings`
- `cardService`
- `categoryService`
- `reviewService`
- `sendReminder`

在 `syncSettings` 云函数环境变量中配置高强度随机密钥 `FAMILY_INVITE_SECRET`。未配置时家庭码接口会直接拒绝服务，不会降级为明文或弱校验。

首次运行会按需创建 `families`、`family_members`、`family_invites`、`family_merge_jobs` 和 `review_assignments` 集合。云数据库权限应保持“仅云函数可写”，不要开放客户端直接读写。建议为以下查询建立组合索引：

- `family_members`: `familyId + openid + status`
- `family_invites`: `codeDigest`
- `cards`: `familyId + childId + status + normalizedContent`
- `review_assignments`: `familyId + childId + status + scheduledDate`
- `reminder_logs`: `familyId + childId + recipientOpenid + bizDate + templateId`

如果 `reminder_logs` 以前存在只包含“孩子 + 日期 + 模板”的唯一索引，需要先替换为包含 `recipientOpenid` 的索引，否则同一家庭第二个微信无法建立独立提醒日志。

## 现有 69 张字卡迁移核验

在开启“输入家庭码加入”前，从云数据库分别导出迁移前、迁移后的 JSON 快照。快照顶层使用集合名，至少包含 `users`、`children`、`cards`，迁移后还需包含 `families` 和 `family_members`：

```bash
node scripts/verify-family-migration.js snapshots/before.json snapshots/after.json
```

脚本只读取本地快照，不连接或修改云数据库。只有输出 `"ok": true` 后再开放家庭加入。它会核对：

- 活动孩子数量不变，孩子 `_id` 不变
- 69 张活动字卡全部保留原 `_id` 和 `childId`
- `content`、分类、自定义组词、熟练度、复习次数和上次复习时间均未变化
- 所有活动字卡只归属同一个新家庭
- 原微信 openid 是家庭创建人、owner，并已切换到该家庭

任意一项不一致时脚本以非零状态退出，必须停止开放家庭加入并先检查迁移数据。
