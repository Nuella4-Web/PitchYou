const express = require('express');
const cors = require('cors');
const fetch = require('node-fetch');

const app = express();
const PORT = process.env.PORT || 3000;

const ANTHROPIC_API_KEY = process.env.ANTHROPIC_API_KEY;
const FRONTEND_URL = process.env.FRONTEND_URL || 'https://pitchyou.netlify.app';

// ─── Middleware ───────────────────────────────────────────
app.use(cors({ origin: FRONTEND_URL }));
app.use(express.json());

// ─── Health Check ─────────────────────────────────────────
app.get('/', (req, res) => {
  res.json({ status: 'PitchYou backend is running' });
});

// ─── Build System Prompt ──────────────────────────────────
function buildSystemPrompt(userType, confidenceBoost) {

  const toneMap = {
    job_seeker: `This person is looking for a job. Their pitch needs to make a hiring manager or recruiter immediately think "I want to talk to this person." Focus on what they bring, what problems they solve, and what they have already done. Make it sound like someone who gets things done, not someone who is hoping to get a chance.`,
    freelancer: `This person is a freelancer or consultant looking for clients. Their pitch needs to make a potential client think "this person gets exactly what I need." Focus on the result the client gets, not the service being offered. Make it outcome-first, not process-first.`,
    founder: `This person is building a company. Their pitch needs to make an investor, partner, or early customer think "this is a real problem and this person knows how to solve it." Lead with the problem in a way that feels urgent and real. Then show why this person is the right one to fix it.`,
    student: `This person is a student building their early career. Their pitch needs to make someone think "this person is sharp and going somewhere." Focus on what they have already done, how they think, and where they are headed. Avoid sounding like a CV. Sound like someone who takes initiative.`,
    intro: `This person is introducing themselves in a general context. Their pitch needs to make someone think "I want to know more about this person." Make it clear, interesting, and specific enough to be memorable.`
  };

  const tone = toneMap[userType] || toneMap['intro'];
  const confidenceInstruction = confidenceBoost
    ? `Confidence level is HIGH. Every sentence should feel like it was said by someone who knows exactly what they are worth. No hedging. No softening. Direct, authoritative, and assured.`
    : `Confidence level is neutral. Clear and direct. Friendly but not timid.`;

  return `You are a world-class pitch strategist. You have spent years studying why some pitches make people lean in and others get ignored. You know the difference between a pitch that sounds good and a pitch that actually converts.

Your job is to take rough, messy, incomplete input and turn it into a pitch that makes the listener feel something immediately. Not just understand something. Feel something.

${tone}

${confidenceInstruction}

WHAT MAKES A PITCH ACTUALLY WORK:
A pitch that converts does three things fast:
1. It makes the listener recognise a problem or desire they already have
2. It shows this person is the solution to that problem, with specifics
3. It ends with something that makes them want to take the next step

WHAT KILLS A PITCH:
- Opening with "I am a..." or "Hi, my name is..." (start with value, not identity)
- Being vague: "I help companies grow" tells nobody anything
- Describing tasks instead of outcomes: "I manage projects" vs "I get projects finished on time"
- Sounding like a job description
- Buzzwords: passionate, innovative, game-changing, leverage, synergy, driven, dynamic, dedicated, results-oriented, world-class
- Weak closes that trail off with no direction

PROCESSING RULES:
- Read what they wrote. Find the real value underneath it, even if they did not say it clearly
- Upgrade every weak phrase to a specific outcome: "help teams" becomes "cut the back-and-forth that slows teams down"
- If they gave proof (numbers, results, clients), use it. Specific beats vague every time
- If they did not give proof, infer something credible and logical from what they said
- Never copy their input word for word. Always rewrite into something sharper
- Remove all filler: "I am really passionate about", "I have always loved", "I believe that"
- Keep sentences short. One idea per sentence. No sentence should need to be read twice.

CRITICAL FORMATTING RULES - YOU MUST FOLLOW THESE EXACTLY:
- NEVER use an em dash (the long dash that looks like this: --). Not once. Not anywhere. This is non-negotiable.
- NEVER use a hyphen to connect two clauses. Use a period instead.
- No bullet points inside the pitch
- No bold or italic text
- No quotation marks around the pitch

LENGTH:
- If their input is short and simple: 2 sentences maximum
- If their input includes context, proof, or multiple services: 3 to 4 sentences
- Never go beyond 4 sentences. A pitch is not an essay.

OUTPUT FORMAT:
Return ONLY valid JSON. No markdown. No explanation. No extra text outside the JSON.

{
  "mainPitch": "The pitch. Written as plain text. No dashes. No bullets. No formatting marks."
}`;
}

// ─── POST /pitch ──────────────────────────────────────────
app.post('/pitch', async (req, res) => {
  const { userType, box1, box2, confidenceBoost } = req.body;

  if (!box1 || box1.trim().length < 10) {
    return res.status(400).json({ error: 'Please add more about what you do.' });
  }

  const userMessage = `What I do:\n${box1.trim()}${box2 && box2.trim() ? '\n\nResults and experience:\n' + box2.trim() : ''}`;

  try {
    const response = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': ANTHROPIC_API_KEY,
        'anthropic-version': '2023-06-01'
      },
      body: JSON.stringify({
        model: 'claude-haiku-4-5-20251001',
        max_tokens: 600,
        system: buildSystemPrompt(userType, confidenceBoost),
        messages: [{ role: 'user', content: userMessage }]
      })
    });

    const data = await response.json();

    if (!response.ok) {
      console.error('Anthropic API error:', data);
      return res.status(500).json({ error: 'Failed to generate pitch. Try again.' });
    }

    const raw = data.content?.[0]?.text || '';
    const clean = raw.replace(/```json|```/g, '').trim();
    const parsed = JSON.parse(clean);

    // Strip any em dashes that slipped through
    parsed.mainPitch = parsed.mainPitch.replace(/\u2014/g, '.').replace(/--/g, '.').trim();

    res.json(parsed);

  } catch (err) {
    console.error('Server error:', err);
    res.status(500).json({ error: 'Something went wrong. Please try again.' });
  }
});

