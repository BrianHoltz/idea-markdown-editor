const {test} = require('node:test')
const assert = require('node:assert/strict')
test('joining removes only the later own line and promotes its descendants', async () => {
  const {line, joinUp, joinDown, unwrapFirst} = await import('./support/outline.mjs')
  const source = [line(0, 'A'), line(1, 'B'), line(2, 'C'), line(0, 'D'), line(1, 'E')]
  assert.deepEqual(joinDown(source, 'A'), [line(0, 'AB'), line(1, 'C'), line(0, 'D'), line(1, 'E')])
  assert.deepEqual(joinUp(source, 'D'), [line(0, 'A'), line(1, 'B'), line(2, 'CD'), line(0, 'E')])
  assert.equal(unwrapFirst(source), 'A\n\n- B\n  - C\n- D\n  - E\n')
  assert.equal(source[0].text, 'A', 'model does not mutate its input')
})
