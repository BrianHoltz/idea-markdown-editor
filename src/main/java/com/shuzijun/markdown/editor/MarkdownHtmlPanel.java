package com.shuzijun.markdown.editor;

import com.intellij.CommonBundle;
import com.intellij.ide.*;
import com.intellij.ide.actions.searcheverywhere.SearchEverywhereManager;
import com.intellij.ide.actions.searcheverywhere.SearchEverywhereManagerImpl;
import com.intellij.ide.plugins.MultiPanel;
import com.intellij.ide.util.PropertiesComponent;
import com.intellij.openapi.actionSystem.*;
import com.intellij.openapi.application.ApplicationManager;
import com.intellij.openapi.application.ModalityState;
import com.intellij.openapi.diagnostic.Logger;
import com.intellij.openapi.fileEditor.FileEditor;
import com.intellij.openapi.fileEditor.FileEditorManager;
import com.intellij.openapi.ide.CopyPasteManager;
import com.intellij.openapi.project.Project;
import com.intellij.openapi.util.ActionCallback;
import com.intellij.openapi.util.Disposer;
import com.intellij.openapi.vfs.LocalFileSystem;
import com.intellij.openapi.vfs.VirtualFile;
import com.intellij.ui.components.JBLoadingPanel;
import com.intellij.ui.jcef.JBCefBrowserBase;
import com.intellij.ui.jcef.JBCefJSQuery;
import com.intellij.ui.jcef.JCEFHtmlPanel;
import com.intellij.util.io.HttpRequests;
import com.intellij.util.io.URLUtil;
import com.intellij.util.ui.UIUtil;
import com.shuzijun.markdown.model.PluginConstant;
import com.shuzijun.markdown.util.FileUtils;
import io.netty.handler.codec.http.HttpHeaderNames;
import org.apache.commons.lang.StringUtils;
import org.cef.browser.CefBrowser;
import org.cef.CefSettings;
import org.cef.browser.CefFrame;
import org.cef.callback.CefContextMenuParams;
import org.cef.callback.CefMenuModel;
import org.cef.handler.*;
import org.cef.misc.BoolRef;
import org.cef.network.CefRequest;
import org.jetbrains.annotations.NonNls;
import org.jetbrains.annotations.NotNull;
import org.jetbrains.annotations.Nullable;

import javax.swing.*;
import java.awt.*;
import java.awt.datatransfer.DataFlavor;
import java.awt.datatransfer.StringSelection;
import java.awt.event.ComponentAdapter;
import java.awt.event.ComponentEvent;
import java.io.File;
import java.io.IOException;
import java.lang.reflect.Method;
import java.net.HttpURLConnection;
import java.net.URLDecoder;
import java.nio.charset.StandardCharsets;
import java.util.*;
import java.util.List;
import java.util.concurrent.atomic.AtomicBoolean;
import java.util.function.Function;
import java.util.function.BiConsumer;

/**
 * @author shuzijun
 */
public class MarkdownHtmlPanel extends JCEFHtmlPanel {

    private static final Logger LOG = Logger.getInstance(MarkdownHtmlPanel.class);

    private static final Integer LOADING_KEY = 1;
    private static final Integer CONTENT_KEY = 0;

    private final MyMultiPanel multiPanel;
    private final JBLoadingPanel loadingPanel = new JBLoadingPanel(new BorderLayout(), this);
    private final AtomicBoolean initial = new AtomicBoolean(true);
    private volatile String pendingAnchor;


    private final CefRequestHandler requestHandler;
    private final CefLifeSpanHandler lifeSpanHandler;
    private final CefDisplayHandler displayHandler;
    private final JBCefJSQuery selectValueJSQuery;
    private final JBCefJSQuery appearanceJSQuery;
    private final JBCefJSQuery searchCountJSQuery;
    private final JBCefJSQuery contextSelectionJSQuery;
    private java.util.function.Consumer<String> contextSelectionListener = value -> {};
    private BiConsumer<String, Integer> searchCountListener = (query, total) -> {};
    private String lastSearchText = "";

