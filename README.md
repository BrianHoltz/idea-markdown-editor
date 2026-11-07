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

# Development

See the [hierarchical list editing test and fix plan](test/ListEditingTestPlan.md) for regression coverage, expected editing behavior, and implementation acceptance criteria.

Run the complete browser suite serially with `node test/list-suite.mjs`; it uses Chrome Canary and the shared agent profile. Run the Node checks with `node --test test/*.test.cjs`. Individual sheets accept a row-name filter, for example `node test/list-joins.sheet.mjs reported`. `DEFAULT_UNDO=1 node test/list-joins.sheet.mjs reported` uses Vditor's production undo delay.

Build the plugin with `JAVA_HOME="/Applications/IntelliJ IDEA.app/Contents/jbr/Contents/Home" ./gradlew buildPlugin`. The ZIP is written to `build/distributions/`.

# Demo

![demo.gif](https://raw.githubusercontent.com/shuzijun/markdown-editor/main/assets/demo.gif)

# Acknowledgement

* [vditor](https://github.com/Vanessa219/vditor)
