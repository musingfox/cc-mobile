import { Camera, FileUp, Image, Paperclip } from "lucide-react";
import { useRef, useState } from "react";
import DrawerBase from "./drawers/DrawerBase";

type AttachmentType = "camera" | "image" | "file";

interface AttachmentButtonProps {
  onAttach: (files: FileList, type: AttachmentType) => void;
  disabled?: boolean;
}

export default function AttachmentButton({ onAttach, disabled }: AttachmentButtonProps) {
  const [drawerOpen, setDrawerOpen] = useState(false);
  const cameraInputRef = useRef<HTMLInputElement>(null);
  const imageInputRef = useRef<HTMLInputElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>, type: AttachmentType) => {
    if (e.target.files && e.target.files.length > 0) {
      onAttach(e.target.files, type);
      setDrawerOpen(false);
      // Reset input value to allow selecting the same file again
      e.target.value = "";
    }
  };

  return (
    <>
      <button
        type="button"
        className="input-bar-action-btn"
        onClick={() => setDrawerOpen(true)}
        disabled={disabled}
        aria-label="Attach file or image"
      >
        <Paperclip size={20} />
      </button>

      <DrawerBase open={drawerOpen} onOpenChange={setDrawerOpen} title="Add Attachment">
        <div className="attachment-drawer-options">
          <button
            type="button"
            className="attachment-drawer-option"
            onClick={() => cameraInputRef.current?.click()}
          >
            <Camera size={24} />
            <span>Camera</span>
          </button>
          <button
            type="button"
            className="attachment-drawer-option"
            onClick={() => imageInputRef.current?.click()}
          >
            <Image size={24} />
            <span>Photo Library</span>
          </button>
          <button
            type="button"
            className="attachment-drawer-option"
            onClick={() => fileInputRef.current?.click()}
          >
            <FileUp size={24} />
            <span>File</span>
          </button>
        </div>
      </DrawerBase>

      {/* Hidden file inputs */}
      <input
        ref={cameraInputRef}
        type="file"
        accept="image/*"
        capture="environment"
        style={{ display: "none" }}
        onChange={(e) => handleFileChange(e, "camera")}
      />
      <input
        ref={imageInputRef}
        type="file"
        accept="image/*"
        multiple
        style={{ display: "none" }}
        onChange={(e) => handleFileChange(e, "image")}
      />
      <input
        ref={fileInputRef}
        type="file"
        style={{ display: "none" }}
        onChange={(e) => handleFileChange(e, "file")}
      />
    </>
  );
}