    private final boolean isFileEditor;
    private final String url;
    private final Project project;
    private final List<String> iframe = new ArrayList<>();
    private static final List<String> headers = Arrays.asList(HttpHeaderNames.CONTENT_SECURITY_POLICY.toString(), HttpHeaderNames.CONTENT_ENCODING.toString(), HttpHeaderNames.CONTENT_LENGTH.toString());

    public MarkdownHtmlPanel(@Nullable String url, Project project, boolean isFileEditor) {
        super(offScreenRendering(isFileEditor), null, null);
        this.url = url;
        this.project = project;
        this.isFileEditor = isFileEditor;
        this.loadingPanel.setLoadingText(CommonBundle.getLoadingTreeNodeText());

        JComponent myComponent = super.getComponent();
        multiPanel = new MyMultiPanel(myComponent);

        multiPanel.addComponentListener(new ComponentAdapter() {
            @Override
            public void componentResized(ComponentEvent e) {
                updateHeight(myComponent.getWidth(),myComponent.getHeight());
                multiPanel.repaint();
            }
        });

        getJBCefClient().addLoadHandler(new  CefLoadHandlerAdapter() {
            public void onLoadingStateChange(CefBrowser browser, boolean isLoading, boolean canGoBack, boolean canGoForward) {
                if (initial.get()) {
                    if (isLoading) {
                        ApplicationManager.getApplication().invokeLater(() -> {
                            loadingPanel.startLoading();
                            multiPanel.select(LOADING_KEY, true);
                        }, ModalityState.defaultModalityState());
                    } else {
                        initial.set(false);
                        scrollToPendingAnchor();
                        ApplicationManager.getApplication().invokeLater(() -> {
                            loadingPanel.stopLoading();
                            multiPanel.select(CONTENT_KEY, true);
                        },ModalityState.defaultModalityState());
                    }
                }
            }
        }, getCefBrowser());

        getJBCefClient().addRequestHandler(requestHandler = new CefRequestHandlerAdapter() {
            @Override
            public boolean onBeforeBrowse(CefBrowser browser, CefFrame frame, CefRequest request, boolean user_gesture, boolean is_redirect) {
                String requestUrl = request.getURL();
                if (requestUrl.startsWith(url)) {
                    return false;
                } else if (isEmbeddedRenderResource(requestUrl)) {
                    return false;
                } else if (!user_gesture) {
                    if (requestUrl.contains("csp=false")) {
                        iframe.add(requestUrl);
                    }
                    return false;
                } else {
                    openUrl(URLDecoder.decode(frame.getURL(), StandardCharsets.UTF_8), URLDecoder.decode(requestUrl, StandardCharsets.UTF_8));
                    return true;
                }
            }

            @Override
            public CefResourceRequestHandler getResourceRequestHandler(CefBrowser browser, CefFrame frame, CefRequest request, boolean isNavigation, boolean isDownload, String requestInitiator, BoolRef disableDefaultHandling) {
                String requestUrl = request.getURL();
                if (!iframe.contains(requestUrl)) {
                    return null;
                }

                return new CefResourceRequestHandlerAdapter() {

                    @Override
                    public CefResourceHandler getResourceHandler(CefBrowser browser, CefFrame frame, CefRequest request) {
                        try {
                            return HttpRequests.request(request.getURL()).throwStatusCodeException(false).connect(new HttpRequests.RequestProcessor<CefResourceHandler>() {
                                @Override
                                public CefResourceHandler process(HttpRequests.@NotNull Request request) throws IOException {
                                    HttpURLConnection urlConnection = (HttpURLConnection) request.getConnection();
                                    Map<String, String> header = new HashMap<>();
                                    urlConnection.getHeaderFields().forEach((key, values) -> {
                                        if (key != null && values != null && !headers.contains(key.toLowerCase())) {
                                            header.put(key, StringUtils.join(values.toArray(), ";"));
                                        }
                                    });
                                    return new ProxyLoadHtmlResourceHandler(request.readString(), header, urlConnection.getResponseCode());
                                }
                            });
                        } catch (IOException io) {

                            return null;
                        }
                    }
                };
            }
        }, getCefBrowser());
        getJBCefClient().addLifeSpanHandler(lifeSpanHandler = new CefLifeSpanHandlerAdapter() {
            @Override
            public boolean onBeforePopup(CefBrowser browser, CefFrame frame, String target_url, String target_frame_name) {
                if (isEmbeddedRenderResource(target_url)) {
                    return true;
                }
                if (!target_url.startsWith(url)) {
                    openUrl(URLDecoder.decode(frame.getURL(), StandardCharsets.UTF_8), URLDecoder.decode(target_url, StandardCharsets.UTF_8));
                }
                return true;
            }
        }, getCefBrowser());
        selectValueJSQuery = JBCefJSQuery.create((JBCefBrowserBase)this);
        getJBCefClient().addDisplayHandler(displayHandler = new CefDisplayHandlerAdapter() {
            @Override
            public boolean onConsoleMessage(CefBrowser browser, CefSettings.LogSeverity level, String message, String source, int line) {
                if (level == CefSettings.LogSeverity.LOGSEVERITY_ERROR ||
                        level == CefSettings.LogSeverity.LOGSEVERITY_FATAL ||
                        level == CefSettings.LogSeverity.LOGSEVERITY_WARNING) {
                    LOG.warn("Markdown page console: " + message + " (" + source.replaceAll("\\?.*$", "") + ":" + line + ")");
                }
                return false;
            }
        }, getCefBrowser());
        selectValueJSQuery.addHandler(value -> {
            if (StringUtils.isEmpty(value)) {
                return null;
            }
            CopyPasteManager.getInstance().setContents(new StringSelection(value));
            return null;
        });
        contextSelectionJSQuery = JBCefJSQuery.create((JBCefBrowserBase)this);
        contextSelectionJSQuery.addHandler(value -> {
            if (value.length() <= 4096) ApplicationManager.getApplication().invokeLater(() -> contextSelectionListener.accept(value));
            return null;
        });
        searchCountJSQuery = JBCefJSQuery.create((JBCefBrowserBase)this);
        searchCountJSQuery.addHandler(value -> {
            int separator = value.indexOf('\n');
            if (separator >= 0) {
                int total = Integer.parseInt(value.substring(0, separator));
                String query = value.substring(separator + 1);
                ApplicationManager.getApplication().invokeLater(() -> searchCountListener.accept(query, total));
            }
            return null;
        });
        appearanceJSQuery = JBCefJSQuery.create((JBCefBrowserBase)this);
        appearanceJSQuery.addHandler(value -> {
            String[] values = value.split(",", -1);
            if (values.length == 2) {
                PropertiesComponent properties = PropertiesComponent.getInstance();
                properties.setValue(PluginConstant.editorToolbarHiddenKey, Boolean.parseBoolean(values[0]), false);
                properties.setValue(PluginConstant.editorRawHtmlHiddenKey, Boolean.parseBoolean(values[1]), false);
            }
            return null;
        });
    }

