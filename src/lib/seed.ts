import type { Client } from "@libsql/client";
import { ORG_ID } from "./permissions";

/**
 * Seeded so both required demos are visible in the first minute without any
 * reviewer setup:
 *
 *   Demo 1 — Ryan states an ORG rule in his session #2 ("no delivery dates
 *            without engineering sign-off"). Sean has an empty session ready;
 *            one click on the scripted prompt shows his agent obeying a rule
 *            he has never seen, in a session that did not exist when it was
 *            written.
 *
 *   Demo 2 — Ryan's FINANCE rule ("quote off the Q3 sheet, not the public
 *            rate card") reaches Sean and is absent from Mitchell — not
 *            hidden from Mitchell's agent by instruction, absent from his
 *            query results entirely.
 *
 * Also seeded: a conflict (Daniel's personal formatting rule beating an org
 * default), a superseded memory, and an unratified org proposal.
 */


/**
 * Reference documents, scoped exactly like memories.
 *
 * The account book is org-wide: everyone sees the same customers, seats,
 * prior-term values and the public rate card. That constant is the control —
 * it means a difference between two users' answers cannot be blamed on them
 * looking at different customer data.
 *
 * The Q3 renewal pricing sheet is Finance-only. So Operations does not merely
 * lack the *rule* about which sheet to quote; the sheet itself is not in their
 * query result. Both halves of the boundary — the policy and the material —
 * run through the same predicate.
 */
export const DOCUMENTS = [
  {
    id: "doc_account_book",
    scope: "org" as const,
    team: null,
    title: "Account book",
    summary: "Customers, seats, prior-term value, public list pricing and renewal dates.",
    // Notes record customer status and nothing else — no dates, no approval
    // state, no guidance. Anything resembling a decision ("engineering has not
    // signed off", "the plan targets 30 September") would answer the question
    // the rules exist to answer, and the demo would prove nothing. The user's
    // own message supplies the date; memory supplies the policy.
    body: [
      "| Account | Seats | Prior term | Public rate card | Renews | Notes |",
      "|---|---|---|---|---|---|",
      "| Northwind | 240 | $84,000 | $91,200 | 2026-09-30 | Renewal in progress. Has asked about the SSO integration. |",
      "| Acme | 150 | $52,000 | $58,000 | 2026-10-12 | Renewal in progress. Has asked when the SSO integration ships. |",
      "| Contoso | 600 | $128,000 | $142,500 | 2027-01-31 | Expanding into two more regions next term. |",
    ].join("\n"),
    created_by: "u_ryan",
    daysAgo: 45,
  },
  {
    id: "doc_roadmap",
    scope: "org" as const,
    team: null,
    title: "Product roadmap",
    summary: "Target dates for in-flight engineering work. Org-wide.",
    // Dates are facts. Whether a target may be promised to a customer is
    // policy, and policy lives in memory — this document must never say.
    body: [
      "| Item | Target date | Stage |",
      "|---|---|---|",
      "| SSO integration | 30 September | Build |",
      "| Bulk data loader | 15 November | Design |",
      "| Regional failover | Q1 next year | Scoping |",
    ].join("\n"),
    created_by: "u_ryan",
    daysAgo: 40,
  },
  {
    id: "doc_q3_pricing",
    scope: "team" as const,
    team: "t_finance",
    title: "Q3 renewal pricing sheet",
    summary: "Internal renewal pricing for the current quarter. Finance only.",
    body: [
      "Renewal pricing for Q3. These figures supersede the public rate card for renewals.",
      "",
      "| Account | Q3 renewal price | vs prior term |",
      "|---|---|---|",
      "| Northwind | $87,400 | +$3,400 |",
      "| Acme | $54,600 | +$2,600 |",
      "| Contoso | $131,000 | +$3,000 |",
    ].join("\n"),
    created_by: "u_ryan",
    daysAgo: 30,
  },
  {
    id: "doc_ops_runbook",
    scope: "team" as const,
    team: "t_ops",
    title: "Implementation runbook",
    summary: "Rollout sequence and the contact list. Operations only.",
    // Same rule as the account book: procedures and contacts, never routing
    // policy. "Page on-call, never an engineering manager" is a rule, and a
    // document asserting it would answer the question a rule should answer.
    body: [
      "Mid-market rollout sequence:",
      "1. Kickoff call and environment questionnaire",
      "2. SSO configuration",
      "3. Data import dry run, then pilot group",
      "4. Full cutover, then a 30-day check-in",
      "",
      "Contacts: on-call rotation, the implementation lead, and the account owner.",
    ].join("\n"),
    created_by: "u_daniel",
    daysAgo: 20,
  },
];

