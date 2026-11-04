// Shared by Delete, cut, copy and paste in rich Markdown lists. A "line" is a list
// item's own content: everything in the <li> except its nested lists.
const LIST_TAG = /^(UL|OL)$/

function elementOf(node) {
  return node.nodeType === Node.ELEMENT_NODE ? node : node.parentElement
}

function meaningful(fragment) {
  return fragment.textContent.replace(/[\s\u200b]/g, '') || fragment.querySelector('img, input, code, br')
}

// A task marker belongs to its line even when a selection starts at the text.
function hasContent(range, ignoreTaskMarker) {
  const fragment = range.cloneContents()
  if (ignoreTaskMarker) fragment.querySelectorAll('input[type=checkbox]').forEach(marker => marker.remove())
  return meaningful(fragment)
}

function ownRange(item) {
  const range = document.createRange()
  range.selectNodeContents(item)
  const nested = Array.from(item.children).find(child => LIST_TAG.test(child.tagName))
  if (nested) range.setEndBefore(nested)
  return range
}

// Triple-clicking the last line of a document selects only its text, exactly like
// dragging across it. Remember what a triple-click selected so that, while it is
// still the selection, it counts as selecting the line.
let tripleClickRange = null
document.addEventListener('mouseup', event => {
  const selection = getSelection()
  tripleClickRange = event.detail === 3 && selection.rangeCount ? selection.getRangeAt(0).cloneRange() : null
}, true)

function isTripleClickSelection(range) {
  return !!tripleClickRange && range.compareBoundaryPoints(Range.START_TO_START, tripleClickRange) === 0 &&
    range.compareBoundaryPoints(Range.END_TO_END, tripleClickRange) === 0
}

// The whole lines a selection takes in, or null when it is an ordinary text edit.
// It must begin at a line start, end at a line end or beyond it, and select nothing
// but lines. `wholeLines` is false for text selected within a single line.
function selectedLines(range) {
  const root = elementOf(range.commonAncestorContainer)?.closest('[contenteditable=true]')
  if (!root || !root.closest('.vditor-wysiwyg, .vditor-ir') || range.collapsed) return null
  const lines = []
  for (const item of root.querySelectorAll('li')) {
    if (!range.intersectsNode(item)) continue
    const own = ownRange(item)
    const startsBefore = range.compareBoundaryPoints(Range.START_TO_START, own)
    const endsAfter = range.compareBoundaryPoints(Range.END_TO_END, own)
    const part = own.cloneRange()
    if (startsBefore > 0) part.setStart(range.startContainer, range.startOffset)
    if (endsAfter < 0) part.setEnd(range.endContainer, range.endOffset)
    // Blank bullets count only when the selection runs strictly past both sides.
    if (!hasContent(part) && !(startsBefore < 0 && endsAfter > 0)) continue
    const head = own.cloneRange()
    head.setEnd(part.startContainer, part.startOffset)
    const tail = own.cloneRange()
    tail.setStart(part.endContainer, part.endOffset)
    if (hasContent(head, true) || hasContent(tail)) return null
    lines.push(item)
  }
  if (!lines.length) return null
  const first = ownRange(lines[0])
  const last = ownRange(lines[lines.length - 1])
  const lead = range.cloneRange()
  if (range.compareBoundaryPoints(Range.START_TO_START, first) < 0) {
    lead.setEnd(first.startContainer, first.startOffset)
    if (hasContent(lead)) return null
  }
  const pastEnd = range.compareBoundaryPoints(Range.END_TO_END, last) > 0
  if (pastEnd) {
    const trail = range.cloneRange()
    trail.setStart(last.endContainer, last.endOffset)
    if (hasContent(trail)) return null
  }
  return {lines, root, wholeLines: lines.length > 1 || pastEnd || isTripleClickSelection(range)}
}

// Put the caret inside a real list item. A caret parked in the list itself makes
// Vditor's input handler rebuild the block around it: the neighbouring item turns
// into a paragraph with a literal "- " prefix and the whole list goes loose.
function collapseInItem(selection, item, atStart) {
  const nodes = []
  const walker = document.createTreeWalker(item, NodeFilter.SHOW_TEXT)
  while (walker.nextNode()) if (walker.currentNode.parentElement.closest('li') === item) nodes.push(walker.currentNode)
  const text = atStart ? nodes[0] : nodes[nodes.length - 1]
  if (text) selection.collapse(text, atStart ? 0 : text.length)
  else selection.collapse(item, 0)
}

// Remove whole lines. Sub-bullets that were not selected move up into the removed
// line's place, so selecting a parent's own line never discards its children.
function removeLines(lines, selection) {
  const root = lines[0].closest('[contenteditable=true]')
  const removed = new Set(lines)
  const survivors = Array.from(root.querySelectorAll('li')).filter(item => !removed.has(item))
  const following = survivors.find(item => lines[0].compareDocumentPosition(item) & Node.DOCUMENT_POSITION_FOLLOWING)
  const previous = survivors.filter(item => !(lines[0].compareDocumentPosition(item) & Node.DOCUMENT_POSITION_FOLLOWING)).pop()
  const list = lines[0].parentElement
  const container = list.parentElement
  const listOffset = Array.prototype.indexOf.call(container.childNodes, list)
  for (const item of [...lines].reverse()) {
    const parent = item.parentElement
    Array.from(item.children).filter(child => LIST_TAG.test(child.tagName))
      .flatMap(nested => Array.from(nested.children)).forEach(child => parent.insertBefore(child, item))
    item.remove()
    if (!parent.children.length) parent.remove()
  }
  if (following) collapseInItem(selection, following, true)
  else if (previous) collapseInItem(selection, previous, false)
  else selection.collapse(container, Math.min(listOffset, container.childNodes.length))
}

// Markdown for whole lines, with their relative indentation. Unselected
// descendants are left out, and the lines become siblings when depths differ.
function linesToMarkdown(lines, vditor) {
  const chosen = new Set(lines)
  const branch = item => {
    const copy = item.cloneNode(false)
    for (const child of item.childNodes) {
      if (!LIST_TAG.test(child.tagName)) { copy.append(child.cloneNode(true)); continue }
      const kept = Array.from(child.children).filter(nested => chosen.has(nested))
      if (!kept.length) continue
      const list = child.cloneNode(false)
      kept.forEach(nested => list.append(branch(nested)))
      copy.append(list)
    }
    return copy
  }
  const wrapper = lines[0].parentElement.cloneNode(false)
  lines.filter(item => !chosen.has(item.parentElement.closest('li'))).forEach(item => wrapper.append(branch(item)))
  const toMarkdown = vditor.currentMode === 'ir' ? vditor.lute.VditorIRDOM2Md : vditor.lute.VditorDOM2Md
  return toMarkdown.call(vditor.lute, wrapper.outerHTML).replace(/\n+$/, '')
}

// Vditor records undo and persistence from its input pipeline.
function notifyEdit(root, inputType) {
  root.dispatchEvent(new InputEvent('input', {bubbles: true, inputType}))
}
