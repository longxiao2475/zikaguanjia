# Family Shared Review Queue Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Migrate the existing single-WeChat data model to family tenancy without changing the current child or 69 card records, then add secure family joining/data merge and a family-shared manual review queue.

**Architecture:** `syncSettings` bootstraps a private family for every legacy owner and backfills `familyId` in place before setting `users.activeFamilyId`. Every business cloud function authorizes through `family_members` and the child's `familyId`; invitations and merge jobs handle controlled family joining, while `review_assignments` persists manually queued cards and is merged into the computed daily plan.

**Tech Stack:** WeChat Mini Program, WeChat Cloud Functions, `wx-server-sdk`, Cloud Database transactions, CommonJS, Node.js built-in test runner.

---

## File structure

- `cloudfunctions/syncSettings/family.js`: family/member identity helpers and migration result normalization.
- `cloudfunctions/syncSettings/repository.js`: family, member, invite, merge-job, and legacy backfill persistence.
- `cloudfunctions/syncSettings/service.js`: bootstrap migration, family summary, invite generation/preview/confirmation.
- `cloudfunctions/{cardService,categoryService,reviewService}/family.js`: deploy-local family authorization helper.
- `cloudfunctions/cardService/repository.js`: family-scoped cards and manual assignments.
- `cloudfunctions/cardService/service.js`: family authorization, manual queue mutation, merged today plan.
- `cloudfunctions/categoryService/{repository.js,service.js}`: family-scoped category access.
- `cloudfunctions/reviewService/{repository.js,service.js}`: family-scoped review commit and assignment completion.
- `cloudfunctions/sendReminder/{repository.js,service.js}`: member-specific reminder delivery.
- `miniprogram/utils/{session.js,cache.js,card.js}`: family-aware session/cache and assignment API.
- `miniprogram/pages/settings/*`: family management and per-member reminder controls.
- `miniprogram/pages/library/*`: replace direct review navigation with queue submission.
- `miniprogram/pages/index/*`: display the merged automatic/manual plan unchanged to existing batch controls.
- `scripts/verify-family-migration.js`: read-only migration invariant checker for one child and 69 active cards.

### Task 1: Family identity primitives

**Files:**
- Create: `cloudfunctions/syncSettings/family.js`
- Create: `tests/family-access.test.js`

- [ ] **Step 1: Write the failing tests**

```js
test('active member can access only a child in the same family', async () => {
  const access = await resolveFamilyAccess(repo, 'openid-1', 'child-1');
  assert.equal(access.family._id, 'family-1');
  assert.equal(access.member.role, 'owner');
  await assert.rejects(() => resolveFamilyAccess(repo, 'openid-1', 'child-2'), /无权访问/);
});

test('invite codes exclude ambiguous characters and are normalized', () => {
  assert.match(generateInviteCode(() => 0.25), /^[23456789ABCDEFGHJKLMNPQRSTUVWXYZ]{8}$/);
  assert.equal(normalizeInviteCode(' ab-cd 2345 '), 'ABCD2345');
});
```

- [ ] **Step 2: Run the tests and verify failure**

Run: `node --test tests/family-access.test.js`
Expected: FAIL because `cloudfunctions/syncSettings/family.js` does not exist.

- [ ] **Step 3: Implement the identity primitives**

```js
const INVITE_ALPHABET = '23456789ABCDEFGHJKLMNPQRSTUVWXYZ';

function generateInviteCode(random = Math.random) {
  return Array.from({ length: 8 }, () => (
    INVITE_ALPHABET[Math.floor(random() * INVITE_ALPHABET.length) % INVITE_ALPHABET.length]
  )).join('');
}

function normalizeInviteCode(value) {
  return String(value || '').normalize('NFKC').toUpperCase().replace(/[^A-Z0-9]/g, '');
}

async function resolveFamilyAccess(repository, openid, childId) {
  const user = await repository.findUserByOpenid(openid);
  const familyId = user && user.activeFamilyId;
  const [family, member, child] = await Promise.all([
    repository.findFamilyById(familyId),
    repository.findActiveMember(familyId, openid),
    repository.findChildById(childId),
  ]);
  if (!family || family.status !== 'active' || !member || !child
      || child.status !== 'active' || child.familyId !== familyId) {
    const error = new Error('无权访问该孩子');
    error.code = 'CHILD_FORBIDDEN';
    throw error;
  }
  return { user, family, member, child };
}

module.exports = { generateInviteCode, normalizeInviteCode, resolveFamilyAccess };
```

