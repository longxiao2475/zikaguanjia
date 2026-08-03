#!/usr/bin/env node

const fs = require('node:fs');
const path = require('node:path');

const PRESERVED_CARD_FIELDS = Object.freeze([
  'content',
  'categoryIds',
  'customWords',
  'proficiency',
  'reviewCount',
  'lastReviewAt',
]);

function fail(message) {
  const error = new Error(`家庭迁移核验失败：${message}`);
  error.code = 'FAMILY_MIGRATION_VERIFICATION_FAILED';
  throw error;
}

function records(snapshot, key) {
  const value = snapshot && snapshot[key];
  if (!Array.isArray(value)) fail(`快照缺少 ${key} 数组`);
  return value;
}

function stableValue(value) {
  if (Array.isArray(value)) return value.map(stableValue);
  if (value && typeof value === 'object') {
    return Object.fromEntries(Object.keys(value).sort().map((key) => [key, stableValue(value[key])]));
  }
  return value === undefined ? null : value;
}

function valuesEqual(left, right) {
  return JSON.stringify(stableValue(left)) === JSON.stringify(stableValue(right));
}

function verifyFamilyMigration(before, after, options = {}) {
  const expectedCardCount = Number(options.expectedCardCount ?? 69);
  const beforeChildren = records(before, 'children').filter((item) => item.status === 'active');
  const afterChildren = records(after, 'children').filter((item) => item.status === 'active');
  const beforeCards = records(before, 'cards').filter((item) => item.status === 'active');
  const afterCards = records(after, 'cards').filter((item) => item.status === 'active');

  if (beforeChildren.length !== afterChildren.length) {
    fail(`活动孩子数量由 ${beforeChildren.length} 变为 ${afterChildren.length}`);
  }
  if (beforeCards.length !== expectedCardCount) {
    fail(`迁移前活动字卡数量应为 ${expectedCardCount}，实际为 ${beforeCards.length}`);
  }
  if (afterCards.length !== expectedCardCount) {
    fail(`活动字卡数量应保持 ${expectedCardCount}，迁移后为 ${afterCards.length}`);
  }

  const legacyOwners = [...new Set(beforeChildren.map((item) => item.ownerOpenid).filter(Boolean))];
  if (legacyOwners.length !== 1) fail('无法从迁移前孩子记录唯一确定原微信 openid');
  const legacyOwnerOpenid = legacyOwners[0];
  const afterChildById = new Map(afterChildren.map((item) => [item._id, item]));
  for (const child of beforeChildren) {
    if (!afterChildById.has(child._id)) fail(`缺少原孩子 ${child._id}，禁止替换记录 id`);
  }

  const familyIds = [...new Set(afterChildren.map((item) => item.familyId).filter(Boolean))];
  if (familyIds.length !== 1) fail('迁移后活动孩子没有归属到唯一家庭');
  const familyId = familyIds[0];
  const afterCardById = new Map(afterCards.map((item) => [item._id, item]));
  for (const card of beforeCards) {
    const migrated = afterCardById.get(card._id);
    if (!migrated) fail(`缺少原字卡 ${card._id}，禁止删除或替换记录 id`);
    if (migrated.familyId !== familyId) {
      fail(`字卡 ${card._id} 的 familyId 未归属家庭 ${familyId}`);
    }
    if (migrated.childId !== card.childId) {
      fail(`字卡 ${card._id} 的 childId 发生变化`);
    }
    for (const field of PRESERVED_CARD_FIELDS) {
      if (!valuesEqual(card[field], migrated[field])) {
        fail(`字卡 ${card._id} 的 ${field} 发生变化`);
      }
    }
  }

  const family = records(after, 'families').find((item) => item._id === familyId && item.status === 'active');
  if (!family) fail(`找不到活动家庭 ${familyId}`);
  if (family.createdByOpenid !== legacyOwnerOpenid) fail('家庭创建人不是原微信');
  const ownerMember = records(after, 'family_members').find((item) => (
    item.familyId === familyId
    && item.openid === legacyOwnerOpenid
    && item.role === 'owner'
    && item.status === 'active'
  ));
  if (!ownerMember) fail('原微信没有成为家庭 owner 成员');
  const migratedUser = records(after, 'users').find((item) => (
    item.openid === legacyOwnerOpenid && item.status === 'active'
  ));
  if (!migratedUser || migratedUser.activeFamilyId !== familyId) {
    fail('原微信用户的 activeFamilyId 未指向新家庭');
  }

  return {
    ok: true,
    legacyOwnerOpenid,
    familyId,
    activeChildCount: afterChildren.length,
    activeCardCount: afterCards.length,
  };
}

function readSnapshot(filePath) {
  return JSON.parse(fs.readFileSync(path.resolve(filePath), 'utf8'));
}

function main(argv = process.argv.slice(2)) {
  if (argv.length !== 2) {
    console.error('用法：node scripts/verify-family-migration.js <迁移前.json> <迁移后.json>');
    return 2;
  }
  try {
    const result = verifyFamilyMigration(readSnapshot(argv[0]), readSnapshot(argv[1]));
    console.log(JSON.stringify(result, null, 2));
    return 0;
  } catch (error) {
    console.error(error.message || error);
    return 1;
  }
}

if (require.main === module) process.exitCode = main();

module.exports = {
  PRESERVED_CARD_FIELDS,
  main,
  verifyFamilyMigration,
};
