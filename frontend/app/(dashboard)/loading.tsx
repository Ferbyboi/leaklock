export default function DashboardLoading() {
  return (
    <div className="space-y-6">
      {/* Header skeleton */}
      <div className="space-y-2">
        <div className="h-6 w-40 rounded-lg bg-gray-200/60 dark:bg-gray-700/40 animate-pulse" />
        <div className="h-4 w-64 rounded-md bg-gray-200/40 dark:bg-gray-700/30 animate-pulse" />
      </div>

      {/* KPI cards skeleton */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        {[1, 2, 3, 4].map((i) => (
          <div key={i} className="rounded-xl border border-gray-100 dark:border-gray-800 bg-white/50 dark:bg-gray-900/50 p-5 space-y-3">
            <div className="h-3 w-20 rounded bg-gray-200/50 dark:bg-gray-700/30 animate-pulse" />
            <div className="h-8 w-16 rounded bg-gray-200/50 dark:bg-gray-700/30 animate-pulse" />
          </div>
        ))}
      </div>

      {/* Content skeleton */}
      <div className="rounded-xl border border-gray-100 dark:border-gray-800 bg-white/50 dark:bg-gray-900/50 p-5 space-y-3">
        {[1, 2, 3].map((i) => (
          <div key={i} className="flex items-center gap-4">
            <div className="h-4 flex-1 rounded bg-gray-200/40 dark:bg-gray-700/25 animate-pulse" />
            <div className="h-4 w-20 rounded bg-gray-200/40 dark:bg-gray-700/25 animate-pulse" />
          </div>
        ))}
      </div>
    </div>
  );
}
