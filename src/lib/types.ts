export type Scope = "personal" | "team" | "org";

/**
 * `active`    – retrievable by everyone the scope allows.
 * `pending`   – extracted but the scope is not yet ratified. Visible ONLY to the
 *               author, never injected into anyone else's prompt. This is how
 *               "org rules require confirmation before binding everyone" and
 *               "ambiguous scope" are both handled.
 * `superseded`– replaced by a newer memory (kept for provenance/audit).
 * `rejected`  – the author declined the proposal.
 */
export type MemoryStatus = "active" | "pending" | "superseded" | "rejected";

export interface User {
  id: string;
  name: string;
  role: string;
  color: string;
}

export interface Team {
  id: string;
  name: string;
}

export interface Actor {
  user: User;
  teamIds: string[];
  teamNames: string[];
}

export interface Memory {
  id: string;
  scope: Scope;
  owner_user_id: string | null;
  team_id: string | null;
  org_id: string | null;
  /** Conflict key. Two memories sharing a key are competing instructions. */
  key: string;
  content: string;
  status: MemoryStatus;
  /** Org policy that narrower scopes may NOT override (compliance-style rule). */
  binding: number;
  confidence: number;
  rationale: string;
  created_by: string;
  source_session_id: string | null;
  source_message_id: string | null;
  source_quote: string;
  created_at: string;
  updated_at: string;
  supersedes_id: string | null;
  proposed_scope: Scope | null;
}

export interface MemoryEvent {
  id: string;
  memory_id: string;
  actor_user_id: string;
  action: string;
  detail: string;
  created_at: string;
}

export interface ChatSession {
  id: string;
  user_id: string;
  title: string;
  created_at: string;
  seq: number;
}

export interface Message {
  id: string;
  session_id: string;
  role: "user" | "assistant";
  content: string;
  created_at: string;
  /** Memory ids that were injected into the prompt that produced this message. */
  used_memory_ids: string[];
  /** Memory ids created from this message. */
  created_memory_ids: string[];
}

/** A memory that lost a conflict — surfaced in the UI, excluded from the prompt. */
export interface OverriddenMemory {
  memory: Memory;
  beatenBy: string;
}

export interface RetrievalResult {
  injected: Memory[];
  overridden: OverriddenMemory[];
  /** Visible + active but not selected (below the context budget). */
  droppedForBudget: Memory[];
  visibleCount: number;
}

export interface ExtractedRule {
  content: string;
  scope: Scope;
  scope_confidence: number;
  key: string;
  rationale: string;
  quote: string;
  supersedes_id?: string | null;
}

/**
 * Shared reference data — the company's account book. Deliberately NOT a
 * memory: unscoped, identical for every user, and never filtered. Holding it
 * constant is what makes a difference between two users' answers attributable
 * to memory alone.
 */
export interface Account {
  name: string;
  seats: number;
  prior_term_usd: number;
  q3_sheet_usd: number;
  rate_card_usd: number;
  renews_on: string;
  notes: string;
}
