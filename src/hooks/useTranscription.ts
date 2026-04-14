import { useState, useEffect, useCallback, useRef } from 'react';

export interface TranscriptSegment {
  id: string;
  text: string;
  speaker: string;
  timestamp: number;
}

export function useTranscription() {
  const [isRecording, setIsRecording] = useState(false);
  const [transcript, setTranscript] = useState<TranscriptSegment[]>([]);
  const [interimText, setInterimText] = useState('');
  const recognitionRef = useRef<any>(null);

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

  const startRecording = useCallback(() => {
    setIsRecording(true);
    
    // Try Web Speech API
    const SpeechRecognition = (window as any).SpeechRecognition || (window as any).webkitSpeechRecognition;
    if (SpeechRecognition) {
      const recognition = new SpeechRecognition();
      recognition.continuous = true;
      recognition.interimResults = true;
      recognition.lang = 'ja-JP';

      recognition.onresult = (event: any) => {
        let interim = '';
        for (let i = event.resultIndex; i < event.results.length; ++i) {
          if (event.results[i].isFinal) {
            const text = event.results[i][0].transcript;
            setTranscript(prev => [...prev, {
              id: Math.random().toString(36).substr(2, 9),
              text,
              speaker: 'You',
              timestamp: Date.now()
            }]);
          } else {
            interim += event.results[i][0].transcript;
          }
        }
        setInterimText(interim);
      };

      recognition.onerror = (event: any) => {
        console.error('Speech recognition error', event.error);
        if (event.error === 'not-allowed') {
          // Fallback to simulation if permission denied (common in iframes)
          startSimulation();
        }
      };

      recognition.onend = () => {
        // Auto-restart if still recording
        if (isRecording) recognition.start();
      };

      recognitionRef.current = recognition;
      try {
        recognition.start();
      } catch (e) {
        startSimulation();
      }
    } else {
      // Fallback to simulation
      startSimulation();
    }
  }, [isRecording, startSimulation]);

  const stopRecording = useCallback(() => {
    setIsRecording(false);
    if (recognitionRef.current) {
      recognitionRef.current.stop();
    }
    if (simulationTimeoutRef.current) {
      clearTimeout(simulationTimeoutRef.current);
    }
  }, []);

  return {
    isRecording,
    transcript,
    interimText,
    startRecording,
    stopRecording
  };
}
