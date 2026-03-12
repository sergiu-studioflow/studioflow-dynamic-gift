"use client";

import { useTheme } from "next-themes";
import { useEffect, useState } from "react";
import { Sun, Moon, Monitor } from "lucide-react";
import { cn } from "@/lib/utils";

type ThemeToggleProps = {
  variant?: "default" | "sidebar";
};

export function ThemeToggle({ variant = "default" }: ThemeToggleProps) {
  const { theme, setTheme } = useTheme();
  const [mounted, setMounted] = useState(false);

  useEffect(() => setMounted(true), []);

  if (!mounted) {
    return (
      <div className={cn(
        "flex items-center gap-0.5 rounded-lg p-0.5",
        variant === "sidebar" ? "bg-white/10" : "bg-secondary"
      )}>
        <div className="h-6 w-6" />
        <div className="h-6 w-6" />
        <div className="h-6 w-6" />
      </div>
    );
  }

  const options = [
    { value: "light", icon: Sun, label: "Light" },
    { value: "dark", icon: Moon, label: "Dark" },
    { value: "system", icon: Monitor, label: "System" },
  ];

  return (
    <div className={cn(
      "flex items-center gap-0.5 rounded-lg p-0.5",
      variant === "sidebar" ? "bg-white/10" : "bg-secondary"
    )}>
      {options.map(({ value, icon: Icon, label }) => (
        <button
          key={value}
          onClick={() => setTheme(value)}
          className={cn(
            "flex h-6 w-6 items-center justify-center rounded-md transition-all duration-150",
            variant === "sidebar"
              ? theme === value
                ? "bg-white/20 text-sidebar-foreground shadow-xs"
                : "text-sidebar-muted hover:text-sidebar-foreground"
              : theme === value
                ? "bg-background text-foreground shadow-xs"
                : "text-muted-foreground hover:text-foreground"
          )}
          title={label}
        >
          <Icon className="h-3 w-3" />
        </button>
      ))}
    </div>
  );
}
