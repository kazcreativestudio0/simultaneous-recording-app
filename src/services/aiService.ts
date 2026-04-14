import { GoogleGenAI, Type } from "@google/genai";

const apiKey =
  import.meta.env.VITE_GEMINI_API_KEY ||
  process.env.GEMINI_API_KEY ||
  "";

const ai = new GoogleGenAI({ apiKey });

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

export async function analyzeConversation(transcript: string, currentNodes: ConversationNode[]): Promise<InsightData | null> {
  if (!transcript || transcript.length < 20) return null;

  try {
    const response = await ai.models.generateContent({
      model: "gemini-3-flash-preview",
      contents: `
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
      `,
      config: {
        responseMimeType: "application/json",
        responseSchema: {
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
        }
      }
    });

    return JSON.parse(response.text);
  } catch (error) {
    console.error("AI Analysis Error:", error);
    return null;
  }
}

export async function getTermDefinition(term: string): Promise<{ term: string; definition: string; detail?: string } | null> {
  try {
    const response = await ai.models.generateContent({
      model: "gemini-3-flash-preview",
      contents: `用語「${term}」について、IT/ビジネスの文脈で解説してください。
      
      出力形式 (JSON):
      {
        "term": "${term}",
        "definition": "一言でわかる簡潔な説明",
        "detail": "より詳細な背景や関連情報"
      }`,
      config: {
        responseMimeType: "application/json",
        responseSchema: {
          type: Type.OBJECT,
          properties: {
            term: { type: Type.STRING },
            definition: { type: Type.STRING },
            detail: { type: Type.STRING }
          },
          required: ['term', 'definition']
        }
      }
    });
    return JSON.parse(response.text);
  } catch (error) {
    console.error("Term Definition Error:", error);
    return null;
  }
}
