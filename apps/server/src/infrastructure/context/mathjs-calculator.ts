import { all, create } from 'mathjs';
import type { MathJsInstance, MathNode } from 'mathjs';

import { CalculationError, type Calculator } from '../../application/ports/context-services.ts';

/** The model writes expressions, never code: a few hundred characters cover any household calculation. */
const MAX_EXPRESSION_LENGTH = 500;

/** What would change mathjs itself, or parse an expression mathjs' own checks did not see. */
const DISABLED = [
  'import',
  'createUnit',
  'config',
  'evaluate',
  'parse',
  'simplify',
  'derivative',
  'resolve',
  'reviver',
];

/**
 * One Bun process serves every user: a calculation must not hold it. Each limit is far past a household calculation
 * and keeps the slowest expression under a few hundred milliseconds. Ranges and matrices are capped at their creation
 * and at every step, so a product of two (an outer product, `kron`) is the largest thing ever built.
 */
const MAX_ELEMENTS = 1_000;
/** Exact integers and fractions (bigint, Fraction) grow without bound under powers and shifts. */
const MAX_BITS = 10_000;
/** Factorials and combinatorics loop up to their input: `bernoulli(bignumber(1000))` takes about 200 ms. */
const MAX_COUNT_INPUT = 1_000;
const MAX_STRING_LENGTH = 10_000;
/** Digits a formatted number may ask for: decimal.js would write a billion. */
const MAX_DIGITS = 100;
/** solveODE's own default. */
const MAX_ODE_ITERATIONS = 10_000;

type Guard = (args: unknown[], math: MathJsInstance) => void;

const counted: Guard = (args, math) => {
  if (scalars(args, math).some((value) => Math.abs(value) > MAX_COUNT_INPUT)) {
    throw new CalculationError(`This function takes numbers up to ${MAX_COUNT_INPUT}.`);
  }
};
const filled: Guard = (args, math) => atMostElements(product(scalars(args, math)));
const randomFilled: Guard = (args, math) => {
  if (isCollection(args[0], math)) atMostElements(product(scalars([args[0]], math)));
};
const formatted =
  (from: number): Guard =>
  (args, math) => {
    if (scalars(args.slice(from), math).some((value) => Math.abs(value) > MAX_DIGITS)) {
      throw new CalculationError(`Ask for ${MAX_DIGITS} digits at most.`);
    }
  };
const TOO_LARGE = 'The result would be a number too large to compute exactly.';
const powered: Guard = ([base, exponent], math) => {
  const bits = Math.max(0, ...leaves(base, math).map((value) => exactBits(value, math)));
  if (bits * Math.max(0, ...scalars([exponent], math).map(Math.abs)) > MAX_BITS) throw new CalculationError(TOO_LARGE);
};

/** The functions that build more than they are given, checked before they run. */
const GUARDS: Record<string, Guard> = {
  // Typed `...any`: its arguments come as one array.
  range: ([args], math) => atMostElements(rangeLength(args as unknown[], math)),
  zeros: filled,
  ones: filled,
  identity: (args, math) => {
    const sizes = scalars(args, math);
    atMostElements(sizes.length === 1 ? sizes[0]! ** 2 : product(sizes));
  },
  random: randomFilled,
  randomInt: randomFilled,
  pickRandom: (args, math) => {
    const counts = args.slice(1).filter((arg) => !isCollection(arg, math));
    atMostElements(Math.max(0, ...scalars(counts, math)));
  },
  resize: (args, math) => atMostElements(product(scalars([args[1]], math))),
  matrixFromFunction: (args, math) => atMostElements(product(scalars([args[0]], math))),
  // `x[1e9] = 1` resizes x to a billion cells.
  index: (args, math) => atMostElements(Math.max(0, ...scalars(args, math))),
  setPowerset: (args, math) => atMostElements(2 ** leaves(args[0], math).length),
  pow: powered,
  dotPow: powered,
  leftShift: ([value, shift], math) => {
    const exact = leaves(value, math).some((inner) => typeof inner === 'bigint');
    if (exact && scalars([shift], math).some((bits) => bits > MAX_BITS)) throw new CalculationError(TOO_LARGE);
  },
  factorial: counted,
  gamma: counted,
  combinations: counted,
  combinationsWithRep: counted,
  permutations: counted,
  multinomial: counted,
  stirlingS2: counted,
  bellNumbers: counted,
  catalan: counted,
  composition: counted,
  bernoulli: counted,
  format: formatted(1),
  print: formatted(2),
  bin: formatted(1),
  oct: formatted(1),
  hex: formatted(1),
  solveODE: ([, , , options]) => {
    const iterations = typeof options === 'object' && options !== null && 'maxIter' in options ? options.maxIter : 0;
    if (!(Number(iterations) <= MAX_ODE_ITERATIONS)) {
      throw new CalculationError(`solveODE takes ${MAX_ODE_ITERATIONS} iterations at most.`);
    }
  },
};

