import OpenAI from 'openai';
import { supabase } from '../lib/supabase.js';

export function chunkText(text: string, chunkSize = 500, overlap = 50): string[] {
  const paragraphs = text.split(/\n{2,}/).map(p => p.trim()).filter(Boolean);
  const chunks: string[] = [];
  let current: string[] = [];
  let wordCount = 0;

  for (const para of paragraphs) {
    const words = para.split(/\s+/);
    if (wordCount + words.length > chunkSize && current.length > 0) {
      chunks.push(current.join('\n\n'));
      const tail = current.join(' ').split(/\s+/).slice(-overlap).join(' ');
      current = tail ? [tail] : [];
      wordCount = overlap;
    }
    current.push(para);
    wordCount += words.length;
  }

  if (current.length > 0) chunks.push(current.join('\n\n'));
  return chunks.filter(c => c.trim().length > 0);
}

export async function embedTexts(texts: string[], apiKey: string): Promise<number[][]> {
  const client = new OpenAI({ apiKey });
  const BATCH = 100;
  const results: number[][] = [];

  for (let i = 0; i < texts.length; i += BATCH) {
    const batch = texts.slice(i, i + BATCH);
    const res = await client.embeddings.create({ model: 'text-embedding-3-small', input: batch });
    results.push(...res.data.map(d => d.embedding));
  }

  return results;
}

export async function retrieveTopK(
  botId: string,
  queryText: string,
  apiKey: string,
  k = 5,
): Promise<string[]> {
  const [embedding] = await embedTexts([queryText], apiKey);

  const { data, error } = await supabase.rpc('match_chunks', {
    query_embedding: embedding,
    match_bot_id: botId,
    match_count: k,
  });

  if (error || !data) return [];
  return (data as { content: string; similarity: number }[]).map(r => r.content);
}
