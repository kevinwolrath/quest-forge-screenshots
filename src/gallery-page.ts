import { startGallery } from "./gallery-client.ts";
import { LIMITS } from "./limits.ts";

const PAGE_STYLE = `
  :root { color-scheme: light dark; }
  * { box-sizing: border-box; }
  body {
    margin: 0;
    font: 16px/1.45 system-ui, sans-serif;
    background: #f6f4ef;
    color: #1c1915;
  }
  header, .status { padding: 16px 20px 0; }
  h1 { font-size: 1.4rem; margin: 0 0 4px; }
  #when, .status { margin: 0; color: #4d463d; }
  .grid {
    display: grid;
    grid-template-columns: repeat(auto-fill, minmax(220px, 1fr));
    gap: 16px;
    padding: 16px 20px 32px;
  }
  figure { margin: 0; }
  button {
    display: block;
    width: 100%;
    padding: 0;
    border: 1px solid #d9d1c5;
    border-radius: 10px;
    background: #fff;
    color: inherit;
    text-align: left;
    cursor: pointer;
    overflow: hidden;
  }
  button:focus-visible { outline: 3px solid #0b62d6; outline-offset: 2px; }
  img { display: block; width: 100%; height: auto; background: #111; }
  figcaption { padding: 8px 10px 10px; font-size: 0.92rem; }
  dialog {
    width: min(960px, calc(100vw - 24px));
    border: 0;
    border-radius: 12px;
    padding: 12px;
  }
  dialog img { width: 100%; height: auto; }
  dialog button { width: auto; margin-bottom: 8px; padding: 8px 12px; }
  @media (max-width: 640px) {
    header, .status { padding: 12px 12px 0; }
    .grid {
      grid-template-columns: repeat(auto-fill, minmax(140px, 1fr));
      gap: 10px;
      padding: 12px;
    }
    h1 { font-size: 1.2rem; }
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
  <title>QuestForge screenshots</title>
  <style>${PAGE_STYLE}</style>
</head>
<body>
  <header>
    <h1>QuestForge screenshots</h1>
    <p id="when">Loading the current set…</p>
  </header>
  <p id="status" class="status" hidden></p>
  <div id="grid" class="grid"></div>
  <dialog id="viewer">
    <button id="close" type="button">Close</button>
    <img id="full" alt="">
    <p id="full-label"></p>
  </dialog>
  <noscript>JavaScript is required to unpack the screenshot archive in the browser.</noscript>
  <script>${script}</script>
</body>
</html>
`;
}
