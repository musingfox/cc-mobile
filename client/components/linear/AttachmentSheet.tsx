import { useRef, useState } from "react";
import { Icon } from "../../design/icons";
import { tokens as T } from "../../design/tokens";
import DrawerBase from "../drawers/DrawerBase";
import "./attachment-sheet.css";

type AttachmentType = "camera" | "image" | "file";

interface AttachmentSheetProps {
  onAttach: (files: FileList, type: AttachmentType) => void;
  disabled?: boolean;
}

export default function AttachmentSheet({ onAttach, disabled }: AttachmentSheetProps) {
  const [open, setOpen] = useState(false);
  const cameraInputRef = useRef<HTMLInputElement>(null);
  const imageInputRef = useRef<HTMLInputElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>, type: AttachmentType) => {
    if (e.target.files && e.target.files.length > 0) {
      onAttach(e.target.files, type);
      setOpen(false);
      e.target.value = "";
    }
  };

  return (
    <>
      <button
        type="button"
        className="lin-icon-btn lin-attach-trigger"
        onClick={() => setOpen(true)}
        disabled={disabled}
        aria-label="Add attachment"
      >
        <Icon name="paperclip" size={15} color={T.fg3} />
      </button>

      <DrawerBase open={open} onOpenChange={setOpen} title="Add Attachment">
        <div className="lin-attachment-sheet">
          <button
            type="button"
            className="lin-settings-row"
            onClick={() => cameraInputRef.current?.click()}
          >
            <Icon name="camera" size={16} color={T.fg2} />
            <div className="lin-settings-row-main">
              <div className="lin-settings-row-title">Camera</div>
            </div>
          </button>
          <button
            type="button"
            className="lin-settings-row"
            onClick={() => imageInputRef.current?.click()}
          >
            <Icon name="image" size={16} color={T.fg2} />
            <div className="lin-settings-row-main">
              <div className="lin-settings-row-title">Photo Library</div>
            </div>
          </button>
          <button
            type="button"
            className="lin-settings-row"
            onClick={() => fileInputRef.current?.click()}
          >
            <Icon name="file" size={16} color={T.fg2} />
            <div className="lin-settings-row-main">
              <div className="lin-settings-row-title">File</div>
            </div>
          </button>
        </div>
      </DrawerBase>

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
