import {runSheet} from './support/sheet.mjs'
const md = (...lines) => lines.join('\n') + '\n'
const rows = []
// The reported sequence: exit an empty bullet, then join back into the list.
for (const children of [false, true]) for (const position of ['first', 'middle', 'last']) {
  const lines = ['- Before', '- Parent', ...(children ? ['  - Child', '  - Other'] : []), '- After']
  const index = position === 'first' ? 0 : position === 'middle' ? 1 : lines.length
  const doc = md(...lines.slice(0, index), '-', ...lines.slice(index))
  if (position !== 'first') rows.push({name: `empty ${position}, children ${children}, Backspace twice`, doc,
    caret: {line: '', where: 'start'}, act: ['Backspace', 'Backspace'], expect: md(...lines)})
  rows.push({name: `empty ${position}, children ${children}, forward Delete`, doc,
    caret: {line: '', where: 'start'}, act: 'Delete', expect: md(...lines)})
}
for (const depth of [1, 2]) for (const position of ['first', 'middle', 'last']) {
  const prefix = ['- Root', ...(depth === 2 ? ['  - Branch'] : [])]
  const indent = '  '.repeat(depth)
  const children = [`${indent}* Before`, `${indent}* After`]
  const index = position === 'first' ? 0 : position === 'middle' ? 1 : 2
  const lines = [...prefix, ...children.slice(0, index), `${indent}*`, ...children.slice(index), '- Tail']
  rows.push({name: `empty depth ${depth} ${position}, forward Delete`,
    doc: md(...(position === 'first' ? lines.map(line => line === `${indent}*` ? `${indent}* Blank` : line) : lines)),
    setup: position === 'first' ? {empty: 'Blank', keys: ['Backspace']} : undefined, caret: {line: '', where: 'start'},
    act: 'Delete', expect: md(...lines.filter(line => line !== `${indent}*`))})
}
// Preserve deliberate loose lists, and check the caret by continuing to type.
for (const marker of ['-', '*', '+']) {
  rows.push({name: `loose ${marker} paragraph join keeps spacing`,
    doc: md(`${marker} Before`, '', `${marker}`, '', `${marker} After`, '  - Child'),
    caret: {line: '', where: 'start'}, act: ['Backspace', 'Backspace', {text: '!'}],
    expect: md(`${marker} Before!`, `${marker} After`, '', '  - Child')})
  rows.push({name: `tight ${marker} paragraph join then type`,
    doc: md(`${marker} Before`, `${marker}`, `${marker} After`, '  - Child'),
    caret: {line: '', where: 'start'}, act: ['Backspace', 'Backspace', {text: '!'}],
    expect: md(`${marker} Before!`, `${marker} After`, '  - Child')})
}
await runSheet({title: 'Empty list boundaries', rows})
