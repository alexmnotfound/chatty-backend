import OpenAI from "openai";
import { prisma } from "../lib/prisma.js";

async function getOpenAiApiKey() {
  const cfg = await prisma.appConfig.findUnique({ where: { id: 1 } });
  return cfg?.openAiApiKey || process.env.OPENAI_API_KEY || "";
}

export async function getAiReply(
  systemPrompt: string,
  messages: { role: "user" | "assistant"; content: string }[]
): Promise<string> {
  const apiKey = await getOpenAiApiKey();
  if (!apiKey) {
    return "Lo siento, el asistente no está configurado (falta OPENAI_API_KEY). Un humano te atenderá pronto.";
  }
  const openai = new OpenAI({ apiKey });
  const openAiMessages: OpenAI.Chat.Completions.ChatCompletionMessageParam[] = [
    { role: "system", content: systemPrompt + "\n\nResponde siempre en español y de forma breve." },
    ...messages,
  ];

  console.log("[OpenAI] Request", {
    model: "gpt-4o-mini",
    messagesCount: openAiMessages.length,
  });

  try {
    const response = await openai.chat.completions.create({
      model: "gpt-4o-mini",
      messages: openAiMessages,
      max_tokens: 500,
    });
    const content = response.choices[0]?.message?.content?.trim();
    console.log("[OpenAI] Response", {
      id: response.id,
      usage: response.usage ?? null,
      hasContent: Boolean(content),
    });
    return content ?? "No pude generar una respuesta. ¿Podés repetir?";
  } catch (error) {
    console.error("[OpenAI] Error", error);
    return "Lo siento, tuve un problema al generar la respuesta. Un humano te atenderá pronto.";
  }
}

export function buildHistoryFromMessages(
  messages: { direction: string; body: string; fromAi: boolean }[]
): { role: "user" | "assistant"; content: string }[] {
  return messages.map((m) => ({
    role: (m.direction === "in" || m.fromAi === false ? "user" : "assistant") as "user" | "assistant",
    content: m.body,
  }));
}
