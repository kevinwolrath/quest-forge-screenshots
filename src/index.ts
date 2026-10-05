import { handleRequest, type GalleryBindings } from "./gallery.ts";

export default {
  async fetch(request: Request, env: GalleryBindings): Promise<Response> {
    return handleRequest(request, env);
  },
};
