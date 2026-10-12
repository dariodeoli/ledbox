import assert from "node:assert/strict";
import { test } from "node:test";
import { pathToFileURL } from "node:url";
import { renderMail } from "../lib/server/mail/template";

type Element = { tag: string; attrs: Record<string, string>; parent?: Element; text: string[] };
type Rule = { selector: string; declarations: string; order: number };
export type Mode = "light" | "dark" | "ogsc";

// Deliberately bounded evaluator for emitted mail CSS, not a browser/client simulator.
// Unsupported color/selector syntax fails explicitly rather than guessing a passing pair.
export function contrast(foreground: string, background: string): number {
  const luminance = (value: string) => {
    const hex = /^#([a-f\d]{6}|[a-f\d]{3})$/i.exec(value);
    const rgb = /^rgb\(\s*(\d+)\s*,\s*(\d+)\s*,\s*(\d+)\s*\)$/i.exec(value);
    assert.ok(hex || rgb, `Unsupported emitted color: ${value}`);
    const channels = hex ? (hex[1].length === 3 ? [...hex[1]].map(c => c + c).join("") : hex[1]).match(/../g)!.map(c => parseInt(c, 16)) : rgb!.slice(1).map(Number);
    assert.ok(channels.every(c => c >= 0 && c <= 255));
    const linear = channels.map(c => { const s = c / 255; return s <= .04045 ? s / 12.92 : ((s + .055) / 1.055) ** 2.4; });
    return linear[0] * .2126 + linear[1] * .7152 + linear[2] * .0722;
  };
  const a = luminance(foreground), b = luminance(background);
  return (Math.max(a, b) + .05) / (Math.min(a, b) + .05);
}

