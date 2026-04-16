import { useState, useEffect, useCallback, useRef } from 'react';
import { BrowserSpeechProvider } from '../services/transcriptionProviders/browserSpeechProvider';
import { ApiTranscriptionProvider } from '../services/transcriptionProviders/apiTranscriptionProvider';
import {
  TranscriptionProvider,
  TranscriptionSettings,
  TranscriptionStatus,
} from '../services/transcriptionProviders/types';

export interface TranscriptSegment {
  id: string;
  text: string;
  speaker: string;
  timestamp: number;
}

const LONG_SILENCE_MS = 15000;
const SHORT_PAUSE_MS = 1800;
const SHORT_PAUSE_MIN_CHARS = 10;
const INTERIM_GRACE_MS = 2200;

const appendChunk = (base: string, addition: string) => {
  const next = addition.replace(/\s+/g, ' ').trim();
  if (!next) return base;
  if (!base) return next;
  return `${base} ${next}`.replace(/\s+/g, ' ').trim();
};

const splitBySentenceBoundary = (text: string) => {
  const normalized = text.replace(/\s+/g, ' ').trim();
  if (!normalized) return { committed: [] as string[], remainder: '' };
  const parts = normalized.split(/(?<=[。！？!?])\s*/).filter(Boolean);
  const hasTerminalPunctuation = /[。！？!?]\s*$/.test(normalized);
  const committed = hasTerminalPunctuation ? parts : parts.slice(0, -1);
  const remainder = hasTerminalPunctuation ? '' : (parts[parts.length - 1] || '');
  return { committed, remainder };
};

const statusLabels: Record<TranscriptionStatus, string> = {
  idle: '待機中',
  listening: '認識中',
  reconnecting: '再接続中',
  processing: '音声解析中',
  'waiting-network': '回線待ち',
  fallback: '簡易モード',
};

