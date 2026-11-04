// Boundary combinations omitted by text-only list-selection tests: parent Enter,
// empty paste targets, branch transfer, deliberate loose lists, and typed follow-up.
import {runSheet} from './support/sheet.mjs'
const md = (...lines) => lines.join('\n') + '\n'
const rows = []
for (const depth of [0, 1, 2]) {
  const prefix = ['- Root', ...(depth === 2 ? ['  - Branch'] : [])].slice(0, depth)
  const space = '  '.repeat(depth)
  for (const where of ['start', 'end']) {
    const doc = md(...prefix, `${space}- Parent`, `${space}  - Child`, `${space}- After`, '- Tail')
    rows.push({name: `Enter on parent depth ${depth} ${where}`, doc, caret: {line: 'Parent', where}, act: ['Enter', ...(where === 'start' ? [{caret: {line: '', where: 'start'}}] : []), {text: 'Added'}],
      expect: where === 'start'
        ? md(...prefix, `${space}- Added`, `${space}- Parent`, `${space}  - Child`, `${space}- After`, '- Tail')
        : md(...prefix, `${space}- Parent`, `${space}- Added`, `${space}  - Child`, `${space}- After`, '- Tail')})
  }
  for (const clipboard of ['- Pasted', '- Pasted\n- Second', '- Pasted\n  - Child']) {
    rows.push({name: `paste ${clipboard.includes('Child') ? 'branch' : clipboard.includes('Second') ? 'siblings' : 'leaf'} into empty depth ${depth}`,
      doc: md(...prefix, `${space}- Before`, `${space}-`, `${space}- After`, '- Tail'),
      clipboard, at: {line: '', where: 'start'},
      expect: md(...prefix, `${space}- Before`, ...clipboard.split('\n').map(line => space + line), `${space}- After`, '- Tail')})
  }
  for (const act of ['cut', 'copy']) for (const where of ['start', 'end']) {
    const doc = md('- Source', '  - Child', '    - Grandchild', '- Other', ...prefix.map(line => line.replace('Root', 'Target Root')),
      `${space}- Target`, `${space}  - Target child`, '- Tail')
    const source = act === 'copy' ? ['- Source', '  - Child', '    - Grandchild'] : []
    const target = where === 'start'
      ? [`${space}- Source`, `${space}  - Child`, `${space}    - Grandchild`, `${space}- Target`, `${space}  - Target child`]
      : [`${space}- Target`, `${space}  - Target child`, `${space}- Source`, `${space}  - Child`, `${space}    - Grandchild`]
    rows.push({name: `${act} entire branch to depth ${depth} ${where}`, doc, select: {lines: ['Source', 'Grandchild']}, act,
      clip: '- Source\n  - Child\n    - Grandchild', at: {line: 'Target', where},
      expect: md(...source, '- Other', ...prefix.map(line => line.replace('Root', 'Target Root')), ...target, '- Tail')})
  }
}
for (const loose of [false, true]) for (const key of ['Backspace', 'Delete']) {
  const separator = loose ? ['', '- Selected', ''] : ['- Selected']
  rows.push({name: `${key} ${loose ? 'loose' : 'tight'} line then type into survivor`, doc: md('- Before', ...separator, '- After', '  - Child'),
    select: {triple: 'Selected'}, act: [key, {text: '!'}], expect: loose ? md('- Before', '- !After', '', '  - Child') : md('- Before', '- !After', '  - Child')})
}
await runSheet({title: 'Nested list boundary operations', rows})
