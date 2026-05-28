import Editor, { type OnMount } from "@monaco-editor/react";
import type * as Monaco from "monaco-editor";
import { useEffect, useMemo, useRef, useState } from "react";
import { createRoot } from "react-dom/client";

const FILE_ID = "index.html";
const CHECKPOINT_INTERVAL_MS = 5000;
const CHECKPOINT_EDIT_LIMIT = 200;
const CURSOR_DEBOUNCE_MS = 80;
const SCROLL_THROTTLE_MS = 150;

type PlainPosition = {
  lineNumber: number;
  column: number;
};

type PlainSelection = {
  selectionStartLineNumber: number;
  selectionStartColumn: number;
  positionLineNumber: number;
  positionColumn: number;
};

type CursorEvent = {
  type: "cursor";
  timestamp: number;
  fileId: string;
  position: PlainPosition;
  selection?: PlainSelection;
};

type TextEdit = {
  rangeOffset: number;
  rangeLength: number;
  text: string;
};

type FileState = {
  activeFileId: string;
  openFileIds: string[];
};

type FrameEvent = {
  type: "frame";
  timestamp: number;
  fileId: string;
  edits?: TextEdit[];
  cursor?: PlainPosition;
  selection?: PlainSelection;
  scrollTop?: number;
};

type ScrimEvent = FrameEvent | CursorEvent;

type EditorSnapshot = {
  code: string;
  cursor: PlainPosition;
  selection: PlainSelection;
  scrollTop: number;
  files: FileState;
};

type Checkpoint = {
  timestamp: number;
  snapshot: EditorSnapshot;
  lastAppliedEventIndex: number;
};

const starterCode = `<style>
  body { font-family: Inter, system-ui, sans-serif; background: #101820; color: white; }
  main { display: grid; place-items: center; min-height: 100vh; gap: 12px; text-align: center; }
  h1 { font-size: 48px; margin: 0; }
  button { border: 0; border-radius: 6px; padding: 10px 14px; background: #16a34a; color: white; }
</style>
<main>
  <h1>Hello World</h1>
  <p>Record semantic editor events, then replay them as an editable lesson.</p>
  <button>Run lesson</button>
</main>`;

const initialSelection: PlainSelection = {
  selectionStartLineNumber: 1,
  selectionStartColumn: 1,
  positionLineNumber: 1,
  positionColumn: 1
};

const initialCursor: PlainPosition = { lineNumber: 1, column: 1 };

function cloneSnapshot(snapshot: EditorSnapshot): EditorSnapshot {
  return {
    code: snapshot.code,
    cursor: { ...snapshot.cursor },
    selection: { ...snapshot.selection },
    scrollTop: snapshot.scrollTop,
    files: {
      activeFileId: snapshot.files.activeFileId,
      openFileIds: [...snapshot.files.openFileIds]
    }
  };
}

function clampTime(value: number, max: number) {
  if (max <= 0) return 0;
  return Math.min(Math.max(value, 0), max);
}

function applyTextEdits(code: string, edits: TextEdit[]) {
  return edits.reduce((nextCode, edit) => {
    const start = edit.rangeOffset;
    const end = start + edit.rangeLength;
    return `${nextCode.slice(0, start)}${edit.text}${nextCode.slice(end)}`;
  }, code);
}

function getEventCursor(event: ScrimEvent) {
  return event.type === "cursor" ? event.position : event.cursor;
}

function getEventSelection(event: ScrimEvent) {
  return event.selection;
}

function getEventEdits(event: ScrimEvent) {
  return event.type === "frame" ? event.edits : undefined;
}

function getEventScrollTop(event: ScrimEvent) {
  return event.type === "frame" ? event.scrollTop : undefined;
}

function applyFrameEvent(snapshot: EditorSnapshot, event: ScrimEvent): EditorSnapshot {
  const next = cloneSnapshot(snapshot);
  const edits = getEventEdits(event);
  const cursor = getEventCursor(event);
  const selection = getEventSelection(event);
  const scrollTop = getEventScrollTop(event);

  if (edits?.length) {
    next.code = applyTextEdits(next.code, edits);
  }

  if (cursor) {
    next.cursor = { ...cursor };
  }

  if (selection) {
    next.selection = { ...selection };
  }

  if (typeof scrollTop === "number") {
    next.scrollTop = scrollTop;
  }

  next.files.activeFileId = event.fileId;
  return next;
}

