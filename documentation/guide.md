# Arcane Scout — User Guide

## Overview

Arcane Scout is a Chrome DevTools extension. It adds two panels to the DevTools:

- **API Inspector** — captures and analyses every XHR and Fetch request made by the inspected page
- **Pentest Tools** — an integrated toolkit for manual web application security testing

Open DevTools (`F12`), then click the **Arcane Scout** tab at the top of the DevTools window.

---

## API Inspector

### Capturing requests

Requests are captured automatically as soon as the panel is open. Reload the page or interact with it to populate the table. Only XHR and Fetch traffic is captured — navigation and static assets are not shown.

The counter in the toolbar shows how many requests have been captured in this session.

### Toolbar

| Control | Action |
|---------|--------|
| Filter bar | Type to filter rows by URL or method |
| **Export ▾** | Save captured traffic as JSON or HAR |
| **Clear** | Remove all captured requests |

### Explorer subtabs

#### Requests

The main request table. Each row shows:

- **Method** — HTTP verb, colour-coded (GET green, POST blue, PUT amber, DELETE red, etc.)
- **Endpoint** — path and query string
- **Status** — HTTP response code, colour-coded
- **Time** — wall-clock time of the request

Click any row to open the **Detail drawer** on the right.

#### Routes

A collapsible tree of all captured path segments. Click a node to filter the Requests tab to that route prefix. Click **✕** in the filter bar to clear.

#### Header Auditor

Analyses every captured response for missing or misconfigured security headers (e.g. `Content-Security-Policy`, `Strict-Transport-Security`, `X-Frame-Options`). Each entry shows the header name, its current value (or absence), and a severity rating.

#### Cookies

Lists all cookies set on the current page's domain. Each row has a checkbox — uncheck it to delete the cookie from the browser for the current session. Re-check to restore it. Cookie disable state persists across page reloads but is cleared when the tab is closed.

Click **Refresh** to reload the cookie list after a page interaction.

### Detail drawer

Opened by clicking a request row. Tabs:

| Tab | Contents |
|-----|----------|
| **Overview** | URL, method, status, timing, initiator, redirects |
| **Headers** | Request and response headers, grouped and searchable |
| **Payload** | Request body (JSON pretty-printed, form data decoded, raw fallback) |
| **Response** | Response body — JSON pretty-printed, HTML preview (sandboxed iframe), image/video/audio viewers, raw text fallback |
| **Replay** | Editable copy of the request; modify method, URL, headers, or body and resend |

The **cURL** button in the Overview tab copies a ready-to-run `curl` command to the clipboard, including all request headers, body, and the `-L --compressed` flags.

---

## Pentest Tools

### Custom Request

A full HTTP request builder. Set the method, target URL, add arbitrary headers, and supply a body. The response is displayed inline with the same media viewers as the API Inspector (HTML iframe, image, video, audio, or raw text).

### HTTP Downgrade

Tests whether a URL responds over plain HTTP when called with an `http://` scheme. Useful for checking HSTS enforcement and redirect behaviour.

### HTTP Inspector

Sends a raw fetch and displays the unprocessed response headers and body, bypassing any browser normalisation.

### Vulnerability Disclosure

Fetches `/.well-known/security.txt` from the current page's domain (with automatic fallback to `www.<domain>` and the bare domain). Parses all RFC 9116 fields and renders them in a structured table:

- URL fields (`Contact`, `Encryption`, `Policy`, etc.) are rendered as clickable links that open in a new tab
- The `Expires` field shows a validity badge (green = valid, red = expired)

Click **Open Raw** to open the raw file in a new browser tab. The result is fetched once per domain visit; click **Refresh** to re-fetch.
