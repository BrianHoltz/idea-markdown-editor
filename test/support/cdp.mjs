// Dependency-free driver for real-browser tests: a static server for the repo
// root, Chrome Canary over CDP, and a page with real mouse, key and clipboard input.
import {spawn} from 'node:child_process'
import {createServer} from 'node:http'
import {readFile} from 'node:fs/promises'
import {homedir} from 'node:os'
import {extname, join, normalize, resolve} from 'node:path'

const TYPES = {'.html': 'text/html', '.js': 'text/javascript', '.mjs': 'text/javascript', '.css': 'text/css',
  '.svg': 'image/svg+xml', '.png': 'image/png', '.woff2': 'font/woff2', '.woff': 'font/woff', '.ttf': 'font/ttf'}
const sleep = ms => new Promise(resolveSleep => setTimeout(resolveSleep, ms))

export async function serve(root) {
  const base = resolve(root)
  const server = createServer(async (request, response) => {
    const file = join(base, normalize(decodeURIComponent(new URL(request.url, 'http://x').pathname)))
    try {
      if (!file.startsWith(base)) throw new Error('outside root')
      const body = await readFile(file)
      response.writeHead(200, {'content-type': TYPES[extname(file)] || 'application/octet-stream', 'cache-control': 'no-store'})
      response.end(body)
    } catch { response.writeHead(404).end() }
  })
  await new Promise(done => server.listen(0, '127.0.0.1', done))
  return {origin: `http://127.0.0.1:${server.address().port}`, close: () => server.close()}
}

// Reuses a Canary already listening on the port; otherwise launches one in the
// background (no focus theft, so nothing typed elsewhere lands in the test page)
// with the shared agent profile, never a personal profile, and closes it afterwards.
export async function launch(port = Number(process.env.CDP_PORT || 9333)) {
  const version = async () => { try { return await (await fetch(`http://127.0.0.1:${port}/json/version`)).json() } catch {} }
  let launched = false
  let info = await version()
  if (!info) {
    spawn('open', ['-g', '-n', '-a', 'Google Chrome Canary', '--args', `--remote-debugging-port=${port}`,
      `--user-data-dir=${homedir()}/.agent-chrome-profile`, '--no-first-run', '--no-default-browser-check',
      '--disable-renderer-backgrounding', '--disable-backgrounding-occluded-windows',
      '--disable-background-timer-throttling', 'about:blank'], {stdio: 'ignore'})
    launched = true
    for (let attempt = 0; attempt < 50 && !info; attempt++) { await sleep(200); info = await version() }
    if (!info) throw new Error('Chrome Canary did not expose a DevTools endpoint')
  }
  const browser = await connect(info.webSocketDebuggerUrl)
  return {
    // Each page gets its own top-level window, as shared-browser etiquette requires.
    async open(url) {
      const {targetId} = await browser.send('Target.createTarget', {url: 'about:blank', newWindow: true, background: true})
      const target = (await (await fetch(`http://127.0.0.1:${port}/json/list`)).json()).find(item => item.id === targetId)
      const page = await connect(target.webSocketDebuggerUrl)
      // Keep the page rendering as if focused, without activating the app.
      await page.send('Emulation.setFocusEmulationEnabled', {enabled: true})
      await page.send('Page.navigate', {url})
      await sleep(600)
      return new Page(page, () => browser.send('Target.closeTarget', {targetId}))
    },
    async close() {
      if (launched) await browser.send('Browser.close').catch(() => {})
      browser.close()
    }
  }
}

async function connect(url) {
  const socket = new WebSocket(url)
  await new Promise((done, fail) => { socket.onopen = done; socket.onerror = fail })
  let counter = 0
  const waiting = new Map()
  socket.onmessage = message => {
    const data = JSON.parse(message.data)
    if (data.id && waiting.has(data.id)) waiting.get(data.id)(data)
  }
  return {
    send: (method, params = {}) => new Promise((done, fail) => {
      const id = ++counter
      waiting.set(id, reply => reply.error ? fail(new Error(`${method}: ${reply.error.message}`)) : done(reply.result))
      socket.send(JSON.stringify({id, method, params}))
    }),
    close: () => socket.close()
  }
}

// macOS modifier bits and editing commands. Chromium performs the command when
// the page does not cancel the keydown, exactly as for a physical shortcut.
const MOD = {alt: 1, ctrl: 2, meta: 4, shift: 8}
const SHORTCUTS = {
  cut: ['x', 'KeyX', 88, 'cut'], copy: ['c', 'KeyC', 67, 'copy'], paste: ['v', 'KeyV', 86, 'paste'],
  undo: ['z', 'KeyZ', 90, 'undo'], redo: ['z', 'KeyZ', 90, 'redo', MOD.shift]
}
const KEYS = {Backspace: 8, Delete: 46, Enter: 13, Tab: 9, ArrowDown: 40, ArrowUp: 38, ArrowLeft: 37, ArrowRight: 39, Home: 36, End: 35}

class Page {
  constructor(session, close) { this.session = session; this.closeTarget = close }
  async evaluate(expression) {
    const reply = await this.session.send('Runtime.evaluate',
      {expression, awaitPromise: true, returnByValue: true, userGesture: true})
    if (reply.exceptionDetails) throw new Error(reply.exceptionDetails.exception?.description || reply.exceptionDetails.text)
    return reply.result.value
  }
  async waitFor(condition, attempts = 100) {
    for (let attempt = 0; attempt < attempts; attempt++) { if (await this.evaluate(condition)) return; await sleep(100) }
    throw new Error(`timed out waiting for ${condition}`)
  }
  async key(name, modifiers = 0, commands = []) {
    const code = KEYS[name]
    // Enter carries its character, as a physical key press does.
    const text = name === 'Enter' ? '\r' : undefined
    for (const type of [text ? 'keyDown' : 'rawKeyDown', 'keyUp'])
      await this.session.send('Input.dispatchKeyEvent', {type, key: name, code: name, windowsVirtualKeyCode: code,
        nativeVirtualKeyCode: code, modifiers, commands: name === 'Enter' && modifiers === 8 && type === 'keyDown' ? ['insertLineBreak'] : commands, ...(type === 'keyDown' ? {text} : {})})
  }
  async shortcut(name) {
    const [key, code, vk, command, extra = 0] = SHORTCUTS[name]
    for (const type of ['rawKeyDown', 'keyUp'])
      await this.session.send('Input.dispatchKeyEvent', {type, key, code, windowsVirtualKeyCode: vk, nativeVirtualKeyCode: vk,
        modifiers: MOD.meta | extra, commands: type === 'rawKeyDown' ? [command] : []})
  }
  async mouse(type, x, y, clickCount = 0, extra = {}) {
    await this.session.send('Input.dispatchMouseEvent',
      {type, x, y, button: type === 'mouseMoved' ? 'none' : 'left', buttons: type === 'mouseReleased' ? 0 : 1, clickCount, ...extra})
  }
  async click(x, y, count = 1) {
    for (let n = 1; n <= count; n++) { await this.mouse('mousePressed', x, y, n); await this.mouse('mouseReleased', x, y, n) }
  }
  async drag(from, to) {
    await this.mouse('mouseMoved', from.x, from.y)
    await this.mouse('mousePressed', from.x, from.y, 1)
    for (let step = 1; step <= 6; step++)
      await this.mouse('mouseMoved', from.x + (to.x - from.x) * step / 6, from.y + (to.y - from.y) * step / 6, 0, {button: 'left'})
    await this.mouse('mouseReleased', to.x, to.y, 1)
  }
  async close() { await this.closeTarget() }
}
