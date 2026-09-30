"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { Play, Pause, RefreshCw, Check } from "lucide-react";
import { cn } from "@/lib/utils";
import type { VoiceOption } from "@/lib/video-generation/voices";

type Props = {
  voices: VoiceOption[];
  /** "" = let the video model pick the voice (the behaviour before voices existed). */
  value: string;
  onChange: (voiceId: string) => void;
  disabled?: boolean;
  loading?: boolean;
  error?: string | null;
  /** Admins can re-sync after adding voices in ElevenLabs. */
  onRefresh?: () => void;
  refreshing?: boolean;
};

const GENDERS = [
  { key: "", label: "Any" },
  { key: "female", label: "Female" },
  { key: "male", label: "Male" },
];

export function VoicePicker({ voices, value, onChange, disabled, loading, error, onRefresh, refreshing }: Props) {
  const hasAustralian = voices.some((v) => v.accent === "australian");
  const [accent, setAccent] = useState<"australian" | "all">("australian");
  const [gender, setGender] = useState("");
  const [playing, setPlaying] = useState<string | null>(null);
  const audioRef = useRef<HTMLAudioElement | null>(null);

  useEffect(() => () => audioRef.current?.pause(), []);

  const shown = useMemo(
    () =>
      voices.filter(
        (v) =>
          // The chosen voice always stays visible, whatever the filters.
          v.voiceId === value ||
          ((accent === "all" || !hasAustralian || v.accent === "australian") && (!gender || v.gender === gender))
      ),
    [voices, accent, gender, hasAustralian, value]
  );

  function togglePreview(v: VoiceOption) {
    if (playing === v.voiceId) {
      audioRef.current?.pause();
      setPlaying(null);
      return;
    }
    audioRef.current?.pause();
    const audio = new Audio(v.previewUrl);
    audio.onended = () => setPlaying(null);
    audio.play().catch(() => setPlaying(null));
    audioRef.current = audio;
    setPlaying(v.voiceId);
  }

  const chip = (active: boolean) =>
    cn(
      "rounded-md border px-2.5 py-1 text-[11px] font-medium transition-colors",
      active ? "border-primary bg-primary/5 text-primary" : "border-border text-muted-foreground hover:border-primary/40"
    );

  return (
    <fieldset disabled={disabled} className={cn("space-y-3", disabled && "opacity-50")}>
      <div className="flex flex-wrap items-center gap-1.5">
        {GENDERS.map((g) => (
          <button key={g.key} type="button" aria-pressed={gender === g.key} onClick={() => setGender(g.key)} className={chip(gender === g.key)}>
            {g.label}
          </button>
        ))}
        {hasAustralian && (
          <>
            <span className="mx-1 h-4 w-px bg-border" />
            <button type="button" aria-pressed={accent === "australian"} onClick={() => setAccent("australian")} className={chip(accent === "australian")}>
              Australian
            </button>
            <button type="button" aria-pressed={accent === "all"} onClick={() => setAccent("all")} className={chip(accent === "all")}>
              All accents
            </button>
          </>
        )}
        {onRefresh && (
          <button
            type="button"
            onClick={onRefresh}
            disabled={refreshing}
            title="Reload voices from ElevenLabs"
            className="ml-auto inline-flex items-center gap-1 text-[11px] text-muted-foreground hover:text-foreground disabled:opacity-60"
          >
            <RefreshCw className={cn("h-3 w-3", refreshing && "animate-spin")} /> Refresh
          </button>
        )}
      </div>

      <div className="max-h-64 space-y-1 overflow-y-auto pr-1">
        <button
          type="button"
          aria-pressed={value === ""}
          onClick={() => onChange("")}
          className={cn(
            "flex w-full items-center gap-2 rounded-lg border-2 px-3 py-2 text-left transition-all",
            value === "" ? "border-primary bg-primary/5" : "border-border hover:border-primary/40"
          )}
        >
          <span className="flex-1 text-xs font-medium">Automatic</span>
          <span className="text-[10px] text-muted-foreground">the video model picks a voice</span>
          {value === "" && <Check className="h-3.5 w-3.5 text-primary" />}
        </button>

        {shown.map((v) => {
          const selected = value === v.voiceId;
          return (
            <div
              key={v.voiceId}
              className={cn(
                "flex items-center gap-2 rounded-lg border-2 px-2 py-1.5 transition-all",
                selected ? "border-primary bg-primary/5" : "border-border hover:border-primary/40"
              )}
            >
              <button
                type="button"
                onClick={() => togglePreview(v)}
                aria-label={playing === v.voiceId ? `Stop ${v.name}` : `Play ${v.name}`}
                className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-muted text-foreground hover:bg-muted/70"
              >
                {playing === v.voiceId ? <Pause className="h-3 w-3" /> : <Play className="h-3 w-3" />}
              </button>
              <button type="button" aria-pressed={selected} onClick={() => onChange(v.voiceId)} className="min-w-0 flex-1 text-left">
                <p className="truncate text-xs font-medium">{v.name}</p>
                <p className="truncate text-[10px] text-muted-foreground">
                  {[v.gender, v.age, v.accent, v.description].filter(Boolean).join(" · ")}
                </p>
              </button>
              {selected && <Check className="h-3.5 w-3.5 shrink-0 text-primary" />}
            </div>
          );
        })}

        {loading && <p className="px-1 py-2 text-[11px] text-muted-foreground">Loading voices…</p>}
        {!loading && !error && shown.length === 0 && (
          <p className="px-1 py-2 text-[11px] text-muted-foreground">No voices match these filters.</p>
        )}
        {error && <p className="px-1 py-2 text-[11px] text-red-500">{error}</p>}
      </div>
    </fieldset>
  );
}
