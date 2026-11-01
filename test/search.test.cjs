const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const test = require('node:test')
const vm = require('node:vm')

const resources = path.join(__dirname, '../src/main/resources')
const editor = () => fs.readFileSync(path.join(__dirname,
    '../src/main/java/com/shuzijun/markdown/editor/MarkdownPreviewFileEditor.java'), 'utf8')

test('opening search defers IDE-managed focus until the toolbar is laid out', () => {
    const source = editor()
    const open = source.slice(source.indexOf('public void visibleToolbarPanel'))
    assert.match(open, /myHtmlPanelWrapper\.revalidate\(\)/)
    assert.match(open, /ApplicationManager\.getApplication\(\)\.invokeLater/)
    assert.match(open, /IdeFocusManager\.getInstance\(myProject\)\.requestFocus\(searchField, true\)/)
    assert.match(open, /searchField\.selectAll\(\)/)
    assert.match(open, /toolbarPanel\.isShowing\(\)/)
})

test('search counts literal case-insensitive non-overlapping matches in visible editor text', () => {
    const source = fs.readFileSync(path.join(resources, 'vditor/search-count.js'), 'utf8')
    let nodes = []
    const root = {getClientRects: () => [1]}
    const context = vm.createContext({
        NodeFilter: {SHOW_TEXT: 4, FILTER_ACCEPT: 1, FILTER_REJECT: 2},
        document: {
            querySelectorAll: () => [root],
            createTreeWalker: (element, type, filter) => {
                const accepted = nodes.filter(node => filter.acceptNode(node) === 1)
                let index = 0
                return {nextNode: () => accepted[index++] || null}
            },
        },
    })
    vm.runInContext(source, context)
    const node = (text, visible = true) => ({
        textContent: text,
        parentElement: {getClientRects: () => visible ? [1] : [], closest: () => null},
    })
    nodes = [node('Apple apple '), node('APP'), node('LE [a] aaaa'), node(' apple', false)]
    assert.equal(context.countMarkdownMatches('apple'), 3)
    assert.equal(context.countMarkdownMatches('[a]'), 1)
    assert.equal(context.countMarkdownMatches('aa'), 2)
    assert.equal(context.countMarkdownMatches('missing'), 0)
    assert.equal(context.countMarkdownMatches(''), 0)
    context.document.querySelectorAll = () => []
    assert.equal(context.countMarkdownMatches('apple'), 0)
})

test('search count is bridged to Swing and stale results are discarded', () => {
    const source = editor()
    assert.match(source, /toolbarPanel\.add\(searchCount\)/)
    assert.match(source, /setSearchCountListener/)
    assert.match(source, /searchField\.getText\(\)\.equals\(query\)/)
    assert.match(source, /total \+ " matches"/)
    const panel = fs.readFileSync(path.join(__dirname,
        '../src/main/java/com/shuzijun/markdown/editor/MarkdownHtmlPanel.java'), 'utf8')
    assert.match(panel, /countMarkdownMatches/)
    assert.match(panel, /Disposer\.dispose\(searchCountJSQuery\)/)
})
