// Test sheet: cutting, copying and pasting hierarchical bullet lines.
//
// Each row: select something, cut or copy it, put the caret at the start or end
// of another line, paste, and compare the Markdown. Every row also undoes and
// redoes with real Cmd+Z and Cmd+Shift+Z. Run with: node test/list-editing.sheet.mjs [name filter]
//
// Judgment calls encoded here:
//  - Pasted lines become siblings of the target line, at the target's depth,
//    keeping their own relative indentation. They are never merged into its text.
//  - Pasting at the end of a line that has sub-bullets goes after its whole subtree.
//  - Selecting a parent's own line cuts only that line; its sub-bullets stay and
//    move up into its place.
//  - Pasted lists adopt the target list's type (bullet, numbered).
import {runSheet} from './support/sheet.mjs'

const md = (...lines) => lines.join('\n') + '\n'
const BASE = md(
  '- Alpha',
  '  - Alpha one',
  '  - Alpha two',
  '    - Alpha two deep',
  '- Bravo',
  '- Charlie',
  '  - Charlie one')
const without = (...drop) => BASE.split('\n').filter(line => !drop.includes(line)).join('\n')
const insert = (text, before, doc = BASE) => doc.replace(before, `${text}\n${before}`)
const after = (text, line, doc = BASE) => doc.replace(`${line}\n`, `${line}\n${text}\n`)