function documentStatements() {
  return DOCUMENTS.map((d) => ({
    sql: `INSERT OR IGNORE INTO documents
            (id, scope, owner_user_id, team_id, org_id, title, summary, body, created_by, created_at)
          VALUES (?,?,?,?,?,?,?,?,?,?)`,
    args: [
      d.id,
      d.scope,
      null,
      d.team,
      d.scope === "org" ? ORG_ID : null,
      d.title,
      d.summary,
      d.body,
      d.created_by,
      daysAgo(d.daysAgo),
    ] as (string | number | null)[],
  }));
}

const DAY = 86_400_000;
function daysAgo(n: number, hour = 10): string {
  const d = new Date(Date.now() - n * DAY);
  d.setHours(hour, (n * 7) % 60, 0, 0);
  return d.toISOString();
}

// Order matches the wireframe: Ryan, Mitchell, Sean, Daniel.
const USERS = [
  { id: "u_ryan", name: "Ryan", role: "Renewals Lead", color: "#2f6fed" },
  { id: "u_mitchell", name: "Mitchell", role: "Implementation Lead", color: "#e2703a" },
  { id: "u_sean", name: "Sean", role: "Account Executive", color: "#0f9d58" },
  { id: "u_daniel", name: "Daniel", role: "Ops Manager", color: "#8b5cf6" },
];

const TEAMS = [
  { id: "t_finance", name: "Finance" },
  { id: "t_ops", name: "Operations" },
];

const MEMBERSHIPS = [
  { team_id: "t_finance", user_id: "u_ryan" },
  { team_id: "t_finance", user_id: "u_sean" },
  { team_id: "t_ops", user_id: "u_daniel" },
  { team_id: "t_ops", user_id: "u_mitchell" },
];

interface SeedSession {
  id: string;
  user_id: string;
  title: string;
  seq: number;
  createdDaysAgo: number;
  messages: { id: string; role: "user" | "assistant"; content: string }[];
}

