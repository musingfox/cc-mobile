import { File as FileIcon, X } from "lucide-react";

export interface ImageAttachment {
  id: string;
  base64: string;
  mediaType: string;
  preview: string;
  sizeKB: number;
}

export interface FileAttachment {
  id: string;
  path: string;
  filename: string;
  sizeKB: number;
}

interface AttachmentPreviewProps {
  images: ImageAttachment[];
  files: FileAttachment[];
  onRemoveImage: (id: string) => void;
  onRemoveFile: (id: string) => void;
}

export default function AttachmentPreview({
  images,
  files,
  onRemoveImage,
  onRemoveFile,
}: AttachmentPreviewProps) {
  if (images.length === 0 && files.length === 0) {
    return null;
  }

  return (
    <div className="attachment-preview">
      {images.map((img) => (
        <div key={img.id} className="attachment-thumb">
          <img src={img.preview} alt="Attachment" />
          <button
            type="button"
            className="attachment-thumb-remove"
            onClick={() => onRemoveImage(img.id)}
            aria-label="Remove image"
          >
            <X size={14} />
          </button>
        </div>
      ))}
      {files.map((file) => (
        <div key={file.id} className="attachment-file-chip">
          <FileIcon size={16} />
          <span className="attachment-file-name">{file.filename}</span>
          <button
            type="button"
            className="attachment-file-remove"
            onClick={() => onRemoveFile(file.id)}
            aria-label="Remove file"
          >
            <X size={14} />
          </button>
        </div>
      ))}
    </div>
  );
}
