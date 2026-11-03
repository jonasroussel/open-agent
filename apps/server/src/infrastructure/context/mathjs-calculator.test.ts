import { describe, expect, test } from 'bun:test';

import { CalculationError } from '../../application/ports/context-services.ts';
import { MathjsCalculator } from './mathjs-calculator.ts';

describe('MathjsCalculator', () => {
  const calculator = new MathjsCalculator();

  test('computes sums, percentages and conversions without floating noise', () => {
    expect(calculator.evaluate('0.1 + 0.2')).toBe('0.3');
    expect(calculator.evaluate('15% * 80')).toBe('12');
    expect(calculator.evaluate('5 km to mile')).toBe('3.1068559611867 mile');
  });

  test('refuses what would change the calculator, and results that are no number', () => {
    expect(() => calculator.evaluate('import({ a: 1 })')).toThrow(CalculationError);
    expect(() => calculator.evaluate('createUnit("x")')).toThrow(CalculationError);
    expect(() => calculator.evaluate('7 / 0')).toThrow(CalculationError);
    expect(() => calculator.evaluate('1 +')).toThrow(CalculationError);
  });
});
