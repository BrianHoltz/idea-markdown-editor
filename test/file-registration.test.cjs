const assert = require('node:assert/strict')
const fs = require('node:fs')
const os = require('node:os')
const path = require('node:path')
const {spawnSync} = require('node:child_process')
const test = require('node:test')
const root = path.join(__dirname, '..')

test('file registrations belong to individual editors and projects', () => {
    const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'markdown-registration-'))
    const files = {
        'com/intellij/openapi/Disposable.java': 'package com.intellij.openapi; public interface Disposable { void dispose(); }',
        'com/intellij/openapi/vfs/VirtualFile.java': 'package com.intellij.openapi.vfs; public class VirtualFile { public boolean valid = true; public boolean isValid() { return valid; } }',
        'com/shuzijun/markdown/controller/FileApplicationService.java': fs.readFileSync(path.join(root,
            'src/main/java/com/shuzijun/markdown/controller/FileApplicationService.java'), 'utf8'),
        'Harness.java': `
import com.shuzijun.markdown.controller.FileApplicationService;
import com.intellij.openapi.Disposable;
import com.intellij.openapi.vfs.VirtualFile;
public class Harness {
    static void check(boolean value) { if (!value) throw new AssertionError(); }
    public static void main(String[] args) {
        var service = new FileApplicationService();
        var file = new VirtualFile();
        var first = service.registerVirtualFile("/file", "project", file);
        var second = service.registerVirtualFile("/file", "project", file);
        first.dispose();
        check(service.getVirtualFile("/file", "project") == file);
        first.dispose();
        check(service.getVirtualFile("/file", "project") == file);
        check(service.getVirtualFile("/file", "other") == null);
        var other = service.registerVirtualFile("/file", "other", file);
        second.dispose();
        check(service.getVirtualFile("/file", "project") == null);
        check(service.getVirtualFile("/file", "other") == file);
        file.valid = false;
        check(service.getVirtualFile("/file", "other") == null);
        other.dispose();
        var replacement = new VirtualFile();
        var latest = service.registerVirtualFile("/file", "project", replacement);
        second.dispose();
        check(service.getVirtualFile("/file", "project") == replacement);
        latest.dispose();
        check(service.getVirtualFile(null, null) == null);
    }
}`
    }
    try {
        for (const [name, content] of Object.entries(files)) {
            const file = path.join(directory, name)
            fs.mkdirSync(path.dirname(file), {recursive: true}); fs.writeFileSync(file, content)
        }
        const home = process.env.JAVA_HOME || '/Applications/IntelliJ IDEA.app/Contents/jbr/Contents/Home'
        const compile = spawnSync(path.join(home, 'bin/javac'), Object.keys(files), {cwd: directory, encoding: 'utf8'})
        assert.equal(compile.status, 0, compile.stderr)
        const run = spawnSync(path.join(home, 'bin/java'), ['-cp', directory, 'Harness'], {encoding: 'utf8'})
        assert.equal(run.status, 0, run.stderr)
    } finally { fs.rmSync(directory, {recursive: true, force: true}) }
})

test('registration precedes browser load and disposal releases only its own lease', () => {
    const editor = fs.readFileSync(path.join(root,
        'src/main/java/com/shuzijun/markdown/editor/MarkdownPreviewFileEditor.java'), 'utf8')
    assert.ok(editor.indexOf('registerVirtualFile(') < editor.indexOf('tempPanel.loadMyHTML('))
    assert.match(editor, /Disposer\.register\(this,\s*[^;]*registerVirtualFile\(/)
    assert.doesNotMatch(editor, /removeVirtualFile\(/)
})

test('file lookup errors are HTTP failures, never cacheable document content', () => {
    const controller = fs.readFileSync(path.join(root,
        'src/main/java/com/shuzijun/markdown/controller/MarkdownFileController.java'), 'utf8')
    assert.match(controller, /HttpResponseStatus\.NOT_FOUND/)
    assert.match(controller, /HttpResponseStatus\.CONFLICT/)
    assert.match(controller, /HttpHeaderNames\.CACHE_CONTROL, "no-store"/)
    assert.doesNotMatch(controller, /fillHtmlResponse\("unable/)
    assert.match(controller, /document == null/)
    const template = fs.readFileSync(path.join(root, 'src/main/resources/template/default.html'), 'utf8')
    const reload = template.slice(template.indexOf('    function reloadFile()'), template.indexOf('    function updateSyncState('))
    assert.doesNotMatch(reload, /if \(initError\)/)
    assert.match(reload, /initError = false;/)
    const initial = template.slice(template.indexOf('    function initValue()'), template.indexOf('    function appendSyncedTip('))
    assert.doesNotMatch(initial, /vditor\.tip|value = "Get file/)
})


test('failed initial loads stay unsavable and Reload recovers without inserting errors', () => {
    const vm = require('node:vm')
    const template = fs.readFileSync(path.join(root, 'src/main/resources/template/default.html'), 'utf8')
    let fail = true, value = '', saved = 0
    const context = vm.createContext({
        initError: true, fileValue: '', saveTime: 0, reloadArmed: false, reloadArmTimer: null,
        fileUrl: '/file', clearTimeout() {}, setTimeout() {}, syncedTip() {}, updateSyncState() {},
        vditor: {getValue: () => value, setValue: text => {value = text}, tip() {}},
        $: {get(url, success) {
            if (!fail) success('actual Markdown')
            return {fail(handler) { if (fail) handler(); return this }}
        }, post() { saved++ }}
    })
    const initial = template.slice(template.indexOf('    function initValue()'), template.indexOf('    function appendSyncedTip('))
    const reload = template.slice(template.indexOf('    function reloadFile()'), template.indexOf('    function updateSyncState('))
    const save = template.slice(template.indexOf('    function editBlur('), template.indexOf('    function editFocus('))
    vm.runInContext(initial + reload + save, context)
    assert.equal(vm.runInContext('initValue()', context), '')
    assert.equal(context.initError, true)
    vm.runInContext('editBlur("error text", true)', context)
    assert.equal(saved, 0)
    fail = false
    vm.runInContext('reloadFile()', context)
    assert.equal(value, 'actual Markdown')
    assert.equal(context.fileValue, value)
    assert.equal(context.initError, false)
    fail = true
    vm.runInContext('reloadFile()', context)
    assert.equal(value, 'actual Markdown')
})
