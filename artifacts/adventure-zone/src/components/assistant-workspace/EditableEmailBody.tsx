import {
  createElement,
  forwardRef,
  useImperativeHandle,
  useMemo,
  useRef,
  type CSSProperties,
  type ReactNode,
} from "react";

export type EditedEmailBody = { html: string; text: string };
export type EditableEmailBodyHandle = { getValue: () => EditedEmailBody };

const excluded = new Set([
  "SCRIPT",
  "STYLE",
  "HEAD",
  "IFRAME",
  "OBJECT",
  "EMBED",
  "SVG",
  "MATH",
  "FORM",
  "INPUT",
  "BUTTON",
  "SELECT",
  "TEXTAREA",
  "BASE",
  "META",
  "LINK",
  "TEMPLATE",
  "NOSCRIPT",
]);
const blocks = new Set([
  "P",
  "DIV",
  "SECTION",
  "ARTICLE",
  "HEADER",
  "FOOTER",
  "H1",
  "H2",
  "H3",
  "H4",
  "H5",
  "H6",
  "BLOCKQUOTE",
  "UL",
  "OL",
  "LI",
  "TABLE",
  "TR",
  "PRE",
]);
const tags = new Set([
  "p",
  "div",
  "span",
  "table",
  "tbody",
  "thead",
  "tfoot",
  "tr",
  "td",
  "th",
  "h1",
  "h2",
  "h3",
  "h4",
  "h5",
  "h6",
  "strong",
  "b",
  "em",
  "i",
  "u",
  "s",
  "small",
  "sub",
  "sup",
  "blockquote",
  "ul",
  "ol",
  "li",
  "br",
  "hr",
]);
const styleNames = [
  "color",
  "backgroundColor",
  "fontFamily",
  "fontWeight",
  "fontStyle",
  "textAlign",
  "textDecoration",
  "verticalAlign",
  "borderCollapse",
  "borderColor",
  "borderStyle",
  "borderTopColor",
  "borderTopStyle",
  "borderBottomColor",
  "borderBottomStyle",
] as const;

function hidden(element: Element) {
  const style = (element as HTMLElement).style;
  return (
    element.hasAttribute("hidden") ||
    style?.display === "none" ||
    style?.visibility === "hidden"
  );
}

