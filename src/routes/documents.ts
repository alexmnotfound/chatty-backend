import { Router } from 'express';
import multer from 'multer';
import { requireAuth } from '../middleware/auth.js';
import { getCompanyId } from '../middleware/tenant.js';
import { supabase } from '../lib/supabase.js';
import { decrypt } from '../lib/encryption.js';
import { chunkText, embedTexts } from '../services/rag.js';

export const documentsRouter = Router();
documentsRouter.use(requireAuth);

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 10 * 1024 * 1024 },
  fileFilter: (_req, file, cb) => {
    const ext = file.originalname.split('.').pop()?.toLowerCase();
    if (file.mimetype === 'application/pdf' || ext === 'pdf' || file.mimetype === 'text/plain' || ext === 'txt') {
      cb(null, true);
    } else {
      cb(new Error('Solo se aceptan archivos PDF o TXT'));
    }
  },
});

async function resolveApiKey(botId: string, companyId: string): Promise<string | null> {
  const { data: bot } = await supabase
    .from('bots')
    .select('ai_api_key_enc')
    .eq('id', botId)
    .eq('company_id', companyId)
    .maybeSingle();
  if (bot?.ai_api_key_enc) return decrypt(bot.ai_api_key_enc);

  const { data: cfg } = await supabase
    .from('company_config')
    .select('open_ai_api_key')
    .eq('company_id', companyId)
    .maybeSingle();
  return cfg?.open_ai_api_key ?? null;
}

documentsRouter.get('/:id/documents', async (req, res) => {
  const companyId = getCompanyId(req);
  const { data, error } = await supabase
    .from('bot_documents')
    .select('id, name, source_type, size_bytes, status, created_at')
    .eq('bot_id', req.params.id)
    .eq('company_id', companyId)
    .order('created_at', { ascending: false });

  if (error) return res.status(500).json({ error: 'Error al obtener documentos' });
  res.json(data ?? []);
});

documentsRouter.post('/:id/documents', upload.single('file'), async (req, res) => {
  const companyId = getCompanyId(req);
  const botId = req.params.id;

  const { data: bot } = await supabase
    .from('bots')
    .select('id')
    .eq('id', botId)
    .eq('company_id', companyId)
    .maybeSingle();
  if (!bot) return res.status(404).json({ error: 'Bot no encontrado' });

  const apiKey = await resolveApiKey(botId, companyId);
  if (!apiKey) return res.status(400).json({ error: 'No hay API key configurada' });

  let text: string;
  let name: string;
  let sourceType: 'pdf' | 'txt' | 'paste';
  let sizeBytes: number;

  if (req.file) {
    name = req.file.originalname;
    sizeBytes = req.file.size;
    const ext = name.split('.').pop()?.toLowerCase();
    if (ext === 'pdf') {
      sourceType = 'pdf';
      try {
        const { PDFParse } = await import('pdf-parse');
        const parser = new (PDFParse as any)({ data: req.file.buffer });
        const result = await parser.getText();
        text = result.pages.map((p: { text: string }) => p.text).join('\n');
        if (!text.trim()) throw new Error('empty');
      } catch {
        return res.status(422).json({ error: 'No se pudo leer el PDF. Verificá que no esté protegido.' });
      }
    } else {
      sourceType = 'txt';
      text = req.file.buffer.toString('utf-8');
    }
  } else if (typeof req.body?.text === 'string' && req.body.text.trim()) {
    text = req.body.text;
    name = typeof req.body.name === 'string' && req.body.name.trim() ? req.body.name : 'Texto pegado';
    sourceType = 'paste';
    sizeBytes = Buffer.byteLength(text, 'utf-8');
  } else {
    return res.status(400).json({ error: 'Se requiere un archivo o texto' });
  }

  const insertPayload: Record<string, unknown> = { bot_id: botId, company_id: companyId, name, source_type: sourceType, size_bytes: sizeBytes, status: 'processing' };
  if (sourceType === 'paste') insertPayload.content = text;

  const { data: doc, error: docErr } = await supabase
    .from('bot_documents')
    .insert(insertPayload)
    .select()
    .single();

  if (docErr || !doc) return res.status(500).json({ error: 'Error al guardar documento' });

  try {
    const chunks = chunkText(text);
    if (chunks.length === 0) {
      await supabase.from('bot_documents').update({ status: 'error' }).eq('id', doc.id);
      return res.status(422).json({ error: 'El documento no contiene texto útil' });
    }

    const embeddings = await embedTexts(chunks, apiKey);
    const rows = chunks.map((content, i) => ({
      document_id: doc.id,
      bot_id: botId,
      company_id: companyId,
      content,
      embedding: embeddings[i],
      chunk_index: i,
    }));

    const { error: chunkErr } = await supabase.from('document_chunks').insert(rows);
    if (chunkErr) throw chunkErr;

    await supabase.from('bot_documents').update({ status: 'active' }).eq('id', doc.id);
    res.status(201).json({ ...doc, status: 'active' });
  } catch {
    await supabase.from('bot_documents').update({ status: 'error' }).eq('id', doc.id);
    res.status(500).json({ error: 'Error al procesar el documento' });
  }
});

