import { Folder, FolderOpen, X } from "lucide-react";
import { useEffect, useState } from "react";
import type { SavedProject } from "../../services/projects";
import { loadProjects, removeProject } from "../../services/projects";
import DrawerBase from "./DrawerBase";

interface RecentDrawerProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onSelectProject: (cwd: string) => void;
  onBrowseNew: () => void;
}

export default function RecentDrawer({
  open,
  onOpenChange,
  onSelectProject,
  onBrowseNew,
}: RecentDrawerProps) {
  const [projects, setProjects] = useState<SavedProject[]>([]);

  // Load projects when drawer opens
  useEffect(() => {
    if (open) {
      setProjects(loadProjects());
    }
  }, [open]);

  const handleRemove = (e: React.MouseEvent, cwd: string) => {
    e.stopPropagation();
    removeProject(cwd);
    setProjects(loadProjects());
  };

  return (
    <DrawerBase open={open} onOpenChange={onOpenChange} title="Recent Projects">
      <div className="recent-drawer-content">
        {projects.length === 0 ? (
          <div className="recent-drawer-empty">
            <p>No recent projects</p>
          </div>
        ) : (
          <div className="recent-project-list">
            {projects.map((project) => (
              <button
                key={project.cwd}
                type="button"
                className="recent-project-item"
                onClick={() => onSelectProject(project.cwd)}
              >
                <Folder className="recent-project-icon" size={24} />
                <div className="recent-project-info">
                  <div className="recent-project-label">{project.label}</div>
                  <div className="recent-project-path">{project.cwd}</div>
                </div>
                <button
                  type="button"
                  className="recent-project-remove"
                  onClick={(e) => handleRemove(e, project.cwd)}
                >
                  <X size={20} />
                </button>
              </button>
            ))}
          </div>
        )}

        <button type="button" className="recent-drawer-browse" onClick={onBrowseNew}>
          <FolderOpen size={20} />
          <span>Browse new folder</span>
        </button>
      </div>
    </DrawerBase>
  );
}
