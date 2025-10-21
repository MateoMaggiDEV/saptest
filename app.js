const defaultProgram = `* Ejemplo de variables simples e internas
DATA: lv_text TYPE string VALUE 'Hola mundo',
      lv_num  TYPE i VALUE 5,
      lt_texts TYPE TABLE OF string.

APPEND lv_text TO lt_texts.
APPEND 'Adiós' TO lt_texts.

WRITE: / 'Mensaje:', lv_text.
ADD 3 TO lv_num.
WRITE: / 'Resultado:', lv_num.

LOOP AT lt_texts INTO lv_text.
  WRITE: / 'Tabla:', lv_text.
ENDLOOP.`;

const editor = document.getElementById('abapEditor');
const outputEl = document.getElementById('output');
const messagesEl = document.getElementById('messages');
const runButton = document.getElementById('runButton');
const resetButton = document.getElementById('resetButton');

editor.value = defaultProgram;

runButton.addEventListener('click', () => {
  const code = editor.value;
  const result = executeAbap(code);
  outputEl.textContent = result.output;
  messagesEl.textContent = result.messages.join('\n');
});

resetButton.addEventListener('click', () => {
  editor.value = defaultProgram;
  outputEl.textContent = '';
  messagesEl.textContent = '';
});

function executeAbap(code) {
  const variables = new Map();
  const outputLines = [''];
  const messages = [];

  let statements;
  try {
    statements = preprocess(code);
  } catch (error) {
    return { output: '', messages: [error.message] };
  }

  executeSequence(statements, variables, outputLines, messages);

  const printableOutput = outputLines
    .filter((line, index, arr) => !(index === arr.length - 1 && line === ''))
    .map((line) => line.trimEnd())
    .join('\n');

  return { output: printableOutput, messages };
}