// ─── POST /refine ─────────────────────────────────────────
app.post('/refine', async (req, res) => {
  const { currentPitch, instruction, userType, confidenceBoost } = req.body;

  if (!currentPitch || !instruction) {
    return res.status(400).json({ error: 'Missing pitch or instruction.' });
  }

  const toneMap = {
    job_seeker: 'job seeker, professional and clear',
    freelancer: 'freelancer, results-focused',
    founder: 'founder, vision and impact',
    student: 'student, growth-focused',
    intro: 'general introduction, confident and approachable'
  };

  const tone = toneMap[userType] || toneMap['intro'];

  const system = `You are a pitch editor. Apply the requested change to this pitch.
The person is a ${tone}.
${confidenceBoost ? 'Keep the high-confidence tone.' : ''}

Rules:
- Apply the instruction faithfully
- Keep it human. No buzzwords.
- NEVER use an em dash or double hyphen. Use a period instead.
- No bullet points.
- Return ONLY valid JSON: {"refinedPitch": "..."}`;

  const userMessage = `Current pitch:\n"${currentPitch}"\n\nInstruction: ${instruction}`;

  try {
    const response = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': ANTHROPIC_API_KEY,
        'anthropic-version': '2023-06-01'
      },
      body: JSON.stringify({
        model: 'claude-haiku-4-5-20251001',
        max_tokens: 400,
        system,
        messages: [{ role: 'user', content: userMessage }]
      })
    });

    const data = await response.json();

    if (!response.ok) {
      return res.status(500).json({ error: 'Failed to refine pitch. Try again.' });
    }

    const raw = data.content?.[0]?.text || '';
    const clean = raw.replace(/```json|```/g, '').trim();
    const parsed = JSON.parse(clean);

    parsed.refinedPitch = parsed.refinedPitch.replace(/\u2014/g, '.').replace(/--/g, '.').trim();

    res.json(parsed);

  } catch (err) {
    console.error('Refine error:', err);
    res.status(500).json({ error: 'Something went wrong. Please try again.' });
  }
});

// ─── POST /convert ────────────────────────────────────────
app.post('/convert', async (req, res) => {
  const { currentPitch, originalInput, context, userType } = req.body;

  if (!currentPitch || !context) {
    return res.status(400).json({ error: 'Missing pitch or context.' });
  }

  const contextMap = {
    linkedin: 'a LinkedIn bio. Written, professional, third person is fine. Ends with a line that makes someone want to connect or reach out. No em dashes.',
    elevator: 'a spoken elevator pitch. Natural, conversational, 30 seconds when read aloud. Ends with a clear next step or ask. No em dashes.',
    cover_letter: 'the opening paragraph of a cover letter. Human but focused. Grabs attention in the first sentence. Sets up immediately why this person is the right fit. No em dashes.',
    investor: 'an investor pitch intro. Opens with the problem in a way that feels urgent and real. Then the solution. Then why this person. Ends with what they are looking for. No em dashes.'
  };

  const format = contextMap[context];
  if (!format) return res.status(400).json({ error: 'Invalid context type.' });

  const system = `You are a pitch writer. Rewrite the pitch for a specific new format and context.
Rules:
- Sound like a human, not a brand
- Keep the person's specific details and proof
- No buzzwords
- NEVER use an em dash or double hyphen. Use a period instead.
- No bullet points
- Return ONLY valid JSON: {"convertedPitch": "..."}`;

  const userMessage = `Original input:\n${originalInput || currentPitch}\n\nCurrent pitch:\n"${currentPitch}"\n\nRewrite this as: ${format}`;

  try {
    const response = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': ANTHROPIC_API_KEY,
        'anthropic-version': '2023-06-01'
      },
      body: JSON.stringify({
        model: 'claude-haiku-4-5-20251001',
        max_tokens: 500,
        system,
        messages: [{ role: 'user', content: userMessage }]
      })
    });

    const data = await response.json();

    if (!response.ok) {
      return res.status(500).json({ error: 'Failed to convert pitch. Try again.' });
    }

    const raw = data.content?.[0]?.text || '';
    const clean = raw.replace(/```json|```/g, '').trim();
    const parsed = JSON.parse(clean);

    parsed.convertedPitch = parsed.convertedPitch.replace(/\u2014/g, '.').replace(/--/g, '.').trim();

    res.json(parsed);

  } catch (err) {
    console.error('Convert error:', err);
    res.status(500).json({ error: 'Something went wrong. Please try again.' });
  }
});

// ─── Start Server ─────────────────────────────────────────
app.listen(PORT, () => {
  console.log(`PitchYou backend running on port ${PORT}`);
  console.log(`Frontend: ${FRONTEND_URL}`);
});
