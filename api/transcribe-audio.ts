import { GoogleGenAI } from '@google/genai';

const apiKey = process.env.GEMINI_API_KEY || process.env.VITE_GEMINI_API_KEY || '';
const ai = new GoogleGenAI({ apiKey });

export default async function handler(req: any, res: any) {
  if (req.method !== 'POST') {
    res.status(405).json({ error: 'Method not allowed' });
    return;
  }

  if (!apiKey) {
    res.status(500).json({ error: 'GEMINI_API_KEY is not configured.' });
    return;
  }

  try {
    const { base64Audio, mimeType } = req.body || {};
    if (!base64Audio || !mimeType) {
      res.status(400).json({ error: 'base64Audio and mimeType are required.' });
      return;
    }

    const response = await ai.models.generateContent({
      model: 'gemini-2.5-flash',
      contents: [
        {
          role: 'user',
          parts: [
            {
              text: '次の日本語音声を、説明や装飾なしでそのまま自然な日本語として文字起こししてください。聞き取れない場合は空文字を返してください。'
            },
            {
              inlineData: {
                mimeType,
                data: base64Audio,
              },
            },
          ],
        },
      ],
    });

    res.status(200).json({ text: (response.text || '').trim() });
  } catch (error: any) {
    res.status(500).json({
      error: 'Failed to transcribe audio.',
      detail: error?.message || 'Unknown error',
    });
  }
}
