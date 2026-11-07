export const line = (depth, text) => ({depth, text})
export const markdown = lines => lines.map(({depth, text}) => '  '.repeat(depth) + '-' + (text ? ' ' + text : '')).join('\n') + '\n'
export function group(prefix, depth, position, parent) {
  const rows = []
  for (let level = 0; level < depth; level++) rows.push(line(level, `${prefix} ancestor ${level}`))
  for (const place of ['first', 'middle', 'last']) {
    rows.push(line(depth, place === position ? prefix : `${prefix} ${place}`))
    if (place === position && parent) rows.push(line(depth + 1, `${prefix} child`), line(depth + 2, `${prefix} grandchild`))
  }
  return rows
}
export function removeOwn(lines, text) {
  const index = lines.findIndex(row => row.text === text)
  const result = lines.map(row => ({...row}))
  const depth = result[index].depth
  result.splice(index, 1)
  for (let next = index; next < result.length && result[next].depth > depth; next++) result[next].depth--
  return result
}
export function insert(lines, target, payload, where) {
  let index = lines.findIndex(row => row.text === target)
  const depth = lines[index].depth
  if (where === 'end') {
    index++
    while (index < lines.length && lines[index].depth > depth) index++
  }
  return [...lines.slice(0, index), ...payload.map(row => line(row.depth + depth, row.text)), ...lines.slice(index)]
}

export function joinUp(lines, text) {
  const index = lines.findIndex(row => row.text === text)
  const result = removeOwn(lines, text)
  result[index - 1].text += text
  return result
}
export function joinDown(lines, text) {
  const index = lines.findIndex(row => row.text === text)
  return joinUp(lines, lines[index + 1].text)
}
export function unwrapFirst(lines) {
  const [first] = lines
  return first.text + '\n\n' + markdown(removeOwn(lines, first.text))
}
