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
    const match = declaration.match(/^(?<name>[a-z_][\w-]*)\s+TYPE\s+(?<type>[a-z]+)(?<rest>.*)$/i);
    if (!match) {
      throw new Error(`No se pudo interpretar la declaración: "${declaration}"`);
    }

    const { name } = match.groups;
    const type = match.groups.type.toLowerCase();
    let rest = (match.groups.rest || '').trim();

    let length;
    let decimals;
    let valueExpression;

    if (rest) {
      const valueMatch = rest.match(/\bVALUE\s+(.+)$/i);
      if (valueMatch) {
        valueExpression = valueMatch[1].trim();
        rest = rest.slice(0, valueMatch.index).trim();
      }

      const lengthMatch = rest.match(/\bLENGTH\s+(\d+)/i);
      if (lengthMatch) {
        length = Number(lengthMatch[1]);
        rest = (rest.slice(0, lengthMatch.index) + rest.slice(lengthMatch.index + lengthMatch[0].length)).trim();
      }

      const decimalsMatch = rest.match(/\bDECIMALS\s+(\d+)/i);
      if (decimalsMatch) {
        decimals = Number(decimalsMatch[1]);
        rest = (rest.slice(0, decimalsMatch.index) + rest.slice(decimalsMatch.index + decimalsMatch[0].length)).trim();
      }

      if (rest.length > 0) {
        throw new Error(`Parámetros no reconocidos en la declaración: "${declaration}"`);
      }
    }

    if (length !== undefined && (!Number.isInteger(length) || length <= 0)) {
      throw new Error(`LENGTH debe ser un entero positivo en la declaración de ${name}.`);
    }

    if (decimals !== undefined && (!Number.isInteger(decimals) || decimals < 0)) {
      throw new Error(`DECIMALS debe ser un entero no negativo en la declaración de ${name}.`);
    }

    validateTypeDefinition(type, { length, decimals }, name);

    const definition = { type, length, decimals };
    let value = valueExpression ? evaluateExpression(valueExpression, variables) : undefined;
    value = coerceValueByType(definition, value, { initializing: true, variableName: name });

    variables.set(name.toLowerCase(), { ...definition, value });
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

  const targetName = match[2].toLowerCase();
  const target = variables.get(targetName);

  if (!target) {
    throw new Error(`Variable "${match[2]}" no declarada.`);
  }

  ensureNumericType(target, 'ADD');

  const amountRaw = evaluateExpression(match[1], variables);
  const amount = coerceValueByType(target, amountRaw, { variableName: match[1], numericOperation: true });
  const result = target.value + amount;
  target.value = coerceValueByType(target, result, { variableName: match[2], numericOperation: true });
}

function ensureNumericType(variable, operation) {
  if (!['i', 'p', 'f'].includes(variable.type)) {
    throw new Error(`${operation} solo admite variables numéricas.`);
  }
}

function handleSubtract(statement, variables) {
  const match = statement.match(/^SUBTRACT\s+(.+)\s+FROM\s+([a-z_][\w-]*)$/i);
  if (!match) {
    throw new Error(`Sintaxis SUBTRACT inválida: "${statement}"`);
  }

  const targetName = match[2].toLowerCase();
  const target = variables.get(targetName);

  if (!target) {
    throw new Error(`Variable "${match[2]}" no declarada.`);
  }

  ensureNumericType(target, 'SUBTRACT');

  const amountRaw = evaluateExpression(match[1], variables);
  const amount = coerceValueByType(target, amountRaw, { variableName: match[1], numericOperation: true });
  const result = target.value - amount;
  target.value = coerceValueByType(target, result, { variableName: match[2], numericOperation: true });
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
  variable.value = coerceValueByType(variable, undefined, { initializing: true, variableName: match[1] });
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

  const value = evaluateExpression(match[2], variables);
  variable.value = coerceValueByType(variable, value, { variableName: match[1] });
}

