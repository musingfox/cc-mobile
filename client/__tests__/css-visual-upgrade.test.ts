import { describe, expect, it } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const stylesPath = join(import.meta.dir, "..", "styles.css");
const css = readFileSync(stylesPath, "utf-8");

describe("CSS Visual Upgrade", () => {
  describe("C1: CSS Variable System Extension", () => {
    it("should define glass variables in .theme-dark", () => {
      expect(css).toContain("--glass-bg:");
      expect(css).toContain("--glass-border:");
      expect(css).toContain("--glass-blur: 16px");
    });

    it("should define gradient variables in .theme-dark", () => {
      expect(css).toContain("--gradient-primary: linear-gradient(135deg, #667eea");
      expect(css).toContain("--gradient-accent: linear-gradient(135deg, #f093fb");
    });

    it("should define shadow variables in .theme-dark", () => {
      expect(css).toContain("--shadow-sm: 0 2px 8px rgba(0, 0, 0, 0.3)");
      expect(css).toContain("--shadow-md: 0 4px 16px rgba(0, 0, 0, 0.4)");
      expect(css).toContain("--shadow-lg: 0 8px 32px rgba(0, 0, 0, 0.5)");
    });

    it("should define glow variables in .theme-dark", () => {
      expect(css).toContain("--glow-primary");
      expect(css).toContain("--glow-accent");
      expect(css).toContain("--glow-cyan");
      expect(css).toContain("--glow-subtle");
    });

    it("should define glass variables in .theme-light", () => {
      expect(css).toContain("--glass-bg: rgba(255, 255, 255, 0.6)");
      expect(css).toContain("--glass-blur: 12px");
    });

    it("should define glass variables in .theme-claude", () => {
      expect(css).toContain("--glass-bg: rgba(242, 237, 229, 0.55)");
    });

    it("should define Neural Interface tokens", () => {
      expect(css).toContain("--accent-cyan");
      expect(css).toContain("--accent-electric");
      expect(css).toContain("--glass-bg-heavy");
      expect(css).toContain("--glass-border-bright");
      expect(css).toContain("--font-mono");
      expect(css).toContain("--bg-mesh");
    });
  });

  describe("C2: Glassmorphism Components", () => {
    it("should apply glass effect to .status-bar", () => {
      const statusBarMatch = css.match(/\.status-bar\s*\{[^}]+\}/s);
      expect(statusBarMatch).toBeTruthy();
      const statusBar = statusBarMatch?.[0];
      expect(statusBar).toContain("backdrop-filter");
      expect(statusBar).toContain("var(--glass-bg-heavy)");
    });

    it("should apply glass effect to .input-bar", () => {
      const inputBarMatch = css.match(/\.input-bar\s*\{[^}]+\}/s);
      expect(inputBarMatch).toBeTruthy();
      const inputBar = inputBarMatch?.[0];
      expect(inputBar).toContain("backdrop-filter");
      expect(inputBar).toContain("var(--glass-bg-heavy)");
    });

    it("should apply glass effect to .drawer-content", () => {
      const drawerMatch = css.match(/\.drawer-content\s*\{[^}]+\}/s);
      expect(drawerMatch).toBeTruthy();
      const drawer = drawerMatch?.[0];
      expect(drawer).toContain("backdrop-filter");
      expect(drawer).toContain("var(--glass-bg-heavy)");
    });

    it("should apply glass effect to .activity-tool-card", () => {
      const cardMatch = css.match(/\.activity-tool-card\s*\{[^}]+\}/s);
      expect(cardMatch).toBeTruthy();
      const card = cardMatch?.[0];
      expect(card).toContain("backdrop-filter");
      expect(card).toContain("var(--glass-bg)");
    });
  });

  describe("C3: Gradient Accents", () => {
    it("should use gradient in .send-btn", () => {
      const sendBtnMatch = css.match(/\.send-btn\s*\{[^}]+\}/s);
      expect(sendBtnMatch).toBeTruthy();
      expect(sendBtnMatch?.[0]).toContain("var(--gradient-cyan)");
    });

    it("should use animated indicator in session tabs", () => {
      expect(css).toContain(".session-tab-indicator");
      expect(css).toContain("var(--gradient-cyan)");
    });
  });

  describe("C4: Glow Effects", () => {
    it("should add glow to .send-btn on hover", () => {
      expect(css).toMatch(/\.send-btn:hover[^}]*var\(--glow-primary\)/s);
    });

    it("should add glow to .status-dot.connected", () => {
      const connectedMatch = css.match(/\.status-dot\.connected\s*\{[^}]+\}/s);
      expect(connectedMatch).toBeTruthy();
      expect(connectedMatch?.[0]).toMatch(/box-shadow.*rgba/);
    });
  });

  describe("C5: Depth Layering", () => {
    it("should apply shadows to components", () => {
      expect(css).toMatch(/\.status-bar[^}]*var\(--shadow-sm\)/s);
      expect(css).toMatch(/\.input-bar[^}]*var\(--shadow-lg\)/s);
      expect(css).toMatch(/\.drawer-content[^}]*var\(--shadow-lg\)/s);
      expect(css).toMatch(/\.permission-bar[^}]*var\(--shadow-lg\)/s);
    });
  });

  describe("C6: Typography Enhancement", () => {
    it("should use DM Sans font in body", () => {
      expect(css).toContain("DM Sans");
    });

    it("should enable font smoothing", () => {
      expect(css).toContain("-webkit-font-smoothing: antialiased");
      expect(css).toContain("text-rendering: optimizeLegibility");
    });

    it("should enhance .message-content typography", () => {
      const messageMatch = css.match(/\.message-content\s*\{[^}]+\}/s);
      expect(messageMatch).toBeTruthy();
      expect(messageMatch?.[0]).toContain("line-height: 1.6");
      expect(messageMatch?.[0]).toContain("letter-spacing: 0.01em");
    });

    it("should set font-weight for .status-label", () => {
      const statusLabelMatch = css.match(/\.status-label\s*\{[^}]+\}/s);
      expect(statusLabelMatch).toBeTruthy();
      expect(statusLabelMatch?.[0]).toContain("font-weight: 500");
    });

    it("should use Fira Code for monospace", () => {
      expect(css).toContain("Fira Code");
      expect(css).toContain("--font-mono");
    });
  });

  describe("C7: Interactive Transitions", () => {
    it("should add transitions to .send-btn", () => {
      const sendBtnMatch = css.match(/\.send-btn\s*\{[^}]+\}/s);
      expect(sendBtnMatch).toBeTruthy();
      expect(sendBtnMatch?.[0]).toContain("transition");
    });

    it("should add transitions to .session-tab", () => {
      const tabMatch = css.match(/\.session-tab\s*\{[^}]+\}/s);
      expect(tabMatch).toBeTruthy();
      expect(tabMatch?.[0]).toContain("transition");
    });

    it("should add :active state with scale transform", () => {
      expect(css).toMatch(/\.send-btn:active[^}]*transform:\s*scale\(0\.95\)/s);
      expect(css).toMatch(/\.session-tab:active[^}]*transform:\s*scale\(0\.97\)/s);
    });
  });

  describe("C8: Mobile Performance", () => {
    it("should include prefers-reduced-motion media query", () => {
      expect(css).toContain("@media (prefers-reduced-motion: reduce)");
    });

    it("should set will-change on glass elements", () => {
      expect(css).toMatch(/\.status-bar[^}]*will-change:\s*backdrop-filter/s);
      expect(css).toMatch(/\.input-bar[^}]*will-change:\s*backdrop-filter/s);
    });
  });

  describe("C10: Component-Specific Polish", () => {
    it("should round .message.user .message-content to 16px", () => {
      const userMsgMatch = css.match(/\.message\.user\s+\.message-content\s*\{[^}]+\}/s);
      expect(userMsgMatch).toBeTruthy();
      expect(userMsgMatch?.[0]).toContain("border-radius: 16px");
    });

    it("should add shadow to .message.user .message-content", () => {
      const userMsgMatch = css.match(/\.message\.user\s+\.message-content\s*\{[^}]+\}/s);
      expect(userMsgMatch).toBeTruthy();
      expect(userMsgMatch?.[0]).toContain("box-shadow: var(--shadow-sm)");
    });

    it("should add glass bg and border to .message.assistant .message-content", () => {
      const assistantMsgMatch = css.match(/\.message\.assistant\s+\.message-content\s*\{[^}]+\}/s);
      expect(assistantMsgMatch).toBeTruthy();
      expect(assistantMsgMatch?.[0]).toContain("var(--glass-bg-heavy)");
      expect(assistantMsgMatch?.[0]).toContain("border:");
    });

    it("should round .input-textarea to 16px", () => {
      const textareaMatch = css.match(/\.input-textarea\s*\{[^}]+\}/s);
      expect(textareaMatch).toBeTruthy();
      expect(textareaMatch?.[0]).toContain("border-radius: 16px");
    });

    it("should round .input-bar to 20px", () => {
      const inputBarMatch = css.match(/\.input-bar\s*\{[^}]+\}/s);
      expect(inputBarMatch).toBeTruthy();
      expect(inputBarMatch?.[0]).toContain("border-radius: 20px");
    });

    it("should add hover lift to .activity-tool-card", () => {
      expect(css).toMatch(/\.activity-tool-card:hover[^}]*transform:\s*translateY\(-1px\)/s);
    });

    it("should add glass to .tool-chip", () => {
      const chipMatch = css.match(/\.tool-chip\s*\{[^}]+\}/s);
      expect(chipMatch).toBeTruthy();
      expect(chipMatch?.[0]).toContain("var(--glass-bg)");
    });

    it("should add glass to .command-panel-search", () => {
      const searchMatch = css.match(/\.command-panel-search\s*\{[^}]+\}/s);
      expect(searchMatch).toBeTruthy();
      expect(searchMatch?.[0]).toContain("var(--glass-bg)");
    });

    it("should add hover effect to .command-panel-item", () => {
      expect(css).toMatch(/\.command-panel-item:hover[^}]*var\(--glass-border-bright\)/s);
    });
  });
});
