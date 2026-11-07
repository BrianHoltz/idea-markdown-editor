const {test} = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const root = path.resolve(__dirname, '..');
const read = file => fs.readFileSync(path.join(root, file), 'utf8');
const action = read('src/main/java/com/shuzijun/markdown/editor/MarkdownOutlineAction.java');
const shortcuts = read('src/main/java/com/shuzijun/markdown/editor/MarkdownOutlineShortcuts.java');
const plugin = read('src/main/resources/META-INF/plugin.xml');

// Source contracts, not installed-IDE acceptance tests.
test('outline exposes all PSI headings in document order without collapsed tree nodes', () => {
  assert.match(action, /findChildrenOfType\(psiFile, MarkdownHeader.class\)/);
  assert.match(action, /sorted\(Comparator.comparingInt\(MarkdownHeader::getTextOffset\)\)/);
  assert.match(action, /createPopupChooserBuilder\(headings\)/);
  assert.doesNotMatch(action, /JTree|collapsePath|setRootVisible/);
  assert.match(action, /heading.level\(\) - 1/);
  assert.match(action, /setVisibleRowCount\(20\)/);
  assert.match(action, /setResizable\(true\)/);
});

test('chooser supports search, selection navigation and outside-click cancellation', () => {
  assert.match(action, /setNamerForFiltering\(Heading::title\)/);
  assert.match(action, /setItemChosenCallback\(heading -> navigate\(editor, heading\)\)/);
  assert.match(action, /setCancelOnClickOutside\(true\)/);
  assert.match(action, /createMessage\("No Markdown headings"\)/);
});

test('heading extraction uses parser anchor and visible text, including duplicate and Setext headings', () => {
  assert.match(action, /header.buildVisibleText\(false\)/);
  assert.match(action, /header.getAnchorText\(\)/);
  assert.match(action, /commitDocument\(document\)/);
  assert.doesNotMatch(action, /replaceAll|split\("\\n"\)/);
});

test('navigation preserves rich, split-preview and source editor instances', () => {
  assert.match(action, /rich.scrollToAnchor\(heading.anchor\(\)\)/);
  assert.match(action, /split.getPreviewEditor\(\) instanceof MarkdownPreviewFileEditor/);
  assert.match(action, /preview.scrollToLine\(source,/);
  assert.match(action, /scrollToCaret\(ScrollType.CENTER\)/);
  assert.doesNotMatch(action, /openFile\(|setLayout\(|scrollToLine\(null/);
  assert.match(action, /releaseEditor\(owned\)/);
});

test('shortcut routing precedes JCEF, follows active keymap and stays inside owning document', () => {
  assert.match(shortcuts, /addKeyEventDispatcher\(dispatcher\)/);
  assert.match(shortcuts, /removeKeyEventDispatcher\(dispatcher\)/);
  assert.match(shortcuts, /getActiveKeymap\(\)/);
  assert.match(shortcuts, /MarkdownOutlineAction.ID, "FileStructurePopup"/);
  assert.match(shortcuts, /isDescendingFrom\(focus, editor.getComponent\(\)\)/);
  assert.match(shortcuts, /event.getID\(\) != KeyEvent.KEY_PRESSED/);
  assert.match(shortcuts, /keyboard.getSecondKeyStroke\(\) == null/);
});

test('outline is registered at startup with non-F12 shortcut and visible menu/toolbar controls', () => {
  assert.match(plugin, /postStartupActivity implementation="com.shuzijun.markdown.editor.MarkdownOutlineShortcuts"/);
  assert.match(plugin, /id="markdown.outline"/);
  assert.match(plugin, /keymap="Mac OS X 10.5\+" first-keystroke="meta alt O"/);
  assert.match(plugin, /group-id="GoToCodeGroup" anchor="before" relative-to-action="FileStructurePopup"/);
  assert.match(plugin, /group-id="MainToolbarRight"/);
});
