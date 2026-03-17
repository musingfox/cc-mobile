import { afterEach, describe, expect, test } from "bun:test";
import { cleanup, render } from "@testing-library/react";
import {
  Cpu,
  Eye,
  FileText,
  FolderOpen,
  Globe,
  Mic,
  Pencil,
  Search,
  Send,
  Settings,
  Square,
  Star,
  Terminal,
  toolIconMap,
  Wrench,
  X,
  Zap,
} from "../components/icons";

describe("Icon Migration", () => {
  afterEach(() => {
    cleanup();
  });

  test("toolIconMap[Read] returns Eye component", () => {
    const IconComponent = toolIconMap.Read;
    expect(IconComponent).toBe(Eye);
  });

  test("toolIconMap[Bash] returns Terminal component", () => {
    const IconComponent = toolIconMap.Bash;
    expect(IconComponent).toBe(Terminal);
  });

  test("toolIconMap[UnknownTool] returns undefined", () => {
    const IconComponent = toolIconMap.UnknownTool;
    expect(IconComponent).toBeUndefined();
  });

  test("all exported icons are defined", () => {
    const icons = [
      Settings,
      Mic,
      Square,
      Send,
      X,
      Star,
      Eye,
      Pencil,
      Terminal,
      Search,
      FolderOpen,
      Cpu,
      Zap,
      Globe,
      FileText,
      Wrench,
    ];

    for (const Icon of icons) {
      expect(Icon).toBeDefined();
      // Lucide icons can be objects or functions depending on the environment
      expect(typeof Icon === "function" || typeof Icon === "object").toBe(true);
    }
  });

  test("icons render as SVG elements", () => {
    const { container } = render(<Eye size={16} />);
    const svg = container.querySelector("svg");
    expect(svg).toBeTruthy();
  });
});
