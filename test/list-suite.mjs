// One command for all list regressions. Never parallelize these browser sheets:
// they use the same macOS clipboard and shared Canary agent profile.
import {spawnSync} from 'node:child_process'
import {serve, launch} from './support/cdp.mjs'

for (const file of ['list-empty', 'list-boundaries', 'list-editing', 'list-keys', 'list-matrix', 'list-joins']) {
  const result = spawnSync(process.execPath, [new URL(`./${file}.sheet.mjs`, import.meta.url).pathname], {stdio: 'inherit'})
  if (result.error) throw result.error
  if (result.status !== 0) process.exit(result.status || 1)
}
const server = await serve(new URL('..', import.meta.url).pathname)
const browser = await launch()
let page
try {
  page = await browser.open(`${server.origin}/test/list-selection-delete.html`)
  await page.waitFor('window.ready === true')
  const results = await page.evaluate('testListSelectionDelete()')
  console.log(`Original selected-delete regression: ${results.length} checks passed`)
} finally {
  if (page) await page.close()
  await browser.close()
  server.close()
}
