export type FilteredItem = {
  label: string;
  value: string;
  type: "command" | "agent";
  pinned: boolean;
};

export type FilterInput = {
  query: string;
  commands: string[];
  agents: string[];
  pinnedItems: string[];
};

export function filterAndSortItems(input: FilterInput): FilteredItem[] {
  const { query, commands, agents, pinnedItems } = input;
  const lowerQuery = query.toLowerCase();

  const commandItems: FilteredItem[] = commands.map((cmd) => ({
    label: `/${cmd}`,
    value: `/${cmd}`,
    type: "command" as const,
    pinned: pinnedItems.includes(`/${cmd}`),
  }));

  const agentItems: FilteredItem[] = agents.map((agent) => ({
    label: `@${agent}`,
    value: `@${agent}`,
    type: "agent" as const,
    pinned: pinnedItems.includes(`@${agent}`),
  }));

  const allItems = [...commandItems, ...agentItems];

  const filtered = lowerQuery
    ? allItems.filter((item) => item.label.toLowerCase().includes(lowerQuery))
    : allItems;

  filtered.sort((a, b) => {
    if (a.pinned && !b.pinned) return -1;
    if (!a.pinned && b.pinned) return 1;
    return a.label.localeCompare(b.label);
  });

  return filtered;
}
