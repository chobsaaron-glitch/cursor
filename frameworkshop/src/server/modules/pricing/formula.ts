/**
 * Formula engine for user-defined price rules.
 *
 * A hand-written tokeniser + recursive descent parser produces an AST that is
 * evaluated with a fixed set of variables and functions. `eval` and `Function`
 * are deliberately not used: formulas are authored by shop owners and stored in
 * the database, so they must never be able to execute arbitrary code.
 *
 * Supported syntax:
 *   numbers, variables, + - * / % ^, parentheses
 *   comparisons  <  <=  >  >=  =  ==  <>  !=
 *   logic        AND OR NOT (also && || !)
 *   functions    IF MIN MAX ROUND ROUNDUP ROUNDDOWN ABS CEIL FLOOR SQRT
 */

export type FormulaNode =
  | { kind: 'number'; value: number }
  | { kind: 'variable'; name: string }
  | { kind: 'unary'; operator: '-' | 'NOT'; operand: FormulaNode }
  | { kind: 'binary'; operator: BinaryOperator; left: FormulaNode; right: FormulaNode }
  | { kind: 'call'; name: FormulaFunction; args: FormulaNode[] };

export type BinaryOperator =
  | '+'
  | '-'
  | '*'
  | '/'
  | '%'
  | '^'
  | '<'
  | '<='
  | '>'
  | '>='
  | '=='
  | '!='
  | 'AND'
  | 'OR';

export type FormulaFunction =
  | 'IF'
  | 'MIN'
  | 'MAX'
  | 'ROUND'
  | 'ROUNDUP'
  | 'ROUNDDOWN'
  | 'ABS'
  | 'CEIL'
  | 'FLOOR'
  | 'SQRT';

const FUNCTIONS: Record<FormulaFunction, { minArgs: number; maxArgs: number }> = {
  IF: { minArgs: 3, maxArgs: 3 },
  MIN: { minArgs: 1, maxArgs: 16 },
  MAX: { minArgs: 1, maxArgs: 16 },
  ROUND: { minArgs: 1, maxArgs: 2 },
  ROUNDUP: { minArgs: 1, maxArgs: 2 },
  ROUNDDOWN: { minArgs: 1, maxArgs: 2 },
  ABS: { minArgs: 1, maxArgs: 1 },
  CEIL: { minArgs: 1, maxArgs: 1 },
  FLOOR: { minArgs: 1, maxArgs: 1 },
  SQRT: { minArgs: 1, maxArgs: 1 },
};

/** Variables a formula may reference. All money values are in roubles. */
export interface FormulaContext {
  cost: number;
  quantity: number;
  length: number;
  area: number;
  width: number;
  height: number;
  perimeter: number;
  unitedInch: number;
  cuts: number;
  joins: number;
  minutes: number;
  [key: string]: number;
}

export class FormulaError extends Error {
  constructor(message: string, readonly position?: number) {
    super(message);
    this.name = 'FormulaError';
  }
}

// --- tokeniser -------------------------------------------------------------

type TokenType = 'number' | 'identifier' | 'operator' | 'lparen' | 'rparen' | 'comma' | 'eof';

interface Token {
  type: TokenType;
  value: string;
  position: number;
}

const OPERATOR_CHARS = new Set(['+', '-', '*', '/', '%', '^', '<', '>', '=', '!', '&', '|']);

