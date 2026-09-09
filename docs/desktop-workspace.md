# Desktop workspace

Keating desktop starts a native workspace server alongside its app window in both
development and packaged builds. Open **Runtime** to browse or edit files, run
installed programs, inspect output, and stop running commands. The model's
workspace tools use the same server and files. Browser clients continue to use
their configured runtime, including NodePod.

Files persist in the `workspace` directory under Electron's per-user Keating data
directory. The Runtime panel displays the full location. Reopening the app keeps
these files; closing the desktop window stops its managed processes. Native execution
does not require a separate Keating CLI or Node installation, but programs such
as Python, Git, or Bun must be installed on the computer to run them.

The Commands input explicitly uses the operating system shell. Model tools pass
a program and argument array without shell interpolation; shell scripts can use
an explicit shell executable. These processes run with the current user's
permissions, not in an isolated sandbox. Filesystem API operations are restricted
to the workspace, including checks for traversal and symlinks escaping it.

The server listens on an ephemeral `127.0.0.1` port. Its per-launch bearer token
and address remain in Electron's main process. The preload exposes specific
workspace operations through IPC restricted to the trusted main frame; it does
not expose a generic HTTP proxy. The browser website cannot connect through this
bridge. Child processes inherit basic OS environment variables rather than the
desktop application's credentials.

Native command output, concurrency, file size, and duration are bounded. Jobs
support polling, standard input, and stopping; cancelling a model command stops
its native process. Linux and macOS use process groups for descendant cleanup.
Windows uses `taskkill /T`; descendants that detach and outlive their launcher
may require separate cleanup. Commands use pipes, not a PTY: full-screen terminal
programs are not supported by the command panel.

Development starts this server automatically through `devenv up`'s desktop
process, or `bun run --cwd desktop dev` when the full web development server is
already running. Restart the desktop process after changes to Electron's main
process or preload.
