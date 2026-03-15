const PINS_KEY = "claude-code-mobile-pinned-commands";

export function loadPins(): string[] {
  try {
    const stored = localStorage.getItem(PINS_KEY);
    return stored ? JSON.parse(stored) : [];
  } catch {
    return [];
  }
}

export function savePins(pins: string[]) {
  localStorage.setItem(PINS_KEY, JSON.stringify(pins));
}
