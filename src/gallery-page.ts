import { startGallery } from "./gallery-client.ts";
import { LIMITS } from "./limits.ts";
import { QUESTFORGE_ICON_DATA_URI } from "./brand/questforge-icon.ts";

const PAGE_STYLE = `
  :root {
    color-scheme: dark;
    --bg: #12100e;
    --bg-elevated: #1c1916;
    --bg-control: #241f1a;
    --bg-control-hover: #2e2821;
    --ink: #f3ebe0;
    --ink-muted: #b7a893;
    --gold: #c6a15b;
    --gold-soft: #a88645;
    --border: #3a3229;
    --border-strong: #5a4d3c;
    --focus: #d7b56a;
    --danger-surface: #2a1a16;
  }
  * { box-sizing: border-box; }
  html, body { max-width: 100%; overflow-x: hidden; }
  body {
    margin: 0;
    min-height: 100vh;
    font: 16px/1.45 "Segoe UI", "Helvetica Neue", Arial, sans-serif;
    background:
      radial-gradient(ellipse 90% 50% at 50% -10%, rgba(198, 161, 91, 0.12), transparent 55%),
      linear-gradient(180deg, #181410 0%, var(--bg) 28%, #0e0c0a 100%);
    color: var(--ink);
  }
  .site-header {
    display: flex;
    flex-direction: column;
    align-items: center;
    text-align: center;
    gap: 12px;
    padding: 36px 24px 28px;
    border-bottom: 1px solid var(--border);
    background: linear-gradient(180deg, rgba(28, 25, 22, 0.96) 0%, rgba(18, 16, 14, 0.92) 100%);
  }
  .brand-mark {
    display: block;
    width: 72px;
    height: 72px;
    object-fit: contain;
    border-radius: 14px;
    border: 1px solid var(--border-strong);
    background: var(--bg-elevated);
    box-shadow: 0 0 0 1px rgba(198, 161, 91, 0.18);
  }
  .site-header h1 {
    margin: 0;
    max-width: 22ch;
    font-family: Georgia, "Palatino Linotype", "Book Antiqua", Palatino, serif;
    font-size: clamp(1.45rem, 3.4vw, 2rem);
    font-weight: 700;
    letter-spacing: 0.01em;
    line-height: 1.2;
    color: var(--ink);
    text-wrap: balance;
  }
  .tagline {
    margin: 0;
    max-width: 36rem;
    font-size: 0.98rem;
    color: var(--gold);
    text-wrap: pretty;
  }
  #when {
    margin: 4px 0 0;
    font-size: 0.86rem;
    color: var(--ink-muted);
    font-variant-numeric: tabular-nums;
  }
  .status {
    margin: 0;
    padding: 16px 20px 0;
    color: var(--ink-muted);
  }
  .status:not([hidden]) {
    display: block;
    margin: 16px 20px 0;
    padding: 12px 14px;
    border: 1px solid var(--border);
    border-radius: 10px;
    background: var(--danger-surface);
    color: var(--ink);
  }
  .grid {
    display: grid;
    grid-template-columns: repeat(auto-fill, minmax(220px, 1fr));
    gap: 18px;
    align-items: stretch;
    padding: 20px 24px 40px;
    width: 100%;
    max-width: 1400px;
    margin: 0 auto;
  }
  figure {
    margin: 0;
    min-width: 0;
    height: 100%;
  }
  figure > button {
    display: flex;
    flex-direction: column;
    width: 100%;
    height: 100%;
    padding: 0;
    border: 1px solid var(--border);
    border-radius: 12px;
    background: var(--bg-control);
    color: inherit;
    text-align: left;
    cursor: pointer;
    overflow: hidden;
    transition: background-color 120ms ease, border-color 120ms ease;
  }
  figure > button:hover {
    background: var(--bg-control-hover);
    border-color: var(--border-strong);
  }
  figure > button:focus-visible {
    outline: 2px solid var(--focus);
    outline-offset: 2px;
  }
  figure > button img {
    display: block;
    width: 100%;
    aspect-ratio: 4 / 3;
    object-fit: cover;
    object-position: top center;
    background: #0a0908;
    border-bottom: 1px solid var(--border);
  }
  figcaption {
    padding: 10px 12px 12px;
    font-size: 0.92rem;
    color: var(--ink);
    line-height: 1.35;
    word-break: break-word;
  }
  dialog {
    width: min(960px, calc(100vw - 24px));
    max-height: calc(100vh - 24px);
    overflow: auto;
    border: 1px solid var(--border-strong);
    border-radius: 12px;
    padding: 14px;
    background: var(--bg-elevated);
    color: var(--ink);
  }
  dialog::backdrop {
    background: rgba(8, 7, 6, 0.72);
  }
  dialog img {
    display: block;
    width: 100%;
    height: auto;
    border-radius: 8px;
    border: 1px solid var(--border);
    background: #0a0908;
  }
  .dialog-close {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    width: auto;
    margin: 0 0 12px;
    padding: 8px 14px;
    border: 1px solid var(--border-strong);
    border-radius: 8px;
    background: var(--bg-control);
    color: var(--ink);
    font: inherit;
    cursor: pointer;
    transition: background-color 120ms ease, border-color 120ms ease;
  }
  .dialog-close:hover {
    background: var(--bg-control-hover);
    border-color: var(--gold-soft);
  }
  .dialog-close:focus-visible {
    outline: 2px solid var(--focus);
    outline-offset: 2px;
  }
  #full-label {
    margin: 10px 0 0;
    color: var(--ink-muted);
  }
  noscript {
    display: block;
    padding: 16px 20px;
    color: var(--ink-muted);
  }
  @media (max-width: 900px) {
    .site-header { padding: 28px 18px 22px; gap: 10px; }
    .brand-mark { width: 64px; height: 64px; border-radius: 12px; }
    .grid {
      grid-template-columns: repeat(auto-fill, minmax(180px, 1fr));
      gap: 14px;
      padding: 16px 18px 32px;
    }
  }
  @media (max-width: 640px) {
    .site-header { padding: 22px 14px 18px; gap: 8px; }
    .brand-mark { width: 56px; height: 56px; border-radius: 11px; }
    .site-header h1 { font-size: 1.28rem; max-width: 16ch; }
    .tagline { font-size: 0.92rem; padding: 0 4px; }
    .status:not([hidden]) { margin: 12px 12px 0; }
    .grid {
      grid-template-columns: repeat(auto-fill, minmax(140px, 1fr));
      gap: 12px;
      padding: 14px 12px 28px;
    }
    figcaption { font-size: 0.86rem; padding: 8px 10px 10px; }
  }
`;

