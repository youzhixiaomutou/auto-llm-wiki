import { App, Modal, Notice } from "obsidian";
import { ChangePlan } from "./types";
import { applyChangePlan } from "./vaultOps";

export class ChangePlanPreviewModal extends Modal {
  constructor(
    app: App,
    private readonly plan: ChangePlan,
    private readonly updateStatus: (message: string) => void = () => undefined,
    private readonly onApplySuccess: () => Promise<void> = async () => undefined
  ) {
    super(app);
  }

  onOpen(): void {
    this.modalEl.addClass("auto-llm-wiki-review-modal-shell");
    this.applyStyles(this.modalEl, {
      width: "min(1120px, 96vw)",
      "max-width": "1120px"
    });
    this.contentEl.empty();
    this.contentEl.addClass("auto-llm-wiki-review-modal");
    this.applyStyles(this.contentEl, {
      display: "flex",
      "flex-direction": "column",
      width: "100%",
      "max-height": "min(820px, 88vh)",
      overflow: "hidden"
    });

    const hero = this.contentEl.createDiv();
    hero.addClass("auto-llm-wiki-review-hero");
    this.applyStyles(hero, {
      padding: "28px 32px 22px",
      "border-bottom": "1px solid var(--background-modifier-border)"
    });
    hero.createEl("h2", { text: "Review Auto LLM Wiki changes" });
    hero.createEl("p", { text: this.plan.summary || "No summary provided by the model." });

    const stats = hero.createDiv();
    stats.addClass("auto-llm-wiki-review-stats");
    this.addStatChip(stats, `${this.plan.operations.length} proposed file changes`);
    for (const [kind, count] of this.operationCounts()) {
      this.addStatChip(stats, `${count} ${kind}`);
    }

    const changes = this.contentEl.createDiv();
    changes.addClass("auto-llm-wiki-changes-list");
    this.applyStyles(changes, {
      display: "flex",
      "flex-direction": "column",
      gap: "16px",
      "min-height": "220px",
      "max-height": "min(58vh, 620px)",
      overflow: "auto",
      padding: "20px 32px"
    });

    if (this.plan.operations.length === 0) {
      const emptyState = changes.createDiv();
      emptyState.addClass("auto-llm-wiki-empty-state");
      emptyState.createEl("p", { text: "No file changes were proposed by the model." });
    }

    for (const operation of this.plan.operations) {
      const section = changes.createDiv();
      section.addClass("auto-llm-wiki-operation-card");
      this.applyStyles(section, {
        padding: "18px",
        border: "1px solid var(--background-modifier-border)",
        "border-radius": "16px",
        background: "var(--background-primary)",
        "box-shadow": "0 8px 24px rgba(0, 0, 0, 0.08)"
      });

      const header = section.createDiv();
      header.addClass("auto-llm-wiki-operation-header");
      const badge = header.createEl("span", { text: operation.kind.toUpperCase() });
      badge.addClass("auto-llm-wiki-operation-badge");
      badge.addClass(`auto-llm-wiki-operation-${operation.kind}`);
      const path = header.createEl("span", { text: operation.path });
      path.addClass("auto-llm-wiki-path-pill");

      section.createEl("p", { text: operation.rationale });
      const preview = section.createEl("pre", { text: operation.content });
      preview.addClass("auto-llm-wiki-code-preview");
      this.applyStyles(preview, {
        "max-height": "380px",
        overflow: "auto",
        padding: "16px",
        "border-radius": "12px",
        "white-space": "pre-wrap"
      });
    }

    const actions = this.contentEl.createDiv();
    actions.addClass("auto-llm-wiki-action-bar");
    this.applyStyles(actions, {
      position: "sticky",
      bottom: "0",
      display: "flex",
      "justify-content": "flex-end",
      gap: "12px",
      padding: "16px 32px",
      "border-top": "1px solid var(--background-modifier-border)",
      background: "var(--background-primary)"
    });
    const applyButton = actions.createEl("button", { text: "Apply changes" });
    applyButton.addClass("mod-cta");
    applyButton.onclick = async () => {
      applyButton.disabled = true;
      this.updateStatus("Auto LLM Wiki: applying changes...");
      new Notice("Auto LLM Wiki: applying changes...");
      try {
        await applyChangePlan(this.app, this.plan);
        await this.onApplySuccess();
        this.updateStatus("Auto LLM Wiki: applied");
        new Notice("Auto LLM Wiki changes applied.");
        this.close();
      } catch (error) {
        const message = error instanceof Error ? error.message : "Unknown error";
        applyButton.disabled = false;
        this.updateStatus(`Auto LLM Wiki: error - ${message}`);
        new Notice(`Failed to apply Auto LLM Wiki changes: ${message}`);
      }
    };
    const cancelButton = actions.createEl("button", { text: "Cancel" });
    cancelButton.onclick = () => this.close();
  }

  private applyStyles(element: HTMLElement, styles: Record<string, string>): void {
    for (const [name, value] of Object.entries(styles)) {
      element.style.setProperty(name, value);
    }
  }

  private addStatChip(container: HTMLElement, text: string): void {
    const chip = container.createEl("span", { text });
    chip.addClass("auto-llm-wiki-stat-chip");
  }

  private operationCounts(): Array<[string, number]> {
    const counts = new Map<string, number>();
    for (const operation of this.plan.operations) {
      counts.set(operation.kind, (counts.get(operation.kind) ?? 0) + 1);
    }
    return Array.from(counts.entries());
  }
}