function safeStyle(element: Element): CSSProperties {
  const source = (element as HTMLElement).style;
  const style: Record<string, string | number> = {};
  for (const name of styleNames) {
    const value = source?.[name];
    if (value && !/url\s*\(|expression\s*\(|var\s*\(/i.test(value))
      style[name] = value;
  }
  // Keep spacing and typography bounded inside the editing card. No positioning,
  // remote CSS, custom properties, or source classes enter the live document.
  for (const name of [
    "paddingTop",
    "paddingRight",
    "paddingBottom",
    "paddingLeft",
    "marginTop",
    "marginBottom",
    "borderTopWidth",
    "borderBottomWidth",
    "borderLeftWidth",
    "borderRightWidth",
    "fontSize",
    "lineHeight",
  ] as const) {
    const value = source?.[name];
    if (/^\d+(\.\d+)?(px|em|rem|%)?$/.test(value ?? "")) {
      const numeric = Number.parseFloat(value);
      const limit = value.endsWith("%") ? 200 : /r?em$/.test(value) ? 4 : 64;
      if (numeric <= limit) style[name] = value;
    }
  }
  if (element.tagName === "TABLE") {
    style.width = "100%";
    style.tableLayout = "fixed";
  }
  const align = element.getAttribute("align");
  if (align && ["left", "right", "center", "justify"].includes(align))
    style.textAlign = align;
  return style as CSSProperties;
}

function readableText(node: Node, editing = false): string {
  if (node.nodeType === Node.TEXT_NODE) return node.nodeValue ?? "";
  if (!(node instanceof Element))
    return Array.from(node.childNodes)
      .map((child) => readableText(child, editing))
      .join("");
  if (
    node.namespaceURI !== "http://www.w3.org/1999/xhtml" ||
    excluded.has(node.tagName) ||
    hidden(node)
  )
    return "";
  if (node.tagName === "BR") return "\n";
  if (node.tagName === "IMG")
    return editing ? "" : (node.getAttribute("alt") ?? "");
  const text = Array.from(node.childNodes)
    .map((child) => readableText(child, editing))
    .join("");
  if (blocks.has(node.tagName)) return `\n${text}\n`;
  return text + (node.tagName === "TD" || node.tagName === "TH" ? "\t" : "");
}

function editableText(element: HTMLElement) {
  // innerText follows browser-created line breaks from Enter. The fallback also
  // supports non-layout DOMs and never treats pasted text as markup.
  return (
    typeof element.innerText === "string"
      ? element.innerText
      : Array.from(element.childNodes)
          .map((child) => readableText(child, true))
          .join("")
          .replace(/\n{2,}/g, "\n")
  ).replace(/\r\n?/g, "\n");
}

function parse(html: string) {
  // Template contents have an inert owner document: parsing does not execute
  // scripts or load images/frames. Only our allowlisted React projection is mounted.
  // Preserve a complete email's outer document, including its head/media rules.
  const open = /<body\b[^>]*>/i.exec(html);
  const close = html.toLowerCase().lastIndexOf("</body>");
  const hasBody = open && close >= open.index + open[0].length;
  const start = hasBody ? open.index + open[0].length : 0;
  const end = hasBody ? close : html.length;
  const template = document.createElement("template");
  template.innerHTML = html.slice(start, end);
  const walker = document.createTreeWalker(
    template.content,
    NodeFilter.SHOW_TEXT,
  );
  const ids = new Map<Node, number>();
  while (walker.nextNode()) ids.set(walker.currentNode, ids.size);
  return {
    html,
    template,
    ids,
    prefix: html.slice(0, start),
    suffix: html.slice(end),
  };
}

/** Mount once per edit session; incoming refreshes must not replace unsaved text. */
export const EditableEmailBody = forwardRef<
  EditableEmailBodyHandle,
  { html: string; onDirty?: (dirty: boolean) => void; disabled?: boolean }
>(function EditableEmailBody({ html, onDirty, disabled = false }, ref) {
  const model = useRef<ReturnType<typeof parse> | null>(null);
  if (!model.current) model.current = parse(html);
  const edits = useRef(new Map<number, string>());
  const dirtyCallback = useRef(onDirty);
  dirtyCallback.current = onDirty;

  useImperativeHandle(
    ref,
    () => ({
      getValue() {
        const original = model.current!;
        const output = document.createElement("template");
        output.content.append(original.template.content.cloneNode(true));
        const walker = document.createTreeWalker(
          output.content,
          NodeFilter.SHOW_TEXT,
        );
        const nodes: Node[] = [];
        while (walker.nextNode()) nodes.push(walker.currentNode);
        edits.current.forEach((value, id) => {
          const replacement = document.createDocumentFragment();
          value.split("\n").forEach((line, index) => {
            if (index) replacement.append(document.createElement("br"));
            replacement.append(document.createTextNode(line));
          });
          nodes[id].parentNode!.replaceChild(replacement, nodes[id]);
        });
        return {
          html: edits.current.size
            ? original.prefix + output.innerHTML + original.suffix
            : original.html,
          text: readableText(output.content)
            .replace(/[ \t]+\n/g, "\n")
            .replace(/\n[ \t]+/g, "\n")
            .replace(/[ \t]{2,}/g, " ")
            .replace(/\n{3,}/g, "\n\n")
            .trim(),
        };
      },
    }),
    [],
  );

  const content = useMemo(() => {
    let field = 0;
    function renderNode(node: Node, key: number): ReactNode {
      if (node.nodeType === Node.TEXT_NODE) {
        const original = node.nodeValue ?? "";
        if (!original.trim()) return original;
        const id = model.current!.ids.get(node)!;
        const update = (element: HTMLElement) => {
          if (disabled) return;
          const value = editableText(element);
          if (value === original) edits.current.delete(id);
          else edits.current.set(id, value);
          dirtyCallback.current?.(edits.current.size > 0);
        };
        return (
          <span
            key={key}
            role="textbox"
            aria-label={`Email text ${++field}`}
            aria-multiline="true"
            aria-readonly={disabled}
            contentEditable={!disabled}
            suppressContentEditableWarning
            tabIndex={disabled ? -1 : 0}
            className="rounded-sm empty:inline-block empty:min-w-[1ch] focus:outline focus:outline-2 focus:outline-teal-600"
            style={{ whiteSpace: "pre-wrap", overflowWrap: "anywhere" }}
            onInput={(event) => update(event.currentTarget)}
            onBeforeInput={(event) => {
              const type = (event.nativeEvent as InputEvent).inputType;
              if (type?.startsWith("format") || type === "insertFromDrop")
                event.preventDefault();
            }}
            onKeyDown={(event) => {
              if (
                (event.ctrlKey || event.metaKey) &&
                ["b", "i", "u"].includes(event.key.toLowerCase())
              )
                event.preventDefault();
            }}
            onDrop={(event) => event.preventDefault()}
            onPaste={(event) => {
              event.preventDefault();
              if (disabled) return;
              const element = event.currentTarget;
              const text = document.createTextNode(
                event.clipboardData
                  .getData("text/plain")
                  .replace(/\r\n?/g, "\n"),
              );
              const selection = window.getSelection();
              const range = selection?.rangeCount
                ? selection.getRangeAt(0)
                : null;
              if (range && element.contains(range.commonAncestorContainer)) {
                range.deleteContents();
                range.insertNode(text);
              } else element.append(text);
              if (selection) {
                const caret = document.createRange();
                caret.setStartAfter(text);
                caret.collapse(true);
                selection.removeAllRanges();
                selection.addRange(caret);
              }
              update(element);
            }}
          >
            {original}
          </span>
        );
      }
      if (
        !(node instanceof Element) ||
        node.namespaceURI !== "http://www.w3.org/1999/xhtml" ||
        excluded.has(node.tagName) ||
        hidden(node)
      )
        return null;
      if (node.tagName === "IMG")
        return <span key={key}>{node.getAttribute("alt") || "[Image]"}</span>;
      const sourceTag = node.tagName.toLowerCase();
      const tag = tags.has(sourceTag) ? sourceTag : "span";
      const props: Record<string, unknown> = { key, style: safeStyle(node) };
      if (tag === "td" || tag === "th") {
        for (const [attribute, prop] of [
          ["colspan", "colSpan"],
          ["rowspan", "rowSpan"],
        ]) {
          const value = Number(node.getAttribute(attribute));
          if (value >= 1 && value <= 20) props[prop] = value;
        }
      }
      return createElement(
        tag,
        props,
        tag === "br" || tag === "hr"
          ? undefined
          : Array.from(node.childNodes).map(renderNode),
      );
    }
    return Array.from(model.current!.template.content.childNodes).map(
      renderNode,
    );
  }, [disabled]);

  return (
    <div
      role="group"
      aria-label="Editable email body"
      className="max-h-[60dvh] overflow-auto rounded-lg border p-2 text-base"
      style={{
        isolation: "isolate",
        overflowWrap: "anywhere",
        fontFamily: "Arial, Helvetica, sans-serif",
        backgroundColor: "white",
        color: "#0f172a",
      }}
    >
      {content}
    </div>
  );
});