const rows = [
  // A single leaf line, pasted at each kind of target.
  {name: 'leaf cut, paste at start of top-level line', select: {triple: 'Alpha one'}, act: 'cut',
    at: {line: 'Bravo', where: 'start'},
    expect: insert('- Alpha one', '- Bravo', without('  - Alpha one'))},
  {name: 'leaf cut, paste at end of top-level line', select: {triple: 'Alpha one'}, act: 'cut',
    at: {line: 'Bravo', where: 'end'},
    expect: after('- Alpha one', '- Bravo', without('  - Alpha one'))},
  {name: 'leaf cut, paste at start of nested line', select: {triple: 'Alpha one'}, act: 'cut',
    at: {line: 'Charlie one', where: 'start'},
    expect: insert('  - Alpha one', '  - Charlie one', without('  - Alpha one'))},
  {name: 'leaf cut, paste at end of nested line', select: {triple: 'Alpha one'}, act: 'cut',
    at: {line: 'Charlie one', where: 'end'},
    expect: after('  - Alpha one', '  - Charlie one', without('  - Alpha one'))},
  {name: 'leaf cut, paste at start of deepest line', select: {triple: 'Alpha one'}, act: 'cut',
    at: {line: 'Alpha two deep', where: 'start'},
    expect: insert('    - Alpha one', '    - Alpha two deep', without('  - Alpha one'))},
  {name: 'leaf cut, paste at end of line with sub-bullets', select: {triple: 'Bravo'}, act: 'cut',
    at: {line: 'Alpha two', where: 'end'},
    expect: md('- Alpha', '  - Alpha one', '  - Alpha two', '    - Alpha two deep', '  - Bravo',
      '- Charlie', '  - Charlie one')},
  {name: 'leaf cut, paste at end of top-level parent', select: {triple: 'Alpha one'}, act: 'cut',
    at: {line: 'Alpha', where: 'end'},
    expect: md('- Alpha', '  - Alpha two', '    - Alpha two deep', '- Alpha one', '- Bravo', '- Charlie', '  - Charlie one')},

  // Depth changes: a line takes on the depth of where it lands.
  {name: 'deep leaf cut, paste at top level', select: {triple: 'Alpha two deep'}, act: 'cut',
    at: {line: 'Bravo', where: 'start'},
    expect: md('- Alpha', '  - Alpha one', '  - Alpha two', '- Alpha two deep', '- Bravo', '- Charlie', '  - Charlie one')},
  {name: 'only child cut leaves no empty list', select: {triple: 'Charlie one'}, act: 'cut',
    at: {line: 'Bravo', where: 'end'}, clip: '- Charlie one',
    afterCut: without('  - Charlie one'),
    expect: md('- Alpha', '  - Alpha one', '  - Alpha two', '    - Alpha two deep', '- Bravo', '- Charlie one', '- Charlie')},
  {name: 'last line of a list before a paragraph', doc: md('- First', '- Last', '', 'After'), select: {triple: 'Last'}, act: 'cut',
    at: {line: 'First', where: 'start'}, clip: '- Last', expect: md('- Last', '- First', '', 'After')},

  // Several lines keep their relative indentation.
  {name: 'drag-selected branch, paste at start of nested line', select: {lines: ['Alpha two', 'Bravo']}, act: 'cut',
    at: {line: 'Charlie one', where: 'start'},
    expect: md('- Alpha', '  - Alpha one', '- Charlie', '  - Alpha two', '    - Alpha two deep', '  - Bravo',
      '  - Charlie one')},
  {name: 'drag-selected branch, paste at end of parent with children', select: {lines: ['Alpha one', 'Alpha two deep']}, act: 'cut',
    at: {line: 'Charlie', where: 'end'},
    expect: md('- Alpha', '- Bravo', '- Charlie', '  - Charlie one', '- Alpha one', '- Alpha two', '  - Alpha two deep')},
  {name: 'copy keeps the original and pastes a duplicate', select: {triple: 'Bravo'}, act: 'copy',
    at: {line: 'Charlie one', where: 'end'}, clip: '- Bravo',
    expect: md('- Alpha', '  - Alpha one', '  - Alpha two', '    - Alpha two deep', '- Bravo', '- Charlie',
      '  - Charlie one', '  - Bravo')},
  {name: 'drag-selected branch copies as clean Markdown', select: {lines: ['Alpha two', 'Alpha two deep']}, act: 'copy',
    at: {line: 'Bravo', where: 'start'}, clip: '- Alpha two\n  - Alpha two deep',
    expect: insert('- Alpha two\n  - Alpha two deep', '- Bravo')},

  // A parent's own line: only that line is cut; its sub-bullets stay.
  {name: 'parent line cut keeps its sub-bullets', select: {triple: 'Alpha two'}, act: 'cut',
    at: {line: 'Bravo', where: 'start'}, clip: '- Alpha two',
    afterCut: md('- Alpha', '  - Alpha one', '  - Alpha two deep', '- Bravo', '- Charlie', '  - Charlie one'),
    expect: md('- Alpha', '  - Alpha one', '  - Alpha two deep', '- Alpha two', '- Bravo', '- Charlie', '  - Charlie one')},
  {name: 'top-level parent line cut promotes its sub-bullets', select: {triple: 'Alpha'}, act: 'cut',
    at: {line: 'Charlie one', where: 'end'},
    expect: md('- Alpha one', '- Alpha two', '  - Alpha two deep', '- Bravo', '- Charlie', '  - Charlie one', '  - Alpha')},

  // Text that did not come from this editor.
  {name: 'external bullets with a child, paste at start', clipboard: '- Xray\n  - Yankee', doc: BASE,
    at: {line: 'Bravo', where: 'start'}, expect: insert('- Xray\n  - Yankee', '- Bravo')},
  {name: 'external bullets with a child, paste at end', clipboard: '- Xray\n  - Yankee', doc: BASE,
    at: {line: 'Charlie one', where: 'end'}, expect: after('  - Xray\n    - Yankee', '  - Charlie one')},
  {name: 'external numbered lines become bullets in a bullet list', clipboard: '1. First\n2. Second', doc: BASE,
    at: {line: 'Bravo', where: 'end'}, expect: after('- First\n- Second', '- Bravo')},

  // Other list types.
  {name: 'numbered lines keep numbering', doc: md('1. One', '2. Two', '3. Three'), select: {triple: 'Two'}, act: 'cut',
    at: {line: 'Three', where: 'end'}, expect: md('1. One', '2. Three', '3. Two')},
  {name: 'task item keeps its checkbox', doc: md('- [ ] Task A', '- [x] Task B', '- [ ] Task C'), select: {triple: 'Task C'}, act: 'cut',
    at: {line: 'Task A', where: 'end'}, clip: '- [ ]  Task C',
    expect: md('- [ ]  Task A', '- [ ]  Task C', '- [X]  Task B')},

  // Selections inside a line stay ordinary text edits.
  {name: 'a word cut and pasted stays inline', doc: md('- Delta echo foxtrot', '- Golf'),
    select: {word: ['Delta echo foxtrot', 'echo']}, act: 'cut', at: {line: 'Golf', where: 'start'}, clip: 'echo',
    expect: md('- Delta  foxtrot', '- echoGolf')}
]

for (const row of rows) row.doc ??= BASE
await runSheet({title: 'Hierarchical bullet cut/copy/paste', rows})
