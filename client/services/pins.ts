const PINS_KEY = "cc-mobile-pinned-commands";

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

export function togglePin(input: { item: string; currentPins: string[] }): string[] {
  const { item, currentPins } = input;
  const index = currentPins.indexOf(item);

  if (index === -1) {
    return [...currentPins, item];
  } else {
    return currentPins.filter((_, i) => i !== index);
  }
}
