const defaultProgram = `* Ejemplo de uso de tabla interna
DATA: lt_texts TYPE TABLE OF string,
      lv_text  TYPE string.

APPEND 'Hola' TO lt_texts.
APPEND 'Mundo' TO lt_texts.

LOOP AT lt_texts INTO lv_text.
  WRITE: / lv_text.
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

  const statements = preprocess(code);
  processStatements(statements, variables, outputLines, messages);

  const printableOutput = outputLines
    .filter((line, index, arr) => !(index === arr.length - 1 && line === ''))
    .map((line) => line.trimEnd())
    .join('\n');

  return { output: printableOutput, messages };
}

function processStatements(statements, variables, outputLines, messages) {
  for (let index = 0; index < statements.length; index += 1) {
    const statement = statements[index];
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
      } else if (/^APPEND\b/i.test(statement)) {
        handleAppend(statement, variables);
      } else if (/^LOOP\b/i.test(statement)) {
        index = handleLoop(statements, index, variables, outputLines, messages);
      } else if (/^ENDLOOP$/i.test(statement)) {
        throw new Error('ENDLOOP sin LOOP correspondiente.');
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
    const match = declaration.match(
      /^(?<name>[a-z_][\w-]*)\s+TYPE\s+(?<type>.+?)(?:\s+VALUE\s+(?<value>.+))?$/i,
    );
    if (!match) {
      throw new Error(`No se pudo interpretar la declaración: "${declaration}"`);
    }

    const { name } = match.groups;
    const parsedType = parseType(match.groups.type);
    if (!parsedType) {
      throw new Error(`Tipo no soportado en la declaración: "${declaration}"`);
    }

    let value;
    if (parsedType.type === 'table') {
      value = match.groups.value
        ? evaluateTableExpression(match.groups.value, variables, parsedType.elementType)
        : [];
    } else {
      value = match.groups.value
        ? coerceToType(evaluateExpression(match.groups.value, variables), parsedType.type, name)
        : parsedType.type === 'i'
        ? 0
        : '';
    }

    variables.set(name.toLowerCase(), { ...parsedType, value });
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
  if (variable.type === 'table') {
    variable.value = [];
  } else {
    variable.value = variable.type === 'i' ? 0 : '';
  }
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
    variable.value = evaluateTableExpression(match[2], variables, variable.elementType);
  } else {
    variable.value = coerceToType(evaluateExpression(match[2], variables), variable.type, match[1]);
  }
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
    return variable.type === 'table' ? [...variable.value] : variable.value;
  }

  throw new Error(`No se pudo evaluar la expresión: "${expression}"`);
}

function handleAppend(statement, variables) {
  const match = statement.match(/^APPEND\s+(.+)\s+TO\s+([a-z_][\w-]*)$/i);
  if (!match) {
    throw new Error(`Sintaxis APPEND inválida: "${statement}"`);
  }

  const valueExpression = match[1];
  const targetName = match[2].toLowerCase();
  const target = variables.get(targetName);

  if (!target) {
    throw new Error(`Tabla interna "${match[2]}" no declarada.`);
  }
  if (target.type !== 'table') {
    throw new Error(`APPEND solo puede utilizarse con tablas internas.`);
  }

  const value = coerceToType(evaluateExpression(valueExpression, variables), target.elementType, match[2]);
  target.value.push(value);
}

function handleLoop(statements, startIndex, variables, outputLines, messages) {
  const header = statements[startIndex];
  const match = header.match(/^LOOP\s+AT\s+([a-z_][\w-]*)\s+INTO\s+([a-z_][\w-]*)$/i);
  if (!match) {
    throw new Error(`Sintaxis LOOP inválida: "${header}"`);
  }

  const tableName = match[1].toLowerCase();
  const workAreaName = match[2].toLowerCase();

  const tableVariable = variables.get(tableName);
  if (!tableVariable) {
    throw new Error(`Tabla interna "${match[1]}" no declarada.`);
  }
  if (tableVariable.type !== 'table') {
    throw new Error(`"${match[1]}" no es una tabla interna.`);
  }

  const workArea = variables.get(workAreaName);
  if (!workArea) {
    throw new Error(`Área de trabajo "${match[2]}" no declarada.`);
  }
  if (workArea.type === 'table') {
    throw new Error('El área de trabajo del LOOP no puede ser una tabla interna.');
  }

  let depth = 1;
  let endIndex = -1;
  for (let idx = startIndex + 1; idx < statements.length; idx += 1) {
    if (/^LOOP\b/i.test(statements[idx])) {
      depth += 1;
    } else if (/^ENDLOOP$/i.test(statements[idx])) {
      depth -= 1;
      if (depth === 0) {
        endIndex = idx;
        break;
      }
    }
  }

  if (endIndex === -1) {
    throw new Error('LOOP sin ENDLOOP correspondiente.');
  }

  const body = statements.slice(startIndex + 1, endIndex);

  for (const row of tableVariable.value) {
    workArea.value = coerceToType(row, workArea.type, match[2]);
    processStatements(body, variables, outputLines, messages);
  }

  return endIndex;
}

function parseType(type) {
  const normalized = type.trim().toLowerCase();
  if (normalized === 'i' || normalized === 'string') {
    return { type: normalized };
  }

  const tableMatch = normalized.match(/^table\s+of\s+(i|string)$/);
  if (tableMatch) {
    return { type: 'table', elementType: tableMatch[1] };
  }

  return null;
}

function coerceToType(value, type, variableName) {
  if (type === 'i') {
    const numeric = Number(value);
    if (Number.isNaN(numeric)) {
      throw new Error(`La variable ${variableName} requiere un valor numérico.`);
    }
    return numeric;
  }
  if (type === 'string') {
    return String(value);
  }
  throw new Error('Tipo no soportado.');
}

function evaluateTableExpression(expression, variables, elementType) {
  const trimmed = expression.trim();
  if (!trimmed) {
    throw new Error('La expresión de tabla está vacía.');
  }

  if (trimmed.startsWith('[') && trimmed.endsWith(']')) {
    const inner = trimmed.slice(1, -1);
    if (!inner.trim()) {
      return [];
    }
    return splitTableElements(inner).map((part, index) =>
      coerceToType(
        evaluateExpression(part, variables),
        elementType,
        `elemento ${index + 1} de la tabla`,
      ),
    );
  }

  const value = evaluateExpression(trimmed, variables);
  if (!Array.isArray(value)) {
    throw new Error('La expresión debe devolver una tabla interna.');
  }

  return value.map((entry, index) =>
    coerceToType(entry, elementType, `elemento ${index + 1} de la tabla`),
  );
}

function splitTableElements(text) {
  const result = [];
  let current = '';
  let inString = false;
  let stringDelimiter = '';

  for (let i = 0; i < text.length; i += 1) {
    const char = text[i];
    if ((char === "'" || char === '"' || char === '`') && !inString) {
      inString = true;
      stringDelimiter = char;
      current += char;
      continue;
    }
    if (inString && char === stringDelimiter) {
      inString = false;
      stringDelimiter = '';
      current += char;
      continue;
    }
    if (char === ',' && !inString) {
      if (current.trim()) {
        result.push(current.trim());
      }
      current = '';
      continue;
    }
    current += char;
  }

  if (current.trim()) {
    result.push(current.trim());
  }

  return result;
}
