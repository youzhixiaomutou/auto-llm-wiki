import { App, Modal, Notice } from "obsidian";
import { t } from "./i18n";
import { ChangePlan, FileOperationKind } from "./types";
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
    this.modalEl.addClass("contextos-review-modal-shell");
    this.applyStyles(this.modalEl, {
      width: "min(1120px, 96vw)",
      "max-width": "1120px"
    });
    this.contentEl.empty();
    this.contentEl.addClass("contextos-review-modal");
    this.applyStyles(this.contentEl, {
      display: "flex",
      "flex-direction": "column",
      width: "100%",
      "max-height": "min(820px, 88vh)",
      overflow: "hidden"
    });

    const hero = this.contentEl.createDiv();
    hero.addClass("contextos-review-hero");
    this.applyStyles(hero, {
      padding: "28px 32px 22px",
      "border-bottom": "1px solid var(--background-modifier-border)"
    });
    hero.createEl("h2", { text: t("preview.title") });
    hero.createEl("p", { text: this.plan.summary || t("preview.noSummary") });

    const stats = hero.createDiv();
    stats.addClass("contextos-review-stats");
    this.addStatChip(stats, t("preview.proposedFileChanges", { count: this.plan.operations.length }));
    for (const [kind, count] of this.operationCounts()) {
      this.addStatChip(stats, t("preview.operationCount", {
        count,
        kind: this.getOperationLabel(kind).toLocaleLowerCase()
      }));
    }

    const changes = this.contentEl.createDiv();
    changes.addClass("contextos-changes-list");
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
      emptyState.addClass("contextos-empty-state");
      emptyState.createEl("p", { text: t("preview.noFileChanges") });
    }

    for (const operation of this.plan.operations) {
      const section = changes.createDiv();
      section.addClass("contextos-operation-card");
      this.applyStyles(section, {
        padding: "18px",
        border: "1px solid var(--background-modifier-border)",
        "border-radius": "16px",
        background: "var(--background-primary)",
        "box-shadow": "0 8px 24px rgba(0, 0, 0, 0.08)"
      });

      const header = section.createDiv();
      header.addClass("contextos-operation-header");
      const badge = header.createEl("span", { text: this.getOperationLabel(operation.kind) });
      badge.addClass("contextos-operation-badge");
      badge.addClass(`contextos-operation-${operation.kind}`);
      const path = header.createEl("span", { text: operation.path });
      path.addClass("contextos-path-pill");

      section.createEl("p", { text: operation.rationale });
      if (operation.kind !== "delete") {
        const preview = section.createEl("pre", { text: operation.content });
        preview.addClass("contextos-code-preview");
        this.applyStyles(preview, {
          "max-height": "380px",
          overflow: "auto",
          padding: "16px",
          "border-radius": "12px",
          "white-space": "pre-wrap"
        });
      }
    }

    const actions = this.contentEl.createDiv();
    actions.addClass("contextos-action-bar");
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
    const applyButton = actions.createEl("button", { text: t("preview.applyChanges") });
    applyButton.addClass("mod-cta");
    applyButton.onclick = async () => {
      applyButton.disabled = true;
      this.updateStatus(t("status.applyingChanges"));
      new Notice(t("status.applyingChanges"));
      try {
        await applyChangePlan(this.app, this.plan);
        await this.onApplySuccess();
        this.updateStatus(t("status.applied"));
        new Notice(t("notice.changesApplied"));
        this.close();
      } catch (error) {
        const message = error instanceof Error ? error.message : t("error.unknown");
        applyButton.disabled = false;
        this.updateStatus(t("status.error", { message }));
        new Notice(t("notice.applyChangesFailed", { message }));
      }
    };
    const cancelButton = actions.createEl("button", { text: t("preview.cancel") });
    cancelButton.onclick = () => this.close();
  }

  private applyStyles(element: HTMLElement, styles: Record<string, string>): void {
    for (const [name, value] of Object.entries(styles)) {
      element.style.setProperty(name, value);
    }
  }

  private addStatChip(container: HTMLElement, text: string): void {
    const chip = container.createEl("span", { text });
    chip.addClass("contextos-stat-chip");
  }

  private operationCounts(): Array<[FileOperationKind, number]> {
    const counts = new Map<FileOperationKind, number>();
    for (const operation of this.plan.operations) {
      counts.set(operation.kind, (counts.get(operation.kind) ?? 0) + 1);
    }
    return Array.from(counts.entries());
  }

  private getOperationLabel(kind: FileOperationKind): string {
    return t(`operation.${kind}`);
  }
}