documentsRouter.get('/:id/documents/:docId/content', async (req, res) => {
  const companyId = getCompanyId(req);
  const { id: botId, docId } = req.params;

  const { data: doc } = await supabase
    .from('bot_documents')
    .select('id, source_type, content')
    .eq('id', docId)
    .eq('bot_id', botId)
    .eq('company_id', companyId)
    .maybeSingle();
  if (!doc) return res.status(404).json({ error: 'Documento no encontrado' });
  if (doc.source_type !== 'paste') return res.status(400).json({ error: 'Solo documentos de texto pegado' });

  if (doc.content) return res.json({ content: doc.content });

  // Fallback: reconstruct from chunks (docs created before content column existed)
  const { data: chunks } = await supabase
    .from('document_chunks')
    .select('content, chunk_index')
    .eq('document_id', docId)
    .order('chunk_index', { ascending: true });

  res.json({ content: (chunks ?? []).map(c => c.content).join('\n') });
});

documentsRouter.patch('/:id/documents/:docId', async (req, res) => {
  const companyId = getCompanyId(req);
  const { id: botId, docId } = req.params;

  const { data: doc } = await supabase
    .from('bot_documents')
    .select('id, source_type')
    .eq('id', docId)
    .eq('bot_id', botId)
    .eq('company_id', companyId)
    .maybeSingle();
  if (!doc) return res.status(404).json({ error: 'Documento no encontrado' });

  const { status, text, name } = req.body as { status?: string; text?: string; name?: string };

  // Toggle active/inactive
  if (status === 'active' || status === 'inactive') {
    const { data: updated, error } = await supabase
      .from('bot_documents')
      .update({ status })
      .eq('id', docId)
      .select()
      .single();
    if (error) return res.status(500).json({ error: 'Error al actualizar estado' });
    return res.json(updated);
  }

  // Re-process paste content
  if (typeof text === 'string' && text.trim() && doc.source_type === 'paste') {
    const apiKey = await resolveApiKey(botId, companyId);
    if (!apiKey) return res.status(400).json({ error: 'No hay API key configurada' });

    const docName = typeof name === 'string' && name.trim() ? name : 'Texto pegado';
    const sizeBytes = Buffer.byteLength(text, 'utf-8');

    await supabase.from('bot_documents')
      .update({ name: docName, size_bytes: sizeBytes, status: 'processing', content: text })
      .eq('id', docId);
    await supabase.from('document_chunks').delete().eq('document_id', docId);

    try {
      const chunks = chunkText(text);
      if (chunks.length === 0) {
        await supabase.from('bot_documents').update({ status: 'error' }).eq('id', docId);
        return res.status(422).json({ error: 'El documento no contiene texto útil' });
      }
      const embeddings = await embedTexts(chunks, apiKey);
      const rows = chunks.map((content, i) => ({
        document_id: docId, bot_id: botId, company_id: companyId,
        content, embedding: embeddings[i], chunk_index: i,
      }));
      await supabase.from('document_chunks').insert(rows);
      await supabase.from('bot_documents').update({ status: 'active' }).eq('id', docId);
      const { data: updated } = await supabase.from('bot_documents').select().eq('id', docId).single();
      return res.json(updated);
    } catch {
      await supabase.from('bot_documents').update({ status: 'error' }).eq('id', docId);
      return res.status(500).json({ error: 'Error al procesar el documento' });
    }
  }

  return res.status(400).json({ error: 'Cuerpo inválido' });
});

documentsRouter.delete('/:id/documents/:docId', async (req, res) => {
  const companyId = getCompanyId(req);
  const { error } = await supabase
    .from('bot_documents')
    .delete()
    .eq('id', req.params.docId)
    .eq('bot_id', req.params.id)
    .eq('company_id', companyId);

  if (error) return res.status(500).json({ error: 'Error al eliminar documento' });
  res.status(204).send();
});
