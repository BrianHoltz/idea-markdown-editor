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
  if (event.key !== 'Backspace') return
  const node = range.startContainer
  const element = node.nodeType === Node.ELEMENT_NODE ? node : node.parentElement
  const paragraph = element && element.closest('p')
  if (paragraph && paragraph.parentElement.matches('[contenteditable=true]') &&
      paragraph.closest('.vditor-wysiwyg, .vditor-ir') &&
      !paragraph.textContent.replace(/[\s\u200b]/g, '') && !paragraph.querySelector('img, input, code')) {
    const before = paragraph.previousElementSibling
    const after = paragraph.nextElementSibling
    if (before && after && /^(UL|OL)$/.test(before.tagName) && before.tagName === after.tagName &&
        before.getAttribute('data-tight') === after.getAttribute('data-tight') &&
        /^(UL|OL)$/.test(before.lastElementChild?.lastElementChild?.tagName)) {
      const merged = before.cloneNode(true)
      const count = merged.children.length
      merged.append(...Array.from(after.children).map(child => child.cloneNode(true)))
      event.preventDefault()
      event.stopImmediatePropagation()
      range.setStartBefore(before)
      range.setEndAfter(after)
      selection.removeAllRanges()
      selection.addRange(range)
      document.execCommand('insertHTML', false, merged.outerHTML)
      const current = selection.anchorNode.nodeType === Node.ELEMENT_NODE
        ? selection.anchorNode : selection.anchorNode.parentElement
      const inserted = current.closest('ul, ol')
      const target = inserted && inserted.children[count - 1]?.querySelector('ul, ol')
      if (target) {
        const walker = document.createTreeWalker(target, NodeFilter.SHOW_TEXT)
        let text
        while (walker.nextNode()) if (walker.currentNode.textContent.trim()) text = walker.currentNode
        if (text) selection.collapse(text, text.textContent.length)
      }
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

// Remove a complete leaf line without asking Chromium to reinsert its list
// tree: insertHTML reparses loose lists and can change every nested boundary.
function fixListSelectionDelete(event, selection, range) {
  const elementAt = node => node.nodeType === Node.ELEMENT_NODE ? node : node.parentElement
  const item = elementAt(range.startContainer)?.closest('li')
  const root = item?.closest('[contenteditable=true]')
  if (!item || !root || !root.contains(range.endContainer) ||
      !root.closest('.vditor-wysiwyg, .vditor-ir') || item.querySelector('ul, ol')) return
  const meaningful = fragment => fragment.textContent.replace(/[\s\u200b]/g, '') ||
    fragment.querySelector('img, input, code, br')
  const before = document.createRange()
  before.selectNodeContents(item)
  before.setEnd(range.startContainer, range.startOffset)
  const prefix = before.cloneContents()
  // Task markers belong to the line even when selection starts at its text.
  prefix.querySelectorAll('input[type=checkbox]').forEach(marker => marker.remove())
  if (meaningful(prefix)) return
  const afterItem = document.createRange()
  afterItem.setStartAfter(item)
  afterItem.collapse(true)
  const end = range.cloneRange()
  end.collapse(false)
  // Text-only selections still use native deletion and leave an empty bullet.
  if (end.compareBoundaryPoints(Range.START_TO_START, afterItem) < 0) return
  const remainder = range.cloneRange()
  remainder.setStartAfter(item)
  if (meaningful(remainder.cloneContents())) return
  event.preventDefault()
  event.stopImmediatePropagation()
  const parent = item.parentElement
  const offset = Array.prototype.indexOf.call(parent.childNodes, item)
  const container = parent.parentElement
  const listOffset = Array.prototype.indexOf.call(container.childNodes, parent)
  item.remove()
  if (!parent.children.length) {
    parent.remove()
    selection.collapse(container, listOffset)
  } else selection.collapse(parent, Math.min(offset, parent.childNodes.length))
  // Vditor owns rich-mode undo and persistence. Its input pipeline records the
  // targeted DOM edit without Chromium reparsing untouched list ancestors.
  root.dispatchEvent(new InputEvent('input', {
    bubbles: true,
    inputType: event.key === 'Delete' ? 'deleteContentForward' : 'deleteContentBackward'
  }))
}

if (typeof module !== 'undefined') module.exports = { fixListBackspace }
