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
    let value = match.groups.value ? evaluateExpression(match.groups.value, variables) : undefined;

    if (type.toLowerCase() === 'i') {
      value = value !== undefined ? Number(value) : 0;
      if (Number.isNaN(value)) {
        throw new Error(`El valor inicial de ${name} debe ser numérico.`);
      }
    } else {
      value = value !== undefined ? String(value) : '';
    }

    variables.set(name.toLowerCase(), { type: type.toLowerCase(), value });
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

    const value = evaluateExpression(segment, variables);
    appendOutput(String(value), newline, outputLines);
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

  const amount = Number(evaluateExpression(match[1], variables));
  const targetName = match[2].toLowerCase();
  const target = variables.get(targetName);

  if (!target) {
    throw new Error(`Variable "${match[2]}" no declarada.`);
  }
  if (target.type !== 'i') {
    throw new Error('ADD solo admite variables de tipo I.');
  }
  if (Number.isNaN(amount)) {
    throw new Error('ADD requiere un valor numérico.');
  }

  target.value += amount;
}

function handleSubtract(statement, variables) {
  const match = statement.match(/^SUBTRACT\s+(.+)\s+FROM\s+([a-z_][\w-]*)$/i);
  if (!match) {
    throw new Error(`Sintaxis SUBTRACT inválida: "${statement}"`);
  }

  const amount = Number(evaluateExpression(match[1], variables));
  const targetName = match[2].toLowerCase();
  const target = variables.get(targetName);

  if (!target) {
    throw new Error(`Variable "${match[2]}" no declarada.`);
  }
  if (target.type !== 'i') {
    throw new Error('SUBTRACT solo admite variables de tipo I.');
  }
  if (Number.isNaN(amount)) {
    throw new Error('SUBTRACT requiere un valor numérico.');
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

  let value = evaluateExpression(match[2], variables);
  if (variable.type === 'i') {
    value = Number(value);
    if (Number.isNaN(value)) {
      throw new Error(`La variable ${match[1]} requiere un valor numérico.`);
    }
  } else {
    value = String(value);
  }

  variable.value = value;
}

function evaluateExpression(expression, variables) {
  const trimmed = expression.trim();
  if (!trimmed) {
    throw new Error('Expresión vacía.');
  }

  if ((trimmed.startsWith("'") && trimmed.endsWith("'")) || (trimmed.startsWith('`') && trimmed.endsWith('`'))) {
    return trimmed.slice(1, -1);
  }

  const numeric = Number(trimmed);
  if (!Number.isNaN(numeric)) {
    return numeric;
  }

  const variable = variables.get(trimmed.toLowerCase());
  if (variable) {
    return variable.value;
  }

  throw new Error(`No se pudo evaluar la expresión: "${expression}"`);
}
