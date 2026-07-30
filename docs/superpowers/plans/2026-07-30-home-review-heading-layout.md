# Home Review Heading Layout Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Align the home-page “全部字卡” action to the right while giving the review-order subtitle a full-width row.

**Architecture:** Keep the existing page behavior and change only the section-heading markup and layout styles. Use a two-column CSS Grid with the subtitle spanning both columns.

**Tech Stack:** WeChat Mini Program WXML/WXSS, Node.js `node:test`.

---

### Task 1: Lock the heading layout contract

**Files:**
- Modify: `tests/project-structure.test.js`

- [ ] **Step 1: Write the failing test**

Add an assertion that the heading contains a `section-heading__copy` wrapper and that the WXSS uses a two-column grid, makes the copy shrinkable, sends the action to the right, and spans the subtitle across both columns.

- [ ] **Step 2: Run the focused test to verify it fails**

Run: `node --test tests/project-structure.test.js`

Expected: FAIL because the wrapper and grid layout rules do not exist yet.

### Task 2: Implement the home heading grid

**Files:**
- Modify: `miniprogram/pages/index/index.wxml`
- Modify: `miniprogram/pages/index/index.wxss`

- [ ] **Step 1: Add the copy wrapper**

Wrap the title and subtitle in `<view class="section-heading__copy">` without changing their text or bindings.

- [ ] **Step 2: Apply the grid layout**

Use `grid-template-columns: minmax(0, 1fr) auto`, set `.section-heading__copy { min-width: 0; }`, keep `.section-heading__more` fixed and right-aligned, and make `.section-heading__subtitle` span the full available copy width without button pressure.

- [ ] **Step 3: Run the focused test**

Run: `node --test tests/project-structure.test.js`

Expected: PASS.

- [ ] **Step 4: Run the full verification**

Run: `npm test`

Expected: all tests pass.

Run: `find miniprogram cloudfunctions tests -name '*.js' -print0 | xargs -0 -n1 node --check`

Expected: exit code 0.

Run: `git diff --check`

Expected: no output.

- [ ] **Step 5: Verify in WeChat Developer Tools**

Open the home page at the iPhone 12/13 simulator size and capture a screenshot confirming the action is right-aligned and the subtitle is no longer squeezed by it.

