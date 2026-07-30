# Selection, Category, and Reminder Reliability Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Restore visible selection states, reduce default categories to eight without deleting referenced data, and make reminders run hourly with same-day retry until one successful send.

**Architecture:** Keep visual fixes in existing WXSS files, add idempotent category reconciliation to `categoryService`, constrain settings to `HH:00`, and turn `reminder_logs` into one mutable daily delivery record. The scheduled and manual production runs use the same reminder service path.

**Tech Stack:** WeChat Mini Program WXML/WXSS/JavaScript, WeChat Cloud Functions, Cloud Database, Node.js built-in test runner.

---

### Task 1: Restore all selected-state visuals

**Files:**
- Modify: `tests/project-structure.test.js`
- Modify: `miniprogram/pages/add/index.wxss`
- Modify: `miniprogram/components/category-picker/index.wxss`
- Modify: `miniprogram/pages/library/index.wxss`

- [ ] **Step 1: Write the failing selector-priority test**

Add assertions that read these exact selectors and require state colors/backgrounds:

```js
for (const [stylesheet, selector] of [
  [addWxss, 'button.mode-tab--active'],
  [addWxss, 'button.source-option--active'],
  [categoryPickerWxss, 'button.category-picker__chip--selected'],
  [categoryPickerWxss, 'button.category-picker__header-button--primary'],
  [libraryWxss, 'button.category-filter-button--active'],
  [libraryWxss, 'button.filter-tab--active'],
]) {
  const rule = readRule(stylesheet, selector);
  assert.match(rule, /color:/);
  assert.match(rule, /background:/);
}
```

- [ ] **Step 2: Run the test and verify RED**

Run: `node --test tests/project-structure.test.js`

Expected: FAIL because the `button.*--active` and `button.*--selected` rules do not exist.

- [ ] **Step 3: Raise state selector specificity**

Replace the affected state selectors with button-qualified selectors:

```css
button.mode-tab--active { color: var(--color-primary-dark); background: var(--color-primary-soft); }
button.source-option--active { border-color: var(--color-primary); background: var(--color-primary-soft); }
button.category-picker__chip--selected { border-color: #FF8A65; color: #C75C39; background: #FFF0EB; }
button.category-picker__header-button--primary { color: #E6704A; background: transparent; font-weight: 650; }
button.category-filter-button--active { border-color: rgba(255, 138, 101, 0.38); color: var(--color-primary-dark); background: var(--color-primary-soft); }
button.filter-tab--active { color: var(--color-primary-dark); background: var(--color-primary-soft); }
```

- [ ] **Step 4: Run the focused test and verify GREEN**

Run: `node --test tests/project-structure.test.js`

Expected: all structure tests pass.

- [ ] **Step 5: Commit the visual fix**

```bash
git add tests/project-structure.test.js miniprogram/pages/add/index.wxss miniprogram/components/category-picker/index.wxss miniprogram/pages/library/index.wxss
git commit -m "fix: restore selected button visuals"
```

### Task 2: Reconcile categories down to eight defaults

**Files:**
- Modify: `tests/category-service.test.js`
- Modify: `tests/repositories.test.js`
- Modify: `cloudfunctions/categoryService/service.js`
- Modify: `cloudfunctions/categoryService/repository.js`

- [ ] **Step 1: Write failing service tests**

Cover the canonical list and migration behavior:

```js
assert.deepEqual(DEFAULT_CATEGORY_NAMES, [
  '交通工具', '食品', '身体部位', '家具',
  '植物', '动物', '学习用品', '日常用品',
]);
```

Seed one unreferenced legacy default, one referenced legacy default, and one custom category. Assert that reconciliation deactivates only the unreferenced legacy default, retains the referenced legacy default and custom category, and remains idempotent on the second list call.

- [ ] **Step 2: Run category tests and verify RED**

Run: `node --test tests/category-service.test.js tests/repositories.test.js`

Expected: FAIL because there are 24 defaults and no reference/status repository methods.

- [ ] **Step 3: Add repository support**

Expose these methods:

```js
async countActiveCardReferences(childId, categoryId) {
  const result = await cards.where({ childId, status: 'active' }).get();
  return result.data.filter((card) => (
    Array.isArray(card.categoryIds) && card.categoryIds.includes(categoryId)
  )).length;
},
async updateCategoryStatus(id, status) {
  return this.updateCategory(id, { status });
},
```

