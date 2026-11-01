package com.shuzijun.markdown.editor;

import com.google.common.escape.Escaper;
import com.google.common.net.PercentEscaper;
import com.google.common.net.UrlEscapers;
import com.intellij.ide.structureView.StructureViewBuilder;
import com.intellij.ide.structureView.StructureView;
import com.intellij.ide.structureView.StructureViewFactory;
import com.intellij.ide.structureView.StructureViewModel;
import com.intellij.ide.structureView.StructureViewModelBase;
import com.intellij.ide.structureView.StructureViewTreeElement;
import com.intellij.ide.ui.LafManagerListener;
import com.intellij.ide.ui.UISettings;
import com.intellij.ide.ui.UISettingsListener;
import com.intellij.ide.util.PropertiesComponent;
import com.intellij.lang.LanguageStructureViewBuilder;
import com.intellij.navigation.ItemPresentation;
import com.intellij.openapi.actionSystem.ActionManager;
import com.intellij.openapi.actionSystem.ActionToolbar;
import com.intellij.openapi.actionSystem.AnAction;
import com.intellij.openapi.actionSystem.DefaultActionGroup;
import com.intellij.openapi.application.ApplicationManager;
import com.intellij.openapi.diagnostic.Logger;
import com.intellij.openapi.editor.Document;
import com.intellij.openapi.editor.colors.EditorColorsManager;
import com.intellij.openapi.editor.colors.EditorColorsScheme;
import com.intellij.openapi.fileEditor.FileDocumentManager;
import com.intellij.openapi.fileEditor.FileEditor;
import com.intellij.openapi.fileEditor.FileEditorLocation;
import com.intellij.openapi.fileEditor.FileEditorState;
import com.intellij.openapi.wm.IdeFocusManager;
import com.intellij.openapi.project.Project;
import com.intellij.openapi.util.Disposer;
import com.intellij.openapi.util.UserDataHolderBase;
import com.intellij.openapi.util.io.FileUtilRt;
import com.intellij.openapi.vfs.VirtualFile;
import com.intellij.ide.util.treeView.smartTree.TreeElement;
import com.intellij.psi.PsiFile;
import com.intellij.psi.PsiElement;
import com.intellij.psi.PsiManager;
import com.intellij.ui.DocumentAdapter;
import com.intellij.ui.JBColor;
import com.intellij.ui.components.JBLabel;
import com.intellij.ui.components.JBPanel;
import com.intellij.ui.components.JBTextField;
import com.intellij.util.Url;
import com.intellij.util.Urls;
import com.intellij.util.io.URLUtil;
import com.intellij.util.messages.MessageBusConnection;
import com.shuzijun.markdown.controller.FileApplicationService;
import com.shuzijun.markdown.controller.PreviewStaticServer;
import com.shuzijun.markdown.controller.ResourcesController;
import com.shuzijun.markdown.model.PluginConstant;
import com.shuzijun.markdown.util.FileUtils;
import com.shuzijun.markdown.util.PropertiesUtils;
import org.apache.commons.lang3.StringUtils;
import org.jetbrains.annotations.Nls;
import org.jetbrains.annotations.NotNull;
import org.jetbrains.annotations.Nullable;
import org.jetbrains.ide.BuiltInServerManager;
import org.intellij.plugins.markdown.settings.MarkdownPreviewSettings;

import javax.swing.*;
import javax.swing.event.DocumentEvent;
import java.awt.*;
import java.beans.PropertyChangeListener;
import java.io.File;
import java.io.FileInputStream;
import java.io.IOException;
import java.io.InputStream;
import java.text.DecimalFormat;
import java.text.DecimalFormatSymbols;
import java.util.Locale;

/**
 * @author shuzijun
 */
public class MarkdownPreviewFileEditor extends UserDataHolderBase implements FileEditor {

    private static final com.intellij.openapi.util.Key<String> CONTEXT_SELECTION = com.intellij.openapi.util.Key.create("brian.editor.selection.v1");

    private static final Logger LOG = Logger.getInstance(MarkdownPreviewFileEditor.class);

    static final String URL_PATH_OTHER_SAFE_CHARS_LACKING_PLUS =
            "-._~" // Unreserved characters.
                    + "!$'()*,;&=" // The subdelim characters (excluding '+').
                    + "@:" // The gendelim characters permitted in paths.
                    + "/?"; // PATH
    private static final Escaper URL_FRAGMENT_ESCAPER = new PercentEscaper(URL_PATH_OTHER_SAFE_CHARS_LACKING_PLUS, true);

    private final Project myProject;
    private final VirtualFile myFile;
    private final Document myDocument;

