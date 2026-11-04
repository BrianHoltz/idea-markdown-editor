// Cut, copy and paste of whole list lines. Vditor serializes the DOM fragment a
// selection clones, which leaves an empty trailing "-" item whenever the selection
// ends at the start of the next line, then pastes list Markdown with insertHTML at
// the caret, which blends the pasted items into the target line. Here whole lines
// travel as clean Markdown and land as siblings of the line the caret is on.
// Depends on list-lines.js.

function fixListCopy(event, vditor) {
  const selection = getSelection()
  if (!selection || !selection.rangeCount) return
  const found = selectedLines(selection.getRangeAt(0))
  if (!found || !found.wholeLines) return
  event.preventDefault()
  event.stopImmediatePropagation()
  event.clipboardData.setData('text/plain', linesToMarkdown(found.lines, vditor))
  event.clipboardData.setData('text/html', '')
  if (event.type !== 'cut') return
  removeLines(found.lines, selection)
  notifyEdit(found.root, 'deleteByCut')
}

// Pasted text counts as list lines only when every line starts with a list marker.
// Common indentation is dropped so lines copied from a nested level are not code.
function pastedItems(text, vditor) {
  const lines = text.replace(/\r\n?/g, '\n').split('\n').filter(line => line.trim())
  if (!lines.length || !lines.every(line => /^\s*([-*+]|\d{1,9}[.)])(\s|$)/.test(line)) || typeof Lute === 'undefined') return null
  const indent = Math.min(...lines.map(line => line.match(/^[ \t]*/)[0].length))
  const toDom = vditor.currentMode === 'ir' ? vditor.lute.Md2VditorIRDOM : vditor.lute.Md2VditorDOM
  const holder = document.createElement('div')
  holder.innerHTML = Lute.Sanitize(toDom.call(vditor.lute, lines.map(line => line.slice(indent)).join('\n')))
  const lists = Array.from(holder.children)
  if (!lists.length || !lists.every(list => LIST_TAG.test(list.tagName))) return null
  return lists.flatMap(list => Array.from(list.children))
}

function fixListPaste(event, vditor) {
  const selection = getSelection()
  if (!selection || !selection.rangeCount || !selection.isCollapsed) return
  const caret = selection.getRangeAt(0)
  const target = elementOf(caret.startContainer)?.closest('li')
  const root = target?.closest('[contenteditable=true]')
  if (!root || !root.closest('.vditor-wysiwyg, .vditor-ir')) return
  const own = ownRange(target)
  if (own.comparePoint(caret.startContainer, caret.startOffset) !== 0) return
  const head = own.cloneRange()
  head.setEnd(caret.startContainer, caret.startOffset)
  const tail = own.cloneRange()
  tail.setStart(caret.startContainer, caret.startOffset)
  const atStart = !hasContent(head, true)
  const atEnd = !hasContent(tail)
  if (!atStart && !atEnd) return
  const items = pastedItems(event.clipboardData.getData('text/plain'), vditor)
  if (!items) return
  event.preventDefault()
  event.stopImmediatePropagation()
  // Pasted lines take on the list type of the line they land beside.
  const marker = target.getAttribute('data-marker')
  if (marker) items.forEach(item => item.setAttribute('data-marker', marker))
  const hasChildren = Array.from(target.children).some(child => LIST_TAG.test(child.tagName))
  if (atStart && atEnd && !hasChildren) target.replaceWith(...items)
  else if (atStart) target.before(...items)
  else target.after(...items)
  collapseInItem(selection, items[items.length - 1], false)
  notifyEdit(root, 'insertFromPaste')
}

function installListClipboard(getVditor) {
  for (const type of ['copy', 'cut']) document.addEventListener(type, event => fixListCopy(event, getVditor()), true)
  document.addEventListener('paste', event => fixListPaste(event, getVditor()), true)
}
