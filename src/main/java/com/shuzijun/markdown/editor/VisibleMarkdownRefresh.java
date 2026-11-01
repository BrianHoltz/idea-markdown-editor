package com.shuzijun.markdown.editor;

import com.intellij.openapi.fileEditor.FileEditor;
import com.intellij.openapi.fileEditor.FileEditorManager;
import com.intellij.openapi.project.DumbAware;
import com.intellij.openapi.project.Project;
import com.intellij.openapi.startup.StartupActivity;
import com.intellij.openapi.util.Disposer;
import com.intellij.openapi.vfs.VirtualFile;
import com.intellij.openapi.vfs.newvfs.NewVirtualFile;
import com.intellij.openapi.vfs.newvfs.RefreshQueue;
import org.jetbrains.annotations.NotNull;

import javax.swing.SwingUtilities;
import javax.swing.Timer;
import java.util.HashSet;
import java.util.Set;

/** A bounded VFS fallback for visible Markdown editors, including IDEA's own preview. */
public final class VisibleMarkdownRefresh implements StartupActivity, DumbAware {
    @Override
    public void runActivity(@NotNull Project project) {
        SwingUtilities.invokeLater(() -> {
            if (project.isDisposed()) return;
            // Project-local state; never accumulate refreshes behind a busy VFS queue.
            boolean[] refreshing = {false};
            Timer watcher = new Timer(2000, event -> {
                if (project.isDisposed() || refreshing[0]) return;
                Set<VirtualFile> files = new HashSet<>();
                for (FileEditor editor : FileEditorManager.getInstance(project).getAllEditors()) {
                    VirtualFile file = editor.getFile();
                    if (file == null || !file.isValid() || !file.isInLocalFileSystem()
                            || !editor.getComponent().isShowing()) continue;
                    String extension = file.getExtension();
                    if ("md".equalsIgnoreCase(extension) || "markdown".equalsIgnoreCase(extension)
                            || "mdx".equalsIgnoreCase(extension)) files.add(file);
                }
                if (files.isEmpty()) return;
                for (VirtualFile file : files) {
                    // A refresh alone can trust the cached clean flag when native events are delayed.
                    if (file instanceof NewVirtualFile localFile) localFile.markDirty();
                }
                refreshing[0] = true;
                RefreshQueue.getInstance().refresh(true, false,
                        () -> SwingUtilities.invokeLater(() -> refreshing[0] = false), files);
            });
            Disposer.register(project, watcher::stop);
            watcher.start();
        });
    }
}