function formatTime(ms: number) {
  return `${(ms / 1000).toFixed(1)}s`;
}

function makeInitialSnapshot(code: string): EditorSnapshot {
  return {
    code,
    cursor: initialCursor,
    selection: initialSelection,
    scrollTop: 0,
    files: {
      activeFileId: FILE_ID,
      openFileIds: [FILE_ID]
    }
  };
}

class EventStore {
  events: ScrimEvent[] = [];
  checkpoints: Checkpoint[] = [];
  private currentSnapshot: EditorSnapshot;
  private editEventsSinceCheckpoint = 0;

  constructor(initialSnapshot: EditorSnapshot) {
    this.currentSnapshot = cloneSnapshot(initialSnapshot);
    this.checkpoints = [
      {
        timestamp: 0,
        snapshot: cloneSnapshot(initialSnapshot),
        lastAppliedEventIndex: -1
      }
    ];
  }

  reset(initialSnapshot: EditorSnapshot) {
    this.events = [];
    this.currentSnapshot = cloneSnapshot(initialSnapshot);
    this.editEventsSinceCheckpoint = 0;
    this.checkpoints = [
      {
        timestamp: 0,
        snapshot: cloneSnapshot(initialSnapshot),
        lastAppliedEventIndex: -1
      }
    ];
  }

  append(event: ScrimEvent) {
    const previous = this.events[this.events.length - 1];
    const timestamp = previous ? Math.max(event.timestamp, previous.timestamp + 0.1) : Math.max(0, event.timestamp);
    const orderedEvent = { ...event, timestamp };

    this.events.push(orderedEvent);
    this.currentSnapshot = applyFrameEvent(this.currentSnapshot, orderedEvent);

    if (getEventEdits(orderedEvent)?.length) {
      this.editEventsSinceCheckpoint += 1;
    }

    const previousCheckpoint = this.checkpoints[this.checkpoints.length - 1];
    const shouldCheckpoint =
      timestamp - previousCheckpoint.timestamp >= CHECKPOINT_INTERVAL_MS ||
      this.editEventsSinceCheckpoint >= CHECKPOINT_EDIT_LIMIT;

    if (shouldCheckpoint) {
      this.checkpoints.push({
        timestamp,
        snapshot: cloneSnapshot(this.currentSnapshot),
        lastAppliedEventIndex: this.events.length - 1
      });
      this.editEventsSinceCheckpoint = 0;
    }

    return orderedEvent;
  }

  get duration() {
    return this.events[this.events.length - 1]?.timestamp ?? 0;
  }

  getLatestSnapshot() {
    return cloneSnapshot(this.currentSnapshot);
  }

  seek(time: number) {
    const targetTime = clampTime(time, this.duration);
    let checkpoint = this.checkpoints[0];

    for (const candidate of this.checkpoints) {
      if (candidate.timestamp <= targetTime) {
        checkpoint = candidate;
      } else {
        break;
      }
    }

    let snapshot = cloneSnapshot(checkpoint.snapshot);
    let lastAppliedEventIndex = checkpoint.lastAppliedEventIndex;

    for (let index = checkpoint.lastAppliedEventIndex + 1; index < this.events.length; index += 1) {
      const event = this.events[index];
      if (event.timestamp > targetTime) break;

      snapshot = applyFrameEvent(snapshot, event);
      lastAppliedEventIndex = index;
    }

    return { snapshot, lastAppliedEventIndex };
  }
}

function toPlainPosition(position: Monaco.Position | Monaco.IPosition): PlainPosition {
  return {
    lineNumber: position.lineNumber,
    column: position.column
  };
}

function toPlainSelection(selection: Monaco.Selection | Monaco.ISelection): PlainSelection {
  return {
    selectionStartLineNumber: selection.selectionStartLineNumber,
    selectionStartColumn: selection.selectionStartColumn,
    positionLineNumber: selection.positionLineNumber,
    positionColumn: selection.positionColumn
  };
}

function captureSnapshot(editor: Monaco.editor.IStandaloneCodeEditor): EditorSnapshot {
  const model = editor.getModel();
  const selection = editor.getSelection();
  const position = editor.getPosition();

  return {
    code: model?.getValue() ?? "",
    cursor: position ? toPlainPosition(position) : initialCursor,
    selection: selection ? toPlainSelection(selection) : initialSelection,
    scrollTop: editor.getScrollTop(),
    files: {
      activeFileId: FILE_ID,
      openFileIds: [FILE_ID]
    }
  };
}