function disabled(name: string) {
  return () => {
    throw new CalculationError(`${name} is not available.`);
  };
}

/**
 * Arithmetic, percentages and unit conversions ("5 km to mile"). The functions that change mathjs itself or parse
 * further expressions are switched off, as mathjs' security guide advises for untrusted input; every other function
 * refuses what would hold the server (see `MAX_ELEMENTS`).
 */
export class MathjsCalculator implements Calculator {
  readonly #parse: (expression: string) => MathNode;
  readonly #format: (value: unknown) => string;
  readonly #math: MathJsInstance;

  constructor() {
    const math = create(all!);
    this.#math = math;
    this.#parse = math.parse;
    this.#format = (value) => math.format(value, { precision: 14 });
    math.import(Object.fromEntries(DISABLED.map((name) => [name, disabled(name)])), { override: true });
    // Expressions call what this namespace holds, transforms included (mathjs' types omit it); mathjs' own internals
    // keep the originals. Wrapped on first use: wrapping all 300 at once would add 75 ms to every app start.
    const callable = (math as unknown as { expression: { mathWithTransform: Record<string, unknown> } }).expression
      .mathWithTransform;
    for (const name of Object.keys(callable)) {
      const original = Object.getOwnPropertyDescriptor(callable, name)!;
      let value: unknown;
      Object.defineProperty(callable, name, {
        configurable: true,
        enumerable: true,
        get: () => (value ??= limit(name, original.get ? original.get() : original.value, math)),
      });
    }
  }

  evaluate(expression: string): string {
    if (expression.length > MAX_EXPRESSION_LENGTH) throw new CalculationError('The expression is too long.');
    const math = this.#math;
    let value: unknown;
    try {
      const node = this.#parse(expression);
      // A function may call itself without end; a method call (`matrix([1]).resize(…)`) skips every check here.
      if (node.filter((inner) => inner.type === 'FunctionAssignmentNode').length > 0) {
        throw new CalculationError('Defining functions is not available: write the expression out.');
      }
      if (node.filter((inner) => math.isFunctionNode(inner) && math.isAccessorNode(inner.fn)).length > 0) {
        throw new CalculationError('Calling methods is not available: use the functions, such as "pow(x, 2)".');
      }
      value = node.evaluate();
      assertSmall(value, math);
    } catch (error) {
      throw new CalculationError(error instanceof Error ? error.message : 'The expression could not be computed.');
    }
    if (typeof value === 'number' && !Number.isFinite(value)) {
      throw new CalculationError('The result is not a number (a division by zero?).');
    }
    if (typeof value === 'function' || value === undefined) {
      throw new CalculationError('Write an expression with a value, such as "1250 * 1.2".');
    }
    return this.#format(value);
  }
}

/** The function checked before and after each call; constants, and mathjs' raw-argument transforms, as they are. */
function limit(name: string, value: unknown, math: MathJsInstance): unknown {
  if (typeof value !== 'function') return value;
  const guard = GUARDS[name];
  if ('signatures' in value && typeof value.signatures === 'object' && value.signatures !== null) {
    // A typed function again, so that `map(x, sqrt)` still sees how many arguments `sqrt` takes.
    const signatures = Object.entries(value.signatures as Record<string, (...args: unknown[]) => unknown>);
    return math.typed(
      name,
      Object.fromEntries(signatures.map(([signature, fn]) => [signature, limited(fn, guard, math)])),
    );
  }
  return guard ? limited(value as (...args: unknown[]) => unknown, guard, math) : value;
}