const SESSIONS: SeedSession[] = [
  // ---------------------------------------------------------------- Ryan ---
  {
    id: "s_ryan_1",
    user_id: "u_ryan",
    title: "Chat session #1 — Q3 renewal desk",
    seq: 1,
    createdDaysAgo: 21,
    messages: [
      {
        id: "m_ryan_1_1",
        role: "user",
        content: "What did we land on for the Northwind renewal number?",
      },
      {
        id: "m_ryan_1_2",
        role: "assistant",
        content:
          "Northwind's prior term was $84,000. Off the public rate card the same bundle lists at $91,200.",
      },
      {
        id: "m_ryan_1_3",
        role: "user",
        content:
          "That's the wrong sheet. Going forward, our team quotes renewals off the Q3 pricing sheet, not the public rate card.",
      },
      {
        id: "m_ryan_1_4",
        role: "assistant",
        content:
          "Understood — I'll use the Q3 pricing sheet for renewal quotes from now on. On that sheet Northwind comes to $87,400, a $3,400 increase on the prior term.",
      },
    ],
  },
  {
    id: "s_ryan_2",
    user_id: "u_ryan",
    title: "Chat session #2 — Customer comms",
    seq: 2,
    createdDaysAgo: 9,
    messages: [
      {
        id: "m_ryan_2_1",
        role: "user",
        content: "Draft a reply to Acme asking when the SSO work lands.",
      },
      {
        id: "m_ryan_2_2",
        role: "assistant",
        content:
          "Here's a draft:\n\n\"Hi Priya — SSO is in active development and we're targeting the end of next month. I'll confirm once the build is cut.\"",
      },
      {
        id: "m_ryan_2_3",
        role: "user",
        content:
          "Pull that date. We never promise dates without engineering sign-off — that goes for everyone, company-wide, not just my desk.",
      },
      {
        id: "m_ryan_2_4",
        role: "assistant",
        content:
          "Noted, and I've applied it as a company-wide rule. Revised draft:\n\n\"Hi Priya — SSO is in active development. I don't want to give you a date before engineering has signed off on one; I'll come back to you with a confirmed timeline as soon as I have it.\"",
      },
      {
        id: "m_ryan_2_5",
        role: "user",
        content: "Also stop using emojis in anything customer-facing. Same deal, that's for everyone.",
      },
      {
        id: "m_ryan_2_6",
        role: "assistant",
        content: "Applied company-wide. No emoji in customer-facing copy.",
      },
    ],
  },
  {
    id: "s_ryan_3",
    user_id: "u_ryan",
    title: "Chat session #3 — Contract redlines",
    seq: 3,
    createdDaysAgo: 4,
    messages: [
      {
        id: "m_ryan_3_1",
        role: "user",
        content:
          "When I ask you for a draft, give me the draft first and the caveats after. I keep having to scroll.",
      },
      {
        id: "m_ryan_3_2",
        role: "assistant",
        content: "Got it — draft first, caveats underneath.",
      },
    ],
  },
  {
    id: "s_ryan_4",
    user_id: "u_ryan",
    title: "Chat session #4 — New chat",
    seq: 4,
    createdDaysAgo: 0,
    messages: [],
  },

  // -------------------------------------------------------------- Mitchell ---
  {
    id: "s_mitchell_1",
    user_id: "u_mitchell",
    title: "Chat session #1 — Rollout checklist",
    seq: 1,
    createdDaysAgo: 15,
    messages: [
      {
        id: "m_mitchell_1_1",
        role: "user",
        content: "Give me the standard implementation checklist for a mid-market rollout.",
      },
      {
        id: "m_mitchell_1_2",
        role: "assistant",
        content:
          "Kickoff call, environment questionnaire, SSO configuration, data import dry run, pilot group, full cutover, 30-day check-in.",
      },
      {
        id: "m_mitchell_1_3",
        role: "user",
        content:
          "One thing for everyone: close out any customer-facing answer with a short summary paragraph at the end.",
      },
      {
        id: "m_mitchell_1_4",
        role: "assistant",
        content: "Applied company-wide — customer-facing answers will end with a summary paragraph.",
      },
    ],
  },
  {
    id: "s_mitchell_2",
    user_id: "u_mitchell",
    title: "Chat session #2 — Escalation paths",
    seq: 2,
    createdDaysAgo: 6,
    messages: [
      {
        id: "m_mitchell_2_1",
        role: "user",
        content: "Who do I ping when a customer's import job is stuck overnight?",
      },
      {
        id: "m_mitchell_2_2",
        role: "assistant",
        content:
          "The on-call rotation — that's the route Daniel set for the Operations team. Page on-call rather than messaging an engineering manager directly.",
      },
      {
        id: "m_mitchell_2_3",
        role: "user",
        content: "We should probably stop CC'ing the whole ops list on customer threads.",
      },
      {
        id: "m_mitchell_2_4",
        role: "assistant",
        content:
          "That reads like a rule but I'm not sure how wide you meant it — I've saved it as a proposal for you to confirm before it binds anyone else.",
      },
    ],
  },
  {
    id: "s_mitchell_3",
    user_id: "u_mitchell",
    title: "Chat session #3 — New chat",
    seq: 3,
    createdDaysAgo: 0,
    messages: [],
  },

  // ---------------------------------------------------------------- Sean ---
  {
    id: "s_sean_1",
    user_id: "u_sean",
    title: "Chat session #1 — Northwind renewal",
    seq: 1,
    createdDaysAgo: 12,
    messages: [
      {
        id: "m_sean_1_1",
        role: "user",
        content: "Put together the renewal number for Northwind.",
      },
      {
        id: "m_sean_1_2",
        role: "assistant",
        content:
          "Using the Q3 pricing sheet (not the public rate card), Northwind renews at $87,400 — a $3,400 increase on the prior $84,000 term.",
      },
      {
        id: "m_sean_1_3",
        role: "user",
        content: "Every renewal quote should show the dollar delta against the prior term — team-wide, so we stop getting asked.",
      },
      {
        id: "m_sean_1_4",
        role: "assistant",
        content: "Saved for the Finance team — renewal quotes will always carry the delta.",
      },
    ],
  },
  {
    id: "s_sean_2",
    user_id: "u_sean",
    title: "Chat session #2 — Acme check-in",
    seq: 2,
    createdDaysAgo: 5,
    messages: [
      {
        id: "m_sean_2_1",
        role: "user",
        content: "Anything I should know before the Acme call tomorrow?",
      },
      {
        id: "m_sean_2_2",
        role: "assistant",
        content:
          "Acme is 40 days from renewal, currently on a 12-month term at $52,000, and has an open SSO request in engineering.",
      },
    ],
  },
  {
    id: "s_sean_3",
    user_id: "u_sean",
    title: "Chat session #3 — New chat",
    seq: 3,
    createdDaysAgo: 0,
    messages: [],
  },

  // -------------------------------------------------------------- Daniel ---
  {
    id: "s_daniel_1",
    user_id: "u_daniel",
    title: "Chat session #1 — Onboarding runbook",
    seq: 1,
    createdDaysAgo: 18,
    messages: [
      {
        id: "m_daniel_1_1",
        role: "user",
        content: "Summarise the onboarding runbook changes from last quarter.",
      },
      {
        id: "m_daniel_1_2",
        role: "assistant",
        content:
          "The runbook moved the environment questionnaire ahead of the kickoff call, added a pilot group step, and replaced the manual data import with the bulk loader.",
      },
      {
        id: "m_daniel_1_3",
        role: "user",
        content: "Give me bullets, not paragraphs. That's just how I like to read things.",
      },
      {
        id: "m_daniel_1_4",
        role: "assistant",
        content: "Noted for you specifically — bullets from here on.",
      },
    ],
  },
  {
    id: "s_daniel_2",
    user_id: "u_daniel",
    title: "Chat session #2 — Escalations",
    seq: 2,
    createdDaysAgo: 11,
    messages: [
      {
        id: "m_daniel_2_1",
        role: "user",
        content:
          "Our team routes escalations through the on-call rotation, never straight to engineering managers. Please hold everyone on ops to that.",
      },
      {
        id: "m_daniel_2_2",
        role: "assistant",
        content: "Saved for the Operations team.",
      },
    ],
  },
  {
    id: "s_daniel_3",
    user_id: "u_daniel",
    title: "Chat session #3 — New chat",
    seq: 3,
    createdDaysAgo: 0,
    messages: [],
  },
];