function validateTypeDefinition(type, metadata, variableName) {
  const upperName = variableName.toUpperCase();
  switch (type) {
    case 'i':
      if (metadata.length !== undefined) {
        throw new Error(`El tipo I no admite LENGTH (variable ${upperName}).`);
      }
      if (metadata.decimals !== undefined) {
        throw new Error(`El tipo I no admite DECIMALS (variable ${upperName}).`);
      }
      break;
    case 'f':
      if (metadata.length !== undefined) {
        throw new Error(`El tipo F no admite LENGTH (variable ${upperName}).`);
      }
      if (metadata.decimals !== undefined) {
        throw new Error(`El tipo F no admite DECIMALS (variable ${upperName}).`);
      }
      break;
    case 'p':
      if (metadata.length !== undefined && metadata.length <= 0) {
        throw new Error(`LENGTH debe ser mayor que cero para ${upperName}.`);
      }
      if (metadata.decimals !== undefined && metadata.length !== undefined && metadata.decimals > metadata.length) {
        throw new Error(`DECIMALS no puede superar LENGTH para ${upperName}.`);
      }
      break;
    case 'n':
      if (metadata.decimals !== undefined) {
        throw new Error(`El tipo N no admite DECIMALS (variable ${upperName}).`);
      }
      break;
    case 'd':
      if (metadata.length !== undefined) {
        throw new Error(`El tipo D no admite LENGTH (variable ${upperName}).`);
      }
      if (metadata.decimals !== undefined) {
        throw new Error(`El tipo D no admite DECIMALS (variable ${upperName}).`);
      }
      break;
    case 'string':
      if (metadata.length !== undefined || metadata.decimals !== undefined) {
        throw new Error(`El tipo STRING no admite LENGTH ni DECIMALS (variable ${upperName}).`);
      }
      break;
    case 'c':
      if (metadata.decimals !== undefined) {
        throw new Error(`El tipo C no admite DECIMALS (variable ${upperName}).`);
      }
      break;
    default:
      throw new Error(`Tipo "${type}" no soportado para la variable ${upperName}.`);
  }
}

function coerceValueByType(definition, rawValue, options = {}) {
  const { type, length, decimals } = definition;
  const { initializing = false, variableName, numericOperation = false } = options;
  const label = variableName ? ` ${variableName.toUpperCase()}` : '';
  const hasValue = rawValue !== undefined && rawValue !== null;

  if (!hasValue && !(initializing || numericOperation)) {
    throw new Error(`Se requiere un valor para la variable${label}.`);
  }

  switch (type) {
    case 'i': {
      const numericValue = hasValue ? Number(rawValue) : 0;
      if (!Number.isFinite(numericValue)) {
        throw new Error(`El valor asignado a${label} debe ser numérico.`);
      }
      return Math.trunc(numericValue);
    }
    case 'p': {
      const numericValue = hasValue ? Number(rawValue) : 0;
      if (!Number.isFinite(numericValue)) {
        throw new Error(`El valor asignado a${label} debe ser numérico.`);
      }
      if (typeof decimals === 'number') {
        return Number(numericValue.toFixed(decimals));
      }
      return numericValue;
    }
    case 'f': {
      const numericValue = hasValue ? Number(rawValue) : 0;
      if (!Number.isFinite(numericValue)) {
        throw new Error(`El valor asignado a${label} debe ser numérico.`);
      }
      return numericValue;
    }
    case 'n': {
      const effectiveLength = length;
      let stringValue = hasValue
        ? String(rawValue)
        : effectiveLength !== undefined
        ? ''.padStart(effectiveLength, '0')
        : '0';

      if (!/^\d*$/.test(stringValue)) {
        throw new Error(`El valor asignado a${label} debe contener solo dígitos.`);
      }

      if (effectiveLength !== undefined) {
        if (stringValue.length > effectiveLength) {
          throw new Error(`El valor para${label} excede la longitud definida (${effectiveLength}).`);
        }
        stringValue = stringValue.padStart(effectiveLength, '0');
      }

      return stringValue;
    }
    case 'd': {
      const stringValue = hasValue ? String(rawValue) : '00000000';

      if (!/^\d{8}$/.test(stringValue)) {
        throw new Error(`El valor asignado a${label} debe tener el formato AAAAMMDD.`);
      }

      return stringValue;
    }
    case 'c': {
      const effectiveLength = length ?? 1;
      let stringValue = hasValue ? String(rawValue) : ''.padEnd(effectiveLength, ' ');

      if (stringValue.length > effectiveLength) {
        stringValue = stringValue.slice(0, effectiveLength);
      } else if (stringValue.length < effectiveLength) {
        stringValue = stringValue.padEnd(effectiveLength, ' ');
      }

      return stringValue;
    }
    case 'string': {
      return hasValue ? String(rawValue) : '';
    }
    default:
      throw new Error(`Tipo "${type}" no soportado.`);
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
    return variable.value;
  }

  throw new Error(`No se pudo evaluar la expresión: "${expression}"`);
}
