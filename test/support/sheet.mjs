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
window.listInvariants = (root, md) => ({
  heading: root.querySelectorAll('li h1, li h2, li h3, li h4, li h5, li h6').length,
  listOnly: [...root.querySelectorAll('li')].filter(li => li.querySelector(':scope > ul, :scope > ol') &&
    !ownText(li).some(node => node.data.trim()) && !li.querySelector(':scope > input, :scope > p input')).length,
  literalMarker: [...root.querySelectorAll('p')].filter(p => /^[-*+] /.test(p.textContent)).length,
  tripleBlank: (md.match(/\\n\\n\\n/g) || []).length,
  bareDash: (md.match(/^ *- *$/gm) || []).length
})
window.boundaryPositions = (mode, text) => {
  const item = findLine(mode, text)
  const nodes = []
  const first = ownText(item)[0]
  let wrapper = first
  while (wrapper && wrapper !== item) { nodes.push([wrapper, 0]); wrapper = wrapper.parentNode }
  nodes.push([item, 0])
  if (first?.parentElement.matches('.vditor-ir__marker')) nodes.push([first, first.length])
  return nodes
}
window.placeBoundary = (mode, text, index) => {
  editor.vditor[mode].element.focus()
  getSelection().collapse(...boundaryPositions(mode, text)[index])
}

window.ownText = li => {
  const walker = document.createTreeWalker(li, NodeFilter.SHOW_TEXT)
  const nodes = []
  while (walker.nextNode()) {
    const node = walker.currentNode
    if (node.parentElement.closest('li') === li && node.data.replace(/\\u200b/g, '')) nodes.push(node)
  }
  return nodes
}
window.visibleText = li => ownText(li).filter(node => !node.parentElement.closest('.vditor-ir__marker'))
  .map(node => node.data).join('').replace(/\\u200b/g, '').trim()
window.findLine = (mode, text, nth = 0) => [...editor.vditor[mode].element.querySelectorAll('li')]
  .filter(li => visibleText(li) === text || ownText(li).map(node => node.data).join('').replace(/\\u200b/g, '').trim() === text)[nth]
