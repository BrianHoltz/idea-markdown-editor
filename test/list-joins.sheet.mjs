// Boundary joins use the same remove-own-line outline semantics as cut/delete.
import {runSheet} from './support/sheet.mjs'
import {line, markdown, group, joinUp, joinDown, unwrapFirst} from './support/outline.mjs'
const rows = []
for (const depth of [0, 1, 2]) for (const position of ['first', 'middle', 'last'])
  for (const children of [false, true]) for (const key of ['Backspace', 'Delete']) {
    const original = [...group('Target', depth, position, children), line(0, 'Tail')]
    const index = original.findIndex(row => row.text === 'Target')
    if (!index && key === 'Backspace') continue
    const after = key === 'Backspace' ? joinUp(original, 'Target') : joinDown(original, 'Target')
    const joinedIndex = key === 'Backspace' ? index - 1 : index
    // Insertion belongs at the join point, not at the end of the merged text.
    const typed = after.map(row => ({...row}))
    const earlier = original[joinedIndex].text
    typed[joinedIndex].text = earlier + 'x' + original[joinedIndex + 1].text
    rows.push({name: `${key} depth ${depth} ${position} children ${children}`, doc: markdown(original),
      caret: {line: 'Target', where: key === 'Backspace' ? 'start' : 'end'},
      act: [key, {text: 'x'}], states: [markdown(after), markdown(typed)], expect: markdown(typed)})
  }
const branch = [line(0, 'Alpha'), line(1, 'Alpha one'), line(1, 'Alpha two'), line(0, 'Bravo'), line(1, 'Bravo one')]
for (const target of ['Alpha one', 'Bravo']) for (const click of [false, true]) {
  rows.push({name: `reported Backspace ${target} click ${click}`, doc: markdown(branch),
    caret: {line: target, where: 'start', click, sweep: !click}, act: 'Backspace', expect: markdown(joinUp(branch, target))})
}
rows.push({name: 'reported Delete last child into branch', doc: markdown(branch),
  caret: {line: 'Alpha two', where: 'end'}, act: 'Delete', expect: markdown(joinDown(branch, 'Alpha two'))})
rows.push({name: 'unwrap first parent keeps descendants and siblings tight', doc: markdown(branch),
  caret: {line: 'Alpha', where: 'start'}, act: 'Backspace', expect: unwrapFirst(branch)})
for (const [syntax, visible] of [['**Bold**', 'Bold'], ['`Code`', 'Code'], ['[Link](x)', 'Link']]) {
  for (const click of [false, true]) {
    // Real IR clicks land after the opening marker: intentionally native editing.
    rows.push({name: `formatted ${visible} start click ${click}`, modes: click ? ['wysiwyg'] : undefined,
      doc: `- Parent\n  - ${syntax} text\n  - Sibling\n`, caret: {line: `${visible} text`, where: 'start', click, sweep: !click},
      act: 'Backspace', expect: {ir: `- Parent${syntax} text\n  - Sibling\n`,
        wysiwyg: `- Parent${visible === 'Code' ? ' ' : ''}${syntax} text\n  - Sibling\n`}})
  }
}
for (const marker of ['1.', '- [ ]']) for (const key of ['Backspace', 'Delete']) {
  const ordered = marker === '1.'
  rows.push({name: `${ordered ? 'ordered' : 'task'} ${key} boundary`,
    doc: ordered ? '1. Parent\n   1. Child\n   2. Next\n2. Tail\n' : '- [ ] Parent\n  - [ ] Child\n  - [ ] Next\n- [ ] Tail\n',
    caret: {line: key === 'Backspace' ? 'Child' : 'Parent', where: key === 'Backspace' ? 'start' : 'end'},
    act: [key, {text: 'x'}],
    expect: ordered ? '1. ParentxChild\n   1. Next\n2. Tail\n' : '- [ ] ParentxChild\n  - [ ] Next\n- [ ] Tail\n'})
}
rows.push({name: 'mixed plain task boundary', doc: '- Plain\n- [ ] Task\n- End\n',
  caret: {line: 'Task', where: 'start'}, act: 'Backspace', expect: '- PlainTask\n- End\n'})
rows.push({name: 'Delete at document end does nothing', doc: '- Last\n',
  caret: {line: 'Last', where: 'end'}, act: 'Delete', expect: '- Last\n'})
rows.push({name: 'Delete before paragraph', doc: '- Last\n\nParagraph\n',
  caret: {line: 'Last', where: 'end'}, act: ['Delete', {text: 'x'}], expect: '- LastxParagraph\n'})
