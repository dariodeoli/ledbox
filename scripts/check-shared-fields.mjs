#!/usr/bin/env node
/** #264: ningún campo visible se vuelve a implementar fuera del kit canónico. */
import ts from "typescript";
import { readdirSync, readFileSync } from "node:fs";
import { dirname, join, relative, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const BASE = "components/admin/AdminFields.tsx";
const UPLOAD_BASE = "components/admin/AdminUI.tsx";

function literal(node) {
  if (!node) return true;
  if (ts.isStringLiteral(node)) return node.text;
  if (ts.isJsxExpression(node) && node.expression) {
    const expression = node.expression;
    if (ts.isStringLiteral(expression) || ts.isNumericLiteral(expression)) return expression.text;
    if (expression.kind === ts.SyntaxKind.TrueKeyword) return true;
    if (expression.kind === ts.SyntaxKind.FalseKeyword) return false;
    if (ts.isPrefixUnaryExpression(expression) && expression.operator === ts.SyntaxKind.MinusToken && ts.isNumericLiteral(expression.operand)) return `-${expression.operand.text}`;
  }
  return undefined;
}

export function inspectSharedFields(path, source) {
  const normalizedPath = path.replaceAll("\\", "/");
  if (normalizedPath === BASE) return [];
  const tree = ts.createSourceFile(path, source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
  const findings = [];
  function visit(node) {
    if ((ts.isJsxOpeningElement(node) || ts.isJsxSelfClosingElement(node)) && ts.isIdentifier(node.tagName)) {
      const tag = node.tagName.text;
      if (["input", "select", "textarea"].includes(tag)) {
        const attributes = new Map(node.attributes.properties.filter(ts.isJsxAttribute).map((attribute) => [attribute.name.getText(tree), literal(attribute.initializer)]));
        const type = attributes.get("type") ?? "text";
        const spread = node.attributes.properties.some(ts.isJsxSpreadAttribute);
        // Transporte de formularios y trampas anti-bot no son campos visibles.
        // Las trampas deben ser reconocibles y quedar fuera del orden de Tab.
        const hidden = tag === "input" && type === "hidden" && !spread;
        const trap = tag === "input" && attributes.get("name") === "website" && attributes.get("tabIndex") === "-1" && attributes.get("autoComplete") === "off" && /^(cp-trap|honeypot|admin-honeypot)$/.test(attributes.get("className") ?? "") && !spread;
        // Los dos uploaders de identidad/CSV ya son primitivas compartidas.
        const upload = normalizedPath === UPLOAD_BASE && tag === "input" && type === "file";
        if (!hidden && !trap && !upload) {
          findings.push({ path: normalizedPath, line: tree.getLineAndCharacterOfPosition(node.getStart(tree)).line + 1, message: `<${tag}> visible fuera del kit: reutilizá AdminFields u owncoding-ui (#264)` });
        }
      }
    }
    ts.forEachChild(node, visit);
  }
  visit(tree);
  return findings;
}

function walk(directory) {
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const path = join(directory, entry.name);
    return entry.isDirectory() ? walk(path) : path.endsWith(".tsx") ? [path] : [];
  });
}

export function checkSharedFields(root = ROOT) {
  return ["app", "components"].flatMap((directory) => walk(join(root, directory))).flatMap((path) => inspectSharedFields(relative(root, path), readFileSync(path, "utf8")));
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  const findings = checkSharedFields();
  for (const finding of findings) console.error(`${finding.path}:${finding.line}: ${finding.message}`);
  if (findings.length) process.exitCode = 1;
  else console.log("Campos compartidos: sin controles visibles nativos fuera del kit en panel, tienda, portal, acceso e impresión.");
}