    @Override
    public @NotNull JComponent getComponent() {
        return multiPanel;
    }
    public void loadMyHTML(@NotNull String html, @NotNull String url) {
        multiPanel.select(CONTENT_KEY, true);
        this.loadHTML(html,url);
    }

    @Override
    protected DefaultCefContextMenuHandler createDefaultContextMenuHandler() {

        return new DefaultCefContextMenuHandler(true) {
            @Override
            public void onBeforeContextMenu(CefBrowser browser, CefFrame frame, CefContextMenuParams params, CefMenuModel model) {
                if (isFileEditor) {
                    getCefBrowser().executeJavaScript("jsAddBlur()", getCefBrowser().getURL(), 0);
                    model.clear();
                    ActionGroup anAction = (ActionGroup) ActionManager.getInstance().getAction("EditorPopupMenu");
                    ActionPopupMenu actionPopupMenu = ActionManager.getInstance().createActionPopupMenu(ActionPlaces.EDITOR_POPUP, anAction);
                    actionPopupMenu.setTargetComponent(getComponent());
                    final int x = params.getXCoord();
                    final int y = params.getYCoord();
                    ApplicationManager.getApplication().invokeLater(() -> actionPopupMenu.getComponent().show(getComponent(), x, y));
                } else {
                    super.onBeforeContextMenu(browser, frame, params, model);
                }
            }
        };

    }

