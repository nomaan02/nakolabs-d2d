"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";

import { PeriodSelect, readPeriod, savePeriod } from "@/components/field/crm/period-select";
import { Segmented } from "@/components/field/crm/segmented";
import { useFieldData } from "@/components/field/field-data-provider";
import { FieldHeader, FieldPage } from "@/components/field/shell/field-header";
import { ChevronLeftIcon } from "@/components/field/icons";
import { BOARD_METRICS, boardView, parseBoardMetric, PERIOD_WORDS, periodSpan, rankBoard, type BoardMetric, type RankedRow, type ResultPeriod } from "@/lib/field/crm";
import { fetchLeaderboard, useCrmMe, useLoad } from "@/lib/field/crm-data";

/** v2 (owner 2026-10-13): a new key so everyone starts on Pitched once. */
const METRIC_KEY = "d2d.crm.boardMetric.v2";

/**
 * CRM-5 C, Figma F4 (186:520). Bristol branches, everyone in the CRM, by
 * first name: Pitched (sale + P&M, the default — owner 2026-10-13), Sales or
 * Value (£, visible for everyone — owner 2026-10-11). Totals only
 * (crm_leaderboard). Top 8 and you.
 */
export function LeaderboardTab() {
  const { canvasserId } = useFieldData();
  return <LeaderboardScreen canvasserId={canvasserId} />;
}

export function LeaderboardScreen({ canvasserId }: { canvasserId: string | null }) {
  const me = useCrmMe(canvasserId);
  const [metric, setMetric] = useState<BoardMetric>("pitched");
  const [period, setPeriod] = useState<ResultPeriod>("month");

  useEffect(() => {
    setPeriod(readPeriod("month"));
    try {
      setMetric(parseBoardMetric(window.localStorage.getItem(METRIC_KEY)));
    } catch {
      // Private mode: start on Pitched.
    }
  }, []);

  const span = periodSpan(period, new Date());
  const board = useLoad(`board:${span.from}`, () => fetchLeaderboard(span.from, span.to));
  const who = useMemo(() => (me.kind === "ready" ? me.data : { name: null, branch: null }), [me]);
  const ranked = useMemo(() => (board.kind === "ready" ? rankBoard(board.data, metric, who) : null), [board, metric, who]);
  const view = ranked ? boardView(ranked) : null;

  const chooseMetric = (m: BoardMetric) => {
    setMetric(m);
    try {
      window.localStorage.setItem(METRIC_KEY, m);
    } catch {
      // Private mode: the choice lasts for this visit only.
    }
  };

  return (
    // FUI-3 (owner 2026-10-15, Figma B1): the Pitched / Sales / Value switch
    // sits in the fixed header; the period, the board and the footnote scroll.
    <FieldPage
      testId="leaderboard"
      header={
        <FieldHeader title="Leaderboard" subtitle={`Bristol branches · ${span.line}`}>
          <div className="mx-auto max-w-2xl px-4 pb-3">
            <Segmented label="Rank by" value={metric} onChange={chooseMetric} options={BOARD_METRICS} testId="leaderboard-metric" />
          </div>
        </FieldHeader>
      }
    >
      <div className="mx-auto max-w-2xl px-4 pb-8">
      <Link href="/field/profile" className="-ml-2 mt-1 inline-flex min-h-tap-min items-center gap-1 px-2 text-base text-prop">
        <ChevronLeftIcon className="size-5" />
        You
      </Link>

      <div className="mt-1 flex items-center gap-3">
        <PeriodSelect
          value={period}
          onChange={(p) => {
            setPeriod(p);
            savePeriod(p);
          }}
          testId="leaderboard-period"
        />
        <span className="text-field-body text-ink-muted">{span.line}</span>
      </div>

      {view === null ? (
        <p className="mt-6 text-field-body text-ink-muted">
          {board.kind === "offline" ? "No signal. The leaderboard loads when you’re back online." : board.kind === "error" ? "The leaderboard didn’t load." : "Loading the leaderboard…"}
        </p>
      ) : view.top.length === 0 ? (
        <p className="mt-6 rounded-field-lg border border-line bg-surface px-4 py-4 text-field-body text-ink-muted">
          {metric === "pitched" ? "Nobody has pitched" : "Nobody has sold"} {PERIOD_WORDS[period]} yet.
        </p>
      ) : (
        <>
          <ol className="mt-4 divide-y divide-line overflow-hidden rounded-field-lg border border-line bg-surface">
            {view.top.map((row) => (
              <Row key={`${row.canvasser}|${row.branch}`} row={row} />
            ))}
          </ol>
          {view.me ? (
            <ol className="mt-2 overflow-hidden rounded-field-lg border border-line bg-surface">
              <Row row={view.me} />
            </ol>
          ) : null}
          <p className="mt-3 text-field-body text-ink-muted">
            {ranked?.length === 1 ? "1 person" : `${ranked?.length ?? 0} people`} on the board {PERIOD_WORDS[period]}.
            {ranked && ranked.length > view.top.length ? " Showing the top 8 and you." : ""}
          </p>
        </>
      )}
      </div>
    </FieldPage>
  );
}

function Row({ row }: { row: RankedRow }) {
  return (
    <li className={`flex items-center gap-3 px-4 py-2.5 ${row.you ? "bg-prop-soft" : ""}`} data-testid={row.you ? "leaderboard-you" : "leaderboard-row"}>
      <span className={`w-6 shrink-0 text-right text-lg tabular-nums ${row.you ? "text-prop" : "text-ink-muted"}`}>{row.rank}</span>
      <span className="min-w-0 flex-1">
        <span className={`block truncate text-admin-headline ${row.you ? "text-prop" : "text-ink"}`}>{row.canvasser}</span>
        <span className="block truncate text-field-body text-ink-muted">
          {row.branch}
          {row.you ? " · you" : ""}
        </span>
      </span>
      <span className="shrink-0 text-right">
        <span className="block text-base font-semibold tabular-nums text-ink">{row.main}</span>
        <span className="block text-field-body text-ink-muted tabular-nums">{row.sub}</span>
      </span>
    </li>
  );
}
