package com.shuzijun.markdown.editor;

import com.intellij.icons.AllIcons;
import com.intellij.openapi.actionSystem.AnActionEvent;
import com.intellij.openapi.actionSystem.CommonDataKeys;
import com.intellij.openapi.actionSystem.PlatformDataKeys;
import com.intellij.openapi.editor.ScrollType;
import com.intellij.openapi.fileEditor.FileDocumentManager;
import com.intellij.openapi.fileEditor.FileEditor;
import com.intellij.openapi.fileEditor.FileEditorManager;
import com.intellij.openapi.fileEditor.TextEditor;
import com.intellij.openapi.fileEditor.TextEditorWithPreview;
import com.intellij.openapi.project.DumbAwareAction;
import com.intellij.openapi.project.Project;
import com.intellij.openapi.ui.popup.JBPopupFactory;
import com.intellij.openapi.vfs.VirtualFile;
import com.intellij.psi.PsiDocumentManager;
import com.intellij.psi.PsiManager;
import com.intellij.psi.util.PsiTreeUtil;
import com.intellij.ui.ColoredListCellRenderer;
import com.intellij.ui.SimpleTextAttributes;
import com.intellij.util.ui.JBUI;
import org.intellij.plugins.markdown.lang.psi.impl.MarkdownHeader;
import org.intellij.plugins.markdown.ui.preview.MarkdownPreviewFileEditor;
import org.jetbrains.annotations.NotNull;

import javax.swing.JList;
import java.util.Comparator;
import java.util.List;

/** A fully exposed heading list, not a collapsed code-structure tree. */
public final class MarkdownOutlineAction extends DumbAwareAction {
    public static final String ID = "markdown.outline";

    record Heading(String title, int level, int offset, String anchor) {}

    public MarkdownOutlineAction() {
        super("Markdown Outline", "Jump to a Markdown heading without changing editor mode", AllIcons.Toolwindows.ToolWindowStructure);
    }

    static boolean supports(FileEditor editor) {
        VirtualFile file = editor == null ? null : editor.getFile();
        if (file == null || !file.isValid()) return false;
        String extension = file.getExtension();
        return "md".equalsIgnoreCase(extension) || "markdown".equalsIgnoreCase(extension)
                || "mdx".equalsIgnoreCase(extension);
    }

    @Override
    public void update(@NotNull AnActionEvent event) {
        event.getPresentation().setEnabledAndVisible(event.getProject() != null && supports(target(event)));
    }

    @Override
    public void actionPerformed(@NotNull AnActionEvent event) {
        Project project = event.getProject();
        FileEditor editor = target(event);
        if (project != null && supports(editor)) show(project, editor);
    }

    private static FileEditor target(AnActionEvent event) {
        Project project = event.getProject();
        if (project == null) return null;
        FileEditor contextual = event.getData(PlatformDataKeys.FILE_EDITOR);
        VirtualFile file = supports(contextual) ? contextual.getFile() : event.getData(CommonDataKeys.VIRTUAL_FILE);
        FileEditorManager manager = FileEditorManager.getInstance(project);
        // Retain the composite editor even when focus reports only its source/preview child.
        FileEditor selected = file == null ? manager.getSelectedEditor() : manager.getSelectedEditor(file);
        return supports(selected) ? selected : contextual;
    }

    static List<Heading> headings(Project project, VirtualFile file) {
        var document = FileDocumentManager.getInstance().getDocument(file);
        if (document != null) PsiDocumentManager.getInstance(project).commitDocument(document);
        var psiFile = PsiManager.getInstance(project).findFile(file);
        if (psiFile == null) return List.of();
        return PsiTreeUtil.findChildrenOfType(psiFile, MarkdownHeader.class).stream()
                .sorted(Comparator.comparingInt(MarkdownHeader::getTextOffset))
                .map(header -> new Heading(header.buildVisibleText(false), header.getLevel(),
                        header.getTextOffset(), header.getAnchorText()))
                .toList();
    }

    static void show(Project project, FileEditor editor) {
        if (project.isDisposed() || !supports(editor)) return;
        var headings = headings(project, editor.getFile());
        if (headings.isEmpty()) {
            JBPopupFactory.getInstance().createMessage("No Markdown headings").showInCenterOf(editor.getComponent());
            return;
        }
        JBPopupFactory.getInstance().createPopupChooserBuilder(headings)
                .setTitle("Markdown Outline")
                .setNamerForFiltering(Heading::title)
                .setRenderer(new ColoredListCellRenderer<Heading>() {
                    @Override
                    protected void customizeCellRenderer(@NotNull JList<? extends Heading> list,
                                                         Heading heading, int index,
                                                         boolean selected, boolean hasFocus) {
                        setBorder(JBUI.Borders.empty(3, 8 + 16 * Math.max(0, heading.level() - 1), 3, 8));
                        append(heading.title(), SimpleTextAttributes.REGULAR_ATTRIBUTES);
                        getAccessibleContext().setAccessibleName("Heading level " + heading.level() + ": " + heading.title());
                    }
                })
                .setVisibleRowCount(20)
                .setCancelOnClickOutside(true)
                .setRequestFocus(true)
                .setResizable(true)
                .setMovable(true)
                .setItemChosenCallback(heading -> navigate(editor, heading))
                .createPopup().showInCenterOf(editor.getComponent());
    }

    private static final com.intellij.openapi.util.Key<com.intellij.openapi.editor.Editor> PREVIEW_SOURCE =
            com.intellij.openapi.util.Key.create("markdown.outline.preview.source");

    private static void scrollStandalonePreview(MarkdownPreviewFileEditor preview,
                                                com.intellij.openapi.editor.Document document, int offset) {
        var source = preview.getUserData(PREVIEW_SOURCE);
        if (source == null || source.isDisposed()) {
            source = com.intellij.openapi.editor.EditorFactory.getInstance().createViewer(document);
            preview.putUserData(PREVIEW_SOURCE, source);
            var owned = source;
            com.intellij.openapi.util.Disposer.register(preview,
                    () -> com.intellij.openapi.editor.EditorFactory.getInstance().releaseEditor(owned));
        }
        preview.scrollToLine(source, document.getLineNumber(Math.min(offset, document.getTextLength())));
    }

    private static void navigate(FileEditor editor, Heading heading) {
        if (!editor.isValid()) return;
        if (editor instanceof com.shuzijun.markdown.editor.MarkdownPreviewFileEditor rich) {
            rich.scrollToAnchor(heading.anchor());
        } else if (editor instanceof TextEditorWithPreview split) {
            var source = split.getTextEditor().getEditor();
            source.getCaretModel().moveToOffset(Math.min(heading.offset(), source.getDocument().getTextLength()));
            source.getScrollingModel().scrollToCaret(ScrollType.CENTER);
            if (split.getPreviewEditor() instanceof MarkdownPreviewFileEditor preview) {
                preview.scrollToLine(source, source.getDocument().getLineNumber(source.getCaretModel().getOffset()));
            }
        } else if (editor instanceof MarkdownPreviewFileEditor preview) {
            // Preview-only editors still have a document, but no text editor needs to be opened.
            var document = FileDocumentManager.getInstance().getDocument(editor.getFile());
            if (document != null) scrollStandalonePreview(preview, document, heading.offset());
        } else if (editor instanceof TextEditor text) {
            var source = text.getEditor();
            source.getCaretModel().moveToOffset(Math.min(heading.offset(), source.getDocument().getTextLength()));
            source.getScrollingModel().scrollToCaret(ScrollType.CENTER);
        }
        var component = editor.getPreferredFocusedComponent();
        if (component != null) component.requestFocusInWindow();
    }
}
