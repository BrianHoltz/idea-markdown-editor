// Test sheet: keyboard editing of hierarchical bullet lines.
//
// Same row format as list-editing.sheet.mjs. Every row also undoes and redoes with
// real Cmd+Z and Cmd+Shift+Z. Run with: node test/list-keys.sheet.mjs [name filter]
//
// Expectations follow ordinary outliner behaviour:
//  - Deleting whole selected lines removes them, bullets included; the lines'
//    unselected sub-bullets move up into their place.
//  - Tab indents a line (with its sub-bullets) under the line above it;
//    Shift+Tab outdents it, sub-bullets travelling along.
//  - Enter at the end of a line starts a sibling bullet below it.
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

const rows = [
  // Whole lines selected with the mouse, removed with either delete key.
  {name: 'triple-click leaf, Backspace', select: {triple: 'Bravo'}, act: 'Backspace',
    expect: md('- Alpha', '  - Alpha one', '  - Alpha two', '    - Alpha two deep', '- Charlie', '  - Charlie one')},
  {name: 'triple-click leaf, Delete', select: {triple: 'Alpha one'}, act: 'Delete',
    expect: md('- Alpha', '  - Alpha two', '    - Alpha two deep', '- Bravo', '- Charlie', '  - Charlie one')},
  {name: 'triple-click parent keeps its sub-bullets', select: {triple: 'Alpha two'}, act: 'Backspace',
    expect: md('- Alpha', '  - Alpha one', '  - Alpha two deep', '- Bravo', '- Charlie', '  - Charlie one')},
  {name: 'triple-click last line of the document', select: {triple: 'Charlie one'}, act: 'Backspace',
    expect: md('- Alpha', '  - Alpha one', '  - Alpha two', '    - Alpha two deep', '- Bravo', '- Charlie')},
  {name: 'drag across a branch and a sibling', select: {lines: ['Alpha one', 'Bravo']}, act: 'Delete',
    expect: md('- Alpha', '- Charlie', '  - Charlie one')},
  {name: 'drag across two nested lines', select: {lines: ['Alpha two', 'Alpha two deep']}, act: 'Backspace',
    expect: md('- Alpha', '  - Alpha one', '- Bravo', '- Charlie', '  - Charlie one')},
  {name: 'a word inside a line is an ordinary edit', doc: md('- Delta echo foxtrot', '- Golf'),
    select: {word: ['Delta echo foxtrot', 'echo']}, act: 'Backspace', expect: md('- Delta  foxtrot', '- Golf')},

  // Indent and outdent.
  {name: 'Tab indents under the line above', caret: {line: 'Bravo', where: 'start'}, act: 'Tab',
    expect: md('- Alpha', '  - Alpha one', '  - Alpha two', '    - Alpha two deep', '  - Bravo', '- Charlie', '  - Charlie one')},
  {name: 'Tab takes sub-bullets along', caret: {line: 'Alpha two', where: 'start'}, act: 'Tab',
    expect: md('- Alpha', '  - Alpha one', '    - Alpha two', '      - Alpha two deep', '- Bravo', '- Charlie', '  - Charlie one')},
  {name: 'Shift+Tab outdents a leaf', caret: {line: 'Alpha two deep', where: 'start'}, act: 'Shift+Tab',
    expect: md('- Alpha', '  - Alpha one', '  - Alpha two', '  - Alpha two deep', '- Bravo', '- Charlie', '  - Charlie one')},
  {name: 'Shift+Tab takes sub-bullets along', caret: {line: 'Alpha two', where: 'start'}, act: 'Shift+Tab',
    expect: md('- Alpha', '  - Alpha one', '- Alpha two', '  - Alpha two deep', '- Bravo', '- Charlie', '  - Charlie one')},

  // Indent and outdent from the end of the line, where Vditor alone does nothing.
  {name: 'Tab after the text indents', caret: {line: 'Bravo', where: 'end'}, act: 'Tab',
    expect: md('- Alpha', '  - Alpha one', '  - Alpha two', '    - Alpha two deep', '  - Bravo', '- Charlie', '  - Charlie one')},
  {name: 'Tab after the text takes sub-bullets along', caret: {line: 'Alpha two', where: 'end'}, act: 'Tab',
    expect: md('- Alpha', '  - Alpha one', '    - Alpha two', '      - Alpha two deep', '- Bravo', '- Charlie', '  - Charlie one')},
  {name: 'Tab after the text joins existing sub-bullets', caret: {line: 'Charlie', where: 'end'}, act: 'Tab',
    expect: md('- Alpha', '  - Alpha one', '  - Alpha two', '    - Alpha two deep', '- Bravo', '  - Charlie', '    - Charlie one')},
  {name: 'Shift+Tab after the text outdents a leaf', caret: {line: 'Alpha two deep', where: 'end'}, act: 'Shift+Tab',
    expect: md('- Alpha', '  - Alpha one', '  - Alpha two', '  - Alpha two deep', '- Bravo', '- Charlie', '  - Charlie one')},
  {name: 'Shift+Tab after the text keeps later siblings below', caret: {line: 'Alpha one', where: 'end'}, act: 'Shift+Tab',
    expect: md('- Alpha', '- Alpha one', '  - Alpha two', '    - Alpha two deep', '- Bravo', '- Charlie', '  - Charlie one')},
  {name: 'Tab after the text in a numbered list', doc: md('1. One', '2. Two', '3. Three'), caret: {line: 'Two', where: 'end'}, act: 'Tab',
    expect: md('1. One', '   1. Two', '2. Three')},

  // Starting a new bullet.
  {name: 'Enter at the end of a line starts a sibling', caret: {line: 'Bravo', where: 'end'}, act: 'Enter',
    expect: md('- Alpha', '  - Alpha one', '  - Alpha two', '    - Alpha two deep', '- Bravo', '-', '- Charlie', '  - Charlie one')}
]

for (const row of rows) row.doc ??= BASE
await runSheet({title: 'Hierarchical bullet keyboard editing', rows})