- [ ] **Step 4: Run the focused test**

Run: `node --test tests/family-access.test.js`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add cloudfunctions/syncSettings/family.js tests/family-access.test.js
git commit -m "feat: add family identity primitives"
```

### Task 2: Idempotent legacy-family migration

**Files:**
- Modify: `cloudfunctions/syncSettings/repository.js`
- Modify: `cloudfunctions/syncSettings/service.js`
- Modify: `cloudfunctions/syncSettings/index.js`
- Modify: `tests/sync-settings.test.js`
- Modify: `tests/repositories.test.js`

- [ ] **Step 1: Write failing migration tests**

```js
test('bootstrap migrates the legacy owner in place without changing child or card ids', async () => {
  const result = await service.bootstrap('openid-owner');
  assert.equal(result.member.role, 'owner');
  assert.equal(result.child._id, 'child-existing');
  assert.deepEqual(repo.cards.map((card) => card._id), existingCardIds);
  assert.ok(repo.cards.every((card) => card.familyId === result.family._id));
  assert.equal(result.migration.activeCardCount, 69);
});

test('repeated bootstrap reuses the same family and member', async () => {
  const first = await service.bootstrap('openid-owner');
  const second = await service.bootstrap('openid-owner');
  assert.equal(second.family._id, first.family._id);
  assert.equal(repo.families.length, 1);
  assert.equal(repo.members.length, 1);
});
```

- [ ] **Step 2: Verify the tests fail**

Run: `node --test tests/sync-settings.test.js tests/repositories.test.js`
Expected: FAIL because bootstrap does not return or persist family membership.

- [ ] **Step 3: Add repository operations and migration service**

Implement these exact repository methods:

```js
findFamilyById(id)
findLegacyFamilyByCreator(openid)
createFamily(data)
findActiveMember(familyId, openid)
createMember(data)
listActiveChildrenByOwner(openid)
backfillChildrenFamily(openid, familyId)
backfillCardsFamily(childIds, familyId)
backfillCategoriesFamily(childIds, familyId)
backfillReviewSessionsFamily(childIds, familyId)
backfillReminderLogsFamily(childIds, familyId)
countActiveCards(childIds, familyId)
```

Bootstrap must execute this order:

```js
const family = await ensureLegacyFamily(openid);
const childIds = legacyChildren.map((child) => child._id);
await repository.backfillChildrenFamily(openid, family._id);
await repository.backfillCardsFamily(childIds, family._id);
await repository.backfillCategoriesFamily(childIds, family._id);
await repository.backfillReviewSessionsFamily(childIds, family._id);
await repository.backfillReminderLogsFamily(childIds, family._id);
const activeCardCount = await repository.countActiveCards(childIds, family._id);
const member = await ensureOwnerMember(family, user, child);
user = await repository.updateUser(user._id, {
  activeFamilyId: family._id,
  familyMigrationVersion: 1,
});
return { user, family, member, child, migration: { activeCardCount } };
```

No migration operation may delete a document or replace `_id`.

- [ ] **Step 4: Run migration tests**

Run: `node --test tests/sync-settings.test.js tests/repositories.test.js`
Expected: PASS, including the 69-card invariant fixture.

- [ ] **Step 5: Commit**

```bash
git add cloudfunctions/syncSettings tests/sync-settings.test.js tests/repositories.test.js
git commit -m "feat: migrate legacy data into owner family"
```

### Task 3: Family-scoped authorization for card, category, and review services

**Files:**
- Create: `cloudfunctions/cardService/family.js`
- Create: `cloudfunctions/categoryService/family.js`
- Create: `cloudfunctions/reviewService/family.js`
- Modify: `cloudfunctions/cardService/{repository.js,service.js}`
- Modify: `cloudfunctions/categoryService/{repository.js,service.js}`
- Modify: `cloudfunctions/reviewService/{repository.js,service.js}`
- Modify: `tests/{card-service.test.js,category-service.test.js,review-service.test.js,repositories.test.js}`

- [ ] **Step 1: Add failing cross-family isolation tests**

```js
test('same normalized card can exist in two families without sharing progress', async () => {
  const familyOne = await service.create('openid-1', { childId: 'child-1', content: '苹果' });
  const familyTwo = await service.create('openid-2', { childId: 'child-2', content: '苹果' });
  assert.notEqual(familyOne._id, familyTwo._id);
  assert.equal(familyOne.familyId, 'family-1');
  assert.equal(familyTwo.familyId, 'family-2');
});

