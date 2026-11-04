// Runs scenario rows against the real Vditor fixture in Chrome Canary, using real
// mouse, keyboard and system-clipboard input: select, cut or copy, place the caret,
// paste, then undo and redo through the same shortcuts a user presses.
import {execFileSync} from 'node:child_process'
import {launch, serve} from './cdp.mjs'

const pause = ms => new Promise(resolve => setTimeout(resolve, ms))
const clipboardText = () => execFileSync('pbpaste', {encoding: 'utf8'})
const setClipboard = text => execFileSync('pbcopy', {input: text})

// Page-side helpers. A line's text is its own content, without nested lists.
const PAGE_HELPERS = `
window.ownText = li => {
  const walker = document.createTreeWalker(li, NodeFilter.SHOW_TEXT)
  const nodes = []
  while (walker.nextNode()) {
    const node = walker.currentNode
    if (node.parentElement.closest('li') === li && node.data.replace(/\\u200b/g, '')) nodes.push(node)
  }
  return nodes
}
window.findLine = (mode, text, nth = 0) => [...editor.vditor[mode].element.querySelectorAll('li')]
  .filter(li => ownText(li).map(node => node.data).join('').trim() === text)[nth]
window.lineBox = (mode, text, nth = 0) => {
  const nodes = ownText(findLine(mode, text, nth))
  const box = node => { const range = document.createRange(); range.selectNodeContents(node); return range.getBoundingClientRect() }
  const first = box(nodes[0]), last = box(nodes[nodes.length - 1])
  return {left: first.left, right: last.right, y: first.top + first.height / 2}
}
// The WYSIWYG popover floats over the line below the caret, so a click there hits
// its buttons; placing the caret directly sidesteps that without changing the paste.
window.placeCaret = (mode, text, where, nth = 0) => {
  const nodes = ownText(findLine(mode, text, nth))
  const node = where === 'start' ? nodes[0] : nodes[nodes.length - 1]
  editor.vditor[mode].element.focus()
  getSelection().collapse(node, where === 'start' ? 0 : node.length)
}
window.selectWord = (mode, line, word) => {
  const node = ownText(findLine(mode, line))[0]
  const start = node.data.indexOf(word)
  getSelection().setBaseAndExtent(node, start, node, start + word.length)
}
`

export async function runSheet({title, rows, modes = process.env.MODE ? [process.env.MODE] : ['ir', 'wysiwyg'], only = process.argv[2]}) {
  const savedClipboard = clipboardText()
  const server = await serve(new URL('../..', import.meta.url).pathname)
  const browser = await launch()
  const page = await browser.open(`${server.origin}/test/list-selection-delete.html`)
  const failures = []
  let passed = 0
  try {
    await page.waitFor('window.ready === true')
    await page.evaluate(PAGE_HELPERS)
    for (const mode of modes) {
      await page.evaluate(`document.querySelector('button[data-mode="${mode}"]').click()`)
      for (const row of rows.filter(item => !only || item.name.includes(only))) {
        const label = `${mode}: ${row.name}`
        try {
          await runRow(page, mode, row)
          passed++
          console.log(`  ok   ${label}`)
        } catch (error) {
          failures.push({label, message: error.message})
          console.log(`  FAIL ${label}`)
        }
      }
    }
  } finally {
    setClipboard(savedClipboard)
    await page.close().catch(() => {})
    await browser.close()
    server.close()
  }
  console.log(`\n${title}: ${passed} passed, ${failures.length} failed`)
  for (const {label, message} of failures) console.log(`\n--- ${label}\n${message}`)
  process.exit(failures.length ? 1 : 0)
}

const SHORTCUT_ACTS = new Set(['cut', 'copy', 'paste', 'undo', 'redo'])

// Row fields: `select` ({triple}, {lines: [first, last]} or {word: [line, word]}) or
// `caret` ({line, where}) to start from; `act`, one shortcut or key (or a list);
// `at` for a paste target; `clipboard` to preload text; `clip`, `afterCut` and
// `expect` for the clipboard, the document after `act`, and the final document.
async function runRow(page, mode, row) {
  const settle = () => pause(250)
  const markdown = () => page.evaluate('editor.getValue()')
  // Vditor spaces a task marker's text differently in each mode.
  const squeeze = text => text.replace(/(\[[ xX]\]) +/g, '$1 ')
  const expectEqual = (actual, expected, what) => {
    if (squeeze(actual) !== squeeze(expected)) throw new Error(`${what}\n  expected: ${JSON.stringify(expected)}\n  actual:   ${JSON.stringify(actual)}`)
  }
  const place = ({line, where, nth = 0}) => page.evaluate(`placeCaret('${mode}', ${JSON.stringify(line)}, '${where}', ${nth})`)
  // Start each row clean: no selection, no focus, no popover floating over a line.
  await page.evaluate(`editor.setValue(${JSON.stringify(row.doc)}); getSelection().removeAllRanges(); document.activeElement.blur()
    for (const popover of document.querySelectorAll('.vditor-panel')) popover.style.display = 'none'`)
  await settle()
  const original = await markdown()
  const box = (line, nth = 0) => page.evaluate(`lineBox('${mode}', ${JSON.stringify(line)}, ${nth})`)
  let steps = 0
  if (row.select) {
    const {triple, lines, word} = row.select
    if (triple) {
      const {left, right, y} = await box(triple)
      await page.click((left + right) / 2, y, 3)
    } else if (lines) {
      const first = await box(lines[0]), last = await box(lines[1])
      await page.drag({x: first.left + 0.5, y: first.y}, {x: last.right + 3, y: last.y})
    } else await page.evaluate(`selectWord('${mode}', ${JSON.stringify(word[0])}, ${JSON.stringify(word[1])})`)
  } else if (row.caret) await place(row.caret)
  else if (row.clipboard !== undefined) setClipboard(row.clipboard)
  for (const act of [].concat(row.act ?? [])) {
    if (SHORTCUT_ACTS.has(act)) await page.shortcut(act)
    else if (act.startsWith('Shift+')) await page.key(act.slice(6), 8)
    else await page.key(act)
    await settle()
    if (act !== 'copy') steps++
  }
  if (row.clip !== undefined) expectEqual(clipboardText(), row.clip, 'clipboard')
  if (row.afterCut !== undefined) expectEqual(await markdown(), row.afterCut, 'document after the first action')
  if (row.at) {
    await place(row.at)
    await pause(120)
    await page.shortcut('paste')
    await settle()
    steps++
  }
  expectEqual(await markdown(), row.expect, 'final document')
  for (let step = 0; step < steps; step++) { await page.shortcut('undo'); await settle() }
  expectEqual(await markdown(), original, `document after ${steps} undo`)
  for (let step = 0; step < steps; step++) { await page.shortcut('redo'); await settle() }
  expectEqual(await markdown(), row.expect, `document after ${steps} redo`)
}
