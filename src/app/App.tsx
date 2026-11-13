import { lazy, Suspense, useEffect, useRef, useState, type PointerEvent as ReactPointerEvent } from 'react';
const ElephantIntro = lazy(() => import('./ElephantIntro'));
import { NightMusic } from '../engine/NightMusic';
import ScrollStage, { type StageHandle } from './ScrollStage';
import FishMarket from './FishMarket';
import { encountersFor, findEncounter, type EncounterId, type DialogueChoice, type NightView } from '../content/encounters';
import {
  PLACES, TIMES, getPlace,
  type PlaceId, type TimeOfDay, type VisitMode,
} from '../content/places';
import { createSnapshot, type SceneSnapshot } from '../content/snapshot';
import { applyMarketAction, createMarketSession, type MarketAction } from '../content/market';
import type { LoadStatus } from '../engine/ScrollEngine';
import { AudioIntentQueue } from '../content/async';

const art = (name: string) => `${import.meta.env.BASE_URL}art/${name}`;

function TimeSwitcher({ time, onTime, compact = false }: {
  time: TimeOfDay;
  onTime: (time: TimeOfDay) => void;
  compact?: boolean;
}) {
  return (
    <div className={`time-switcher ${compact ? 'time-compact' : ''}`} role="group" aria-label="选择画卷时辰">
      {TIMES.map((item) => (
        <button key={item.id} type="button" onClick={() => onTime(item.id)}
          className={time === item.id ? 'active' : ''} aria-pressed={time === item.id}>
          {item.label}
        </button>
      ))}
    </div>
  );
}