function snapshotHasSelection(snapshot: EditorSnapshot) {
  return selectionHasRange(snapshot.selection);
}

function selectionHasRange(selection: PlainSelection) {
  return (
    selection.selectionStartLineNumber !== selection.positionLineNumber ||
    selection.selectionStartColumn !== selection.positionColumn
  );
}

function selectionDecorationRange(selection: PlainSelection) {
  const startsBeforePosition =
    selection.selectionStartLineNumber < selection.positionLineNumber ||
    (selection.selectionStartLineNumber === selection.positionLineNumber &&
      selection.selectionStartColumn <= selection.positionColumn);

  if (startsBeforePosition) {
    return {
      startLineNumber: selection.selectionStartLineNumber,
      startColumn: selection.selectionStartColumn,
      endLineNumber: selection.positionLineNumber,
      endColumn: selection.positionColumn
    };
  }

  return {
    startLineNumber: selection.positionLineNumber,
    startColumn: selection.positionColumn,
    endLineNumber: selection.selectionStartLineNumber,
    endColumn: selection.selectionStartColumn
  };
}

function applySnapshotToEditor(
  editor: Monaco.editor.IStandaloneCodeEditor,
  snapshot: EditorSnapshot,
  setCode: (code: string) => void,
  updatePlaybackCursor: (cursor: PlainPosition, selection?: PlainSelection) => void
) {
  const model = editor.getModel();
  if (model && model.getValue() !== snapshot.code) {
    model.setValue(snapshot.code);
  }

  if (snapshotHasSelection(snapshot)) {
    editor.setSelection(snapshot.selection);
  } else {
    editor.setPosition(snapshot.cursor);
  }

  editor.setScrollTop(snapshot.scrollTop);
  updatePlaybackCursor(snapshot.cursor, snapshot.selection);
  setCode(snapshot.code);
}

function applyEventToEditor(
  editor: Monaco.editor.IStandaloneCodeEditor,
  event: ScrimEvent,
  setCode: (code: string) => void,
  updatePlaybackCursor: (cursor: PlainPosition, selection?: PlainSelection) => void
) {
  const model = editor.getModel();
  const edits = getEventEdits(event);
  const cursor = getEventCursor(event);
  const selection = getEventSelection(event);
  const scrollTop = getEventScrollTop(event);

  if (model && edits?.length) {
    editor.executeEdits(
      "semantic-scrim-playback",
      edits.map((edit) => {
        const start = model.getPositionAt(edit.rangeOffset);
        const end = model.getPositionAt(edit.rangeOffset + edit.rangeLength);

        return {
          range: {
            startLineNumber: start.lineNumber,
            startColumn: start.column,
            endLineNumber: end.lineNumber,
            endColumn: end.column
          },
          text: edit.text,
          forceMoveMarkers: true
        };
      })
    );
    setCode(model.getValue());
  }

  if (selection) {
    editor.setSelection(selection);
    updatePlaybackCursor(
      {
        lineNumber: selection.positionLineNumber,
        column: selection.positionColumn
      },
      selection
    );
  } else if (cursor) {
    editor.setPosition(cursor);
    updatePlaybackCursor(cursor);
  }

  if (typeof scrollTop === "number") {
    editor.setScrollTop(scrollTop);
  }

  if (!edits?.length && model) {
    setCode(model.getValue());
  }
}

function PlaybackControls({
  isPlaying,
  isRecording,
  playbackTime,
  duration,
  eventCount,
  checkpointCount,
  onPlayPause,
  onScrub,
  onStartRecording,
  onStopRecording
}: {
  isPlaying: boolean;
  isRecording: boolean;
  playbackTime: number;
  duration: number;
  eventCount: number;
  checkpointCount: number;
  onPlayPause: () => void;
  onScrub: (time: number) => void;
  onStartRecording: () => void;
  onStopRecording: () => void;
}) {
  return (
    <div className="transport">
      <button type="button" className={isRecording ? "record active" : "record"} onClick={isRecording ? onStopRecording : onStartRecording}>
        {isRecording ? "Stop Recording" : "Start Recording"}
      </button>
      <button type="button" onClick={onPlayPause} disabled={isRecording || duration === 0}>
        {isPlaying ? "Pause" : "Play"}
      </button>
      <input
        aria-label="Timeline"
        type="range"
        min="0"
        max={Math.max(duration, 1)}
        value={clampTime(playbackTime, Math.max(duration, 1))}
        onChange={(event) => onScrub(Number(event.target.value))}
        disabled={duration === 0}
      />
      <div className="readout">
        <span>{formatTime(playbackTime)}</span>
        <span>{duration > 0 ? formatTime(duration) : "0.0s"}</span>
      </div>
      <div className="stats" aria-label="Recording status">
        <span className={isRecording ? "dot on" : "dot"} />
        <span>{isRecording ? "Recording" : "Idle"}</span>
        <span>{eventCount} events</span>
        <span>{checkpointCount} checkpoints</span>
      </div>
    </div>
  );
}

