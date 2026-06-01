# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

---

## [1.1.0] — 2026-06-01

### Added
- Firefox support (Firefox 115+): dual `service_worker` + `scripts` background, gecko ID in manifest, `_resourceType` fallback via MIME inference for network capture, cross-browser `devtools.inspectedWindow.eval` handling, and cookie API proxied through the background script

### Changed
- HTTP Downgrade tool now probes both HTTP and HTTPS concurrently and checks for the `Strict-Transport-Security` header on HTTPS responses; results are classified into six categories: Vulnerable, Redirect / No HSTS, Redirect + HSTS, HSTS Enforced, HTTPS Only, and Unreachable

### Fixed
- Removed unused `tabs` permission (flagged by Chrome Web Store policy review)

---

## [1.0.0] — 2026-05-26

### Added
- API Inspector DevTools panel with real-time XHR/Fetch capture
- Request table with method, endpoint, status, and timing columns
- Detail drawer with Overview, Headers, Payload, Response, and Replay tabs
- Route tree explorer (Routes subtab) for visualising path structure
- Header Auditor subtab for response security header analysis
- Cookie manager subtab with per-cookie enable/disable toggles and session persistence
- Filter bar for endpoint search across captured requests
- Export to JSON and HAR formats
- cURL command generation with `-L --compressed` flags
- Request replay with editable headers and body
- Pentest Tools panel with:
  - Custom Request builder (method, URL, headers, body)
  - HTTP Downgrade tester
  - HTTP Inspector (raw response viewer)
  - Vulnerability Disclosure scanner (`/.well-known/security.txt` with RFC 9116 parsing)
- Media viewers for HTML (sandboxed iframe + source toggle), image, video, and audio responses
