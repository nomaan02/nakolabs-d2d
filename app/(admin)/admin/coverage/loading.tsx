/** UI-10 F4d: Coverage while its first load runs (filter changes keep the map). */
export default function CoverageLoading() {
  return (
    <div className="flex h-full items-center justify-center bg-field-bg" role="status" aria-label="Loading Coverage">
      <p className="text-admin-subhead text-ink-muted">Loading Coverage…</p>
    </div>
  );
}