export function tokenize(input: string): Token[] {
  const tokens: Token[] = [];
  let index = 0;

  while (index < input.length) {
    const char = input[index];

    if (/\s/.test(char)) {
      index += 1;
      continue;
    }

    if (/[0-9.]/.test(char)) {
      const start = index;
      while (index < input.length && /[0-9._]/.test(input[index])) index += 1;
      const raw = input.slice(start, index).replace(/_/g, '');
      const value = Number.parseFloat(raw);
      if (!Number.isFinite(value)) throw new FormulaError(`Некорректное число «${raw}»`, start);
      tokens.push({ type: 'number', value: String(value), position: start });
      continue;
    }

    if (/[A-Za-zА-Яа-я_]/.test(char)) {
      const start = index;
      while (index < input.length && /[A-Za-zА-Яа-я0-9_]/.test(input[index])) index += 1;
      tokens.push({ type: 'identifier', value: input.slice(start, index), position: start });
      continue;
    }

    if (char === '(') {
      tokens.push({ type: 'lparen', value: char, position: index });
      index += 1;
      continue;
    }
    if (char === ')') {
      tokens.push({ type: 'rparen', value: char, position: index });
      index += 1;
      continue;
    }
    if (char === ',' || char === ';') {
      tokens.push({ type: 'comma', value: ',', position: index });
      index += 1;
      continue;
    }

    if (OPERATOR_CHARS.has(char)) {
      const start = index;
      const two = input.slice(index, index + 2);
      if (['<=', '>=', '==', '!=', '<>', '&&', '||'].includes(two)) {
        index += 2;
        tokens.push({ type: 'operator', value: two === '<>' ? '!=' : two, position: start });
        continue;
      }
      index += 1;
      tokens.push({ type: 'operator', value: char === '=' ? '==' : char, position: start });
      continue;
    }

    throw new FormulaError(`Неизвестный символ «${char}»`, index);
  }

  tokens.push({ type: 'eof', value: '', position: input.length });
  return tokens;
}

// --- parser ----------------------------------------------------------------

class Parser {
  private position = 0;

  constructor(private readonly tokens: Token[]) {}

  parse(): FormulaNode {
    const node = this.parseOr();
    if (this.peek().type !== 'eof') {
      throw new FormulaError(`Лишний фрагмент «${this.peek().value}»`, this.peek().position);
    }
    return node;
  }

  private peek(): Token {
    return this.tokens[this.position];
  }

  private next(): Token {
    return this.tokens[this.position++];
  }

  private matchOperator(...values: string[]): Token | null {
    const token = this.peek();
    if (token.type === 'operator' && values.includes(token.value)) {
      this.position += 1;
      return token;
    }
    return null;
  }

  private matchKeyword(...values: string[]): Token | null {
    const token = this.peek();
    if (token.type === 'identifier' && values.includes(token.value.toUpperCase())) {
      this.position += 1;
      return token;
    }
    return null;
  }

  private parseOr(): FormulaNode {
    let left = this.parseAnd();
    for (;;) {
      const token = this.matchOperator('||') ?? this.matchKeyword('OR', 'ИЛИ');
      if (!token) return left;
      left = { kind: 'binary', operator: 'OR', left, right: this.parseAnd() };
    }
  }

  private parseAnd(): FormulaNode {
    let left = this.parseComparison();
    for (;;) {
      const token = this.matchOperator('&&') ?? this.matchKeyword('AND', 'И');
      if (!token) return left;
      left = { kind: 'binary', operator: 'AND', left, right: this.parseComparison() };
    }
  }

  private parseComparison(): FormulaNode {
    let left = this.parseAdditive();
    for (;;) {
      const token = this.matchOperator('<', '<=', '>', '>=', '==', '!=');
      if (!token) return left;
      left = {
        kind: 'binary',
        operator: token.value as BinaryOperator,
        left,
        right: this.parseAdditive(),
      };
    }
  }

  private parseAdditive(): FormulaNode {
    let left = this.parseMultiplicative();
    for (;;) {
      const token = this.matchOperator('+', '-');
      if (!token) return left;
      left = {
        kind: 'binary',
        operator: token.value as BinaryOperator,
        left,
        right: this.parseMultiplicative(),
      };
    }
  }

  private parseMultiplicative(): FormulaNode {
    let left = this.parsePower();
    for (;;) {
      const token = this.matchOperator('*', '/', '%');
      if (!token) return left;
      left = {
        kind: 'binary',
        operator: token.value as BinaryOperator,
        left,
        right: this.parsePower(),
      };
    }
  }

  private parsePower(): FormulaNode {
    const left = this.parseUnary();
    const token = this.matchOperator('^');
    if (!token) return left;
    // Right associative: 2^3^2 === 2^(3^2)
    return { kind: 'binary', operator: '^', left, right: this.parsePower() };
  }