export function useTranscription(settings: TranscriptionSettings) {
  const [isRecording, setIsRecording] = useState(false);
  const [transcript, setTranscript] = useState<TranscriptSegment[]>([]);
  const [interimText, setInterimText] = useState('');
  const [transcriptionStatus, setTranscriptionStatus] = useState<TranscriptionStatus>('idle');
  const isRecordingRef = useRef(false);
  const draftFinalBufferRef = useRef('');
  const shortPauseTimerRef = useRef<number | null>(null);
  const longSilenceTimerRef = useRef<number | null>(null);
  const interimGraceTimerRef = useRef<number | null>(null);
  const providerRef = useRef<TranscriptionProvider | null>(null);

  // Simulation Data
  const simulationData = [
    { text: "本日は、新しいSaaSプロダクトのロードマップについて話し合いたいと思います。", speaker: "田中", delay: 2000 },
    { text: "まず、第1四半期の目標はユーザー基盤の拡大です。", speaker: "田中", delay: 3000 },
    { text: "具体的には、紹介プログラムの導入を検討しています。", speaker: "田中", delay: 2500 },
    { text: "紹介プログラムのコストはどう見積もっていますか？", speaker: "佐藤", delay: 3000 },
    { text: "1ユーザー獲得あたり500円程度を想定しています。これはLTVを考えると妥当なラインです。", speaker: "田中", delay: 4000 },
    { text: "なるほど。LTV（ライフタイムバリュー）の計算根拠も後で確認させてください。", speaker: "佐藤", delay: 3500 },
    { text: "承知しました。次に、技術的な課題としてスケーラビリティの向上が挙げられます。", speaker: "田中", delay: 4000 },
  ];

  const simulationIndexRef = useRef(0);
  const simulationTimeoutRef = useRef<any>(null);

  const clearSilenceTimers = useCallback(() => {
    if (shortPauseTimerRef.current) {
      window.clearTimeout(shortPauseTimerRef.current);
      shortPauseTimerRef.current = null;
    }
    if (longSilenceTimerRef.current) {
      window.clearTimeout(longSilenceTimerRef.current);
      longSilenceTimerRef.current = null;
    }
    if (interimGraceTimerRef.current) {
      window.clearTimeout(interimGraceTimerRef.current);
      interimGraceTimerRef.current = null;
    }
  }, []);

  const pushCommittedSegment = useCallback((text: string) => {
    const cleaned = text.replace(/\s+/g, ' ').trim();
    if (!cleaned) return;
    setTranscript(prev => [...prev, {
      id: Math.random().toString(36).substr(2, 9),
      text: cleaned,
      speaker: 'You',
      timestamp: Date.now()
    }]);
  }, []);

  const flushCommittedByPunctuation = useCallback(() => {
    const { committed, remainder } = splitBySentenceBoundary(draftFinalBufferRef.current);
    if (committed.length === 0) return;
    committed.forEach(pushCommittedSegment);
    draftFinalBufferRef.current = remainder;
    setInterimText(draftFinalBufferRef.current);
  }, [pushCommittedSegment]);

  const syncLiveDraft = useCallback((interim = '') => {
    const liveDraft = appendChunk(draftFinalBufferRef.current, interim);
    setInterimText(liveDraft);
  }, []);

  const flushAllDraft = useCallback(() => {
    const cleaned = draftFinalBufferRef.current.replace(/\s+/g, ' ').trim();
    if (!cleaned) return;
    pushCommittedSegment(cleaned);
    draftFinalBufferRef.current = '';
    setInterimText('');
  }, [pushCommittedSegment]);

  const restartActivityTimers = useCallback(() => {
    if (!isRecordingRef.current) return;

    if (shortPauseTimerRef.current) {
      window.clearTimeout(shortPauseTimerRef.current);
    }
    shortPauseTimerRef.current = window.setTimeout(() => {
      const currentDraft = draftFinalBufferRef.current.replace(/\s+/g, ' ').trim();
      if (currentDraft.length >= SHORT_PAUSE_MIN_CHARS) {
        pushCommittedSegment(currentDraft);
        draftFinalBufferRef.current = '';
        setInterimText('');
      }
    }, SHORT_PAUSE_MS);

    if (interimGraceTimerRef.current) {
      window.clearTimeout(interimGraceTimerRef.current);
    }
    interimGraceTimerRef.current = window.setTimeout(() => {
      syncLiveDraft();
    }, INTERIM_GRACE_MS);

    if (longSilenceTimerRef.current) {
      window.clearTimeout(longSilenceTimerRef.current);
    }
    longSilenceTimerRef.current = window.setTimeout(() => {
      flushAllDraft();
    }, LONG_SILENCE_MS);
  }, [flushAllDraft, pushCommittedSegment, syncLiveDraft]);

  const startSimulation = useCallback(() => {
    simulationIndexRef.current = 0;
    const next = () => {
      if (simulationIndexRef.current >= simulationData.length) {
        setIsRecording(false);
        return;
      }
      const item = simulationData[simulationIndexRef.current];
      setTranscript(prev => [...prev, {
        id: Math.random().toString(36).substr(2, 9),
        text: item.text,
        speaker: item.speaker,
        timestamp: Date.now()
      }]);
      simulationIndexRef.current++;
      simulationTimeoutRef.current = setTimeout(next, item.delay);
    };
    next();
  }, []);

  const createProvider = useCallback((): TranscriptionProvider => {
    const handlers = {
      onInterim: (text: string) => {
        syncLiveDraft(text);
      },
      onFinal: (text: string) => {
        const cleaned = text.replace(/\s+/g, ' ').trim();
        if (!cleaned) return;
        draftFinalBufferRef.current = appendChunk(draftFinalBufferRef.current, cleaned);
        flushCommittedByPunctuation();
        syncLiveDraft();
      },
      onStatusChange: (status: TranscriptionStatus) => {
        setTranscriptionStatus(status);
      },
      onActivity: () => {
        restartActivityTimers();
      },
      onError: (error: unknown) => {
        console.error('Transcription provider error', error);
      },
    };

    if (settings.transcriptionMode === 'high-accuracy') {
      return new ApiTranscriptionProvider(handlers, settings.networkMode);
    }
    return new BrowserSpeechProvider(handlers);
  }, [
    flushCommittedByPunctuation,
    restartActivityTimers,
    settings.networkMode,
    settings.transcriptionMode,
    syncLiveDraft,
  ]);

  const startRecording = useCallback(() => {
    draftFinalBufferRef.current = '';
    setInterimText('');
    isRecordingRef.current = true;
    setIsRecording(true);
    const provider = createProvider();
    providerRef.current = provider;

    provider.start()
      .then(() => {
        restartActivityTimers();
      })
      .catch((error) => {
        console.error('Unable to start transcription provider', error);
        const fallbackProvider = new BrowserSpeechProvider({
          onInterim: (text) => syncLiveDraft(text),
          onFinal: (text) => {
            const cleaned = text.replace(/\s+/g, ' ').trim();
            if (!cleaned) return;
            draftFinalBufferRef.current = appendChunk(draftFinalBufferRef.current, cleaned);
            flushCommittedByPunctuation();
            syncLiveDraft();
          },
          onStatusChange: (status) => setTranscriptionStatus(status === 'idle' ? 'fallback' : status),
          onActivity: () => restartActivityTimers(),
          onError: (fallbackError) => {
            console.error('Fallback browser provider error', fallbackError);
            setTranscriptionStatus('fallback');
            startSimulation();
          },
        });
        providerRef.current = fallbackProvider;
        fallbackProvider.start().catch(() => {
          setTranscriptionStatus('fallback');
          startSimulation();
        });
      });
  }, [createProvider, flushCommittedByPunctuation, restartActivityTimers, startSimulation, syncLiveDraft]);

  const stopRecording = useCallback(() => {
    isRecordingRef.current = false;
    setIsRecording(false);
    clearSilenceTimers();
    flushAllDraft();
    void providerRef.current?.stop();
    providerRef.current = null;
    if (simulationTimeoutRef.current) {
      clearTimeout(simulationTimeoutRef.current);
    }
    setTranscriptionStatus('idle');
  }, [clearSilenceTimers, flushAllDraft]);

  useEffect(() => {
    return () => {
      isRecordingRef.current = false;
      clearSilenceTimers();
      void providerRef.current?.stop();
    };
  }, [clearSilenceTimers]);

  return {
    isRecording,
    transcript,
    interimText,
    transcriptionStatus,
    transcriptionStatusLabel: statusLabels[transcriptionStatus],
    startRecording,
    stopRecording
  };
}