window.lineBox = (mode, text, nth = 0) => {
  const nodes = ownText(findLine(mode, text, nth)).filter(node => !node.parentElement.closest('.vditor-ir__marker'))
  const box = node => { const range = document.createRange(); range.selectNodeContents(node); return range.getBoundingClientRect() }
  const first = box(nodes[0]), last = box(nodes[nodes.length - 1])
  return {left: first.left, right: last.right, y: first.top + first.height / 2}
}
// The WYSIWYG popover floats over the line below the caret, so a click there hits
// its buttons; placing the caret directly sidesteps that without changing the paste.
window.placeCaret = (mode, text, where, nth = 0) => {
  const item = findLine(mode, text, nth)
  if (!item) throw new Error('Missing list line: ' + text)
  const nodes = ownText(item)
  const node = (where === 'start' ? nodes[0] : nodes[nodes.length - 1]) || item
  editor.vditor[mode].element.focus()
  getSelection().collapse(node, where === 'start' || node === item ? 0 : node.length)
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
  const page = await browser.open(`${server.origin}/test/list-selection-delete.html${process.env.DEFAULT_UNDO ? '?defaultUndo' : ''}`)
  const failures = []
  let passed = 0
  try {
    await page.waitFor('window.ready === true')
    await page.evaluate(PAGE_HELPERS)
    for (const mode of modes) {
      await page.evaluate(`document.querySelector('button[data-mode="${mode}"]').click()`)
      for (const row of rows.filter(item => (!only || item.name.includes(only)) && (!item.modes || item.modes.includes(mode)))) {
        const label = `${mode}: ${row.name}`
        try {
          if (row.caret?.sweep) {
            await page.evaluate(`editor.setValue(${JSON.stringify(row.doc)})`)
            await pause(150)
            const count = await page.evaluate(`boundaryPositions('${mode}', ${JSON.stringify(row.caret.line)}).length`)
            for (let boundary = 0; boundary < count; boundary++) {
              await page.evaluate(`editor.setValue(${JSON.stringify(row.doc)})`)
              await pause(150)
              const marker = await page.evaluate(`(() => { const [node, offset] = boundaryPositions('${mode}', ${JSON.stringify(row.caret.line)})[${boundary}]; return offset > 0 && node.parentElement?.matches('.vditor-ir__marker') })()`)
              if (marker) continue // Marker editing has explicit native-edit rows, not join expectations.
              await runRow(page, mode, {...row, caret: {...row.caret, boundary}})
            }
          } else await runRow(page, mode, row)
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
  const expected = typeof row.expect === 'object'
    ? (Array.isArray(row.expect[mode]) ? row.expect[mode][row.act.length - 1] : row.expect[mode]) : row.expect
  const settle = () => pause(process.env.DEFAULT_UNDO ? 850 : 150)
  const markdown = () => page.evaluate('editor.getValue()')
  // Vditor spaces a task marker's text differently in each mode.
  const squeeze = text => text.replace(/(\[[ xX]\]) +/g, '$1 ').replace(/^( *)[*+]([ \n]|$)/gm, '$1-$2')
  const expectEqual = (actual, expected, what) => {
    if (squeeze(actual) !== squeeze(expected)) throw new Error(`${what}\n  expected: ${JSON.stringify(expected)}\n  actual:   ${JSON.stringify(actual)}`)
  }
  const place = async ({line, where, nth = 0, click = false, boundary}) => {
    if (click) {
      await page.evaluate(`document.querySelectorAll('.vditor-panel').forEach(panel => panel.style.display = 'none')`)
      const box = await page.evaluate(`lineBox('${mode}', ${JSON.stringify(line)}, ${nth})`)
      await page.click(where === 'start' ? box.left + 0.5 : box.right - 0.5, box.y)
    } else if (boundary !== undefined) {
      await page.evaluate(`placeBoundary('${mode}', ${JSON.stringify(line)}, ${boundary})`)
    } else await page.evaluate(`placeCaret('${mode}', ${JSON.stringify(line)}, '${where}', ${nth})`)
  }
  // Start each row clean: no selection, no focus, no popover floating over a line.
  await page.evaluate(`editor.setValue(${JSON.stringify(row.doc)}); getSelection().removeAllRanges(); document.activeElement.blur()
    for (const popover of document.querySelectorAll('.vditor-panel')) popover.style.display = 'none'`)
  await settle()
  if (row.setup) {
    if (row.setup.empty) {
      await place({line: row.setup.empty, where: 'start'})
      await page.evaluate(`selectWord('${mode}', ${JSON.stringify(row.setup.empty)}, ${JSON.stringify(row.setup.empty)})`)
    } else await place(row.setup.caret)
    for (const key of row.setup.keys) { await page.key(key); await settle() }
  }
  const original = await markdown()
  const invariant = async (intermediate = false) => {
    const found = await page.evaluate(`listInvariants(editor.vditor['${mode}'].element, editor.getValue())`)
    for (const [name, count] of Object.entries(found)) {
      if (!(intermediate && ['bareDash', 'listOnly'].includes(name)) && count > (baseline[name] || 0) && !row.allow?.includes(name) &&
          !(name === 'bareDash' && /^ *- *$/m.test(expected)) &&
          !(name === 'tripleBlank' && (expected.includes('\n\n\n') || /^ *[-*+] *$/m.test(original) || original.includes('\n\n')))) throw new Error('Invariant: ' + name)
    }
  }
  // Lists identified by their own complete text survive unchanged operations.
  const tightSnapshot = await page.evaluate(`(() => [...editor.vditor['${mode}'].element.querySelectorAll('ul, ol')].map(list => ({
    text: list.textContent, tight: list.getAttribute('data-tight')
  })))()`)
  const baseline = await page.evaluate(`listInvariants(editor.vditor['${mode}'].element, editor.getValue())`)
  const box = (line, nth = 0) => page.evaluate(`lineBox('${mode}', ${JSON.stringify(line)}, ${nth})`)
  // Compare semantic structure too: an empty paragraph/list split may serialize
  // to the same Markdown but must still be restored by undo.
  const structure = () => page.evaluate(`(() => {
    const root = editor.vditor['${mode}'].element.cloneNode(true)
    root.normalize()
    const visit = node => {
      if (node.nodeType === 3) return node.data.trim() ? '#text' : null
      if (node.nodeType !== 1 || node.matches('wbr, .vditor-ir__marker, .vditor-ir__preview')) return null
      return [node.tagName, ...Array.from(node.childNodes).map(visit).filter(Boolean)]
    }
    return JSON.stringify(Array.from(root.childNodes).map(visit).filter(Boolean))
  })()`)
  const history = [{markdown: original, structure: await structure()}]
  let beforeAction
  const dom = () => page.evaluate(`(() => { const copy = editor.vditor['${mode}'].element.cloneNode(true); copy.querySelectorAll('wbr').forEach(node => node.remove()); return copy.innerHTML })()`)
  const record = async () => {
    // Empty paragraphs can change DOM/history without changing Markdown.
    if (await dom() !== beforeAction) history.push({markdown: await markdown(), structure: await structure()})
  }
  if (row.clipboard !== undefined) setClipboard(row.clipboard)
  if (row.select) {
    const {triple, lines, word} = row.select
    if (triple) {
      const {left, right, y} = await box(triple)
      await page.click((left + right) / 2, y, 3)
    } else if (lines) {
      const first = await box(lines[0]), last = await box(lines[1])
      await page.drag({x: first.left + 0.5, y: first.y}, {x: last.right + 3, y: last.y})
    } else {
      await page.evaluate(`editor.vditor['${mode}'].element.focus()`)
      await page.evaluate(`selectWord('${mode}', ${JSON.stringify(word[0])}, ${JSON.stringify(word[1])})`)
    }
  } else if (row.caret) await place(row.caret)
  let actionIndex = 0
  for (const act of [].concat(row.act ?? [])) {
    beforeAction = await dom()
    if (act.text !== undefined) await page.session.send('Input.insertText', {text: act.text})
    else if (act.caret) { await place(act.caret); continue }
    else if (SHORTCUT_ACTS.has(act)) await page.shortcut(act)
    else if (act.startsWith('Shift+')) await page.key(act.slice(6), 8)
    else await page.key(act)
    await settle()
    await record(); await invariant(true)
    if (row.states) expectEqual(await markdown(), row.states[actionIndex++], 'document after action')
  }
  if (row.clip !== undefined) expectEqual(clipboardText(), row.clip, 'clipboard')
  if (row.afterCut !== undefined) expectEqual(await markdown(), row.afterCut, 'document after the first action')
  if (row.at) {
    await place(row.at)
    await pause(120)
    beforeAction = await dom()
    await page.shortcut('paste')
    await settle()
    await record(); await invariant(true)
  }
  await invariant()
  const untouched = await page.evaluate(`(() => [...editor.vditor['${mode}'].element.querySelectorAll('ul, ol')].map(list => ({
    text: list.textContent, tight: list.getAttribute('data-tight')
  })))()`)
  for (const list of tightSnapshot) {
    const survivor = untouched.find(other => other.text === list.text)
    if (survivor && survivor.tight !== list.tight) throw new Error('Untouched list tightness changed')
  }
  expectEqual(await markdown(), expected, 'final document')
  for (let step = history.length - 2; step >= 0; step--) {
    await page.shortcut('undo'); await settle()
    await invariant(true)
    expectEqual(await markdown(), history[step].markdown, 'undo intermediate state')
    expectEqual(await structure(), history[step].structure, 'undo list structure')
  }
  for (let step = 1; step < history.length; step++) {
    await page.shortcut('redo'); await settle()
    await invariant(true)
    expectEqual(await markdown(), history[step].markdown, 'redo intermediate state')
    expectEqual(await structure(), history[step].structure, 'redo list structure')
  }
}
