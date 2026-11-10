/**
 * Optional shared leaderboard, available only when the game runs as a claude.ai Artifact
 * with the `db` + `user` capabilities. Everywhere else every call is a quiet no-op.
 * One document per viewer (`scores/<viewerId>`) holding their best scores.
 */
import type { Difficulty, ShipId } from './core/save';

export interface BoardRow {
  id: string;
  best: number;
  ship: ShipId;
  diff: Difficulty;
  win: boolean;
  me: boolean;
  name: string;
}

type Snap = { id: string; data(): Record<string, unknown> | undefined };
interface DbLike {
  doc(p: string): { get(): Promise<{ exists: boolean; data(): Record<string, unknown> | undefined }>; set(d: Record<string, unknown>): Promise<void> };
  collection(p: string): {
    orderBy(f: string, d: 'desc'): { limit(n: number): { onSnapshot(next: (s: { docs: Snap[] }) => void, err?: (e: unknown) => void): () => void } };
  };
}
interface UserLike {
  id(): Promise<string | null>;
  profiles(ids: string[]): Promise<Record<string, { name?: string } | null>>;
}

export class Online {
  private db: DbLike | null = null;
  private user: UserLike | null = null;
  private uid: string | null = null;
  rows: BoardRow[] = [];
  available = false;
  onChange?: () => void;

  async init(): Promise<void> {
    const c = (window as unknown as { claude?: { use(n: string): Promise<unknown> } }).claude;
    if (!c?.use) return;
    try {
      const [db, user] = await Promise.all([c.use('db'), c.use('user')]);
      if (!db || !user) return;
      this.db = db as DbLike;
      this.user = user as UserLike;
      this.uid = await this.user.id();
      this.available = true;
      this.db
        .collection('scores')
        .orderBy('best', 'desc')
        .limit(10)
        .onSnapshot(
          (s) => void this.ingest(s.docs),
          () => undefined,
        );
    } catch {
      this.available = false;
    }
  }

  private async ingest(docs: Snap[]): Promise<void> {
    const ids = docs.map((d) => d.id);
    let profiles: Record<string, { name?: string } | null> = {};
    try {
      profiles = this.user ? await this.user.profiles(ids) : {};
    } catch {
      /* names are optional */
    }
    this.rows = docs.map((d) => {
      const v = d.data() ?? {};
      return {
        id: d.id,
        best: Number(v.best) || 0,
        ship: (v.ship as ShipId) || 'echo',
        diff: (v.diff as Difficulty) || 'normal',
        win: !!v.win,
        me: d.id === this.uid,
        name: profiles[d.id]?.name || '',
      };
    });
    this.onChange?.();
  }

  /** Record a finished run if it beats this viewer's stored best. */
  async submit(score: number, ship: ShipId, diff: Difficulty, win: boolean): Promise<void> {
    if (!this.db || !this.uid || score <= 0) return;
    try {
      const ref = this.db.doc(`scores/${this.uid}`);
      const cur = await ref.get();
      const prev = cur.exists ? Number(cur.data()?.best) || 0 : 0;
      if (score <= prev) return;
      await ref.set({ best: Math.round(score), ship, diff, win, at: new Date().toISOString().slice(0, 10) });
    } catch {
      /* read-only viewer or offline: keep the local record only */
    }
  }
}
