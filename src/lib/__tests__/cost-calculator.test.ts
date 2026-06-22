import { describe, it, expect } from 'vitest';
import { calculateCost, SUPPORTED_MODELS } from '../cost-calculator';

describe('calculateCost', () => {
  it('gpt-4o-mini: 1M input + 1M output', () => {
    const cost = calculateCost('gpt-4o-mini', 1_000_000, 1_000_000);
    expect(cost).toBeCloseTo(0.75, 5); // $0.15 in + $0.60 out
  });

  it('returns 0 for unknown model', () => {
    expect(calculateCost('unknown-model', 1000, 1000)).toBe(0);
  });

  it('SUPPORTED_MODELS includes openai and claude models', () => {
    expect(SUPPORTED_MODELS).toContain('gpt-4o-mini');
    expect(SUPPORTED_MODELS).toContain('claude-haiku-4-5-20251001');
  });

  it('gpt-4o: correct rate', () => {
    const cost = calculateCost('gpt-4o', 1_000_000, 0);
    expect(cost).toBeCloseTo(2.50, 5);
  });

  it('claude-haiku: correct rate', () => {
    const cost = calculateCost('claude-haiku-4-5-20251001', 1_000_000, 0);
    expect(cost).toBeCloseTo(0.80, 5);
  });

  it('claude-sonnet-4-6: correct rate', () => {
    const cost = calculateCost('claude-sonnet-4-6', 1_000_000, 0);
    expect(cost).toBeCloseTo(3.00, 5);
  });

  it('claude-fable-5: correct rate', () => {
    const cost = calculateCost('claude-fable-5', 1_000_000, 0);
    expect(cost).toBeCloseTo(15.00, 5);
  });
});

describe('nuevos modelos', () => {
  it('gpt-4.1 calcula costo correctamente', () => {
    const cost = calculateCost('gpt-4.1', 1_000_000, 1_000_000);
    expect(cost).toBeCloseTo(2.00 + 8.00);
  });

  it('gpt-4.1-mini calcula costo correctamente', () => {
    const cost = calculateCost('gpt-4.1-mini', 1_000_000, 1_000_000);
    expect(cost).toBeCloseTo(0.40 + 1.60);
  });

  it('claude-opus-4-8 calcula costo correctamente', () => {
    const cost = calculateCost('claude-opus-4-8', 1_000_000, 1_000_000);
    expect(cost).toBeCloseTo(15.00 + 75.00);
  });
});
