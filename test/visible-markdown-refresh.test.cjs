const assert = require('node:assert/strict')
const fs = require('node:fs')
const os = require('node:os')
const path = require('node:path')
const {spawnSync} = require('node:child_process')
const test = require('node:test')

const root = path.join(__dirname, '..')
const sourcePath = path.join(root, 'src/main/java/com/shuzijun/markdown/editor/VisibleMarkdownRefresh.java')

test('one lifecycle-bound watcher refreshes only visible local Markdown files, including built-in previews', () => {
    assert.ok(fs.existsSync(sourcePath), 'Missing shared visible-Markdown watcher')
    const production = fs.readFileSync(sourcePath, 'utf8')
        .replace(/^package .*;\s*/m, '').replace(/^import .*;\s*/gm, '')
    const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'visible-markdown-'))
    const stubs = `
import java.util.*;
import java.awt.event.*;
import javax.swing.JComponent;
@interface NotNull {}
interface DumbAware {}
interface StartupActivity { void runActivity(Project project); }
class Project { boolean disposed; boolean isDisposed() { return disposed; } }
class Disposer {
    static final List<Runnable> cleanup = new ArrayList<>();
    static void register(Project project, Runnable task) { cleanup.add(task); }
}
class Timer {
    static final List<Timer> instances = new ArrayList<>();
    final int delay; final ActionListener listener; boolean running;
    Timer(int delay, ActionListener listener) { this.delay = delay; this.listener = listener; instances.add(this); }
    void start() { running = true; }
    void stop() { running = false; }
    void tick() { listener.actionPerformed(null); }
}
class VirtualFile {
    String extension = "md"; boolean valid = true, local = true;
    boolean isValid() { return valid; }
    boolean isInLocalFileSystem() { return local; }
    String getExtension() { return extension; }
}
class NewVirtualFile extends VirtualFile {
    int dirty;
    void markDirty() { dirty++; }
}
class Component extends JComponent {
    boolean showing = true;
    @Override public boolean isShowing() { return showing; }
}
class FileEditor {
    final VirtualFile file; final Component component = new Component();
    FileEditor(VirtualFile file) { this.file = file; }
    VirtualFile getFile() { return file; }
    JComponent getComponent() { return component; }
}
class FileEditorManager {
    static FileEditor[] editors = {};
    static FileEditorManager getInstance(Project project) { return new FileEditorManager(); }
    FileEditor[] getAllEditors() { return editors; }
}
class RefreshQueue {
    static final RefreshQueue INSTANCE = new RefreshQueue();
    int calls; Runnable completion; Collection<VirtualFile> files;
    static RefreshQueue getInstance() { return INSTANCE; }
    void refresh(boolean async, boolean recursive, Runnable callback, Collection<VirtualFile> values) {
        if (!async || recursive) throw new AssertionError("Must be asynchronous and nonrecursive");
        calls++; completion = callback; files = values;
    }
    void finish() { completion.run(); }
}
class SwingUtilities { static void invokeLater(Runnable task) { task.run(); } }
`
    const harness = `
class VisibleRefreshHarness {
    static void check(boolean value) { if (!value) throw new AssertionError(); }
    public static void main(String[] args) {
        Project project = new Project();
        new VisibleMarkdownRefresh().runActivity(project);
        check(Timer.instances.size() == 1);
        Timer timer = Timer.instances.getFirst();
        check(timer.running && timer.delay > 0 && timer.delay <= 2500);
        timer.tick(); check(RefreshQueue.INSTANCE.calls == 0);
        NewVirtualFile file = new NewVirtualFile();
        FileEditor rich = new FileEditor(file), builtin = new FileEditor(file);
        FileEditor hidden = new FileEditor(new NewVirtualFile()); hidden.component.showing = false;
        FileEditor noFile = new FileEditor(null);
        NewVirtualFile invalid = new NewVirtualFile(); invalid.valid = false;
        NewVirtualFile remote = new NewVirtualFile(); remote.local = false;
        NewVirtualFile other = new NewVirtualFile(); other.extension = "java";
        FileEditorManager.editors = new FileEditor[]{rich, builtin, hidden, noFile,
            new FileEditor(invalid), new FileEditor(remote), new FileEditor(other)};
        timer.tick();
        check(RefreshQueue.INSTANCE.calls == 1 && file.dirty == 1);
        check(RefreshQueue.INSTANCE.files.size() == 1 && RefreshQueue.INSTANCE.files.contains(file));
        timer.tick(); check(RefreshQueue.INSTANCE.calls == 1 && file.dirty == 1);
        RefreshQueue.INSTANCE.finish();
        timer.tick(); check(RefreshQueue.INSTANCE.calls == 2 && file.dirty == 2);
        RefreshQueue.INSTANCE.finish();
        rich.component.showing = false;
        builtin.component.showing = false;
        timer.tick(); check(RefreshQueue.INSTANCE.calls == 2);
        // Visible tabs in separate splits, uppercase/long extensions and non-NewVirtualFile implementations.
        NewVirtualFile longExtension = new NewVirtualFile(); longExtension.extension = "MARKDOWN";
        NewVirtualFile mdx = new NewVirtualFile(); mdx.extension = "mdx";
        VirtualFile plain = new VirtualFile();
        FileEditorManager.editors = new FileEditor[]{new FileEditor(longExtension), new FileEditor(mdx), new FileEditor(plain)};
        timer.tick(); check(RefreshQueue.INSTANCE.calls == 3 && RefreshQueue.INSTANCE.files.size() == 3);
        check(longExtension.dirty == 1 && mdx.dirty == 1);
        RefreshQueue.INSTANCE.finish();
        other.extension = null;
        FileEditorManager.editors = new FileEditor[]{new FileEditor(other)};
        timer.tick(); check(RefreshQueue.INSTANCE.calls == 3);
        project.disposed = true;
        FileEditorManager.editors = new FileEditor[]{new FileEditor(file)};
        timer.tick(); check(RefreshQueue.INSTANCE.calls == 3);
        Disposer.cleanup.forEach(Runnable::run); check(!timer.running);
    }
}`
    try {
        fs.writeFileSync(path.join(directory, 'VisibleMarkdownRefresh.java'), stubs + production + harness)
        const home = process.env.JAVA_HOME || '/Applications/IntelliJ IDEA.app/Contents/jbr/Contents/Home'
        const compile = spawnSync(path.join(home, 'bin/javac'), [path.join(directory, 'VisibleMarkdownRefresh.java')], {encoding: 'utf8'})
        assert.equal(compile.status, 0, compile.stderr)
        const run = spawnSync(path.join(home, 'bin/java'), ['-cp', directory, 'VisibleRefreshHarness'], {encoding: 'utf8'})
        assert.equal(run.status, 0, run.stderr)
    } finally {
        fs.rmSync(directory, {recursive: true, force: true})
    }
})

test('shared watcher is registered independently of the custom editor', () => {
    const plugin = fs.readFileSync(path.join(root, 'src/main/resources/META-INF/plugin.xml'), 'utf8')
    assert.match(plugin, /postStartupActivity implementation="com\.shuzijun\.markdown\.editor\.VisibleMarkdownRefresh"/)
    const sync = fs.readFileSync(path.join(root, 'src/main/java/com/shuzijun/markdown/editor/ExternalFileSync.java'), 'utf8')
    assert.doesNotMatch(sync, /file\.refresh|Timer watcher/)
})
