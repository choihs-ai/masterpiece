/** A 16th-note step of the musical clock, dispatched when it becomes audible. */
export interface StepEvent {
  step: number;
  /** 0..15 position inside the bar */
  pos: number;
  beat: number;
  bar: number;
  time: number;
  stepDur: number;
}
