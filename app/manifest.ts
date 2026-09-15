import type { MetadataRoute } from "next";

/**
 * Served at /manifest.webmanifest; Next adds the <link> automatically.
 *
 * Name and icons are placeholders (repo name, palette-token artwork) until a
 * branding decision is made. start_url is the field view because the
 * home-screen icon exists for canvassers; admin and office use a browser.
 */
export default function manifest(): MetadataRoute.Manifest {
  return {
    name: "nakolabs-d2d",
    short_name: "nakolabs-d2d",
    description: "Canvassing management platform",
    id: "/field",
    start_url: "/field",
    scope: "/",
    display: "standalone",
    orientation: "portrait",
    background_color: "#e4e6de",
    theme_color: "#fbfaf8",
    lang: "en-GB",
    icons: [
      { src: "/icons/icon-192.png", sizes: "192x192", type: "image/png" },
      { src: "/icons/icon-512.png", sizes: "512x512", type: "image/png" },
      { src: "/icons/icon-512.png", sizes: "512x512", type: "image/png", purpose: "maskable" },
    ],
  };
}
