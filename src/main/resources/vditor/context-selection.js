/* Optional harness integration. No harness API or clipboard access. */
(function (root) {
    function snapshot(text) {
        const chars = Array.from(text);
        let first = 2166136261, second = 5381;
        for (const char of chars) {
            first = Math.imul(first ^ char.codePointAt(0), 16777619);
            second = Math.imul(second, 33) ^ char.codePointAt(0);
        }
        return {version: 1, origin: 'rendered', length: chars.length,
            head: chars.slice(0, 80).join(''),
            tail: chars.length > 160 ? chars.slice(-80).join('') : '',
            text: chars.length <= 160 ? text : '',
            id: `${chars.length}:${first >>> 0}:${second >>> 0}`};
    }
    root.contextSelectionSnapshot = snapshot;
    if (typeof document === 'undefined') return;
    let timer;
    document.addEventListener('selectionchange', () => {
        clearTimeout(timer);
        timer = setTimeout(() => {
            const selection = window.getSelection();
            // Losing focus to a harness must not erase the last editor selection.
            if (!selection || !selection.anchorNode) return;
            const element = selection.anchorNode.nodeType === 1 ? selection.anchorNode : selection.anchorNode.parentElement;
            if (!element || !element.closest('.vditor-content')) return;
            const end = selection.focusNode.nodeType === 1 ? selection.focusNode : selection.focusNode.parentElement;
            if (!end || !end.closest('.vditor-content')) return;
            if (typeof root.jsPublishContextSelection === 'function') {
                root.jsPublishContextSelection(selection.isCollapsed ? '' : JSON.stringify(snapshot(selection.toString())));
            }
        }, 75);
    });
})(typeof window === 'undefined' ? globalThis : window);
