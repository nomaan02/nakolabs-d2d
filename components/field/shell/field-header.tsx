"use client";

import type { ReactNode } from "react";

import { FieldMenuButton } from "@/components/field/shell/field-shell";
import { UndoButton } from "@/components/field/ui/undo-button";

/**
 * FUI-1a (owner 2026-10-14, O3; Figma Field/Header 208:314). The one page
 * header every field tab uses. It never scrolls: FieldPage scrolls the body
 * under it. Solid surface and a 1px line, no blur (.ux-profile.md).
 *
 * Bar: menu (opens the drawer, top-left as in admin), title, one-line
 * subtitle, then the page's own items and the undo ring. `children` are the
 * extra rows under the bar (a view switch, the team strip).
 *
 * `undo`: the 44px undo ring that used to float over every tab but the
 * Logger (FloatingUndo, owner D5). The Logger keeps its own ring on the door
 * card (including the end-of-prop card), so it passes `undo={false}`.
 */
export function FieldHeader({
  title,
  subtitle,
  right,
  undo = true,
  children,
  testId = "field-header",
}: {
  title: ReactNode;
  subtitle?: ReactNode;
  right?: ReactNode;
  undo?: boolean;
  children?: ReactNode;
  testId?: string;
}) {
  return (
    <header className="relative z-20 shrink-0 border-b border-line bg-surface" data-testid={testId}>
      <div className="flex min-h-14 items-center gap-1 py-1.5 pr-4 pl-2">
        <FieldMenuButton />
        <div className="min-w-0 flex-1">
          <h1 className="truncate text-admin-headline text-ink" data-testid="field-header-title">
            {title}
          </h1>
          {subtitle ? (
            <div className="truncate text-admin-caption text-ink-muted" data-testid="field-header-subtitle">
              {subtitle}
            </div>
          ) : null}
        </div>
        {right || undo ? (
          <div className="flex shrink-0 items-center gap-2">
            {right}
            {undo ? <UndoButton /> : null}
          </div>
        ) : null}
      </div>
      {children}
    </header>
  );
}

/**
 * FUI-1a. A field tab: the fixed header, then the body, which is the only
 * thing that scrolls. `overscroll-y-contain` stops a pull at either end from
 * dragging anything else (the page itself never scrolls in /field: see
 * app/globals.css).
 */
export function FieldPage({
  header,
  children,
  testId,
}: {
  header: ReactNode;
  children: ReactNode;
  testId?: string;
}) {
  return (
    <div className="flex h-full flex-col" data-testid={testId}>
      {header}
      <div className="min-h-0 flex-1 overflow-y-auto overscroll-y-contain bg-field-bg" data-testid="field-scroll">
        {children}
      </div>
    </div>
  );
}