    @Override
    public void dispose() {
        getJBCefClient().removeRequestHandler(requestHandler, getCefBrowser());
        getJBCefClient().removeLifeSpanHandler(lifeSpanHandler, getCefBrowser());
        getJBCefClient().removeDisplayHandler(displayHandler, getCefBrowser());
        Disposer.dispose(selectValueJSQuery);
        Disposer.dispose(appearanceJSQuery);
        Disposer.dispose(searchCountJSQuery);
        Disposer.dispose(contextSelectionJSQuery);
        super.dispose();
    }

    private void openUrl(String frameUrl, String url) {
        if (url.startsWith(URLUtil.FILE_PROTOCOL)) {
            int fragmentIndex = url.indexOf('#');
            String fragment = fragmentIndex >= 0 ? url.substring(fragmentIndex + 1) : null;
            String fileUrl = fragmentIndex >= 0 ? url.substring(0, fragmentIndex) : url;
            File file = new File(fileUrl.substring((URLUtil.FILE_PROTOCOL + URLUtil.SCHEME_SEPARATOR + FileUtils.separator()).length()));
            if (!file.exists() || file.isDirectory()) {
                openSearchEverywhere(searchText(frameUrl, url));
            } else {
                ApplicationManager.getApplication().invokeLater(() -> {
                    VirtualFile vf = LocalFileSystem.getInstance().refreshAndFindFileByIoFile(file);
                    FileEditor[] editors = FileEditorManager.getInstance(project).openFile(vf, false);
                    if (editors == null || editors.length == 0) {
                        openSearchEverywhere(vf.getPath());
                    } else if (StringUtils.isNotEmpty(fragment)) {
                        for (FileEditor editor : editors) {
                            if (editor instanceof MarkdownPreviewFileEditor markdownEditor) {
                                markdownEditor.scrollToAnchor(fragment);
                                break;
                            }
                        }
                    }
                });
            }
        } else {
            BrowserUtil.browse(url);
        }
    }

    private boolean isEmbeddedRenderResource(String requestUrl) {
        return requestUrl != null && requestUrl.startsWith("https://www.plantuml.com/plantuml/");
    }

    private void openSearchEverywhere(String searchText) {
        SearchEverywhereManager manager = SearchEverywhereManager.getInstance(project);
        if (!manager.isShown()) {
            ApplicationManager.getApplication().invokeLater(() -> {
                AnActionEvent anActionEvent = AnActionEvent.createEvent(
                        DataManager.getInstance().getDataContext(getComponent()),
                        new Presentation(),
                        ActionPlaces.UNKNOWN,
                        ActionUiKind.NONE,
                        null
                );
                manager.show(SearchEverywhereManagerImpl.ALL_CONTRIBUTORS_GROUP_ID, searchText, anActionEvent);
            });
        }
    }

    private String searchText(String frameUrl, String url) {
        if (StringUtils.isBlank(url) || StringUtils.isBlank(frameUrl)) {
            return url;
        }
        StringBuilder sb = new StringBuilder();
        for (int i = 0; i < url.length(); i++) {
            if (i >= frameUrl.length()) {
                sb.append(url.substring(i));
                break;
            } else if (url.charAt(i) != frameUrl.charAt(i)) {
                sb.append(url.substring(i));
                break;
            }
        }
        if (sb.length() == 0) {
            sb.append(url.substring((URLUtil.FILE_PROTOCOL + URLUtil.SCHEME_SEPARATOR + FileUtils.separator()).length()));
        }
        return sb.toString();
    }

    public void updateStyle(String style, boolean darkTheme) {
        getCefBrowser().executeJavaScript("updateStyle(" + toJsString(style) + "," + darkTheme + ");", getCefBrowser().getURL(), 0);
    }

    public void scrollToAnchor(String fragment) {
        pendingAnchor = fragment;
        scrollToPendingAnchor();
    }

