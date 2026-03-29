const twilio = require('twilio');

const twilioClient = twilio(process.env.TWILIO_ACCOUNT_SID, process.env.TWILIO_AUTH_TOKEN);

const conversations = {};

const SYSTEM_PROMPT = `You are LockIn AI, a no-nonsense study accountability coach over SMS. You help students stay consistent with their study goals. You are direct, honest, and supportive but you never let people make excuses.

Rules:
- Keep ALL responses SHORT. This is SMS. 2-4 sentences max. Never write an essay.
- Be direct and human. No bullet points, no long lists.
- If they say they studied, celebrate briefly then push them forward.
- If they say they skipped, be firm but not harsh about getting back on track.
- Ask follow up questions to understand their goals better.
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
  if (conversations[from].length > 20) {
    conversations[from] = conversations[from].slice(-20);
  }

  // Build prompt in Mistral instruct format
  let prompt = `<s>[INST] ${SYSTEM_PROMPT} [/INST]</s>\n`;
  for (const msg of conversations[from]) {
    if (msg.role === 'user') {
      prompt += `[INST] ${msg.content} [/INST]`;
    } else {
      prompt += ` ${msg.content} </s>\n`;
    }
  }

  try {
    const hfRes = await fetch(
      'https://api-inference.huggingface.co/models/mistralai/Mistral-7B-Instruct-v0.3',
      {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${process.env.HUGGINGFACE_API_KEY}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          inputs: prompt,
          parameters: {
            max_new_tokens: 150,
            temperature: 0.7,
            return_full_text: false,
          },
        }),
      }
    );

    const data = await hfRes.json();

    if (!hfRes.ok || data.error) {
      throw new Error(data.error || 'Hugging Face API error');
    }

    let reply = data[0]?.generated_text?.trim();

    // Clean up any leftover prompt tokens
    reply = reply.replace(/\[INST\].*?\[\/INST\]/gs, '').trim();

    if (!reply) throw new Error('Empty response from model');

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
