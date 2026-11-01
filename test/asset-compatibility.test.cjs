const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const test = require('node:test')
const vm = require('node:vm')

const resources = path.join(__dirname, '../src/main/resources')

test('bundled Lute provides every Vditor initialization method', () => {
    const context = vm.createContext({console, TextEncoder, TextDecoder, setTimeout, clearTimeout})
    context.window = context
    vm.runInContext(fs.readFileSync(path.join(resources, 'vditor/dist/js/lute/lute.min.js'), 'utf8'), context)
    const parser = context.Lute.New()
    const source = fs.readFileSync(path.join(resources, 'vditor/dist/index.js'), 'utf8')
    const initialization = source.slice(source.indexOf('var setLute = function'), source.indexOf('return lute;', source.indexOf('var setLute = function')))
    const methods = [...initialization.matchAll(/lute\.(\w+)\(/g)].map(match => match[1])
    assert.ok(methods.includes('SetCallout'))
    for (const method of methods) {
        assert.equal(typeof parser[method], 'function', `Missing Lute method: ${method}`)
    }
    assert.match(parser.Md2HTML('# Startup test\n\nEditor content.'), /<h1[^>]*>Startup test<\/h1>/)
})

test('all bundled template assets share the cache-isolated resource prefix', () => {
    const template = fs.readFileSync(path.join(resources, 'template/default.html'), 'utf8')
    assert.doesNotMatch(template, /\{\{service\}\}resources\/vditor/)
    assert.equal((template.match(/\{\{service\}\}\{\{resources\}\}vditor/g) || []).length, 8)
    assert.match(template, /vditorThemeCDN = .*vditorCDN \+ "\/dist\/css\/content-theme"/)
    const controller = fs.readFileSync(path.join(__dirname, '../src/main/java/com/shuzijun/markdown/controller/ResourcesController.java'), 'utf8')
    assert.match(controller, /return "resources\/" \+ LAST_MODIFIED \+ "\/"/)
})

test('rich text follows preview typography and retains wrapping tables', () => {
    const css = fs.readFileSync(path.join(resources, 'vditor/style.css'), 'utf8')
    const typography = css.match(/\.vditor \.vditor-reset,\s*\.vditor-ir pre\.vditor-reset \{([^}]+)\}/)[1]
    assert.match(typography, /font-family: var\(--markdown-preview-font-family\) !important;/)
    assert.match(typography, /font-size: var\(--markdown-preview-font-size\) !important;/)
    assert.match(typography, /line-height: 1\.4 !important;/)
    const table = css.match(/\.vditor-reset table \{([^}]+)\}/)[1]
    assert.match(table, /width: 100%;/)
    assert.match(table, /max-width: 100%;/)
    assert.match(table, /font: inherit;/)
    const cells = css.match(/\.vditor-reset table td,\s*\.vditor-reset table th \{([^}]+)\}/)[1]
    assert.match(cells, /white-space: normal;/)
    assert.match(cells, /overflow-wrap: break-word;/)
    assert.match(cells, /word-break: normal;/)
    const styles = fs.readFileSync(path.join(__dirname, '../src/main/java/com/shuzijun/markdown/editor/MarkdownPreviewFileEditor.java'), 'utf8')
    assert.match(styles, /\.vditor-sv,\.vditor-reset code,\.vditor-reset kbd\{/)
    assert.doesNotMatch(styles, /sb\.append\("\.vditor-reset \{font-size:/)
})

test('preview preferences and whole-browser IDEA zoom have live listeners', () => {
    const editor = fs.readFileSync(path.join(__dirname, '../src/main/java/com/shuzijun/markdown/editor/MarkdownPreviewFileEditor.java'), 'utf8')
    assert.match(editor, /MarkdownPreviewSettings.ChangeListener.TOPIC/)
    assert.match(editor, /UISettingsListener.TOPIC/)
    assert.match(editor, /tempPanel.setZoomLevel\(UISettings.getInstance\(\).getCurrentIdeScale\(\)\)/)
    assert.match(editor, /myPanel.setZoomLevel\(UISettings.getInstance\(\).getCurrentIdeScale\(\)\)/)
    const css = fs.readFileSync(path.join(resources, 'vditor/style.css'), 'utf8')
    assert.doesNotMatch(css, /font-size: 13px !important/)
    const typography = fs.readFileSync(path.join(__dirname, '../src/main/java/com/shuzijun/markdown/editor/PreviewTypography.java'), 'utf8')
    assert.match(typography, /settings\.getState\(\)\.getFontSize\(\) \+ "px/)
    assert.doesNotMatch(typography, /normalizeScaledSize/)
})

test('content-theme colors follow IDEA light and dark variables', () => {
    const css = fs.readFileSync(path.join(resources, 'vditor/style.css'), 'utf8')
    assert.match(css, /\.vditor-reset \{\s*color: var\(--textarea-text-color\);/)
    assert.match(css, /background-color: var\(--panel-background-color\) !important;/)
    assert.match(css, /border-color: var\(--border-color\) !important;/)
    assert.match(css, /\.vditor--dark \.vditor-panel::after/)
})

test('dark code blocks do not retain Vditor light background imagery', () => {
    const css = fs.readFileSync(path.join(resources, 'vditor/style.css'), 'utf8')
    assert.match(css, /\.vditor--dark \.vditor-reset pre > code \{[^}]*background-color: var\(--panel-background-color\) !important;/s)
    assert.match(css, /\.vditor--dark \.vditor-reset pre > code \{[^}]*background-image: none !important;/s)
})

test('dark code blocks use a readable dark highlight palette', () => {
    const template = fs.readFileSync(path.join(resources, 'template/default.html'), 'utf8')
    assert.match(template, /darcula \? "github-dark" : "github"/)
    assert.match(template, /"hljs": \{"style": darcula \? "github-dark" : "github"\}/)
    const css = fs.readFileSync(path.join(resources, 'vditor/style.css'), 'utf8')
    assert.match(css, /\.vditor--dark \.vditor-reset pre > code\.hljs \{[^}]*color: var\(--textarea-text-color\) !important;/s)
})

test('toolbar visibility control inherits IDEA theme variables on the body', () => {
    const editor = fs.readFileSync(path.join(__dirname, '../src/main/java/com/shuzijun/markdown/editor/MarkdownPreviewFileEditor.java'), 'utf8')
    assert.match(editor, /\.vditor--dark,body"\s*:\s*"\.vditor,body"/)
})

test('document canvas uses the editor background, not the tinted tool-window panel', () => {
    const editor = fs.readFileSync(path.join(__dirname, '../src/main/java/com/shuzijun/markdown/editor/MarkdownPreviewFileEditor.java'), 'utf8')
    assert.match(editor, /Color defaultBackground = editorColorsScheme\.getDefaultBackground\(\);/)
    assert.match(editor, /--toolbar-background-color:\"\)\.append\(toHexColor\(JBColor\.background\(\)\)\)/)
})