test('member cannot read a card by id from another family', async () => {
  await assert.rejects(
    () => service.getByIds('openid-2', { childId: 'child-2', cardIds: ['family-1-card'] }),
    /无权|不存在/,
  );
});
```

- [ ] **Step 2: Verify isolation tests fail**

Run: `node --test tests/card-service.test.js tests/category-service.test.js tests/review-service.test.js`
Expected: FAIL because authorization still compares `ownerOpenid`.

- [ ] **Step 3: Implement family access locally in each deployable cloud function**

Each `family.js` exports:

```js
async function assertChildAccess(repository, openid, childId) {
  const access = await repository.findFamilyAccess(openid, childId);
  if (!access || access.member.status !== 'active' || access.child.status !== 'active'
      || access.child.familyId !== access.member.familyId) {
    throw businessError('CHILD_FORBIDDEN', '无权访问该孩子');
  }
  return access;
}
```

All creates persist `familyId` and `createdByOpenid`; all list/duplicate queries use `familyId + childId`; review commits persist `familyId + reviewedByOpenid`. Remove the `card.ownerOpenid === openid` authorization condition from `getByIds` and replace it with `card.familyId === access.familyId`.

- [ ] **Step 4: Run service tests and the full suite**

Run: `node --test tests/card-service.test.js tests/category-service.test.js tests/review-service.test.js tests/repositories.test.js`
Expected: PASS.

Run: `npm test`
Expected: all existing and new tests PASS.

- [ ] **Step 5: Commit**

```bash
git add cloudfunctions/cardService cloudfunctions/categoryService cloudfunctions/reviewService tests
git commit -m "feat: enforce family data isolation"
```

### Task 4: Family-aware session, cache, and member settings

**Files:**
- Modify: `miniprogram/utils/cache.js`
- Modify: `miniprogram/utils/session.js`
- Modify: `miniprogram/pages/settings/index.js`
- Modify: `tests/{cache.test.js,frontend-api.test.js,settings-page.test.js}`

- [ ] **Step 1: Add failing family cache tests**

```js
test('bootstrap caches family and member and clears data from a previous family', async () => {
  await session.bootstrap();
  assert.equal(cache.getFamily()._id, 'family-2');
  assert.equal(cache.getMember().familyId, 'family-2');
  assert.deepEqual(cache.getCards(), []);
  assert.equal(cache.getTodayPlan(), null);
});
```

- [ ] **Step 2: Verify failure**

Run: `node --test tests/cache.test.js tests/frontend-api.test.js tests/settings-page.test.js`
Expected: FAIL because family/member cache APIs do not exist.

- [ ] **Step 3: Implement namespaced cache validation**

Add `zkg:family` and `zkg:member` keys. Every cached cards/categories/today-plan value must include its `familyId`; `session.bootstrap()` compares the previous and returned family IDs and calls `cache.clearFamilyBusinessData()` before caching the new session when they differ.

`saveSettings()` sends shared child fields and personal member reminder fields separately:

```js
await callFunction('syncSettings', {
  action: 'saveSettings',
  childId,
  name,
  studyDays,
  reminderTime,
  reminderEnabled,
});
```

The service updates child `name/studyDays` and member `reminderTime/reminderEnabled` without moving subscription quota out of `users`.

- [ ] **Step 4: Run focused and full tests**

Run: `node --test tests/cache.test.js tests/frontend-api.test.js tests/settings-page.test.js`
Expected: PASS.

Run: `npm test`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add miniprogram/utils miniprogram/pages/settings cloudfunctions/syncSettings tests
git commit -m "feat: scope session and settings by family"
```

### Task 5: Secure family invitations and merge preview

**Files:**
- Modify: `cloudfunctions/syncSettings/family.js`
- Modify: `cloudfunctions/syncSettings/repository.js`
- Modify: `cloudfunctions/syncSettings/service.js`
- Modify: `cloudfunctions/syncSettings/index.js`
- Create: `tests/family-service.test.js`
- Modify: `miniprogram/utils/session.js`

- [ ] **Step 1: Write failing invite tests**

```js
test('owner generates one active 24-hour single-use invite', async () => {
  const invite = await service.createFamilyInvite('owner-openid');
  assert.equal(invite.code.length, 8);
  assert.equal(repo.activeInvites.length, 1);
  assert.equal(repo.activeInvites[0].maxUses, 1);
});

test('preview rejects joining from a family with another active member', async () => {
  await assert.rejects(
    () => service.previewFamilyJoin('member-openid', { code: 'ABCD2345' }),
    /已有其他成员/,
  );
});
```

