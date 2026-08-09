# Building the executable with Visual Studio

`NoggitDiamond.sln` wraps the whole packaging pipeline in a Visual Studio
solution: open it, press **Build**, and the Windows executable comes out.

## Prerequisites

- **Visual Studio 2022** (17.8 or newer) with the **JavaScript and TypeScript
  development** workload (any workload that includes the JavaScript Project
  System works — ASP.NET and Node.js workloads bundle it too).
- **Node.js 20+** on `PATH` (22 recommended — <https://nodejs.org>).
- First build needs internet access: NuGet restores the JavaScript project
  SDK, npm restores packages, and electron-builder downloads the Electron
  runtime. Everything after that is cached.

## Build

1. Open `NoggitDiamond.sln`.
2. Pick a configuration and **Build ▸ Build Solution** (Ctrl+Shift+B):

| Configuration | Output |
|---|---|
| **Debug** | `release\win-unpacked\Noggit Diamond.exe` — unpackaged, fast to rebuild |
| **Release** | `release\NoggitDiamond-Setup-<version>.exe` (installer) **and** `release\NoggitDiamond-<version>-win-<arch>.exe` (portable, no install needed) |

3. **Start** (F5 / Ctrl+F5) launches the desktop app.

Visual Studio runs `npm install` automatically when the project opens; the
build also self-heals a missing `node_modules` with `npm ci`.

## Command line (Developer Command Prompt)

```bat
msbuild /restore NoggitDiamond.sln /p:Configuration=Release
```

produces the same installer + portable exe in `release\`. This exact command
runs in CI on every packaging change (see the **Desktop builds** workflow's
`vs-solution` job), so the solution is continuously verified on a clean
Windows machine.

## How it works

`NoggitDiamond.esproj` (the modern Visual Studio JavaScript Project System)
hooks MSBuild's `Build` with a `MakeExecutable` target that runs
`npm run dist:win:dir` (Debug) or `npm run dist:win` (Release) — i.e.
Vite bundling followed by electron-builder packaging. `Clean` deletes
`dist\` and `release\`. No C++/C# toolchain is involved; the solution is
pure orchestration, so the same repo still builds on macOS/Linux with the
plain `npm run dist:*` commands.

## Troubleshooting

- **Project fails to load** — install the *JavaScript and TypeScript
  development* workload via the Visual Studio Installer.
- **`npm` not found during build** — install Node.js and restart Visual
  Studio so it picks up the new `PATH`.
- **SDK restore error on `Microsoft.VisualStudio.JavaScript.Sdk`** — check
  that nuget.org is reachable (corporate proxies may need configuring in
  `%AppData%\NuGet\NuGet.Config`).
- **Antivirus flags the unsigned installer** — expected for unsigned NSIS
  binaries you built yourself; sign with your own certificate via
  electron-builder's `win.certificateFile` options if needed.
