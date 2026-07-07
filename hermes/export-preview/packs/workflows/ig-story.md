---
name: ig-story-workflow
title: Instagram Story Workflow
generated: "2026-07-07T10:55:05.499Z"
generator: export-twin-context v1
status: ok
source: notion/page/Instagram Story Workflow
source_page_id: 36d1fec9-ef83-8158-a4d2-f8e11cfcdeda
---
# Instagram Story Workflow

*Built from the Brand Voice Guidelines (Notion, living doc) and the "Larger" Substack corpus. Goal: extend each new Substack essay into the casual social register on Instagram Stories, where a short first-person blurb sits over the post's cover image and funnels readers to the full essay via the link sticker. Cadence: one IG story per new Substack essay, drafted weekly on Monday 8am.*

> The hard rules in Section 11 of the Brand Voice Guidelines govern everything below. Every IG story blurb then runs through the Humanizer (Section 12 of the guidelines) before it is saved as Draft. Section 7 of this doc is the operational Humanizer checklist for IG.

---

## 1. What an IG Story blurb is for (and what it is not)

The IG story is the casual social face of a Larger essay. It is shown on top of the Substack cover image with a "read here" link sticker pointing to the article. The blurb has 24 hours of life before it disappears, so it is allowed to be looser, more personal, and more conversational than the X or LinkedIn version of the same idea. The job is to give a friend who follows Isaac on IG enough of the thesis to want to click through.

What the IG story blurb is not: a tweet, a LinkedIn opener, or a Substack abstract. It is closer to how Isaac would describe the essay to a friend over coffee. First-person, casual, slightly under-polished. If it reads like marketing or like an essay summary, it is off-brand.

## 2. The IG Story voice extension

The brand guidelines define the IG voice as the loosest register Isaac uses. This workflow operationalises it for the story format specifically.

<!-- unsupported block type: table -->

The voice constants do not flex. We are first-principles, direct, self-implicating, pragmatic, and comfortable ending unresolved. The IG register relaxes the polish, not the substance.

## 3. The decision: which articles get an IG story

Every new Larger essay gets one IG story blurb. There is no rotation. There is no "skip a week" logic.

**Substack is the source of truth, not Notion.** The Notion Articles page lags behind Substack by days because it depends on the Friday `substack-ig-weekly-sync` task to catch up. This IG workflow does not wait for that sync. Every run fetches the Substack archive directly.

The decision tree:

