# Upload Magic-Byte Validation, Permission Hardening, and Storage Cap (Issue #9)

## Summary

Replaced the client-controlled MIME type allow-list for image uploads with magic-byte content sniffing (PNG, JPEG, GIF, WebP), hardened upload file permissions (`0600`) and directory permissions (`0700`), and added an aggregate 200 MB storage cap with LRU eviction to prevent disk exhaustion.

## Context & Motivation

Previously, `bridge/server.ts` validated uploaded images using a bare object lookup `IMAGE_EXT[file.type]` against the client-supplied `Content-Type` header:
1. **Prototype Allow-List Bypass**: Client-provided values like `__proto__`, `constructor`, or `toString` resolved to truthy `Object.prototype` properties, bypassing validation and saving files with extensions like `.[object Object]`.
2. **Missing Magic-Byte Validation**: Files were accepted based solely on declared MIME type without verifying actual contents, allowing arbitrary payloads (scripts, text) to be saved as images.
3. **Weak File Permissions**: Files were written using `Bun.write` with default umask permissions rather than owner-only permissions (`0600`), and directory mode (`0700`) was only set if the directory was newly created.
4. **Unbounded Storage Growth**: While single uploads were capped at 10 MB, aggregate upload storage was unbounded between 48-hour TTL sweeps, creating disk exhaustion risk.

## Changes Made

### 1. Magic-Byte Sniffing & Allow-List Elimination
- **`bridge/uploads.ts` (`imageExtFromBytes`, `SNIFF_BYTES`, `SIGNATURES`)**:
  - Implemented pure byte-sniffing for PNG, JPEG, GIF, and WebP (checking both `RIFF` and `WEBP` magic headers).
  - Defined `SNIFF_BYTES = 12` to cover the longest signature (WebP).
  - Deleted `IMAGE_EXT` lookup table completely to structurally eliminate prototype property resolution.
- **`bridge/server.ts` (`uploadPane`)**:
  - Validates uploads using `imageExtFromBytes` on the first 12 bytes of the payload.
  - Returns a generic error `unsupported image type (expected PNG, JPEG, GIF or WebP)` without echoing client input.

### 2. File & Directory Permission Hardening
- **`bridge/server.ts` (`uploadPane`)**:
  - Uses `node:fs/promises` `writeFile(..., { mode: 0o600 })` instead of `Bun.write` so files are created owner-only (`0600`) at creation time without umask race conditions.
  - Re-asserts `chmod(dir, 0o700)` on `<stateDir>/uploads` to ensure existing directories are restricted.

### 3. Aggregate Storage Cap & LRU Eviction
- **`bridge/uploads.ts` (`MAX_UPLOADS_TOTAL_BYTES`, `filesToEvict`, `makeRoomForUpload`)**:
  - Set aggregate upload directory cap to 200 MB (`MAX_UPLOADS_TOTAL_BYTES`).
  - Added `filesToEvict` pure decision function to identify oldest uploads by `mtimeMs` to free sufficient space for incoming files.
  - Added `makeRoomForUpload` to evict oldest files before writing new uploads; returns `false` if eviction fails or incoming file exceeds total cap.
- **`bridge/server.ts` (`uploadPane`)**:
  - Calls `makeRoomForUpload` before saving uploads, returning `{ ok: false, error: "upload storage full" }` on failure.

### 4. Tests & Platform Compatibility
- **`bridge/uploads.test.ts`**:
  - Added unit tests for `imageExtFromBytes` covering all 4 valid image formats, invalid RIFF payloads, prototype property names (`__proto__`, `constructor`, `toString`, `hasOwnProperty`), shell scripts, and short buffers.
  - Added unit tests for `filesToEvict` and `makeRoomForUpload` testing headroom calculation, oldest-first eviction order, non-existent directories, stat/unlink error handling, and default cap limits.
  - Fixed path separator handling in mock filesystem (`p.split(/[\\/]/)`) for Windows compatibility.

## Verification

Run the uploads test suite:
```bash
bun test bridge/uploads.test.ts
```
All unit tests for magic-byte sniffing, LRU eviction, and permission handling pass.
