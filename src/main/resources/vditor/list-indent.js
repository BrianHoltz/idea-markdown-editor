// Vditor indents a list item with Tab only while the caret is on its first character,
// so Tab pressed after typing the text does nothing. Indent and outdent from anywhere
// in the line instead. A selection still goes through Vditor, which can indent several
// lines at once. Depends on list-lines.js.

function lastNestedList(item) {
  return Array.from(item.children).reverse().find(child => LIST_TAG.test(child.tagName))
}

// An ordered item keeps its number in data-marker; number the list from `start`,
// or from its first item's number.
function renumber(list, start) {
  if (list.tagName !== 'OL' || !list.children.length) return
  const [, number, delimiter] = /^(\d+)(\D)$/.exec(list.firstElementChild.getAttribute('data-marker')) || []
  if (!number) return
  Array.from(list.children).forEach((item, index) =>
    item.setAttribute('data-marker', ((start ?? Number(number)) + index) + delimiter))
}

// Under the line above, after that line's own sub-bullets.
function indentItem(item) {
  const previous = item.previousElementSibling
  if (!previous || previous.tagName !== 'LI') return false
  const source = item.parentElement
  const existing = lastNestedList(previous)
  const list = existing || previous.appendChild(source.cloneNode(false))
  list.append(item)
  renumber(source)
  renumber(list, existing ? undefined : 1)
  return true
}

// After its parent line. Lines that followed it become its sub-bullets, so
// nothing else changes depth.
function outdentItem(item) {
  const source = item.parentElement
  const parentItem = source.parentElement
  if (parentItem.tagName !== 'LI') return false
  const following = []
  for (let next = item.nextElementSibling; next; next = next.nextElementSibling) following.push(next)
  parentItem.after(item)
  if (following.length) {
    const existing = lastNestedList(item)
    const list = existing || item.appendChild(source.cloneNode(false))
    list.append(...following)
    renumber(list, existing ? undefined : 1)
  }
  renumber(parentItem.parentElement)
  if (!source.children.length) source.remove()
  return true
}

function fixListIndent(event) {
  if (event.key !== 'Tab' || event.ctrlKey || event.altKey || event.metaKey || event.isComposing) return
  const selection = getSelection()
  if (!selection || !selection.rangeCount || !selection.isCollapsed) return
  const {startContainer, startOffset} = selection.getRangeAt(0)
  const item = elementOf(startContainer)?.closest('li')
  const root = item?.closest('[contenteditable=true]')
  if (!root || !root.closest('.vditor-wysiwyg, .vditor-ir')) return
  // The editor root is itself a <pre>; only a code block or table inside the item counts.
  const inert = elementOf(startContainer).closest('pre, code, table')
  if (inert && item.contains(inert)) return
  if (!(event.shiftKey ? outdentItem(item) : indentItem(item))) return
  event.preventDefault()
  event.stopImmediatePropagation()
  selection.collapse(startContainer, startOffset)
  notifyEdit(root, event.shiftKey ? 'formatOutdent' : 'formatIndent')
}
