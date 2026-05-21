import { useEffect, useState } from "react";
import { Drawer } from "vaul";
import { Icon } from "../design/icons";
import { tokens as T } from "../design/tokens";
import { toastService } from "../services/toast-service";
import { wsService } from "../services/ws-service";
import { useAppStore } from "../stores/app-store";
import DrawerBase from "./drawers/DrawerBase";
import "./linear/folder-picker.css";

interface FolderPickerProps {
  open: boolean;
  onSelect: (path: string) => void;
  onClose: () => void;
  nested?: boolean;
}

export default function FolderPicker({
  open,
  onSelect,
  onClose,
  nested = false,
}: FolderPickerProps) {
  const directoryListing = useAppStore((s) => s.directoryListing);
  const isLoading = useAppStore((s) => s.isLoadingDirectories);
  const serverPaths = useAppStore((s) => s.serverPaths);
  const [currentPath, setCurrentPath] = useState<string | null>(null);

  useEffect(() => {
    if (open && !currentPath) {
      const initialPath =
        serverPaths?.allowedRoots && serverPaths.allowedRoots.length > 0
          ? serverPaths.allowedRoots[0]
          : (serverPaths?.homeDirectory ?? "~");
      wsService.listDirectories(initialPath);
    }
  }, [open, currentPath, serverPaths]);

  useEffect(() => {
    if (directoryListing) {
      setCurrentPath(directoryListing.path);
    }
  }, [directoryListing]);

  const handleNavigate = (path: string) => {
    wsService.listDirectories(path);
  };

  const resetPath = () => {
    setCurrentPath(null);
  };

  const handleSelectCurrent = () => {
    if (currentPath) {
      onSelect(currentPath);
      resetPath();
      onClose();
    }
  };

  const handleClose = () => {
    resetPath();
    onClose();
  };

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

  useEffect(() => {
    const globalError = useAppStore.getState().globalError;
    if (globalError && open) {
      toastService.error(globalError);
      useAppStore.getState().setGlobalError(null);
    }
  }, [useAppStore.getState().globalError, open]);

  const pickerContent = (
    <div className="lin-folder">
      <div className="lin-folder-breadcrumbs">
        {breadcrumbs.map((crumb, idx) => (
          <div key={crumb.path} className="lin-folder-breadcrumb">
            {idx > 0 && <Icon name="chevronR" size={12} color={T.fg3} style={{ opacity: 0.8 }} />}
            <button
              type="button"
              className="lin-folder-breadcrumb-btn"
              onClick={() => handleNavigate(crumb.path)}
            >
              {crumb.name}
            </button>
          </div>
        ))}
      </div>

      <div className="lin-folder-actions">
        {(() => {
          const parent = directoryListing?.parent;
          if (!parent) return null;
          return (
            <button
              type="button"
              className="lin-folder-action"
              onClick={() => handleNavigate(parent)}
              disabled={isLoading}
            >
              Go Up
            </button>
          );
        })()}
        <button
          type="button"
          className="lin-folder-action is-primary"
          onClick={handleSelectCurrent}
          disabled={!currentPath || isLoading}
        >
          Select This Folder
        </button>
      </div>

      {isLoading ? (
        <div className="lin-folder-loading">Loading…</div>
      ) : directoryListing && directoryListing.entries.length > 0 ? (
        <div className="lin-folder-list">
          {directoryListing.entries.map((entry) => (
            <button
              key={entry.path}
              type="button"
              className="lin-settings-row lin-folder-item"
              onClick={() => handleNavigate(entry.path)}
            >
              <Icon name="folder" size={16} color={T.fg2} />
              <div className="lin-settings-row-main">
                <div className="lin-settings-row-title">{entry.name}</div>
              </div>
              <Icon name="chevronR" size={14} color={T.fg3} />
            </button>
          ))}
        </div>
      ) : directoryListing ? (
        <div className="lin-folder-empty">No subdirectories</div>
      ) : null}
    </div>
  );

  const container =
    typeof document !== "undefined"
      ? (document.querySelector<HTMLElement>(".app") ?? undefined)
      : undefined;

  if (nested) {
    return (
      <Drawer.NestedRoot open={open} onOpenChange={(next) => !next && handleClose()}>
        <Drawer.Portal container={container}>
          <Drawer.Overlay className="drawer-overlay" />
          <Drawer.Content className="drawer-content">
            <Drawer.Handle className="drawer-handle" />
            <Drawer.Title className="drawer-title">Choose Folder</Drawer.Title>
            <div className="drawer-body">{pickerContent}</div>
          </Drawer.Content>
        </Drawer.Portal>
      </Drawer.NestedRoot>
    );
  }

  return (
    <DrawerBase open={open} onOpenChange={(next) => !next && handleClose()} title="Choose Folder">
      {pickerContent}
    </DrawerBase>
  );
}