  private parseUnary(): FormulaNode {
    if (this.matchOperator('-')) {
      return { kind: 'unary', operator: '-', operand: this.parseUnary() };
    }
    if (this.matchOperator('+')) {
      return this.parseUnary();
    }
    if (this.matchOperator('!') ?? this.matchKeyword('NOT', 'НЕ')) {
      return { kind: 'unary', operator: 'NOT', operand: this.parseUnary() };
    }
    return this.parsePrimary();
  }

  private parsePrimary(): FormulaNode {
    const token = this.next();

    if (token.type === 'number') {
      return { kind: 'number', value: Number(token.value) };
    }

    if (token.type === 'lparen') {
      const node = this.parseOr();
      const closing = this.next();
      if (closing.type !== 'rparen') {
        throw new FormulaError('Не закрыта скобка', closing.position);
      }
      return node;
    }

    if (token.type === 'identifier') {
      const upper = token.value.toUpperCase();
      if (this.peek().type === 'lparen') {
        if (!(upper in FUNCTIONS)) {
          throw new FormulaError(`Неизвестная функция «${token.value}»`, token.position);
        }
        this.next();
        const args: FormulaNode[] = [];
        if (this.peek().type !== 'rparen') {
          for (;;) {
            args.push(this.parseOr());
            if (this.peek().type === 'comma') {
              this.next();
              continue;
            }
            break;
          }
        }
        const closing = this.next();
        if (closing.type !== 'rparen') {
          throw new FormulaError('Не закрыта скобка в вызове функции', closing.position);
        }
        const signature = FUNCTIONS[upper as FormulaFunction];
        if (args.length < signature.minArgs || args.length > signature.maxArgs) {
          throw new FormulaError(
            `Функция ${upper} принимает от ${signature.minArgs} до ${signature.maxArgs} аргументов`,
            token.position,
          );
        }
        return { kind: 'call', name: upper as FormulaFunction, args };
      }

      if (upper === 'TRUE' || upper === 'ИСТИНА') return { kind: 'number', value: 1 };
      if (upper === 'FALSE' || upper === 'ЛОЖЬ') return { kind: 'number', value: 0 };

      return { kind: 'variable', name: token.value };
    }

    throw new FormulaError(`Неожиданный элемент «${token.value || 'конец выражения'}»`, token.position);
  }
}

export function parseFormula(expression: string): FormulaNode {
  if (!expression.trim()) throw new FormulaError('Пустая формула');
  return new Parser(tokenize(expression)).parse();
}

// --- evaluator -------------------------------------------------------------

const VARIABLE_ALIASES: Record<string, string> = {
  cost: 'cost',
  себестоимость: 'cost',
  qty: 'quantity',
  quantity: 'quantity',
  количество: 'quantity',
  length: 'length',
  длина: 'length',
  area: 'area',
  площадь: 'area',
  width: 'width',
  ширина: 'width',
  height: 'height',
  высота: 'height',
  perimeter: 'perimeter',
  периметр: 'perimeter',
  unitedinch: 'unitedInch',
  ui: 'unitedInch',
  cuts: 'cuts',
  резы: 'cuts',
  joins: 'joins',
  соединения: 'joins',
  minutes: 'minutes',
  минуты: 'minutes',
};

