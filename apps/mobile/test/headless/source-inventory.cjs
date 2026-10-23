const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');

function scan(root, ts = require('typescript')) {
  const files = ['App.tsx'];
  function walk(directory) {
    for (const entry of fs.readdirSync(path.join(root, directory), {withFileTypes:true})) {
      if (entry.name === '__tests__' || entry.name === '__mocks__') continue;
      const file = `${directory}/${entry.name}`;
      if (entry.isDirectory()) walk(file);
      else if (/\.tsx?$/.test(file) && !/\.d\.ts$/.test(file)) files.push(file);
    }
  }
  walk('src');
  const entries = [];
  const printer = ts.createPrinter({removeComments:true});
  for (const file of files.sort()) {
    const source = ts.createSourceFile(file, fs.readFileSync(path.join(root, file), 'utf8'), ts.ScriptTarget.Latest, true);
    const add = (kind, name, node) => {
      const body = printer.printNode(ts.EmitHint.Unspecified, node, source).replace(/\r\n/g, '\n');
      entries.push({file,kind,name,hash:crypto.createHash('sha256').update(body).digest('hex')});
    };
    function visit(node) {
      const exported = node.modifiers?.some(modifier => modifier.kind === ts.SyntaxKind.ExportKeyword);
      if (exported && (ts.isFunctionDeclaration(node) || ts.isClassDeclaration(node))) add('export', node.name?.text ?? 'default', node);
      if (exported && ts.isVariableStatement(node)) for (const declaration of node.declarationList.declarations) {
        if (declaration.initializer && (ts.isArrowFunction(declaration.initializer) || ts.isFunctionExpression(declaration.initializer))) {
          add('export', declaration.name.getText(source), declaration);
        }
      }
      if (ts.isExportDeclaration(node)) add('export-alias', node.exportClause?.getText(source) ?? '*', node);
      if (ts.isJsxAttribute(node) && /^on[A-Z]/.test(node.name.getText(source))) add('callback', node.name.getText(source), node);
      if (ts.isCallExpression(node)) {
        const name = node.expression.getText(source);
        if (/(^|\.)(useEffect|useLayoutEffect|useFocusEffect|addEventListener|addListener|defineTask|runUiAction)$/.test(name)) add('lifecycle', name, node);
      }
      ts.forEachChild(node, visit);
    }
    visit(source);
  }
  return entries;
}

function compare(expected, actual) {
  const key = entry => JSON.stringify(entry);
  const counts = entries => {
    const values = new Map();
    for (const entry of entries) values.set(key(entry), (values.get(key(entry)) ?? 0) + 1);
    return values;
  };
  const before = counts(expected);
  const after = counts(actual);
  const removed = [...before].filter(([entry,count]) => (after.get(entry) ?? 0) < count).map(([entry]) => JSON.parse(entry));
  const added = [...after].filter(([entry,count]) => (before.get(entry) ?? 0) < count).map(([entry]) => JSON.parse(entry));
  return {added,removed};
}

exports.scan = scan;
exports.compare = compare;
