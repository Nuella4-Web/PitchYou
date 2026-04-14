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
    job_seeker: 'This person is a job seeker. Tone: professional, clear, and confident. Focus on what they bring to a team or role.',
    freelancer: 'This person is a freelancer or consultant. Tone: results-focused. Show what they deliver, not just what they do.',
    founder: 'This person is a startup founder. Tone: vision + impact. Make it sound like someone building something worth paying attention to.',
    student: 'This person is a student. Tone: growth-focused and genuine. Highlight skills and direction without overstating experience.',
    intro: 'This person is introducing themselves in a general context. Tone: simple, confident, approachable.'
  };

  const tone = toneMap[userType] || toneMap['intro'];
  const confidence = confidenceBoost
    ? 'Confidence is ON. Use bold, assertive, high-value language. Every word should signal this person is serious and worth engaging.'
    : 'Confidence is neutral. Friendly, direct, and clear. No overselling.';

  return `You are a world-class pitch writer. Your job is to take whatever someone gives you — rough, vague, incomplete — and turn it into a pitch that sounds sharp, credible, and completely human.

${tone}

${confidence}

PROCESSING RULES:
- Extract: who they are, what they do, who they help, result they create, and how (infer if missing)
- Convert tasks into outcomes — "I manage projects" becomes "I help teams ship on time"
- Strengthen weak wording without making it fake
- If input is vague or incomplete, infer logically. Never ask follow-up questions.
- Do NOT copy the user's input verbatim
- Do NOT use: passionate, innovative, game-changing, leverage, synergy, driven, dynamic, results-oriented, world-class, dedicated
- No em dashes. No bullet points inside pitch text.
- No fake metrics or assumptions stated as facts
- Sound like a person talking to a person

LENGTH:
- Default: 1-2 sentences. Clear and direct.
- Go longer (3-5 sentences) only if: the user gave rich context, multiple services, proof/results, or depth genuinely improves clarity.
- Length follows input richness, not user type.

OUTPUT FORMAT:
Return ONLY valid JSON. No markdown, no explanation, no extra text.

{
  "mainPitch": "The single best version of their pitch. This is the primary output.",
  "deepVersion": "A 3-5 sentence structured version (problem to value to impact). Only include this if their input was rich enough to support it. If not needed, return an empty string.",
  "variations": {
    "simpler": "A cleaner, shorter version. Strip everything non-essential.",
    "casual": "Conversational. Something they would actually say out loud at a networking event.",
    "stronger": "Maximum confidence. High-value, assertive. No hedging."
  }
}`;
}

// ─── POST /pitch ──────────────────────────────────────────
app.post('/pitch', async (req, res) => {
  const { userType, box1, box2, confidenceBoost } = req.body;

  if (!box1 || box1.trim().length < 10) {
    return res.status(400).json({ error: 'Please add more about what you do.' });
  }

  const userMessage = `What I do:\n${box1.trim()}${box2 && box2.trim() ? '\n\nResults / experience:\n' + box2.trim() : ''}`;

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
        max_tokens: 1000,
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
    job_seeker: 'job seeker — professional and clear',
    freelancer: 'freelancer — results-focused',
    founder: 'founder — vision and impact',
    student: 'student — growth-focused',
    intro: 'general introduction — confident and approachable'
  };

  const tone = toneMap[userType] || toneMap['intro'];

  const system = `You are a pitch editor. You refine pitches based on specific instructions.
The person is a ${tone}.
${confidenceBoost ? 'Confidence is ON — keep the high-value, assertive tone.' : ''}

Rules:
- Apply the instruction faithfully
- Keep it human. No buzzwords.
- No em dashes. No bullet points in the pitch.
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
        max_tokens: 500,
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
    linkedin: 'a LinkedIn bio — written, professional, 3rd person is fine, ends with a line that makes people want to connect',
    elevator: 'a spoken elevator pitch — natural, 30 seconds, ends with a clear ask or next step',
    cover_letter: 'the opening paragraph of a cover letter — human but focused, grabs immediate attention, sets up why this person fits',
    investor: 'an investor pitch intro — leads with the problem, then solution, then why this person, ends with what they are seeking'
  };

  const format = contextMap[context];
  if (!format) return res.status(400).json({ error: 'Invalid context type.' });

  const system = `You are a pitch writer. Convert the given pitch into a new format.
Rules:
- Sound like a human, not a brand
- Keep the person's specific details
- No buzzwords. No em dashes.
- Return ONLY valid JSON: {"convertedPitch": "..."}`;

  const userMessage = `Original context:\n${originalInput || currentPitch}\n\nCurrent pitch:\n"${currentPitch}"\n\nConvert this into: ${format}`;

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
