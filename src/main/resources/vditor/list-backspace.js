// Rich-list deletion dispatcher: selected lines, empty items, boundary joins,
// empty paragraphs between lists, and Chromium's trailing-list whitespace caret.
function fixListBackspace(event) {
  if (!['Backspace', 'Delete'].includes(event.key) || event.altKey || event.ctrlKey ||
      event.metaKey || event.shiftKey || event.isComposing) return
  const selection = getSelection()
  if (!selection?.rangeCount) return
  const range = selection.getRangeAt(0)
  if (!selection.isCollapsed) { fixListSelectionDelete(event, selection, range); return }
  const element = elementOf(range.startContainer)
  const root = element?.closest('[contenteditable=true]')
  if (!root || !root.closest('.vditor-wysiwyg, .vditor-ir')) return
  const context = {event, selection, range, element, root}
  for (const handler of [deleteEmptyItem, deleteListBoundary, deleteEmptyParagraph, navigateListTail]) {
    if (!handler(context)) continue
    event.preventDefault()
    event.stopImmediatePropagation()
    if (handler !== navigateListTail) notifyEdit(root, event.key === 'Delete' ? 'deleteContentForward' : 'deleteContentBackward')
    return
  }
}

function deleteEmptyItem({event, element, selection}) {
  const item = element.closest('li')
  if (event.key !== 'Delete' || !item || !emptyOwnLine(item) || item.querySelector('ul, ol')) return false
  removeLines([item], selection)
  return true
}

function deleteListBoundary({event, selection, range}) {
  return handleListBoundary(event, selection, range)
}

function deleteEmptyParagraph({event, element, root, selection}) {
  if (event.key !== 'Backspace') return false
  const paragraph = element.closest('p')
  if (paragraph && paragraph.parentElement === root &&
      isBlank(paragraph.textContent) && !paragraph.querySelector('img, input, code')) {
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
      const items = previous.querySelectorAll('li')
      collapseInItem(selection, items.length ? items[items.length - 1] : previous, false)
      return true
    }
  }
  return false
}

function navigateListTail({event, element, range, selection}) {
  if (event.key !== 'Backspace') return false
  const item = element && element.closest('li')
  if (!item || !item.closest('.vditor-wysiwyg, .vditor-ir')) return
  const list = item.lastElementChild
  if (!list || !/^(UL|OL)$/.test(list.tagName) ||
      range.comparePoint(list, list.childNodes.length) !== -1) return
  const tail = document.createRange()
  tail.setStartAfter(list)
  tail.setEnd(item, item.childNodes.length)
  if (tail.cloneContents().querySelector('*') || !isBlank(tail.toString())) return
  const walker = document.createTreeWalker(list, NodeFilter.SHOW_TEXT)
  let lastText
  while (walker.nextNode()) {
    if (!isBlank(walker.currentNode.textContent)) lastText = walker.currentNode
  }
  if (!lastText) return
  selection.collapse(lastText, lastText.textContent.length)
  return true
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
