// Sends one email through Brevo (the same account as the invites).

export async function sendEmail(input: {
  to: string;
  subject: string;
  text: string;
  html: string;
}): Promise<{ delivered: boolean; error?: string }> {
  const apiKey = process.env.BREVO_API_KEY?.trim();
  const senderEmail = process.env.BREVO_SENDER_EMAIL?.trim();
  if (!apiKey || !senderEmail) return { delivered: false, error: "Brevo is not configured" };

  try {
    const response = await fetch("https://api.brevo.com/v3/smtp/email", {
      method: "POST",
      headers: { "api-key": apiKey, "Content-Type": "application/json", Accept: "application/json" },
      body: JSON.stringify({
        sender: { name: process.env.BREVO_SENDER_NAME?.trim() || "SmartAAC", email: senderEmail },
        to: [{ email: input.to }],
        subject: input.subject,
        textContent: input.text,
        htmlContent: input.html,
      }),
      signal: AbortSignal.timeout(20000),
    });
    if (!response.ok) return { delivered: false, error: (await response.text()).slice(0, 300) };
    return { delivered: true };
  } catch (error) {
    return { delivered: false, error: error instanceof Error ? error.message : "send failed" };
  }
}
