"use client";

import { useState, useRef, useCallback, useEffect } from "react";
import { Upload, X, Loader2, ImageIcon } from "lucide-react";
import { cn } from "@/lib/utils";

type ReferenceUploadProps = {
  onUploadComplete: (url: string) => void;
  onRemove: () => void;
  uploadedUrl: string | null;
  disabled?: boolean;
};

export function ReferenceUpload({
  onUploadComplete,
  onRemove,
  uploadedUrl,
  disabled,
}: ReferenceUploadProps) {
  const [isUploading, setIsUploading] = useState(false);
  const [isDragging, setIsDragging] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // Local blob URL for preview (R2 URLs are private and can't be displayed)
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  // Revoke blob URL on cleanup or when removed
  useEffect(() => {
    return () => {
      if (previewUrl) URL.revokeObjectURL(previewUrl);
    };
  }, [previewUrl]);

  const uploadFile = useCallback(
    async (file: File) => {
      if (!file.type.match(/^image\/(png|jpeg|jpg|webp)$/)) {
        setError("Only PNG, JPEG, and WebP images are supported");
        return;
      }
      if (file.size > 50 * 1024 * 1024) {
        setError("File must be under 50 MB");
        return;
      }

      setError(null);
      setIsUploading(true);

      // Create local preview immediately
      const localUrl = URL.createObjectURL(file);
      setPreviewUrl(localUrl);

      try {
        const formData = new FormData();
        formData.append("file", file);
        // brandSlug resolved server-side via BRAND_SLUG env var
        formData.append("assetType", "static-ad-system/reference-ads");

        const res = await fetch("/api/upload", { method: "POST", body: formData });
        const data = await res.json();

        if (!res.ok) {
          throw new Error(data.error || "Upload failed");
        }

        onUploadComplete(data.url);
      } catch (err) {
        setError(err instanceof Error ? err.message : "Upload failed");
        // Clear preview on error
        URL.revokeObjectURL(localUrl);
        setPreviewUrl(null);
      } finally {
        setIsUploading(false);
      }
    },
    [onUploadComplete]
  );

  const handleRemove = useCallback(() => {
    if (previewUrl) URL.revokeObjectURL(previewUrl);
    setPreviewUrl(null);
    onRemove();
  }, [previewUrl, onRemove]);

  const handleDrop = useCallback(
    (e: React.DragEvent) => {
      e.preventDefault();
      setIsDragging(false);
      if (disabled || isUploading) return;
      const file = e.dataTransfer.files[0];
      if (file) uploadFile(file);
    },
    [disabled, isUploading, uploadFile]
  );

  const handleFileChange = useCallback(
    (e: React.ChangeEvent<HTMLInputElement>) => {
      const file = e.target.files?.[0];
      if (file) uploadFile(file);
      e.target.value = "";
    },
    [uploadFile]
  );

  // Show uploaded preview
  if (uploadedUrl && previewUrl) {
    return (
      <div className="relative rounded-xl border border-border bg-card overflow-hidden group">
        <img
          src={previewUrl}
          alt="Reference ad"
          className="w-full max-h-[200px] object-contain bg-muted/30"
        />
        <button
          onClick={handleRemove}
          disabled={disabled}
          className="absolute top-2 right-2 rounded-full bg-black/60 p-1.5 text-white opacity-0 group-hover:opacity-100 transition-opacity hover:bg-black/80"
        >
          <X className="h-3.5 w-3.5" />
        </button>
        <div className="px-3 py-2 border-t border-border bg-card">
          <p className="text-[10px] text-muted-foreground truncate flex items-center gap-1.5">
            <ImageIcon className="h-3 w-3" />
            Reference uploaded
          </p>
        </div>
      </div>
    );
  }

  // Upload zone
  return (
    <div>
      <div
        onDragOver={(e) => {
          e.preventDefault();
          if (!disabled && !isUploading) setIsDragging(true);
        }}
        onDragLeave={() => setIsDragging(false)}
        onDrop={handleDrop}
        onClick={() => !disabled && !isUploading && inputRef.current?.click()}
        className={cn(
          "flex flex-col items-center justify-center gap-2 rounded-xl border-2 border-dashed p-6 transition-all cursor-pointer",
          isDragging
            ? "border-primary bg-primary/5"
            : "border-border hover:border-primary/40",
          (disabled || isUploading) && "opacity-50 cursor-not-allowed"
        )}
      >
        {isUploading ? (
          <>
            <Loader2 className="h-8 w-8 animate-spin text-primary/40" />
            <p className="text-xs text-muted-foreground">Uploading...</p>
          </>
        ) : (
          <>
            <Upload className="h-8 w-8 text-muted-foreground/30" />
            <p className="text-xs text-muted-foreground text-center">
              Drop a reference ad here or{" "}
              <span className="text-primary font-medium">browse</span>
            </p>
            <p className="text-[10px] text-muted-foreground/50">
              PNG, JPEG, WebP — max 50 MB
            </p>
          </>
        )}
        <input
          ref={inputRef}
          type="file"
          accept="image/png,image/jpeg,image/jpg,image/webp"
          onChange={handleFileChange}
          className="hidden"
        />
      </div>
      {error && (
        <p className="mt-2 text-[11px] text-red-500">{error}</p>
      )}
    </div>
  );
}
