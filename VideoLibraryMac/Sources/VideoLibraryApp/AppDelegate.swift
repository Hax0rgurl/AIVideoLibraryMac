import AppKit
import AVFoundation
import CryptoKit
import WebKit

final class AppDelegate: NSObject, NSApplicationDelegate, WKNavigationDelegate, WKUIDelegate, WKScriptMessageHandler, WKURLSchemeHandler {
    private struct ByteRange {
        let start: UInt64
        let end: UInt64

        var length: UInt64 {
            end >= start ? end - start + 1 : 0
        }
    }

    private struct ProjectBackupFile {
        let sourceURL: URL
        let relativePath: String
    }

    private struct DuplicateCandidate {
        let url: URL
        let size: Int64
        let modified: Date
    }

    private var window: NSWindow?
    private var webView: WKWebView?
    private let schemeTaskLock = NSLock()
    private var activeSchemeTaskIDs = Set<ObjectIdentifier>()
    private let fileStreamChunkSize = 1024 * 1024
    private let initialVideoRangeSize = UInt64(8 * 1024 * 1024)
    private let videoExtensions: Set<String> = [
        "mp4", "mov", "webm", "m4v", "avi", "mkv", "mpg", "mpeg", "3gp", "3g2",
        "mts", "m2ts", "ts", "vob", "ogv", "f4v", "divx", "asf"
    ]
    private let skippedDirectoryNames: Set<String> = [
        ".git", ".svn", ".hg", ".spotlight-v100", ".trashes", ".fseventsd",
        "system volume information", "node_modules"
    ]
    private let skippedPackageExtensions: Set<String> = [
        "app", "framework", "bundle", "plugin", "photoslibrary", "imovielibrary", "theater", "localized"
    ]

    func applicationDidFinishLaunching(_ notification: Notification) {
        NSApp.setActivationPolicy(.regular)
        buildMenu()
        buildWindow()
        NSApp.activate(ignoringOtherApps: true)
    }

    func applicationShouldTerminateAfterLastWindowClosed(_ sender: NSApplication) -> Bool {
        true
    }

    private func buildWindow() {
        let configuration = WKWebViewConfiguration()
        configuration.websiteDataStore = .default()
        configuration.preferences.javaScriptCanOpenWindowsAutomatically = true
        configuration.userContentController.add(self, name: "soraLibrary")
        configuration.setURLSchemeHandler(self, forURLScheme: "soralibrary-file")
        configuration.setURLSchemeHandler(self, forURLScheme: "soralibrary-thumb")

        let view = WKWebView(frame: .zero, configuration: configuration)
        view.navigationDelegate = self
        view.uiDelegate = self
        view.allowsMagnification = true
        self.webView = view

        let window = NSWindow(
            contentRect: NSRect(x: 0, y: 0, width: 1440, height: 920),
            styleMask: [.titled, .closable, .miniaturizable, .resizable],
            backing: .buffered,
            defer: false
        )
        window.title = "Video Library"
        window.titlebarAppearsTransparent = false
        window.isMovableByWindowBackground = true
        window.isReleasedWhenClosed = false
        window.minSize = NSSize(width: 1040, height: 720)
        window.contentView = view
        window.center()
        window.makeKeyAndOrderFront(nil)
        self.window = window

        loadLibrary()
    }

    private func loadLibrary() {
        guard let webView else { return }
        if let resourceURL = Bundle.main.url(forResource: "app", withExtension: "html") {
            webView.loadFileURL(resourceURL, allowingReadAccessTo: resourceURL.deletingLastPathComponent())
            return
        }
        let fallback = """
        <!doctype html>
        <html><body style="font:16px -apple-system; padding:24px">
        <h1>Sora Library could not load app.html</h1>
        <p>The bundled web app resource is missing.</p>
        </body></html>
        """
        webView.loadHTMLString(fallback, baseURL: nil)
    }

    func userContentController(_ userContentController: WKUserContentController, didReceive message: WKScriptMessage) {
        guard message.name == "soraLibrary",
              let body = message.body as? [String: Any],
              let id = body["id"] as? String,
              let type = body["type"] as? String
        else { return }

        switch type {
        case "chooseFolder":
            chooseFolder(id: id)
        case "chooseFiles":
            chooseFiles(id: id)
        case "thumbnail":
            let payload = body["payload"] as? [String: Any]
            let path = payload?["path"] as? String ?? ""
            DispatchQueue.global(qos: .userInitiated).async { [weak self] in
                do {
                    let frame = try self?.thumbnailPayload(for: path)
                    DispatchQueue.main.async {
                        self?.sendNativeResponse(id: id, ok: true, payload: ["frame": frame as Any])
                    }
                } catch {
                    DispatchQueue.main.async {
                        self?.sendNativeResponse(id: id, ok: false, error: error.localizedDescription)
                    }
                }
            }
        case "ollama":
            let payload = body["payload"] as? [String: Any] ?? [:]
            proxyOllama(id: id, payload: payload)
        case "ollamaModels":
            let payload = body["payload"] as? [String: Any] ?? [:]
            fetchOllamaModels(id: id, payload: payload)
        case "ollamaEnsure":
            let payload = body["payload"] as? [String: Any] ?? [:]
            ensureOllama(id: id, payload: payload)
        case "ollamaPullModel":
            let payload = body["payload"] as? [String: Any] ?? [:]
            pullOllamaModel(id: id, payload: payload)
        case "videoContextMenu":
            let payload = body["payload"] as? [String: Any] ?? [:]
            showVideoContextMenu(id: id, payload: payload)
        case "showInFolder":
            let payload = body["payload"] as? [String: Any] ?? [:]
            showInFolder(id: id, payload: payload)
        case "projectZip":
            let payload = body["payload"] as? [String: Any] ?? [:]
            createProjectZip(id: id, payload: payload)
        case "trashDuplicateFiles":
            let payload = body["payload"] as? [String: Any] ?? [:]
            trashDuplicateFiles(id: id, payload: payload)
        default:
            sendNativeResponse(id: id, ok: false, error: "Unknown native request.")
        }
    }