- [ ] **Step 2: Verify failure**

Run: `node --test tests/family-service.test.js`
Expected: FAIL because invite actions do not exist.

- [ ] **Step 3: Implement invite actions**

Expose only these actions:

```js
getFamilySummary(openid)
createFamilyInvite(openid)
previewFamilyJoin(openid, { code })
confirmFamilyJoin(openid, { code, requestId })
```

Hash normalized codes with `crypto.createHmac('sha256', process.env.FAMILY_INVITE_SECRET)`. `createFamilyInvite` expires previous active invites for the family. `previewFamilyJoin` returns only family name, member count, source/target card counts, duplicate count, unique count, and category conflict count.

- [ ] **Step 4: Run invite tests**

Run: `node --test tests/family-service.test.js`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add cloudfunctions/syncSettings miniprogram/utils/session.js tests/family-service.test.js
git commit -m "feat: add secure family invitations"
```

### Task 6: Idempotent source-family merge

**Files:**
- Modify: `cloudfunctions/syncSettings/repository.js`
- Modify: `cloudfunctions/syncSettings/service.js`
- Modify: `tests/family-service.test.js`

- [ ] **Step 1: Add failing merge tests**

```js
test('merge preserves target duplicate and moves source-only cards with original ids', async () => {
  const result = await service.confirmFamilyJoin('joining-openid', {
    code: 'ABCD2345', requestId: 'join-1',
  });
  assert.equal(result.familyId, 'target-family');
  assert.equal(repo.card('target-apple').proficiency, 'proficient');
  assert.equal(repo.card('source-apple').status, 'merged');
  assert.equal(repo.card('source-banana').familyId, 'target-family');
  assert.equal(repo.card('source-banana')._id, 'source-banana');
});

test('retrying the same merge request does not duplicate members or cards', async () => {
  const first = await service.confirmFamilyJoin('joining-openid', payload);
  const second = await service.confirmFamilyJoin('joining-openid', payload);
  assert.deepEqual(second, first);
  assert.equal(repo.activeMemberships('joining-openid').length, 1);
});
```

- [ ] **Step 2: Verify failure**

Run: `node --test tests/family-service.test.js`
Expected: FAIL because merge execution is not implemented.

- [ ] **Step 3: Implement merge-job state machine**

Use states `pending -> running -> completed` or `failed`. The merge order is:

```text
lock source family
map categories by normalizedName
map duplicate cards by normalizedContent
merge duplicate customWords/categoryIds without changing target progress
mark duplicate source cards as merged with mergedIntoCardId
move source-only cards in place by updating familyId/childId
remap review session card references and snapshots
move pending review assignments
create target member
set users.activeFamilyId
mark source membership inactive and source family merged
consume invite
unlock source family
```

Repository writes use `requestId` and saved mappings so retries continue from the recorded job and never create a second active card or member.

- [ ] **Step 4: Run merge and full tests**

Run: `node --test tests/family-service.test.js`
Expected: PASS.

Run: `npm test`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add cloudfunctions/syncSettings tests/family-service.test.js
git commit -m "feat: merge existing data when joining family"
```

### Task 7: Family management UI

**Files:**
- Modify: `miniprogram/pages/settings/index.js`
- Modify: `miniprogram/pages/settings/index.wxml`
- Modify: `miniprogram/pages/settings/index.wxss`
- Modify: `tests/settings-page.test.js`
- Modify: `tests/project-structure.test.js`

- [ ] **Step 1: Add failing page tests**

```js
test('owner can create and copy a family code', async () => {
  await definition.onGenerateFamilyCode.call(context);
  assert.equal(context.data.familyInviteCode, 'ABCD2345');
  definition.onCopyFamilyCode.call(context);
  assert.equal(copiedText, 'ABCD2345');
});

test('joining shows merge preview before confirm', async () => {
  await definition.onPreviewFamilyJoin.call(context);
  assert.equal(context.data.showJoinPreview, true);
  assert.equal(context.data.joinPreview.duplicateCardCount, 12);
});
```

- [ ] **Step 2: Verify failure**

Run: `node --test tests/settings-page.test.js tests/project-structure.test.js`
Expected: FAIL because family controls are absent.

- [ ] **Step 3: Implement settings-page family card**

