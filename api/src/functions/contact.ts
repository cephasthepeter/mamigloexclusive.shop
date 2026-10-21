import nodemailer from 'nodemailer'
import { app, type HttpRequest, type InvocationContext } from '@azure/functions'
import { enforceRateLimit, errorResponse, json, preflight, readJson, RequestError } from '../http.js'
import { contactSchema } from '../validation.js'

function escapeHtml(value: string) {
  return value.replace(/[&<>"']/g, (character) => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
  })[character]!)
}

async function submit(request: HttpRequest, context: InvocationContext) {
  const options = preflight(request)
  if (options) return options
  try {
    enforceRateLimit(request, context, 5, 60_000)
    const parsed = contactSchema.safeParse(await readJson(request))
    if (!parsed.success) throw new RequestError(400, 'Please check your name, email address and message.')
    if (parsed.data.website) return json(200, { message: 'Thank you. Your message has been received.' }, request)

    const required = ['SMTP_HOST', 'SMTP_USER', 'SMTP_PASSWORD', 'SMTP_FROM', 'SMTP_TO']
    if (required.some((name) => !process.env[name])) {
      throw new RequestError(503, 'The contact form is not configured yet. Please contact us on WhatsApp.')
    }
    const port = Number(process.env.SMTP_PORT || 587)
    if (!Number.isInteger(port) || port < 1 || port > 65535) throw new Error('SMTP_PORT is invalid.')
    const mailer = nodemailer.createTransport({
      host: process.env.SMTP_HOST,
      port,
      secure: port === 465,
      auth: { user: process.env.SMTP_USER, pass: process.env.SMTP_PASSWORD },
    })
    await mailer.sendMail({
      from: process.env.SMTP_FROM,
      to: process.env.SMTP_TO,
      replyTo: parsed.data.email,
      subject: `Store enquiry from ${parsed.data.name}`,
      text: `Name: ${parsed.data.name}\nEmail: ${parsed.data.email}\n\n${parsed.data.message}`,
      html: `<p><strong>Name:</strong> ${escapeHtml(parsed.data.name)}</p><p><strong>Email:</strong> ${escapeHtml(parsed.data.email)}</p><p>${escapeHtml(parsed.data.message).replace(/\n/g, '<br>')}</p>`,
    })
    return json(200, { message: 'Thank you. Your message has been received.' }, request)
  } catch (error) {
    return errorResponse(error, request, context)
  }
}

app.http('contact', {
  methods: ['POST', 'OPTIONS'],
  authLevel: 'anonymous',
  route: 'contact',
  handler: submit,
})
