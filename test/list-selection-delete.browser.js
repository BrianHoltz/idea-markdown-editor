// Run in the bundled Vditor fixture in Canary; no synthetic DOM substitutes.
async function testListSelectionDelete() {
    const results = []
    const settle = () => new Promise(resolve => setTimeout(resolve, editor.vditor.options.undoDelay + 100))
    const check = (condition, message) => { if (!condition) throw new Error(message) }
    for (const mode of ['wysiwyg', 'ir']) {
        document.querySelector(`button[data-mode="${mode}"]`).click()
        for (const key of ['Backspace', 'Delete']) {
            for (const reverse of [false, true]) {
                editor.setValue(original)
                await settle()
                const root = editor.vditor[mode].element
                root.focus()
                const item = [...root.querySelectorAll('li')].find(li => li.textContent.startsWith('Other useful'))
                const next = item.parentElement.parentElement.nextElementSibling
                const walker = document.createTreeWalker(item, NodeFilter.SHOW_TEXT)
                const start = walker.nextNode()
                const end = document.createTreeWalker(next, NodeFilter.SHOW_TEXT).nextNode()
                const selection = getSelection()
                selection.setBaseAndExtent(reverse ? end : start, 0, reverse ? start : end, 0)
                const event = new KeyboardEvent('keydown', {key, bubbles: true, cancelable: true})
                root.dispatchEvent(event)
                if (!event.defaultPrevented) document.execCommand(key === 'Delete' ? 'forwardDelete' : 'delete')
                await settle()
                const markdown = editor.getValue()
                const expected = original.replace('  - Other useful signals: poll latency, source freshness and read failures.\n', '')
                check(markdown === expected, `${mode}/${key}/${reverse}: corrupted Markdown: ${markdown}`)
                editor.vditor.undo.undo(editor.vditor)
                await settle()
                check(editor.getValue() === original, `${mode}/${key}: undo lost original structure`)
                editor.vditor.undo.redo(editor.vditor)
                await settle()
                check(editor.getValue() === expected, `${mode}/${key}: redo lost deletion`)
                results.push(`${mode}/${key}/${reverse ? 'reverse' : 'forward'}: deletion + undo + redo`)
            }
        }
    }
    for (const mode of ['wysiwyg', 'ir']) {
        document.querySelector(`button[data-mode="${mode}"]`).click()
        editor.setValue(original)
        await settle()
        const root = editor.vditor[mode].element
        const item = [...root.querySelectorAll('li')].find(li => li.textContent.startsWith('Other useful'))
        const next = item.parentElement.parentElement.nextElementSibling
        const start = document.createTreeWalker(item, NodeFilter.SHOW_TEXT).nextNode()
        const end = document.createTreeWalker(next, NodeFilter.SHOW_TEXT).nextNode()
        const cases = [
            {name: 'partial start', startOffset: 3},
            {name: 'partial end', endOffset: 3},
            {name: 'text only', end: start, endOffset: start.length},
            {name: 'collapsed forward delete', end: start},
            {name: 'composition', isComposing: true},
            {name: 'modified', ctrlKey: true},
            {name: 'shift modified', shiftKey: true},
            {name: 'unrelated key', key: 'Enter'}
        ]
        for (const scenario of cases) {
            getSelection().setBaseAndExtent(start, scenario.startOffset || 0, scenario.end || end, scenario.endOffset || 0)
            const event = new KeyboardEvent('keydown', {key: 'Delete', cancelable: true, ...scenario})
            fixListBackspace(event)
            check(!event.defaultPrevented, `${mode}: intercepted ${scenario.name}`)
            check(editor.getValue() === original, `${mode}: changed ${scenario.name}`)
        }
        results.push(`${mode}: partial selections, composition, modifiers and unrelated keys untouched`)
    }
    return results
}