rows.push({name: 'Delete before heading preserves heading', doc: '- Last\n\n## Heading\n',
  caret: {line: 'Last', where: 'end'}, act: 'Delete', expect: '- Last\n\n## Heading\n'})

// Ordinary editing dimensions not covered by the cut/paste outline matrix.
for (const depth of [0, 1, 2]) {
  const prefix = [line(0, 'Root'), line(1, 'Branch')].slice(0, depth)
  const pad = '  '.repeat(depth)
  const doc = markdown([...prefix, line(depth, 'Parent'), line(depth + 1, 'Child'), line(depth, 'After')])
  rows.push({name: `Enter middle parent depth ${depth}`, doc,
    caret: {line: 'Parent', where: 'start'}, act: ['ArrowRight', 'ArrowRight', 'ArrowRight', 'Enter', {text: 'x'}],
    expect: markdown([...prefix, line(depth, 'Par'), line(depth, 'xent'), line(depth + 1, 'Child'), line(depth, 'After')])})
  rows.push({name: `Shift Enter soft break depth ${depth}`, doc,
    caret: {line: 'Parent', where: 'end'}, act: ['Shift+Enter', {text: 'x'}],
    expect: markdown(prefix) .replace(/^\n$/, '') + `${pad}- Parent\n${pad}  x\n${pad}  - Child\n${pad}- After\n`})
}
for (const key of ['Tab', 'Shift+Tab']) {
  rows.push({name: `${key} first top-level bullet`, doc: '- First\n  - Child\n- Second\n',
    caret: {line: 'First', where: 'start'}, act: key,
    expect: '- First\n  - Child\n- Second\n'})
  rows.push({name: `${key} first child`, doc: '- Parent\n  - First\n  - Second\n- Tail\n',
    caret: {line: 'First', where: 'start'}, act: key,
    expect: key === 'Tab' ? '- Parent\n  - First\n  - Second\n- Tail\n' : '- Parent\n- First\n  - Second\n- Tail\n'})
}
rows.push({name: 'ordered renumbering depth two', doc: '1. Root\n   1. Branch\n      1. First\n      2. Second\n      3. Third\n2. Tail\n',
  caret: {line: 'Second', where: 'end'}, act: 'Shift+Tab',
  expect: '1. Root\n   1. Branch\n      1. First\n   2. Second\n      1. Third\n2. Tail\n'})
const help = '- **Filter titles:** Enter >1 character to filter loaded conversations by title.\n  - **Cc** enables case sensitivity; **!** negates the filter.\n'
for (const count of [1, 2, 3]) rows.push({name: `Help real click Backspace repeat ${count}`, doc: help,
  caret: {line: 'Cc enables case sensitivity; ! negates the filter.', where: 'start', click: true},
  act: Array(count).fill('Backspace'),
  // IR post-marker clicks preserve native syntax deletion, not a boundary join.
  expect: {
    ir: [help.replace('**Cc**', '*Cc**'), help.replace('**Cc**', 'Cc**'), help.replace('**Cc**', 'Cc**').replace('\n  - ', '')],
    wysiwyg: [help.replace('\n  - ', ''), help.replace('title.\n  - ', 'title'), help.replace('title.\n  - ', 'titl')]
  }})

for (const [syntax, visible] of [['**Bold**', 'Bold'], ['`Code`', 'Code'], ['[Link](x)', 'Link']]) {
  rows.push({name: `Delete formatted child ${visible} then type`,
    doc: `- Parent\n  - ${syntax} text\n  - Sibling\n`, caret: {line: 'Parent', where: 'end'},
    act: ['Delete', {text: 'x'}], expect: `- Parentx${syntax} text\n  - Sibling\n`})
}
for (const count of [2, 3]) rows.push({name: `Backspace repeat from plain start ${count}`, doc: markdown(branch),
  caret: {line: 'Bravo', where: 'start'}, act: Array(count).fill('Backspace'),
  expect: markdown(joinUp(branch, 'Bravo')).replace('Alpha twoBravo', `Alpha ${count === 2 ? 'tw' : 't'}Bravo`)})
rows.push({name: 'Enter empty nested bullet outdents', doc: '- Parent\n  - Before\n  - Blank\n- Tail\n',
  setup: {empty: 'Blank', keys: ['Backspace']}, caret: {line: '', where: 'start'}, act: ['Enter', {text: 'Added'}],
  expect: '- Parent\n  - Before\n- Added\n- Tail\n'})

await runSheet({title: 'Collapsed list boundary joins', rows})
