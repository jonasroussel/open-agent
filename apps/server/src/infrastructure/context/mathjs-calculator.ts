import { all, create } from 'mathjs';

import { CalculationError, type Calculator } from '../../application/ports/context-services.ts';

/** The model writes expressions, never code: a few hundred characters cover any household calculation. */
const MAX_EXPRESSION_LENGTH = 500;

/** What would change mathjs itself, or parse an expression mathjs' own checks did not see. */
const DISABLED = ['import', 'createUnit', 'evaluate', 'parse', 'simplify', 'derivative', 'resolve', 'reviver'];

function disabled(name: string) {
  return () => {
    throw new CalculationError(`${name} is not available.`);
  };
}

/**
 * Arithmetic, percentages and unit conversions ("5 km to mile"). The functions that change mathjs itself or parse
 * further expressions are switched off, as mathjs' security guide advises for untrusted input.
 */
export class MathjsCalculator implements Calculator {
  readonly #evaluate: (expression: string) => unknown;
  readonly #format: (value: unknown) => string;

  constructor() {
    const math = create(all!);
    this.#evaluate = math.evaluate;
    this.#format = (value) => math.format(value, { precision: 14 });
    math.import(Object.fromEntries(DISABLED.map((name) => [name, disabled(name)])), { override: true });
  }

  evaluate(expression: string): string {
    if (expression.length > MAX_EXPRESSION_LENGTH) throw new CalculationError('The expression is too long.');
    let value: unknown;
    try {
      value = this.#evaluate(expression);
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
