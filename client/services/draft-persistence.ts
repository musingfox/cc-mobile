function getDraftKey(sessionId: string): string {
  return `ccm:draft:${sessionId}`;
}

export function saveDraft(sessionId: string, draft: string): void {
  try {
    localStorage.setItem(getDraftKey(sessionId), draft);
  } catch (error) {
    console.error("Failed to save draft:", error);
  }
}

export function loadDraft(sessionId: string): string {
  try {
    return localStorage.getItem(getDraftKey(sessionId)) ?? "";
  } catch (error) {
    console.error("Failed to load draft:", error);
    return "";
  }
}

export function clearDraft(sessionId: string): void {
  try {
    localStorage.removeItem(getDraftKey(sessionId));
  } catch (error) {
    console.error("Failed to clear draft:", error);
  }
}
