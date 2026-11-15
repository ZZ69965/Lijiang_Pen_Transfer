import { forwardRef, useEffect, useImperativeHandle, useRef } from 'react';
import { ScrollEngine, type LoadStatus } from '../engine/ScrollEngine';
import type { NightMusic } from '../engine/NightMusic';
import type { PlaceId, TimeOfDay, VisitMode } from '../content/places';
import type { EncounterId, NightView } from '../content/encounters';
import type { SceneSnapshot } from '../content/snapshot';
import type { DroneArtworkId } from '../content/droneArtworks';

export type StageProps = {
  mode: VisitMode;
  time: TimeOfDay;
  target: PlaceId;
  walking: number;
  nightView: NightView;
  nightLights: boolean;
  nightRhythm: boolean;
  nightDrones: boolean;
  droneArtwork: DroneArtworkId;
  musicPlaying: boolean;
  musicController: NightMusic | null;
  previewNumber: number;
  previewId: EncounterId;
  actionNumber: number;
  actionType: 'gaze' | 'song';
  zoomNumber: number;
  zoomFactor: number;
  /** True while a dialogue, the guide or an intro owns the input. */
  inputLocked: boolean;
  /** Position to restore after the prologue/finale unmounted the stage. */
  restoreFrom: SceneSnapshot | null;
  onReady: () => void;
  onPlace: (id: PlaceId) => void;
  onEncounter: (id: EncounterId) => void;
  onPosition: (progress: number) => void;
  onError: (message: string) => void;
  onLoadStatus?: (status: LoadStatus) => void;
};

/** Imperative handle so App can capture the live view right before unmounting. */
export type StageHandle = {
  captureView: () => Pick<SceneSnapshot, 'heroX' | 'facing' | 'cameraCentre' | 'zoom'> | null;
  retryDroneArtwork: () => void;
};

const ScrollStage = forwardRef<StageHandle, StageProps>(function ScrollStage(props, ref) {
  const container = useRef<HTMLDivElement | null>(null);
  const engineRef = useRef<ScrollEngine | null>(null);
  const latest = useRef(props);
  latest.current = props;
  const reported = useRef(false);

  useEffect(() => {
    if (!container.current) return;
    const engine = new ScrollEngine(container.current, {
      onReady: () => {
        // Only the first ready of THIS engine reaches React; the background
        // prefetch must not re-trigger loading UI or snapshot restores.
        if (reported.current) return;
        reported.current = true;
        latest.current.onReady();
      },
      onPlace: (id) => latest.current.onPlace(id),
      onEncounter: (id) => latest.current.onEncounter(id),
      onPosition: (value) => latest.current.onPosition(value),
      onError: (message) => latest.current.onError(message),
      onLoadStatus: (status) => latest.current.onLoadStatus?.(status),
    });
    engineRef.current = engine;
    void engine.init().then(() => {
      if (engineRef.current !== engine) return;
      engine.setMode(latest.current.mode);
      engine.setWalkerVisible(latest.current.mode === 'guided');
      engine.setTimeOfDay(latest.current.time);
      engine.setNightControls({ view: latest.current.nightView, lights: latest.current.nightLights, rhythm: latest.current.nightRhythm, music: latest.current.musicPlaying, drones: latest.current.nightDrones, droneArtwork: latest.current.droneArtwork });
      engine.setMusicController(latest.current.musicController);
      engine.setInteractionLocked(latest.current.inputLocked);
      // Returning from the prologue/finale: restore the exact view; otherwise
      // open on the landmark the visitor chose.
      const restore = latest.current.restoreFrom;
      if (restore) engine.restoreView(restore);
      else engine.focusPlace(latest.current.target, true);
    });
    return () => {
      engineRef.current = null;
      engine.destroy();
    };
  }, []);

  useEffect(() => {
    const engine = engineRef.current;
    if (!engine) return;
    engine.setMode(props.mode);
    // 漫游 is pure viewing: the painting alone, no figure to stand anywhere.
    engine.setWalkerVisible(props.mode === 'guided');
  }, [props.mode]);
  useEffect(() => { engineRef.current?.setTimeOfDay(props.time); }, [props.time]);
  useEffect(() => {
    engineRef.current?.setNightControls({ view: props.nightView, lights: props.nightLights, rhythm: props.nightRhythm, music: props.musicPlaying, drones: props.nightDrones, droneArtwork: props.droneArtwork });
  }, [props.nightView, props.nightLights, props.nightRhythm, props.nightDrones, props.musicPlaying, props.droneArtwork]);
  useEffect(() => { engineRef.current?.setMusicController(props.musicController); }, [props.musicController]);
  useEffect(() => {
    if (props.previewNumber) engineRef.current?.previewEncounter(props.previewId);
  }, [props.previewNumber, props.previewId]);
  useEffect(() => { engineRef.current?.focusPlace(props.target); }, [props.target]);
  useEffect(() => { engineRef.current?.setWalkDirection(props.walking); }, [props.walking]);
  useEffect(() => { engineRef.current?.setInteractionLocked(props.inputLocked); }, [props.inputLocked]);
  useEffect(() => {
    if (props.actionNumber > 0) engineRef.current?.performAction(props.actionType);
  }, [props.actionNumber, props.actionType]);
  useEffect(() => {
    if (props.zoomNumber > 0) engineRef.current?.zoomBy(props.zoomFactor);
  }, [props.zoomNumber, props.zoomFactor]);

  useImperativeHandle(ref, () => ({
    captureView: () => engineRef.current?.captureView() ?? null,
    retryDroneArtwork: () => engineRef.current?.retryDroneArtwork(),
  }), []);

  return <div ref={container} className="scroll-stage" />;
});

export default ScrollStage;
