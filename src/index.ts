/**
 * Fail-closed placeholder for the screenshot gallery.
 *
 * Do not replace this with public image/archive responses. Implement viewer
 * authentication and private R2 access before serving any gallery content.
 */
export default {
  async fetch(): Promise<Response> {
    return new Response("Screenshot gallery is not implemented yet.\n", {
      status: 503,
      headers: {
        "cache-control": "no-store",
        "content-type": "text/plain; charset=utf-8",
        "x-content-type-options": "nosniff",
      },
    });
  },
};