    private final JPanel myHtmlPanelWrapper;
    private final MarkdownHtmlPanel myPanel;

    private final JBPanel toolbarPanel = new JBPanel(new FlowLayout(FlowLayout.LEFT, 4, 4));
    private final JBTextField searchField = new JBTextField();
    private final JBLabel searchCount = new JBLabel();

    private final Url servicePath = BuiltInServerManager.getInstance().addAuthToken(Urls.parseEncoded("http://localhost:" + BuiltInServerManager.getInstance().getPort() + PreviewStaticServer.PREFIX));
    private final String templateHtmlFile = "template/default.html";
    private final boolean isPresentableUrl;

    public MarkdownPreviewFileEditor(@NotNull Project project, @NotNull VirtualFile file) {
        myProject = project;
        myFile = file;
        myDocument = FileDocumentManager.getInstance().getDocument(myFile);
        myHtmlPanelWrapper = new JPanel(new BorderLayout());
        isPresentableUrl = project.getPresentableUrl() != null;
        Disposer.register(this, ApplicationManager.getApplication().getService(FileApplicationService.class)
                .registerVirtualFile(myFile.getPath(), isPresentableUrl ? project.getPresentableUrl() : project.getName(), myFile));
        String url = UrlEscapers.urlFragmentEscaper().escape(URLUtil.FILE_PROTOCOL + URLUtil.SCHEME_SEPARATOR + FileUtils.separator() + myFile.getPath());
        MarkdownHtmlPanel tempPanel = null;
        try {
            tempPanel = new MarkdownHtmlPanel(url, project, true);
            tempPanel.setContextSelectionListener(value -> {
                if (!myProject.isDisposed() && myFile.isValid()) myFile.putUserData(
                    CONTEXT_SELECTION, value.isEmpty() ? null : value);
            });
            tempPanel.loadMyHTML(createHtml(isPresentableUrl, tempPanel), url);
            tempPanel.setZoomLevel(UISettings.getInstance().getCurrentIdeScale());
            myHtmlPanelWrapper.add(tempPanel.getComponent(), BorderLayout.CENTER);

            MarkdownHtmlPanel finalTempPanel = tempPanel;
            finalTempPanel.setSearchCountListener((query, total) -> {
                if (!searchField.getText().equals(query)) return;
                searchCount.setText(query.isEmpty() ? "" : total + " matches");
                searchCount.getAccessibleContext().setAccessibleName(searchCount.getText());
            });
            toolbarPanel.setBorder(BorderFactory.createMatteBorder(0, 0, 1, 0, JBColor.border()));
            searchField.setPreferredSize(new Dimension(260, 28));
            searchField.putClientProperty("JTextField.placeholderText", "Search in Markdown");
            searchField.addActionListener(event -> finalTempPanel.browserFind(searchField.getText(), true));
            searchField.getDocument().addDocumentListener(new DocumentAdapter() {
                @Override
                protected void textChanged(@NotNull DocumentEvent e) {
                    finalTempPanel.browserFind(searchField.getText(), true);
                }
            });
            JButton previousButton = createSearchButton("Previous", "Previous match", () -> finalTempPanel.browserFind(searchField.getText(), false));
            JButton nextButton = createSearchButton("Next", "Next match", () -> finalTempPanel.browserFind(searchField.getText(), true));
            JButton closeButton = createSearchButton("Close", "Close search", () -> {
                searchField.setText("");
                visibleToolbarPanel(false);
            });
            toolbarPanel.add(searchField);
            toolbarPanel.add(searchCount);
            toolbarPanel.add(previousButton);
            toolbarPanel.add(nextButton);
            toolbarPanel.add(closeButton);
            AnAction searchAction = ActionManager.getInstance().getAction("markdown.search");
            AnAction searchVisibleAction = ActionManager.getInstance().getAction("markdown.searchVisible");
            ActionToolbar actionToolbar = ActionManager.getInstance().createActionToolbar(PluginConstant.EDITOR_TOOLBAR, new DefaultActionGroup(searchAction, searchVisibleAction), true);
            actionToolbar.setTargetComponent(myHtmlPanelWrapper);
            JComponent actionToolbarComponent = actionToolbar.getComponent();
            actionToolbarComponent.setVisible(false);
            toolbarPanel.add(actionToolbarComponent);
            toolbarPanel.setVisible(false);
            myHtmlPanelWrapper.add(toolbarPanel, BorderLayout.NORTH);
        } catch (IllegalStateException e) {
            myHtmlPanelWrapper.add(new JBLabel(e.getMessage()), BorderLayout.CENTER);
        }
        myPanel = tempPanel;
        myHtmlPanelWrapper.repaint();

        MessageBusConnection settingsConnection = ApplicationManager.getApplication().getMessageBus().connect(this);
        settingsConnection.subscribe(LafManagerListener.TOPIC, manager -> refreshAppearance());
        settingsConnection.subscribe(EditorColorsManager.TOPIC, scheme -> refreshAppearance());
        settingsConnection.subscribe(UISettingsListener.TOPIC, settings -> refreshAppearance());
        settingsConnection.subscribe(MarkdownPreviewSettings.ChangeListener.TOPIC, settings -> refreshAppearance());
        if (myPanel != null && myDocument != null) {
            new ExternalFileSync(myDocument, myPanel, this);
        }

    }