function preprocess(code) {
  const sanitized = code
    .split('\n')
    .map((line) => {
      const commentIdx = line.indexOf('"');
      if (commentIdx !== -1) {
        line = line.slice(0, commentIdx);
      }
      const trimmed = line.trim();
      if (trimmed.startsWith('*')) {
        return '';
      }
      return line;
    })
    .join('\n');

  const tokens = sanitized
    .split('.')
    .map((statement) => statement.replace(/\s+/g, ' ').trim())
    .filter(Boolean);

  const root = { type: 'block', children: [] };
  const stack = [{ node: root, branch: 'children' }];

  const getActiveChildren = (frame) => {
    if (frame.node.type === 'block') {
      return frame.node.children;
    }
    if (frame.node.type === 'if') {
      if (frame.branch.type === 'clause') {
        return frame.node.clauses[frame.branch.index].statements;
      }
      if (frame.branch === 'else') {
        return frame.node.elseStatements;
      }
    }
    if (frame.node.type === 'loop') {
      return frame.node.body;
    }
    throw new Error('Estado interno inválido durante el preprocesado.');
  };

  const ensureIfFrame = () => {
    if (stack.length <= 1) {
      throw new Error('Se encontró un bloque IF/ELSE sin apertura correspondiente.');
    }
    const frame = stack[stack.length - 1];
    if (frame.node.type !== 'if') {
      throw new Error('La sentencia de control no coincide con un bloque IF activo.');
    }
    return frame;
  };

  const closeLoop = (keyword, closing) => {
    if (stack.length <= 1) {
      throw new Error(`${closing} sin bloque de apertura.`);
    }
    const frame = stack[stack.length - 1];
    if (frame.node.type !== 'loop') {
      throw new Error(`${closing} no coincide con el bloque abierto actual.`);
    }
    if (frame.node.keyword !== keyword) {
      throw new Error(`${closing} no coincide con el bloque ${keyword} abierto más reciente.`);
    }
    stack.pop();
  };

  const closeBlock = (type, closingKeyword) => {
    if (stack.length <= 1) {
      throw new Error(`${closingKeyword} sin bloque de apertura.`);
    }
    const frame = stack[stack.length - 1];
    if (frame.node.type !== type) {
      throw new Error(`${closingKeyword} no coincide con el bloque abierto actual.`);
    }
    stack.pop();
  };

  for (const token of tokens) {
    const upper = token.toUpperCase();
    const currentFrame = stack[stack.length - 1];

    if (/^IF\b/.test(upper)) {
      const condition = token
        .replace(/^IF\s*/i, '')
        .replace(/\s+THEN$/i, '')
        .trim();
      if (!condition) {
        throw new Error('La sentencia IF requiere una condición.');
      }
      const node = {
        type: 'if',
        header: token,
        clauses: [{ condition, statements: [] }],
        elseStatements: [],
      };
      getActiveChildren(currentFrame).push(node);
      stack.push({ node, branch: { type: 'clause', index: 0 } });
      continue;
    }

    if (/^ELSEIF\b/.test(upper)) {
      const frame = ensureIfFrame();
      if (frame.branch === 'else') {
        throw new Error('ELSEIF no puede aparecer después de un ELSE.');
      }
      const condition = token
        .replace(/^ELSEIF\s*/i, '')
        .replace(/\s+THEN$/i, '')
        .trim();
      if (!condition) {
        throw new Error('La sentencia ELSEIF requiere una condición.');
      }
      const clause = { condition, statements: [] };
      frame.node.clauses.push(clause);
      frame.branch = { type: 'clause', index: frame.node.clauses.length - 1 };
      continue;
    }

    if (upper === 'ELSE') {
      const frame = ensureIfFrame();
      if (frame.branch === 'else') {
        throw new Error('El bloque ELSE ya fue definido para este IF.');
      }
      if (frame.node.elseStatements.length) {
        throw new Error('El bloque ELSE ya fue definido para este IF.');
      }
      frame.branch = 'else';
      continue;
    }

    if (upper === 'ENDIF') {
      closeBlock('if', 'ENDIF');
      continue;
    }

    if (/^DO\b/.test(upper)) {
      const body = token.replace(/^DO\s*/i, '').trim();
      let countExpression = null;
      if (body.length) {
        const match = body.match(/^(.*)\bTIMES$/i);
        if (!match) {
          throw new Error('Solo se admite la forma DO <n> TIMES en esta versión.');
        }
        countExpression = match[1].trim();
        if (!countExpression) {
          throw new Error('DO TIMES requiere una expresión numérica.');
        }
      }
      const node = {
        type: 'loop',
        keyword: 'DO',
        header: token,
        loopType: 'count',
        countExpression,
        body: [],
      };
      getActiveChildren(currentFrame).push(node);
      stack.push({ node, branch: 'body' });
      continue;
    }

    if (/^LOOP\s+AT\b/.test(upper)) {
      const match = token.match(/^LOOP\s+AT\s+([a-z_][\w-]*)\s+INTO\s+([a-z_][\w-]*)$/i);
      if (!match) {
        throw new Error('Esta versión solo admite LOOP AT <tabla> INTO <variable>.');
      }
      const node = {
        type: 'loop',
        keyword: 'LOOP',
        header: token,
        loopType: 'table',
        tableName: match[1].toLowerCase(),
        tableIdentifier: match[1],
        intoName: match[2].toLowerCase(),
        intoIdentifier: match[2],
        body: [],
      };
      getActiveChildren(currentFrame).push(node);
      stack.push({ node, branch: 'body' });
      continue;
    }

    if (/^LOOP\b/.test(upper)) {
      const body = token.replace(/^LOOP\s*/i, '').trim();
      if (!body) {
        throw new Error('LOOP requiere una expresión. Use LOOP <n> TIMES.');
      }
      const match = body.match(/^(.*)\bTIMES$/i);
      if (!match) {
        throw new Error('Solo se admite la forma LOOP <n> TIMES en esta versión simplificada.');
      }
      const countExpression = match[1].trim();
      if (!countExpression) {
        throw new Error('LOOP TIMES requiere una expresión numérica.');
      }
      const node = {
        type: 'loop',
        keyword: 'LOOP',
        header: token,
        loopType: 'count',
        countExpression,
        body: [],
      };
      getActiveChildren(currentFrame).push(node);
      stack.push({ node, branch: 'body' });
      continue;
    }

    if (upper === 'ENDDO') {
      closeLoop('DO', 'ENDDO');
      continue;
    }

    if (upper === 'ENDLOOP') {
      closeLoop('LOOP', 'ENDLOOP');
      continue;
    }

    getActiveChildren(currentFrame).push({ type: 'statement', raw: token });
  }

  if (stack.length !== 1) {
    const frame = stack[stack.length - 1];
    if (frame.node.type === 'if') {
      throw new Error(`Falta ENDIF para el bloque IF iniciado con "${frame.node.header}".`);
    }
    if (frame.node.type === 'loop') {
      throw new Error(`Falta sentencia de cierre para el bloque ${frame.node.keyword} iniciado con "${frame.node.header}".`);
    }
    throw new Error('Faltan sentencias de cierre.');
  }

  return root.children;
}

