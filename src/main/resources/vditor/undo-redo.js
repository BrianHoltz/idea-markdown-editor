// Cmd+Z is handled by Vditor's toolbar hotkey, but redo is mapped only to Cmd+Y.
// Chromium's own history (an IDE Edit-menu action, a native binding) knows nothing
// about the DOM edits Vditor makes, so route it to Vditor's history instead.

function fixRedoShortcut(event, vditor) {
  const modifier = navigator.platform.includes('Mac') ? event.metaKey : event.ctrlKey
  if (!modifier || !event.shiftKey || event.altKey || event.isComposing || event.key.toLowerCase() !== 'z') return
  if (!event.target.closest?.('.vditor-wysiwyg, .vditor-ir, .vditor-sv')) return
  event.preventDefault()
  event.stopImmediatePropagation()
  vditor.undo.redo(vditor)
}

function routeNativeHistory(event, vditor) {
  if (event.inputType !== 'historyUndo' && event.inputType !== 'historyRedo') return
  if (!event.target.closest?.('.vditor-wysiwyg, .vditor-ir, .vditor-sv')) return
  event.preventDefault()
  if (event.inputType === 'historyUndo') vditor.undo.undo(vditor)
  else vditor.undo.redo(vditor)
}

function installUndoRedo(getVditor) {
  document.addEventListener('keydown', event => fixRedoShortcut(event, getVditor()), true)
  document.addEventListener('beforeinput', event => routeNativeHistory(event, getVditor()), true)
}
