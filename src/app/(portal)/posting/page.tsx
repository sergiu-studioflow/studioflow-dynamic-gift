"use client";

import { useState } from "react";
import { Send, ListChecks, History, Plug } from "lucide-react";
import { cn } from "@/lib/utils";
import { PostingQueue } from "@/components/posting/posting-queue";
import { AccountsManager } from "@/components/posting/accounts-manager";

const TABS = [
  { key: "queue", label: "Queue", icon: ListChecks },
  { key: "history", label: "History", icon: History },
  { key: "accounts", label: "Accounts", icon: Plug },
];

export default function PostingPage() {
  const [tab, setTab] = useState("queue");

  return (
    <div className="flex h-full flex-col -m-10 -mt-12">
      <div className="flex shrink-0 items-center gap-1 border-b border-border bg-background px-6 py-3">
        <Send className="mr-2 h-4 w-4 text-primary" />
        <span className="mr-4 text-sm font-semibold text-foreground">Post Scheduler</span>
        {TABS.map(({ key, label, icon: Icon }) => (
          <button
            key={key}
            onClick={() => setTab(key)}
            className={cn(
              "flex items-center gap-1.5 rounded-md px-3 py-1.5 text-xs font-medium transition-all",
              tab === key ? "bg-primary text-primary-foreground" : "text-muted-foreground hover:bg-accent"
            )}
          >
            <Icon className="h-3.5 w-3.5" />
            {label}
          </button>
        ))}
      </div>

      <div className="flex-1 overflow-y-auto p-6">
        {tab === "queue" && <PostingQueue mode="queue" />}
        {tab === "history" && <PostingQueue mode="history" />}
        {tab === "accounts" && <AccountsManager />}
      </div>
    </div>
  );
}
