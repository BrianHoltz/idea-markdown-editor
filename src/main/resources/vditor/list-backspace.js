// Chromium leaves the caret in whitespace after a nested list when an empty
// sibling is deleted. Backspacing there creates a paragraph and loosens the list.
// Treat that invisible boundary as navigation, not a content edit.
function fixListBackspace(event) {
  if (!['Backspace', 'Delete'].includes(event.key) || event.altKey || event.ctrlKey ||
      event.metaKey || event.shiftKey || event.isComposing) return
  const selection = window.getSelection()
  if (!selection || !selection.rangeCount) return
  const range = selection.getRangeAt(0)
  if (!selection.isCollapsed) {
    fixListSelectionDelete(event, selection, range)
    return
  }
  const node = range.startContainer
  const element = elementOf(node)
  const root = element?.closest('[contenteditable=true]')
  if (!root || !root.closest('.vditor-wysiwyg, .vditor-ir')) return
  const emptyItem = element.closest('li')
  if (event.key === 'Delete' && emptyItem && emptyOwnLine(emptyItem) &&
      !emptyItem.querySelector('ul, ol')) {
    event.preventDefault()
    event.stopImmediatePropagation()
    removeLines([emptyItem], selection)
    notifyEdit(root, 'deleteContentForward')
    return
  }
  if (event.key !== 'Backspace') return
  const paragraph = element.closest('p')
  if (paragraph && paragraph.parentElement === root &&
      !paragraph.textContent.replace(/[\s\u200b]/g, '') && !paragraph.querySelector('img, input, code')) {
    const before = paragraph.previousElementSibling
    const after = paragraph.nextElementSibling
    if (before && LIST_TAG.test(before.tagName) && (!after || !LIST_TAG.test(after.tagName) ||
        (before.tagName === after.tagName && before.getAttribute('data-tight') === after.getAttribute('data-tight')))) {
      const previous = before.lastElementChild
      if (after && LIST_TAG.test(after.tagName)) {
        before.append(...Array.from(after.children))
        after.remove()
      }
      paragraph.remove()
      event.preventDefault()
      event.stopImmediatePropagation()
      const items = previous.querySelectorAll('li')
      collapseInItem(selection, items.length ? items[items.length - 1] : previous, false)
      notifyEdit(root, 'deleteContentBackward')
      return
    }
  }
  const item = element && element.closest('li')
  if (!item || !item.closest('.vditor-wysiwyg, .vditor-ir')) return
  const list = item.lastElementChild
  if (!list || !/^(UL|OL)$/.test(list.tagName) ||
      range.comparePoint(list, list.childNodes.length) !== -1) return
  const tail = document.createRange()
  tail.setStartAfter(list)
  tail.setEnd(item, item.childNodes.length)
  if (tail.cloneContents().querySelector('*') || tail.toString().replace(/[\s\u200b]/g, '')) return
  const walker = document.createTreeWalker(list, NodeFilter.SHOW_TEXT)
  let lastText
  while (walker.nextNode()) {
    if (walker.currentNode.textContent.replace(/[\s\u200b]/g, '')) lastText = walker.currentNode
  }
  if (!lastText) return
  event.preventDefault()
  event.stopImmediatePropagation()
  selection.collapse(lastText, lastText.textContent.length)
}

// Remove whole selected lines ourselves: native deletion merges neighbouring items,
// and reinserting HTML makes Chromium reparse loose lists and change every boundary.
// Text selected within a single line stays a native edit and leaves an empty bullet.
function fixListSelectionDelete(event, selection, range) {
  const found = selectedLines(range)
  if (!found || !found.wholeLines) return
  event.preventDefault()
  event.stopImmediatePropagation()
  removeLines(found.lines, selection)
  notifyEdit(found.root, event.key === 'Delete' ? 'deleteContentForward' : 'deleteContentBackward')
}

if (typeof module !== 'undefined') module.exports = { fixListBackspace }
