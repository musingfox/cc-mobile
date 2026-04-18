import { ArrowUp, Bot, Terminal } from "lucide-react";
import { type KeyboardEvent, useEffect, useMemo, useRef, useState } from "react";
import type { ContentBlock } from "../../../server/protocol";
import { clearDraft, loadDraft, saveDraft } from "../../services/draft-persistence";
import { hapticService } from "../../services/haptic";
import { toastService } from "../../services/toast-service";
import { uploadFile } from "../../services/upload-service";
import { wsService } from "../../services/ws-service";
import { type Capabilities, useAppStore } from "../../stores/app-store";
import { buildContentBlocks } from "../../utils/content-block-builder";
import { resizeImage } from "../../utils/image-resize";
import AttachmentButton from "../AttachmentButton";
import AttachmentPreview, { type FileAttachment, type ImageAttachment } from "../AttachmentPreview";
import FloatingAutocomplete from "../FloatingAutocomplete";
import QuickActions from "../QuickActions";
import IconButton from "./IconButton";

interface MessageComposerProps {
  sessionId: string | null;
  disabled?: boolean;
  onOpenAgents: () => void;
  onOpenCommands: () => void;
  capabilities: Capabilities | null;
}

export default function MessageComposer({
  sessionId,
  disabled = false,
  onOpenAgents,
  onOpenCommands,
  capabilities,
}: MessageComposerProps) {
  const value = useAppStore((s) => s.inputDraft);
  const setValue = useAppStore((s) => s.setInputDraft);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const [selectedIndex, setSelectedIndex] = useState(0);
  const debounceTimerRef = useRef<number | null>(null);
  const [images, setImages] = useState<ImageAttachment[]>([]);
  const [files, setFiles] = useState<FileAttachment[]>([]);
  const [isUploading, setIsUploading] = useState(false);

  // Load draft when sessionId changes
  useEffect(() => {
    if (sessionId) {
      const draft = loadDraft(sessionId);
      setValue(draft);
    } else {
      setValue("");
    }
  }, [sessionId, setValue]);

  // Auto-save draft on typing with debounce
  useEffect(() => {
    if (!sessionId) return;

    if (debounceTimerRef.current !== null) {
      clearTimeout(debounceTimerRef.current);
    }

    debounceTimerRef.current = setTimeout(() => {
      saveDraft(sessionId, value);
    }, 500) as unknown as number;

    return () => {
      if (debounceTimerRef.current !== null) {
        clearTimeout(debounceTimerRef.current);
      }
    };
  }, [value, sessionId]);

  const resizeTextarea = () => {
    if (textareaRef.current) {
      textareaRef.current.style.height = "auto";
      textareaRef.current.style.height = `${textareaRef.current.scrollHeight}px`;
    }
  };

  const prevSuggestionsLenRef = useRef(0);
  const suggestions = useMemo(() => {
    if (!capabilities || !value) return [];

    const trimmed = value.trimStart();
    if (trimmed.startsWith("/")) {
      const query = trimmed.slice(1).toLowerCase();
      return capabilities.commands
        .filter((c) => c.name.toLowerCase().includes(query))
        .map((c) => ({ label: `/${c.name}`, type: "command" as const }));
    }
    if (trimmed.startsWith("@")) {
      const query = trimmed.slice(1).toLowerCase();
      return capabilities.agents
        .filter((a) => a.name.toLowerCase().includes(query))
        .map((a) => ({ label: `@${a.name}`, type: "agent" as const }));
    }
    return [];
  }, [value, capabilities]);

  // Reset selected index when suggestions list changes
  if (suggestions.length !== prevSuggestionsLenRef.current) {
    prevSuggestionsLenRef.current = suggestions.length;
    setSelectedIndex(0);
  }

  const handleSend = () => {
    const trimmed = value.trim();
    if ((!trimmed && images.length === 0 && files.length === 0) || disabled || isUploading) return;
    if (!sessionId) return;
    hapticService.tap();

    // Build content blocks
    const content = buildContentBlocks(
      trimmed,
      images.map((img) => ({ base64: img.base64, mediaType: img.mediaType })),
      files.map((f) => f.path),
    );

    wsService.send({
      type: "send",
      sessionId,
      content,
    });

    setValue("");
    setImages([]);
    setFiles([]);
    clearDraft(sessionId);
    if (textareaRef.current) {
      textareaRef.current.style.height = "auto";
    }
  };

  const handleSelect = (label: string) => {
    setValue(`${label} `);
    textareaRef.current?.focus();
  };

  const handleAttach = async (fileList: FileList, type: "camera" | "image" | "file") => {
    if (type === "file") {
      if (!sessionId) return;
      setIsUploading(true);
      try {
        for (let i = 0; i < fileList.length; i++) {
          const file = fileList[i];
          const result = await uploadFile(sessionId, file);
          setFiles((prev) => [
            ...prev,
            {
              id: crypto.randomUUID(),
              path: result.path,
              filename: result.filename,
              sizeKB: result.sizeKB,
            },
          ]);
        }
      } catch (error) {
        console.error("File upload failed:", error);
        toastService.error("File upload failed");
      } finally {
        setIsUploading(false);
      }
    } else {
      for (let i = 0; i < fileList.length; i++) {
        const file = fileList[i];
        try {
          const result = await resizeImage(file);
          const preview = `data:${result.mediaType};base64,${result.base64}`;
          setImages((prev) => [
            ...prev,
            {
              id: crypto.randomUUID(),
              base64: result.base64,
              mediaType: result.mediaType,
              preview,
              sizeKB: result.sizeKB,
            },
          ]);
        } catch (error) {
          console.error("Image processing failed:", error);
          const msg = error instanceof Error ? error.message : "Image processing failed";
          toastService.error(msg);
        }
      }
    }
  };

  const handleRemoveImage = (id: string) => {
    setImages((prev) => prev.filter((img) => img.id !== id));
  };

  const handleRemoveFile = (id: string) => {
    setFiles((prev) => prev.filter((f) => f.id !== id));
  };

  const handleKeyDown = (e: KeyboardEvent<HTMLTextAreaElement>) => {
    if (suggestions.length > 0) {
      if (e.key === "ArrowDown") {
        e.preventDefault();
        setSelectedIndex((prev) => (prev + 1) % suggestions.length);
        return;
      }
      if (e.key === "ArrowUp") {
        e.preventDefault();
        setSelectedIndex((prev) => (prev - 1 + suggestions.length) % suggestions.length);
        return;
      }
      if (e.key === "Tab") {
        e.preventDefault();
        handleSelect(suggestions[selectedIndex].label);
        return;
      }
    }

    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      handleSend();
    }
  };

  const hasContent = value.trim() || images.length > 0 || files.length > 0;

  return (
    <div className="ember-composer">
      <QuickActions capabilities={capabilities} disabled={disabled || !sessionId} />
      <AttachmentPreview
        images={images}
        files={files}
        onRemoveImage={handleRemoveImage}
        onRemoveFile={handleRemoveFile}
      />
      <FloatingAutocomplete
        suggestions={suggestions}
        selectedIndex={selectedIndex}
        onSelect={handleSelect}
        visible={suggestions.length > 0}
      />
      <div className="ember-composer-row">
        <IconButton
          icon={<Bot size={20} />}
          onClick={onOpenAgents}
          label="Open agents"
          variant="accent"
          disabled={disabled || !capabilities || !sessionId}
        />
        <IconButton
          icon={<Terminal size={20} />}
          onClick={onOpenCommands}
          label="Open commands"
          variant="default"
          disabled={disabled || !capabilities || !sessionId}
        />
        <AttachmentButton
          onAttach={handleAttach}
          disabled={disabled || isUploading || !sessionId}
        />
        <textarea
          ref={textareaRef}
          className="ember-composer-textarea"
          value={value}
          onChange={(e) => {
            setValue(e.target.value);
            resizeTextarea();
          }}
          onKeyDown={handleKeyDown}
          placeholder={sessionId ? "Message..." : "Select a session"}
          disabled={disabled || !sessionId}
          rows={1}
        />
        <IconButton
          icon={<ArrowUp size={20} />}
          onClick={handleSend}
          label="Send message"
          variant="accent"
          disabled={disabled || !hasContent || isUploading || !sessionId}
        />
      </div>
    </div>
  );
}
