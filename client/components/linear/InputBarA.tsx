import { useEffect, useRef, useState } from "react";
import { Icon } from "../../design/icons";
import { tokens as T } from "../../design/tokens";
import { hapticService } from "../../services/haptic";
import { toastService } from "../../services/toast-service";
import { uploadFile } from "../../services/upload-service";
import { wsService } from "../../services/ws-service";
import { useAppStore } from "../../stores/app-store";
import { buildContentBlocks } from "../../utils/content-block-builder";
import { resizeImage } from "../../utils/image-resize";
import AttachmentButton from "../AttachmentButton";
import "./input-bar.css";

interface Props {
  sessionId: string | null;
  disabled?: boolean;
  isStreaming?: boolean;
  onSlashClick?: () => void;
  onAtClick?: () => void;
}

interface ImageAttachment {
  id: string;
  base64: string;
  mediaType: string;
  preview: string;
  sizeKB: number;
}

interface FileAttachment {
  id: string;
  path: string;
  filename: string;
  sizeKB: number;
  /** 0..1 progress while uploading; absent when complete */
  progress?: number;
}

export default function InputBarA({
  sessionId,
  disabled,
  isStreaming,
  onSlashClick,
  onAtClick,
}: Props) {
  const inputDraft = useAppStore((s) => s.inputDraft);
  const setInputDraft = useAppStore((s) => s.setInputDraft);

  const [images, setImages] = useState<ImageAttachment[]>([]);
  const [files, setFiles] = useState<FileAttachment[]>([]);
  const [isUploading, setIsUploading] = useState(false);
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  // Auto-grow textarea
  useEffect(() => {
    const ta = textareaRef.current;
    if (!ta) return;
    ta.style.height = "auto";
    ta.style.height = `${Math.min(ta.scrollHeight, 160)}px`;
  }, [inputDraft]);

  const handleSend = () => {
    const trimmed = inputDraft.trim();
    if ((!trimmed && images.length === 0 && files.length === 0) || disabled || isUploading) return;
    if (!sessionId) return;
    hapticService.tap();

    const content = buildContentBlocks(
      trimmed,
      images.map((img) => ({ base64: img.base64, mediaType: img.mediaType })),
      files.map((f) => f.path),
    );
    wsService.send(sessionId, content);

    setInputDraft("");
    setImages([]);
    setFiles([]);
    if (textareaRef.current) textareaRef.current.style.height = "auto";
  };

  const handleInterrupt = () => {
    if (!sessionId) return;
    hapticService.tap();
    wsService.interrupt(sessionId);
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
      } catch {
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
          const msg = error instanceof Error ? error.message : "Image processing failed";
          toastService.error(msg);
        }
      }
    }
  };

  const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      handleSend();
    }
  };

  const insertAtCursor = (text: string) => {
    const ta = textareaRef.current;
    if (!ta) {
      setInputDraft(inputDraft + text);
      return;
    }
    const start = ta.selectionStart ?? inputDraft.length;
    const end = ta.selectionEnd ?? inputDraft.length;
    const next = inputDraft.slice(0, start) + text + inputDraft.slice(end);
    setInputDraft(next);
    requestAnimationFrame(() => {
      ta.focus();
      ta.setSelectionRange(start + text.length, start + text.length);
    });
  };

  const hasAttachments = images.length > 0 || files.length > 0;
  const canSend = !disabled && !isUploading && (inputDraft.trim() || hasAttachments);

  return (
    <div className="lin-input-bar">
      {hasAttachments && (
        <div className="lin-input-chips">
          {images.map((img) => (
            <div key={img.id} className="lin-chip">
              <div
                className="lin-chip-thumb lin-chip-thumb--image"
                style={{ backgroundImage: `url(${img.preview})` }}
              />
              <div className="lin-chip-body">
                <div className="lin-chip-name">{`image ${Math.round(img.sizeKB)}KB`}</div>
                <div className="lin-chip-meta">{`${Math.round(img.sizeKB)} KB`}</div>
              </div>
              <button
                type="button"
                className="lin-chip-close"
                onClick={() => setImages((prev) => prev.filter((i) => i.id !== img.id))}
                aria-label="Remove image"
              >
                <Icon name="close" size={11} color={T.fg2} />
              </button>
            </div>
          ))}
          {files.map((f) => (
            <div key={f.id} className="lin-chip">
              <div className="lin-chip-thumb">
                <Icon name="file" size={12} color={T.fg2} />
              </div>
              <div className="lin-chip-body">
                <div className="lin-chip-name">{f.filename}</div>
                <div className="lin-chip-meta">
                  {f.progress !== undefined
                    ? `${Math.round(f.progress * 100)}% · ${Math.round(f.sizeKB)} KB`
                    : `${Math.round(f.sizeKB)} KB`}
                </div>
              </div>
              <button
                type="button"
                className="lin-chip-close"
                onClick={() => setFiles((prev) => prev.filter((x) => x.id !== f.id))}
                aria-label="Remove file"
              >
                <Icon name="close" size={11} color={T.fg2} />
              </button>
              {f.progress !== undefined && (
                <div
                  className="lin-chip-progress"
                  style={{ width: `${(f.progress ?? 0) * 100}%` }}
                />
              )}
            </div>
          ))}
        </div>
      )}

      <div className="lin-composer">
        <textarea
          ref={textareaRef}
          className="lin-composer-input"
          value={inputDraft}
          onChange={(e) => setInputDraft(e.target.value)}
          onKeyDown={handleKeyDown}
          placeholder="Message cc-mobile…"
          rows={1}
          disabled={disabled}
        />
        <div className="lin-composer-actions">
          <div className="lin-composer-attach">
            <AttachmentButton onAttach={handleAttach} disabled={disabled} />
          </div>
          <button
            type="button"
            className="lin-icon-btn"
            onClick={() => (onSlashClick ? onSlashClick() : insertAtCursor("/"))}
            aria-label="Insert slash command"
          >
            <Icon name="slash" size={15} color={T.fg3} />
          </button>
          <button
            type="button"
            className="lin-icon-btn"
            onClick={() => (onAtClick ? onAtClick() : insertAtCursor("@"))}
            aria-label="Insert agent mention"
          >
            <Icon name="at" size={15} color={T.fg3} />
          </button>
          {isStreaming ? (
            <button
              type="button"
              className="lin-send-btn is-stop"
              onClick={handleInterrupt}
              aria-label="Stop"
            >
              <Icon name="stop" size={12} color={T.bg} />
            </button>
          ) : (
            <button
              type="button"
              className="lin-send-btn"
              onClick={handleSend}
              disabled={!canSend}
              aria-label="Send"
            >
              <Icon name="send" size={14} color={T.bg} />
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