    @Override
    public void selectNotify() {
        refreshAppearance();
    }

    @Override
    public @NotNull JComponent getComponent() {
        return myHtmlPanelWrapper;
    }

    @Override
    public @Nullable JComponent getPreferredFocusedComponent() {
        if (toolbarPanel.isVisible()) return searchField;
        return myPanel != null ? myPanel.getComponent() : null;
    }

    @Override
    public @Nls(capitalization = Nls.Capitalization.Title) @NotNull String getName() {
        return "Markdown Editor";
    }

    @Override
    public void setState(@NotNull FileEditorState state) {

    }

    @Override
    public boolean isModified() {
        return false;
    }

    @Override
    public boolean isValid() {
        return true;
    }

    @Override
    public void addPropertyChangeListener(@NotNull PropertyChangeListener listener) {

    }

    @Override
    public void removePropertyChangeListener(@NotNull PropertyChangeListener listener) {

    }

    @Override
    public @Nullable FileEditorLocation getCurrentLocation() {
        return null;
    }

    @Override
    public StructureViewBuilder getStructureViewBuilder() {
        VirtualFile file = FileDocumentManager.getInstance().getFile(myDocument);
        if (file == null || !file.isValid()) return null;
        PsiFile psiFile = PsiManager.getInstance(myProject).findFile(file);
        StructureViewBuilder delegate = psiFile == null
                ? null
                : LanguageStructureViewBuilder.getInstance().getStructureViewBuilder(psiFile);
        if (delegate == null) return null;

        return new StructureViewBuilder() {
            @Override
            public StructureView createStructureView(@NotNull FileEditor editor, @NotNull Project project) {
                StructureView delegateView = delegate.createStructureView(editor, project);
                StructureViewModel delegateModel = delegateView.getTreeModel();
                StructureViewModel model = new StructureViewModelBase(
                        psiFile,
                        new PreservingStructureElement(delegateModel.getRoot())
                );
                StructureView view = StructureViewFactory.getInstance(project)
                        .createStructureView(editor, model, project);
                Disposer.register(view, delegateView);
                return view;
            }
        };
    }

    private final class PreservingStructureElement implements StructureViewTreeElement {
        private final StructureViewTreeElement delegate;

        private PreservingStructureElement(StructureViewTreeElement delegate) {
            this.delegate = delegate;
        }

        @Override
        public Object getValue() {
            return delegate.getValue();
        }

        @Override
        public ItemPresentation getPresentation() {
            return delegate.getPresentation();
        }

        @Override
        public TreeElement[] getChildren() {
            TreeElement[] children = delegate.getChildren();
            TreeElement[] wrapped = new TreeElement[children.length];
            for (int i = 0; i < children.length; i++) {
                wrapped[i] = children[i] instanceof StructureViewTreeElement structureElement
                        ? new PreservingStructureElement(structureElement)
                        : children[i];
            }
            return wrapped;
        }

        @Override
        public boolean canNavigate() {
            return getValue() instanceof PsiElement;
        }

        @Override
        public boolean canNavigateToSource() {
            return canNavigate();
        }

        @Override
        public void navigate(boolean requestFocus) {
            if (!(getValue() instanceof PsiElement element)) return;
            String heading = element.getText().replaceFirst("^\\s*#+\\s*", "").trim();
            if (!heading.isEmpty()) {
                String slug = heading.toLowerCase(Locale.ROOT)
                        .replaceAll("[^\\p{L}\\p{N}\\p{M}_\\- ]", "")
                        .replace(" ", "-");
                scrollToAnchor(slug);
            }
        }
    }

    @Override
    public void dispose() {
        myFile.putUserData(CONTEXT_SELECTION, null);
        if (myPanel != null) {
            Disposer.dispose(myPanel);
        }
    }