Add owner-only “生成家庭码”, “复制”, and “重新生成” actions; add an 8-character input, “检查家庭码”, merge-preview sheet, and explicit “确认合并并加入” action. Disable all family buttons while generating, previewing, or merging. After success call `session.bootstrap()`, clear page state, and show “已加入家庭”.

- [ ] **Step 4: Run page tests and full suite**

Run: `node --test tests/settings-page.test.js tests/project-structure.test.js`
Expected: PASS.

Run: `npm test`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add miniprogram/pages/settings tests/settings-page.test.js tests/project-structure.test.js
git commit -m "feat: add family management settings"
```

### Task 8: Persistent family review assignments

**Files:**
- Modify: `cloudfunctions/cardService/repository.js`
- Modify: `cloudfunctions/cardService/service.js`
- Modify: `cloudfunctions/cardService/index.js`
- Modify: `cloudfunctions/reviewService/repository.js`
- Modify: `tests/card-service.test.js`
- Modify: `tests/review-service.test.js`

- [ ] **Step 1: Write failing assignment tests**

```js
test('manual cards are idempotently added and merged into today plan', async () => {
  const added = await service.addReviewAssignments('openid-1', {
    childId: 'child-1', cardIds: ['due-card', 'manual-card', 'manual-card'],
  });
  assert.deepEqual(added, { addedCount: 1, existingCount: 1, invalidCount: 0 });
  const plan = await service.getTodayPlan('openid-1', { childId: 'child-1' });
  assert.deepEqual(plan.cards.map((card) => card._id), ['due-card', 'manual-card']);
});

test('review completion completes matching pending assignments', async () => {
  await service.complete('openid-1', reviewPayload);
  assert.equal(repo.assignment('manual-card').status, 'completed');
});
```

- [ ] **Step 2: Verify failure**

Run: `node --test tests/card-service.test.js tests/review-service.test.js`
Expected: FAIL because assignment APIs and plan merge are absent.

- [ ] **Step 3: Implement assignment APIs and transaction completion**

Add card-service action `addReviewAssignments`. It accepts at most 50 unique card IDs, validates every returned card against family and child, upserts one pending assignment per card, and returns `{ addedCount, existingCount, invalidCount }`.

`getTodayPlan` loads pending assignments with `scheduledDate <= today`, filters active same-family cards, merges automatic cards first and manual-only cards second, de-duplicates by ID, then applies the existing sort.

`reviewService.completeReview` updates matching pending assignments to:

```js
{ status: 'completed', completedAt: reviewedAt, completedByOpenid: openid }
```

inside the existing review transaction.

- [ ] **Step 4: Run focused and full tests**

Run: `node --test tests/card-service.test.js tests/review-service.test.js`
Expected: PASS.

Run: `npm test`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add cloudfunctions/cardService cloudfunctions/reviewService tests
git commit -m "feat: persist family review assignments"
```

### Task 9: Change library selection from direct review to queueing

**Files:**
- Modify: `miniprogram/utils/card.js`
- Modify: `miniprogram/pages/library/index.js`
- Modify: `miniprogram/pages/library/index.wxml`
- Modify: `miniprogram/pages/library/index.wxss`
- Modify: `tests/frontend-api.test.js`
- Modify: `tests/library-page.test.js`
- Modify: `tests/project-structure.test.js`

- [ ] **Step 1: Write failing UI-flow tests**

```js
test('selected library cards are queued and switch to home without opening review', async () => {
  await definition.onAddSelectedToToday.call(context);
  assert.deepEqual(queuePayload, { childId: 'child-1', cardIds: ['card-1', 'card-2'] });
  assert.equal(switchedUrl, '/pages/index/index');
  assert.equal(navigatedToReview, false);
});

test('queue failure preserves selection for retry', async () => {
  await definition.onAddSelectedToToday.call(context);
  assert.deepEqual(context.data.selectedIds, ['card-1']);
  assert.equal(context.data.selectionMode, true);
});
```

- [ ] **Step 2: Verify failure**

Run: `node --test tests/frontend-api.test.js tests/library-page.test.js tests/project-structure.test.js`
Expected: FAIL because the page still writes a local queue and navigates to review.

- [ ] **Step 3: Implement the new flow**

Add `cardApi.addReviewAssignments(childId, cardIds)`. Rename the handler to `onAddSelectedToToday`; call the API, clear the local today-plan cache, show the added/existing summary, clear selection only on success, and use `wx.switchTab({ url: '/pages/index/index' })`. Change the button label to “加入今日待复习”. Remove the library dependency on `cache.setManualReviewQueue`.

- [ ] **Step 4: Run focused and full tests**

