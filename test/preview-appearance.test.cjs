const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const test = require('node:test')

const root = path.join(__dirname, '..')
const css = fs.readFileSync(path.join(root, 'src/main/resources/vditor/style.css'), 'utf8')
const editor = fs.readFileSync(path.join(root,
    'src/main/java/com/shuzijun/markdown/editor/MarkdownPreviewFileEditor.java'), 'utf8')

function rule(selector) {
    const rules = [...css.replace(/\/\*[\s\S]*?\*\//g, '').matchAll(/([^{}]+)\{([^{}]*)\}/g)]
    const match = rules.find(match => match[1].trim() === selector)
    assert.ok(match, `Missing appearance rule: ${selector}`)
    return match[2]
}

const links = '.vditor .vditor-reset :is(a[href], [data-type="a"], .vditor-ir__link, [data-type="link-ref"], [data-type="footnotes-ref"])'

test('both rich modes use the IDE link color without permanent underlines', () => {
    const declarations = rule(links)
    assert.match(declarations, /color: var\(--markdown-preview-link-color\);/)
    assert.match(declarations, /text-decoration: none;/)
    assert.match(declarations, /cursor: pointer;/)
    assert.match(editor, /--markdown-preview-link-color:/)
    assert.doesNotMatch(editor, /sb\.append\("\.vditor-reset a\{color:/)
})

test('hover, active and keyboard focus reveal links without changing navigation', () => {
    assert.match(rule(links + ':is(:hover, :active, :focus-visible)'), /text-decoration: underline;/)
    assert.match(rule(links + ':focus-visible'), /outline: 1px solid currentColor;/)
    assert.match(rule(links + ' code'), /color: inherit;/)
    assert.doesNotMatch(rule(links), /font(?:-family|-size|-weight)?:/)
})

test('rendered prose permits normal ligatures like the bundled preview', () => {
    assert.match(rule('.vditor .vditor-reset,\n.vditor-ir pre.vditor-reset'), /font-variant-ligatures: normal;/)
    const typography = fs.readFileSync(path.join(root,
        'src/main/java/com/shuzijun/markdown/editor/PreviewTypography.java'), 'utf8')
    assert.match(typography, /MarkdownPreviewSettings\.class\.getResourceAsStream/)
    assert.match(typography, /--markdown-preview-font-family:/)
    assert.match(editor, /\.vditor-sv,\.vditor-reset code,\.vditor-reset kbd\{/)
})