function CodeEditor({ onMount }: { onMount: OnMount }) {
  return (
    <Editor
      height="100%"
      defaultLanguage="html"
      theme="vs-dark"
      defaultValue={starterCode}
      options={{ minimap: { enabled: false }, fontSize: 14, wordWrap: "on", scrollBeyondLastLine: false }}
      onMount={onMount}
    />
  );
}

function Preview({ code }: { code: string }) {
  const srcDoc = useMemo(() => code, [code]);
  return <iframe title="Live preview" sandbox="allow-scripts" srcDoc={srcDoc} />;
}

function App() {
  const [code, setCode] = useState(starterCode);
  const [isPlaying, setIsPlaying] = useState(false);
  const [isRecording, setIsRecording] = useState(false);
  const [playbackTime, setPlaybackTime] = useState(0);
  const [duration, setDuration] = useState(0);
  const [eventCount, setEventCount] = useState(0);
  const [checkpointCount, setCheckpointCount] = useState(1);

  const editorRef = useRef<Monaco.editor.IStandaloneCodeEditor | null>(null);
  const storeRef = useRef(new EventStore(makeInitialSnapshot(starterCode)));
  const recordingStartRef = useRef(0);
  const isRecordingRef = useRef(false);
  const isApplyingPlaybackRef = useRef(false);
  const playbackStartRef = useRef(0);
  const playbackStartOffsetRef = useRef(0);
  const lastAppliedEventIndexRef = useRef(-1);
  const cursorTimerRef = useRef<number | undefined>(undefined);
  const lastScrollRecordedAtRef = useRef(-Infinity);
  const playbackDecorationIdsRef = useRef<string[]>([]);

  const appendRecordedEvent = (event: Omit<FrameEvent, "timestamp" | "fileId"> | Omit<CursorEvent, "timestamp" | "fileId">) => {
    if (!isRecordingRef.current || isApplyingPlaybackRef.current) return;

    const orderedEvent = storeRef.current.append({
      ...event,
      fileId: FILE_ID,
      timestamp: performance.now() - recordingStartRef.current
    });

    setEventCount(storeRef.current.events.length);
    setCheckpointCount(storeRef.current.checkpoints.length);
    setDuration(storeRef.current.duration);
    setPlaybackTime(orderedEvent.timestamp);
  };

  const scheduleCursorEvent = () => {
    window.clearTimeout(cursorTimerRef.current);
    cursorTimerRef.current = window.setTimeout(() => {
      const editor = editorRef.current;
      if (!editor) return;

      const position = editor.getPosition();
      const selection = editor.getSelection();
      appendRecordedEvent({
        type: "cursor",
        position: position ? toPlainPosition(position) : initialCursor,
        selection: selection ? toPlainSelection(selection) : undefined
      });
    }, CURSOR_DEBOUNCE_MS);
  };

  const runPlaybackMutation = (mutation: () => void) => {
    isApplyingPlaybackRef.current = true;
    mutation();
    queueMicrotask(() => {
      isApplyingPlaybackRef.current = false;
    });
  };

  const updatePlaybackCursorDecoration = (cursor: PlainPosition, selection?: PlainSelection) => {
    const editor = editorRef.current;
    if (!editor) return;

    const decorations: Monaco.editor.IModelDeltaDecoration[] = [
      {
        range: {
          startLineNumber: cursor.lineNumber,
          startColumn: cursor.column,
          endLineNumber: cursor.lineNumber,
          endColumn: cursor.column
        },
        options: {
          className: "instructor-cursor-anchor",
          isWholeLine: true,
          linesDecorationsClassName: "instructor-cursor-gutter",
          after: {
            content: " ",
            inlineClassName: "instructor-cursor-marker"
          }
        }
      }
    ];

    if (selection && selectionHasRange(selection)) {
      decorations.push({
        range: selectionDecorationRange(selection),
        options: {
          className: "instructor-selection-highlight"
        }
      });
    }

    playbackDecorationIdsRef.current = editor.deltaDecorations(playbackDecorationIdsRef.current, decorations);
    editor.revealPositionInCenter(cursor, 0);
  };

  const clearPlaybackCursorDecoration = () => {
    const editor = editorRef.current;
    if (!editor || playbackDecorationIdsRef.current.length === 0) return;

    playbackDecorationIdsRef.current = editor.deltaDecorations(playbackDecorationIdsRef.current, []);
  };

  const handleEditorMount: OnMount = (editor) => {
    editorRef.current = editor;
    setCode(editor.getValue());

    editor.onDidChangeModelContent((event) => {
      if (isApplyingPlaybackRef.current) return;

      setCode(editor.getValue());

      const position = editor.getPosition();
      const selection = editor.getSelection();
      appendRecordedEvent({
        type: "frame",
        edits: event.changes.map((change) => ({
          rangeOffset: change.rangeOffset,
          rangeLength: change.rangeLength,
          text: change.text
        })),
        cursor: position ? toPlainPosition(position) : undefined,
        selection: selection ? toPlainSelection(selection) : undefined
      });
    });

    editor.onDidChangeCursorPosition(() => {
      if (isApplyingPlaybackRef.current) return;
      scheduleCursorEvent();
    });

    editor.onDidChangeCursorSelection(() => {
      if (isApplyingPlaybackRef.current) return;
      scheduleCursorEvent();
    });

    editor.onDidScrollChange((event) => {
      if (isApplyingPlaybackRef.current || !event.scrollTopChanged) return;

      const now = performance.now();
      if (now - lastScrollRecordedAtRef.current < SCROLL_THROTTLE_MS) return;

      lastScrollRecordedAtRef.current = now;
      appendRecordedEvent({ type: "frame", scrollTop: editor.getScrollTop() });
    });
  };

  useEffect(() => {
    isRecordingRef.current = isRecording;
  }, [isRecording]);

  useEffect(() => {
    if (!isPlaying) return;

    playbackStartRef.current = performance.now();
    playbackStartOffsetRef.current = playbackTime;

    let frame = 0;
    const tick = (now: number) => {
      const editor = editorRef.current;
      const store = storeRef.current;
      const nextTime = clampTime(playbackStartOffsetRef.current + now - playbackStartRef.current, store.duration);

      if (editor) {
        runPlaybackMutation(() => {
          for (let index = lastAppliedEventIndexRef.current + 1; index < store.events.length; index += 1) {
            const event = store.events[index];
            if (event.timestamp > nextTime) break;

            applyEventToEditor(editor, event, setCode, updatePlaybackCursorDecoration);
            lastAppliedEventIndexRef.current = index;
          }
        });
      }

      setPlaybackTime(nextTime);

      if (nextTime >= store.duration) {
        setIsPlaying(false);
        return;
      }

      frame = requestAnimationFrame(tick);
    };

    frame = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(frame);
  }, [isPlaying, playbackTime]);

  const seekTo = (time: number) => {
    const editor = editorRef.current;
    const store = storeRef.current;
    const nextTime = clampTime(time, store.duration);
    const result = store.seek(nextTime);

    setIsPlaying(false);
    setPlaybackTime(nextTime);
    lastAppliedEventIndexRef.current = result.lastAppliedEventIndex;

    if (editor) {
      runPlaybackMutation(() => applySnapshotToEditor(editor, result.snapshot, setCode, updatePlaybackCursorDecoration));
    } else {
      setCode(result.snapshot.code);
    }
  };

  const startRecording = () => {
    const editor = editorRef.current;
    if (!editor) return;

    window.clearTimeout(cursorTimerRef.current);
    const snapshot = captureSnapshot(editor);
    clearPlaybackCursorDecoration();
    storeRef.current.reset(snapshot);
    recordingStartRef.current = performance.now();
    lastAppliedEventIndexRef.current = -1;
    lastScrollRecordedAtRef.current = -Infinity;

    setIsPlaying(false);
    setIsRecording(true);
    setPlaybackTime(0);
    setDuration(0);
    setEventCount(0);
    setCheckpointCount(1);
    setCode(snapshot.code);
  };

  const stopRecording = () => {
    window.clearTimeout(cursorTimerRef.current);
    setIsRecording(false);
    setPlaybackTime(storeRef.current.duration);
    setDuration(storeRef.current.duration);
  };

  const playPause = () => {
    if (isPlaying) {
      setIsPlaying(false);
      return;
    }

    if (duration === 0 || isRecording) return;

    if (playbackTime >= duration) {
      seekTo(0);
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
        header p { margin: 6px 0 0; color: #b9b9b9; max-width: 860px; }
        .transport { display: grid; grid-template-columns: 150px 82px minmax(160px, 1fr) 106px minmax(320px, auto); gap: 12px; align-items: center; padding: 14px 22px; border-bottom: 1px solid #2f2f2f; background: #202020; }
        button { height: 36px; border: 1px solid #3f3f46; border-radius: 6px; background: #2563eb; color: white; font-weight: 700; cursor: pointer; white-space: nowrap; }
        button:hover:not(:disabled) { background: #1d4ed8; }
        button:disabled { cursor: not-allowed; opacity: 0.55; }
        .record { background: #44403c; }
        .record:hover:not(:disabled) { background: #57534e; }
        .record.active { background: #dc2626; border-color: #ef4444; }
        input[type="range"] { width: 100%; accent-color: #22c55e; }
        input[type="range"]:disabled { opacity: 0.5; }
        .readout { display: flex; justify-content: space-between; gap: 8px; color: #d4d4d8; font-size: 13px; font-variant-numeric: tabular-nums; }
        .stats { display: flex; align-items: center; justify-content: flex-end; gap: 12px; color: #d4d4d8; font-size: 13px; white-space: nowrap; }
        .dot { width: 9px; height: 9px; border-radius: 999px; background: #71717a; box-shadow: 0 0 0 0 rgba(239, 68, 68, 0); }
        .dot.on { background: #ef4444; box-shadow: 0 0 0 4px rgba(239, 68, 68, 0.16); }
        .stage { display: grid; grid-template-columns: minmax(0, 1fr) minmax(320px, 42vw); min-height: 0; }
        .pane { min-height: 0; border-right: 1px solid #2f2f2f; }
        .preview { display: grid; grid-template-rows: 38px 1fr; min-height: 0; background: #f8fafc; color: #171717; }
        .preview-bar { display: flex; align-items: center; padding: 0 12px; border-bottom: 1px solid #d4d4d8; font-size: 13px; font-weight: 700; }
        iframe { width: 100%; height: 100%; border: 0; background: white; }
        .monaco-editor .instructor-cursor-anchor { background: rgba(34, 197, 94, 0.12); }
        .monaco-editor .instructor-cursor-gutter { border-left: 3px solid #22c55e; }
        .monaco-editor .instructor-cursor-marker {
          display: inline-block;
          width: 3px;
          height: 1.25em;
          margin-left: -1px;
          background: #22c55e;
          box-shadow: 0 0 0 2px rgba(34, 197, 94, 0.28), 0 0 12px rgba(34, 197, 94, 0.8);
          vertical-align: text-bottom;
        }
        .monaco-editor .instructor-selection-highlight { background: rgba(34, 197, 94, 0.24); }
        @media (max-width: 980px) {
          .transport { grid-template-columns: 1fr 82px; }
          .transport input[type="range"], .readout, .stats { grid-column: 1 / -1; }
          .stats { justify-content: flex-start; flex-wrap: wrap; }
        }
        @media (max-width: 800px) {
          .stage { grid-template-columns: 1fr; grid-template-rows: 52vh 42vh; }
          .pane { border-right: 0; border-bottom: 1px solid #2f2f2f; }
          .transport { padding: 12px; gap: 10px; }
          header { padding: 14px 12px 8px; }
        }
      `}</style>
      <div className="app">
        <header>
          <h1>Semantic Scrim Recorder</h1>
          <p>
            Semantic event recording beats video because it produces smaller data, editable playback, searchable timelines,
            deterministic reconstruction, and interactive lessons. The same event-driven architecture can scale across files,
            terminal streams, collaboration, AI-generated tutorials, and Scrimba-style editor, DOM, browser, and interaction events.
          </p>
        </header>

        <PlaybackControls
          isPlaying={isPlaying}
          isRecording={isRecording}
          playbackTime={playbackTime}
          duration={duration}
          eventCount={eventCount}
          checkpointCount={checkpointCount}
          onPlayPause={playPause}
          onScrub={seekTo}
          onStartRecording={startRecording}
          onStopRecording={stopRecording}
        />

        <main className="stage">
          <section className="pane" aria-label="Code editor">
            <CodeEditor onMount={handleEditorMount} />
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
