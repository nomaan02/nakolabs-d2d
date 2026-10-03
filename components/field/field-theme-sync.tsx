"use client";

import { useEffect } from "react";

import { THEME_COLOR, currentResolvedTheme, useResolvedTheme, type ResolvedTheme } from "@/lib/field/theme";

function applyThemeColor(resolved: ResolvedTheme): void {
  const metas = document.querySelectorAll<HTMLMetaElement>('meta[name="theme-color"]');
  for (const meta of metas) {
    if (meta.getAttribute("content") !== THEME_COLOR[resolved]) {
      meta.setAttribute("content", THEME_COLOR[resolved]);
    }
  }
}

/**
 * Keeps `data-field-theme` and the browser chrome colour in step with the
 * saved choice and the phone. Next.js writes the root viewport colour back
 * onto the meta tag on a client navigation, so the head is watched and the
 * field colour is put back. Unmounting (leaving /field) clears both so
 * admin and office stay on the light paper colour.
 */
export function FieldThemeSync() {
  const resolved = useResolvedTheme();

  useEffect(() => {
    const live = currentResolvedTheme();
    document.documentElement.dataset.fieldTheme = live;
    applyThemeColor(live);

    const observer = new MutationObserver(() => {
      applyThemeColor(currentResolvedTheme());
    });
    observer.observe(document.head, {
      subtree: true,
      childList: true,
      attributes: true,
      attributeFilter: ["content"],
    });

    return () => {
      observer.disconnect();
      delete document.documentElement.dataset.fieldTheme;
      const reset = document.querySelectorAll<HTMLMetaElement>('meta[name="theme-color"]');
      for (const meta of reset) meta.setAttribute("content", THEME_COLOR.light);
    };
  }, [resolved]);

  return null;
}
