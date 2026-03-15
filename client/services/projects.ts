const PROJECTS_KEY = "claude-code-mobile-projects";

export type SavedProject = {
  cwd: string;
  label: string;
};

export function loadProjects(): SavedProject[] {
  try {
    const stored = localStorage.getItem(PROJECTS_KEY);
    return stored ? JSON.parse(stored) : [];
  } catch {
    return [];
  }
}

export function saveProject(cwd: string) {
  const projects = loadProjects();
  if (projects.some((p) => p.cwd === cwd)) return;
  const label = cwd.split("/").pop() || cwd;
  projects.push({ cwd, label });
  localStorage.setItem(PROJECTS_KEY, JSON.stringify(projects));
}

export function removeProject(cwd: string) {
  const projects = loadProjects().filter((p) => p.cwd !== cwd);
  localStorage.setItem(PROJECTS_KEY, JSON.stringify(projects));
}
