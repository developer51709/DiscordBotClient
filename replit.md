# DiscordBotClient

## Overview
DiscordBotClient is an Electron-based desktop application that allows users to log into Discord using a bot token. It creates a local HTTPS proxy server that intercepts and modifies Discord API calls to enable bot account usage through Discord's web interface.

## Project Architecture
- **Language**: TypeScript compiled to JavaScript
- **Runtime**: Node.js 20 with Electron 40
- **Build System**: `tsc` + `tsc-alias` (TypeScript compiler with path alias resolution)
- **Package Manager**: npm
- **Display**: Webview (HTTP server on port 5000) + headless Electron via xvfb-run

### Key Directories
- `src/` - TypeScript source code
  - `src/AppCore/` - Core application logic (Electron window, API server, IPC, config)
  - `src/AppUtils/` - Utility classes (proxy, user patches, route registration)
  - `src/AppCore/routes/` - Express route handlers for Discord API interception
- `build/` - Compiled JavaScript output
- `assets/` - Static assets (icons, certificates, Discord HTML snapshot)
- `VencordExtension/` - Vencord web extension (placeholder; needs full build for functionality)
- `scripts/` - Build and setup scripts

### How It Works
1. Express HTTPS server starts on a random port with self-signed certificates
2. Electron maps `discord.com` to `127.0.0.1:<port>` via host-rules
3. BrowserWindow loads Discord's web interface through the proxy
4. The proxy intercepts API calls and modifies them for bot account compatibility
5. Vencord extension is loaded for additional client modifications

## Environment Setup (Replit)
- System dependencies: X11 libs, GTK3, NSS, ALSA, Mesa (libgbm), libxkbcommon
- `LD_LIBRARY_PATH` includes mesa-libgbm path for Electron
- Electron runs with `--no-sandbox --disable-gpu --disable-dev-shm-usage` flags
- Webview output on port 5000 (HTTP server shares Express app with HTTPS server)
- Electron runs headlessly via xvfb-run for background processing

## Build Commands
- `npm run build:ts` - Compile TypeScript to `build/`
- `npm run requirement` - Install deps + clone Vencord
- `npm run vencord` - Build Vencord extension

## Recent Changes
- 2026-02-20: Initial Replit setup with VNC workflow, system dependencies, and placeholder VencordExtension
- 2026-02-20: Switched from VNC to webview output with dual HTTP/HTTPS server architecture for mobile keyboard support
