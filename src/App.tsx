import Editor from "@monaco-editor/react";
import { useEffect, useMemo, useRef, useState } from "react";
import { createRoot } from "react-dom/client";

type TimelineEvent = {
  time: number;
  code: string;
};

const timeline: TimelineEvent[] = [
  {
    time: 0,
    code: `<main>
  <h1>Hello</h1>
</main>`
  },
  {
    time: 1600,
    code: `<main>
  <h1>Hello World</h1>
  <p>We are building in the browser.</p>
</main>`
  },
  {
    time: 3200,
    code: `<main>
  <h1>Hello World</h1>
  <p>We are building in the browser.</p>
  <button>Run lesson</button>
</main>`
  },
  {
    time: 4800,
    code: `<style>
  body { font-family: Inter, system-ui, sans-serif; background: #101820; color: white; }
  main { display: grid; place-items: center; min-height: 100vh; gap: 12px; }
  button { border: 0; border-radius: 6px; padding: 10px 14px; background: #16a34a; color: white; }
</style>
<main>
  <h1>Hello World</h1>
  <p>We are building in the browser.</p>
  <button>Run lesson</button>
</main>`
  },
  {
    time: 6400,
    code: `<style>
  body { font-family: Inter, system-ui, sans-serif; background: #101820; color: white; }
  main { display: grid; place-items: center; min-height: 100vh; gap: 12px; text-align: center; }
  h1 { font-size: 48px; margin: 0; }
  button { border: 0; border-radius: 6px; padding: 10px 14px; background: #16a34a; color: white; }
</style>
<main>
  <h1>Hello World 🚀</h1>
  <p>Scrub the timeline to replay each code state.</p>
  <button>Run lesson</button>
</main>`
  }
];

const duration = timeline[timeline.length - 1].time;

function codeAt(percent: number) {
  const currentTime = (percent / 100) * duration;
  return [...timeline].reverse().find((event) => event.time <= currentTime)?.code ?? timeline[0].code;
}

function percentAt(time: number) {
  return Math.min(100, Math.round((time / duration) * 100));
}

function PlaybackControls({
  isPlaying,
  progress,
  onPlayPause,
  onScrub
}: {
  isPlaying: boolean;
  progress: number;
  onPlayPause: () => void;
  onScrub: (progress: number) => void;
}) {
  return (
    <div className="transport">
      <button type="button" onClick={onPlayPause}>
        {isPlaying ? "Pause" : "Play"}
      </button>
      <input
        aria-label="Timeline"
        type="range"
        min="0"
        max="100"
        value={progress}
        onChange={(event) => onScrub(Number(event.target.value))}
      />
      <span>{progress}%</span>
    </div>
  );
}

function CodeEditor({ code, onChange }: { code: string; onChange: (code: string) => void }) {
  return (
    <Editor
      height="100%"
      defaultLanguage="html"
      theme="vs-dark"
      value={code}
      options={{ minimap: { enabled: false }, fontSize: 14, wordWrap: "on" }}
      onChange={(value) => onChange(value ?? "")}
    />
  );
}

function Preview({ code }: { code: string }) {
  const srcDoc = useMemo(() => code, [code]);
  return <iframe title="Live preview" sandbox="allow-scripts" srcDoc={srcDoc} />;
}

function App() {
  const [progress, setProgress] = useState(0);
  const [code, setCode] = useState(timeline[0].code);
  const [isPlaying, setIsPlaying] = useState(false);
  const startedAt = useRef(0);
  const startOffset = useRef(0);

  useEffect(() => {
    if (!isPlaying) return;

    startedAt.current = performance.now();
    startOffset.current = (progress / 100) * duration;

    let frame = 0;
    const tick = (now: number) => {
      const elapsed = startOffset.current + now - startedAt.current;
      const nextProgress = percentAt(elapsed);

      setProgress(nextProgress);
      setCode(codeAt(nextProgress));

      if (elapsed >= duration) {
        setIsPlaying(false);
        return;
      }

      frame = requestAnimationFrame(tick);
    };

    frame = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(frame);
  }, [isPlaying]);

  const scrub = (nextProgress: number) => {
    setIsPlaying(false);
    setProgress(nextProgress);
    setCode(codeAt(nextProgress));
  };

  const playPause = () => {
    if (isPlaying) {
      setIsPlaying(false);
      return;
    }

    if (progress >= 100) {
      setProgress(0);
      setCode(codeAt(0));
    }

    setIsPlaying(true);
  };

  return (
    <>
      <style>{`
        * { box-sizing: border-box; }
        body { margin: 0; font-family: Inter, ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif; background: #171717; color: #f5f5f5; }
        #root { min-height: 100vh; }
        .app { display: grid; grid-template-rows: auto auto 1fr; min-height: 100vh; }
        header { padding: 18px 22px 10px; border-bottom: 1px solid #2f2f2f; }
        h1 { margin: 0; font-size: 22px; font-weight: 700; }
        header p { margin: 6px 0 0; color: #b9b9b9; }
        .transport { display: grid; grid-template-columns: 88px 1fr 48px; gap: 14px; align-items: center; padding: 14px 22px; border-bottom: 1px solid #2f2f2f; background: #202020; }
        button { height: 36px; border: 1px solid #3f3f46; border-radius: 6px; background: #2563eb; color: white; font-weight: 700; cursor: pointer; }
        button:hover { background: #1d4ed8; }
        input[type="range"] { width: 100%; accent-color: #22c55e; }
        .stage { display: grid; grid-template-columns: minmax(0, 1fr) minmax(320px, 42vw); min-height: 0; }
        .pane { min-height: 0; border-right: 1px solid #2f2f2f; }
        .preview { display: grid; grid-template-rows: 38px 1fr; min-height: 0; background: #f8fafc; color: #171717; }
        .preview-bar { display: flex; align-items: center; padding: 0 12px; border-bottom: 1px solid #d4d4d8; font-size: 13px; font-weight: 700; }
        iframe { width: 100%; height: 100%; border: 0; background: white; }
        @media (max-width: 800px) {
          .stage { grid-template-columns: 1fr; grid-template-rows: 52vh 42vh; }
          .pane { border-right: 0; border-bottom: 1px solid #2f2f2f; }
          .transport { grid-template-columns: 76px 1fr 44px; padding: 12px; gap: 10px; }
          header { padding: 14px 12px 8px; }
        }
      `}</style>
      <div className="app">
        <header>
          <h1>Scrimba-Style Timeline</h1>
          <p>Replay code states, scrub the lesson, then pause and edit freely.</p>
        </header>

        <PlaybackControls
          isPlaying={isPlaying}
          progress={progress}
          onPlayPause={playPause}
          onScrub={scrub}
        />

        <main className="stage">
          <section className="pane" aria-label="Code editor">
            <CodeEditor code={code} onChange={setCode} />
          </section>
          <section className="preview" aria-label="Preview">
            <div className="preview-bar">Live preview</div>
            <Preview code={code} />
          </section>
        </main>
      </div>
    </>
  );
}

createRoot(document.getElementById("root")!).render(<App />);
