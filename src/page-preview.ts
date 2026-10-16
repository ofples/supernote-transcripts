import { App, Modal } from "obsidian";
/** Read-only fallback when the notebook is outside the vault or no viewer owns .note. */
export class OriginalPagePreview extends Modal {
  constructor(app: App, private image: string, private page: number) { super(app); }
  onOpen() {
    this.titleEl.setText(`Original notebook · page ${this.page}`);
    this.contentEl.createEl("img", { attr: { src:this.image, alt:`Original handwritten page ${this.page}` } }).style.cssText="display:block;max-width:100%;max-height:75vh;object-fit:contain;margin:auto";
  }
  onClose() { this.contentEl.empty(); }
}
