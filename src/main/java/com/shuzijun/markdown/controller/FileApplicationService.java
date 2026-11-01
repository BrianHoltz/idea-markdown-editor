package com.shuzijun.markdown.controller;

import com.intellij.openapi.Disposable;
import com.intellij.openapi.vfs.VirtualFile;

import java.util.LinkedHashMap;
import java.util.Map;

/** Only live editors authorize access; closing one must not unregister another. */
public class FileApplicationService {
    private record FileKey(String path, String project) {}

    private final Map<FileKey, Map<Object, VirtualFile>> files = new LinkedHashMap<>();

    public synchronized Disposable registerVirtualFile(String path, String project, VirtualFile file) {
        FileKey key = new FileKey(path, project);
        Object owner = new Object();
        files.computeIfAbsent(key, ignored -> new LinkedHashMap<>()).put(owner, file);
        return () -> release(key, owner);
    }

    public synchronized VirtualFile getVirtualFile(String path, String project) {
        Map<Object, VirtualFile> registrations = files.get(new FileKey(path, project));
        if (registrations == null) return null;
        VirtualFile result = null;
        for (VirtualFile file : registrations.values()) {
            if (file.isValid()) result = file;
        }
        return result;
    }

    private synchronized void release(FileKey key, Object owner) {
        Map<Object, VirtualFile> registrations = files.get(key);
        if (registrations == null) return;
        registrations.remove(owner);
        if (registrations.isEmpty()) files.remove(key);
    }
}
