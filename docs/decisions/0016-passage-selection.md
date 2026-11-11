# 0016: Pick the useful passages of a search result, not its first 700 characters

**Status:** Accepted (after Phase 6). Refines §5 of [0010](0010-web-search-tool.md).

## Context
In a real session, *"Is Ghost Whey available in India, which sites, what price?"* produced a good answer
that still said "no price in the snippet" or "the snippet cuts off" four times. The stored search results
showed two different causes:

| Cause | Share |
|---|---|
| **Tavily itself returned only ~110–170 characters** for most shop pages | 8 of 10 results |
| **Our 700-character cut** dropped prices that Tavily *did* return (5 prices past character 700 on lithosfitnessculture.com) | 2 of 10 results |

## Options (measured on the same query)

| | Time per search | Effect |
|---|---|---|
| A. Keep the first 700 characters (before) | 0.7 s | loses anything past the cut |
| B. Ask Tavily for the full page text (`include_raw_content`) | **3.4 s (+2.7 s on every search)** | full text for only **2 of 5** shops (iHerb and ProteinXpress don't allow it) |
| **C. Select passages from what Tavily already returns (chosen)** | **0.7 s (no change)** | recovers the prices our cut was dropping |

B was rejected as a default: almost 3 s on every search, for text that most shops block anyway. The
brief values speed. (Using B only for shopping-style questions is listed under "another week".)

## Decision: C
[`selectPassages`](../../src/tools/webSearch.ts) splits the result into passages (sentences, table
cells, Tavily's `[...]` chunk separators), scores each one (+3 if it contains a price, amount or rate;
+1 per query word), always keeps the opening passage for context, fills the 700-character budget
with the best passages, keeps them in page order, and marks gaps with "…".

Two details came from the real data:
- A full stop only ends a sentence when a capital letter follows. Otherwise "Rs. 14,599" was split, and
  the amount lost its currency (so it no longer looked like a price).
- Identical passages are kept once: shop pages repeat the product name many times.

**Result on the stored results:** price mentions kept rose from **3 to 8 out of 8**. That includes the 2 lb
price (Rs. 7,599) the original answer said "wasn't shown". A shopping case was added to `npm run eval`.

## Also fixed
Copying an answer's text from the page turned adjacent citation chips into "12" instead of "[1][2]".
The chips now contain visually hidden brackets, which also helps screen readers.
