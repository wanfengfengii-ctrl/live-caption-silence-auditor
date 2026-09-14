import { useState } from "react";
import { CoveragePage } from "./CoveragePage";
import { ReviewPage } from "./ReviewPage";

type View = "review" | "coverage";

const VIEWS: { key: View; label: string; testid: string }[] = [
  { key: "review", label: "空档审校", testid: "tab-review" },
  { key: "coverage", label: "覆盖分布", testid: "tab-coverage" },
];

export function App() {
  const [view, setView] = useState<View>("review");

  return (
    <main className="page">
      <h1>直播字幕审校台</h1>
      <nav className="tabs" role="tablist" aria-label="审校功能">
        {VIEWS.map(({ key, label, testid }) => (
          <button
            key={key}
            type="button"
            role="tab"
            aria-selected={view === key}
            className="tabs__tab"
            data-testid={testid}
            onClick={() => setView(key)}
          >
            {label}
          </button>
        ))}
      </nav>
      {view === "review" ? <ReviewPage /> : <CoveragePage />}
    </main>
  );
}
