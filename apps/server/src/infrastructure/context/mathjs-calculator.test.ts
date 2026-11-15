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
    expect(() => calculator.evaluate('config({ precision: 1e9 })')).toThrow(CalculationError);
    expect(() => calculator.evaluate('7 / 0')).toThrow(CalculationError);
    expect(() => calculator.evaluate('1 +')).toThrow(CalculationError);
  });

  test('refuses at once what would hold the server: huge ranges, matrices, exact numbers, recursion', () => {
    expect(() => calculator.evaluate('sum(1:1e9)')).toThrow('1000 elements at most');
    expect(() => calculator.evaluate('zeros(1e5, 1e5)')).toThrow(CalculationError);
    expect(() => calculator.evaluate('x = 1:1000; transpose([x]) * [x]')).toThrow(CalculationError);
    expect(() => calculator.evaluate('x = [1]; x[1e9] = 2')).toThrow(CalculationError);
    expect(() => calculator.evaluate('bigint(2) ^ bigint(1e9)')).toThrow(CalculationError);
    expect(() => calculator.evaluate('factorial(bignumber(1e7))')).toThrow(CalculationError);
    expect(() => calculator.evaluate('f(n) = n < 2 ? n : f(n - 1) + f(n - 2); f(40)')).toThrow(CalculationError);
    expect(() => calculator.evaluate('matrix([1]).resize([1e5, 1e5])')).toThrow(CalculationError);
  });

  test('still computes ranges, matrices and exact numbers of a household size', () => {
    expect(calculator.evaluate('sum(1:100)')).toBe('5050');
    expect(calculator.evaluate('map(1:3, square)')).toBe('[1, 4, 9]');
    expect(calculator.evaluate('[[1, 2], [3, 4]] * [[5], [6]]')).toBe('[[17], [39]]');
    expect(calculator.evaluate('combinations(10, 3)')).toBe('120');
    expect(calculator.evaluate('bigint(2) ^ bigint(100)')).toBe('1267650600228229401496703205376');
  });
});
