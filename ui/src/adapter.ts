namespace Amaterasu {
  type Child = Node | string | null | undefined;
  export const literalText = (value: string): string => value;
  export const localizedMessage = literalText;
  export const activeIntlLocale = (): string => (typeof navigator === "undefined" ? "en" : navigator.language);
  export const localeFormattedTextNode = (format: (locale: string) => string): Node | string => typeof document.createTextNode === "function" ? document.createTextNode(format(activeIntlLocale())) : format(activeIntlLocale());
  export const setLocalizedTextContent = (node: HTMLElement, text: string): void => { node.textContent = text; };
  export const setLocalizedAttributeTemplate = (node: Element, name: string, template: string, values: Record<string, string | number>): void => {
    node.setAttribute(name, template.replace(/\{(\w+)\}/g, (_, key: string) => String(values[key] ?? key)));
  };
  export function el<K extends keyof HTMLElementTagNameMap>(tag: K, className = "", ...children: Child[]): HTMLElementTagNameMap[K] {
    const element = document.createElement(tag); element.className = className;
    for (const child of children) if (child != null) element.append(child);
    return element;
  }
  export function button(label: string, action: () => void | Promise<void>, kind = "secondary"): HTMLButtonElement {
    const node = el("button", `button ${kind}`, label); node.type = "button";
    node.addEventListener("click", () => { void action(); }); return node;
  }
  export function field(label: string, control: Element, hint?: string): HTMLElement { return el("label", "field", el("span", "field-label", label), control, hint ? el("small", "muted", hint) : null); }
  export function input(name: string, value = "", type = "text"): HTMLInputElement { const node = el("input"); node.name = name; node.value = value; node.type = type; return node; }
  export function panel(title: string, ...nodes: Child[]): HTMLElement { return el("section", "panel", el("h2", "", title), ...nodes); }
  export function sectionHeading(title: string, description: string, ...actions: Child[]): HTMLElement { return el("header", "page-heading", el("div", "", el("h1", "", title), el("p", "muted", description)), el("div", "actions", ...actions)); }
  export function empty(title: string, description: string, action?: HTMLElement): HTMLElement { return el("div", "empty-state", el("h3", "", title), el("p", "muted", description), action); }
  export function messageOf(error: unknown): string { return error instanceof Error ? error.message : "The request failed."; }
  export function errorPanel(error: unknown, retry?: () => void | Promise<void>): HTMLElement { const node = el("div", "notice error", messageOf(error)); node.setAttribute("role", "alert"); if (retry) node.append(button("Try again", retry)); return node; }
  export function badge(text: string, tone = ""): HTMLElement { return el("span", `badge ${tone}`, text); }
  export function table(headers: string[], rows: Child[][]): HTMLElement { return el("div", "table-scroll", el("table", "", el("thead", "", el("tr", "", ...headers.map(h => { const n = el("th", "", h); n.scope = "col"; return n; }))), el("tbody", "", ...rows.map(row => el("tr", "", ...row.map(value => el("td", "", value))))))); }
  export function pager(back: (() => void) | null, next: (() => void) | null, text: string): HTMLElement { const previous = button("Previous", () => back?.()); previous.disabled = !back; const following = button("Next", () => next?.()); following.disabled = !next; return el("div", "pager", previous, el("span", "", text), following); }
  export async function runAction(control: HTMLButtonElement, status: HTMLElement, action: () => Promise<void>): Promise<void> { control.disabled = true; try { await action(); } catch (error) { status.replaceChildren(errorPanel(error)); } finally { control.disabled = false; } }
  export async function confirmAction(title: string, description: string, label: string, ui?: StatsUi): Promise<boolean> {
    if (ui?.dialog) return new Promise(resolve => {
      let settled=false;
      const finish=(answer:boolean) => {if(settled)return;settled=true;resolve(answer);dialog.dispose();};
      const confirm=button(label,()=>finish(true),"danger");
      const dialog=ui.dialog!({title,description,content:[confirm],onClose:()=>finish(false)});
      dialog.open();
    });
    return new Promise(resolve => {
      const dialog = el("dialog", "stats-confirm");
      const finish = (answer: boolean) => { dialog.close(); dialog.remove(); resolve(answer); };
      dialog.append(el("h2", "", title), el("p", "", description), button("Cancel", () => finish(false)), button(label, () => finish(true), "danger"));
      dialog.addEventListener("cancel", event => { event.preventDefault(); finish(false); }); document.body.append(dialog); dialog.showModal();
    });
  }
}
