import { useState } from "react";
import { hapticService } from "../services/haptic";

type PermissionFooterProps = {
  toolName: string;
  parameters: Record<string, unknown>;
  onRespond: (action: "approve" | "approve_session" | "deny") => void;
  onAnswer?: (answer: string) => void;
};

function formatParams(toolName: string, parameters: Record<string, unknown>): string {
  if (toolName === "Bash" && parameters.command) {
    return String(parameters.command);
  }
  if (toolName === "Read" && parameters.file_path) {
    return String(parameters.file_path);
  }
  if (toolName === "Edit" && parameters.file_path) {
    return String(parameters.file_path);
  }
  if (toolName === "Write" && parameters.file_path) {
    return String(parameters.file_path);
  }
  if (toolName === "Glob" && parameters.pattern) {
    return String(parameters.pattern);
  }
  if (toolName === "Grep" && parameters.pattern) {
    return String(parameters.pattern);
  }
  const keys = Object.keys(parameters);
  if (keys.length === 0) return "";
  const first = parameters[keys[0]];
  return typeof first === "string" ? first : JSON.stringify(first);
}

export default function PermissionFooter({
  toolName,
  parameters,
  onRespond,
  onAnswer,
}: PermissionFooterProps) {
  const [selectedAction, setSelectedAction] = useState<string | null>(null);
  const [customAnswer, setCustomAnswer] = useState("");
  const paramSummary = formatParams(toolName, parameters);

  const handleClick = (action: "approve" | "approve_session" | "deny") => {
    if (action === "deny") {
      hapticService.warn();
    } else {
      hapticService.confirm();
    }
    setSelectedAction(action);
    onRespond(action);
  };

  const handleAnswer = (answer: string) => {
    hapticService.confirm();
    setSelectedAction("answer");
    if (onAnswer) {
      onAnswer(answer);
    }
  };

  // AskUserQuestion UI
  if (toolName === "AskUserQuestion" && onAnswer) {
    const questions = parameters.questions as
      | Array<{
          question: string;
          header?: string;
          options?: Array<{ label: string; description?: string }>;
        }>
      | undefined;
    const question = questions?.[0];

    if (question) {
      return (
        <div className="permission-footer">
          <div className="permission-tool-info">
            <span className="permission-tool-name">{question.header || "Question"}</span>
            <div className="ask-user-question">{question.question}</div>
          </div>
          <div className="permission-actions ask-user-actions">
            {question.options?.map((option) => (
              <button
                key={option.label}
                type="button"
                className={`permission-btn blue ${selectedAction === option.label ? "selected" : ""} ${selectedAction && selectedAction !== option.label ? "unselected" : ""}`}
                onClick={() => handleAnswer(option.label)}
              >
                <div className="option-label">{option.label}</div>
                {option.description && (
                  <div className="option-description">{option.description}</div>
                )}
              </button>
            ))}
            <div className="custom-answer-row">
              <input
                type="text"
                className="custom-answer-input"
                placeholder="Other (type your answer)"
                value={customAnswer}
                onChange={(e) => setCustomAnswer(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter" && customAnswer.trim()) {
                    handleAnswer(customAnswer.trim());
                  }
                }}
              />
              <button
                type="button"
                className="permission-btn green"
                onClick={() => {
                  if (customAnswer.trim()) {
                    handleAnswer(customAnswer.trim());
                  }
                }}
                disabled={!customAnswer.trim()}
              >
                Submit
              </button>
            </div>
          </div>
        </div>
      );
    }
  }

  // Default permission UI
  return (
    <div className="permission-footer">
      <div className="permission-tool-info">
        <span className="permission-tool-name">{toolName}</span>
        {paramSummary && <code className="permission-tool-params">{paramSummary}</code>}
      </div>
      <div className="permission-actions">
        <button
          type="button"
          className={`permission-btn green ${selectedAction === "approve" ? "selected" : ""} ${selectedAction && selectedAction !== "approve" ? "unselected" : ""}`}
          onClick={() => handleClick("approve")}
        >
          Yes
        </button>
        <button
          type="button"
          className={`permission-btn blue ${selectedAction === "approve_session" ? "selected" : ""} ${selectedAction && selectedAction !== "approve_session" ? "unselected" : ""}`}
          onClick={() => handleClick("approve_session")}
        >
          Allow in this session
        </button>
        <button
          type="button"
          className={`permission-btn red ${selectedAction === "deny" ? "selected" : ""} ${selectedAction && selectedAction !== "deny" ? "unselected" : ""}`}
          onClick={() => handleClick("deny")}
        >
          No
        </button>
      </div>
    </div>
  );
}