export function evaluateNode(node: FormulaNode, context: FormulaContext): number {
  switch (node.kind) {
    case 'number':
      return node.value;

    case 'variable': {
      const key = VARIABLE_ALIASES[node.name.toLowerCase()] ?? node.name;
      const value = context[key];
      if (typeof value !== 'number' || !Number.isFinite(value)) {
        throw new FormulaError(`Неизвестная переменная «${node.name}»`);
      }
      return value;
    }

    case 'unary': {
      const operand = evaluateNode(node.operand, context);
      return node.operator === '-' ? -operand : operand === 0 ? 1 : 0;
    }

    case 'binary': {
      const left = evaluateNode(node.left, context);
      // Short-circuit keeps `IF(x > 0 AND 100 / x > 2, …)` safe.
      if (node.operator === 'AND') return left === 0 ? 0 : evaluateNode(node.right, context) === 0 ? 0 : 1;
      if (node.operator === 'OR') return left !== 0 ? 1 : evaluateNode(node.right, context) !== 0 ? 1 : 0;

      const right = evaluateNode(node.right, context);
      switch (node.operator) {
        case '+':
          return left + right;
        case '-':
          return left - right;
        case '*':
          return left * right;
        case '/':
          if (right === 0) throw new FormulaError('Деление на ноль');
          return left / right;
        case '%':
          if (right === 0) throw new FormulaError('Деление на ноль');
          return left % right;
        case '^':
          return left ** right;
        case '<':
          return left < right ? 1 : 0;
        case '<=':
          return left <= right ? 1 : 0;
        case '>':
          return left > right ? 1 : 0;
        case '>=':
          return left >= right ? 1 : 0;
        case '==':
          return Math.abs(left - right) < 1e-9 ? 1 : 0;
        case '!=':
          return Math.abs(left - right) >= 1e-9 ? 1 : 0;
        default:
          throw new FormulaError(`Неизвестная операция «${node.operator}»`);
      }
    }

    case 'call': {
      if (node.name === 'IF') {
        return evaluateNode(node.args[0], context) !== 0
          ? evaluateNode(node.args[1], context)
          : evaluateNode(node.args[2], context);
      }
      const args = node.args.map((arg) => evaluateNode(arg, context));
      switch (node.name) {
        case 'MIN':
          return Math.min(...args);
        case 'MAX':
          return Math.max(...args);
        case 'ROUND': {
          const digits = args[1] ?? 0;
          const factor = 10 ** digits;
          return Math.round(args[0] * factor) / factor;
        }
        case 'ROUNDUP': {
          const factor = 10 ** (args[1] ?? 0);
          return Math.ceil(args[0] * factor) / factor;
        }
        case 'ROUNDDOWN': {
          const factor = 10 ** (args[1] ?? 0);
          return Math.floor(args[0] * factor) / factor;
        }
        case 'ABS':
          return Math.abs(args[0]);
        case 'CEIL':
          return Math.ceil(args[0]);
        case 'FLOOR':
          return Math.floor(args[0]);
        case 'SQRT':
          if (args[0] < 0) throw new FormulaError('Корень из отрицательного числа');
          return Math.sqrt(args[0]);
        default:
          throw new FormulaError(`Неизвестная функция «${node.name}»`);
      }
    }

    default:
      throw new FormulaError('Некорректная формула');
  }
}

export function evaluateFormula(expression: string, context: FormulaContext): number {
  const result = evaluateNode(parseFormula(expression), context);
  if (!Number.isFinite(result)) throw new FormulaError('Результат формулы не является числом');
  return result;
}

/** Validates a formula without running it — used by the formula builder UI. */
export function validateFormula(expression: string): { valid: boolean; error?: string; variables: string[] } {
  try {
    const ast = parseFormula(expression);
    return { valid: true, variables: collectVariables(ast) };
  } catch (error) {
    return {
      valid: false,
      error: error instanceof Error ? error.message : 'Ошибка разбора формулы',
      variables: [],
    };
  }
}

export function collectVariables(node: FormulaNode, found = new Set<string>()): string[] {
  switch (node.kind) {
    case 'variable':
      found.add(VARIABLE_ALIASES[node.name.toLowerCase()] ?? node.name);
      break;
    case 'unary':
      collectVariables(node.operand, found);
      break;
    case 'binary':
      collectVariables(node.left, found);
      collectVariables(node.right, found);
      break;
    case 'call':
      node.args.forEach((arg) => collectVariables(arg, found));
      break;
    default:
      break;
  }
  return [...found];
}

/** Renders an AST back to text — the bridge from the visual builder to storage. */
export function formulaToString(node: FormulaNode): string {
  switch (node.kind) {
    case 'number':
      return String(node.value);
    case 'variable':
      return node.name;
    case 'unary':
      return node.operator === '-'
        ? `-${formulaToString(node.operand)}`
        : `NOT ${formulaToString(node.operand)}`;
    case 'binary':
      return `(${formulaToString(node.left)} ${node.operator} ${formulaToString(node.right)})`;
    case 'call':
      return `${node.name}(${node.args.map(formulaToString).join(', ')})`;
    default:
      return '';
  }
}