Use paginated reads for production data rather than relying on one default page.

- [ ] **Step 4: Implement idempotent reconciliation**

Set `DEFAULT_CATEGORY_NAMES` to the eight values. On every list:

```js
for (const canonicalName of DEFAULT_CATEGORY_NAMES) {
  // reactivate the matching default or create it when absent
}
for (const category of allCategories) {
  if (!category.isDefault || DEFAULT_CATEGORY_NAMES.includes(category.normalizedName)) continue;
  const references = await repository.countActiveCardReferences(payload.childId, category._id);
  if (references === 0 && category.status === 'active') {
    await repository.updateCategoryStatus(category._id, 'inactive');
  }
}
```

Assign canonical sort orders `0..7`; keep referenced legacy categories after them. Do not deactivate custom categories in general code.

- [ ] **Step 5: Verify GREEN**

Run: `node --test tests/category-service.test.js tests/repositories.test.js`

Expected: all category and repository tests pass.

- [ ] **Step 6: Commit category reconciliation**

```bash
git add tests/category-service.test.js tests/repositories.test.js cloudfunctions/categoryService/service.js cloudfunctions/categoryService/repository.js
git commit -m "feat: reconcile default card categories"
```

### Task 3: Restrict settings to whole hours

**Files:**
- Modify: `tests/sync-settings.test.js`
- Modify: `tests/project-structure.test.js`
- Modify: `cloudfunctions/syncSettings/service.js`
- Modify: `miniprogram/pages/settings/index.js`
- Modify: `miniprogram/pages/settings/index.wxml`

- [ ] **Step 1: Write failing hour tests**

Assert that `saveSettings` accepts `19:00` and rejects `19:30`. Add structure assertions for a 24-option selector and absence of `picker mode="time"`.

```js
await assert.rejects(
  () => service.saveSettings('openid-1', { ...valid, reminderTime: '19:30' }),
  (error) => error.code === 'REMINDER_TIME_INVALID',
);
```

- [ ] **Step 2: Run settings tests and verify RED**

Run: `node --test tests/sync-settings.test.js tests/project-structure.test.js`

Expected: FAIL because minute values are currently accepted and the page still uses a time picker.

- [ ] **Step 3: Implement the whole-hour model**

Add page helpers/data:

```js
const HOUR_OPTIONS = Array.from({ length: 24 }, (_, hour) => (
  `${String(hour).padStart(2, '0')}:00`
));
function normalizeReminderTime(value) {
  const match = String(value || '').match(/^(\d{2}):\d{2}$/);
  return match && Number(match[1]) < 24 ? `${match[1]}:00` : '20:00';
}
```

Bind a single-column picker by index, display its selected `HH:00`, and save only that value. Change cloud validation to `/^(?:[01]\d|2[0-3]):00$/`.

- [ ] **Step 4: Verify GREEN**

Run: `node --test tests/sync-settings.test.js tests/project-structure.test.js`

Expected: all settings and structure tests pass.

- [ ] **Step 5: Commit hour-only settings**

```bash
git add tests/sync-settings.test.js tests/project-structure.test.js cloudfunctions/syncSettings/service.js miniprogram/pages/settings/index.js miniprogram/pages/settings/index.wxml
git commit -m "feat: schedule reminders by whole hour"
```

### Task 4: Retry reminders hourly until daily success

**Files:**
- Modify: `tests/send-reminder.test.js`
- Modify: `tests/project-structure.test.js`
- Modify: `cloudfunctions/sendReminder/config.json`
- Modify: `cloudfunctions/sendReminder/schedule.js`
- Modify: `cloudfunctions/sendReminder/service.js`
- Modify: `cloudfunctions/sendReminder/repository.js`

- [ ] **Step 1: Write failing scheduling and retry tests**

Change the eligibility assertion so `20:00` is eligible at both 20:05 and 21:05, but not 19:05. Add service tests for failed-at-20 then sent-at-21, quota-empty then sent after quota grant, no-due-cards then sent after adding a card, and successful send skipped on later hourly runs.

Expected service summary fields:

