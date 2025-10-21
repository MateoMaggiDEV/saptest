const defaultProgram = `* Ejemplo básico ABAP
DATA: lv_text TYPE string VALUE 'Hola mundo',
      lv_num  TYPE i VALUE 5.

WRITE: / 'Mensaje:', lv_text.
ADD 3 TO lv_num.
WRITE: / 'Resultado:', lv_num.`;

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

  const statements = preprocess(code);

  for (const statement of statements) {
    try {
      if (/^DATA\b/i.test(statement)) {
        handleData(statement, variables);
      } else if (/^WRITE\b/i.test(statement)) {
        handleWrite(statement, variables, outputLines);
      } else if (/^ADD\b/i.test(statement)) {
        handleAdd(statement, variables);
      } else if (/^SUBTRACT\b/i.test(statement)) {
        handleSubtract(statement, variables);
      } else if (/^CLEAR\b/i.test(statement)) {
        handleClear(statement, variables);
      } else if (/^[a-z_][\w-]*\s*=/.test(statement)) {
        handleAssignment(statement, variables);
      } else if (statement.trim().length === 0) {
        continue;
      } else {
        messages.push(`Instrucción no soportada: "${statement}"`);
      }
    } catch (error) {
      messages.push(error.message);
    }
  }

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

  return sanitized
    .split('.')
    .map((statement) => statement.replace(/\s+/g, ' ').trim())
    .filter(Boolean);
}

function handleData(statement, variables) {
  const body = statement.replace(/^DATA\s*:?/i, '').trim();
  if (!body) {
    throw new Error('Declaración DATA incompleta.');
  }

  const declarations = body.split(',').map((part) => part.trim()).filter(Boolean);

  for (const declaration of declarations) {
    const match = declaration.match(/^(?<name>[a-z_][\w-]*)\s+TYPE\s+(?<type>i|string)(?:\s+VALUE\s+(?<value>.+))?$/i);
    if (!match) {
      throw new Error(`No se pudo interpretar la declaración: "${declaration}"`);
    }

    const { name, type } = match.groups;
    const normalizedType = type.toLowerCase();
    let value;

    if (match.groups.value !== undefined) {
      const evaluation = evaluateExpression(match.groups.value, variables);
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
  variable.value = variable.type === 'i' ? 0 : '';
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
