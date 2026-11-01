const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const test = require('node:test')
const vm = require('node:vm')

const template = fs.readFileSync(path.join(__dirname, '../src/main/resources/template/default.html'), 'utf8')
function harness() {
    const start = template.indexOf('    function editFocus(')
    const end = template.indexOf('    function editInput(', start)
    const requests = [], timers = [], applied = []
    let value = 'original', now = 1000
    const context = vm.createContext({
        Date: {now: () => now}, initError: false, fileValue: 'original', saveTime: 0,
        externalRefreshTimer: null, externalRefreshInFlight: false, externalRefreshPending: false,
        fileUrl: '/file', window: {scrollX: 0, scrollY: 80, scrollTo() {}},
        vditor: {getValue: () => value, setValue: data => { value = data; applied.push(data) }},
        syncedTip() {}, setTimeout: task => { timers.push(task); return timers.length }, clearTimeout() {},
        $: {ajax: options => { requests.push(options); return {fail() { return this }, always(task) { options.always = task; return this }} }}
    })
    vm.runInContext(template.slice(start, end), context)
    return {context, requests, applied, timers, focus: () => vm.runInContext('editFocus()', context),
        edit: text => {value = text}, time: time => {now = time},
        finish: (data, index = requests.length - 1) => {requests[index].success(data); requests[index].always()}}
}

test('external updates fetch asynchronously without cached content and skip unchanged rendering', () => {
    const h = harness(); h.focus()
    assert.equal(h.requests.length, 1)
    assert.equal(h.requests[0].async, true)
    assert.equal(h.requests[0].cache, false)
    h.finish('original'); assert.deepEqual(h.applied, [])
    h.focus(); h.finish('external edit'); assert.deepEqual(h.applied, ['external edit'])
    assert.equal(h.context.fileValue, 'external edit')
})

test('external refresh never replaces unsaved edits, including edits made during a fetch', () => {
    const h = harness(); h.edit('local edit'); h.focus()
    assert.equal(h.requests.length, 0)
    h.edit('original'); h.focus(); h.edit('typing during fetch'); h.finish('external edit')
    assert.deepEqual(h.applied, [])
    assert.equal(h.context.fileValue, 'original')
})

test('clipboard suppression schedules a retry instead of dropping a refresh', () => {
    const h = harness(); h.context.saveTime = 1500; h.focus()
    assert.equal(h.requests.length, 0); assert.equal(h.timers.length, 1)
    h.time(1501); h.timers.shift()(); assert.equal(h.requests.length, 1)
})

test('notifications during a fetch coalesce into one follow-up read', () => {
    const h = harness(); h.focus(); h.focus(); h.focus()
    assert.equal(h.requests.length, 1)
    h.finish('external edit'); assert.equal(h.timers.length, 1)
    h.timers.shift()(); assert.equal(h.requests.length, 2)
})

test('a completed save invalidates an older refresh response', () => {
    const h = harness(); h.focus()
    h.edit('saved locally'); h.context.fileValue = 'saved locally'
    h.finish('stale external content')
    assert.deepEqual(h.applied, [])
})

test('failed fetches release the in-flight guard so the next notification retries', () => {
    const h = harness(); h.focus(); h.requests[0].always()
    h.focus(); assert.equal(h.requests.length, 2)
    h.finish('recovered'); assert.deepEqual(h.applied, ['recovered'])
})

test('initial load errors do not trigger background replacement', () => {
    const h = harness(); h.context.initError = true; h.focus()
    assert.equal(h.requests.length, 0)
})

test('editor wires lifecycle-bound document notifications', () => {
    const editor = fs.readFileSync(path.join(__dirname, '../src/main/java/com/shuzijun/markdown/editor/MarkdownPreviewFileEditor.java'), 'utf8')
    assert.match(editor, /new ExternalFileSync\(myDocument, myPanel, this\)/)
    const syncPath = path.join(__dirname, '../src/main/java/com/shuzijun/markdown/editor/ExternalFileSync.java')
    assert.ok(fs.existsSync(syncPath), 'Missing external-file synchronizer')
    const sync = fs.readFileSync(syncPath, 'utf8')
    assert.match(sync, /addDocumentListener/)
    assert.match(sync, /Disposer\.register/)
    assert.doesNotMatch(template, /saveTime = Date\.now\(\) \+ 5000;/)
})