function executeSequence(nodes, variables, outputLines, messages) {
  for (const node of nodes) {
    try {
      processNode(node, variables, outputLines, messages);
    } catch (error) {
      messages.push(error.message);
    }
  }
}

function processNode(node, variables, outputLines, messages) {
  if (node.type === 'statement') {
    executeStatement(node.raw, variables, outputLines);
    return;
  }
  if (node.type === 'if') {
    handleIf(node, variables, outputLines, messages);
    return;
  }
  if (node.type === 'loop') {
    handleLoop(node, variables, outputLines, messages);
    return;
  }
  throw new Error(`Tipo de nodo desconocido: ${node.type}`);
}

function executeStatement(statement, variables, outputLines) {
  if (/^DATA\b/i.test(statement)) {
    handleData(statement, variables);
    return;
  }
  if (/^WRITE\b/i.test(statement)) {
    handleWrite(statement, variables, outputLines);
    return;
  }
  if (/^ADD\b/i.test(statement)) {
    handleAdd(statement, variables);
    return;
  }
  if (/^SUBTRACT\b/i.test(statement)) {
    handleSubtract(statement, variables);
    return;
  }
  if (/^CLEAR\b/i.test(statement)) {
    handleClear(statement, variables);
    return;
  }
  if (/^APPEND\b/i.test(statement)) {
    handleAppend(statement, variables);
    return;
  }
  if (/^[a-z_][\w-]*\s*=/.test(statement)) {
    handleAssignment(statement, variables);
    return;
  }
  if (statement.trim().length === 0) {
    return;
  }
  throw new Error(`Instrucción no soportada: "${statement}"`);
}

function handleIf(node, variables, outputLines, messages) {
  for (const clause of node.clauses) {
    if (evaluateCondition(clause.condition, variables)) {
      executeSequence(clause.statements, variables, outputLines, messages);
      return;
    }
  }

  if (node.elseStatements.length) {
    executeSequence(node.elseStatements, variables, outputLines, messages);
  }
}

function handleLoop(node, variables, outputLines, messages) {
  if (node.loopType === 'table') {
    const table = variables.get(node.tableName);
    if (!table) {
      throw new Error(`Tabla interna "${node.tableIdentifier}" no declarada.`);
    }
    if (table.type !== 'table') {
      throw new Error(`"${node.tableIdentifier}" no es una tabla interna.`);
    }

    const target = variables.get(node.intoName);
    if (!target) {
      throw new Error(`Variable "${node.intoIdentifier}" no declarada para LOOP AT.`);
    }
    if (target.type === 'table') {
      throw new Error('LOOP AT INTO no admite asignar el resultado a otra tabla interna.');
    }

    for (const entry of table.value) {
      if (table.elementType === 'i') {
        if (target.type !== 'i') {
          throw new Error('El destino del LOOP AT debe ser de tipo I para tablas numéricas.');
        }
        target.value = entry.value;
      } else {
        if (target.type === 'i') {
          throw new Error('El destino del LOOP AT no puede ser numérico para tablas de texto.');
        }
        target.value = entry.value;
      }
      executeSequence(node.body, variables, outputLines, messages);
    }
    return;
  }

  if (!node.countExpression) {
    throw new Error(`${node.keyword} sin TIMES no está soportado en esta versión.`);
  }

  const countEvaluation = evaluateExpression(node.countExpression, variables);
  if (countEvaluation.type !== 'number') {
    throw new Error(`El número de iteraciones para ${node.keyword} debe ser numérico.`);
  }
  const iterations = countEvaluation.value;
  if (!Number.isInteger(iterations) || iterations < 0) {
    throw new Error(`El número de iteraciones para ${node.keyword} debe ser un entero positivo.`);
  }

  for (let i = 0; i < iterations; i += 1) {
    executeSequence(node.body, variables, outputLines, messages);
  }
}