function rules(css: string, mode: Mode, width: number): Rule[] {
  const output: Rule[] = [];
  const walk = (block: string) => {
    let at = 0;
    while (at < block.length) {
      const open = block.indexOf("{", at); if (open < 0) break;
      const selector = block.slice(at, open).trim(); let end = open + 1, depth = 1;
      for (; end < block.length && depth; end++) { if (block[end] === "{") depth++; if (block[end] === "}") depth--; }
      assert.equal(depth, 0, "Unclosed emitted CSS block");
      const body = block.slice(open + 1, end - 1);
      if (selector.startsWith("@media")) {
        const dark = /prefers-color-scheme\s*:\s*dark/.test(selector);
        const max = /max-width\s*:\s*(\d+)px/.exec(selector);
        assert.ok(dark || max, `Unsupported emitted media: ${selector}`);
        if ((!dark || mode === "dark") && (!max || width <= Number(max[1]))) walk(body);
      } else {
        assert.ok(!selector.startsWith("@"), `Unsupported emitted at-rule: ${selector}`);
        for (const item of selector.split(",")) output.push({ selector: item.trim(), declarations: body, order: output.length });
      }
      at = end;
    }
  };
  walk(css.replace(/\/\*[\s\S]*?\*\//g, "")); return output;
}

function matches(node: Element, selector: string): boolean {
  const parts = selector.trim().split(/\s+(?![^[]*\])/);
  const simple = (element: Element, part: string) => {
    assert.ok(!/[>+~]/.test(part), `Unsupported emitted selector: ${selector}`);
    const attributes = [...part.matchAll(/\[([\w-]+)(?:=["']?([^\]"']*)["']?)?\]/g)];
    const base = part.replace(/\[[^\]]*\]/g, "");
    assert.ok(!base.includes(":") || base === ":root", `Unsupported emitted pseudo-selector: ${selector}`);
    if (base === ":root" && element.tag !== "html") return false;
    const tag = base === ":root" ? null : /^[\w:-]+/.exec(base);
    if (tag && tag[0] !== element.tag) return false;
    if ([...base.matchAll(/\.([\w-]+)/g)].some(m => !(element.attrs.class ?? "").split(/\s+/).includes(m[1]))) return false;
    if ([...base.matchAll(/#([\w-]+)/g)].some(m => element.attrs.id !== m[1])) return false;
    return attributes.every(m => m[1] in element.attrs && (m[2] === undefined || element.attrs[m[1]] === m[2]));
  };
  let current: Element | undefined = node;
  if (!simple(node, parts.pop()!)) return false;
  for (const part of parts.reverse()) {
    current = current?.parent;
    while (current && !simple(current, part)) current = current.parent;
    if (!current) return false;
  }
  return true;
}

export function inspectMail(html: string, mode: Mode, width = 600) {
  const css = [...html.matchAll(/<style[^>]*>([\s\S]*?)<\/style>/gi)].map(m => m[1]).join("\n");
  const sheet = rules(css, mode, width), nodes: Element[] = [], stack: Element[] = [];
  const markup = html.replace(/<style[^>]*>[\s\S]*?<\/style>/gi, "")
    .replace(/<!--\[if[^>]*>/g, "").replace(/<!--<!\[endif\]-->/g, "")
    .replace(/<!\[endif\]-->/g, "").replace(/<!-->/g, "").replace(/<!--[\s\S]*?-->/g, "");
  for (const token of markup.match(/<[^>]*>|[^<]+/g) ?? []) {
    if (token.startsWith("</")) {
      const tag = /^<\/([^\s>]+)/.exec(token)![1].toLowerCase();
      const index = stack.findLastIndex(n => n.tag === tag); if (index >= 0) stack.length = index;
    } else if (/^<[a-z]/i.test(token)) {
      const tag = /^<([^\s/>]+)/.exec(token)![1].toLowerCase(), attrs: Record<string, string> = {};
      for (const match of token.matchAll(/([\w:-]+)\s*=\s*(?:"([^"]*)"|'([^']*)')/g)) attrs[match[1]] = match[2] ?? match[3];
      if (mode === "ogsc" && tag === "html") attrs["data-ogsc"] = "";
      const node = { tag, attrs, parent: stack.at(-1), text: [] }; nodes.push(node);
      if (!/^(meta|img|br|hr|input|link|w:anchorlock)$/.test(tag) && !token.endsWith("/>")) stack.push(node);
    } else if (!token.startsWith("<") && token.trim()) stack.at(-1)?.text.push(token.trim());
  }
  const memo = new Map<Element, Record<string, string>>();
  const style = (node: Element): Record<string, string> => {
    if (memo.has(node)) return memo.get(node)!;
    const parent = node.parent ? style(node.parent) : {};
    const values: Record<string, string> = { color: parent.color ?? "#000000", "font-size": parent["font-size"] ?? "16px", "font-weight": parent["font-weight"] ?? "400" };
    for (const key of Object.keys(parent).filter(key => key.startsWith("--"))) values[key] = parent[key];
    const ranks: Record<string, number> = {};
    const apply = (declarations: string, specificity: number, order: number) => {
      for (const declaration of declarations.split(";")) {
        const colon = declaration.indexOf(":"); if (colon < 0) continue;
        const key = declaration.slice(0, colon).trim(), raw = declaration.slice(colon + 1).trim();
        const rank = (/!important\s*$/.test(raw) ? 1e9 : 0) + specificity * 1e4 + order;
        const value = raw.replace(/\s*!important\s*$/, "");
        const set = (property: string, content: string) => { if (rank >= (ranks[property] ?? -1)) { values[property] = content; ranks[property] = rank; } };
        if (key === "font") {
          const size = /([\d.]+px)(?:\/[\d.]+)?/.exec(value); assert.ok(size, `Unsupported emitted font: ${value}`);
          set("font-size", size[1]); set("font-weight", /\b(bold|[1-9]00)\b/.exec(value)?.[1] ?? "400");
        } else set(key === "background" ? "background-color" : key, value);
      }
    };
    if (node.attrs.bgcolor || node.attrs.fillcolor) apply(`background-color:${node.attrs.bgcolor ?? node.attrs.fillcolor}`, 0, -1);
    for (const rule of sheet) if (matches(node, rule.selector)) {
      const specificity = (rule.selector.match(/#/g)?.length ?? 0) * 100 + (rule.selector.match(/[.[]/g)?.length ?? 0) * 10 + (rule.selector.match(/(?:^|\s)[a-z]/gi)?.length ?? 0);
      apply(rule.declarations, specificity, rule.order);
    }
    apply(node.attrs.style ?? "", 1000, sheet.length);
    const resolve = (value: string): string => value.replace(/var\((--[\w-]+)(?:,\s*([^)]*))?\)/g, (_, key: string, fallback: string) => {
      assert.ok(values[key] || fallback, `Unresolved emitted color variable: ${key}`); return values[key] ?? fallback;
    });
    for (const key of ["color", "background-color"]) if (values[key]) values[key] = resolve(values[key]);
    if (values.color === "inherit") values.color = parent.color;
    if (values.color === "currentColor") values.color = parent.color;
    memo.set(node, values); return values;
  };
  const visible = (node: Element): boolean => !["head", "title", "style", "script"].includes(node.tag)
    && style(node).display !== "none" && style(node).visibility !== "hidden" && style(node).opacity !== "0"
    && (!node.parent || visible(node.parent));
  const background = (node: Element): string => {
    const value = style(node)["background-color"];
    return value && !["transparent", "inherit"].includes(value) ? value : node.parent ? background(node.parent) : "#ffffff";
  };
  const records = nodes.filter(n => n.text.length && visible(n)).map(node => {
    const computed = style(node), foreground = computed.color, backdrop = background(node);
    const fontSize = parseFloat(computed["font-size"]), weight = computed["font-weight"] === "bold" ? 700 : Number(computed["font-weight"]);
    assert.ok(/px$/.test(computed["font-size"]) && Number.isFinite(fontSize) && Number.isFinite(weight), "Unresolved font metrics");
    return { node, text: node.text.join(" "), foreground, background: backdrop, ratio: contrast(foreground, backdrop), minimum: fontSize >= 24 || (fontSize >= 18.6667 && weight >= 700) ? 3 : 4.5, computed };
  });
  return { records, nodes, style, css };
}

export const fullContent = {
  title: "Título de auditoría", intro: "Texto principal", eyebrow: "Etiqueta",
  rows: [{ label: "Dato", value: "Valor" }, { label: "Enlace", value: "Ver detalle", href: "https://example.invalid/detail" }, { label: "Total", value: "1.000", strong: true }],
  cta: { label: "Abrir", url: "https://example.invalid/" + "long-segment".repeat(60), note: "Nota de acción" },
  note: "Nota de contexto", organization: "Organización", reason: "motivo del mensaje",
};

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  test("independent WCAG math catches old mutedSoft normal-text regression", () => {
    assert.equal(contrast("#000000", "#ffffff"), 21);
    assert.equal(contrast("#ffffff", "#ffffff"), 1);
    assert.ok(contrast("#859196", "#fffdfa") < 4.5);
  });
  test("actual emitted soft role rejects the historical #859196 regression", () => {
    const html = renderMail(fullContent);
    const affected = /(<(?:p|td)[^>]*class="[^"]*lb-soft[^"]*"[^>]*style="[^"]*color:)(#[a-f\d]{6})/gi;
    assert.ok(affected.test(html), "real renderer exposes soft roles"); affected.lastIndex = 0;
    const regressed = html.replace(affected, "$1#859196");
    const failures = inspectMail(regressed, "light").records.filter(r => r.foreground === "#859196" && r.ratio < r.minimum);
    assert.ok(failures.some(r => r.text.includes("motivo del mensaje")), "real footer reason regression detected");
  });
  for (const mode of ["light", "dark", "ogsc"] as const) for (const tone of ["accent", "success", "warning", "neutral"] as const) {
    test(`actual emitted ${mode} text contrast — status ${tone}, footer, notes, links and CTA`, () => {
      const html = renderMail({ ...fullContent, status: { label: `Estado ${tone}`, tone } });
      const { records } = inspectMail(html, mode);
      assert.ok(records.some(r => r.text.includes("motivo del mensaje")), "footer reason covered");
      assert.ok(records.some(r => r.text.includes("Nota de contexto")), "note covered");
      assert.ok(records.some(r => r.node.tag === "a"), "links covered");
      const failures = records.filter(r => r.ratio < r.minimum);
      assert.deepEqual(failures.map(r => ({ text: r.text.slice(0, 90), foreground: r.foreground, background: r.background, ratio: r.ratio.toFixed(3), required: r.minimum })), [], `${mode}/${tone}: real emitted text pairs below WCAG threshold`);
    });
  }
}
