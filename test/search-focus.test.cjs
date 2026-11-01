const assert = require('node:assert/strict')
const fs = require('node:fs')
const os = require('node:os')
const path = require('node:path')
const { spawnSync } = require('node:child_process')
const test = require('node:test')

// Compile and execute the production focus methods with deterministic focus queues.
// This catches handoff ordering and cancellation, not merely source-code spelling.
test('search transfers native focus and survives editor focus restoration', () => {
    const source = fs.readFileSync(path.join(__dirname,
        '../src/main/java/com/shuzijun/markdown/editor/MarkdownPreviewFileEditor.java'), 'utf8')
    function method(name) {
        const start = source.indexOf(`public ${name}`)
        assert.ok(start >= 0, `Missing production method: ${name}`)
        let end = source.indexOf('{', start)
        let depth = 1
        while (depth && ++end < source.length) {
            if (source[end] === '{') depth++
            if (source[end] === '}') depth--
        }
        return source.slice(start, end + 1)
    }
    const java = `
import javax.swing.*;
import java.util.*;
public class SearchFocusHarness {
    @interface Nullable {}
    static final List<String> events = new ArrayList<>();
    static final Queue<Runnable> later = new ArrayDeque<>();
    static final Queue<Runnable> settled = new ArrayDeque<>();
    static class ApplicationManager {
        static ApplicationManager getApplication() { return new ApplicationManager(); }
        void invokeLater(Runnable task) { later.add(task); }
    }
    static class IdeFocusManager {
        static IdeFocusManager getInstance(Project project) { return new IdeFocusManager(); }
        void doWhenFocusSettlesDown(Runnable task) { settled.add(task); }
        void requestFocus(JTextField field, boolean forced) {
            if (nativeFocused) throw new AssertionError("Native browser still owns focus");
            events.add("search");
        }
    }
    static class Project {
        boolean disposed;
        boolean isDisposed() { return disposed; }
    }
    static class Toolbar extends JPanel {
        @Override public boolean isShowing() { return isVisible(); }
    }
    static boolean nativeFocused;
    static class Browser {
        void setFocus(boolean focus) { nativeFocused = focus; events.add("native:" + focus); }
    }
    static class Panel {
        final JPanel component = new JPanel();
        Browser getCefBrowser() { return new Browser(); }
        JPanel getComponent() { return component; }
    }
    final Project myProject = new Project();
    final Toolbar toolbarPanel = new Toolbar();
    final JPanel myHtmlPanelWrapper = new JPanel();
    final JTextField searchField = new JTextField("query");
    final JLabel searchCount = new JLabel("3 matches");
    Panel myPanel = new Panel();
    ${method('@Nullable JComponent getPreferredFocusedComponent()')}
    ${method('void visibleToolbarPanel(boolean visible)')}
    static void check(boolean condition, String message) {
        if (!condition) throw new AssertionError(message);
    }
    static void drain() {
        while (!later.isEmpty()) later.remove().run();
        while (!settled.isEmpty()) settled.remove().run();
    }
    static SearchFocusHarness fresh() {
        events.clear(); later.clear(); settled.clear(); nativeFocused = true;
        return new SearchFocusHarness();
    }
    public static void main(String[] args) {
        SearchFocusHarness editor = fresh();
        editor.visibleToolbarPanel(true);
        check(editor.getPreferredFocusedComponent() == editor.searchField, "IDE restores browser instead of search");
        check(events.isEmpty(), "Focus requested before layout");
        drain();
        check(events.equals(List.of("native:false", "search")), "Incorrect focus handoff: " + events);
        check(editor.searchField.getSelectedText().equals("query"), "Existing query not selected");
        editor.visibleToolbarPanel(false);
        check(editor.getPreferredFocusedComponent() == editor.myPanel.getComponent(), "Browser not preferred after close");
        check(editor.searchField.getText().isEmpty(), "Query not cleared");
        check(editor.searchCount.getText().isEmpty(), "Count not cleared");
        editor = fresh(); editor.visibleToolbarPanel(true); editor.visibleToolbarPanel(false); drain();
        check(events.isEmpty(), "Closed search steals focus");
        editor = fresh(); editor.visibleToolbarPanel(true); later.remove().run();
        check(!settled.isEmpty(), "Focus must wait for pending IDE transfers");
        editor.visibleToolbarPanel(false); drain();
        check(!events.contains("search"), "Search closed during settling steals focus");
        editor = fresh(); editor.visibleToolbarPanel(true); editor.myProject.disposed = true; drain();
        check(events.isEmpty(), "Disposed project steals focus");
        editor = fresh(); editor.visibleToolbarPanel(true); later.remove().run();
        editor.myProject.disposed = true; drain();
        check(!events.contains("search"), "Disposed project steals focus after settling");
        editor = fresh(); editor.myPanel = null; editor.visibleToolbarPanel(false);
        check(editor.getPreferredFocusedComponent() == null, "Failed browser initialization not handled");
    }
}
`
    const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'markdown-search-focus-'))
    try {
        fs.writeFileSync(path.join(directory, 'SearchFocusHarness.java'), java)
        const javaBin = process.env.SEARCH_TEST_JAVA ||
            '/Applications/IntelliJ IDEA.app/Contents/jbr/Contents/Home/bin/java'
        const result = spawnSync(javaBin, ['-Djava.awt.headless=true', 'SearchFocusHarness.java'], {
            cwd: directory, encoding: 'utf8', timeout: 30000,
        })
        assert.equal(result.status, 0, result.stderr || result.error?.message || result.stdout)
    } finally {
        fs.rmSync(directory, {recursive: true, force: true})
    }
})

// A Swing focus assertion cannot detect a native NSView retaining text input.
test('file editors use off-screen rendering instead of a competing native keyboard view', () => {
    const panel = fs.readFileSync(path.join(__dirname,
        '../src/main/java/com/shuzijun/markdown/editor/MarkdownHtmlPanel.java'), 'utf8')
    const method = panel.slice(panel.indexOf('private static boolean offScreenRendering'),
        panel.indexOf('class MyMultiPanel'))
    assert.match(method, /return isFileEditor;/)
})
