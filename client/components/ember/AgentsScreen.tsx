import { Plus } from "lucide-react";
import { useState } from "react";
import type { AgentInfo } from "../../stores/app-store";
import { useAppStore } from "../../stores/app-store";
import Avatar from "./Avatar";
import IconButton from "./IconButton";
import ScreenHeader from "./ScreenHeader";

interface AgentsScreenProps {
  variant: "screen" | "sheet";
  onSelect?: (agentName: string) => void;
  onClose?: () => void;
}

function filterAgents(agents: AgentInfo[], query: string): AgentInfo[] {
  if (!query) return agents;
  const lowerQuery = query.toLowerCase();
  return agents.filter((agent) => agent.name.toLowerCase().includes(lowerQuery));
}

function AgentCard({
  agent,
  index,
  onClick,
}: {
  agent: AgentInfo;
  index: number;
  onClick: () => void;
}) {
  const avatarVariant = index % 2 === 0 ? "gradient" : "neutral";

  return (
    <button type="button" className="ember-agent-card" onClick={onClick}>
      <Avatar label={agent.name} size={40} shape="square" variant={avatarVariant} />
      <div className="ember-agent-card-content">
        <div className="ember-agent-card-name-row">
          <span className="ember-agent-card-name">{agent.name}</span>
        </div>
        <div className="ember-agent-card-description">
          {agent.description || "No description available"}
        </div>
        {agent.allowedTools && agent.allowedTools.length > 0 && (
          <div className="ember-agent-card-badges">
            {agent.allowedTools.map((tool) => (
              <span key={tool} className="ember-agent-tool-badge">
                {tool}
              </span>
            ))}
          </div>
        )}
      </div>
    </button>
  );
}

function LoadingSkeleton() {
  return (
    <div className="ember-agents-list">
      {[1, 2, 3].map((i) => (
        <div key={i} className="ember-skeleton ember-agent-card-skeleton" />
      ))}
    </div>
  );
}

function EmptyState() {
  return (
    <div className="ember-agents-empty">
      <p>No agents available.</p>
    </div>
  );
}

export default function AgentsScreen({ variant, onSelect }: AgentsScreenProps) {
  const capabilities = useAppStore((s) => s.capabilities);
  const [searchQuery, setSearchQuery] = useState("");

  const handleCreateClick = () => {
    // Placeholder for MVP - will be implemented later
    alert("Custom agents coming soon");
  };

  const agents = capabilities?.agents ?? [];
  const filteredAgents = filterAgents(agents, searchQuery);

  const content = (
    <>
      <div className="ember-search-input-container">
        <input
          type="text"
          className="ember-search-input"
          placeholder="Filter agents…"
          value={searchQuery}
          onChange={(e) => setSearchQuery(e.target.value)}
        />
      </div>
      {capabilities === null ? (
        <LoadingSkeleton />
      ) : agents.length === 0 ? (
        <EmptyState />
      ) : (
        <div className="ember-agents-list">
          {filteredAgents.map((agent, index) => (
            <AgentCard
              key={agent.name}
              agent={agent}
              index={index}
              onClick={() => onSelect?.(agent.name)}
            />
          ))}
        </div>
      )}
    </>
  );

  if (variant === "screen") {
    return (
      <div className="ember-agents-screen">
        <ScreenHeader
          title="Agents"
          subtitle="Tap to insert @name into the current session"
          rightSlot={
            <IconButton
              icon={<Plus size={16} />}
              onClick={handleCreateClick}
              label="Create agent"
              variant="default"
              disabled={true}
            />
          }
        />
        <div className="ember-agents-screen-body">{content}</div>
      </div>
    );
  }

  // variant === "sheet"
  return <div className="ember-agents-sheet-body">{content}</div>;
}
