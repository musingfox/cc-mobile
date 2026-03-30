import { ChevronRight, Folder } from "lucide-react";
import { useEffect, useState } from "react";
import { toastService } from "../services/toast-service";
import { wsService } from "../services/ws-service";
import { useAppStore } from "../stores/app-store";
import DrawerBase from "./drawers/DrawerBase";

interface FolderPickerProps {
  open: boolean;
  onSelect: (path: string) => void;
  onClose: () => void;
}

export default function FolderPicker({ open, onSelect, onClose }: FolderPickerProps) {
  const directoryListing = useAppStore((s) => s.directoryListing);
  const isLoading = useAppStore((s) => s.isLoadingDirectories);
  const serverPaths = useAppStore((s) => s.serverPaths);
  const [currentPath, setCurrentPath] = useState<string | null>(null);

  // Get initial path from server config on first open
  useEffect(() => {
    if (open && !currentPath) {
      const initialPath =
        serverPaths?.allowedRoots && serverPaths.allowedRoots.length > 0
          ? serverPaths.allowedRoots[0]
          : (serverPaths?.homeDirectory ?? "~");
      wsService.listDirectories(initialPath);
    }
  }, [open, currentPath, serverPaths]);

  // Update current path when listing changes
  useEffect(() => {
    if (directoryListing) {
      setCurrentPath(directoryListing.path);
    }
  }, [directoryListing]);

  const handleNavigate = (path: string) => {
    wsService.listDirectories(path);
  };

  const handleSelectCurrent = () => {
    if (currentPath) {
      onSelect(currentPath);
      onClose();
    }
  };

  const handleClose = () => {
    onClose();
  };

  // Parse path into breadcrumb segments
  const getBreadcrumbs = () => {
    if (!currentPath) return [];
    const parts = currentPath.split("/").filter(Boolean);
    const crumbs = [{ name: "/", path: "/" }];
    let accumulatedPath = "";
    for (const part of parts) {
      accumulatedPath += `/${part}`;
      crumbs.push({ name: part, path: accumulatedPath });
    }
    return crumbs;
  };

  const breadcrumbs = getBreadcrumbs();

  // Handle errors from server
  useEffect(() => {
    const globalError = useAppStore.getState().globalError;
    if (globalError && open) {
      toastService.error(globalError);
      useAppStore.getState().setGlobalError(null);
    }
  }, [useAppStore.getState().globalError, open]);

  return (
    <DrawerBase open={open} onOpenChange={handleClose} title="Choose Folder">
      <div className="folder-picker">
        {/* Breadcrumb navigation */}
        <div className="folder-picker-breadcrumbs">
          {breadcrumbs.map((crumb, idx) => (
            <div key={crumb.path} className="folder-picker-breadcrumb">
              {idx > 0 && <ChevronRight size={16} className="breadcrumb-separator" />}
              <button
                type="button"
                className="breadcrumb-segment"
                onClick={() => handleNavigate(crumb.path)}
              >
                {crumb.name}
              </button>
            </div>
          ))}
        </div>

        {/* Action buttons */}
        <div className="folder-picker-actions">
          {directoryListing?.parent && (
            <button
              type="button"
              className="folder-picker-action-btn"
              onClick={() => handleNavigate(directoryListing.parent!)}
              disabled={isLoading}
            >
              Go Up
            </button>
          )}
          <button
            type="button"
            className="folder-picker-action-btn primary"
            onClick={handleSelectCurrent}
            disabled={!currentPath || isLoading}
          >
            Select This Folder
          </button>
        </div>

        {/* Directory listing */}
        {isLoading ? (
          <div className="folder-picker-loading">Loading...</div>
        ) : directoryListing && directoryListing.entries.length > 0 ? (
          <div className="folder-picker-list">
            {directoryListing.entries.map((entry) => (
              <button
                key={entry.path}
                type="button"
                className="folder-picker-item"
                onClick={() => handleNavigate(entry.path)}
              >
                <Folder size={20} className="folder-icon" />
                <span className="folder-name">{entry.name}</span>
                <ChevronRight size={16} className="folder-chevron" />
              </button>
            ))}
          </div>
        ) : directoryListing ? (
          <div className="folder-picker-empty">No subdirectories</div>
        ) : null}
      </div>
    </DrawerBase>
  );
}
