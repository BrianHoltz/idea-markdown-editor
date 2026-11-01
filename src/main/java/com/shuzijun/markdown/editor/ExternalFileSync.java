package com.shuzijun.markdown.editor;

import com.intellij.openapi.Disposable;
import com.intellij.openapi.editor.Document;
import com.intellij.openapi.editor.event.DocumentEvent;
import com.intellij.openapi.editor.event.DocumentListener;
import com.intellij.openapi.util.Disposer;
import org.jetbrains.annotations.NotNull;

import javax.swing.SwingUtilities;
import javax.swing.Timer;

/** Coalesce VFS-backed document events before notifying JCEF. */
final class ExternalFileSync {
    ExternalFileSync(Document document, MarkdownHtmlPanel panel, Disposable parent) {
        Timer delivery = new Timer(75, event -> {
            if (!panel.isDisposed()) {
                panel.getCefBrowser().executeJavaScript(
                        "if (typeof editFocus === 'function' && typeof vditor !== 'undefined') editFocus();",
                        panel.getCefBrowser().getURL(), 0);
            }
        });
        delivery.setRepeats(false);
        document.addDocumentListener(new DocumentListener() {
            @Override
            public void documentChanged(@NotNull DocumentEvent event) {
                SwingUtilities.invokeLater(() -> {
                    if (!panel.isDisposed()) delivery.restart();
                });
            }
        }, parent);
        Disposer.register(parent, () -> {
            delivery.stop();
        });
    }
}