function evaluateCondition(condition, variables) {
  const trimmed = condition.trim();
  if (!trimmed) {
    throw new Error('La condición IF no puede estar vacía.');
  }

  const comparisonMatch = trimmed.match(/^(.*?)(=|<>|>=|<=|>|<)(.*)$/);
  if (comparisonMatch) {
    const leftExpression = comparisonMatch[1].trim();
    const operator = comparisonMatch[2];
    const rightExpression = comparisonMatch[3].trim();
    if (!leftExpression || !rightExpression) {
      throw new Error('La comparación IF requiere operandos a ambos lados del operador.');
    }

    const leftEvaluation = evaluateExpression(leftExpression, variables);
    const rightEvaluation = evaluateExpression(rightExpression, variables);

    const bothNumeric = leftEvaluation.type === 'number' && rightEvaluation.type === 'number';

    const [leftComparable, rightComparable] = bothNumeric
      ? [leftEvaluation.value, rightEvaluation.value]
      : [convertToString(leftEvaluation), convertToString(rightEvaluation)];

    switch (operator) {
      case '=':
        return leftComparable === rightComparable;
      case '<>':
        return leftComparable !== rightComparable;
      case '>':
        if (!bothNumeric) {
          throw new Error('El operador > solo admite números.');
        }
        return leftComparable > rightComparable;
      case '<':
        if (!bothNumeric) {
          throw new Error('El operador < solo admite números.');
        }
        return leftComparable < rightComparable;
      case '>=':
        if (!bothNumeric) {
          throw new Error('El operador >= solo admite números.');
        }
        return leftComparable >= rightComparable;
      case '<=':
        if (!bothNumeric) {
          throw new Error('El operador <= solo admite números.');
        }
        return leftComparable <= rightComparable;
      default:
        throw new Error(`Operador de comparación no soportado: ${operator}`);
    }
  }

  const evaluation = evaluateExpression(trimmed, variables);
  if (evaluation.type === 'number') {
    return evaluation.value !== 0;
  }
  if (evaluation.type === 'boolean') {
    return evaluation.value;
  }
  return convertToString(evaluation).length > 0;
}

function handleData(statement, variables) {
  const body = statement.replace(/^DATA\s*:?/i, '').trim();
  if (!body) {
    throw new Error('Declaración DATA incompleta.');
  }

  const declarations = body.split(',').map((part) => part.trim()).filter(Boolean);

  for (const declaration of declarations) {
    const match = declaration.match(/^(?<name>[a-z_][\w-]*)\s+TYPE\s+(?<definition>.+)$/i);
    if (!match) {
      throw new Error(`No se pudo interpretar la declaración: "${declaration}"`);
    }

    const name = match.groups.name;
    const definition = match.groups.definition.trim();

    const tableMatch = definition.match(/^(?:(?:STANDARD|HASHED|SORTED)\s+)?TABLE\s+OF\s+(?<element>i|string)(?:\s+WITH\s+EMPTY\s+KEY)?$/i);
    if (tableMatch) {
      const elementType = tableMatch.groups.element.toLowerCase();
      variables.set(name.toLowerCase(), { type: 'table', elementType, value: [] });
      continue;
    }

    const simpleMatch = definition.match(/^(?<type>i|string)(?:\s+VALUE\s+(?<value>.+))?$/i);
    if (!simpleMatch) {
      throw new Error(`No se pudo interpretar la declaración: "${declaration}"`);
    }

    const normalizedType = simpleMatch.groups.type.toLowerCase();
    let value;

    if (simpleMatch.groups.value !== undefined) {
      const evaluation = evaluateExpression(simpleMatch.groups.value, variables);
      if (normalizedType === 'i') {
        if (evaluation.type !== 'number') {
          throw new Error(`El valor inicial de ${name} debe ser numérico.`);
        }
        value = evaluation.value;
      } else {
        value = convertToString(evaluation);
      }
    } else {
      value = normalizedType === 'i' ? 0 : '';
    }

    variables.set(name.toLowerCase(), { type: normalizedType, value });
  }
}