interface SeedMemory {
  id: string;
  scope: "personal" | "team" | "org";
  owner_user_id: string | null;
  team_id: string | null;
  key: string;
  content: string;
  status: "active" | "pending" | "superseded";
  binding: number;
  confidence: number;
  rationale: string;
  created_by: string;
  source_session_id: string | null;
  source_message_id: string | null;
  source_quote: string;
  daysAgo: number;
  supersedes_id: string | null;
  proposed_scope: "personal" | "team" | "org" | null;
}

const MEMORIES: SeedMemory[] = [
  // --- DEMO 1: the org rule Sean has never seen ---------------------------
  {
    id: "mem_org_dates",
    scope: "org",
    owner_user_id: null,
    team_id: null,
    key: "policy.dates",
    content:
      "Never commit a delivery date to a customer without explicit engineering sign-off. Say the date is not confirmed yet rather than estimating one.",
    status: "active",
    binding: 1,
    confidence: 1,
    rationale:
      '"that goes for everyone, company-wide" — explicit universality, so org scope. Ratified as binding: it is a commitment the company makes, not a default preference.',
    created_by: "u_ryan",
    source_session_id: "s_ryan_2",
    source_message_id: "m_ryan_2_3",
    source_quote: "We never promise dates without engineering sign-off — that goes for everyone, company-wide",
    daysAgo: 9,
    supersedes_id: null,
    proposed_scope: null,
  },
  {
    id: "mem_org_emoji",
    scope: "org",
    owner_user_id: null,
    team_id: null,
    key: "tone.emoji",
    content: "Do not use emoji in customer-facing communication.",
    status: "active",
    binding: 0,
    confidence: 0.95,
    rationale: '"Same deal, that\'s for everyone" — generalised beyond the speaker, so org scope.',
    created_by: "u_ryan",
    source_session_id: "s_ryan_2",
    source_message_id: "m_ryan_2_5",
    source_quote: "stop using emojis in anything customer-facing. Same deal, that's for everyone",
    daysAgo: 9,
    supersedes_id: null,
    proposed_scope: null,
  },
  // --- org default that Daniel's personal rule will beat -------------------
  {
    id: "mem_org_summary",
    scope: "org",
    owner_user_id: null,
    team_id: null,
    key: "format.style",
    content: "Close customer-facing answers with a short summary paragraph.",
    status: "active",
    binding: 0,
    confidence: 0.9,
    rationale: '"One thing for everyone" — org scope. Left non-binding: it is a house style, not a policy.',
    created_by: "u_mitchell",
    source_session_id: "s_mitchell_1",
    source_message_id: "m_mitchell_1_3",
    source_quote: "One thing for everyone: close out any customer-facing answer with a short summary paragraph",
    daysAgo: 15,
    supersedes_id: null,
    proposed_scope: null,
  },

  // --- DEMO 2: the Finance rule Mitchell must never see --------------------
  {
    id: "mem_fin_ratecard_old",
    scope: "team",
    owner_user_id: null,
    team_id: "t_finance",
    key: "pricing.source",
    content: "Quote renewals off the public rate card.",
    status: "superseded",
    binding: 0,
    confidence: 0.8,
    rationale: "Superseded by the Q3 pricing sheet rule.",
    created_by: "u_ryan",
    source_session_id: "s_ryan_1",
    source_message_id: "m_ryan_1_1",
    source_quote: "",
    daysAgo: 60,
    supersedes_id: null,
    proposed_scope: null,
  },
  {
    id: "mem_fin_pricing",
    scope: "team",
    owner_user_id: null,
    team_id: "t_finance",
    key: "pricing.source",
    content:
      "Quote renewals off the Q3 pricing sheet, not the public rate card.",
    status: "active",
    binding: 0,
    confidence: 0.92,
    rationale: '"our team quotes renewals" — names the speaker\'s own team, so Finance scope.',
    created_by: "u_ryan",
    source_session_id: "s_ryan_1",
    source_message_id: "m_ryan_1_3",
    source_quote: "our team quotes renewals off the Q3 pricing sheet, not the public rate card",
    daysAgo: 21,
    supersedes_id: "mem_fin_ratecard_old",
    proposed_scope: null,
  },
  {
    id: "mem_fin_delta",
    scope: "team",
    owner_user_id: null,
    team_id: "t_finance",
    key: "pricing.delta",
    content: "Every renewal quote must show the dollar delta against the prior term.",
    status: "active",
    binding: 0,
    confidence: 0.88,
    rationale: '"team-wide" — explicit team reference from a Finance member.',
    created_by: "u_sean",
    source_session_id: "s_sean_1",
    source_message_id: "m_sean_1_3",
    source_quote: "Every renewal quote should show the dollar delta against the prior term — team-wide",
    daysAgo: 12,
    supersedes_id: null,
    proposed_scope: null,
  },

  // --- second team, so scope selection has more than one wrong answer ------
  {
    id: "mem_ops_escalation",
    scope: "team",
    owner_user_id: null,
    team_id: "t_ops",
    key: "policy.escalation",
    content:
      "Route escalations through the on-call rotation, never directly to an engineering manager.",
    status: "active",
    binding: 0,
    confidence: 0.9,
    rationale: '"Our team routes escalations ... hold everyone on ops to that" — Operations scope.',
    created_by: "u_daniel",
    source_session_id: "s_daniel_2",
    source_message_id: "m_daniel_2_1",
    source_quote: "Our team routes escalations through the on-call rotation",
    daysAgo: 11,
    supersedes_id: null,
    proposed_scope: null,
  },

  // --- personal ------------------------------------------------------------
  {
    id: "mem_daniel_bullets",
    scope: "personal",
    owner_user_id: "u_daniel",
    team_id: null,
    key: "format.style",
    content: "Give Daniel bullets, not paragraphs.",
    status: "active",
    binding: 0,
    confidence: 0.95,
    rationale: '"That\'s just how I like to read things" — a preference about this user only.',
    created_by: "u_daniel",
    source_session_id: "s_daniel_1",
    source_message_id: "m_daniel_1_3",
    source_quote: "Give me bullets, not paragraphs. That's just how I like to read things.",
    daysAgo: 18,
    supersedes_id: null,
    proposed_scope: null,
  },
  {
    id: "mem_ryan_draftfirst",
    scope: "personal",
    owner_user_id: "u_ryan",
    team_id: null,
    key: "format.order",
    content: "When Ryan asks for a draft, give the draft first and the caveats after it.",
    status: "active",
    binding: 0,
    confidence: 0.93,
    rationale: '"When I ask you for a draft" — first-person framing about this user.',
    created_by: "u_ryan",
    source_session_id: "s_ryan_3",
    source_message_id: "m_ryan_3_1",
    source_quote: "give me the draft first and the caveats after",
    daysAgo: 4,
    supersedes_id: null,
    proposed_scope: null,
  },

  // --- an unratified org proposal, visible only to its author -------------
  {
    id: "mem_pending_cc",
    scope: "org",
    owner_user_id: null,
    team_id: null,
    key: "comms.cc",
    content: "Do not CC the full ops distribution list on customer threads.",
    status: "pending",
    binding: 0,
    confidence: 0.55,
    rationale:
      '"We should probably" — hedged, and no explicit audience. Best guess is org, but confidence is below the bar, so it waits for Mitchell to confirm and binds nobody meanwhile.',
    created_by: "u_mitchell",
    source_session_id: "s_mitchell_2",
    source_message_id: "m_mitchell_2_3",
    source_quote: "We should probably stop CC'ing the whole ops list on customer threads.",
    daysAgo: 6,
    supersedes_id: null,
    proposed_scope: "org",
  },
];

