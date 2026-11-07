# markdown-editor

IntelliJ Platform A full-featured WYSIWYG editor for markdown

- [English Document](#Features)
- [中文文档](https://github.com/shuzijun/markdown-editor/blob/main/README_ZH.md)
- Useful Links
  - [Custom Style](https://github.com/shuzijun/markdown-editor/blob/main/assets/CustomStyle.md)

# Features

* Support three editing modes: WYSIWYG, Instant Rendering and Split View
* Support outline, mathematical formulas, mind maps, charts, flowcharts, Gantt charts, timing charts,  heading anchors, code highlighting, graphviz rendering.
* Support picture paste, file upload or drag and insert quickly.
* Support using IDE to open files quickly
* More function reference [vditor features](https://github.com/Vanessa219/vditor/blob/master/README_en_US.md#--features)

# Introduction

* After installing the plugin, open the .md file,select **Markdown Editor** at the bottom of the editor.
* There is no need to uninstall the default markdown plugin. The editor of the current plugin appears after the default editor.
* Ensure that the IDE supports JCEF.

# Heading navigation

Use **Navigate → Markdown Outline**, the main-toolbar outline button, or **⌘⌥O** on macOS (**Ctrl+Alt+O** elsewhere). Rebind **Markdown Outline** in Settings → Keymap. The popup lists every heading in document order, indented by level; type to filter, then click once or press Enter to jump and dismiss. Escape or clicking outside cancels. Long outlines scroll; there are no collapsed branches.

The action supports this editor, IDEA's Markdown source editor, and its rendered preview without opening another editor or changing the preview layout. While a Markdown editor has focus, its configured **File Structure** shortcut also opens this picker; macOS must still deliver function keys to IDEA. Shortcut routing is scoped to the focused document and released when it closes.

Build/source-contract checks do not establish installed-IDE acceptance. Verify shortcut delivery, single-click dismissal, and scrolling in each mode after installing the build.

# Development

See the [hierarchical list editing test and fix plan](test/ListEditingTestPlan.md) for regression coverage, expected editing behavior, and implementation acceptance criteria.

Run the complete browser suite serially with `node test/list-suite.mjs`; it uses Chrome Canary and the shared agent profile. Run the Node checks with `node --test test/*.test.cjs`. Individual sheets accept a row-name filter, for example `node test/list-joins.sheet.mjs reported`. `DEFAULT_UNDO=1 node test/list-joins.sheet.mjs reported` uses Vditor's production undo delay.

Build the plugin with `JAVA_HOME="/Applications/IntelliJ IDEA.app/Contents/jbr/Contents/Home" ./gradlew buildPlugin`. The ZIP is written to `build/distributions/`.

# Demo

![demo.gif](https://raw.githubusercontent.com/shuzijun/markdown-editor/main/assets/demo.gif)

# Acknowledgement

* [vditor](https://github.com/Vanessa219/vditor)
