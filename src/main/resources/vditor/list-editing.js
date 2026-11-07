// The fixture and production install exactly the same rich-list listeners.
function installListEditing(getVditor) {
  document.addEventListener('mouseup', trackListTripleClick, true)
  document.addEventListener('keydown', event => {
    if (event.key !== 'Enter') return
    if (event.shiftKey) fixListSoftBreak(event, getVditor())
    else fixListStartEnter(event, getVditor())
  }, true)
  document.addEventListener('keydown', fixListBackspace, true)
  document.addEventListener('keydown', fixListIndent, true)
  installListClipboard(getVditor)
  installUndoRedo(getVditor)
}
