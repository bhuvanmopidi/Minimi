import type Database from "better-sqlite3";
import { addDays, dayIn, dayStartUtc, weekdayOf, type Day } from "@/time/zone";
import { insertMessage } from "./repo";

// Demo history for trying memory questions on a fresh install. Titles are marked "Demo ·" and the
// data is only created when the user clicks "Load demo chats". Dates are relative to today, so the
// challenge's example questions ("On Monday we shortlisted…", "Last Tuesday I asked…") always line up.

type DemoChat = { key: string; title: string; day: Day; time: string; turns: [string, string][] };

export function demoChats(today: Day): DemoChat[] {
  const mostRecent = (weekday: number) => {
    let d = addDays(today, -1);
    while (weekdayOf(d) !== weekday) d = addDays(d, -1);
    return d;
  };
  const monday = mostRecent(1);
  // The Tuesday of the week before, so "last Tuesday" is ambiguous and history has to settle it.
  const tuesdayBefore = addDays(mostRecent(2), -7);

  return [
    {
      key: "crm",
      title: "Demo · CRM shortlist for the sales team",
      day: monday,
      time: "10:15",
      turns: [
        [
          "We're picking a CRM for a 20-person sales team. Shortlist 5 tools with pricing.",
          "Here's a shortlist of 5 for a 20-person team, with list prices per seat per month on annual billing:\n\n" +
            "| Tool | Plan | Price |\n|---|---|---|\n" +
            "| HubSpot Sales Hub | Professional | $100/seat |\n" +
            "| Salesforce Sales Cloud | Pro Suite | $100/user |\n" +
            "| Pipedrive | Advanced | $39/seat |\n" +
            "| Zoho CRM | Professional | $23/user |\n" +
            "| Attio | Pro | $34/seat |\n\n" +
            "For 20 seats that's roughly $460–$2,000/month. HubSpot and Salesforce are the most complete; Pipedrive and Attio are the easiest to roll out quickly.",
        ],
      ],
    },
    {
      key: "pg",
      title: "Demo · Postgres hosting comparison",
      day: tuesdayBefore,
      time: "11:40",
      turns: [
        [
          "Compare Postgres hosting for a small SaaS: Neon, Supabase and Railway. Which is cheapest to start?",
          "For a small SaaS:\n\n" +
            "- **Neon**: Launch plan at $19/month, serverless with scale-to-zero and branching.\n" +
            "- **Supabase**: Pro plan at $25/month per project, including auth and storage.\n" +
            "- **Railway**: Hobby plan at $5/month, then usage-based.\n\n" +
            "Railway is cheapest to start; Neon is the best fit if you want branching for preview environments.",
        ],
      ],
    },
    {
      key: "laptop",
      title: "Demo · Laptop for machine learning",
      day: addDays(today, -16),
      time: "18:05",
      turns: [
        [
          "What's a good laptop for machine learning under $2,000?",
          "Under $2,000, look for an NVIDIA RTX 4070 (8 GB VRAM) or better, 32 GB RAM and a good cooling design. A MacBook Pro with M-series Pro chip is the pick if you mostly run inference and want battery life.",
        ],
      ],
    },
  ];
}

/** Replace this user's demo chats with a fresh set. Returns how many conversations were created. */
export function seedDemoHistory(db: Database.Database, opts: { userId: string; timeZone: string; now: Date }): number {
  const today = dayIn(opts.now, opts.timeZone);
  const suffix = opts.userId.replace(/^usr_/, "").slice(0, 12);
  const chats = demoChats(today);

  db.transaction(() => {
    for (const chat of chats) {
      const id = `conv_demo${chat.key}${suffix}`;
      db.prepare("DELETE FROM conversations WHERE id = ?").run(id);
      const [hh, mm] = chat.time.split(":").map(Number);
      const start = dayStartUtc(chat.day, opts.timeZone).getTime() + (hh * 60 + mm) * 60_000;
      const at = (offsetMin: number) => new Date(start + offsetMin * 60_000).toISOString();

      db.prepare(
        "INSERT INTO conversations (id, user_id, title, created_at, updated_at) VALUES (?, ?, ?, ?, ?)",
      ).run(id, opts.userId, chat.title, at(0), at(0));
      chat.turns.forEach(([question, answer], i) => {
        insertMessage(db, { id: `${id}_q${i}`, conversationId: id, role: "user", content: question, tz: opts.timeZone, at: at(i * 2) });
        insertMessage(db, { id: `${id}_a${i}`, conversationId: id, role: "assistant", content: answer, at: at(i * 2 + 1) });
      });
    }
  })();
  return chats.length;
}