    public void openDevtools() {
        if (myPanel != null) {
            myPanel.openDevtools();
        }
    }

    public void scrollToAnchor(String fragment) {
        if (myPanel != null) {
            myPanel.scrollToAnchor(fragment);
        }
    }

    private String createHtml(boolean isPresentableUrl, MarkdownHtmlPanel tempPanel) {
        InputStream inputStream = null;

        try {
            File templateFile = new File(PluginConstant.TEMPLATE_PATH + templateHtmlFile);
            if (templateFile.exists()) {
                inputStream = new FileInputStream(templateFile);
            } else {
                inputStream = PreviewStaticServer.class.getResourceAsStream("/" + templateHtmlFile);
            }
            String template = new String(FileUtilRt.loadBytes(inputStream));
            return template.replace("{{service}}", servicePath.getScheme() + URLUtil.SCHEME_SEPARATOR + servicePath.getAuthority() + servicePath.getPath())
                    .replace("{{resources}}", ResourcesController.getVersionedPath())
                    .replace("{{serverToken}}", StringUtils.isNotBlank(servicePath.getParameters()) ? servicePath.getParameters().substring(1) : "")
                    .replace("{{filePath}}", URL_FRAGMENT_ESCAPER.escape(myFile.getPath()))
                    .replace("{{Lang}}", PropertiesUtils.getInfo("Lang"))
                    .replace("{{darcula}}", isDarkTheme() + "")
                    .replace("{{toolbarHidden}}", PropertiesComponent.getInstance().getBoolean(PluginConstant.editorToolbarHiddenKey, false) + "")
                    .replace("{{rawHtmlHidden}}", PropertiesComponent.getInstance().getBoolean(PluginConstant.editorRawHtmlHiddenKey, false) + "")
                    .replace("{{userTemplate}}", templateFile.exists() + "")
                    .replace("{{projectUrl}}", isPresentableUrl ? URL_FRAGMENT_ESCAPER.escape(myProject.getPresentableUrl()) : "")
                    .replace("{{projectName}}", isPresentableUrl ? "" : URL_FRAGMENT_ESCAPER.escape(myProject.getName()))
                    .replace("{{ideStyle}}", getStyle(true))
                    .replace("{{injectScript}}", tempPanel.getInjectScript())
                    ;
        } catch (IOException e) {
            throw new RuntimeException(e);
        } finally {
            if (inputStream != null) {
                try {
                    inputStream.close();
                } catch (IOException ignore) {
                }
            }
        }
    }

    @Override
    public @Nullable VirtualFile getFile() {
        return myFile;
    }

    private void refreshAppearance() {
        ApplicationManager.getApplication().invokeLater(() -> {
            if (myPanel == null || myPanel.isDisposed()) return;
            myPanel.updateStyle(getStyle(false), isDarkTheme());
            // JBCefBrowserBase takes a linear scale, not CefBrowser's logarithmic zoom.
            myPanel.setZoomLevel(UISettings.getInstance().getCurrentIdeScale());
        });
    }