    private void scrollToPendingAnchor() {
        String fragment = pendingAnchor;
        if (initial.get() || StringUtils.isEmpty(fragment)) {
            return;
        }
        pendingAnchor = null;
        getCefBrowser().executeJavaScript("scrollToHeading(" + toJsString(fragment) + ");", getCefBrowser().getURL(), 0);
    }

    public void updateHeight(int width,int height) {
        if (PropertiesComponent.getInstance().getBoolean(PluginConstant.editorFixToolbarKey,true)){
            getCefBrowser().executeJavaScript("updateHeight(" + width + "," + height + ");", getCefBrowser().getURL(), 0);
        }
    }

    public String getInjectScript() {

        String savaTime = "function jsAddTime(){saveTime = Date.now() + 1000;}\n";

        String copy = "function jsCopy(){\n"
                + "        let value = vditor.getSelection();\n" +
                selectValueJSQuery.inject("value") +
                "    }\n";
        String cut = "function jsCut(){\n" +
                "        let value = vditor.getSelection();\nvditor.deleteValue()\n" +
                selectValueJSQuery.inject("value") +
                "    }\n";
        String paste = "function jsPaste(value){\n" +
                "        vditor.updateValue(value);\n" +
                "    }\n";

        String blur = "function jsAddBlur(){\n" +
                "        vditor.vditor.ir.element.addEventListener('blur',(event) => {event.stopImmediatePropagation();}, {capture: true,once: true});\n" +
                "    }\n";
        String saveAppearance = "function jsSaveAppearance(toolbarHidden, rawHtmlHidden){\n" +
                appearanceJSQuery.inject("[toolbarHidden, rawHtmlHidden].join(',')") +
                "    }\n";
        return savaTime + copy + cut + paste + blur + saveAppearance + "function jsPublishContextSelection(value){" + contextSelectionJSQuery.inject("value") + "}\n";
    }

    public void setContextSelectionListener(java.util.function.Consumer<String> listener) { contextSelectionListener = listener; }

    public void setSearchCountListener(BiConsumer<String, Integer> listener) {
        searchCountListener = listener;
    }

    public void browserFind(String txt, boolean forward) {
        boolean findNext = txt.equals(lastSearchText);
        lastSearchText = txt;
        String countScript = "(() => { const query = " + toJsString(txt)
                + "; const result = countMarkdownMatches(query) + '\\n' + query; "
                + searchCountJSQuery.inject("result") + " })();";
        getCefBrowser().executeJavaScript(countScript, getCefBrowser().getURL(), 0);
        if (StringUtils.isEmpty(txt)) {
            getCefBrowser().stopFinding(true);
            return;
        }
        CefBrowser cefBrowser = getCefBrowser();

        try {
            Method findMethod = CefBrowser.class.getMethod("find",String.class,boolean.class,boolean.class,boolean.class);
            findMethod.invoke(cefBrowser,txt, forward, false, findNext);
        } catch (NoSuchMethodException e) {
            try {
                Method findMethod = CefBrowser.class.getMethod("find",int.class,String.class,boolean.class,boolean.class,boolean.class);
                findMethod.invoke(cefBrowser,1, txt, forward, false, findNext);
            } catch (Exception ex) {
                LOG.error(ex);
            }
        } catch (Exception e) {
            LOG.error(e);
        }
    }

    private static boolean offScreenRendering(boolean isFileEditor) {
        // A windowed macOS browser can retain native text input after Swing focuses search.
        // OSR routes editor input through Swing, sharing one keyboard focus owner.
        return isFileEditor;
    }

    class MyMultiPanel extends MultiPanel implements DataProvider {

        private final JComponent myComponent;

        MyMultiPanel(JComponent myComponent) {
            this.myComponent = myComponent;
        }

        @Override
        protected JComponent create(Integer key) {
            if (key == LOADING_KEY){
                return loadingPanel;
            }else if (key == CONTENT_KEY){
                return myComponent;
            } else {
                throw new IllegalArgumentException("Unknown key:" + key);
            }
        }
        @Override
        public ActionCallback select(Integer key, boolean now){
            ActionCallback callback = super.select(key, now);
            if (key == CONTENT_KEY) {
                UIUtil.invokeLaterIfNeeded(this::requestFocusInWindow);
            }
            return callback;
        }