function handleWrite(statement, variables, outputLines) {
  let body = statement.replace(/^WRITE\s*/i, '');
  body = body.replace(/^:/, '').trim();

  if (!body) {
    throw new Error('WRITE necesita contenido.');
  }

  const segments = body.split(',').map((segment) => segment.trim()).filter(Boolean);

  for (let segment of segments) {
    let newline = false;
    if (segment.startsWith('/')) {
      newline = true;
      segment = segment.slice(1).trim();
    }

    const evaluation = evaluateExpression(segment, variables);
    appendOutput(convertToString(evaluation), newline, outputLines);
  }
}

function appendOutput(value, newline, outputLines) {
  if (!outputLines.length) {
    outputLines.push('');
  }

  if (newline) {
    outputLines.push('');
  }

  const index = outputLines.length - 1;
  if (outputLines[index]) {
    outputLines[index] += outputLines[index].endsWith(' ') ? '' : ' ';
  }
  outputLines[index] += value;
}

function handleAdd(statement, variables) {
  const match = statement.match(/^ADD\s+(.+)\s+TO\s+([a-z_][\w-]*)$/i);
  if (!match) {
    throw new Error(`Sintaxis ADD inválida: "${statement}"`);
  }

  const amountEvaluation = evaluateExpression(match[1], variables);
  if (amountEvaluation.type !== 'number') {
    throw new Error('ADD requiere un valor numérico.');
  }
  const amount = amountEvaluation.value;
  const targetName = match[2].toLowerCase();
  const target = variables.get(targetName);

  if (!target) {
    throw new Error(`Variable "${match[2]}" no declarada.`);
  }
  if (target.type !== 'i') {
    throw new Error('ADD solo admite variables de tipo I.');
  }

  target.value += amount;
}

function handleSubtract(statement, variables) {
  const match = statement.match(/^SUBTRACT\s+(.+)\s+FROM\s+([a-z_][\w-]*)$/i);
  if (!match) {
    throw new Error(`Sintaxis SUBTRACT inválida: "${statement}"`);
  }

  const amountEvaluation = evaluateExpression(match[1], variables);
  if (amountEvaluation.type !== 'number') {
    throw new Error('SUBTRACT requiere un valor numérico.');
  }
  const amount = amountEvaluation.value;
  const targetName = match[2].toLowerCase();
  const target = variables.get(targetName);

  if (!target) {
    throw new Error(`Variable "${match[2]}" no declarada.`);
  }
  if (target.type !== 'i') {
    throw new Error('SUBTRACT solo admite variables de tipo I.');
  }

  target.value -= amount;
}

function handleClear(statement, variables) {
  const match = statement.match(/^CLEAR\s+([a-z_][\w-]*)$/i);
  if (!match) {
    throw new Error(`Sintaxis CLEAR inválida: "${statement}"`);
  }
  const name = match[1].toLowerCase();
  const variable = variables.get(name);
  if (!variable) {
    throw new Error(`Variable "${match[1]}" no declarada.`);
  }
  if (variable.type === 'table') {
    variable.value = [];
    return;
  }
  variable.value = variable.type === 'i' ? 0 : '';
}

function handleAppend(statement, variables) {
  const match = statement.match(/^APPEND\s+(.+)\s+TO\s+([a-z_][\w-]*)$/i);
  if (!match) {
    throw new Error(`Sintaxis APPEND inválida: "${statement}"`);
  }

  const valueEvaluation = evaluateExpression(match[1], variables);
  const tableName = match[2].toLowerCase();
  const table = variables.get(tableName);

  if (!table) {
    throw new Error(`Tabla interna "${match[2]}" no declarada.`);
  }
  if (table.type !== 'table') {
    throw new Error(`"${match[2]}" no es una tabla interna.`);
  }

  if (table.elementType === 'i') {
    if (valueEvaluation.type !== 'number') {
      throw new Error('APPEND requiere un valor numérico para tablas de tipo I.');
    }
    table.value.push({ type: 'number', value: valueEvaluation.value });
    return;
  }

  table.value.push({ type: 'string', value: convertToString(valueEvaluation) });
}

