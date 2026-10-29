// 儀表板外殼：分頁、讀取資料、重新整理
import { buildModel, DEFAULT_WATCHLIST } from "./model.js";
import { el, overviewView, trendsView, findingsView, recsView } from "./views.js";

const TABS = [
  ["overview", "總覽", overviewView],
  ["trends", "趨勢", trendsView],
  ["findings", "發現", findingsView],
  ["recs", "建議", recsView],
  ["import", "匯入", null],
];

// deps: { adapter, dict, renderImport(panel, onWritten) }
export function mountDashboard(root, deps) {
  const { adapter, dict, renderImport } = deps;
  const state = { tab: "overview", curDate: null, trendCode: null, recDate: null, watchlist: [...DEFAULT_WATCHLIST], editWatch: false, showNormalFindings: false };
  let data = null, model = null, loadError = null;
  let importMounted = false;

  const tablist = el("div", { class: "tabs", role: "tablist", "aria-label": "主要分頁" });
  const panel = el("div", { class: "tabpanel", role: "tabpanel", id: "tabpanel", tabindex: "-1" });
  const importPanel = el("div", { class: "card", id: "import-panel", hidden: true }, el("h3", {}, "匯入健檢報告"), el("div", { id: "import-root" }));
  const banner = el("p", { class: "msg", role: "status" });
  root.replaceChildren(tablist, banner, panel, importPanel);

  const nav = {
    goTrend(code) { state.trendCode = code; show("trends"); },
    refresh() { renderTab(); },
  };
  const ctx = { get model() { return model; }, nav, state, adapter };

  function renderTabs() {
    tablist.replaceChildren(...TABS.map(([key, label]) => {
      const b = el("button", { type: "button", role: "tab", id: "tab-" + key, "aria-selected": String(state.tab === key), tabindex: state.tab === key ? 0 : -1, class: "tab", "aria-controls": "tabpanel" }, label);
      b.addEventListener("click", () => show(key));
      b.addEventListener("keydown", (e) => {
        const i = TABS.findIndex((t) => t[0] === key);
        const j = e.key === "ArrowRight" ? (i + 1) % TABS.length : e.key === "ArrowLeft" ? (i + TABS.length - 1) % TABS.length : -1;
        if (j >= 0) { e.preventDefault(); show(TABS[j][0]); tablist.querySelector("#tab-" + TABS[j][0]).focus(); }
      });
      return b;
    }));
  }

  function show(key) { state.tab = key; renderTabs(); renderTab(); }

  function renderTab() {
    const isImport = state.tab === "import";
    importPanel.hidden = !isImport;
    panel.hidden = isImport;
    if (isImport) {
      if (!importMounted) { importMounted = true; renderImport(importPanel.querySelector("#import-root"), reload); }
      return;
    }
    if (loadError) { panel.replaceChildren(el("div", { class: "card err-card" }, "資料讀取失敗：" + loadError)); return; }
    if (!model) { panel.replaceChildren(el("p", { class: "note" }, "讀取中…")); return; }
    const view = TABS.find((t) => t[0] === state.tab)[2];
    panel.replaceChildren(view(ctx));
  }

  async function reload() {
    banner.textContent = "";
    try {
      const [d, wl] = await Promise.all([adapter.loadAll(), adapter.loadWatchlist().catch(() => null)]);
      data = d; model = buildModel(d, dict); loadError = null;
      if (wl) state.watchlist = wl;
      if (state.curDate && !model.realDates.includes(state.curDate)) state.curDate = null;
      if (!model.realDates.length) { state.tab = state.tab === "import" ? "import" : "import"; }
    } catch (e) { loadError = e.code || e.message || String(e); model = null; }
    renderTabs(); renderTab();
  }

  renderTabs(); renderTab();
  return reload().then(() => ({ reload, state, get model() { return model; } }));
}
