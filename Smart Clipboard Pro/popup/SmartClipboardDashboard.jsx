import React, { useMemo, useState } from "react";
import {
  Calendar,
  CheckCircle2,
  ClipboardList,
  Clock,
  Copy,
  Edit3,
  Pin,
  Scissors,
  ShieldCheck,
  Sparkles,
  Trash2,
  Trophy,
} from "lucide-react";

const initialClipboardItems = [
  {
    id: "1",
    title: "Product blurb",
    body: "Crisp, confident copy for your next launch hero. Keep the tone friendly and focused on benefits.",
    copies: 8,
    category: "history",
    pinned: false,
    lastUsed: "just now",
  },
  {
    id: "2",
    title: "Pinned reply",
    body: "Thanks for reaching out. I just reviewed this and will follow up with a detailed update shortly.",
    copies: 12,
    category: "pinned",
    pinned: true,
    lastUsed: "5m ago",
  },
  {
    id: "3",
    title: "Snippet: signature",
    body: "Cheers,\nJordan — Senior PM\nSmart Clipboard Pro",
    copies: 4,
    category: "snippets",
    pinned: false,
    lastUsed: "10m ago",
  },
  {
    id: "4",
    title: "Code sample",
    body: "npm install smart-clipboard-pro\nnpx scp sync --watch",
    copies: 2,
    category: "history",
    pinned: false,
    lastUsed: "15m ago",
  },
];