    private String getStyle(boolean isTag) {
        try {
            EditorColorsScheme editorColorsScheme = EditorColorsManager.getInstance().getGlobalScheme();
            boolean darkTheme = isDarkTheme();
            Color defaultBackground = editorColorsScheme.getDefaultBackground();

            Color text = UIManager.getColor("Label.foreground");
            if (text == null) {
                text = editorColorsScheme.getDefaultForeground();
            }
            String fontFamily = "font-family:\"" + editorColorsScheme.getEditorFontName() + "\",\"Helvetica Neue\",\"Luxi Sans\",\"DejaVu Sans\"," +
                    "\"Hiragino Sans GB\",\"Microsoft Yahei\",sans-serif,\"Apple Color Emoji\",\"Segoe UI Emoji\",\"Noto Color Emoji\",\"Segoe UI Symbol\"," +
                    "\"Android Emoji\",\"EmojiSymbols\";";
            StringBuilder sb = new StringBuilder(isTag ? "<style id=\"ideaStyle\">" : "");
            sb.append(darkTheme ? ".vditor--dark,body" : ".vditor,body").append("{--panel-background-color:").append(toHexColor(defaultBackground))
                    .append(";--textarea-background-color:").append(toHexColor(defaultBackground)).append(";");
            sb.append("--toolbar-background-color:").append(toHexColor(JBColor.background())).append(";");
            sb.append("--border-color:").append(toHexColor(JBColor.border())).append(";");
            sb.append("}");
            sb.append("::-webkit-scrollbar-track {background-color:").append(toHexColor(defaultBackground)).append(";}");
            Color scrollbarColor = darkTheme
                    ? new Color(255, 255, 255, 96)
                    : new Color(0, 0, 0, 96);
            sb.append("::-webkit-scrollbar-thumb {background-color:").append(toHexColor(scrollbarColor)).append(";}");
            sb.append("html {scrollbar-color:").append(toHexColor(scrollbarColor)).append(" ")
                    .append(toHexColor(defaultBackground)).append(";}");
            sb.append(PreviewTypography.css());
            sb.append(".vditor-sv,.vditor-reset code,.vditor-reset kbd{").append(fontFamily).append("}");
            sb.append(".vditor-sv{font-size:").append(editorColorsScheme.getEditorFontSize2D()).append("px;}");
            sb.append(".vditor-reset {");
            if (text != null) {
                sb.append("color:").append(toHexColor(text)).append(";");
            }
            sb.append("}");
            if (text != null) {
                sb.append(".vditor-reset table {color:").append(toHexColor(text)).append(";}");
            }
            Color linkColor = UIManager.getColor("Link.activeForeground");
            if (linkColor == null) {
                linkColor = JBColor.BLUE;
            }
            Color borderColor = JBColor.border();
            Color codeBackground = darkTheme ? new Color(255, 255, 255, 18) : new Color(0, 0, 0, 8);
            Color quoteBackground = darkTheme ? new Color(255, 255, 255, 12) : new Color(0, 0, 0, 6);
            sb.append(".vditor{--markdown-preview-link-color:").append(toHexColor(linkColor)).append(";}");
            sb.append(".vditor-reset h1,.vditor-reset h2,.vditor-reset h3,.vditor-reset h4,.vditor-reset h5,.vditor-reset h6{");
            if (text != null) {
                sb.append("color:").append(toHexColor(text)).append(";");
            }
            sb.append("border-bottom-color:").append(toHexColor(borderColor)).append(";}");
            sb.append(".vditor-reset blockquote{background-color:").append(toHexColor(quoteBackground))
                    .append(";border-left-color:").append(toHexColor(linkColor)).append(";}");
            sb.append(".vditor-reset code:not(.hljs){background-color:").append(toHexColor(codeBackground))
                    .append(";border-color:").append(toHexColor(borderColor)).append(";}");
            sb.append(".vditor-reset pre{background-color:").append(toHexColor(codeBackground))
                    .append(";border-color:").append(toHexColor(borderColor)).append(";}");
            sb.append(".vditor-reset table th,.vditor-reset table td{border-color:").append(toHexColor(borderColor)).append(";}");
            sb.append(isTag ? "</style>" : "");
            LOG.info("markdown style: " + sb + " ; Dark theme: " + darkTheme);
            return sb.toString();
        } catch (Exception e) {
            LOG.info("Failed to create style", e);
            return "";
        }

    }

    private boolean isDarkTheme() {
        return !JBColor.isBright();
    }

    private String toHexColor(Color color) {
        DecimalFormat df = new DecimalFormat("0.00");
        DecimalFormatSymbols dfs = new DecimalFormatSymbols();
        dfs.setDecimalSeparator('.');
        df.setDecimalFormatSymbols(dfs);
        return String.format("rgba(%s,%s,%s,%s)", color.getRed(), color.getGreen(), color.getBlue(), df.format(color.getAlpha() / (float) 255));
    }

    public void visibleToolbarPanel(boolean visible) {
        toolbarPanel.setVisible(visible);
        myHtmlPanelWrapper.revalidate();
        myHtmlPanelWrapper.repaint();
        if (visible) {
            ApplicationManager.getApplication().invokeLater(() -> {
                if (myProject.isDisposed() || !toolbarPanel.isShowing()) return;
                // Windowed JCEF owns native focus independently of Swing on macOS.
                // Release it before transferring focus, after pending IDE transfers settle.
                myPanel.getCefBrowser().setFocus(false);
                IdeFocusManager.getInstance(myProject).doWhenFocusSettlesDown(() -> {
                    if (myProject.isDisposed() || !toolbarPanel.isShowing()) return;
                    IdeFocusManager.getInstance(myProject).requestFocus(searchField, true);
                    searchField.selectAll();
                });
            });
        } else {
            searchField.setText("");
            searchCount.setText("");
        }
    }

    private JButton createSearchButton(String text, String tooltip, Runnable action) {
        JButton button = new JButton(text);
        button.setToolTipText(tooltip);
        button.setFocusable(false);
        button.setMargin(new Insets(2, 8, 2, 8));
        button.addActionListener(event -> action.run());
        return button;
    }
}
