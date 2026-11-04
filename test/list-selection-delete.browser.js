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
    results.push(...await testListSelectionBoundaries())
    results.push(...await testSiblingSelectionDelete())
    return results
}

// Removing an item whose neighbour is a sibling must leave the caret inside a
// list item. A caret parked in the list itself makes Vditor turn the next item
// into a paragraph with a literal "- " and loosen the whole list.
async function testSiblingSelectionDelete() {
    const results = []
    const settle = () => new Promise(resolve => setTimeout(resolve, editor.vditor.options.undoDelay + 100))
    const check = (condition, label) => { if (!condition) throw new Error(label) }
    const value = '## TODO\n\n- First\n- Second\n- Third with children\n  - Child\n- Fourth\n'
    const scenarios = [
        {name: 'first', target: 'First', end: 'nextText'},
        {name: 'first to next item', target: 'First', end: 'nextItem'},
        {name: 'first to list end', target: 'First', end: 'listEnd'},
        {name: 'middle', target: 'Second', end: 'nextText'},
        {name: 'last', target: 'Fourth', end: 'listEnd'}
    ]
    for (const mode of ['wysiwyg', 'ir']) {
        document.querySelector(`button[data-mode="${mode}"]`).click()
        for (const scenario of scenarios) {
            for (const key of ['Backspace', 'Delete']) {
                editor.setValue(value)
                await settle()
                const root = editor.vditor[mode].element
                root.focus()
                const item = [...root.querySelectorAll('li')].find(li => li.textContent.startsWith(scenario.target))
                const next = item.nextElementSibling
                const start = document.createTreeWalker(item, NodeFilter.SHOW_TEXT).nextNode()
                const range = document.createRange()
                range.setStart(start, 0)
                if (scenario.end === 'nextText') range.setEnd(document.createTreeWalker(next, NodeFilter.SHOW_TEXT).nextNode(), 0)
                else if (scenario.end === 'nextItem') range.setEnd(next, 0)
                else range.setEndAfter(item)
                getSelection().setBaseAndExtent(range.startContainer, range.startOffset, range.endContainer, range.endOffset)
                const before = editor.getValue()
                const expected = before.replace(new RegExp(`^- ${scenario.target}\\n`, 'm'), '')
                const event = new KeyboardEvent('keydown', {key, bubbles: true, cancelable: true})
                root.dispatchEvent(event)
                if (!event.defaultPrevented) document.execCommand(key === 'Delete' ? 'forwardDelete' : 'delete')
                await settle()
                const label = `${mode}/sibling ${scenario.name}/${key}`
                check(editor.getValue() === expected, `${label}: ${JSON.stringify(editor.getValue())}`)
                check(![...root.querySelectorAll('p')].some(p => p.textContent.startsWith('- ')), `${label}: list item became a paragraph`)
                const caretItem = (getSelection().anchorNode?.nodeType === Node.ELEMENT_NODE
                    ? getSelection().anchorNode : getSelection().anchorNode?.parentElement)?.closest('li')
                check(caretItem, `${label}: caret left outside list items`)
                editor.vditor.undo.undo(editor.vditor)
                await settle()
                check(editor.getValue() === before, `${label}: undo`)
                editor.vditor.undo.redo(editor.vditor)
                await settle()
                check(editor.getValue() === expected, `${label}: redo`)
                results.push(`${label}: deletion + caret + undo + redo`)
            }
        }
    }
    return results
}


async function testListSelectionBoundaries() {
    const results = []
    const settle = () => new Promise(resolve => setTimeout(resolve, editor.vditor.options.undoDelay + 100))
    const check = (condition, label) => { if (!condition) throw new Error(label) }
    const tight = '- Parent\n  - Keep\n  - Remove\n- Other\n  - Keep too\n'
    const scenarios = [
        {name: 'next text', value: tight},
        {name: 'item boundary', value: tight, end: 'item'},
        {name: 'list boundary', value: tight, end: 'list'},
        {name: 'parent boundary', value: tight, end: 'parent'},
        {name: 'loose list', value: tight.replace('- Other', '\n- Other')},
        {name: 'paragraphs', value: tight.replace('  - Keep', '\n  Description.\n\n  - Keep')},
        {name: 'deep list', value: tight.replace('  - Keep\n  - Remove', '  - Branch\n    - Keep\n    - Remove')},
        {name: 'only child', value: tight.replace('  - Keep\n', '')},
        {name: 'ordered', value: tight.replaceAll('- ', '1. ').replaceAll('  1.', '   1.')},
        {name: 'task list', value: tight.replaceAll('  - ', '  - [x] ')}
    ]
    for (const mode of ['wysiwyg', 'ir']) {
        document.querySelector(`button[data-mode="${mode}"]`).click()
        for (const scenario of scenarios) {
            for (const key of ['Backspace', 'Delete']) {
                for (const reverse of [false, true]) {
                    editor.setValue(scenario.value)
                    await settle()
                    const before = editor.getValue()
                    const expected = before.replace(/^.*Remove.*\n/m, '')
                    const root = editor.vditor[mode].element
                    root.focus()
                    const item = [...root.querySelectorAll('li')].find(li =>
                        !li.querySelector('li') && li.textContent.includes('Remove'))
                    const next = [...root.querySelectorAll('li')].find(li => li.textContent.startsWith('Other'))
                    const start = document.createTreeWalker(item, NodeFilter.SHOW_TEXT).nextNode()
                    const range = document.createRange()
                    range.setStart(start, 0)
                    if (scenario.end === 'item') range.setEndAfter(item)
                    else if (scenario.end === 'list') range.setEndAfter(item.parentElement)
                    else if (scenario.end === 'parent') {
                        const parent = item.parentElement.parentElement
                        range.setEnd(parent, parent.childNodes.length)
                    } else range.setEnd(document.createTreeWalker(next, NodeFilter.SHOW_TEXT).nextNode(), 0)
                    const selection = getSelection()
                    selection.setBaseAndExtent(
                        reverse ? range.endContainer : range.startContainer,
                        reverse ? range.endOffset : range.startOffset,
                        reverse ? range.startContainer : range.endContainer,
                        reverse ? range.startOffset : range.endOffset)
                    const event = new KeyboardEvent('keydown', {key, bubbles: true, cancelable: true})
                    root.dispatchEvent(event)
                    if (!event.defaultPrevented) document.execCommand(key === 'Delete' ? 'forwardDelete' : 'delete')
                    await settle()
                    const label = `${mode}/${scenario.name}/${key}/${reverse}`
                    check(editor.getValue() === expected, `${label}: deletion: ${editor.getValue()}`)
                    editor.vditor.undo.undo(editor.vditor)
                    await settle()
                    check(editor.getValue() === before, `${label}: undo`)
                    editor.vditor.undo.redo(editor.vditor)
                    await settle()
                    check(editor.getValue() === expected, `${label}: redo`)
                    results.push(`${label}: deletion + undo + redo`)
                }
            }
        }
    }
    return results
}