function limited(fn: (...args: unknown[]) => unknown, guard: Guard | undefined, math: MathJsInstance) {
  return (...args: unknown[]) => {
    for (const arg of args) assertSmall(arg, math);
    guard?.(args, math);
    const result = fn(...args);
    assertSmall(result, math);
    return result;
  };
}

function assertSmall(value: unknown, math: MathJsInstance): void {
  if (math.isResultSet(value)) {
    for (const entry of value.entries) assertSmall(entry, math);
  } else if (isCollection(value, math)) {
    atMostElements(elementCount(value));
  } else if (typeof value === 'string' && value.length > MAX_STRING_LENGTH) {
    throw new CalculationError(`The text is longer than ${MAX_STRING_LENGTH} characters.`);
  } else if (exactBits(value, math) > MAX_BITS) {
    throw new CalculationError('The number is too large to compute exactly.');
  }
}

function atMostElements(count: number): void {
  if (!(count <= MAX_ELEMENTS)) {
    throw new CalculationError(`Ranges and matrices hold ${MAX_ELEMENTS} elements at most.`);
  }
}

function isCollection(value: unknown, math: MathJsInstance): boolean {
  return Array.isArray(value) || math.isMatrix(value);
}

/** Cells of an array or matrix, counted without expanding a sparse matrix. */
function elementCount(value: unknown): number {
  if (Array.isArray(value)) return value.reduce((count: number, inner) => count + elementCount(inner), 0);
  if (typeof value === 'object' && value !== null && 'size' in value && typeof value.size === 'function') {
    return product(value.size() as number[]);
  }
  return 1;
}

/** Every value inside the arguments, arrays and matrices flattened. */
function leaves(value: unknown, math: MathJsInstance): unknown[] {
  if (Array.isArray(value)) return value.flatMap((inner) => leaves(inner, math));
  if (math.isMatrix(value)) return leaves(value.toArray(), math);
  return [value];
}

/** The numbers inside the arguments, options objects and index ranges included; strings and units aside. */
function scalars(args: unknown[], math: MathJsInstance): number[] {
  return args
    .flatMap((arg) => leaves(arg, math))
    .flatMap((value) => {
      if (typeof value === 'number' || typeof value === 'bigint' || math.isBigNumber(value) || math.isFraction(value)) {
        return [Number(value)];
      }
      const plain = typeof value === 'object' && value !== null && Object.getPrototypeOf(value) === Object.prototype;
      if (plain || math.isRange(value)) return scalars(Object.values(value as object), math);
      return [];
    });
}

/** The bits of an exact integer or fraction; 0 for everything else, whose size is fixed. */
function exactBits(value: unknown, math: MathJsInstance): number {
  if (typeof value === 'bigint') return bitLength(value);
  if (math.isFraction(value)) return bitLength(value.n) + bitLength(value.d);
  return 0;
}

function bitLength(value: bigint): number {
  return (value < 0n ? -value : value).toString(2).length;
}

function product(values: number[]): number {
  return values.reduce((total, value) => total * Math.abs(value), 1);
}

/** `start:end`, `start:end:step`, or the string `"start:step:end"`; NaN when no length can be told. */
function rangeLength(args: unknown[], math: MathJsInstance): number {
  let [start, end, step]: unknown[] = [args[0], args[1], typeof args[2] === 'boolean' ? 1 : (args[2] ?? 1)];
  if (typeof args[0] === 'string') {
    const parts = args[0].split(':').map(Number);
    [start, step, end] = parts.length === 3 ? parts : [parts[0], 1, parts[1]];
  }
  try {
    return Number(math.abs(math.divide(math.subtract(end as number, start as number), step as number) as number));
  } catch {
    return Number.NaN;
  }
}
