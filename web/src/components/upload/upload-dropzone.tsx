"use client";

import { useRef, useState, type DragEvent } from "react";
import { Icon } from "@/components/icon";
import { dropzone } from "@/content/upload";

type UploadDropzoneProps = {
  /** Section label: "Replace or Add Period" with an active statement. */
  title: string;
  onSelect: (file: File) => void;
  error?: string | null;
};

export function UploadDropzone({ title, onSelect, error }: UploadDropzoneProps) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [isDragging, setIsDragging] = useState(false);

  function handleDrop(event: DragEvent<HTMLButtonElement>) {
    event.preventDefault();
    setIsDragging(false);
    const file = event.dataTransfer.files[0];
    if (file) onSelect(file);
  }

  return (
    <div className="bg-surface-container-low rounded-xl p-4 space-y-3">
      {/* First, not last: space-y-3 would otherwise add margin under the drop target. */}
      <input
        ref={inputRef}
        type="file"
        accept="application/pdf,.pdf"
        className="hidden"
        onChange={(event) => {
          const file = event.target.files?.[0];
          if (file) onSelect(file);
          // Allow picking the same file again after it is removed.
          event.target.value = "";
        }}
      />
      <div className="flex items-center justify-between">
        <span className="font-label text-[10px] uppercase tracking-wider text-on-surface-variant font-semibold">
          {title}
        </span>
        <span className="text-[10px] font-label text-primary font-medium">
          {dropzone.badge}
        </span>
      </div>

      <button
        type="button"
        onClick={() => inputRef.current?.click()}
        onDragOver={(event) => {
          event.preventDefault();
          setIsDragging(true);
        }}
        onDragLeave={() => setIsDragging(false)}
        onDrop={handleDrop}
        className={`w-full rounded-xl p-5 flex flex-col items-center justify-center text-center space-y-2.5 transition-all hover:bg-surface-container-high focus-visible:outline-2 focus-visible:outline-primary-container ${
          isDragging ? "bg-surface-container-high" : "bg-surface-container-lowest"
        }`}
      >
        <div className="w-10 h-10 rounded-pill bg-surface-container flex items-center justify-center text-primary">
          <Icon name="cloud_upload" size={20} />
        </div>
        <div className="space-y-0.5">
          <p className="font-headline text-xs font-bold text-on-surface">{dropzone.prompt}</p>
          <p className="font-body text-[11px] text-on-surface-variant">{dropzone.caption}</p>
        </div>
        <div className="flex items-center gap-2 pt-1">
          {dropzone.tags.map((tag) => (
            <span
              key={tag}
              className="px-2 py-0.5 rounded-xs bg-surface-container text-on-surface-variant font-label text-[10px]"
            >
              {tag}
            </span>
          ))}
        </div>
      </button>

      {error && (
        <p role="alert" className="flex items-center gap-1 font-body text-[11px] text-error">
          <Icon name="error" size={14} />
          {error}
        </p>
      )}
    </div>
  );
}