        @Override
        public @Nullable Object getData(@NotNull @NonNls String dataId) {
            if (PlatformDataKeys.COPY_PROVIDER.is(dataId)) {
                return new CopyProvider() {
                    @Override
                    public void performCopy(@NotNull DataContext dataContext) {
                        getCefBrowser().executeJavaScript("jsAddTime()", getCefBrowser().getURL(), 0);
                        getCefBrowser().executeJavaScript("jsCopy()", getCefBrowser().getURL(), 0);
                    }

                    @Override
                    public boolean isCopyEnabled(@NotNull DataContext dataContext) {
                        return PropertiesComponent.getInstance().getBoolean(PluginConstant.editorTextOperationKey, true);
                    }

                    @Override
                    public boolean isCopyVisible(@NotNull DataContext dataContext) {
                        return PropertiesComponent.getInstance().getBoolean(PluginConstant.editorTextOperationKey, true);
                    }
                };
            }
            if (PlatformDataKeys.CUT_PROVIDER.is(dataId)) {
                return new CutProvider() {
                    @Override
                    public void performCut(@NotNull DataContext dataContext) {
                        getCefBrowser().executeJavaScript("jsAddTime()", getCefBrowser().getURL(), 0);
                        getCefBrowser().executeJavaScript("jsCut()", getCefBrowser().getURL(), 0);
                    }

                    @Override
                    public boolean isCutEnabled(@NotNull DataContext dataContext) {
                        return PropertiesComponent.getInstance().getBoolean(PluginConstant.editorTextOperationKey, true);
                    }

                    @Override
                    public boolean isCutVisible(@NotNull DataContext dataContext) {
                        return PropertiesComponent.getInstance().getBoolean(PluginConstant.editorTextOperationKey, true);
                    }
                };
            }
            if (PlatformDataKeys.PASTE_PROVIDER.is(dataId)) {
                return new PasteProvider() {

                    @Override
                    public void performPaste(@NotNull DataContext dataContext) {
                        String content = CopyPasteManager.getInstance().getContents(DataFlavor.stringFlavor);
                        if (StringUtils.isEmpty(content)) {
                            return;
                        }
                        getCefBrowser().executeJavaScript("jsAddTime()", getCefBrowser().getURL(), 0);
                        getCefBrowser().executeJavaScript("jsPaste(" + toJsString(content) + ")", getCefBrowser().getURL(), 0);
                    }

                    @Override
                    public boolean isPastePossible(@NotNull DataContext dataContext) {
                        return PropertiesComponent.getInstance().getBoolean(PluginConstant.editorTextOperationKey, true);
                    }

                    @Override
                    public boolean isPasteEnabled(@NotNull DataContext dataContext) {
                        return PropertiesComponent.getInstance().getBoolean(PluginConstant.editorTextOperationKey, true);
                    }
                };
            }
            return null;
        }
    }

    private static String toJsString(String value) {
        if (value == null) {
            return "''";
        }
        StringBuilder sb = new StringBuilder(value.length() + 2);
        sb.append('\'');
        for (int i = 0; i < value.length(); i++) {
            char ch = value.charAt(i);
            switch (ch) {
                case '\\':
                    sb.append("\\\\");
                    break;
                case '\'':
                    sb.append("\\'");
                    break;
                case '\n':
                    sb.append("\\n");
                    break;
                case '\r':
                    sb.append("\\r");
                    break;
                case '\t':
                    sb.append("\\t");
                    break;
                case '\b':
                    sb.append("\\b");
                    break;
                case '\f':
                    sb.append("\\f");
                    break;
                default:
                    if (ch < 0x20 || ch == '\u2028' || ch == '\u2029') {
                        sb.append(String.format("\\u%04x", (int) ch));
                    } else {
                        sb.append(ch);
                    }
            }
        }
        sb.append('\'');
        return sb.toString();
    }
}