export function galleryDocumentHtml(): string {
  const script = `function __name(target, value) {
  try { Object.defineProperty(target, "name", { value: value, configurable: true }); } catch (error) {}
  return target;
}
(${startGallery.toString()})(document, (url) => fetch(url, { cache: "no-store" }), ${JSON.stringify(LIMITS)});`;
  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>QuestForge Screenshot Gallery</title>
  <style>${PAGE_STYLE}</style>
</head>
<body>
  <header class="site-header">
    ${
      QUESTFORGE_ICON_DATA_URI
        ? `<img class="brand-mark" src="${QUESTFORGE_ICON_DATA_URI}" width="72" height="72" alt="QuestForge">`
        : ""
    }
    <h1>QuestForge Screenshot Gallery</h1>
    <p class="tagline">Latest previews across themes and screen sizes.</p>
    <p id="when">Loading the current set…</p>
  </header>
  <p id="status" class="status" hidden></p>
  <div id="grid" class="grid"></div>
  <dialog id="viewer">
    <button id="close" class="dialog-close" type="button">Close</button>
    <img id="full" alt="">
    <p id="full-label"></p>
  </dialog>
  <noscript>JavaScript is required to unpack the screenshot archive in the browser.</noscript>
  <script>${script}</script>
</body>
</html>
`;
}
