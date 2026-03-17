---
title: "Spec: Detection"
created: 2026-03-16
updated: 2026-03-16
tags: [spawner, spec, detect]
---

# Detection

## Overview

Check if a CLI is installed, reachable, and authenticated. Detection never throws — all failures collapse into the result shape.

**Source:** `src/core/detect.ts` + each adapter's `detect()` method.

## Scope

**In:** Binary resolution, version extraction, auth status checking, timeout handling.

**Out:** Spawning processes for work, stream parsing, error classification beyond detect.

---

## Public API

```typescript
function detect(cli: CliName): Promise<DetectResult>;
function detectAll(): Promise<Record<CliName, DetectResult>>;
```

`detectAll()` runs all three detections concurrently via `Promise.all`.

---

## Binary Resolution Strategy

Do NOT use `which` (Unix-only) or `where` (Windows-only). Instead:

1. Spawn the binary with `--version` flag
2. Handle the result:
   - **Success** → installed, parse version from stdout
   - **ENOENT** → not installed (`installed: false`)
   - **Other error** → installed but broken (`installed: true`, `version: null`)

This works on macOS, Linux, and Windows without platform branching.

### Timeout

All detection spawns have a **10-second timeout**. If the process doesn't exit within 10s, kill it and treat as "installed but broken" (`installed: true`, `version: null`, `authenticated: false`).

### binaryPath

On successful version check, capture the resolved binary path. Use `process.env.PATH` resolution — the path is whatever the OS resolved when we spawned successfully. Set to `null` if not installed.

Implementation: after a successful `--version` spawn, run a second spawn of the version command and capture the binary from the spawn result, OR simply store the binary name (e.g., `'claude'`) since we know it resolved. Prefer the simple approach — just store the command name that worked.

---

## Per-CLI Implementation

### Claude Code

| Step | Command | Parse |
|------|---------|-------|
| Version | `claude --version` | Capture stdout, extract version string |
| Auth | `claude auth status` | Exit 0 = authenticated. Exit 1 = not. Returns JSON by default. |

### Codex

| Step | Command | Parse |
|------|---------|-------|
| Version | `codex --version` | Capture stdout, extract version string |
| Auth | `codex login status` | Exit 0 = authenticated. Non-zero = not. |

### OpenCode

| Step | Command | Parse |
|------|---------|-------|
| Version | `opencode --version` | Capture stdout, extract version string |
| Auth | `opencode auth list` | Parse output — lists authenticated providers. Empty or error = not authenticated. |

---

## Error Handling

`detect()` must **never throw**. Every failure maps to a valid `DetectResult`:

| Scenario | Result |
|----------|--------|
| Binary not found (ENOENT) | `{ installed: false, version: null, authenticated: false, binaryPath: null }` |
| Binary found, version parse fails | `{ installed: true, version: null, authenticated: false, binaryPath: 'cli-name' }` |
| Binary found, auth check fails | `{ installed: true, version: '...', authenticated: false, binaryPath: 'cli-name' }` |
| Binary found, auth check times out | `{ installed: true, version: '...', authenticated: false, binaryPath: 'cli-name' }` |
| Everything works | `{ installed: true, version: '...', authenticated: true, binaryPath: 'cli-name' }` |

Auth check only runs if the version check succeeds (binary is installed).

---

## Adapter Interface

Each adapter implements:

```typescript
detect(): Promise<DetectResult>
```

The core `detect(cli)` function looks up the adapter and calls `adapter.detect()`. The adapter handles the CLI-specific commands and parsing.

---

## Acceptance Criteria

- Given a CLI is installed and authenticated, when `detect(cli)` is called, then it returns `{ installed: true, version: '<version>', authenticated: true, binaryPath: '<name>' }`
- Given a CLI is not installed, when `detect(cli)` is called, then it returns `{ installed: false, version: null, authenticated: false, binaryPath: null }`
- Given a CLI is installed but not authenticated, when `detect(cli)` is called, then `authenticated` is `false` and `installed` is `true`
- Given a CLI hangs on `--version`, when 10 seconds elapse, then the process is killed and detect returns `installed: true, version: null`
- Given `detectAll()` is called, when all three CLIs are checked, then all three run concurrently and results are keyed by CliName
- Given any detection step throws an unexpected error, when `detect()` is called, then it still returns a valid DetectResult (never throws)