1. Fetch the Substack archive at [https://isaacsplash.substack.com/archive?sort=new](https://isaacsplash.substack.com/archive?sort=new) and extract every essay slug and publish date. Newest first.

1. Drop any essay older than or equal to 18 May 2026 (WLB, the starting point).

1. For each remaining essay, check the IG Story Posts DB for an entry matching the Substack URL or title. Drop already-drafted essays.

1. For each survivor, draft one IG story blurb and save it as Draft.

1. If no survivors, skip the run.

For each draft, also try to look up the Notion Source Article URL by searching the Articles page for a matching title. If the Notion entry exists, fill `Source Article`. If not, leave it empty and note in the entry that the Friday sync will fill it later.

The "starting point" for this workflow is **Work-life balance is a choice** (published 18 May 2026). Everything from that essay forward gets an IG story draft. Earlier essays do not get retroactive drafts unless Isaac specifically requests them.

## 4. The run loop (target: 5 to 10 minutes per essay)

1. **Refresh the voice.** Re-fetch the Brand Voice Guidelines from Notion at the start of every run and honour any amendments to Section 11. The guidelines are living, the Sunday review proposes amendments, so the version drafted against last week may have changed.

1. **Learn from posted IG stories.** Read the 2 to 3 most recent entries in the IG Story Posts database marked Posted. Isaac's edits on those are the truest exemplars of the IG-story voice. The original archetype is the WLB-era story on "The West got their hierarchy backwards" (cited in Section 10 below).

1. **Find the new essays.** Run the Section 3 decision. List every essay newer than the last Drafted entry in the DB.

1. **Pull the seed.** For each new essay, fetch its body from the Articles page. Extract the single sharpest thesis or the closing principle. The overlay blurb is the conclusion compressed and softened, not a summary.

1. **Draft the blurb.** Open with "I think..." or a near variant. Land the thesis in the first or second sentence. Add one structural note or personal scene. Close on a generalised principle, a sober note, or an open question. 3 to 5 sentences total.

1. **Run QA.** Walk the Section 7 checklist. Strip every em-dash. Kill every negation reframe. Confirm the blurb feels like a coffee chat, not a press release.

1. **Save to the IG Story Posts DB.** Article Title, Substack URL, Source Article (Notion URL), IG Story Copy, Status: Draft, Drafted: today's date.

1. **Isaac reviews, edits, posts.** When posted, Isaac sets Status to Posted and the entry becomes part of the calibration set.

## 5. The frame: how the blurb opens

The WLB-era IG stories use a near-fixed shape. Follow it loosely. Drift only when the essay demands it.

- **Sentence 1 (the claim):** Open with "I think..." or close cousins ("I think we have been thought to think...", "I have been thinking about...", "I have come around to the idea that..."). Land the thesis here. Personal opinion frame, not declarative authority.

- **Sentences 2 to 3 (the working):** One first-principles step or one personal scene. Short, casual sentences. Light grammar drift is fine.

- **Final sentence (the principle):** Generalise the take to a broader claim that stands on its own. The closing line is the line a friend would screenshot.

The overlay does not need a CTA. The link sticker is the CTA.

## 6. Anchor archetype: the WLB-era IG Story

This is the template archetype. The very first IG story (on "The West got their hierarchy backwards") looked like this:

> I think we have been thought to think that some of these western rights, like personal privacy, is a fundamental right. But if you analyse from first principles, it probably doesn't come close to things like personal safety and wellbeing. Weighing these rights from first principles is essential for proper governance.

Three sentences. "I think" opener. Plain language. The third sentence generalises to a broader principle ("essential for proper governance"). Slight grammar drift ("thought to think") is preserved as a human signature. This is the bar.

## 7. The Humanizer (mandatory QA pass, Section 12 of the Brand Voice Guidelines)

Run this on every IG story blurb before it saves. If any line trips, fix it and re-run.

**Punctuation and structure**

<!-- unsupported block type: to_do -->

<!-- unsupported block type: to_do -->

<!-- unsupported block type: to_do -->

<!-- unsupported block type: to_do -->

<!-- unsupported block type: to_do -->

<!-- unsupported block type: to_do -->

<!-- unsupported block type: to_do -->

**Vocabulary blacklist (grep first, then read)**

<!-- unsupported block type: to_do -->

<!-- unsupported block type: to_do -->

<!-- unsupported block type: to_do -->

<!-- unsupported block type: to_do -->

**IG-specific**

<!-- unsupported block type: to_do -->

<!-- unsupported block type: to_do -->

<!-- unsupported block type: to_do -->

<!-- unsupported block type: to_do -->

<!-- unsupported block type: to_do -->

<!-- unsupported block type: to_do -->

<!-- unsupported block type: to_do -->

**The 99% sweep (final read)**

<!-- unsupported block type: to_do -->

## 8. The edit-and-learn loop

Isaac edits drafts before he posts. The version he posts on IG is the ground truth, not the draft this workflow produced.

First, every draft saved by this workflow is a Draft. Isaac edits in his own register and posts. After posting, set Status to Posted.

Second, after the next Monday run, read the 2 to 3 most recent Posted entries before drafting. Let them recalibrate the voice. Over time the Posted entries become the calibration set, so drafts drift toward Isaac's real IG-story voice rather than away from it.

Third, if a clear repeated edit pattern emerges (always shortens to 3 sentences, always cuts the personal scene, always sharpens the closing principle), capture it as a feedback memory so it persists across sessions.

## 9. Sibling systems

- **Substack** (Larger essays): Notion Articles page, drafted via the `larger-substack-writer` skill. The IG story workflow consumes the output of this one.

- **X** (daily tweets, 8am): X Daily Tweets DB, daily scheduled task `daily-x-tweet-draft`.

- **LinkedIn** (Mon/Wed/Fri, 9am): LinkedIn Posts DB, scheduled task `linkedin-alternate-day-draft`.

- **Weekly Constitution review** (Sunday 9am): reconciles posts vs Notion and calibrates the Personal Constitution. Past-dated unposted X/LI drafts get deleted there. **IG Story drafts are kept** even when past-dated, because the IG cadence is per-essay rather than per-day and the draft incubates until Isaac decides to post.

## 10. Open questions (flagged for Isaac to resolve)

- **Multi-essay weeks.** If Isaac publishes two essays in one week, the Monday run drafts two IG stories. Confirm that is the desired behaviour rather than one-per-week with a queue.

- **The "approved cover image" question.** This workflow drafts the overlay text only. Whether the IG story uses the Substack cover image, a custom image, or something else is Isaac's call at post time.

- **Light grammar drift.** The WLB archetype preserves "thought to think" rather than "taught to think." Confirm that light drift is desired as a human signature on IG, where it is, rather than corrected in QA.

- **Profanity ceiling on IG.** Set to free, used for emphasis. Adjust if the audience composition changes.
