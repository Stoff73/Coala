import type { RetrievalMethod } from "../schema/common.js";
import type { RecordSource } from "../schema/memory.js";

/** A loosely-typed memory record's `data` payload. */
export type Record_ = Record<string, unknown>;

/** A retrieval request against a single store (paper §4.3). */
export interface RetrievalQuery {
  text: string;
  method: RetrievalMethod;
  k: number;
}

/** A lean handle to one record — enough to rank without loading its body. */
export interface Pointer {
  id: string;
  summary: string;
  /** Rankable metadata: importance, created, source, … */
  meta: Record<string, unknown>;
}

/** Metadata supplied when writing a record. */
export interface RecordMeta {
  source?: RecordSource;
  importance?: number;
  /** Free-form markdown notes stored in the record body. */
  body?: string;
}

/**
 * The storage contract shared by every memory backend. `listPointers` is cheap
 * (no bodies); `openBody` is lazy (one record); `retrieve` ranks then opens
 * top-k; `add` persists and returns the new pointer.
 */
export interface Store {
  listPointers(): Promise<Pointer[]>;
  openBody(id: string): Promise<Record_ | undefined>;
  retrieve(q: RetrievalQuery): Promise<Record_[]>;
  add(record: Record_, meta?: RecordMeta): Promise<Pointer>;
}
