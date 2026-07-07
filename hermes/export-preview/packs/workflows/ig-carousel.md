---
name: ig-carousel-workflow
title: Instagram Carousel Workflow
generated: "2026-07-07T10:55:05.499Z"
generator: export-twin-context v1
status: ok
source: notion/page/Instagram Carousel Workflow
source_page_id: 36e1fec9-ef83-819b-8eaf-e9e9ed764e1b
---
# Instagram Carousel Workflow

**Cadence:** weekly, on-demand. Isaac sends an outline (a topic, a half-formed take, a contrarian itch, a screenshot, or a Wednesday AI-nudge response). Claude runs the pipeline below. Approval gate sits between draft and Canva.

**Sibling to:** [X Daily Tweet Workflow](https://www.notion.so/3651fec9ef83811ba9ecf530474ec779), [LinkedIn Workflow](https://www.notion.so/3651fec9ef83811ba9ecf530474ec779), [Instagram Story Workflow](https://www.notion.so/36d1fec9ef838158a4d2f8e11cfcdeda). Shares the same Brand Voice Guidelines, Section 11 hard rules, and Section 12 Humanizer.

---

## 1. Inputs Claude expects

One of:

- A topic + Isaac's take (the usual mode)

- A bullet outline of slides

- A reaction to a Wednesday AI/tech/business nudge

- A Substack essay to repurpose as a carousel (`Engine = Essay-link`)

If the outline is thin, Claude pushes back with two or three sharper angles before drafting. Do not draft a soggy carousel just because the outline was soggy.

---

## 2. Refresh the brand voice (every run)

Fetch the latest Brand Voice Guidelines (Notion page id `36b1fec9-ef83-8161-a982-f1186919cbe8`) at the start of every run. Read Section 11 (hard rules) and Section 12 (the Humanizer) fresh. The guidelines are living; nothing about them is cached.

Also fetch the latest IG Caption Voice Reference (separate Notion page) for the caption register.

---

## 3. Slide 1 is a question hook

The first slide stops the thumb with a curiosity question in the voice of the target viewer asking it about themselves. Examples: "Should I implement AI in my business?", "Is my degree still worth anything?", "Why is everyone losing money on AI?".

The Slide 1 question is one sentence. Direct. Not a teaser, not clickbait, not a "5 things" listicle dressed as a question. The viewer has to genuinely want the answer.

**Veto list for Slide 1:**

- Verdict cold opens ("AI is dead", "Your degree is worthless"). Save the verdict for the body or the bookend.

- "Here's why ..." / "5 things ..." / "The truth about ..."

- Any line that softens the claim into mush ("maybe", "sometimes", "in my opinion")

- Anything that could pass as generic LinkedIn motivation

This section overrides the earlier rule that banned questions-as-hooks for carousels. See Section 14 of the Brand Voice Guidelines: "IG Carousel Voice".

---

## 4. Every middle slide carries a fleshed-out premise (~3 sentences)

Each middle slide (Slides 2 through second-to-last) runs about 3 sentences. Not 1, not 2. Single- or two-sentence middle slides read as AI-generated because they skip the natural argument-building Isaac does in his own writing.

The shape for a middle slide:

1. State the claim or observation.

1. Qualify, explain, or work through it.

1. Land the implication or pivot to the next slide.

**Use connectors.** *But, and, so, yet, because, instead, especially.* The connectors carry the argument's logic. A slide of three declarative sentences without connectors reads as ChatGPT bullet points dressed up.

**Keep Isaac's qualifying language.** *Seems, it seems that, theoretically, in theory, technically, probably, almost, rightly so, most, more often.* These hedges are part of his tone, not weakness. A middle slide stripped of qualifiers reads as Claude over-confident. A middle slide with qualifiers reads as Isaac thinking through it out loud.

**Per-sentence substance test still applies.** Each of the three sentences must add a discrete piece of the argument. No echo lines, no decoration, no warm-up sentences.

**Shape:**

- Target 5 to 10 slides total

- Numerals not words ("3 reasons" not "three reasons"), per Section 11 Style rules

- British / Singaporean spelling

---

## 4b. The last slide always bookends Slide 1

The last slide loops back to Slide 1's question and answers it directly. If Slide 1 was "Should I implement AI in my business?", the last slide opens with a callback ("So back to the question. Should you implement AI in your business?") and lands the answer with the qualifying conditions Isaac would put on it ("Yes, but only when X. And only when Y.").

This bookend is mandatory. The loop close is what makes a carousel feel like one piece of thinking rather than a stack of points.

**Anti-patterns for the last slide:**

- Lands a fresh idea instead of answering Slide 1's question. The reader gets stranded.

- Ends on a CTA ("follow for more", "thoughts?", "link in bio"). The bookend is the close.

- Drops the qualifier and lands on a flat yes or no. Isaac's tone always carries the "but only when" or "in theory".

- More than 3 sentences. The bookend should be tight.

---

## 5. Caption voice

Snarky, flippant, witty in the @[isaac.com.sg](http://isaac.com.sg/) register. Mimic the older posted captions (see IG Caption Voice Reference).

Default length: short. One line of attitude, maybe two. If the carousel needs more setup or the caption is doing real explanatory work, expand, but never pad. The caption is not where Claude should re-state the carousel.

No emoji unless Isaac's older captions used them in that exact context. No hashtag dumps. Up to two hashtags only if they genuinely add reach.

---

## 6. Humanizer pass (final gate before saving)

Run Section 12 of the Brand Voice Guidelines against:

- Every slide text

- The caption

Fails to catch: em-dashes/en-dashes, anaphora, negation-reframe, new metaphors (only Isaac's existing ones: pin factory, Plato's cave, air-conditioned cage, parkour leap, basketball, fractal), the full AI-tell purge vocabulary, per-sentence substance test, 20% compression test.

If the draft trips the Humanizer and one fix-and-retry cycle does not clear it, surface the failing lines back to Isaac with the rule each tripped. Do not save a dirty draft as `Draft`.

---

## 7. Save to Notion DB

Create a row in IG Carousel Posts (data source `5fdd5231-f28d-4cb9-b1a2-b3389d6e972b`) with:

- `Hook` = Slide 1 text (this is the title)

- `Drafted` = today

- `Topic` = one-line topic summary

- `Engine` = Net-new / Essay-link / React / Repurpose

- `Status` = Draft

- `Slide Count`

- `Slide Texts` = numbered block ("Slide 1: ... / Slide 2: ... / Slide 3: ...")

- `Caption`

- `Source Essay` if Engine is Essay-link

- `Canva Link` left blank for now

Reply to Isaac in chat with: the draft Slide Texts, the caption, the engine, and a direct link to the Notion row. Wait for approval.

---

## 8. Approval gate

Isaac will either approve, edit inline, or send revisions. On approval:

- Update the Notion row with any edits Isaac applied

- Set `Status` = Approved

- Then and only then move to Canva

Isaac's edits are ground truth (see content workflow feedback rule). Read the approved version back, learn the deltas, apply them to the next run.

---

## 9. Build slides in Canva

Use the Canva connector. Brand kit: **"A Larger Life"** (id `kAG6KDuf62A`). Isaac maintains the kit directly in Canva; pull the latest version on every run, do not cache.

**Aesthetic rules (permanent, apply to every slide on every carousel):**

- **Extreme minimalism, lifestyle register.** Think of a printed essay page or a quiet personal note, not a designed marketing asset. Warm off-white or cream backgrounds, large editorial serif type, generous breathing room.

- **No URL anywhere on the slide.** Not at the top, not at the bottom, not in a footer strip.

- **No brand name, handle, logo, or wordmark on the slide.** Not at the top, not at the bottom. The aesthetic IS the brand. Adding a wordmark turns it corporate.

- **No pictures, photos, illustrations, or stock imagery.** Pure typography plus whitespace. No icons either.

- **No corporate slide design.** No bordered boxes, no big colour blocks, no callout banners, no number badges, no decorative dividers.

- **Date in the top-right corner, every slide, every carousel.** Small type, format "29 May 2026" (day month year, spelled out). Permanent fixture. Added 2026-05-29.

- **Default dimensions: Instagram Portrait 1080 x 1350.** Better thumb-stop than Square. Square (1080 x 1080) only if a specific carousel warrants it.

**First run only:** generate Slide 1 candidates with the brand kit, Isaac picks one, that becomes the template for slides 2-8. Save the final 8-slide design as a Canva brand template after Isaac approves it so future runs autofill the text fields.

**Every run after the template exists:** create a design from the brand template, populate the text fields with the approved slide texts and caption-side date, export, share the link.

When the Canva design exists:

- Set `Canva Link` on the Notion row

- Set `Status` = In Canva

- Reply to Isaac with the Canva link

---

## 10. Post-post reconciliation

After Isaac posts, update the Notion row:

- `Status` = Posted

- `Posted Date` = the date he posted

- Update `Slide Texts` and `Caption` to match the final posted version if Isaac edited in Canva or in IG

This is the calibration set. Future drafts read the recent Posted entries to learn how Isaac actually ships.

The Sunday weekly Constitution review handles cross-platform reconciliation — see the weekly review reference.

---

## 11. Wednesday morning AI/tech nudge

A scheduled task fires Wednesday ~9am: pulls 3 to 5 notable AI / tech / business stories from the past 7 days and asks Isaac for his take. Isaac's reply becomes the outline for that week's carousel (or is shelved if nothing lands). The nudge does not auto-draft. It opens the conversation.

The scheduled task name is `weekly-ig-carousel-nudge`.
