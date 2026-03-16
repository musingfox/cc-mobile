import { useState } from "react";
import { getPermissionOptions, type PermissionOption } from "../services/permission-options";

type PermissionFooterProps = {
  toolName: string;
  parameters: Record<string, unknown>;
  onRespond: (action: "approve" | "approve_session" | "deny") => void;
};

export default function PermissionFooter({
  toolName,
  parameters,
  onRespond,
}: PermissionFooterProps) {
  const [selectedOption, setSelectedOption] = useState<string | null>(null);
  const options = getPermissionOptions(toolName, parameters);

  const handleOptionClick = (option: PermissionOption) => {
    setSelectedOption(option.id);
    onRespond(option.action);
  };

  return (
    <div className="permission-footer">
      {options.map((option) => (
        <button
          key={option.id}
          type="button"
          className={`permission-option ${option.color} ${selectedOption === option.id ? "selected" : ""} ${selectedOption && selectedOption !== option.id ? "unselected" : ""}`}
          onClick={() => handleOptionClick(option)}
        >
          {option.label}
        </button>
      ))}
    </div>
  );
}
