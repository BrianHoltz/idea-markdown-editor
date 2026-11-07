// Shared by Delete, cut, copy and paste in rich Markdown lists. A "line" is a list
// item's own content: everything in the <li> except its nested lists.
const LIST_TAG = /^(UL|OL)$/

function elementOf(node) {
  return node.nodeType === Node.ELEMENT_NODE ? node : node.parentElement
}

function meaningful(fragment) {
  return !isBlank(fragment.textContent) || fragment.querySelector('img, input, code, br')
}

// Placeholder breaks make an editable blank line, not user content.
function emptyOwnLine(item) {
  const content = ownRange(item).cloneContents()
  content.querySelectorAll('br, input[type=checkbox]').forEach(node => node.remove())
  return !meaningful(content)
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
function trackListTripleClick(event) {
  const selection = getSelection()
  tripleClickRange = event.detail === 3 && selection.rangeCount ? selection.getRangeAt(0).cloneRange() : null
}

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
  while (walker.nextNode()) if (walker.currentNode.parentElement.closest('li') === item &&
      !isBlank(walker.currentNode.data)) nodes.push(walker.currentNode)
  const text = atStart ? nodes[0] : nodes[nodes.length - 1]
  if (text) selection.collapse(text, atStart ? 0 : text.length)
  else {
    const own = ownRange(item)
    own.collapse(atStart)
    selection.removeAllRanges()
    selection.addRange(own)
  }
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

// Splitting at the first character creates a sibling without reparsing the
// parent: a transient leading blank '-' child otherwise becomes a Setext heading.
function fixListStartEnter(event, vditor) {
  if (event.shiftKey || event.altKey || event.ctrlKey || event.metaKey || event.isComposing) return
  const selection = getSelection()
  if (!selection?.isCollapsed || !selection.rangeCount) return
  const caret = selection.getRangeAt(0)
  const item = elementOf(caret.startContainer)?.closest('li')
  const root = item?.closest('[contenteditable=true]')
  if (!root || !root.closest('.vditor-wysiwyg, .vditor-ir')) return
  if (emptyOwnLine(item)) {
    if (!outdentItem(item)) return
    event.preventDefault()
    event.stopImmediatePropagation()
    collapseInItem(selection, item, true)
    vditor[vditor.currentMode].preventInput = true
    notifyEdit(root, 'insertParagraph')
    return
  }
  if (item.parentElement.tagName !== 'UL' || item.classList.contains('vditor-task')) return
  const block = elementOf(caret.startContainer).closest('pre, code, table, h1, h2, h3, h4, h5, h6')
  if (block && item.contains(block)) return
  const head = ownRange(item)
  if (head.comparePoint(caret.startContainer, caret.startOffset) !== 0) return
  head.setEnd(caret.startContainer, caret.startOffset)
  if (hasContent(head, true)) return
  event.preventDefault()
  event.stopImmediatePropagation()
  const blank = item.cloneNode(false)
  const content = item.querySelector(':scope > p') ? blank.appendChild(document.createElement('p')) : blank
  content.appendChild(document.createElement('br'))
  item.before(blank)
  collapseInItem(selection, item, true)
  vditor[vditor.currentMode].preventInput = true
  notifyEdit(root, 'insertParagraph')
}

function isBlank(text) {
  return !text.replace(/[\s\u200b]/g, '')
}

// Extract only editable inline content, never the nested lists or task marker.
function takeLineContent(item) {
  const fragment = ownRange(item).extractContents()
  fragment.querySelectorAll('input[type=checkbox]').forEach(node => node.remove())
  const inline = document.createDocumentFragment()
  for (const node of Array.from(fragment.childNodes)) {
    if (node.nodeType === Node.ELEMENT_NODE && node.tagName === 'P') inline.append(...node.childNodes)
    else inline.append(node)
  }
  const textNodes = document.createTreeWalker(inline, NodeFilter.SHOW_TEXT)
  while (textNodes.nextNode()) textNodes.currentNode.data = textNodes.currentNode.data.replace(/\u200b/g, '')
  // A task's separating whitespace is syntax, not part of its displayed text.
  if (item.classList.contains('vditor-task')) {
    const walker = document.createTreeWalker(inline, NodeFilter.SHOW_TEXT)
    if (walker.nextNode()) walker.currentNode.data = walker.currentNode.data.replace(/^[\s\u200b]+/, '')
  }
  return inline
}

// All boundary joins use removeLines' promotion rule. Pin the join point with a
// real text node so typing continues there even after children have been moved.
function joinLines(earlier, later, selection) {
  const content = takeLineContent(later)
  const end = ownRange(earlier)
  const paragraph = earlier.querySelector(':scope > p')
  if (paragraph) { end.selectNodeContents(paragraph); end.collapse(false) }
  else end.collapse(false)
  const anchor = document.createTextNode('')
  end.insertNode(anchor)
  anchor.after(content)
  if (later.tagName === 'LI') removeLines([later], selection)
  else later.remove()
  selection.collapse(anchor, 0)
}

function unwrapFirstLine(item, selection) {
  const list = item.parentElement
  const paragraph = document.createElement('p')
  paragraph.append(takeLineContent(item))
  list.before(paragraph)
  removeLines([item], selection)
  // The paragraph and the single surviving list are separate Markdown blocks.
  const walker = document.createTreeWalker(paragraph, NodeFilter.SHOW_TEXT)
  if (walker.nextNode()) selection.collapse(walker.currentNode, 0)
  else selection.collapse(paragraph, 0)
}

// Inline code is ordinary inline text here; block code and headings are not.
function listBoundaryContext(range) {
  const element = elementOf(range.startContainer)
  const item = element?.closest('li')
  const root = item?.closest('[contenteditable=true]')
  if (!root || !root.closest('.vditor-wysiwyg, .vditor-ir') || emptyOwnLine(item) ||
      element.closest('table, h1, h2, h3, h4, h5, h6') ||
      (element.closest('pre') && element.closest('pre') !== root)) return null
  const own = ownRange(item)
  if (own.comparePoint(range.startContainer, range.startOffset) !== 0) return null
  const head = own.cloneRange(), tail = own.cloneRange()
  head.setEnd(range.startContainer, range.startOffset)
  tail.setStart(range.startContainer, range.startOffset)
  const content = part => {
    const fragment = part.cloneContents()
    fragment.querySelectorAll('input[type=checkbox]').forEach(node => node.remove())
    return !isBlank(fragment.textContent) || fragment.querySelector('img, br')
  }
  return {item, root, atStart: !content(head), atEnd: !content(tail)}
}

function handleListBoundary(event, selection, range) {
  const context = listBoundaryContext(range)
  if (!context) return false
  const {item, root, atStart, atEnd} = context
  const backward = event.key === 'Backspace'
  if (!(backward ? atStart : atEnd)) return false
  const lines = Array.from(root.querySelectorAll('li'))
  const index = lines.indexOf(item)
  const neighbour = lines[index + (backward ? -1 : 1)]
  // Do not jump across a heading/paragraph or across independent root blocks.
  const topBlock = node => { while (node.parentElement !== root) node = node.parentElement; return node }
  const block = topBlock(item)
  if (neighbour && (topBlock(neighbour) === block ||
      (backward ? block.previousElementSibling : block.nextElementSibling) === topBlock(neighbour))) {
    joinLines(backward ? neighbour : item, backward ? item : neighbour, selection)
  } else if (backward) {
    // A nested first line always has a parent above it. Only root items unwrap.
    if (item.parentElement.parentElement !== root || item !== item.parentElement.firstElementChild) return false
    unwrapFirstLine(item, selection)
  } else {
    const next = block.nextElementSibling
    if (next?.tagName === 'P') joinLines(item, next, selection)
    // No next line, or a heading/code block: keep this boundary intact.
  }
  return true
}

// Preserve a soft line break before nested lists. Chromium's terminal <br> is
// otherwise treated as an editable placeholder and disappears on the next input.
function fixListSoftBreak(event, vditor) {
  if (event.key !== 'Enter' || !event.shiftKey || event.metaKey || event.ctrlKey || event.altKey || event.isComposing) return
  const selection = getSelection()
  if (!selection?.isCollapsed || !selection.rangeCount) return
  const range = selection.getRangeAt(0)
  const item = elementOf(range.startContainer)?.closest('li')
  const root = item?.closest('[contenteditable=true]')
  if (!root || !root.closest('.vditor-ir, .vditor-wysiwyg') ||
      item.querySelector('pre, table')?.contains(range.startContainer)) return
  const text = document.createTextNode('\n\u200b')
  range.insertNode(text)
  selection.collapse(text, text.length)
  event.preventDefault()
  event.stopImmediatePropagation()
  vditor[vditor.currentMode].preventInput = true
  notifyEdit(root, 'insertLineBreak')
}
