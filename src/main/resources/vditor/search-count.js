// Count only the active editor surface, not hidden modes or toolbar text.
function countMarkdownMatches(query) {
    if (!query) return 0;
    const roots = Array.from(document.querySelectorAll(
        '#vditor .vditor-ir .vditor-reset, #vditor .vditor-wysiwyg .vditor-reset, #vditor .vditor-sv'
    ));
    const root = roots.find(element => element.getClientRects().length > 0);
    if (!root) return 0;
    const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT, {
        acceptNode(node) {
            const parent = node.parentElement;
            return parent && parent.getClientRects().length > 0 &&
                !parent.closest('script, style, [aria-hidden="true"]')
                ? NodeFilter.FILTER_ACCEPT : NodeFilter.FILTER_REJECT;
        }
    });
    let text = '';
    let node;
    while ((node = walker.nextNode())) text += node.textContent;
    // Escape regex syntax so punctuation remains a literal search string.
    const literal = query.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    return (text.match(new RegExp(literal, 'gi')) || []).length;
}