    private func showVideoContextMenu(id: String, payload: [String: Any]) {
        guard let webView,
              let path = payload["path"] as? String,
              !path.isEmpty
        else {
            sendNativeResponse(id: id, ok: false, error: "No video path was available.")
            return
        }

        let fileURL = URL(fileURLWithPath: path)
        let menu = NSMenu(title: payload["title"] as? String ?? "Video")
        let revealItem = NSMenuItem(title: "Show in Finder", action: #selector(showMenuItemInFinder(_:)), keyEquivalent: "")
        revealItem.target = self
        revealItem.representedObject = fileURL
        menu.addItem(revealItem)

        let openItem = NSMenuItem(title: "Open Video", action: #selector(openMenuItemVideo(_:)), keyEquivalent: "")
        openItem.target = self
        openItem.representedObject = fileURL
        openItem.isEnabled = FileManager.default.fileExists(atPath: fileURL.path)
        menu.addItem(openItem)

        let tags = payload["tags"] as? [String] ?? []
        let prompt = payload["prompt"] as? String ?? ""
        if !tags.isEmpty || !prompt.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty {
            menu.addItem(.separator())
        }
        if !tags.isEmpty {
            let preview = tags.map { "#\($0)" }.joined(separator: " ")
            let tagsItem = NSMenuItem(title: String(preview.prefix(96)), action: nil, keyEquivalent: "")
            tagsItem.isEnabled = false
            menu.addItem(tagsItem)

            let copyTagsItem = NSMenuItem(title: "Copy Tags", action: #selector(copyMenuItemText(_:)), keyEquivalent: "")
            copyTagsItem.target = self
            copyTagsItem.representedObject = preview
            menu.addItem(copyTagsItem)
        }
        if !prompt.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty {
            let copyPromptItem = NSMenuItem(title: "Copy Prompt", action: #selector(copyMenuItemText(_:)), keyEquivalent: "")
            copyPromptItem.target = self
            copyPromptItem.representedObject = prompt
            menu.addItem(copyPromptItem)
        }

        let x = payloadCoordinate(payload["x"])
        let y = payloadCoordinate(payload["y"])
        let point = NSPoint(x: x, y: webView.bounds.height - y)
        menu.popUp(positioning: revealItem, at: point, in: webView)
        sendNativeResponse(id: id, ok: true)
    }

    private func payloadCoordinate(_ value: Any?) -> CGFloat {
        if let number = value as? NSNumber { return CGFloat(truncating: number) }
        if let double = value as? Double { return CGFloat(double) }
        if let int = value as? Int { return CGFloat(int) }
        return 0
    }

    private func showInFolder(id: String, payload: [String: Any]) {
        guard let path = payload["path"] as? String, !path.isEmpty else {
            sendNativeResponse(id: id, ok: false, error: "No video path was available.")
            return
        }
        revealInFinder(URL(fileURLWithPath: path))
        sendNativeResponse(id: id, ok: true)
    }

    private func createProjectZip(id: String, payload: [String: Any]) {
        let panel = NSOpenPanel()
        panel.title = "Choose project files to back up"
        panel.message = "Choose the files or folders for this project. The app will split backups at 200 files per zip."
        panel.prompt = "Create Project Zip"
        panel.canChooseFiles = true
        panel.canChooseDirectories = true
        panel.allowsMultipleSelection = true
        panel.directoryURL = FileManager.default.urls(for: .downloadsDirectory, in: .userDomainMask).first

        panel.begin { [weak self] response in
            guard let self else { return }
            guard response == .OK, !panel.urls.isEmpty else {
                self.sendNativeResponse(id: id, ok: true, payload: ["cancelled": true])
                return
            }

            let selectedURLs = panel.urls
            DispatchQueue.global(qos: .userInitiated).async { [weak self] in
                guard let self else { return }
                do {
                    let result = try self.writeProjectZipArchives(selectedURLs: selectedURLs, payload: payload)
                    self.sendNativeResponse(id: id, ok: true, payload: result)
                } catch {
                    self.sendNativeResponse(id: id, ok: false, error: error.localizedDescription)
                }
            }
        }
    }

    private func trashDuplicateFiles(id: String, payload: [String: Any]) {
        let paths = (payload["paths"] as? [String] ?? [])
            .map { $0.trimmingCharacters(in: .whitespacesAndNewlines) }
            .filter { !$0.isEmpty }
        guard paths.count > 1 else {
            sendNativeResponse(id: id, ok: false, error: "At least two file paths are needed for duplicate cleanup.")
            return
        }

        DispatchQueue.global(qos: .userInitiated).async { [weak self] in
            guard let self else { return }
            do {
                let result = try self.trashExactDuplicates(paths: paths)
                self.sendNativeResponse(id: id, ok: true, payload: result)
            } catch {
                self.sendNativeResponse(id: id, ok: false, error: error.localizedDescription)
            }
        }
    }

    private func trashExactDuplicates(paths: [String]) throws -> [String: Any] {
        let fileManager = FileManager.default
        let uniqueURLs = Array(Set(paths)).map(URL.init(fileURLWithPath:))
        let candidates = uniqueURLs.compactMap { url -> DuplicateCandidate? in
            guard fileManager.fileExists(atPath: url.path),
                  let values = try? url.resourceValues(forKeys: [.fileSizeKey, .contentModificationDateKey, .isRegularFileKey]),
                  values.isRegularFile == true,
                  let size = values.fileSize,
                  size > 0
            else { return nil }
            return DuplicateCandidate(
                url: url,
                size: Int64(size),
                modified: values.contentModificationDate ?? Date.distantPast
            )
        }

        let sizeGroups = Dictionary(grouping: candidates, by: { $0.size }).values.filter { $0.count > 1 }
        var hashGroups: [String: [DuplicateCandidate]] = [:]
        for group in sizeGroups {
            for candidate in group {
                let hash = try sha256Hex(for: candidate.url)
                hashGroups[hash, default: []].append(candidate)
            }
        }

        var trashedPaths: [String] = []
        var keptPaths: [String] = []
        var duplicateGroupCount = 0
        for group in hashGroups.values where group.count > 1 {
            duplicateGroupCount += 1
            let sorted = group.sorted {
                if $0.modified != $1.modified { return $0.modified < $1.modified }
                return $0.url.path.localizedStandardCompare($1.url.path) == .orderedAscending
            }
            keptPaths.append(sorted[0].url.path)
            for duplicate in sorted.dropFirst() {
                try fileManager.trashItem(at: duplicate.url, resultingItemURL: nil)
                trashedPaths.append(duplicate.url.path)
            }
        }

        return [
            "scanned": candidates.count,
            "duplicateGroups": duplicateGroupCount,
            "keptPaths": keptPaths,
            "trashedPaths": trashedPaths
        ]
    }

    private func sha256Hex(for url: URL) throws -> String {
        let handle = try FileHandle(forReadingFrom: url)
        defer { try? handle.close() }

        var hasher = SHA256()
        while true {
            let data = try handle.read(upToCount: 1024 * 1024) ?? Data()
            if data.isEmpty { break }
            hasher.update(data: data)
        }
        return hasher.finalize().map { String(format: "%02x", $0) }.joined()
    }

    private func writeProjectZipArchives(selectedURLs: [URL], payload: [String: Any]) throws -> [String: Any] {
        let fileManager = FileManager.default
        let downloads = fileManager.urls(for: .downloadsDirectory, in: .userDomainMask).first
            ?? URL(fileURLWithPath: NSHomeDirectory()).appendingPathComponent("Downloads")
        let tempRoot = fileManager.temporaryDirectory.appendingPathComponent("VideoLibraryProject-\(UUID().uuidString)", isDirectory: true)
        defer { try? fileManager.removeItem(at: tempRoot) }

        let projectName = projectBackupName(for: selectedURLs)
        let catalog = payload["catalog"] as? [String: Any] ?? [:]
        guard JSONSerialization.isValidJSONObject(catalog) else {
            throw NSError(domain: "SoraLibrary", code: 1, userInfo: [
                NSLocalizedDescriptionKey: "The project catalog was not valid JSON."
            ])
        }
        let csv = payload["csv"] as? String ?? ""
        let files = projectBackupFiles(from: selectedURLs)
        guard !files.isEmpty else {
            throw NSError(domain: "SoraLibrary", code: 1, userInfo: [
                NSLocalizedDescriptionKey: "No project files were found in that selection."
            ])
        }

        try fileManager.createDirectory(at: tempRoot, withIntermediateDirectories: true)
        let batches = stride(from: 0, to: files.count, by: 200).map {
            Array(files[$0..<min($0 + 200, files.count)])
        }

        var zipPaths: [String] = []
        for (index, batch) in batches.enumerated() {
            let part = String(format: "%03d", index + 1)
            let folderName = "\(projectName) - \(part)"
            let projectFolder = tempRoot.appendingPathComponent(folderName, isDirectory: true)
            try stageProjectArchive(
                folder: projectFolder,
                files: batch,
                catalog: catalog,
                csv: csv,
                projectName: projectName,
                part: index + 1,
                totalParts: batches.count,
                totalFiles: files.count
            )
            let zipURL = uniqueZipURL(in: downloads, baseName: folderName)
            try zipDirectory(projectFolder, destination: zipURL)
            zipPaths.append(zipURL.path)
        }

        return [
            "projectName": projectName,
            "fileCount": files.count,
            "partCount": batches.count,
            "paths": zipPaths,
            "path": zipPaths.first ?? ""
        ]
    }

    private func projectBackupFiles(from urls: [URL]) -> [ProjectBackupFile] {
        var usedPaths = Set<String>()
        var entries: [ProjectBackupFile] = []
        for url in urls {
            if isDirectory(url) {
                let rootName = safeRelativePathComponent(url.lastPathComponent)
                for fileURL in scanProjectFolder(url) {
                    let relative = relativePath(for: fileURL, inside: url, rootName: rootName)
                    entries.append(ProjectBackupFile(sourceURL: fileURL, relativePath: uniqueRelativePath(relative, used: &usedPaths)))
                }
            } else {
                let relative = safeRelativePathComponent(url.lastPathComponent)
                entries.append(ProjectBackupFile(sourceURL: url, relativePath: uniqueRelativePath(relative, used: &usedPaths)))
            }
        }
        return entries.sorted { $0.relativePath.localizedStandardCompare($1.relativePath) == .orderedAscending }
    }

    private func scanProjectFolder(_ root: URL) -> [URL] {
        guard let enumerator = FileManager.default.enumerator(
            at: root,
            includingPropertiesForKeys: [.isDirectoryKey, .isPackageKey, .isRegularFileKey],
            options: [.skipsHiddenFiles],
            errorHandler: { _, _ in true }
        ) else { return [] }

        var files: [URL] = []
        for case let url as URL in enumerator {
            if shouldSkipDirectory(url: url, name: url.lastPathComponent) {
                enumerator.skipDescendants()
                continue
            }
            let values = try? url.resourceValues(forKeys: [.isRegularFileKey])
            if values?.isRegularFile == true {
                files.append(url)
            }
        }
        return files
    }

    private func stageProjectArchive(
        folder: URL,
        files: [ProjectBackupFile],
        catalog: [String: Any],
        csv: String,
        projectName: String,
        part: Int,
        totalParts: Int,
        totalFiles: Int
    ) throws {
        let fileManager = FileManager.default
        let filesFolder = folder.appendingPathComponent("Project Files", isDirectory: true)
        try fileManager.createDirectory(at: filesFolder, withIntermediateDirectories: true)

        let jsonData = try JSONSerialization.data(withJSONObject: catalog, options: [.prettyPrinted, .sortedKeys])
        try jsonData.write(to: folder.appendingPathComponent("catalog.json"), options: .atomic)
        try csv.write(to: folder.appendingPathComponent("library.csv"), atomically: true, encoding: .utf8)

        let manifest = files.map { "\($0.relativePath)\t\($0.sourceURL.path)" }.joined(separator: "\n")
        try manifest.write(to: folder.appendingPathComponent("manifest.txt"), atomically: true, encoding: .utf8)

        let readme = """
        \(projectName) Backup

        Part \(part) of \(totalParts). This archive contains \(files.count) project file\(files.count == 1 ? "" : "s") out of \(totalFiles).

        Files:
        - Project Files/: the files you selected for this project backup.
        - catalog.json: restoreable Video Library metadata, including tags, prompts, notes, ratings, paths, and file links.
        - library.csv: spreadsheet/reference export with tags, prompts, file paths, and file:// links.
        - manifest.txt: the archive path mapped to the original source path.
        """
        try readme.write(to: folder.appendingPathComponent("README.txt"), atomically: true, encoding: .utf8)

        for file in files {
            let destination = filesFolder.appendingPathComponent(file.relativePath)
            try fileManager.createDirectory(at: destination.deletingLastPathComponent(), withIntermediateDirectories: true)
            if fileManager.fileExists(atPath: destination.path) {
                try fileManager.removeItem(at: destination)
            }
            do {
                try fileManager.linkItem(at: file.sourceURL, to: destination)
            } catch {
                try fileManager.copyItem(at: file.sourceURL, to: destination)
            }
        }
    }

    private func relativePath(for fileURL: URL, inside root: URL, rootName: String) -> String {
        var relative = fileURL.path
        let rootPath = root.path.hasSuffix("/") ? root.path : root.path + "/"
        if relative.hasPrefix(rootPath) {
            relative = String(relative.dropFirst(rootPath.count))
        } else {
            relative = fileURL.lastPathComponent
        }
        let components = relative.split(separator: "/").map { safeRelativePathComponent(String($0)) }
        return ([rootName] + components).joined(separator: "/")
    }

    private func uniqueRelativePath(_ path: String, used: inout Set<String>) -> String {
        if !used.contains(path) {
            used.insert(path)
            return path
        }
        let nsPath = path as NSString
        let directory = nsPath.deletingLastPathComponent
        let fileName = nsPath.lastPathComponent as NSString
        let base = fileName.deletingPathExtension
        let ext = fileName.pathExtension
        var index = 2
        while true {
            let candidateName = ext.isEmpty ? "\(base) \(index)" : "\(base) \(index).\(ext)"
            let candidate = directory.isEmpty || directory == "." ? candidateName : "\(directory)/\(candidateName)"
            if !used.contains(candidate) {
                used.insert(candidate)
                return candidate
            }
            index += 1
        }
    }

    private func uniqueZipURL(in folder: URL, baseName: String) -> URL {
        let fileManager = FileManager.default
        let first = folder.appendingPathComponent("\(baseName).zip")
        if !fileManager.fileExists(atPath: first.path) { return first }
        let formatter = DateFormatter()
        formatter.dateFormat = "yyyy-MM-dd HH.mm.ss"
        let stamp = formatter.string(from: Date())
        return folder.appendingPathComponent("\(baseName) \(stamp).zip")
    }

    private func projectBackupName(for urls: [URL]) -> String {
        if urls.count == 1 {
            let url = urls[0]
            let name = isDirectory(url) ? url.lastPathComponent : url.deletingPathExtension().lastPathComponent
            return safeFileName(name.isEmpty ? "Video Library Project" : name)
        }
        if let folder = urls.map({ $0.deletingLastPathComponent().lastPathComponent }).filter({ !$0.isEmpty }).first {
            return safeFileName(folder)
        }
        return "Video Library Project"
    }

    private func isDirectory(_ url: URL) -> Bool {
        (try? url.resourceValues(forKeys: [.isDirectoryKey]).isDirectory) == true
    }

    private func safeRelativePathComponent(_ value: String) -> String {
        let cleaned = value
            .replacingOccurrences(of: "/", with: "-")
            .replacingOccurrences(of: ":", with: "-")
            .trimmingCharacters(in: .whitespacesAndNewlines)
        return cleaned.isEmpty || cleaned == "." || cleaned == ".." ? "untitled" : cleaned
    }

    private func safeFileName(_ value: String) -> String {
        let invalid = CharacterSet(charactersIn: "/:\\?%*|\"<>")
        let cleaned = value
            .components(separatedBy: invalid)
            .joined(separator: "-")
            .trimmingCharacters(in: .whitespacesAndNewlines)
        return cleaned.isEmpty ? "Video Library Project" : cleaned
    }

    @objc private func showMenuItemInFinder(_ sender: NSMenuItem) {
        guard let url = sender.representedObject as? URL else { return }
        revealInFinder(url)
    }

    @objc private func openMenuItemVideo(_ sender: NSMenuItem) {
        guard let url = sender.representedObject as? URL else { return }
        NSWorkspace.shared.open(url)
    }

    @objc private func copyMenuItemText(_ sender: NSMenuItem) {
        guard let text = sender.representedObject as? String else { return }
        let pasteboard = NSPasteboard.general
        pasteboard.clearContents()
        pasteboard.setString(text, forType: .string)
    }

    private func revealInFinder(_ url: URL) {
        if FileManager.default.fileExists(atPath: url.path) {
            NSWorkspace.shared.activateFileViewerSelecting([url])
            return
        }
        let parent = url.deletingLastPathComponent()
        if FileManager.default.fileExists(atPath: parent.path) {
            NSWorkspace.shared.open(parent)
        }
    }

    private func chooseFolder(id: String) {
        let panel = NSOpenPanel()
        panel.title = "Choose a video folder"
        panel.message = "The app will scan recursively and ignore non-video/system files."
        panel.canChooseFiles = false
        panel.canChooseDirectories = true
        panel.allowsMultipleSelection = false
        panel.directoryURL = FileManager.default.urls(for: .downloadsDirectory, in: .userDomainMask).first

        panel.begin { [weak self] response in
            guard response == .OK, let url = panel.url else {
                self?.sendNativeResponse(id: id, ok: true, payload: ["records": []])
                return
            }
            DispatchQueue.global(qos: .userInitiated).async { [weak self] in
                let records = self?.scan(folder: url) ?? []
                DispatchQueue.main.async {
                    self?.sendNativeResponse(id: id, ok: true, payload: [
                        "source": url.lastPathComponent,
                        "records": records
                    ])
                }
            }
        }
    }

    private func chooseFiles(id: String) {
        let panel = NSOpenPanel()
        panel.title = "Choose videos"
        panel.canChooseFiles = true
        panel.canChooseDirectories = false
        panel.allowsMultipleSelection = true
        panel.directoryURL = FileManager.default.urls(for: .downloadsDirectory, in: .userDomainMask).first

        panel.begin { [weak self] response in
            guard response == .OK else {
                self?.sendNativeResponse(id: id, ok: true, payload: ["records": []])
                return
            }
            let records = panel.urls.compactMap { self?.record(for: $0, root: $0.deletingLastPathComponent()) }
            self?.sendNativeResponse(id: id, ok: true, payload: [
                "source": "selected files",
                "records": records
            ])
        }
    }

    private func scan(folder root: URL) -> [[String: Any]] {
        guard let enumerator = FileManager.default.enumerator(
            at: root,
            includingPropertiesForKeys: [.isDirectoryKey, .isPackageKey, .fileSizeKey, .contentModificationDateKey],
            options: [.skipsHiddenFiles],
            errorHandler: { _, _ in true }
        ) else { return [] }

        var records: [[String: Any]] = []
        for case let url as URL in enumerator {
            let name = url.lastPathComponent
            if shouldSkipDirectory(url: url, name: name) {
                enumerator.skipDescendants()
                continue
            }
            guard isVideo(url) else { continue }
            if let record = record(for: url, root: root) {
                records.append(record)
            }
        }
        return records
    }

    private func shouldSkipDirectory(url: URL, name: String) -> Bool {
        let lower = name.lowercased()
        guard let values = try? url.resourceValues(forKeys: [.isDirectoryKey, .isPackageKey]) else {
            return false
        }
        guard values.isDirectory == true else {
            return false
        }
        if skippedDirectoryNames.contains(lower) { return true }
        if name.hasPrefix(".") { return true }
        if skippedPackageExtensions.contains(url.pathExtension.lowercased()) { return true }
        return values.isPackage == true
    }

    private func isVideo(_ url: URL) -> Bool {
        videoExtensions.contains(url.pathExtension.lowercased())
    }

    private func record(for url: URL, root: URL) -> [String: Any]? {
        guard isVideo(url) else { return nil }
        let values = try? url.resourceValues(forKeys: [.fileSizeKey, .contentModificationDateKey])
        let relativePath = url.path.replacingOccurrences(of: root.path + "/", with: "")
        let modifiedMilliseconds = Int64((values?.contentModificationDate ?? Date.distantPast).timeIntervalSince1970 * 1000)
        return [
            "name": url.lastPathComponent,
            "path": relativePath,
            "nativePath": url.path,
            "ext": url.pathExtension.lowercased(),
            "size": values?.fileSize ?? 0,
            "modified": modifiedMilliseconds,
            "source": root.lastPathComponent
        ]
    }

    private func sendNativeResponse(id: String, ok: Bool, payload: [String: Any] = [:], error: String? = nil) {
        guard Thread.isMainThread else {
            DispatchQueue.main.async { [weak self] in
                self?.sendNativeResponse(id: id, ok: ok, payload: payload, error: error)
            }
            return
        }
        var response: [String: Any] = [
            "id": id,
            "ok": ok,
            "payload": payload
        ]
        if let error {
            response["error"] = error
        }
        guard let data = try? JSONSerialization.data(withJSONObject: response),
              let json = String(data: data, encoding: .utf8)
        else { return }
        webView?.evaluateJavaScript("window.soraLibraryNativeResponse(\(json));")
    }

    private func proxyOllama(id: String, payload: [String: Any]) {
        let base = ollamaBaseURL(from: payload)
        guard let url = URL(string: "\(base)/api/chat"),
              let body = payload["body"] as? [String: Any],
              let data = try? JSONSerialization.data(withJSONObject: body)
        else {
            sendNativeResponse(id: id, ok: false, error: "Invalid Ollama request.")
            return
        }

        var request = URLRequest(url: url)
        request.httpMethod = "POST"
        request.timeoutInterval = 1800
        request.setValue("application/json", forHTTPHeaderField: "Content-Type")
        request.httpBody = data
        URLSession.shared.dataTask(with: request) { [weak self] data, response, error in
            if let error {
                DispatchQueue.main.async {
                    self?.sendNativeResponse(id: id, ok: false, error: error.localizedDescription)
                }
                return
            }
            let status = (response as? HTTPURLResponse)?.statusCode ?? 0
            guard (200..<300).contains(status), let data else {
                DispatchQueue.main.async {
                    self?.sendNativeResponse(id: id, ok: false, error: "Ollama request failed with status \(status).")
                }
                return
            }
            let text = String(data: data, encoding: .utf8) ?? ""
            DispatchQueue.main.async {
                self?.sendNativeResponse(id: id, ok: true, payload: ["text": text])
            }
        }.resume()
    }

    private func fetchOllamaModels(id: String, payload: [String: Any]) {
        let base = ollamaBaseURL(from: payload)
        requestOllamaModels(base: base) { [weak self] result in
            switch result {
            case .success(let models):
                self?.sendNativeResponse(id: id, ok: true, payload: ["models": models])
            case .failure(let error):
                self?.sendNativeResponse(id: id, ok: false, error: error.localizedDescription)
            }
        }
    }

    private func ensureOllama(id: String, payload: [String: Any]) {
        let base = ollamaBaseURL(from: payload)
        requestOllamaModels(base: base) { [weak self] result in
            switch result {
            case .success(let models):
                self?.sendNativeResponse(id: id, ok: true, payload: ["models": models])
            case .failure:
                self?.openOllamaAppIfPresent()
                self?.pollOllama(base: base, remainingAttempts: 30) { pollResult in
                    switch pollResult {
                    case .success(let models):
                        self?.sendNativeResponse(id: id, ok: true, payload: ["models": models])
                    case .failure(let error):
                        self?.sendNativeResponse(id: id, ok: false, error: "Ollama is not responding at \(base). \(error.localizedDescription)")
                    }
                }
            }
        }
    }

    private func pullOllamaModel(id: String, payload: [String: Any]) {
        let model = (payload["model"] as? String ?? "").trimmingCharacters(in: .whitespacesAndNewlines)
        guard !model.isEmpty else {
            sendNativeResponse(id: id, ok: false, error: "No Ollama model was specified.")
            return
        }

        DispatchQueue.global(qos: .userInitiated).async { [weak self] in
            do {
                guard let self else { return }
                let output = try self.runOllama(arguments: ["pull", model])
                self.sendNativeResponse(id: id, ok: true, payload: [
                    "model": model,
                    "log": self.truncatedProcessOutput(output)
                ])
            } catch {
                self?.sendNativeResponse(id: id, ok: false, error: error.localizedDescription)
            }
        }
    }

    private func ollamaBaseURL(from payload: [String: Any]) -> String {
        (payload["baseUrl"] as? String ?? "http://127.0.0.1:11434").trimmingCharacters(in: CharacterSet(charactersIn: "/"))
    }

    private func requestOllamaModels(base: String, completion: @escaping (Result<[String], Error>) -> Void) {
        guard let url = URL(string: "\(base)/api/tags") else {
            completion(.failure(NSError(domain: "SoraLibrary", code: 1, userInfo: [NSLocalizedDescriptionKey: "Invalid Ollama URL."])))
            return
        }

        URLSession.shared.dataTask(with: url) { data, response, error in
            if let error {
                completion(.failure(error))
                return
            }
            let status = (response as? HTTPURLResponse)?.statusCode ?? 0
            guard (200..<300).contains(status), let data else {
                completion(.failure(NSError(domain: "SoraLibrary", code: status, userInfo: [NSLocalizedDescriptionKey: "Ollama model lookup failed with status \(status)."])))
                return
            }
            let object = (try? JSONSerialization.jsonObject(with: data)) as? [String: Any]
            let models = (object?["models"] as? [[String: Any]] ?? []).compactMap { model in
                model["name"] as? String ?? model["model"] as? String
            }
            completion(.success(models))
        }.resume()
    }

    private func pollOllama(base: String, remainingAttempts: Int, completion: @escaping (Result<[String], Error>) -> Void) {
        requestOllamaModels(base: base) { [weak self] result in
            switch result {
            case .success:
                completion(result)
            case .failure where remainingAttempts > 0:
                DispatchQueue.main.asyncAfter(deadline: .now() + 1.0) {
                    self?.pollOllama(base: base, remainingAttempts: remainingAttempts - 1, completion: completion)
                }
            case .failure:
                completion(result)
            }
        }
    }

    private func openOllamaAppIfPresent() {
        let appURL = URL(fileURLWithPath: "/Applications/Ollama.app")
        guard FileManager.default.fileExists(atPath: appURL.path) else { return }
        NSWorkspace.shared.open(appURL)
    }

    private func runOllama(arguments: [String]) throws -> String {
        guard let executableURL = ollamaExecutableURL() else {
            throw NSError(domain: "SoraLibrary", code: 1, userInfo: [NSLocalizedDescriptionKey: "Could not find the Ollama command line tool."])
        }
        let process = Process()
        process.executableURL = executableURL
        process.arguments = arguments

        let pipe = Pipe()
        process.standardOutput = pipe
        process.standardError = pipe

        var collected = Data()
        let lock = NSLock()
        pipe.fileHandleForReading.readabilityHandler = { handle in
            let data = handle.availableData
            guard !data.isEmpty else { return }
            lock.lock()
            collected.append(data)
            lock.unlock()
        }

        try process.run()
        process.waitUntilExit()
        pipe.fileHandleForReading.readabilityHandler = nil
        let remainder = pipe.fileHandleForReading.readDataToEndOfFile()
        if !remainder.isEmpty {
            lock.lock()
            collected.append(remainder)
            lock.unlock()
        }

        let output = String(data: collected, encoding: .utf8) ?? ""
        guard process.terminationStatus == 0 else {
            throw NSError(domain: "SoraLibrary", code: Int(process.terminationStatus), userInfo: [
                NSLocalizedDescriptionKey: output.isEmpty ? "Ollama exited with status \(process.terminationStatus)." : truncatedProcessOutput(output)
            ])
        }
        return output
    }

    private func zipDirectory(_ directory: URL, destination: URL) throws {
        let process = Process()
        process.executableURL = URL(fileURLWithPath: "/usr/bin/zip")
        process.currentDirectoryURL = directory.deletingLastPathComponent()
        process.arguments = ["-qr", destination.path, directory.lastPathComponent]

        let pipe = Pipe()
        process.standardOutput = pipe
        process.standardError = pipe

        try process.run()
        process.waitUntilExit()

        let output = String(data: pipe.fileHandleForReading.readDataToEndOfFile(), encoding: .utf8) ?? ""
        guard process.terminationStatus == 0 else {
            throw NSError(domain: "SoraLibrary", code: Int(process.terminationStatus), userInfo: [
                NSLocalizedDescriptionKey: output.isEmpty ? "zip exited with status \(process.terminationStatus)." : truncatedProcessOutput(output)
            ])
        }
    }

    private func ollamaExecutableURL() -> URL? {
        [
            "/usr/local/bin/ollama",
            "/opt/homebrew/bin/ollama",
            "/Applications/Ollama.app/Contents/Resources/ollama"
        ]
        .map(URL.init(fileURLWithPath:))
        .first { FileManager.default.isExecutableFile(atPath: $0.path) }
    }

    private func truncatedProcessOutput(_ output: String) -> String {
        let clean = output.replacingOccurrences(of: "\r", with: "\n")
        if clean.count <= 6000 { return clean }
        return "...\n" + clean.suffix(6000)
    }

    private func thumbnailPayload(for path: String) throws -> [String: Any] {
        let data = try thumbnailData(for: path)
        guard let image = NSImage(data: data),
              let representation = image.representations.first
        else {
            throw NSError(domain: "SoraLibrary", code: 1, userInfo: [NSLocalizedDescriptionKey: "Could not read thumbnail."])
        }
        return [
            "mimeType": "image/jpeg",
            "base64": data.base64EncodedString(),
            "width": representation.pixelsWide,
            "height": representation.pixelsHigh
        ]
    }

    private func thumbnailData(for path: String) throws -> Data {
        let cacheURL = try thumbnailCacheURL(for: path)
        if let cached = try? Data(contentsOf: cacheURL), !cached.isEmpty {
            return cached
        }
        let asset = AVAsset(url: URL(fileURLWithPath: path))
        let generator = AVAssetImageGenerator(asset: asset)
        generator.appliesPreferredTrackTransform = true
        generator.maximumSize = CGSize(width: 480, height: 480)
        let image: CGImage
        do {
            image = try generator.copyCGImage(at: CMTime(seconds: 1.0, preferredTimescale: 600), actualTime: nil)
        } catch {
            image = try generator.copyCGImage(at: .zero, actualTime: nil)
        }
        let bitmap = NSBitmapImageRep(cgImage: image)
        guard let data = bitmap.representation(using: .jpeg, properties: [.compressionFactor: 0.82]) else {
            throw NSError(domain: "SoraLibrary", code: 1, userInfo: [NSLocalizedDescriptionKey: "Could not encode thumbnail."])
        }
        try data.write(to: cacheURL, options: [.atomic])
        return data
    }

    private func thumbnailCacheURL(for path: String) throws -> URL {
        let support = try FileManager.default.url(
            for: .applicationSupportDirectory,
            in: .userDomainMask,
            appropriateFor: nil,
            create: true
        )
        let directory = support.appendingPathComponent("Video Library/Thumbnails", isDirectory: true)
        try FileManager.default.createDirectory(at: directory, withIntermediateDirectories: true)
        let modified = ((try? FileManager.default.attributesOfItem(atPath: path)[.modificationDate] as? Date) ?? .distantPast).timeIntervalSince1970
        let keyData = Data("\(path)|\(modified)".utf8)
        let digest = SHA256.hash(data: keyData).map { String(format: "%02x", $0) }.joined()
        return directory.appendingPathComponent("\(digest).jpg")
    }

    func webView(_ webView: WKWebView, start urlSchemeTask: WKURLSchemeTask) {
        markSchemeTaskActive(urlSchemeTask)
        guard let scheme = urlSchemeTask.request.url?.scheme,
              let path = pathFromCustomScheme(urlSchemeTask.request.url)
        else {
            failSchemeTask(urlSchemeTask, error: NSError(domain: NSURLErrorDomain, code: NSURLErrorBadURL))
            return
        }

        if scheme == "soralibrary-thumb" {
            do {
                let data = try thumbnailData(for: path)
                let response = URLResponse(url: urlSchemeTask.request.url!, mimeType: "image/jpeg", expectedContentLength: data.count, textEncodingName: nil)
                if sendSchemeTaskResponse(response, task: urlSchemeTask),
                   sendSchemeTaskData(data, task: urlSchemeTask) {
                    finishSchemeTask(urlSchemeTask)
                }
            } catch {
                failSchemeTask(urlSchemeTask, error: error)
            }
            return
        }

        guard FileManager.default.fileExists(atPath: path)
        else {
            failSchemeTask(urlSchemeTask, error: NSError(domain: NSURLErrorDomain, code: NSURLErrorFileDoesNotExist))
            return
        }

        streamFile(path: path, task: urlSchemeTask)
    }

    func webView(_ webView: WKWebView, stop urlSchemeTask: WKURLSchemeTask) {
        clearSchemeTask(urlSchemeTask)
    }

    private func streamFile(path: String, task: WKURLSchemeTask) {
        let fileURL = URL(fileURLWithPath: path)
        let attributes = try? FileManager.default.attributesOfItem(atPath: path)
        let fileSize = (attributes?[.size] as? NSNumber)?.uint64Value ?? 0
        let mime = mimeType(for: fileURL.pathExtension)
        let requestedRange: ByteRange?
        do {
            requestedRange = try byteRange(from: task.request.value(forHTTPHeaderField: "Range"), fileSize: fileSize)
        } catch {
            sendRangeNotSatisfiable(task: task, fileSize: fileSize)
            return
        }

        let range: ByteRange
        let isPartialResponse: Bool
        if let requestedRange {
            range = requestedRange
            isPartialResponse = true
        } else if fileSize > initialVideoRangeSize {
            range = ByteRange(start: 0, end: min(fileSize - 1, initialVideoRangeSize - 1))
            isPartialResponse = true
        } else {
            range = ByteRange(start: 0, end: fileSize > 0 ? fileSize - 1 : 0)
            isPartialResponse = false
        }
        let contentLength = fileSize == 0 ? 0 : range.length
        var headers = [
            "Accept-Ranges": "bytes",
            "Content-Length": "\(contentLength)",
            "Content-Type": mime,
            "Cache-Control": "no-store"
        ]
        let statusCode: Int
        if isPartialResponse {
            statusCode = 206
            headers["Content-Range"] = "bytes \(range.start)-\(range.end)/\(fileSize)"
        } else {
            statusCode = 200
        }

        let response = HTTPURLResponse(
            url: task.request.url ?? fileURL,
            statusCode: statusCode,
            httpVersion: "HTTP/1.1",
            headerFields: headers
        ) ?? URLResponse(url: task.request.url ?? fileURL, mimeType: mime, expectedContentLength: Int(contentLength), textEncodingName: nil)

        guard sendSchemeTaskResponse(response, task: task) else { return }
        guard contentLength > 0 else {
            finishSchemeTask(task)
            return
        }

        DispatchQueue.global(qos: .userInitiated).async { [weak self] in
            guard let self else { return }
            do {
                let handle = try FileHandle(forReadingFrom: fileURL)
                defer { try? handle.close() }
                try handle.seek(toOffset: range.start)
                var remaining = contentLength
                while remaining > 0 {
                    guard self.isSchemeTaskActive(task) else { return }
                    let readSize = Int(min(UInt64(self.fileStreamChunkSize), remaining))
                    let data = try handle.read(upToCount: readSize) ?? Data()
                    if data.isEmpty { break }
                    remaining -= UInt64(data.count)
                    if !self.sendSchemeTaskData(data, task: task) { return }
                }
                self.finishSchemeTask(task)
            } catch {
                self.failSchemeTask(task, error: error)
            }
        }
    }

    private func byteRange(from header: String?, fileSize: UInt64) throws -> ByteRange? {
        guard let header = header?.trimmingCharacters(in: .whitespacesAndNewlines), !header.isEmpty else {
            return nil
        }
        guard fileSize > 0, header.lowercased().hasPrefix("bytes=") else {
            throw rangeError()
        }

        let rangeText = String(header.dropFirst("bytes=".count)).split(separator: ",", maxSplits: 1).first
            .map(String.init)?
            .trimmingCharacters(in: .whitespacesAndNewlines) ?? ""
        let parts = rangeText.split(separator: "-", maxSplits: 1, omittingEmptySubsequences: false)
        guard parts.count == 2 else { throw rangeError() }

        let lower = String(parts[0]).trimmingCharacters(in: .whitespacesAndNewlines)
        let upper = String(parts[1]).trimmingCharacters(in: .whitespacesAndNewlines)

        if lower.isEmpty {
            guard let suffixLength = UInt64(upper), suffixLength > 0 else { throw rangeError() }
            let length = min(suffixLength, fileSize)
            return ByteRange(start: fileSize - length, end: fileSize - 1)
        }

        guard let start = UInt64(lower), start < fileSize else { throw rangeError() }
        let end: UInt64
        if upper.isEmpty {
            end = fileSize - 1
        } else {
            guard let requestedEnd = UInt64(upper), requestedEnd >= start else { throw rangeError() }
            end = min(requestedEnd, fileSize - 1)
        }
        return ByteRange(start: start, end: end)
    }

    private func sendRangeNotSatisfiable(task: WKURLSchemeTask, fileSize: UInt64) {
        let headers = [
            "Accept-Ranges": "bytes",
            "Content-Range": "bytes */\(fileSize)",
            "Content-Length": "0"
        ]
        let response = HTTPURLResponse(
            url: task.request.url!,
            statusCode: 416,
            httpVersion: "HTTP/1.1",
            headerFields: headers
        ) ?? URLResponse(url: task.request.url!, mimeType: "application/octet-stream", expectedContentLength: 0, textEncodingName: nil)
        if sendSchemeTaskResponse(response, task: task) {
            finishSchemeTask(task)
        }
    }

    private func rangeError() -> NSError {
        NSError(domain: "SoraLibrary", code: 416, userInfo: [NSLocalizedDescriptionKey: "Requested byte range was not satisfiable."])
    }

    private func markSchemeTaskActive(_ task: WKURLSchemeTask) {
        schemeTaskLock.lock()
        activeSchemeTaskIDs.insert(ObjectIdentifier(task as AnyObject))
        schemeTaskLock.unlock()
    }

    private func clearSchemeTask(_ task: WKURLSchemeTask) {
        schemeTaskLock.lock()
        activeSchemeTaskIDs.remove(ObjectIdentifier(task as AnyObject))
        schemeTaskLock.unlock()
    }

    private func isSchemeTaskActive(_ task: WKURLSchemeTask) -> Bool {
        schemeTaskLock.lock()
        let active = activeSchemeTaskIDs.contains(ObjectIdentifier(task as AnyObject))
        schemeTaskLock.unlock()
        return active
    }

    private func sendSchemeTaskResponse(_ response: URLResponse, task: WKURLSchemeTask) -> Bool {
        performSchemeTaskUpdate(task) {
            task.didReceive(response)
        }
    }

    private func sendSchemeTaskData(_ data: Data, task: WKURLSchemeTask) -> Bool {
        performSchemeTaskUpdate(task) {
            task.didReceive(data)
        }
    }

    private func finishSchemeTask(_ task: WKURLSchemeTask) {
        _ = performSchemeTaskUpdate(task) {
            task.didFinish()
        }
        clearSchemeTask(task)
    }

    private func failSchemeTask(_ task: WKURLSchemeTask, error: Error) {
        _ = performSchemeTaskUpdate(task) {
            task.didFailWithError(error)
        }
        clearSchemeTask(task)
    }

    private func performSchemeTaskUpdate(_ task: WKURLSchemeTask, update: @escaping () -> Void) -> Bool {
        if Thread.isMainThread {
            guard isSchemeTaskActive(task) else { return false }
            update()
            return true
        }

        var sent = false
        DispatchQueue.main.sync {
            guard isSchemeTaskActive(task) else { return }
            update()
            sent = true
        }
        return sent
    }

    private func pathFromCustomScheme(_ url: URL?) -> String? {
        guard let url else { return nil }
        let prefix = "\(url.scheme ?? "")://"
        guard let decoded = url.absoluteString.replacingOccurrences(of: prefix, with: "").removingPercentEncoding else {
            return nil
        }
        return decoded
    }

    private func mimeType(for ext: String) -> String {
        switch ext.lowercased() {
        case "mp4", "m4v": return "video/mp4"
        case "mov": return "video/quicktime"
        case "webm": return "video/webm"
        case "ogv": return "video/ogg"
        default: return "application/octet-stream"
        }
    }

    private func buildMenu() {
        let mainMenu = NSMenu()
        let appMenuItem = NSMenuItem()
        let appMenu = NSMenu()

        appMenu.addItem(NSMenuItem(
            title: "Quit Video Library",
            action: #selector(NSApplication.terminate(_:)),
            keyEquivalent: "q"
        ))
        appMenuItem.submenu = appMenu
        mainMenu.addItem(appMenuItem)

        let editMenuItem = NSMenuItem()
        let editMenu = NSMenu(title: "Edit")
        editMenu.addItem(NSMenuItem(title: "Undo", action: Selector(("undo:")), keyEquivalent: "z"))
        editMenu.addItem(NSMenuItem(title: "Redo", action: Selector(("redo:")), keyEquivalent: "Z"))
        editMenu.addItem(.separator())
        editMenu.addItem(NSMenuItem(title: "Cut", action: #selector(NSText.cut(_:)), keyEquivalent: "x"))
        editMenu.addItem(NSMenuItem(title: "Copy", action: #selector(NSText.copy(_:)), keyEquivalent: "c"))
        editMenu.addItem(NSMenuItem(title: "Paste", action: #selector(NSText.paste(_:)), keyEquivalent: "v"))
        editMenu.addItem(NSMenuItem(title: "Select All", action: #selector(NSText.selectAll(_:)), keyEquivalent: "a"))
        editMenuItem.submenu = editMenu
        mainMenu.addItem(editMenuItem)

        NSApp.mainMenu = mainMenu
    }
}
