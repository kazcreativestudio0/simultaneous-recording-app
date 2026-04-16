import { GoogleGenAI, Type } from "@google/genai";

const apiKey =
  import.meta.env.VITE_GEMINI_API_KEY ||
  process.env.GEMINI_API_KEY ||
  "";

const ai = new GoogleGenAI({ apiKey });
const ANALYZE_TIMEOUT_MS = 15000;
const ANALYZE_MAX_RETRIES = 3;
const RETRYABLE_ERROR_CODES = [429, 500, 502, 503, 504];

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

const withTimeout = async <T>(promise: Promise<T>, timeoutMs: number): Promise<T> => {
  let timer: number | null = null;
  const timeoutPromise = new Promise<never>((_, reject) => {
    timer = window.setTimeout(() => {
      reject(new Error(`AI request timed out after ${timeoutMs}ms`));
    }, timeoutMs);
  });

  try {
    return await Promise.race([promise, timeoutPromise]);
  } finally {
    if (timer) window.clearTimeout(timer);
  }
};

const getStatusCodeFromError = (error: unknown): number | null => {
  if (!error || typeof error !== 'object') return null;
  const maybeStatus = (error as any).status ?? (error as any).statusCode;
  return typeof maybeStatus === 'number' ? maybeStatus : null;
};

const isRetryableError = (error: unknown): boolean => {
  const statusCode = getStatusCodeFromError(error);
  if (statusCode !== null) {
    return RETRYABLE_ERROR_CODES.includes(statusCode);
  }
  if (error instanceof Error) {
    return /timed out|network|fetch/i.test(error.message);
  }
  return false;
};

const generateJsonWithRetries = async <T>(contents: string, responseSchema: any): Promise<T | null> => {
  const modelName = "gemini-3-flash-preview";

  for (let attempt = 0; attempt < ANALYZE_MAX_RETRIES; attempt++) {
    try {
      const response = await withTimeout(
        ai.models.generateContent({
          model: modelName,
          contents,
          config: {
            responseMimeType: "application/json",
            responseSchema
          }
        }),
        ANALYZE_TIMEOUT_MS
      );

      return JSON.parse(response.text) as T;
    } catch (error) {
      const isLastAttempt = attempt === ANALYZE_MAX_RETRIES - 1;
      if (!isRetryableError(error) || isLastAttempt) {
        console.error(`AI request failed for ${modelName}:`, error);
        return null;
      }
      const baseDelay = 800 * Math.pow(2, attempt);
      const jitter = Math.floor(Math.random() * 400);
      await sleep(baseDelay + jitter);
    }
  }

  return null;
};

export interface ConversationNode {
  id: string;
  type: 'topic' | 'reason' | 'example' | 'supplement' | 'summary';
  text: string;
  shortLabel: string;
  parentId?: string;
  sourceSegmentIds?: string[]; 
  sourceTextSnippet?: string; // The specific phrase in the transcript this node is based on
}

export interface InsightData {
  summary: string;
  nodes: ConversationNode[]; 
  keyTerms: { term: string; definition: string; detail?: string }[];
}

export async function analyzeConversation(
  transcript: string,
  currentNodes: ConversationNode[]
): Promise<InsightData | null> {
  if (!transcript || transcript.length < 20) return null;

  const prompt = `
        あなたは会話の論理構造をリアルタイムで図解するエキスパートです。
        以下の会話テキストと現在のマップ構造を元に、最新の論理構造マップ（フルセット）を作成してください。

        ## 会話テキスト (発言ID付き):
        ${transcript}
        
        ## 現在のマップ構造:
        ${JSON.stringify(currentNodes)}
        
        ## 指示:
        1. **論理的整合性の維持**: 新しい情報が入った際、既存のノードの親子関係や内容、タイプを変更して、全体として最も論理的なツリー構造（左から右へ展開）を維持してください。
        2. **ノードの統合**: 関連する話題が増えたら、それらをまとめる "summary" ノードを左側に追加し、既存ノードをその子として再配置してください。
        3. **ソースの紐付け**: 各ノードがどの発言（ID）に基づいているかを "sourceSegmentIds" に含め、さらにその発言内の**どのフレーズ（sourceTextSnippet）**が根拠になっているかを正確に抜き出してください。
        4. **ラベル**: shortLabelは10文字以内の簡潔な言葉。
        5. **用語解説**: 重要な用語には簡潔な definition と、より深い背景を説明する detail を含めてください。
        6. **出力**: 既存のノードも含め、最終的な**全てのノード**のリストを返してください。

        ## 出力形式 (JSON):
        {
          "summary": "要約",
          "nodes": [
            { 
              "id": "unique_id", 
              "type": "topic|reason|example|supplement|summary", 
              "text": "詳細内容", 
              "shortLabel": "短いラベル",
              "parentId": "親ID",
              "sourceSegmentIds": ["segment_id_1"],
              "sourceTextSnippet": "根拠となる具体的な発言フレーズ"
            }
          ],
          "keyTerms": [{ "term": "用語", "definition": "簡潔な説明", "detail": "詳細な背景" }]
        }
      `;

  return generateJsonWithRetries<InsightData>(prompt, {
    type: Type.OBJECT,
    properties: {
      summary: { type: Type.STRING },
      nodes: {
        type: Type.ARRAY,
        items: {
          type: Type.OBJECT,
          properties: {
            id: { type: Type.STRING },
            type: { type: Type.STRING, enum: ['topic', 'reason', 'example', 'supplement', 'summary'] },
            text: { type: Type.STRING },
            shortLabel: { type: Type.STRING },
            parentId: { type: Type.STRING },
            sourceSegmentIds: { type: Type.ARRAY, items: { type: Type.STRING } },
            sourceTextSnippet: { type: Type.STRING }
          },
          required: ['id', 'type', 'text', 'shortLabel']
        }
      },
      keyTerms: {
        type: Type.ARRAY,
        items: {
          type: Type.OBJECT,
          properties: {
            term: { type: Type.STRING },
            definition: { type: Type.STRING },
            detail: { type: Type.STRING }
          },
          required: ['term', 'definition']
        }
      }
    },
    required: ['summary', 'nodes', 'keyTerms']
  });
}

export async function getTermDefinition(
  term: string
): Promise<{ term: string; definition: string; detail?: string } | null> {
  return generateJsonWithRetries(`用語「${term}」について、IT/ビジネスの文脈で解説してください。
      
      出力形式 (JSON):
      {
        "term": "${term}",
        "definition": "一言でわかる簡潔な説明",
        "detail": "より詳細な背景や関連情報"
      }`, {
    type: Type.OBJECT,
    properties: {
      term: { type: Type.STRING },
      definition: { type: Type.STRING },
      detail: { type: Type.STRING }
    },
    required: ['term', 'definition']
  });
}
