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
    --viewer-pad: 12px;
    --viewer-gap: 8px;
    --viewer-control: 48px;
    --viewer-margin: 16px;
    --viewer-inline-inset: calc(var(--viewer-margin) + env(safe-area-inset-left, 0px) + env(safe-area-inset-right, 0px));
    --viewer-block-inset: calc(var(--viewer-margin) + env(safe-area-inset-top, 0px) + env(safe-area-inset-bottom, 0px));
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
    gap: 14px;
    padding: 40px 24px 32px;
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
    max-width: 28rem;
    padding: 0 8px;
    font-family: Georgia, "Palatino Linotype", "Book Antiqua", Palatino, serif;
    font-size: clamp(1.45rem, 3.4vw, 2rem);
    font-weight: 700;
    letter-spacing: 0.01em;
    line-height: 1.25;
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
    justify-content: center;
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
    border: 1px solid var(--border-strong);
    border-radius: 12px;
    background: var(--bg-elevated);
    color: var(--ink);
  }
  dialog:modal {
    box-sizing: border-box;
    width: calc(100vw - var(--viewer-inline-inset));
    height: calc(100dvh - var(--viewer-block-inset));
    max-width: calc(100vw - var(--viewer-inline-inset));
    max-height: calc(100dvh - var(--viewer-block-inset));
    margin: auto;
    padding: var(--viewer-pad);
    overflow: hidden;
    overscroll-behavior: contain;
  }
  dialog[open] {
    display: flex;
    flex-direction: column;
    gap: var(--viewer-gap);
  }
  dialog::backdrop {
    background: rgba(8, 7, 6, 0.72);
  }
  .viewer-bar {
    display: flex;
    align-items: center;
    justify-content: flex-end;
    gap: 12px;
    flex: 0 0 auto;
    min-width: 0;
  }
  .viewer-stage {
    display: flex;
    align-items: center;
    justify-content: center;
    gap: var(--viewer-gap);
    flex: 1 1 auto;
    min-width: 0;
    min-height: 0;
  }
  .viewer-frame {
    display: flex;
    align-items: center;
    justify-content: center;
    flex: 1 1 auto;
    height: 100%;
    min-width: 0;
    min-height: 0;
  }
  dialog img {
    display: block;
    width: auto;
    height: auto;
    min-width: 0;
    min-height: 0;
    max-width: 100%;
    max-height: 100%;
    object-fit: contain;
    border-radius: 8px;
    border: 1px solid var(--border);
    background: #0a0908;
  }
  .dialog-close,
  .dialog-nav {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    flex: 0 0 auto;
    width: var(--viewer-control);
    height: var(--viewer-control);
    padding: 0;
    border-radius: 12px;
    cursor: pointer;
    touch-action: manipulation;
  }
  .dialog-close {
    border: 1px solid #e6d0a1;
    background: var(--gold);
    color: #1a140e;
    box-shadow: inset 0 1px 0 rgba(255, 236, 204, 0.45);
  }
  .dialog-close:hover {
    background: #d7b56a;
  }
  .dialog-nav {
    border: 1px solid var(--border-strong);
    background: #2c261f;
    color: var(--ink);
  }
  .dialog-nav:hover:not(:disabled) {
    background: #3a3229;
    border-color: var(--gold-soft);
  }
  .dialog-nav:disabled {
    opacity: 0.4;
    cursor: default;
  }
  .dialog-close:focus-visible,
  .dialog-nav:focus-visible {
    outline: 2px solid var(--focus);
    outline-offset: 2px;
  }
  .dialog-close svg,
  .dialog-nav svg {
    display: block;
    pointer-events: none;
  }
  #full-label {
    margin: 0;
    flex: 1 1 auto;
    min-width: 0;
    color: var(--ink-muted);
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
  }
  noscript {
    display: block;
    padding: 16px 20px;
    color: var(--ink-muted);
  }
  @media (max-width: 900px) {
    .site-header { padding: 32px 18px 24px; gap: 12px; }
    .brand-mark { width: 64px; height: 64px; border-radius: 12px; }
    .grid {
      grid-template-columns: repeat(auto-fill, minmax(180px, 1fr));
      gap: 14px;
      padding: 16px 18px 32px;
    }
  }
  @media (max-width: 640px) {
    .site-header { padding: 26px 16px 20px; gap: 10px; }
    .brand-mark { width: 56px; height: 56px; border-radius: 11px; }
    .site-header h1 { font-size: 1.35rem; }
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
  <dialog id="viewer" aria-labelledby="full-label">
    <div class="viewer-bar">
      <p id="full-label"></p>
      <button id="close" class="dialog-close" type="button" aria-label="Close image">
        <svg viewBox="0 0 24 24" width="24" height="24" aria-hidden="true" focusable="false">
          <path d="M6 6l12 12M18 6L6 18" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round"/>
        </svg>
      </button>
    </div>
    <div class="viewer-stage">
      <button id="prev" class="dialog-nav" type="button" aria-label="Previous image">
        <svg viewBox="0 0 24 24" width="28" height="28" aria-hidden="true" focusable="false">
          <path d="M14.5 5.5L7.5 12l7 6.5" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"/>
        </svg>
      </button>
      <div class="viewer-frame">
        <img id="full" alt="">
      </div>
      <button id="next" class="dialog-nav" type="button" aria-label="Next image">
        <svg viewBox="0 0 24 24" width="28" height="28" aria-hidden="true" focusable="false">
          <path d="M9.5 5.5L16.5 12l-7 6.5" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"/>
        </svg>
      </button>
    </div>
  </dialog>
  <noscript>JavaScript is required to unpack the screenshot archive in the browser.</noscript>
  <script>${script}</script>
</body>
</html>
`;
}
