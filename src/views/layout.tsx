import type { Child } from "hono/jsx";
import { raw } from "hono/html";
import { SITE_HOST } from "../config";

export interface DocumentProps {
  title: string;
  bodyClass?: string;
  children: Child;
}

/** The HTML shell shared by every page. */
export function Document({ title, bodyClass, children }: DocumentProps) {
  return (
    <>
      {raw("<!doctype html>")}
      <html lang="en-GB">
        <head>
          <meta charset="utf-8" />
          <meta name="viewport" content="width=device-width, initial-scale=1" />
          <meta name="color-scheme" content="dark light" />
          <meta name="robots" content="noindex" />
          <title>{title}</title>
          <link rel="icon" href="/favicon.svg" type="image/svg+xml" />
          <link rel="apple-touch-icon" href="/apple-touch-icon.png" />
          {/* The two faces used above the fold. */}
          <link rel="preload" href="/fonts/figtree-latin-wght-normal.woff2" as="font" type="font/woff2" crossorigin="anonymous" />
          <link rel="preload" href="/fonts/fragment-mono-latin-400-normal.woff2" as="font" type="font/woff2" crossorigin="anonymous" />
          <link rel="stylesheet" href="/css/fonts.css" />
          <link rel="stylesheet" href="/css/tokens.css" />
          <link rel="stylesheet" href="/css/app.css" />
          <link rel="stylesheet" href="/css/calendar.css" />
          {/* Not deferred: applies the theme and fixes `dtz` before first paint. */}
          <script src="/js/head.js"></script>
          <script src="/js/app.js" defer></script>
        </head>
        <body class={bodyClass}>{children}</body>
      </html>
    </>
  );
}

/** "Help · <SITE_HOST>" */
export function pageTitle(name: string): string {
  return `${name} · ${SITE_HOST}`; // PRINTED OUTPUT: page title / template
}
