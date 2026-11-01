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

// A line selection may end at the next item's first character without selecting
// that character. Native deletion merges those items, even across list depths.
function fixListSelectionDelete(event, selection, range) {
  const elementAt = node => node.nodeType === Node.ELEMENT_NODE ? node : node.parentElement
  const item = elementAt(range.startContainer)?.closest('li')
  const next = elementAt(range.endContainer)?.closest('li')
  const root = item?.closest('[contenteditable=true]')
  if (!item || !next || item === next || !root || !root.contains(next) ||
      !root.closest('.vditor-wysiwyg, .vditor-ir')) return
  const before = document.createRange()
  before.selectNodeContents(item)
  before.setEnd(range.startContainer, range.startOffset)
  const prefix = document.createRange()
  prefix.selectNodeContents(next)
  prefix.setEnd(range.endContainer, range.endOffset)
  const meaningful = fragment => fragment.textContent.replace(/[\s\u200b]/g, '') ||
    fragment.querySelector('img, input, code, br')
  if (meaningful(before.cloneContents()) || meaningful(prefix.cloneContents())) return
  const remainder = range.cloneRange()
  remainder.setStartAfter(item)
  // Only a complete leaf item and structural whitespace may be selected.
  if (item.querySelector('ul, ol') || meaningful(remainder.cloneContents())) return
  let list = item.parentElement
  while (list.parentElement !== root && list.parentElement.closest('ul, ol')) {
    list = list.parentElement.closest('ul, ol')
  }
  if (!list.contains(next)) return
  const items = Array.from(list.querySelectorAll('li'))
  const copy = list.cloneNode(true)
  const removed = copy.querySelectorAll('li')[items.indexOf(item)]
  const parent = removed.parentElement
  removed.remove()
  if (!parent.children.length) parent.remove()
  event.preventDefault()
  event.stopImmediatePropagation()
  range.selectNode(list)
  selection.removeAllRanges()
  selection.addRange(range)
  // Native insertion records one undoable edit and emits Vditor's input event.
  document.execCommand('insertHTML', false, copy.outerHTML)
}

if (typeof module !== 'undefined') module.exports = { fixListBackspace }
