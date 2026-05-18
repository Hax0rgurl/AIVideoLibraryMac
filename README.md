# Video Library

[Try the browser demo](https://hax0rgurl.github.io/AIVideoLibraryMac/demo/)

[Download Video Library for Mac](https://github.com/Hax0rgurl/AIVideoLibraryMac/releases/latest/download/Video.Library.zip)

Video Library is a Mac app for organizing large video folders.

It is useful if you make or collect a lot of videos and need a simple way to
see them, search them, tag them, copy prompts, and clean up messy folders.

This free beta is maintained by Abandoned Muse.

Use this app at your own risk. Abandoned Muse is not legally responsible for
data loss, deleted files, damaged files, app errors, AI mistakes, system issues,
or anything else that may happen from using this app.


Demo
----

The browser demo lets you click around with fake sample videos before installing
the Mac app.

Use the demo to see the layout, search, tags, prompts, filters, metadata panel,
and batch selection.

The demo does not install anything. Real folder import, Finder actions, local
video preview, and Ollama setup are part of the Mac app.


How to install
--------------

1. Unzip the "Video Library.zip" file.
2. Drag "Video Library.app" into your Applications folder.
3. Open "Video Library.app".

If your Mac says the app cannot be opened:

1. Right-click "Video Library.app".
2. Choose "Open".
3. Click "Open" again.

If macOS still blocks it, use the included "Sentinel.dmg" helper. Sentinel is a
free Mac utility for unblocking/self-signing apps. Open Sentinel, then drag
"Video Library.app" onto it and follow its prompt.


What it does
------------

- Imports video folders.
- Shows thumbnails for browsing.
- Searches your video library.
- Lets you add tags, origin type, notes, ratings, favorites, and prompts.
- Lets you select many videos and save batch metadata at once.
- Has an "Unorganized" view for videos that still need metadata.
- Exports a JSON backup.
- Exports a CSV spreadsheet.
- Can make project ZIP backups.
- Right-click a video to show it in Finder or copy tags/prompts.
- Optional AI Studio can help name, tag, organize, and write prompts.


First use
---------

1. Click "Import Folder".
2. Choose the folder with your videos.
3. Wait for the scan to finish.
4. Click "Unorganized" in the Library sidebar.
5. Organize manually, or turn on AI Studio if you want AI help.


Using AI Studio
---------------

AI is optional. You can ignore it.

For local AI:

1. Install Ollama if you do not already have it.
2. Open Video Library.
3. Click "AI Studio".
4. Turn on "AI enabled".
5. Click "Install / Update Video Seer".
6. Close AI Studio.
7. Click "Unorganized".
8. Click "Organize" in the right-side Agent Queue.

The app will work through the unorganized videos. Click "Stop" any time.


Important
---------

- The app does not change your original video files during normal organizing.
- Metadata is stored inside the app's local library.
- Use "Backup JSON" before doing big organizing runs.
- Use "CSV" if you want a spreadsheet of your library.
- "Unorganized" means missing tags/prompt/metadata.
- "Origin" means whether the video is AI, Real, CGI/Digital, or Unknown.


Privacy
-------

Your videos stay on your Mac.

If you use local Ollama AI, the AI work happens locally.

If you use Gemini or an outside agent/webhook, metadata or frame information may
be sent to that outside service.
