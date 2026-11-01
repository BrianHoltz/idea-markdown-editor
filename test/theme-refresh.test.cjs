const assert = require('node:assert/strict')
const fs = require('node:fs')
const os = require('node:os')
const path = require('node:path')
const {spawnSync} = require('node:child_process')
const test = require('node:test')

const source = fs.readFileSync(path.join(__dirname,
    '../src/main/java/com/shuzijun/markdown/editor/MarkdownPreviewFileEditor.java'), 'utf8')

function method(signature) {
    const start = source.indexOf(signature)
    assert.ok(start >= 0, `Missing production method: ${signature}`)
    let end = source.indexOf('{', start)
    let depth = 1
    while (depth && ++end < source.length) {
        if (source[end] === '{') depth++
        if (source[end] === '}') depth--
    }
    return source.slice(start, end + 1)
}

test('automatic look-and-feel changes refresh existing Markdown tabs', () => {
    assert.match(source, /import com\.intellij\.ide\.ui\.LafManagerListener;/)
    assert.match(source, /settingsConnection\.subscribe\(LafManagerListener\.TOPIC,\s*\w+ -> refreshAppearance\(\)\)/)
    assert.match(source, /getMessageBus\(\)\.connect\(this\)/)
})

test('tab reselection refreshes current appearance and ignores disposed browsers', () => {
    const java = `
import java.util.*;
public class ThemeRefreshHarness {
    static final Queue<Runnable> pending = new ArrayDeque<>();
    static boolean dark = true;
    static class ApplicationManager {
        static ApplicationManager getApplication() { return new ApplicationManager(); }
        void invokeLater(Runnable task) { pending.add(task); }
    }
    static class UISettings {
        static UISettings getInstance() { return new UISettings(); }
        double getCurrentIdeScale() { return 1.5; }
    }
    static class Panel {
        boolean disposed;
        boolean darkTheme;
        String style;
        double scale;
        int updates;
        boolean isDisposed() { return disposed; }
        void updateStyle(String css, boolean value) { style = css; darkTheme = value; updates++; }
        void setZoomLevel(double value) { scale = value; }
    }
    Panel myPanel = new Panel();
    String getStyle(boolean tag) { return dark ? "dark-css" : "light-css"; }
    boolean isDarkTheme() { return dark; }
    ${method('private void refreshAppearance()')}
    ${method('public void selectNotify()')}
    static void check(boolean value) { if (!value) throw new AssertionError(); }
    static void drain() { while (!pending.isEmpty()) pending.remove().run(); }
    public static void main(String[] args) {
        ThemeRefreshHarness editor = new ThemeRefreshHarness();
        editor.selectNotify();
        check(editor.myPanel.updates == 0);
        dark = false;
        drain();
        check(!editor.myPanel.darkTheme && editor.myPanel.style.equals("light-css"));
        check(editor.myPanel.scale == 1.5);
        dark = true;
        editor.selectNotify(); drain();
        check(editor.myPanel.darkTheme && editor.myPanel.updates == 2);
        editor.selectNotify(); editor.myPanel.disposed = true; drain();
        check(editor.myPanel.updates == 2);
        editor.myPanel = null;
        editor.selectNotify(); drain();
    }
}`
    const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'markdown-theme-'))
    try {
        const file = path.join(directory, 'ThemeRefreshHarness.java')
        fs.writeFileSync(file, java)
        const home = process.env.JAVA_HOME || '/Applications/IntelliJ IDEA.app/Contents/jbr/Contents/Home'
        const compile = spawnSync(path.join(home, 'bin/javac'), [file], {encoding: 'utf8'})
        assert.equal(compile.status, 0, compile.stderr)
        const run = spawnSync(path.join(home, 'bin/java'), ['-cp', directory, 'ThemeRefreshHarness'], {encoding: 'utf8'})
        assert.equal(run.status, 0, run.stderr)
    } finally {
        fs.rmSync(directory, {recursive: true, force: true})
    }
})
