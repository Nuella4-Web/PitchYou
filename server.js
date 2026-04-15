const express = require('express');
const cors = require('cors');
const fetch = require('node-fetch');

const app = express();
const PORT = process.env.PORT || 3000;

const ANTHROPIC_API_KEY = process.env.ANTHROPIC_API_KEY;
const FRONTEND_URL = process.env.FRONTEND_URL || 'https://pitchyou.netlify.app';

app.use(cors({ origin: FRONTEND_URL }));
app.use(express.json());

app.get('/', (req, res) => {
  res.json({ status: 'PitchYou backend is running' });
});

// ─── Helper: strip em dashes ──────────────────────────────
function cleanText(str) {
  if (!str) return '';
  return str.replace(/\u2014/g, '.').replace(/\u2013/g, '-').replace(/--/g, '.').trim();
}

// ─── Helper: call Anthropic ───────────────────────────────
async function callAnthropic(system, userMessage, maxTokens = 800) {
  const response = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-api-key': ANTHROPIC_API_KEY,
      'anthropic-version': '2023-06-01'
    },
    body: JSON.stringify({
      model: 'claude-haiku-4-5-20251001',
      max_tokens: maxTokens,
      system,
      messages: [{ role: 'user', content: userMessage }]
    })
  });

  const data = await response.json();

  if (!response.ok) {
    console.error('Anthropic error:', data);
    throw new Error(data.error?.message || 'Anthropic API error');
  }

  const raw = data.content?.[0]?.text || '';
  return raw.replace(/```json|```/g, '').trim();
}

// ─── POST /generate ───────────────────────────────────────
app.post('/generate', async (req, res) => {
  const { userType, box1, box2, name, confidenceBoost } = req.body;

  if (!box1 || box1.trim().length < 10) {
    return res.status(400).json({ error: 'Please add more about what you do.' });
  }

  const toneMap = {
    job_seeker: 'a job seeker. Their pitch must make a recruiter or hiring manager immediately think "I need to speak to this person." Focus on what they deliver and what they have already done. Make them sound like someone who gets things done.',
    freelancer: 'a freelancer or consultant. Their pitch must make a potential client think "this person gets exactly what I need." Lead with outcomes, not services. The client hires results, not a process.',
    founder: 'a startup founder. Their pitch must make an investor or partner think "this is a real problem and this person knows how to solve it." Open with the problem feeling urgent. Show why this specific person is the right one.',
    student: 'a student building their early career. Their pitch must make someone think "this person is sharp and going somewhere." Show initiative and direction. Avoid sounding like a CV.',
    intro: 'someone introducing themselves. Their pitch must make someone think "I want to know more about this person." Clear, interesting, and specific enough to be memorable.'
  };

  const tone = toneMap[userType] || toneMap['intro'];
  const conf = confidenceBoost
    ? 'Confidence is HIGH. Every sentence should feel like it was said by someone who knows exactly what they are worth. No hedging. Authoritative.'
    : 'Confidence is neutral. Clear and direct without overselling.';

  const system = `You are a world-class pitch strategist. You turn rough descriptions into pitches that make people stop and pay attention.

The person is ${tone}

${conf}

WHAT MAKES A PITCH WORK:
1. Opens with value or a result — never with "I am a" or "Hi my name is"
2. Is specific enough to be credible — vague pitches get ignored
3. Makes the listener feel something — curiosity, recognition, desire
4. Ends with direction — what the person wants next

RULES — ALL NON-NEGOTIABLE:
- Never use: passionate, innovative, game-changing, leverage, synergy, driven, dynamic, dedicated, results-oriented, world-class
- NEVER use em dashes (—). Use a period instead. This is absolute.
- No bullet points inside any text field
- Short sentences. One idea per sentence.
- Convert tasks to outcomes: "I manage projects" becomes "I help teams finish on time"
- If input is vague, infer logically. Never ask follow-up questions.
- Do not copy input word for word. Always rewrite sharper.

Return ONLY valid JSON. No markdown. No explanation.

{
  "headline": "One punchy line. Their positioning in the world. Not a job title. Something that makes someone lean in. Max 10 words.",
  "pitch": "The main pitch. 2-4 sentences. Opens with value. Specific. No em dashes.",
  "bio": "A short written bio. 2-3 sentences. Third person. Reads like something a journalist would write about them. Used on the page below the pitch.",
  "context": "Everything about this person written as a detailed paragraph. This will be used to answer questions visitors ask. Include: what they do, who they help, their results or proof, their style or approach, what they want next. Be detailed — this powers the Q&A."
}`;

  const userMessage = `What I do:\n${box1.trim()}${box2 && box2.trim() ? '\n\nResults and experience:\n' + box2.trim() : ''}${name ? '\n\nMy name: ' + name : ''}`;

  try {
    const raw = await callAnthropic(system, userMessage, 900);
    const parsed = JSON.parse(raw);

    parsed.headline = cleanText(parsed.headline);
    parsed.pitch = cleanText(parsed.pitch);
    parsed.bio = cleanText(parsed.bio);
    parsed.context = cleanText(parsed.context);

    res.json(parsed);
  } catch (err) {
    console.error('Generate error:', err);
    res.status(500).json({ error: 'Failed to generate. Please try again.' });
  }
});

// ─── POST /ask ────────────────────────────────────────────
app.post('/ask', async (req, res) => {
  const { question, context, pitch, name, userType } = req.body;

  if (!question || !context) {
    return res.status(400).json({ error: 'Missing question or context.' });
  }

  const displayName = name ? name.split(' ')[0].replace('@', '') : 'this person';

  const system = `You are ${displayName}. Someone is visiting your personal pitch page and has asked you a question. Answer in first person, naturally and confidently, as yourself.

Your background:
${context}

Your pitch:
${pitch}

RULES FOR ANSWERING:
- Answer in first person ("I", "my", "me")
- Be direct and confident. You know who you are.
- Keep answers short: 2 to 3 sentences maximum
- Use only information from the context provided. Do not invent credentials or fake specifics.
- If asked something you genuinely do not know, say so briefly and redirect to what you do know
- Sound like a real person answering, not a bot
- No em dashes. No bullet points. No lists.
- No corporate language or buzzwords

Return ONLY valid JSON: {"answer": "..."}`;

  const userMessage = `Question: ${question}`;

  try {
    const raw = await callAnthropic(system, userMessage, 300);
    const parsed = JSON.parse(raw);
    parsed.answer = cleanText(parsed.answer);
    res.json(parsed);
  } catch (err) {
    console.error('Ask error:', err);
    res.status(500).json({ error: 'Could not answer that right now.' });
  }
});

app.listen(PORT, () => {
  console.log(`PitchYou backend running on port ${PORT}`);
  console.log(`Frontend: ${FRONTEND_URL}`);
});
