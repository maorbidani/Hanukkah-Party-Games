import 'dotenv/config';
import { GoogleGenAI } from '@google/genai';
import express from 'express';
import type { Request, Response } from 'express';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const PORT = Number(process.env.PORT) || 3000;
const IS_PRODUCTION = process.env.NODE_ENV === 'production';

interface TtsCacheEntry {
  audioBase64: string;
  mimeType: string;
}

const MAX_TTS_CACHE_ENTRIES = 80;
const ttsCache = new Map<string, TtsCacheEntry>();
const inFlightTts = new Map<string, Promise<TtsCacheEntry>>();

interface TtsCandidate {
  apiVersion?: string;
  model: string;
  useMetadata: boolean;
  useSpeechConfig: boolean;
}

const TTS_CANDIDATES: TtsCandidate[] = [
  { apiVersion: 'v1alpha', model: 'gemini-3.8-flash-lite-tts', useMetadata: true, useSpeechConfig: true },
  { apiVersion: 'v1alpha', model: 'gemini-3.8-flash-tts', useMetadata: true, useSpeechConfig: true },
  { apiVersion: 'v1beta', model: 'gemini-3.8-flash-lite-tts', useMetadata: false, useSpeechConfig: true },
];

let workingCandidateIndex = 0;
const webTtsCache = new Map<string, TtsCacheEntry>();
const inFlightWebTts = new Map<string, Promise<TtsCacheEntry>>();

function splitHebrewChunks(text: string, maxLen: number = 155): string[] {
  const cleaned = text.replace(/\s+/g, ' ').trim();
  if (cleaned.length <= maxLen) return [cleaned];

  const sentences = cleaned.split(/(?<=[.!?…,:;])\s+/);
  const chunks: string[] = [];
  let current = '';

  for (const sentence of sentences) {
    if (!sentence) continue;
    if ((current ? current + ' ' + sentence : sentence).length <= maxLen) {
      current = current ? `${current} ${sentence}` : sentence;
    } else {
      if (current) {
        chunks.push(current);
        current = '';
      }
      if (sentence.length <= maxLen) {
        current = sentence;
      } else {
        const words = sentence.split(' ');
        for (const word of words) {
          if ((current ? current + ' ' + word : word).length <= maxLen) {
            current = current ? `${current} ${word}` : word;
          } else {
            if (current) chunks.push(current);
            current = word.slice(0, maxLen);
          }
        }
      }
    }
  }
  if (current) chunks.push(current);
  return chunks;
}

async function generateWebHebrewTts(text: string): Promise<TtsCacheEntry> {
  const cached = webTtsCache.get(text);
  if (cached) return cached;

  const existing = inFlightWebTts.get(text);
  if (existing) return existing;

  const task = (async (): Promise<TtsCacheEntry> => {
    const chunks = splitHebrewChunks(text, 155);
    const buffers: Buffer[] = [];

    for (const chunk of chunks) {
      const url = `https://translate.google.com/translate_tts?ie=UTF-8&tl=iw&client=tw-ob&q=${encodeURIComponent(
        chunk
      )}`;
      const res = await fetch(url, {
        headers: {
          'User-Agent':
            'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36',
          Referer: 'https://translate.google.com/',
        },
      });
      if (!res.ok) {
        throw new Error(`Web TTS failed with HTTP ${res.status}`);
      }
      const arr = await res.arrayBuffer();
      if (arr.byteLength === 0) {
        throw new Error('Web TTS returned empty audio');
      }
      buffers.push(Buffer.from(arr));
    }

    const entry: TtsCacheEntry = {
      audioBase64: Buffer.concat(buffers).toString('base64'),
      mimeType: 'audio/mpeg',
    };
    if (webTtsCache.size >= MAX_TTS_CACHE_ENTRIES) {
      const oldestKey = webTtsCache.keys().next().value;
      if (oldestKey !== undefined) webTtsCache.delete(oldestKey);
    }
    webTtsCache.set(text, entry);
    return entry;
  })();

  inFlightWebTts.set(text, task);
  try {
    return await task;
  } finally {
    inFlightWebTts.delete(text);
  }
}

function getGeminiClient(apiVersion?: string): GoogleGenAI | null {
  const apiKey = process.env.GEMINI_API_KEY?.trim();
  if (!apiKey) return null;
  return new GoogleGenAI({
    apiKey,
    ...(apiVersion ? { apiVersion } : {}),
    httpOptions: {
      headers: {
        'User-Agent': 'aistudio-build',
      },
    },
  });
}

