package com.shuzijun.markdown.editor;

import com.intellij.openapi.actionSystem.AnAction;
import com.intellij.openapi.actionSystem.AnActionEvent;
import com.intellij.openapi.actionSystem.CustomShortcutSet;
import com.intellij.openapi.application.ApplicationManager;
import com.intellij.openapi.fileEditor.FileEditor;
import com.intellij.openapi.fileEditor.FileEditorManager;
import com.intellij.openapi.fileEditor.FileEditorManagerListener;
import com.intellij.openapi.keymap.KeymapManager;
import com.intellij.openapi.project.DumbAware;
import com.intellij.openapi.project.Project;
import com.intellij.openapi.startup.StartupActivity;
import com.intellij.openapi.util.Key;
import com.intellij.openapi.vfs.VirtualFile;
import org.jetbrains.annotations.NotNull;

import java.awt.KeyboardFocusManager;
import java.awt.event.KeyEvent;
import javax.swing.SwingUtilities;

/** Capture IDE shortcuts before a focused JCEF surface can consume them. */
public final class MarkdownOutlineShortcuts implements StartupActivity, DumbAware {
    private static final Key<Boolean> INSTALLED = Key.create("markdown.outline.shortcuts");

    @Override
    public void runActivity(@NotNull Project project) {
        var connection = project.getMessageBus().connect();
        connection.subscribe(FileEditorManagerListener.FILE_EDITOR_MANAGER, new FileEditorManagerListener() {
            @Override
            public void fileOpened(@NotNull FileEditorManager manager, @NotNull VirtualFile file) {
                for (FileEditor editor : manager.getEditors(file)) install(project, editor);
            }
        });
        ApplicationManager.getApplication().invokeLater(() -> {
            if (!project.isDisposed()) {
                for (FileEditor editor : FileEditorManager.getInstance(project).getAllEditors()) install(project, editor);
            }
        });
    }

    private static void install(Project project, FileEditor editor) {
        if (!MarkdownOutlineAction.supports(editor) || Boolean.TRUE.equals(editor.getUserData(INSTALLED))) return;
        editor.putUserData(INSTALLED, true);
        AnAction local = new com.intellij.openapi.project.DumbAwareAction() {
            @Override
            public void actionPerformed(@NotNull AnActionEvent event) {
                MarkdownOutlineAction.show(project, editor);
            }
        };
        local.registerCustomShortcutSet(new CustomShortcutSet(
                KeymapManager.getInstance().getActiveKeymap().getShortcuts(MarkdownOutlineAction.ID)),
                editor.getComponent(), editor);
        // A dispatcher runs before Chromium or the IDE's text-editor-only action context.
        var focusManager = KeyboardFocusManager.getCurrentKeyboardFocusManager();
        java.awt.KeyEventDispatcher dispatcher = event -> {
            if (event.getID() != KeyEvent.KEY_PRESSED || project.isDisposed()
                    || !editor.getComponent().isShowing()) return false;
            var focus = focusManager.getFocusOwner();
            if (focus == null || !SwingUtilities.isDescendingFrom(focus, editor.getComponent())) return false;
            var stroke = javax.swing.KeyStroke.getKeyStrokeForEvent(event);
            var keymap = KeymapManager.getInstance().getActiveKeymap();
            for (String action : new String[]{MarkdownOutlineAction.ID, "FileStructurePopup"}) {
                for (var shortcut : keymap.getShortcuts(action)) {
                    if (shortcut instanceof com.intellij.openapi.actionSystem.KeyboardShortcut keyboard
                            && keyboard.getSecondKeyStroke() == null
                            && keyboard.getFirstKeyStroke().equals(stroke)) {
                        event.consume();
                        ApplicationManager.getApplication().invokeLater(() -> MarkdownOutlineAction.show(project, editor));
                        return true;
                    }
                }
            }
            return false;
        };
        focusManager.addKeyEventDispatcher(dispatcher);
        com.intellij.openapi.util.Disposer.register(editor, () -> focusManager.removeKeyEventDispatcher(dispatcher));
    }
}
