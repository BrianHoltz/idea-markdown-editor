// Deterministic editing matrix. Expectations come from a flat outline model, not
// from Vditor's serialization. Run serially with the other clipboard sheets.
import {runSheet} from './support/sheet.mjs'

import {line, markdown, group, removeOwn, insert} from './support/outline.mjs'
const rows = []
for (const sourceDepth of [0, 1, 2]) for (const targetDepth of [0, 1, 2])
  for (const parent of [false, true]) for (const act of ['cut', 'copy']) for (const where of ['start', 'end']) {
    const position = ['first', 'middle', 'last'][(sourceDepth + targetDepth + Number(parent)) % 3]
    const source = group('Source', sourceDepth, position, parent)
    const target = group('Target', targetDepth, position, true)
    const original = [...source, ...target, line(0, 'Tail')]
    const after = act === 'cut' ? removeOwn(original, 'Source') : original
    rows.push({name: `${act} ${parent ? 'parent own line' : 'leaf'} depth ${sourceDepth} to ${targetDepth} ${where} ${position}`,
      doc: markdown(original), select: {triple: 'Source'}, act, clip: '- Source',
      afterCut: markdown(after), at: {line: 'Target', where}, expect: markdown(insert(after, 'Target', [line(0, 'Source')], where))})
  }
for (const depth of [0, 1, 2]) for (const position of ['first', 'middle', 'last'])
  for (const parent of [false, true]) for (const act of ['Backspace', 'Delete']) {
    const original = [...group('Selected', depth, position, parent), line(0, 'Tail')]
    rows.push({name: `${act} selected ${parent ? 'parent' : 'leaf'} depth ${depth} ${position}`,
      doc: markdown(original), select: {triple: 'Selected'}, act, expect: markdown(removeOwn(original, 'Selected'))})
  }
for (const depth of [0, 1, 2]) for (const position of ['first', 'middle', 'last']) for (const where of ['start', 'end'])
  for (const payload of [[line(0, 'Pasted')], [line(0, 'Pasted'), line(0, 'Second')], [line(0, 'Pasted'), line(1, 'Child')]]) {
    const original = [...group('Target', depth, position, true), line(0, 'Tail')]
    rows.push({name: `external ${payload.length === 1 ? 'leaf' : payload[1].depth ? 'branch' : 'siblings'} to depth ${depth} ${position} ${where}`,
      doc: markdown(original), clipboard: markdown(payload), at: {line: 'Target', where},
      expect: markdown(insert(original, 'Target', payload, where))})
  }
for (const depth of [0, 1, 2]) for (const position of ['first', 'middle', 'last']) for (const where of ['start', 'end']) {
  const original = [...group('Target', depth, position, false), line(0, 'Tail')]
  rows.push({name: `Enter adds sibling depth ${depth} ${position} ${where}`, doc: markdown(original),
    caret: {line: 'Target', where}, act: ['Enter', ...(where === 'start' ? [{caret: {line: '', where: 'start'}}] : []), {text: 'Added'}],
    expect: markdown(where === 'start'
      ? insert(original, 'Target', [line(0, 'Added')], 'start')
      : insert(original, 'Target', [line(0, 'Added')], 'end'))})
}
await runSheet({title: 'Nested outline combination matrix', rows})