function handleAssignment(statement, variables) {
  const match = statement.match(/^([a-z_][\w-]*)\s*=\s*(.+)$/i);
  if (!match) {
    throw new Error(`No se pudo interpretar la asignación: "${statement}"`);
  }

  const name = match[1].toLowerCase();
  const variable = variables.get(name);
  if (!variable) {
    throw new Error(`Variable "${match[1]}" no declarada.`);
  }

  if (variable.type === 'table') {
    throw new Error('La asignación directa a tablas internas no está soportada en esta versión.');
  }

  const evaluation = evaluateExpression(match[2], variables);
  if (variable.type === 'i') {
    if (evaluation.type !== 'number') {
      throw new Error(`La variable ${match[1]} requiere un valor numérico.`);
    }
    variable.value = evaluation.value;
  } else {
    variable.value = convertToString(evaluation);
  }
}

function evaluateExpression(expression, variables) {
  const tokens = tokenizeExpression(expression);
  if (!tokens.length) {
    throw new Error('Expresión vacía.');
  }

  let position = 0;

  function peek() {
    return tokens[position];
  }

  function consume() {
    return tokens[position++];
  }

  function matchOperator(...operators) {
    const token = peek();
    if (token && token.type === 'operator' && operators.includes(token.value)) {
      position++;
      return token.value;
    }
    return null;
  }

  function expectClosingParen() {
    const token = peek();
    if (!token || token.type !== 'paren' || token.value !== ')') {
      throw new Error('Falta paréntesis de cierre.');
    }
    consume();
  }

  function parsePrimary() {
    const token = peek();
    if (!token) {
      throw new Error('Expresión incompleta.');
    }

    if (token.type === 'number' || token.type === 'string') {
      consume();
      return { type: token.type === 'number' ? 'number' : 'string', value: token.value };
    }

    if (token.type === 'identifier') {
      consume();
      const variable = variables.get(token.value.toLowerCase());
      if (!variable) {
        throw new Error(`Variable "${token.value}" no declarada.`);
      }
      if (variable.type === 'i') {
        return { type: 'number', value: Number(variable.value) };
      }
      if (variable.type === 'table') {
        throw new Error('Las tablas internas no pueden utilizarse en expresiones.');
      }
      return { type: 'string', value: String(variable.value) };
    }

    if (token.type === 'paren' && token.value === '(') {
      consume();
      const value = parseComparison();
      expectClosingParen();
      return value;
    }

    if (token.type === 'paren' && token.value === ')') {
      throw new Error('Paréntesis de cierre inesperado.');
    }

    throw new Error(`Token inesperado en la expresión: "${token.value}"`);
  }

  function parseUnary() {
    const operator = matchOperator('+', '-');
    if (operator) {
      const operand = parseUnary();
      if (operand.type !== 'number') {
        throw new Error(`El operador unario ${operator} solo admite números.`);
      }
      return { type: 'number', value: operator === '-' ? -operand.value : operand.value };
    }
    return parsePrimary();
  }

  function parseMultiplicative() {
    let left = parseUnary();
    while (true) {
      const operator = matchOperator('*', '/');
      if (!operator) {
        break;
      }
      const right = parseUnary();
      if (left.type !== 'number' || right.type !== 'number') {
        throw new Error('Las operaciones aritméticas solo admiten números.');
      }
      if (operator === '*') {
        left = { type: 'number', value: left.value * right.value };
      } else {
        left = { type: 'number', value: left.value / right.value };
      }
    }
    return left;
  }

  function parseAdditive() {
    let left = parseMultiplicative();
    while (true) {
      const operator = matchOperator('+', '-');
      if (!operator) {
        break;
      }
      const right = parseMultiplicative();
      if (left.type !== 'number' || right.type !== 'number') {
        throw new Error('Las operaciones aritméticas solo admiten números.');
      }
      left = {
        type: 'number',
        value: operator === '+' ? left.value + right.value : left.value - right.value,
      };
    }
    return left;
  }

  function parseComparison() {
    let left = parseAdditive();
    const operator = matchOperator('=', '<>', '>', '<');
    if (!operator) {
      return left;
    }

    const right = parseAdditive();

    if (operator === '=' || operator === '<>') {
      if (left.type !== right.type) {
        throw new Error('La comparación requiere operandos del mismo tipo.');
      }
      const result = operator === '=' ? left.value === right.value : left.value !== right.value;
      return { type: 'boolean', value: result };
    }

    if (left.type !== 'number' || right.type !== 'number') {
      throw new Error(`El operador ${operator} solo admite números.`);
    }

    const result = operator === '>' ? left.value > right.value : left.value < right.value;
    return { type: 'boolean', value: result };
  }

  const result = parseComparison();
  if (position < tokens.length) {
    throw new Error('No se pudo interpretar la expresión completa.');
  }
  return result;
}

