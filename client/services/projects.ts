const PROJECTS_KEY = "cc-mobile-projects";
const MAX_RECENT_FOLDERS = 10;

export type SavedProject = {
  cwd: string;
  label: string;
};

export function loadProjects(): SavedProject[] {
  try {
    const stored = localStorage.getItem(PROJECTS_KEY);
    return stored ? JSON.parse(stored) : [];
  } catch {
    // Invalid JSON → clear and reinitialize
    localStorage.removeItem(PROJECTS_KEY);
    return [];
  }
}

export function saveProject(cwd: string) {
  try {
    let projects = loadProjects();
    // Remove existing entry if present
    projects = projects.filter((p) => p.cwd !== cwd);
    // Add to front (most recent)
    const label = cwd.split("/").pop() || cwd;
    projects.unshift({ cwd, label });
    // Keep only MAX_RECENT_FOLDERS
    projects = projects.slice(0, MAX_RECENT_FOLDERS);
    localStorage.setItem(PROJECTS_KEY, JSON.stringify(projects));
  } catch {
    // localStorage quota exceeded → silent fail
  }
}

export function removeProject(cwd: string) {
  try {
    const projects = loadProjects().filter((p) => p.cwd !== cwd);
    localStorage.setItem(PROJECTS_KEY, JSON.stringify(projects));
  } catch {
    // localStorage inaccessible → silent fail
  }
}