export async function seedIfEmpty(c: Client): Promise<void> {
  const existing = await c.execute("SELECT COUNT(*) AS n FROM users");
  if (Number(existing.rows[0].n) > 0) return;

  const stmts: { sql: string; args: (string | number | null)[] }[] = [];

  for (const u of USERS) {
    stmts.push({
      sql: `INSERT OR IGNORE INTO users (id, name, role, color) VALUES (?,?,?,?)`,
      args: [u.id, u.name, u.role, u.color],
    });
  }
  for (const t of TEAMS) {
    stmts.push({ sql: `INSERT OR IGNORE INTO teams (id, name) VALUES (?,?)`, args: [t.id, t.name] });
  }
  for (const m of MEMBERSHIPS) {
    stmts.push({
      sql: `INSERT OR IGNORE INTO team_members (team_id, user_id) VALUES (?,?)`,
      args: [m.team_id, m.user_id],
    });
  }

  for (const s of SESSIONS) {
    stmts.push({
      sql: `INSERT OR IGNORE INTO sessions (id, user_id, title, seq, created_at) VALUES (?,?,?,?,?)`,
      args: [s.id, s.user_id, s.title, s.seq, daysAgo(s.createdDaysAgo)],
    });
    s.messages.forEach((msg, i) => {
      stmts.push({
        sql: `INSERT OR IGNORE INTO messages (id, session_id, role, content, created_at) VALUES (?,?,?,?,?)`,
        args: [
          msg.id,
          s.id,
          msg.role,
          msg.content,
          new Date(new Date(daysAgo(s.createdDaysAgo)).getTime() + i * 60_000).toISOString(),
        ],
      });
    });
  }

  for (const m of MEMORIES) {
    const created = daysAgo(m.daysAgo, 11);
    stmts.push({
      sql: `INSERT OR IGNORE INTO memories
              (id, scope, owner_user_id, team_id, org_id, key, content, status, binding,
               confidence, rationale, created_by, source_session_id, source_message_id,
               source_quote, created_at, updated_at, supersedes_id, proposed_scope)
            VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
      args: [
        m.id,
        m.scope,
        m.owner_user_id,
        m.team_id,
        m.scope === "org" ? ORG_ID : null,
        m.key,
        m.content,
        m.status,
        m.binding,
        m.confidence,
        m.rationale,
        m.created_by,
        m.source_session_id,
        m.source_message_id,
        m.source_quote,
        created,
        created,
        m.supersedes_id,
        m.proposed_scope,
      ],
    });
    stmts.push({
      sql: `INSERT OR IGNORE INTO memory_events (id, memory_id, actor_user_id, action, detail, created_at)
            VALUES (?,?,?,?,?,?)`,
      args: [
        `evt_${m.id}`,
        m.id,
        m.created_by,
        m.status === "pending" ? "proposed" : "created",
        `${m.scope} · ${m.rationale}`,
        created,
      ],
    });
    if (m.source_message_id) {
      stmts.push({
        sql: `INSERT OR IGNORE INTO message_memories (message_id, memory_id, relation) VALUES (?,?,?)`,
        args: [m.source_message_id, m.id, "created"],
      });
    }
  }

  // Which memories shaped a couple of the seeded assistant replies, so the
  // "what influenced this answer" affordance has data on first load.
  const influenced: [string, string][] = [
    ["m_sean_1_2", "mem_fin_pricing"],
    ["m_mitchell_2_2", "mem_ops_escalation"],
    ["m_ryan_2_4", "mem_org_dates"],
  ];
  for (const [messageId, memoryId] of influenced) {
    stmts.push({
      sql: `INSERT OR IGNORE INTO message_memories (message_id, memory_id, relation) VALUES (?,?,?)`,
      args: [messageId, memoryId, "used"],
    });
  }

  stmts.push(...documentStatements());
  await c.batch(stmts, "write");
}

/**
 * Blank slate: the four users, their teams, and one empty chat each — no
 * memories, no transcripts. For working through TESTING.md from scratch and
 * watching each rule get created as you go.
 *
 * `seedIfEmpty` skips once users exist, so the app will not re-add the demo
 * data on top of this.
 */
export function blankSeedStatements(): {
  sql: string;
  args: (string | number | null)[];
}[] {
  const stmts: { sql: string; args: (string | number | null)[] }[] = [];

  for (const u of USERS) {
    stmts.push({
      sql: `INSERT OR IGNORE INTO users (id, name, role, color) VALUES (?,?,?,?)`,
      args: [u.id, u.name, u.role, u.color],
    });
  }
  for (const t of TEAMS) {
    stmts.push({
      sql: `INSERT OR IGNORE INTO teams (id, name) VALUES (?,?)`,
      args: [t.id, t.name],
    });
  }
  for (const m of MEMBERSHIPS) {
    stmts.push({
      sql: `INSERT OR IGNORE INTO team_members (team_id, user_id) VALUES (?,?)`,
      args: [m.team_id, m.user_id],
    });
  }
  for (const u of USERS) {
    stmts.push({
      sql: `INSERT OR IGNORE INTO sessions (id, user_id, title, seq, created_at) VALUES (?,?,?,?,?)`,
      args: [`s_${u.id.replace("u_", "")}_1`, u.id, "Chat session #1 — New chat", 1, daysAgo(0)],
    });
  }
  // Documents are the world, not memory — present in both modes, scoped either way.
  stmts.push(...documentStatements());
  return stmts;
}

export async function seedBlank(c: Client): Promise<void> {
  await c.batch(blankSeedStatements(), "write");
}
