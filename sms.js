const Anthropic = require('@anthropic-ai/sdk');
const twilio = require('twilio');

const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });
const twilioClient = twilio(process.env.TWILIO_ACCOUNT_SID, process.env.TWILIO_AUTH_TOKEN);

// In-memory store (resets on cold start — fine for MVP)
// Upgrade to Redis or Upstash later if needed
const conversations = {};

const SYSTEM_PROMPT = `You are LockIn AI, a no-nonsense study accountability coach over SMS.

You help students stay consistent with their study goals. You are direct, honest, and supportive but you never let people make excuses. You are like a strict but caring coach who genuinely wants them to succeed.

Rules:
- Keep ALL responses SHORT. This is SMS. 2-4 sentences max. Never write an essay.
- Be direct and human. No bullet points, no long lists.
- If they say they studied, celebrate briefly then push them forward.
- If they say they skipped, acknowledge it without shaming them, but be firm about tomorrow.
- Ask follow up questions to understand their goals better.
- Reference things they told you earlier in the conversation.
- Never lecture them more than once about the same thing.
- End with a short question or action to keep the conversation going.`;

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(200).send('LockIn SMS is running.');
  }

  const from = req.body.From;
  const body = req.body.Body?.trim();

  if (!from || !body) return res.status(400).send('Missing fields');

  console.log(`SMS from ${from}: ${body}`);

  if (!conversations[from]) conversations[from] = [];

  conversations[from].push({ role: 'user', content: body });

  // Keep last 20 messages
  if (conversations[from].length > 20) {
    conversations[from] = conversations[from].slice(-20);
  }

  try {
    const response = await anthropic.messages.create({
      model: 'claude-opus-4-6',
      max_tokens: 300,
      system: SYSTEM_PROMPT,
      messages: conversations[from],
    });

    const reply = response.content[0].text;

    conversations[from].push({ role: 'assistant', content: reply });

    await twilioClient.messages.create({
      body: reply,
      from: process.env.TWILIO_PHONE_NUMBER,
      to: from,
    });

    console.log(`Replied to ${from}: ${reply}`);
    res.status(200).send('OK');

  } catch (err) {
    console.error(err.message);

    await twilioClient.messages.create({
      body: "Something went wrong on my end. Text me again!",
      from: process.env.TWILIO_PHONE_NUMBER,
      to: from,
    });

    res.status(500).send('Error');
  }
}
