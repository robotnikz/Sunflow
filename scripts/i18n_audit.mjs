import fs from 'node:fs';
import path from 'node:path';

let ts = null;
try {
	const mod = await import('typescript');
	ts = mod.default ?? mod;
} catch {
	// TypeScript is optional for this script; if unavailable, we fall back to regex heuristics.
}

const root = process.cwd();

const EXCLUDED_DIRS = new Set([
	'node_modules',
	'dist',
	'data',
	'sunflow-data',
	'test-results',
	'.git',
]);

const INCLUDE_DIRS = ['components', 'services'];
const INCLUDE_FILES = ['App.tsx', 'index.tsx'];

function walk(dir, out = []) {
	for (const ent of fs.readdirSync(dir, { withFileTypes: true })) {
		if (ent.isDirectory()) {
			if (EXCLUDED_DIRS.has(ent.name)) continue;
			walk(path.join(dir, ent.name), out);
			continue;
		}
		out.push(path.join(dir, ent.name));
	}
	return out;
}

function norm(text) {
	return text.replace(/\s+/g, ' ').trim();
}

const VISIBLE_ATTRS = new Set(['title', 'aria-label', 'placeholder', 'alt']);

function shouldIgnoreHardcodedText(val) {
	const text = norm(val);
	if (!text) return true;
	if (text.length < 2) return true;
	if (/^[\d\W]+$/.test(text)) return true;
	if (/^(?:W|kW|kWh|%|°C)$/i.test(text)) return true;
	if (/^(?:https?:\/\/|#)/.test(text)) return true;
	return false;
}

function unescapeTsSingleQuoted(text) {
	// Best-effort unescape for keys defined in single-quoted TS strings.
	// We only need to handle the escapes we actually use in this repo.
	return text
		.replace(/\\'/g, "'")
		.replace(/\\n/g, '\n')
		.replace(/\\t/g, '\t')
		.replace(/\\\\/g, '\\');
}

function rel(p) {
	return path.relative(root, p).replace(/\\/g, '/');
}

function extractDeKeys(i18nText) {
	// Best-effort: extract keys of the DE map in services/i18n.tsx.
	const idx = i18nText.indexOf('const DE');
	if (idx < 0) return new Set();
	const after = i18nText.slice(idx);
	const keys = new Set();
	// Matches: 'Some key': 'Some value',
	const re = /^\s*'((?:\\'|[^'])*)':\s*'((?:\\'|[^'])*)',\s*$/gm;
	let m;
	while ((m = re.exec(after))) keys.add(unescapeTsSingleQuoted(m[1]));
	return keys;
}

const files = [];
for (const d of INCLUDE_DIRS) {
	const p = path.join(root, d);
	if (fs.existsSync(p)) files.push(...walk(p));
}
for (const f of INCLUDE_FILES) {
	const p = path.join(root, f);
	if (fs.existsSync(p)) files.push(p);
}

const tsxFiles = files.filter((f) => f.endsWith('.tsx'));

const i18nPath = path.join(root, 'services', 'i18n.tsx');
const i18nText = fs.readFileSync(i18nPath, 'utf8');
const deKeys = extractDeKeys(i18nText);

const usedKeys = new Map();
const hardcoded = [];

// t('...') / t("...")
const tCall = /\bt\(\s*(['"])(.*?)\1\s*\)/g;
// Fallback regex-based scan (used only when TypeScript AST parsing isn't available).
const literalAttr = /\b(?:title|aria-label|placeholder|alt)=\"([^\"]+)\"/g;
const jsxText = />\s*([^<{][^<{]{1,120}?)\s*</g;

for (const filePath of tsxFiles) {
	const txt = fs.readFileSync(filePath, 'utf8');

	tCall.lastIndex = 0;
	let m;
	while ((m = tCall.exec(txt))) {
		const key = unescapeTsSingleQuoted(m[2]);
		if (!key) continue;
		usedKeys.set(key, (usedKeys.get(key) ?? 0) + 1);
	}

	if (ts) {
		const sourceFile = ts.createSourceFile(filePath, txt, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
		const add = (kind, text, pos) => {
			if (shouldIgnoreHardcodedText(text)) return;
			const { line } = sourceFile.getLineAndCharacterOfPosition(pos);
			hardcoded.push({ file: rel(filePath), kind, line: line + 1, text: norm(text) });
		};
		const visit = (node) => {
			if (node.kind === ts.SyntaxKind.JsxText) {
				add('jsx', node.getText(sourceFile), node.getStart(sourceFile));
			} else if (node.kind === ts.SyntaxKind.JsxExpression) {
				const expr = node.expression;
				if (expr && (ts.isStringLiteral(expr) || ts.isNoSubstitutionTemplateLiteral(expr))) {
					add('jsx-expr', expr.text, expr.getStart(sourceFile));
				}
			} else if (node.kind === ts.SyntaxKind.JsxAttribute) {
				const name = node.name?.text;
				if (name && VISIBLE_ATTRS.has(name) && node.initializer) {
					if (ts.isStringLiteral(node.initializer)) {
						add(`attr:${name}`, node.initializer.text, node.initializer.getStart(sourceFile));
					} else if (ts.isJsxExpression(node.initializer)) {
						const expr = node.initializer.expression;
						if (expr && (ts.isStringLiteral(expr) || ts.isNoSubstitutionTemplateLiteral(expr))) {
							add(`attr:${name}`, expr.text, expr.getStart(sourceFile));
						}
					}
				}
			}
			ts.forEachChild(node, visit);
		};
		visit(sourceFile);
	} else {
		literalAttr.lastIndex = 0;
		while ((m = literalAttr.exec(txt))) {
			const val = m[1];
			if (shouldIgnoreHardcodedText(val)) continue;
			hardcoded.push({ file: rel(filePath), kind: 'attr', text: norm(val) });
		}

		jsxText.lastIndex = 0;
		while ((m = jsxText.exec(txt))) {
			const val = m[1];
			if (val.includes('{') || val.includes('}')) continue;
			if (shouldIgnoreHardcodedText(val)) continue;
			hardcoded.push({ file: rel(filePath), kind: 'jsx', text: norm(val) });
		}
	}
}

const missingDe = [...usedKeys.keys()].filter((k) => !deKeys.has(k)).sort((a, b) => a.localeCompare(b));

console.log(`TSX files scanned: ${tsxFiles.length}`);
console.log(`t() keys used: ${usedKeys.size}`);
console.log(`DE keys: ${deKeys.size}`);
console.log(`Missing DE translations for used keys: ${missingDe.length}`);
for (const k of missingDe.slice(0, 200)) console.log(` - ${JSON.stringify(k)}`);
if (missingDe.length > 200) console.log(`... (${missingDe.length - 200} more)`);

console.log('\nPotential hardcoded UI strings (sample, may include false positives):');
for (const item of hardcoded.slice(0, 200)) {
	const loc = item.line ? `:${item.line}` : '';
	console.log(` - ${item.file}${loc} [${item.kind}] ${item.text}`);
}
if (hardcoded.length > 200) console.log(`... (${hardcoded.length - 200} more)`);