Run: `node --test tests/frontend-api.test.js tests/library-page.test.js tests/project-structure.test.js`
Expected: PASS.

Run: `npm test`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add miniprogram/utils/card.js miniprogram/pages/library tests
git commit -m "feat: queue selected library cards for today"
```

### Task 10: Member-specific reminders

**Files:**
- Modify: `cloudfunctions/sendReminder/repository.js`
- Modify: `cloudfunctions/sendReminder/service.js`
- Modify: `tests/send-reminder.test.js`
- Modify: `tests/reminder-repository.test.js`

- [ ] **Step 1: Add failing reminder tests**

```js
test('each enabled family member receives reminders using personal time and quota', async () => {
  await service.run(new Date('2026-08-03T12:00:00.000Z'));
  assert.deepEqual(sent.map((item) => item.touser).sort(), ['member-1', 'owner-1']);
  assert.equal(repo.user('disabled-member').subscriptionQuota, 3);
});
```

- [ ] **Step 2: Verify failure**

Run: `node --test tests/send-reminder.test.js tests/reminder-repository.test.js`
Expected: FAIL because reminders still target `child.ownerOpenid`.

- [ ] **Step 3: Implement member-specific reminder scheduling**

List active family members whose personal reminder is enabled and due; load the shared child plan once per family/child; send to each member's `openid`; consume only that user's `subscriptionQuota`; write logs keyed by `familyId + childId + recipientOpenid + bizDate`.

- [ ] **Step 4: Run reminder and full tests**

Run: `node --test tests/send-reminder.test.js tests/reminder-repository.test.js`
Expected: PASS.

Run: `npm test`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add cloudfunctions/sendReminder tests/send-reminder.test.js tests/reminder-repository.test.js
git commit -m "feat: send reminders per family member"
```

### Task 11: Migration verification and release guard

**Files:**
- Create: `scripts/verify-family-migration.js`
- Create: `tests/family-migration-verifier.test.js`
- Modify: `README.md`

- [ ] **Step 1: Write failing verifier tests**

```js
test('verifier accepts exactly one child and the same 69 card ids', () => {
  const result = verifyMigration(before, after, { expectedChildren: 1, expectedCards: 69 });
  assert.equal(result.ok, true);
});

test('verifier rejects changed ids or review fields', () => {
  assert.throws(() => verifyMigration(before, changedAfter, expectations), /迁移校验失败/);
});
```

- [ ] **Step 2: Verify failure**

Run: `node --test tests/family-migration-verifier.test.js`
Expected: FAIL because the verifier does not exist.

- [ ] **Step 3: Implement a read-only verifier**

Export `verifyMigration(before, after, expectations)` and compare child count, active-card count, sorted card ID sets, and each card's `content`, `categoryIds`, `customWords`, `proficiency`, `reviewCount`, and `lastReviewAt`. The CLI takes two JSON snapshot paths and exits non-zero on any mismatch. It must never write to Cloud Database.

Document the release gate command:

```bash
node scripts/verify-family-migration.js before.json after.json --children=1 --cards=69
```

- [ ] **Step 4: Run verifier and full tests**

Run: `node --test tests/family-migration-verifier.test.js`
Expected: PASS.

Run: `npm test`
Expected: all tests PASS.

- [ ] **Step 5: Commit**

```bash
git add scripts/verify-family-migration.js tests/family-migration-verifier.test.js README.md
git commit -m "chore: verify lossless family migration"
```

### Task 12: Final integrated verification

**Files:**
- Verify only; fix failures in the owning files from Tasks 1-11.

- [ ] **Step 1: Run the complete automated suite**

Run: `npm test`
Expected: zero failures.

- [ ] **Step 2: Run static project checks**

Run: `git diff --check`
Expected: no output.

- [ ] **Step 3: Verify forbidden authorization patterns**

Run: `rg -n "child\.ownerOpenid !== openid|card\.ownerOpenid !== openid" cloudfunctions`
Expected: no active authorization checks; legacy fields may only appear in migration/audit code.

- [ ] **Step 4: Verify the release invariants**

Run the read-only migration verifier against exported pre/post-migration snapshots and require: one child, 69 active cards, identical card IDs, and identical review fields.

- [ ] **Step 5: Confirm a clean implementation handoff**

Run: `git status --short`
Expected: no uncommitted implementation changes. If verification exposed a defect, return to the owning task, add a focused failing test, implement its fix, rerun that task's checks, and use that task's exact commit command before repeating Task 12.
