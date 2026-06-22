// Prices in USD per 1M tokens — update when provider pricing changes
const MODEL_RATES: Record<string, { input: number; output: number }> = {
  'gpt-4o-mini':               { input: 0.15,  output: 0.60  },
  'gpt-4o':                    { input: 2.50,  output: 10.00 },
  'gpt-4.1':                   { input: 2.00,  output: 8.00  },
  'gpt-4.1-mini':              { input: 0.40,  output: 1.60  },
  'claude-haiku-4-5-20251001': { input: 0.80,  output: 4.00  },
  'claude-sonnet-4-6':         { input: 3.00,  output: 15.00 },
  'claude-opus-4-8':           { input: 15.00, output: 75.00 },
  'claude-fable-5':            { input: 15.00, output: 75.00 },
};

export const SUPPORTED_MODELS = Object.keys(MODEL_RATES);

export function calculateCost(model: string, tokensIn: number, tokensOut: number): number {
  const rates = MODEL_RATES[model];
  if (!rates) return 0;
  return (tokensIn * rates.input + tokensOut * rates.output) / 1_000_000;
}