function SmartClipboardDashboard() {
  const isPro = true;
  const [autoCopyEnabled, setAutoCopyEnabled] = useState(true);
  const [activeTab, setActiveTab] = useState("history");
  const [subscriptionStatus] = useState("Pro Plan");
  const [daysRemaining] = useState(17);
  const [timeSavedMinutes] = useState(48);
  const [clipboardItems] = useState(initialClipboardItems);

  const tabs = useMemo(
    () => [
      {
        key: "history",
        label: "History",
        icon: ClipboardList,
        count: clipboardItems.filter((item) => item.category === "history").length,
      },
      {
        key: "pinned",
        label: "Pinned",
        icon: Pin,
        count: clipboardItems.filter((item) => item.pinned).length,
      },
      {
        key: "snippets",
        label: "Snippets",
        icon: Scissors,
        count: clipboardItems.filter((item) => item.category === "snippets").length,
      },
    ],
    [clipboardItems]
  );

  const filteredItems = useMemo(() => {
    if (activeTab === "history") return clipboardItems;
    if (activeTab === "pinned") return clipboardItems.filter((item) => item.pinned);
    return clipboardItems.filter((item) => item.category === "snippets");
  }, [activeTab, clipboardItems]);

  return (
    <div className="min-h-screen w-full bg-slate-950 px-6 py-10 text-slate-100">
      <div className="mx-auto max-w-5xl rounded-3xl border border-white/10 bg-slate-900/70 shadow-2xl ring-1 ring-white/5 backdrop-blur-xl">
        <div className="relative overflow-hidden rounded-3xl">
          <div
            className="absolute inset-x-6 top-4 h-24 rounded-3xl bg-gradient-to-r from-sky-600/25 via-indigo-500/25 to-fuchsia-500/25 blur-3xl"
            aria-hidden
          />
          <header className="relative flex flex-col gap-4 border-b border-white/5 px-6 py-5 lg:flex-row lg:items-center lg:justify-between">
            <div className="space-y-1">
              <p className="text-xs font-semibold uppercase tracking-[0.3em] text-slate-400">
                Smart Clipboard
              </p>
              <div className="flex items-center gap-2 text-2xl font-semibold text-white">
                <Sparkles className="h-5 w-5 text-cyan-300" />
                <span>Clipboard Manager</span>
              </div>
              <p className="text-sm text-slate-400">
                Fluid control of everything you have copied — optimized for speed.
              </p>
            </div>
            <div className="flex flex-col gap-3 sm:flex-row sm:items-center">
              {isPro && (
                <div className="flex items-center gap-2 rounded-full border border-white/10 bg-gradient-to-r from-indigo-600/70 via-blue-600/70 to-cyan-500/70 px-3 py-1.5 text-sm font-semibold text-white shadow-lg shadow-blue-500/25">
                  <ShieldCheck className="h-4 w-4" />
                  <span>{subscriptionStatus}</span>
                  <span className="rounded-full bg-white/15 px-2 text-xs font-medium text-slate-100/90">
                    {daysRemaining} days left
                  </span>
                </div>
              )}
              <button
                type="button"
                onClick={() => setAutoCopyEnabled((prev) => !prev)}
                className={`group inline-flex items-center gap-3 rounded-full border px-4 py-2 text-sm font-semibold transition hover:translate-y-[-1px] ${
                  autoCopyEnabled
                    ? "border-emerald-400/70 bg-emerald-500/15 text-emerald-50 shadow-[0_0_24px_rgba(16,185,129,0.35)]"
                    : "border-slate-700 bg-slate-800 text-slate-100 shadow-[0_8px_30px_rgba(15,23,42,0.45)]"
                }`}
              >
                <div
                  className={`h-2.5 w-2.5 rounded-full transition ${
                    autoCopyEnabled
                      ? "bg-emerald-400 shadow-[0_0_16px_rgba(16,185,129,0.8)]"
                      : "bg-slate-500"
                  }`}
                />
                <span>Auto-Copy</span>
                <span
                  className={`rounded-full px-2 py-0.5 text-xs font-medium ${
                    autoCopyEnabled
                      ? "bg-emerald-400/15 text-emerald-100"
                      : "bg-slate-700 text-slate-200"
                  }`}
                >
                  {autoCopyEnabled ? "Active" : "Inactive"}
                </span>
              </button>
            </div>
          </header>

          <div className="relative space-y-6 px-6 py-6">
            <div className="grid grid-cols-1 gap-3 md:grid-cols-2 lg:grid-cols-5">
              {tabs.map((tab) => {
                const Icon = tab.icon;
                const isActive = tab.key === activeTab;
                return (
                  <button
                    key={tab.key}
                    type="button"
                    onClick={() => setActiveTab(tab.key)}
                    className={`flex items-center justify-between rounded-2xl border px-4 py-3 text-left text-sm font-semibold transition ${
                      isActive
                        ? "border-cyan-400/60 bg-gradient-to-r from-cyan-500/60 via-sky-500/60 to-blue-500/60 text-white shadow-lg shadow-cyan-500/20"
                        : "border-white/10 bg-white/5 text-slate-200 hover:border-cyan-300/40 hover:bg-white/10"
                    }`}
                  >
                    <span className="flex items-center gap-2">
                      <Icon className="h-4 w-4" />
                      {tab.label}
                    </span>
                    <span
                      className={`rounded-full px-2 py-0.5 text-xs font-semibold ${
                        isActive
                          ? "bg-white/20 text-white"
                          : "bg-slate-800 text-slate-100"
                      }`}
                    >
                      {tab.count}
                    </span>
                  </button>
                );
              })}

              <div className="flex items-center justify-between rounded-2xl border border-white/10 bg-white/5 px-4 py-3 text-sm">
                <div className="flex items-center gap-2">
                  <Calendar className="h-4 w-4 text-slate-200" />
                  <span className="text-slate-200">Days remaining</span>
                </div>
                <span className="text-base font-semibold text-white">{daysRemaining}d</span>
              </div>

              <div className="flex items-center justify-between rounded-2xl border border-white/10 bg-white/5 px-4 py-3 text-sm">
                <div className="flex items-center gap-2">
                  <Clock className="h-4 w-4 text-slate-200" />
                  <span className="text-slate-200">Time saved</span>
                </div>
                <span className="text-base font-semibold text-white">{timeSavedMinutes}m</span>
              </div>
            </div>

            <div className="space-y-3">
              <div className="flex items-center justify-between text-xs font-semibold uppercase tracking-[0.2em] text-slate-400">
                <span>{activeTab === "history" ? "Recent history" : activeTab === "pinned" ? "Pinned favorites" : "Snippets"}</span>
                <div className="flex items-center gap-2 text-slate-300">
                  <CheckCircle2 className="h-3.5 w-3.5 text-emerald-300" />
                  <span>Auto-clean enabled</span>
                </div>
              </div>
              <div className="space-y-3">
                {filteredItems.map((item) => (
                  <div
                    key={item.id}
                    className="relative overflow-hidden rounded-2xl border border-white/10 bg-white/5 p-4 shadow-xl shadow-slate-950/50 backdrop-blur-lg"
                  >
                    <div className="absolute inset-0 bg-gradient-to-br from-white/10 via-transparent to-slate-900/20" aria-hidden />
                    <div className="relative flex items-start justify-between gap-3">
                      <div>
                        <div className="flex items-center gap-2 text-xs text-slate-400">
                          <span>{item.copies}x copied</span>
                          <span className="text-slate-500">•</span>
                          <span>{item.lastUsed}</span>
                          {item.pinned && (
                            <span className="inline-flex items-center gap-1 rounded-full bg-amber-500/15 px-2 py-0.5 text-[10px] font-semibold text-amber-200">
                              <Pin className="h-3 w-3" />
                              Pinned
                            </span>
                          )}
                        </div>
                        <h3 className="mt-1 text-lg font-semibold text-white">{item.title}</h3>
                        <p className="mt-2 whitespace-pre-line text-sm leading-relaxed text-slate-200">
                          {item.body}
                        </p>
                      </div>
                      <div className="flex items-center gap-2 rounded-full border border-white/10 bg-slate-900/70 px-3 py-1 text-[11px] font-semibold text-slate-200">
                        <Sparkles className="h-3.5 w-3.5 text-cyan-200" />
                        Instant copy
                      </div>
                    </div>
                    <div className="relative mt-4 flex items-center justify-end gap-2">
                      <ActionButton icon={Copy} label="Copy" tone="from-cyan-500 to-blue-500" />
                      <ActionButton icon={Edit3} label="Edit" tone="from-indigo-500 to-purple-500" />
                      <ActionButton icon={Pin} label="Pin" tone="from-amber-500 to-orange-500" />
                      <ActionButton icon={Trash2} label="Delete" tone="from-rose-500 to-red-500" />
                    </div>
                  </div>
                ))}
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

function ActionButton({ icon: Icon, label, tone }) {
  return (
    <button
      type="button"
      className={`group flex items-center gap-2 rounded-xl border border-white/10 bg-slate-900/70 px-3 py-2 text-sm font-semibold text-slate-100 shadow-lg shadow-slate-950/40 transition hover:-translate-y-[1px] hover:border-white/20`}
    >
      <div
        className={`flex h-9 w-9 items-center justify-center rounded-lg bg-gradient-to-br ${tone} text-white shadow-inner shadow-slate-950/40`}
      >
        <Icon className="h-4 w-4" />
      </div>
      <span className="text-xs text-slate-200">{label}</span>
    </button>
  );
}

export default SmartClipboardDashboard;