export default function App() {
  const [entered, setEntered] = useState(false);
  const [introKind, setIntroKind] = useState<'entrance' | 'finale' | null>(null);
  const [mode, setMode] = useState<VisitMode>('guided');
  const [time, setTime] = useState<TimeOfDay>('morning');
  const [activeEncounter, setActiveEncounter] = useState<EncounterId | null>(null);
  const [encounterReply, setEncounterReply] = useState('');
  const [nightView, setNightView] = useState<NightView>('shore');
  const [nightLights, setNightLights] = useState(false);
  const [nightRhythm, setNightRhythm] = useState(false);
  const [nightDrones, setNightDrones] = useState(false);
  const [musicPlaying, setMusicPlaying] = useState(false);
  const [musicError, setMusicError] = useState('');
  const [musicController, setMusicController] = useState<NightMusic | null>(null);
  const musicRef = useRef<NightMusic | null>(null);
  /** Serialises play/pause so a late `play()` cannot revive sound after leaving. */
  const musicQueue = useRef<AudioIntentQueue | null>(null);
  const [market, setMarket] = useState(createMarketSession);
  /** Saved painting position, restored after the prologue/finale returns. */
  const [snapshot, setSnapshot] = useState<SceneSnapshot | null>(null);
  const stageRef = useRef<StageHandle | null>(null);
  const [loadStatus, setLoadStatus] = useState<LoadStatus | null>(null);
  // R2: only one card may be open at a time, and nothing is resident by default.
  const [placeCard, setPlaceCard] = useState(false);
  const [storyOpen, setStoryOpen] = useState(false);
  const [more, setMore] = useState(false);
  const [previewId, setPreviewId] = useState<EncounterId>('cormorant');
  const [previewNumber, setPreviewNumber] = useState(0);
  const [place, setPlace] = useState<PlaceId>('elephant');
  const [walking, setWalking] = useState(0);
  const [progress, setProgress] = useState(0.08);
  const [ready, setReady] = useState(false);
  const [error, setError] = useState('');
  const [help, setHelp] = useState(false);
  const [actionNumber, setActionNumber] = useState(0);
  const [actionType, setActionType] = useState<'gaze' | 'song'>('gaze');
  const [zoomNumber, setZoomNumber] = useState(0);
  const [zoomFactor, setZoomFactor] = useState(1);

  useEffect(() => () => {
    musicQueue.current?.close();
    musicRef.current?.dispose();
    musicRef.current = null;
  }, []);

  /** Lazily create the audio controller and its serialising queue. */
  const ensureMusic = (): { controller: NightMusic; queue: AudioIntentQueue } => {
    let controller = musicRef.current;
    if (!controller) {
      controller = new NightMusic();
      musicRef.current = controller;
      setMusicController(controller);
    }
    if (!musicQueue.current) {
      const owned = controller;
      musicQueue.current = new AudioIntentQueue(
        () => owned.start(),
        () => owned.stop(),
        () => owned.playing,
      );
    }
    musicQueue.current.reopen();
    return { controller, queue: musicQueue.current };
  };

  /**
   * Every path that silences audio goes through here: it closes the queue so a
   * `play()` still pending inside the browser cannot turn sound back on.
   */
  const silenceMusic = () => {
    musicQueue.current?.close();
    musicRef.current?.stop();
    setMusicPlaying(false);
  };

  const toggleNightMusic = async () => {
    const { controller, queue } = ensureMusic();
    const request = queue.request(controller.playing ? 'pause' : 'play');
    try {
      const playing = await request;
      // A newer click (or leaving/hiding) already superseded this one.
      if (musicRef.current !== controller) return;
      setMusicPlaying(playing);
      setMusicError('');
      if (playing) {
        setNightLights(true);
        setNightRhythm(true);
      }
    } catch (error) {
      if (musicRef.current !== controller) return;
      console.error('Original night music playback failed', error);
      silenceMusic();
      setMusicError('音乐播放失败，请检查浏览器是否允许音频播放，或稍后重试。');
    }
  };

  const leavePainting = () => {
    silenceMusic();
    setWalking(0);
    setActiveEncounter(null);
    setHelp(false);
    setEntered(false);
    setIntroKind(null);
    setSnapshot(null);
  };

  const selectTime = (next: TimeOfDay) => {
    setMore(false);
    setStoryOpen(false);
    setPlaceCard(false);
    if (next !== 'night') silenceMusic();
    setTime(next);
    closeEncounter();
  };

  const openEncounter = (id: EncounterId) => {
    setPlaceCard(false);
    setStoryOpen(false);
    const encounter = findEncounter(id);
    if (encounter.time !== time) return;
    if (activeEncounter === id) {
      closeEncounter();
      return;
    }
    // Opening a story takes the input: stop walking, drop held keys.
    setWalking(0);
    setPlace(encounter.place);
    setActiveEncounter(id);
    setEncounterReply('');
    if (id === 'fishmarket') setMarket((session) => applyMarketAction(session, { type: 'open' }));
  };

  const closeEncounter = () => {
    if (activeEncounter === 'night-stage') silenceMusic();
    setMusicError('');
    setActiveEncounter(null);
    setEncounterReply('');
    // Unfinished flows are discarded; a completed purchase stays remembered.
    setMarket((session) => applyMarketAction(session, { type: 'reset' }));
  };

  const marketAction = (action: MarketAction) => {
    setMarket((session) => applyMarketAction(session, action));
    // Scene-side feedback: the stall's water surface ripples when a purchase
    // completes, so the result is visible in the painting, not only in text.
    if (action.type === 'confirm') {
      setPreviewId('fishmarket');
      setPreviewNumber((count) => count + 1);
    }
  };

  /** Capture where the visitor is right before the prologue/finale unmounts us. */
  const captureSnapshot = () => {
    const view = stageRef.current?.captureView();
    if (!view) return;
    setSnapshot(createSnapshot({
      ...view,
      time,
      mode,
      place,
      marketRecord: market.record,
    }));
  };

  /**
   * Navigation and canvas dragging share one camera owner: pressing a landmark
   * drops any held walk and closes the story card first, so the guided camera
   * is not fought over by two inputs at once.
   */
  const stories = encountersFor(time);

  const navigatePlace = (id: PlaceId) => {
    setWalking(0);
    setPlace(id);
    // Exactly one card at a time: switching place closes the story and the
    // description, and the description reopens on demand from the route.
    setPlaceCard(false);
    setStoryOpen(false);
    if (activeEncounter) closeEncounter();
  };

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        if (activeEncounter) closeEncounter();
        if (help) setHelp(false);
      }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [activeEncounter, help]);

  // Leaving the tab hides the painting: stop sound and release the walker so
  // nothing keeps running (or keeps sounding) while the visitor is away.
  useEffect(() => {
    const onHide = () => {
      if (!document.hidden) return;
      silenceMusic();
      setWalking(0);
      setMusicError('');
    };
    const onBlur = () => setWalking(0);
    document.addEventListener('visibilitychange', onHide);
    window.addEventListener('blur', onBlur);
    return () => {
      document.removeEventListener('visibilitychange', onHide);
      window.removeEventListener('blur', onBlur);
    };
  }, []);

  const chooseDialogue = (choice: DialogueChoice) => {
    setEncounterReply(choice.answer);
    if (choice.navigateTo) setPlace(choice.navigateTo);
    if (choice.splash && activeEncounter) {
      setPreviewId(activeEncounter);
      setPreviewNumber((count) => count + 1);
    }
  };

  /** Opening a fresh journey: no earlier position to restore. */
  const selectMode = (newMode: VisitMode) => {
    setMode(newMode);
    setEntered(newMode === 'free');
    setIntroKind(newMode === 'guided' ? 'entrance' : null);
    setReady(false);
    setError('');
    setPlace('elephant');
    setSnapshot(null);
    silenceMusic();
    closeEncounter();
  };
  const completeIntro = () => {
    setIntroKind(null);
    setEntered(true);
    setReady(false);
  };
  /** "重看象山序章": the painting unmounts, so remember exactly where we were. */
  const replayIntro = () => {
    captureSnapshot();
    silenceMusic();
    setWalking(0);
    setActiveEncounter(null);
    setIntroKind('entrance');
    setEntered(false);
  };
  /** Finale: snapshot first; returning restores the 4th-scene view. */
  const startFinale = () => {
    captureSnapshot();
    silenceMusic();
    setActiveEncounter(null);
    setWalking(0);
    setIntroKind('finale');
    setEntered(false);
  };
  /** "回到卷首" from the finale: a deliberate new start, not a restore. */
  const finishFinale = () => {
    setIntroKind(null);
    setEntered(false);
    setSnapshot(null);
  };
  /** "返回画卷": remount the stage at the saved position. */
  const backFromFinale = () => {
    setIntroKind(null);
    setEntered(true);
    setReady(false);
  };
  /**
   * Whoever owns the input: an open story card, the guide overlay or an intro.
   * While locked the engine drops held keys/pointers and refuses new walking.
   */
  const inputLocked = Boolean(activeEncounter) || help || Boolean(introKind);

  const trigger = (type: 'gaze' | 'song') => {
    setActionType(type);
    setActionNumber((n) => n + 1);
  };
  const magnify = (factor: number) => {
    setZoomFactor(factor);
    setZoomNumber((n) => n + 1);
  };
  const holdToWalk = (direction: number) => ({
    onPointerDown: (event: ReactPointerEvent<HTMLButtonElement>) => {
      event.currentTarget.setPointerCapture(event.pointerId);
      // A dialogue owns the input: do not start walking underneath it.
      if (inputLocked) return;
      setWalking(direction);
    },
    onPointerUp: () => setWalking(0),
    onPointerCancel: () => setWalking(0),
    onLostPointerCapture: () => setWalking(0),
  });

  if (introKind) {
    const ending = introKind === 'finale';
    return (
      <Suspense fallback={<main className="elephant-intro elephant-loading" role="status"><span>水月洞天，正徐徐展开…</span><button className="elephant-skip" onClick={ending ? finishFinale : completeIntro}>{ending ? '回到卷首' : '直接入画'} ↗</button></main>}>
        <ElephantIntro key={introKind} time={time} variant={introKind}
          onComplete={ending ? finishFinale : completeIntro} onBack={ending ? backFromFinale : undefined} />
      </Suspense>
    );
  }

  if (!entered) {
    return (
      <main className="home">
        <div className="home-gallery" aria-label="漓江互动长卷首页原幅插画">
          <img className="home-gallery-image visible" src={art('home-background.webp')}
            alt="桂林漓江青绿山水长卷，群峰、双塔、古桥与江上游船" fetchPriority="high" />
        </div>
        <div className="home-wash" aria-hidden="true" />
        <header className="home-header">
          <div className="home-brand"><span className="seal">漓</span><span>桂林 · 漓江<br /><small>山水长卷 · 互动游历</small></span></div>
          <div className="home-header-tools">
            <span className="home-header-note">以山水为卷 · 以脚步为笔</span>
            <div className="home-time-wrap">
              <span className="home-time-label">一日四境</span>
              <TimeSwitcher time={time} onTime={selectTime} />
            </div>
          </div>
        </header>
        <section className="home-intro">
          <div className="accent-line" />
          <p className="home-eyebrow">LIJIANG · A LIVING LANDSCAPE</p>
          <h1>漓江<span>移笔游目</span></h1>
          <p className="home-verse">青山一卷开，人在画中游。</p>
          <p className="home-description">沿一江烟波，走过象鼻山、日月双塔、阳桥与玻璃桥。随晨昏入画，听远山回响。</p>
          <div className="home-actions">
            <button className="action-primary" type="button" onClick={() => selectMode('guided')}>
              <span>入画启程 <small>随画中人 · 沿岸游历</small></span><span aria-hidden="true">↗</span>
            </button>
            <button className="action-secondary" type="button" onClick={() => selectMode('free')}>
              <span>山水漫游 <small>自在移卷 · 观景听风</small></span><span aria-hidden="true">↗</span>
            </button>
          </div>
        </section>
        <footer className="home-bottom">
          <div className="home-route" aria-label="游历路线">
            <span>象鼻山</span><i /><span>日月双塔</span><i /><span>阳桥</span><i /><span>玻璃桥</span>
          </div>
          <span className="home-copyright">原幅高清画卷 · 随时辰入画</span>
        </footer>
      </main>
    );
  }

  const current = getPlace(place);
  return (
    <main className="experience">
      <ScrollStage ref={stageRef} mode={mode} time={time} target={place} walking={walking}
        nightView={nightView} nightLights={nightLights} nightRhythm={nightRhythm} nightDrones={nightDrones}
        musicPlaying={musicPlaying} musicController={musicController}
        previewId={previewId} previewNumber={previewNumber}
        actionNumber={actionNumber} actionType={actionType}
        zoomNumber={zoomNumber} zoomFactor={zoomFactor}
        inputLocked={inputLocked} restoreFrom={snapshot}
        onReady={() => setReady(true)} onPlace={navigatePlace} onEncounter={openEncounter}
        onPosition={setProgress} onError={setError} onLoadStatus={setLoadStatus} />
      <div className="scene-frame" aria-hidden="true" />
      <header className="scene-header">
        <button className="back-button" onClick={leavePainting} aria-label="回到卷首">←</button>
        <div className="scene-time"><TimeSwitcher time={time} onTime={selectTime} compact /></div>
        <div className="more-wrap">
          <button className="info-button" aria-expanded={more} aria-haspopup="menu"
            onClick={() => { setMore((open) => !open); setPlaceCard(false); }}>更多</button>
          {more && (
            <div className="more-menu" role="menu" aria-label="更多选项">
              <button role="menuitem" onClick={() => {
                setMore(false);
                setMode(mode === 'guided' ? 'free' : 'guided');
                setWalking(0);
                setPlaceCard(false);
              }}>
                {mode === 'guided' ? '改为纯观画' : '改为人物随行'}
              </button>
              <button role="menuitem" onClick={() => { setMore(false); replayIntro(); }}>重看象山序章</button>
              <button role="menuitem" onClick={() => { setMore(false); setHelp(true); }}>游目指南</button>
              <button role="menuitem" onClick={() => { setMore(false); startFinale(); }}>卷尾 · 回望象山</button>
            </div>
          )}
        </div>
      </header>
      {stories.length > 0 && (
        <div className="story-entry">
          <button type="button" aria-expanded={storyOpen} aria-haspopup="menu"
            onClick={() => { setStoryOpen((open) => !open); setPlaceCard(false); }}>
            画中故事 <span aria-hidden="true">{stories.length}</span>
          </button>
          {storyOpen && (
            <div className="story-menu" role="menu" aria-label={`${TIMES.find((item) => item.id === time)?.label ?? ''}的画中故事`}>
              {stories.map((encounter) => (
                <button key={encounter.id} role="menuitem" type="button"
                  onClick={() => { setStoryOpen(false); openEncounter(encounter.id); }}>
                  <strong>{encounter.title}</strong><small>{encounter.kicker}</small>
                </button>
              ))}
            </div>
          )}
        </div>
      )}
      {activeEncounter && findEncounter(activeEncounter).time === time && (
        <section className="encounter-sheet" role="region" aria-label={`${findEncounter(activeEncounter).title}互动`}>
          <button className="encounter-close" onClick={closeEncounter} aria-label="关闭互动">×</button>
          <span className="encounter-eyebrow">{findEncounter(activeEncounter).kicker} · 插画互动</span>
          <h3>{findEncounter(activeEncounter).title}</h3>
          <p>{findEncounter(activeEncounter).intro}</p>
          {activeEncounter === 'night-stage' ? (
            <div className="night-actions">
              <div className="night-view" role="group" aria-label="选择观看位置">
                <button className={nightView === 'shore' ? 'active' : ''} aria-pressed={nightView === 'shore'}
                  onClick={() => setNightView('shore')}>岸边</button>
                <button className={nightView === 'boat' ? 'active' : ''} aria-pressed={nightView === 'boat'}
                  onClick={() => setNightView('boat')}>游船插画</button>
              </div>
              {/* The single primary action: the river music drives the reflections. */}
              <button onClick={toggleNightMusic} aria-pressed={musicPlaying} className="night-music-button market-main">
                {musicPlaying ? '暂停听江夜游' : '开始听江夜游'}
              </button>
              <p className="night-note" role="status">
                {musicPlaying ? '原创器乐播放中，水面倒影随实时频谱变化。' : '点击开始后播放项目专门创作的器乐，倒影随声音变化。'}此器乐并非传统山歌录音。
              </p>
              {musicError && <p className="music-error" role="alert">{musicError}</p>}
              {/* Concept demos are not product surface: they wait behind a disclosure. */}
              <details className="night-lab">
                <summary>灯光与概念演示</summary>
                <button onClick={() => setNightLights((value) => !value)} aria-pressed={nightLights}>
                  {nightLights ? '◉ 关闭江岸灯光' : '◎ 点亮江岸灯光'}
                </button>
                <button onClick={() => {
                  setNightRhythm((value) => !value);
                  setNightLights(true);
                }} aria-pressed={nightRhythm}>
                  {nightRhythm ? '◉ 关闭静音节奏预览' : '♫ 静音节奏预览'}
                </button>
                <button onClick={() => trigger('song')}>♫ 对山歌姿态（无演唱）</button>
                <button onClick={() => setNightDrones((value) => !value)} aria-pressed={nightDrones}>
                  {nightDrones ? '◉ 关闭无人机光点' : '✧ 无人机概念光点'}
                </button>
                <small>灯组、节拍、山歌与无人机均为概念演示；正式录音与动作素材未到位。</small>
              </details>
            </div>
          ) : activeEncounter === 'fishmarket' ? (
            <FishMarket session={market} onAction={marketAction} />
          ) : (
            <div className="dialogue-options">
              {findEncounter(activeEncounter).choices.map((choice) => (
                <button key={choice.id} type="button" onClick={() => chooseDialogue(choice)}>{choice.label}</button>
              ))}
            </div>
          )}
          {encounterReply && <p className="encounter-reply" role="status">{encounterReply}</p>}
          <small className="encounter-disclaimer">{findEncounter(activeEncounter).detail}</small>
        </section>
      )}
      {placeCard && (
        <section className="place-card" role="region" aria-label={`${current.name}景点说明`}>
          <button className="encounter-close" onClick={() => setPlaceCard(false)} aria-label="关闭景点说明">×</button>
          <div className="place-heading"><span>第{current.number}景</span><span>{current.eyebrow}</span></div>
          <h2>{current.name}</h2>
          <p>{current.description}</p>
          <div className="place-footer">
            <button onClick={() => trigger(place === 'glassbridge' && time === 'night' ? 'song' : 'gaze')}>
              {place === 'glassbridge' && time === 'night' ? '♪ 对山歌' : '◌ 驻足赏景'}
            </button>
          </div>
        </section>
      )}
      <nav className="scene-landmarks" aria-label="画卷景点导航">
        {PLACES.map((item, index) => (
          <button className={item.id === place ? 'selected' : ''} key={item.id}
            aria-current={item.id === place ? 'location' : undefined}
            aria-expanded={item.id === place ? placeCard : undefined}
            onClick={() => {
              if (item.id === place) { setPlaceCard((open) => !open); setStoryOpen(false); return; }
              navigatePlace(item.id);
            }}>
            <small>{String(index + 1).padStart(2, '0')}</small><strong>{item.name}</strong>
          </button>
        ))}
      </nav>
      {/* Walking belongs to the figure; pure viewing has nothing to walk. */}
      {mode === 'guided' && (
        <div className="control-walk" aria-label="人物行走">
          <button {...holdToWalk(-1)} title="按住向左行走" aria-label="按住向左走">←</button>
          <button {...holdToWalk(1)} title="按住向右行走" aria-label="按住向右走">→</button>
        </div>
      )}
      <div className="control-view" aria-label="画卷缩放">
        <button onClick={() => magnify(1 / 1.16)} title="缩小" aria-label="缩小">−</button>
        <button onClick={() => magnify(1.16)} title="放大" aria-label="放大">＋</button>
      </div>
      <div className="scroll-progress" aria-label={`画卷位置 ${Math.round(progress * 100)}%`}>
        <div className="progress-track"><i style={{ width: `${progress * 100}%` }} /></div>
      </div>
      {!ready && !error && <div className="scene-loading" role="status"><div className="loading-ornament">◈</div>山水正在徐徐展开…<small>{loadStatus ? `正在载入${loadStatus.currentScene === 'day' ? '白昼' : loadStatus.currentScene === 'dusk' ? '夕照' : '夜景'}原幅无损画卷` : '正在载入原幅无损画卷'}</small></div>}
      {ready && loadStatus && loadStatus.failed.length > 0 && (
        <p className="scene-load-note" role="status">
          以下素材未能载入，已改用可用姿态或热点：{loadStatus.failed.join('、')}
        </p>
      )}
      {error && <div className="scene-error" role="alert"><strong>画卷暂未展开</strong><p>{error}</p><button onClick={() => window.location.reload()}>重试载入</button></div>}
      {help && <div className="help-overlay" onClick={() => setHelp(false)}>
        <section className="help-paper" role="dialog" aria-modal="true" aria-label="游目指南" onClick={(e) => e.stopPropagation()}>
          <button className="help-close" onClick={() => setHelp(false)} aria-label="关闭指南">×</button>
          <span className="help-chapter">入画 · 三法</span>
          <h2>游目指南</h2>
          <p>用鼠标或手指左右拖动画卷；滚轮或双指可缩放。按住左右箭头，或使用键盘 ← → / A D，让画中人沿岸行走。</p>
          <p>切换「清晨」「正午」「夕照」「入夜」会选择对应高清原画，其中清晨和正午共用白昼原画。点击画中的人物与金色发现点，或使用左上方的「画中故事」入口打开互动；底部路线可切换景点，左下可随时切换漫游/导览。</p>
          <p className="help-note">当前版本使用原幅无损画卷、四张新绘制的透明交互插画，以及项目专门创作的器乐示范音轨。夜间「播放原创器乐」可用真实频谱驱动水面反射；静音节奏预览仍独立可用。渔人整理竹筏、鸬鹚潜水和对山歌人声尚无完整动画与正式演唱，无人机光点属于虚拟概念演示。</p>
        </section>
      </div>}
    </main>
  );
}