```js
{ matched: 1, sent: 0, skipped: 0, failed: 1, alreadySent: 0 }
{ matched: 1, sent: 1, skipped: 0, failed: 0, alreadySent: 0 }
```

- [ ] **Step 2: Run reminder tests and verify RED**

Run: `node --test tests/send-reminder.test.js tests/project-structure.test.js`

Expected: FAIL because equality-only scheduling and duplicate-log short-circuit prevent retries.

- [ ] **Step 3: Implement due-at-or-after scheduling**

```js
function shouldRemindChild(child, context) {
  const studyDays = Array.isArray(child && child.studyDays) ? child.studyDays : [];
  const reminderHour = Number(String((child && child.reminderTime) || '').slice(0, 2));
  return studyDays.includes(context.dayOfWeek)
    && Number.isInteger(reminderHour)
    && context.hour >= reminderHour;
}
```

- [ ] **Step 4: Replace create-once logs with mutable daily logs**

Repository API:

```js
findReminderLog({ childId, bizDate, templateId })
createReminderLog(data)
beginAttempt(logId, snapshot)
markNoDueCards(logId)
markQuotaEmpty(logId)
markFailed(logId, error)
consumeAndMarkSent({ logId, openid, templateId })
```

`beginAttempt` increments `attemptCount`, refreshes `lastAttemptAt`, clears prior error fields, and updates the current due-card snapshot. `sent` logs are never reopened.

- [ ] **Step 5: Implement the retry state machine**

For each eligible child, load or create today's log. Skip only `status === 'sent'`; otherwise recalculate cards and quota, call `beginAttempt`, write a retryable status when not sent, and call WeChat once per hourly run when conditions are satisfied.

- [ ] **Step 6: Configure the hourly trigger**

Set `cloudfunctions/sendReminder/config.json` to:

```json
{
  "triggers": [
    {
      "name": "hourlyReminder",
      "type": "timer",
      "config": "0 0 * * * * *"
    }
  ]
}
```

- [ ] **Step 7: Verify GREEN**

Run: `node --test tests/send-reminder.test.js tests/project-structure.test.js`

Expected: all reminder and structure tests pass.

- [ ] **Step 8: Commit reminder reliability**

```bash
git add tests/send-reminder.test.js tests/project-structure.test.js cloudfunctions/sendReminder/config.json cloudfunctions/sendReminder/schedule.js cloudfunctions/sendReminder/service.js cloudfunctions/sendReminder/repository.js
git commit -m "feat: retry daily reminders every hour"
```

### Task 5: Full verification, cloud deployment, and real interaction tests

**Files:**
- Modify only if verification exposes a defect in files already listed above.

- [ ] **Step 1: Run all automated tests**

Run: `npm test`

Expected: exit code 0 with zero failures.

- [ ] **Step 2: Run syntax and diff checks**

Run: `find miniprogram cloudfunctions tests -name '*.js' -print0 | xargs -0 -n1 node --check`

Expected: exit code 0.

Run: `git diff --check`

Expected: no output and exit code 0.

- [ ] **Step 3: Deploy changed cloud functions**

Upload and deploy `categoryService`, `syncSettings`, and `sendReminder` to `cloud-space-d8gr80gd334789538`, using cloud installation for dependencies. Confirm each function is active and the `hourlyReminder` trigger is present.

- [ ] **Step 4: Clean the known test-only category**

Query the current child's custom “汽车” category. If no active card references it, change only that record to `inactive`; otherwise retain it. Do not delete the record.

- [ ] **Step 5: Test in WeChat Developer Tools**

Open the project and click through: add page source selection and category multiselect; library proficiency and category filters; edit sheet three proficiency choices and categories; settings day choices, reminder switch, and hour picker. Verify selected styles, vertical centering, eight canonical defaults, persistence after reopening, and no console errors.

- [ ] **Step 6: Trigger one production reminder**

Confirm the current child is eligible, has a due card and positive subscription quota. Manually invoke deployed `sendReminder`, then verify result summary, daily log status `sent`, quota decreased by one, and ask the user to confirm the phone notification. Do not invoke a second time after success.

- [ ] **Step 7: Final repository verification**

Run: `npm test && git diff --check && git status -sb`

Expected: tests pass, diff check is clean, and only intended changes are present.
