# 0014: Chat UI. Markdown, citations, sources and time

**Status:** Accepted (Phase 5)

## Context
Answers are markdown (tables for comparisons, bold, lists), and they cite sources as `[n]`. Before
Phase 5 they were shown as raw text with visible `|` and `**`, and each search printed its own
row of source chips.

## Decisions

### 1. Markdown via `react-markdown` + `remark-gfm`, with raw HTML skipped
Tables, lists, bold and links render as the answer streams in. **`skipHtml`** means text that
originated on a web page can never inject markup or scripts into the app. Wide tables scroll
sideways inside the answer instead of widening the page on phones. Styling uses the Tailwind
Typography plugin (`prose`), with dark mode via `dark:prose-invert`.
*Considered:* hand-written element styles. ➖ More code for the same result.

### 2. Citations are chips that link to the source
`[2]` becomes a small superscript chip. Hovering shows title · site · date, and clicking opens the
page. Real markdown links (`[text](url)`) are left alone. Numbers match the per-turn source registry
([0010](0010-web-search-tool.md)), so a chip always points at the page the model was given.

### 3. One compact search line + only the cited sources
- All searches of an answer (the ones run before it and the model's own) collapse into one line:
  *"Searched 5 queries · 18 sources"*, expandable to see the queries. While running it shows
  *"Searching: …"*.
- Under the answer, a **Sources** list shows only the sources the text actually cites, numbered to
  match. Uncited results are noise to a reader.

### 4. Time is visible
It's a memory app, and answers say "on Tuesday 3 November you asked…". Messages show their time,
and a divider ("Today", "Yesterday", "Tuesday 3 November 2026") appears when the day changes, in the
**viewer's** timezone. The server stamps each answer's start time into the stream
(`messageMetadata.createdAt`); reopened chats use the stored timestamps.

### 5. Small comforts
- A multi-line input: Enter sends, Shift+Enter adds a new line, with no accidental send mid-IME composition.
- Copy on finished answers.
- Auto-scroll only while the reader is at the bottom.
- Example questions on the empty screen.
- The Next.js dev badge is turned off: reviewers use `npm run dev`, and the badge covered the demo
  button (desktop) and Send (phone).

## Verification
The UI was driven in a real browser (Microsoft Edge via `playwright-core`), at desktop, dark-mode
and 390 px phone sizes. Checks: the demo loader, reopening a chat, a live re-check answer (table +
citation chips + sources), no horizontal overflow on the phone. See the
[Phase 5 log](../phases/phase-5-ui.md).

## Skipped on purpose
Themes, accounts, editing past messages, voice. Not what this challenge measures, and every
feature is more code to justify.
