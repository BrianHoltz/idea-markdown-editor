# Markdown Editor: Hierarchical List Editing Test Plan and Fix Brief

Implementation plan for strengthening this repository’s hierarchical-list editing suite and fixing the bugs it exposes. Execution owner: **Sol6.1**. Investigation baseline: 2026.11.06, local.27. Recheck the current branch, plugin version and installed build before executing.

## Contents

- [Trigger](#trigger)
- [Reproduced Bugs](#reproduced-bugs)
- [Unreproduced Setext Heading](#unreproduced-setext-heading)
- [Target Semantics](#target-semantics)
- [Test Suite Plan](#test-suite-plan)
  - [Harness Upgrades](#harness-upgrades)
  - [New Matrix Rows](#new-matrix-rows)
  - [Live Plugin Probe](#live-plugin-probe)
- [Code Review](#code-review)
- [Instructions for Sol6.1](#instructions-for-sol61)
- [Done Criteria](#done-criteria)

## Trigger

Brian's report: in the affected Markdown document, IR mode, he clicked in front of `Cc` on this nested line, then pressed Delete (Mac Delete is `Backspace`):

```markdown
- **Filter titles:** Enter >1 character to filter loaded conversations by title.
  - **Cc** enables case sensitivity; **!** negates the filter.
```

Result: the parent line rendered as a large heading with a bottom rule. The `**Cc**` bullet survived below it. That shape is consistent with a blank `-` line between the parent text and the `Cc` item; the underlying source was not captured, so this mechanism remains a hypothesis. CommonMark reads `-` under a paragraph as a **setext H2 underline**. `fixListStartEnter` in `list-lines.js` documents the same failure for Enter.

A previous agent's report on 2026.11.04 had already flagged this as untested: *"Not covered: Backspace with the caret at the start of a line, a Tab on the first bullet, or mixed bullet and task lists."* That untested class is where every bug below lives.

Installed plugin: **2.0.7-local.26** (IDEA 2026.2). HEAD is **local.27** (`60bbb74`, branch `brian/markdown-ux`).

## Reproduced Bugs

Reproduced by Opus on 2026.11.06 in Chrome Canary against the test fixture at HEAD, both IR and WYSIWYG, using the same results for each. Document: `- Alpha / ␣␣- Alpha one / ␣␣- Alpha two / - Bravo / ␣␣- Bravo one`.

- **Backspace at start of a first child** (`Alpha one`): merges correctly, but inserts blank lines, loosening both lists:
  `- AlphaAlpha one\n\n\n  - Alpha two\n- Bravo\n\n  - Bravo one\n`
- **Backspace at start of a top-level line whose previous sibling has children** (`Bravo`): **structural corruption**. `Bravo one` ends up under an empty item:
  `  - Alpha twoBravo\n- - Bravo one\n`
- **Delete at end of a last child followed by a branch** (`Alpha two` → `Bravo`): same `- - Bravo one` corruption. Mirror of the bug above.
- **Backspace at start of the first top-level line** (`Alpha`): children are promoted, the list splits in two, and stray blank lines appear:
  `Alpha\n\n- Alpha one\n- Alpha two\n\n\n- Bravo\n  - Bravo one\n`
- **Asymmetry:** Delete at the end of `Alpha` gives a clean `- AlphaAlpha one\n  - Alpha two`. Backspace at the start of `Alpha one`, the same logical join, adds blank lines.
- **IR marker boundary:** a real click in front of the `C` glyph lands at `span.vditor-ir__marker "**" @2`. Backspace then deletes a marker character, giving `*Cc**`. This is IR's design, not corruption, but users see it as "deleting before Cc". Test it; don't change it without Brian's say-so.

Fine as-is: Backspace at the start of a middle or last child (`Alpha oneAlpha two`), Enter mid-line, Delete at line start (deletes a character).

Throwaway repro scripts (may vanish from `/tmp`): `/tmp/repro-linestart.sheet.mjs`, `/tmp/repro-click.mjs`, `/tmp/repro-fuzz.mjs`.

## Unreproduced Setext Heading

None of these produced Brian's heading in the fixture: synthetic caret placement, real mouse clicks at three x-offsets, or a sweep of every DOM boundary position at the start of the `Cc` line (both modes, both keys, HEAD and local.26). Unverified hypotheses:

- **Fixture/production gap**: production starts in IR with Vditor's default `undoDelay` and runs other handlers (toolbar, search, context selection, external sync). The fixture starts in WYSIWYG with `undoDelay: 50`. JCEF's Chromium also differs from Canary.
- **Multi-key sequence**: key repeat or a second Backspace after the first edit. For example, once `*Cc**` reparses, the next Backspace hits a different DOM shape.
- **Stale DOM state from earlier edits in the session**: earlier native edits left loose-list or blank-paragraph residue, invisible in Markdown, that the Backspace then reparsed.
- **External-sync race**: other agents were editing the document around then. Git history shows no bare `-` line was ever written, so this is unlikely.

The [Live Plugin Probe](#live-plugin-probe) and the [invariant oracle](#harness-upgrades) are the plan for catching this class even when nobody can reproduce it by hand.

## Target Semantics

Extend the existing outliner rules already written in `test/list-keys.sheet.mjs`. **One rule covers all joins:** joining moves the later line's text onto the end of the earlier line, and the removed line's sub-bullets take its place. That is the same `removeOwn` rule already used for deleting a selected line, so the model needs no new concept.

- **Backspace at start of a non-empty list line** with a list line visually above it: join into that line, whatever its depth. The caret ends at the join point.
- **Delete at end of a list line** with a list line visually below it: join that line up into this one. Same rule, mirrored.
- **Backspace at start of the first line of a list** with no list line above: unwrap it to a paragraph. Its sub-bullets become one tight list after it, promoted one level. Never split the remaining list, never add blank lines.
- **Delete at end of the last list line**: if a paragraph follows, join it in; otherwise do nothing.
- **Inline formatting at the line start** (`**`, `` ` ``, links, task checkbox): the caret at the visual line start counts as line start. A task checkbox belongs to the line, as `hasContent(…, true)` already assumes.
- **Never**: blank lines appearing in a tight list, `- -` (an item whose only content is a list), a heading appearing inside an `li`, or a literal `- ` paragraph.

**Decisions for Brian** (Sol applies the default if he hasn't answered):

- **Nested line, Backspace at start:** join into the line above (**default**, matching what native editing already attempts) or outdent first, the way Google Docs and Notion do.
- **IR caret just after a leading opening marker:** keep native marker deletion (**default**) or treat it as line start.

## Test Suite Plan

The infrastructure is sound: real Canary, real keys and clipboard, undo/redo checks on every row, and a flat outline model in `list-matrix.sheet.mjs`. Its gaps are coverage and oracle strength, not architecture.

### Harness Upgrades

In `test/support/sheet.mjs` unless noted:

- **Invariant oracle (highest leverage):** after every action, every undo and every redo, assert in the page:
  - no heading inside an `li` unless the row's start state had one;
  - no `li` whose only child is a list;
  - no `p` whose text starts with `- `, `* ` or `+ `;
  - `data-tight` unchanged on lists the action didn't structurally touch;
  - the serialized Markdown contains no `\n\n\n` and no bare `-` line, unless the row expects one.
  Scope these checks to each row’s baseline and expected operation: empty bullets, headings, literal marker text, loose lists and blank paragraphs can be legitimate. Compare expected structure, caret and formatting as well as Markdown, and verify unaffected subtrees. Keep the checker test-side initially; do not add production validation or logging until it has demonstrated a clean false-positive record.
- **Real-click caret placement:** add `caret: {line, where, click: true}`, which clicks at the glyph boundary as `/tmp/repro-click.mjs` does. Today `placeCaret` uses `selection.collapse`, and in IR `where: 'start'` lands *before* the `**` marker, which no user click produces.
- **Boundary-position sweep:** add `caret: {line, where: 'start', sweep: true}`. It expands into one run per DOM position that renders at the visual line start (the `li` at 0, each wrapper at 0, the first text node at 0, the end of a leading marker span). It is generalized from `/tmp/repro-fuzz.mjs` and judged by the invariant oracle plus the row's `expect`.
- **Production parity:** stop hand-wiring listeners in `test/list-selection-delete.html`. Call the same `installListEditing(getVditor)` as `default.html` (see [Code Review](#code-review)). Run sheets in IR first, as production does. Add one sheet pass with Vditor's default `undoDelay`, or explain why 50 is equivalent.
- **Line-name helper:** `findLine` matches text including IR marker text, so the IR name for `**Cc** x` differs from the WYSIWYG name. Add separate visible-text and raw-marker targeting so one row can identify the same displayed line in both modes without losing the ability to test IR syntax editing.

### New Matrix Rows

Add a sheet, `test/list-joins.sheet.mjs`, built on `list-matrix.sheet.mjs`'s `group`/`markdown`/`removeOwn` helpers. Move the helpers to `test/support/outline.mjs` and import them from both sheets; don't copy them. Add model operations `joinUp(lines, text)` and `joinDown(lines, text)`, both `appendText` plus `removeOwn`, and `unwrapFirst(lines)`.

Matrix dimensions; prune combinations that are the same case:

- **Key:** Backspace at line start, Delete at line end.
- **Depth:** 0, 1, 2.
- **Position among siblings:** first, middle, last.
- **Neighbour:** the line above/below is a parent, a sibling, a deeper last-descendant, or absent (start or end of the document).
- **Own children:** none, or one child plus a grandchild.
- **Line start content:** plain, `**bold**`, `` `code` ``, `[link](x)`, task `[ ]`.
- **List type:** `-`, `1.`, task. Mixed task/plain lists are separate Vditor lists, so cover the boundary explicitly.
- **Caret:** synthetic and real-click; `sweep` on the plain and bold rows.

Also cover these single-dimension rows (≈30) not covered today:

- **Tab / Shift+Tab** on the first bullet of a list and on the first child; a numbered list renumbered at depth 2.
- **Enter at start / middle / end** of a line that has children, at every depth. Enter on an empty nested bullet should outdent.
- **Shift+Enter** inside a list line: a soft break, no new item.
- **Typing after a join:** type `x` after every join row. Many corruptions only appear when Vditor's input pipeline reparses on the *next* keystroke.
- **Key repeat:** Backspace ×2 and ×3 from the IR post-marker caret, and from line start.
- **Last line of the document** and **line before a heading/paragraph** for each key.
- **Brian's exact case:** the Help.md snippet from [Trigger](#trigger), with a real click before `C`, Backspace, then Backspace again.

Budget: roughly 1 s per row per mode. Keep each sheet under about 3 min. Keep the default suite complete. An optional smoke filter may shorten development feedback, but must not silently exclude regressions from the acceptance run.

### Live Plugin Probe

To close the gap between fixture and production, attach CDP to the real JCEF editor:

- In IDEA’s supported JCEF debugging configuration (verify the registry key for the installed IDE), set `ide.browser.jcef.debug.port` to a free port (not 9333, which the Canary sheets use). This needs an IDEA restart: **ask Brian first, never restart on your own.**
- `curl http://127.0.0.1:<port>/json` lists the editor page. Point `test/support/cdp.mjs` at it with a `CDP_TARGET=jcef` mode that reuses the open page instead of launching Canary.
- Work on a scratch copy such as `/tmp/list-probe.md`, never the user’s document. Replay Brian's sequence, then the sweep rows, using the invariant oracle as the judge.

## Code Review

Findings in `src/main/resources/vditor/list-*.js`, ordered by value:

- **Missing feature, not a missing patch:** a collapsed caret at a line boundary falls through to native contenteditable and Vditor's reparse. Every reproduced bug above is that one gap. Implement `joinLines(earlier, later, selection)` once in `list-lines.js`, reusing `removeLines`' child-reparenting. Call it from Backspace-at-start and Delete-at-end; don't write two handlers.
- **`fixListBackspace` is a grab bag (SRP):** one function holds four unrelated fixes: empty-item Delete, an empty paragraph between lists, whitespace after a nested list, and selection delete. Split it into named handlers with a small dispatcher (`for (const handler of HANDLERS) if (handler(event, context)) return`). Each handler returns true when it consumed the event and calls `preventDefault`, `stopImmediatePropagation` and `notifyEdit` in one place. The file comment describes only the original fix and should describe the dispatcher.
- **Duplicated wiring (DRY):** the five listener lines are copied verbatim between `template/default.html` and `test/list-selection-delete.html`. Add `installListEditing(getVditor)` and call it from both, or the tests will keep testing a page production doesn't run. That function also owns the `mouseup` triple-click tracker, which is currently registered as an import-time side effect in `list-lines.js`.
- **Blank-text regex repeated:** `/[\s\u200b]/g` appears five times across `list-backspace.js` and `list-lines.js`. Add `isBlank(text)` in `list-lines.js`.
- **Optional diagnostics, not a prerequisite:** after fixture and live-probe coverage is in place, consider running a validated invariant checker after list edits in a debug build. On a violation, log the keydown sequence, the caret path and the before/after DOM to a bounded ring buffer (`window.__listEditLog`). Keep diagnostics bounded, opt-in and local; document text may be sensitive. A toolbar export action is optional, not required for the fix. The next "horrible result" report then arrives with its own repro. Auto-undo on a violation is tempting, but don't add it until the checker has a clean false-positive record.
- **Vestigial export:** `module.exports = { fixListBackspace }` in `list-backspace.js`. No direct test import was found in the investigation. Verify all consumers before removing it; this cleanup is optional.
- **Undocumented build/test:** neither README nor CHANGELOG says how to run the browser sheets or build. Add a short "Development" section to README: `node test/list-suite.mjs`, the Node tests, and the build command below.

## Instructions for Sol6.1

Work in `~/src/idea-markdown-editor/` on branch `brian/markdown-ux`. It is Brian's personal toolchain repo: commit and push validated work each turn. Use merge, never rebase.

- **Read first:** this plan; `src/main/resources/vditor/list-*.js`; `test/support/*.mjs`; `test/list-*.sheet.mjs`.
- **Red:** do the [Harness Upgrades](#harness-upgrades), then add `list-joins.sheet.mjs` and the single-dimension rows. Confirm they fail on HEAD with the [Reproduced Bugs](#reproduced-bugs) symptoms, and record the failing-row count.
- **Green:** implement `joinLines` and the handler split from the [Code Review](#code-review). Keep every existing sheet green: `node test/list-suite.mjs`, `test/list-selection-delete` and the Node `*.test.cjs` tests.
- **Probe:** ask Brian for the IDEA restart needed by the [Live Plugin Probe](#live-plugin-probe). If he declines, skip it and say so in **Didn't**.
- **Unreproduced heading:** if the sweep or the live probe reproduces it, add the exact row and fix it. If not, report the heading as unreproduced and describe the remaining reproduction gap; optional debug instrumentation must not substitute for regression tests. Don't claim it is fixed.
- **Constraints:**
  - Chrome Canary only (the shared agent profile).
  - Never run sheets in parallel: they share the macOS clipboard.
  - Never edit the affected Markdown document for testing.
  - Every behaviour change needs both modes plus undo and redo, as the existing rows do.
  - Don't change IR marker editing without Brian's decision.
- **Build:** choose the next unused `pluginVersion` in `gradle.properties` (local.28 only if still available). No JDK 25 is installed, so build with IDEA's bundled runtime: `JAVA_HOME="/Applications/IntelliJ IDEA.app/Contents/jbr/Contents/Home" ./gradlew buildPlugin`. Deposit `~/Downloads/markdown-editor-2.0.7-local.28-YYYYMMDD.Dow.HHMM-list-joins.zip` using the actual build time, verify it contains the new scripts, then run `~/src/tools/prune-artifacts --apply`.
- **Install:** don't install. It requires an IDEA restart, which Brian approves.
- **Commits:** separate commits for the harness and tests, the fix, and the refactor or debug guard if they are independent. End each with the Powered-by signature from AgentRules. Push, and verify on origin.

## Done Criteria

- [ ] Every [Reproduced Bugs](#reproduced-bugs) row has a regression row that failed before the fix and passes after it, in both modes.
- [ ] The invariant oracle runs after every action, undo and redo in every sheet.
- [ ] `list-joins.sheet.mjs` exists, reuses the shared outline helpers, and passes.
- [ ] Production and the fixture share `installListEditing`.
- [ ] The setext heading is either reproduced and fixed, or explicitly reported as unreproduced with the remaining reproduction gap documented.
- [ ] README documents the test and build commands.
- [ ] The newly versioned ZIP is in Downloads and verified; commits are pushed to origin.

## Execution Handoff

Execute this plan in the editor repository, starting with red regressions for the reproduced boundary bugs. Strengthen the existing suite rather than replacing it. Preserve legitimate Markdown and IR marker editing, validate both rich modes with exact caret and undo/redo checks, and keep production changes focused on demonstrated failures. Run the complete serial browser suite and Node tests, build and verify the next-version ZIP in Downloads, commit and push the scoped changes, and report the screenshot’s heading separately if it remains unreproduced. Ask only when blocked or before installing/restarting the IDE.