function tokenizeExpression(expression) {
  const tokens = [];
  let index = 0;

  const trimmed = expression.trim();
  if (!trimmed) {
    return tokens;
  }

  function isDigit(char) {
    return /[0-9]/.test(char);
  }

  function isIdentifierStart(char) {
    return /[a-zA-Z_]/.test(char);
  }

  function isIdentifierPart(char) {
    return /[a-zA-Z0-9_-]/.test(char);
  }

  while (index < expression.length) {
    const char = expression[index];

    if (/\s/.test(char)) {
      index += 1;
      continue;
    }

    if (char === "'" || char === '`') {
      const quote = char;
      index += 1;
      let value = '';
      let closed = false;
      while (index < expression.length) {
        const current = expression[index];
        if (current === quote) {
          closed = true;
          index += 1;
          break;
        }
        value += current;
        index += 1;
      }
      if (!closed) {
        throw new Error('Literal de cadena sin cerrar.');
      }
      tokens.push({ type: 'string', value });
      continue;
    }

    if (isDigit(char) || (char === '.' && isDigit(expression[index + 1] || ''))) {
      const start = index;
      let hasDot = char === '.';
      index += 1;
      while (index < expression.length) {
        const current = expression[index];
        if (current === '.') {
          if (hasDot) {
            break;
          }
          const next = expression[index + 1];
          if (!isDigit(next || '')) {
            break;
          }
          hasDot = true;
          index += 1;
          continue;
        }
        if (!isDigit(current)) {
          break;
        }
        index += 1;
      }
      const numericValue = Number(expression.slice(start, index));
      if (Number.isNaN(numericValue)) {
        throw new Error(`Número inválido en la expresión: "${expression.slice(start, index)}"`);
      }
      tokens.push({ type: 'number', value: numericValue });
      continue;
    }

    if (isIdentifierStart(char)) {
      const start = index;
      index += 1;
      while (index < expression.length && isIdentifierPart(expression[index])) {
        index += 1;
      }
      const identifier = expression.slice(start, index);
      tokens.push({ type: 'identifier', value: identifier });
      continue;
    }

    if (char === '+' || char === '-' || char === '*' || char === '/') {
      tokens.push({ type: 'operator', value: char });
      index += 1;
      continue;
    }

    if (char === '(' || char === ')') {
      tokens.push({ type: 'paren', value: char });
      index += 1;
      continue;
    }

    if (char === '=') {
      if (expression[index + 1] === '=') {
        throw new Error('Operador no soportado: ==');
      }
      tokens.push({ type: 'operator', value: '=' });
      index += 1;
      continue;
    }

    if (char === '<') {
      const next = expression[index + 1];
      if (next === '>') {
        tokens.push({ type: 'operator', value: '<>' });
        index += 2;
        continue;
      }
      if (next === '=') {
        throw new Error('Operador no soportado: <=');
      }
      tokens.push({ type: 'operator', value: '<' });
      index += 1;
      continue;
    }

    if (char === '>') {
      if (expression[index + 1] === '=') {
        throw new Error('Operador no soportado: >=');
      }
      tokens.push({ type: 'operator', value: '>' });
      index += 1;
      continue;
    }

    if (char === '!') {
      if (expression[index + 1] === '=') {
        throw new Error('Operador no soportado: !=');
      }
      throw new Error('Operador no soportado: !');
    }

    throw new Error(`Carácter no reconocido en la expresión: "${char}"`);
  }

  return tokens;
}

function convertToString(evaluation) {
  if (evaluation.type === 'boolean') {
    return evaluation.value ? 'TRUE' : 'FALSE';
  }
  return String(evaluation.value);
}