async function callTtsCandidate(text: string, candidate: TtsCandidate): Promise<TtsCacheEntry> {
  const ai = getGeminiClient(candidate.apiVersion);
  if (!ai) {
    const err = new Error('GEMINI_API_KEY is not configured');
    (err as Error & { statusCode?: number }).statusCode = 503;
    throw err;
  }

  const promptText = candidate.useMetadata
    ? text
    : `קרא בקול של קריין ספורט ואליפות סמכותי, עמוק, נלהב וברור בעברית: ${text}`;

  const part: Record<string, unknown> = candidate.useMetadata
    ? {
        text: promptText,
        speechMetadata: {
          style:
            'Deep, authoritative, energetic Hebrew championship MC announcer speaking clearly to kids and families',
        },
      }
    : { text: promptText };

  const config: Record<string, unknown> = {
    responseModalities: ['AUDIO'],
    ...(candidate.useSpeechConfig
      ? {
          speechConfig: {
            voiceConfig: {
              prebuiltVoiceConfig: { voiceName: 'Charon' },
            },
          },
        }
      : {}),
  };

  const response = await ai.models.generateContent({
    model: candidate.model,
    contents: [
      {
        role: 'user',
        parts: [part as never],
      },
    ],
    config: config as never,
  });

  const parts = response.candidates?.[0]?.content?.parts ?? [];
  const audioPart = parts.find((p) => p.inlineData?.data);
  const audioBase64 = audioPart?.inlineData?.data;
  const mimeType = audioPart?.inlineData?.mimeType || 'audio/wav';

  if (!audioBase64) {
    const err = new Error('No audio data returned by TTS model');
    (err as Error & { statusCode?: number }).statusCode = 502;
    throw err;
  }

  return { audioBase64, mimeType };
}

async function generateHebrewTts(text: string): Promise<TtsCacheEntry> {
  const cached = ttsCache.get(text);
  if (cached) return cached;

  const existingPromise = inFlightTts.get(text);
  if (existingPromise) return existingPromise;

  const task = (async (): Promise<TtsCacheEntry> => {
    const order = [
      workingCandidateIndex,
      ...TTS_CANDIDATES.map((_, i) => i).filter((i) => i !== workingCandidateIndex),
    ];

    let lastErr: unknown = null;

    for (const idx of order) {
      const candidate = TTS_CANDIDATES[idx];
      try {
        const entry = await callTtsCandidate(text, candidate);
        workingCandidateIndex = idx;
        if (ttsCache.size >= MAX_TTS_CACHE_ENTRIES) {
          const oldestKey = ttsCache.keys().next().value;
          if (oldestKey !== undefined) {
            ttsCache.delete(oldestKey);
          }
        }
        ttsCache.set(text, entry);
        return entry;
      } catch (err) {
        lastErr = err;
        const msg = err instanceof Error ? err.message : String(err);
        const statusCode =
          (err as { statusCode?: number; status?: number })?.statusCode ??
          (err as { status?: number })?.status;
        console.warn(
          `[TTS] Candidate #${idx} (${candidate.apiVersion || 'default'}/${candidate.model}) failed:`,
          msg.slice(0, 220)
        );
        // Stop probing immediately only if API key missing or forbidden
        if (statusCode === 503 || statusCode === 403) {
          throw err;
        }
      }
    }

    throw lastErr instanceof Error ? lastErr : new Error('All TTS candidates failed');
  })();

  inFlightTts.set(text, task);
  try {
    return await task;
  } finally {
    inFlightTts.delete(text);
  }
}

async function startServer() {
  const app = express();
  app.use(express.json({ limit: '16kb' }));

  app.post('/api/tts', async (req: Request, res: Response) => {
    const rawText = typeof req.body?.text === 'string' ? req.body.text.trim() : '';
    if (!rawText) {
      res.status(400).json({ error: 'Text is required' });
      return;
    }
    if (rawText.length > 600) {
      res.status(400).json({ error: 'Text too long (max 600 characters)' });
      return;
    }

    try {
      const entry = await generateHebrewTts(rawText);
      res.setHeader('Cache-Control', 'no-store');
      res.json(entry);
    } catch (err) {
      const errObj = err as { statusCode?: number; status?: number; message?: string };
      const status =
        errObj?.statusCode ||
        errObj?.status ||
        (errObj?.message?.includes('429') || errObj?.message?.includes('RESOURCE_EXHAUSTED')
          ? 429
          : errObj?.message?.includes('403') || errObj?.message?.includes('PERMISSION_DENIED')
          ? 403
          : 500);
      res.status(status).json({
        error: errObj?.message || 'Failed to generate speech audio',
      });
    }
  });

  app.post('/api/tts-web', async (req: Request, res: Response) => {
    const rawText = typeof req.body?.text === 'string' ? req.body.text.trim() : '';
    if (!rawText) {
      res.status(400).json({ error: 'Text is required' });
      return;
    }
    if (rawText.length > 600) {
      res.status(400).json({ error: 'Text too long (max 600 characters)' });
      return;
    }

    try {
      const entry = await generateWebHebrewTts(rawText);
      res.setHeader('Cache-Control', 'no-store');
      res.json(entry);
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Failed to fetch web TTS';
      res.status(502).json({ error: msg });
    }
  });

  if (!IS_PRODUCTION) {
    const { createServer: createViteServer } = await import('vite');
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: 'spa',
    });
    app.use(vite.middlewares);
  } else {
    const distDir = path.resolve(__dirname, 'dist');
    app.use(express.static(distDir));
    app.get('*', (_req: Request, res: Response) => {
      const indexFile = path.join(distDir, 'index.html');
      if (fs.existsSync(indexFile)) {
        res.sendFile(indexFile);
      } else {
        res.status(404).send('Build output not found');
      }
    });
  }

  app.listen(PORT, '0.0.0.0', () => {
    console.log(`Server listening on http://0.0.0.0:${PORT}`);
  });
}

startServer().catch((err) => {
  console.error('Failed to start server:', err);
  process.exit(1);
});
